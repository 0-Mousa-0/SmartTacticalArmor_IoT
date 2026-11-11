"""Building blocks shared by every facade mixin.

* Unit of work: ``with self.transaction():`` commits once or rolls back.
* Device resolution and live state (online/offline, position, view model).
* Glue between ingestion and the AI analysis layer (risk refresh, analysis
  alerts raised / cleared by the server).
"""
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timedelta

from flask import current_app

from app.extensions import db
from app.models.alert import Alert
from app.models.alert_catalog import decode_alert_mask
from app.models.alert_event import AlertEvent
from app.models.base_model import iso
from app.models.device import Device
from app.models.enums import AlertSource, AlertStatus, Severity
from app.services.analysis import OpenAlertView, RiskInputs, compute_priority
from app.services.facade.errors import FacadeError


class FacadeCoreMixin:
    # ── infrastructure ───────────────────────────────────────
    @staticmethod
    def _cfg(key: str):
        return current_app.config[key]

    @contextmanager
    def transaction(self):
        """One use case = one atomic commit (repositories never commit)."""
        try:
            yield
            db.session.commit()
        except Exception:
            db.session.rollback()
            raise

    # ── devices ──────────────────────────────────────────────
    def _require_device(self, device_id: str) -> Device:
        device = self.devices.get(device_id) if device_id else None
        if device is None:
            raise FacadeError("Device not found", 404)
        return device

    def _resolve_device(self, device_code: str, simulated: bool | None = None) -> Device | None:
        """Device for an incoming MQTT message; None when it is retired."""
        device = self.devices.get_by_code(device_code)
        if device is None:
            if not self._cfg("DEVICE_AUTO_REGISTER"):
                raise FacadeError(f"Unknown device {device_code} — register it first", 404)
            device = self.devices.add(Device(
                device_code=device_code,
                display_name=f"Vest {device_code}",
                is_simulated=bool(simulated),
                telemetry_interval_s=self._cfg("DEVICE_DEFAULT_INTERVAL_S"),
            ))
        return device if device.is_active else None

    @staticmethod
    def _mark_seen(device: Device, at: datetime, uptime_s: int | None = None) -> None:
        if device.last_seen_at is None or at >= device.last_seen_at:
            device.last_seen_at = at
        if uptime_s is not None:
            device.boot_at = at - timedelta(seconds=uptime_s)

    def _offline_window_s(self, device: Device) -> int:
        return max(self._cfg("DEVICE_OFFLINE_MIN_S"), 3 * (device.telemetry_interval_s or 5))

    def _connection_state(self, device: Device, now: datetime) -> str:
        if device.last_seen_at is None:
            return "never"
        # Last Will (online=false) received after the last data -> offline now.
        if (not device.reported_online and device.last_status_at
                and device.last_status_at >= device.last_seen_at):
            return "offline"
        age = (now - device.last_seen_at).total_seconds()
        return "online" if age <= self._offline_window_s(device) else "offline"

    @staticmethod
    def _position(device: Device) -> dict | None:
        snapshot = device.last_telemetry or {}
        if snapshot.get("lat") is not None and snapshot.get("lng") is not None:
            return {"lat": snapshot["lat"], "lng": snapshot["lng"], "source": "gps"}
        person = device.personnel
        if person and person.post_lat is not None and person.post_lng is not None:
            return {"lat": person.post_lat, "lng": person.post_lng, "source": "post"}
        return None

    @staticmethod
    def _personnel_view(person) -> dict | None:
        if person is None:
            return None
        return {
            **person.summary(),
            "unit_name": person.unit_name,
            "blood_type": person.blood_type,
            "zone": person.zone,
            "post_lat": person.post_lat,
            "post_lng": person.post_lng,
        }

    def _open_alerts_by_device(self) -> dict[str, list[Alert]]:
        grouped: dict[str, list[Alert]] = defaultdict(list)
        for alert in self.alerts.all_open():
            grouped[alert.device_id].append(alert)
        return grouped

    def _device_view(self, device: Device, now: datetime, open_alerts: list[Alert]) -> dict:
        """The 'unit' read model: vest + wearer + live state + AI risk."""
        snapshot = device.last_telemetry or {}
        ordered = sorted(open_alerts, key=lambda a: a.priority, reverse=True)
        return {
            **device.to_dict(),
            "personnel": self._personnel_view(device.personnel),
            "connection": self._connection_state(device, now),
            "last_seen_age_s": int((now - device.last_seen_at).total_seconds()) if device.last_seen_at else None,
            "telemetry": snapshot,
            "telemetry_at": iso(device.last_telemetry_at),
            "device_alerts_active": decode_alert_mask(snapshot.get("alert_mask")),
            "open_alerts": [
                {
                    "alert_id": a.alert_id,
                    "alert_type": a.alert_type,
                    "severity": a.severity,
                    "status": a.status,
                    "source": a.source,
                    "priority": a.priority,
                }
                for a in ordered
            ],
            "risk": {
                "score": device.risk_score,
                "level": device.risk_level,
                "factors": device.risk_reasons or [],
                "updated_at": iso(device.risk_updated_at),
            },
            "position": self._position(device),
        }

    # ── AI analysis glue ─────────────────────────────────────
    def _refresh_risk(self, device: Device, now: datetime):
        snapshot = device.last_telemetry or {}
        persist = self._cfg("ANALYSIS_PERSIST_READINGS")
        anomalous = tuple(sorted(
            metric for metric, row in self.baselines.for_device(device.device_id).items()
            if row.consecutive_anomalies >= persist
        ))
        assessment = self.risk_engine.assess(RiskInputs(
            open_alerts=tuple(
                OpenAlertView(a.alert_type, a.severity, a.status)
                for a in self.alerts.open_for_device(device.device_id)
            ),
            connected=self._connection_state(device, now) == "online",
            has_telemetry=device.last_seen_at is not None,
            prealert=bool(snapshot.get("prealert")),
            posture=snapshot.get("posture"),
            still_s=snapshot.get("still_s"),
            vest_temp_c=snapshot.get("vest_temp_c"),
            anomalous_metrics=anomalous,
        ))
        device.risk_score = assessment.score
        device.risk_level = assessment.level.value
        device.risk_reasons = [factor.to_dict() for factor in assessment.factors]
        device.risk_updated_at = now
        return assessment

    def _reprioritize(self, alert: Alert, now: datetime) -> None:
        age = (now - alert.occurred_at).total_seconds() if alert.occurred_at else 0.0
        alert.priority = compute_priority(alert.alert_type, alert.severity, alert.status, age)

    def _new_alert(self, device: Device, *, alert_type: str, source: str, severity: str, status: str,
                   at: datetime, value=None, message=None, context=None) -> Alert:
        alert = Alert(
            device_id=device.device_id,
            personnel_id=device.personnel_id,
            alert_type=alert_type,
            source=source,
            severity=severity,
            status=status,
            value=value,
            message=message,
            context=context or {},
            occurred_at=at,
            last_event_at=at,
            event_count=1,
        )
        alert.priority = compute_priority(alert_type, severity, status)
        return self.alerts.add(alert)

    def _add_event(self, alert: Alert, kind: str, at: datetime, *, severity=None, value=None, seq=None,
                   uptime_s=None, actor=None, note=None, payload=None) -> None:
        self.alerts.add_event(AlertEvent(
            alert_id=alert.alert_id,
            device_id=alert.device_id,
            kind=kind,
            severity=severity,
            value=value,
            device_seq=seq,
            device_uptime_s=uptime_s,
            actor_operator_id=actor,
            note=note,
            payload=payload,
            received_at=at,
        ))

    def _raise_analysis_alert(self, device: Device, alert_type: str, now: datetime, *,
                              severity: Severity = Severity.WARNING, value=None, message=None,
                              context=None) -> Alert:
        alert = self.alerts.find_open(device.device_id, alert_type)
        if alert is not None:  # already open: refresh it, don't spam the timeline
            alert.value = value
            alert.context = context or alert.context
            alert.message = message or alert.message
            alert.last_event_at = now
            self._reprioritize(alert, now)
            return alert
        alert = self._new_alert(device, alert_type=alert_type, source=AlertSource.ANALYSIS.value,
                                severity=severity.value, status=AlertStatus.OPEN.value, at=now,
                                value=value, message=message, context=context)
        self._add_event(alert, "detected", now, severity=severity.value, value=value, payload=context)
        return alert

    def _clear_analysis_alert(self, device: Device, alert_type: str, now: datetime, note: str | None = None) -> bool:
        alert = self.alerts.find_open(device.device_id, alert_type)
        if alert is None or alert.source != AlertSource.ANALYSIS.value:
            return False
        alert.status = AlertStatus.CLEARED.value
        alert.resolved_at = now
        alert.last_event_at = now
        alert.resolution_note = note
        alert.event_count += 1
        self._reprioritize(alert, now)
        self._add_event(alert, "cleared", now, note=note)
        return True
