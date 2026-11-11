"""Alert ingestion and the incident lifecycle.

Device alert states map onto incidents like this:

    pending   -> new PENDING incident (wearer can still cancel)
    event     -> OPEN incident (or escalate the pending one)
    active    -> OPEN incident; severity follows the current condition
    cleared   -> CLEARED (condition ended on its own)
    cancelled -> CANCELLED (wearer pressed "I'm OK")

Operators then move OPEN/PENDING incidents to ACKNOWLEDGED (the vest is
told "help is coming") and finally RESOLVED.
"""
from datetime import datetime, timedelta

from app.models.alert import Alert
from app.models.base_model import utcnow
from app.models.device import Device
from app.models.enums import AlertSource, AlertStatus, DeviceAlertState, Severity, values
from app.persistence.repositories import AlertFilter
from app.services.facade.errors import FacadeError
from app.services.ingest import AlertPayload, parse_alert


class AlertFacadeMixin:
    # ── ingestion ────────────────────────────────────────────
    def ingest_device_alert(self, device_code: str, raw, received_at: datetime | None = None) -> dict | None:
        received_at = received_at or utcnow()
        payload = parse_alert(device_code, raw)
        with self.transaction():
            device = self._resolve_device(payload.device_code)
            if device is None:
                return None
            if self.alerts.device_event_exists(device.device_id, payload.seq, payload.uptime_s):
                return {"duplicate": True}  # QoS-1 redelivery or store-and-forward replay
            self._mark_seen(device, received_at)
            occurred_at = self._event_time(device, payload, received_at)
            existing = self.alerts.find_open(device.device_id, payload.alert_type)
            alert, kind = self._apply_device_state(device, existing, payload, occurred_at, received_at)
            if alert is None:
                return None
            self._add_event(alert, kind, received_at, severity=payload.severity.value, value=payload.value,
                            seq=payload.seq, uptime_s=payload.uptime_s, payload=dict(raw))
            self._reprioritize(alert, received_at)
            self._refresh_risk(device, received_at)
            result = alert.to_dict()
        return result

    def _apply_device_state(self, device: Device, alert: Alert | None, p: AlertPayload,
                            occurred_at: datetime, now: datetime) -> tuple[Alert | None, str]:
        severity = p.severity
        context = {**p.context}
        if p.state == DeviceAlertState.PENDING:
            if alert is None:
                alert = self._new_alert(device, alert_type=p.alert_type, source=AlertSource.DEVICE.value,
                                        severity=severity.value, status=AlertStatus.PENDING.value,
                                        at=occurred_at, value=p.value, context=context)
                return alert, "pending"
            self._touch(alert, p, now, context)
            return alert, "pending"

        if p.state in (DeviceAlertState.EVENT, DeviceAlertState.ACTIVE):
            if alert is None:
                alert = self._new_alert(device, alert_type=p.alert_type, source=AlertSource.DEVICE.value,
                                        severity=severity.value, status=AlertStatus.OPEN.value,
                                        at=occurred_at, value=p.value, context=context)
                return alert, p.state.value
            kind = p.state.value
            escalated = severity.rank > Severity(alert.severity).rank
            if alert.status == AlertStatus.PENDING.value:
                alert.status = AlertStatus.OPEN.value
                kind = "escalated" if escalated else kind
            elif escalated:
                kind = "escalated"
                # A worse condition after acknowledgement needs a fresh acknowledgement.
                if alert.status == AlertStatus.ACKNOWLEDGED.value and severity == Severity.CRITICAL:
                    alert.status = AlertStatus.OPEN.value
                    kind = "reopened"
            if p.state == DeviceAlertState.ACTIVE or escalated:
                alert.severity = severity.value  # condition alerts follow the live severity
            self._touch(alert, p, now, context)
            return alert, kind

        if p.state == DeviceAlertState.CLEARED:
            if alert is None:
                return None, ""
            alert.status = AlertStatus.CLEARED.value
            alert.resolved_at = occurred_at
            self._touch(alert, p, now, context)
            return alert, "cleared"

        # CANCELLED — the wearer answered the pre-alert
        if alert is None:
            alert = self._new_alert(device, alert_type=p.alert_type, source=AlertSource.DEVICE.value,
                                    severity=Severity.INFO.value, status=AlertStatus.CANCELLED.value,
                                    at=occurred_at, value=p.value, context=context)
            alert.resolved_at = occurred_at
            return alert, "cancelled"
        alert.status = AlertStatus.CANCELLED.value
        alert.resolved_at = occurred_at
        self._touch(alert, p, now, context)
        return alert, "cancelled"

    @staticmethod
    def _touch(alert: Alert, p: AlertPayload, now: datetime, context: dict) -> None:
        alert.value = p.value if p.value is not None else alert.value
        alert.context = {**(alert.context or {}), **context}
        alert.last_event_at = now
        alert.event_count = (alert.event_count or 0) + 1

    @staticmethod
    def _event_time(device: Device, p: AlertPayload, received_at: datetime) -> datetime:
        """When the event really happened (alerts can be replayed after an outage)."""
        tolerance = timedelta(seconds=5)
        if p.device_ts and timedelta(0) <= received_at + tolerance - p.device_ts <= timedelta(days=1):
            return min(p.device_ts, received_at)
        if p.uptime_s is not None and device.boot_at is not None:
            candidate = device.boot_at + timedelta(seconds=p.uptime_s)
            if timedelta(0) <= received_at + tolerance - candidate <= timedelta(days=1):
                return min(candidate, received_at)
        return received_at

    # ── queries ──────────────────────────────────────────────
    def list_alerts(self, *, scope="open", severity=None, alert_type=None, source=None, device_id=None,
                    since_hours=None, limit=50, offset=0) -> dict:
        if scope not in ("open", "closed", "all"):
            raise FacadeError("scope must be open, closed or all", 400)
        if severity and severity not in values(Severity):
            raise FacadeError("unknown severity", 400)
        if source and source not in values(AlertSource):
            raise FacadeError("unknown source", 400)
        limit = max(1, min(int(limit), 200))
        offset = max(0, int(offset))
        since = utcnow() - timedelta(hours=float(since_hours)) if since_hours else None
        items, total = self.alerts.search(AlertFilter(scope=scope, severity=severity, alert_type=alert_type,
                                                      source=source, device_id=device_id, since=since,
                                                      limit=limit, offset=offset))
        return {"items": [alert.to_dict() for alert in items], "total": total, "limit": limit, "offset": offset}

    def get_alert(self, alert_id: str) -> dict:
        return self._require_alert(alert_id).to_dict(include_events=True)

    def alert_summary(self) -> dict:
        counts = self.alerts.count_open_by_severity()
        return {"open_total": sum(counts.values()),
                **{f"open_{severity}": counts.get(severity, 0) for severity in values(Severity)}}

    # ── operator actions ─────────────────────────────────────
    def acknowledge_alert(self, alert_id: str, operator_id: str, note: str | None = None) -> dict:
        now = utcnow()
        with self.transaction():
            alert = self._require_alert(alert_id)
            if not alert.is_open:
                raise FacadeError("This alert is already closed", 409)
            already = alert.status == AlertStatus.ACKNOWLEDGED.value
            if not already:
                alert.status = AlertStatus.ACKNOWLEDGED.value
                alert.acknowledged_at = now
                alert.acknowledged_by = operator_id
                self._reprioritize(alert, now)
                self._add_event(alert, "acknowledged", now, actor=operator_id, note=note)
                self._refresh_risk(alert.device, now)
            alert_type, source, device_id = alert.alert_type, alert.source, alert.device_id

        notified = None
        if not already and source == AlertSource.DEVICE.value:
            # Tell the wearer help is coming (vibration + "OK" on the LED matrix).
            command = self.send_command(device_id, "ack", {"type": alert_type}, operator_id, alert_id=alert_id)
            notified = command["status"] == "sent"
        result = self.get_alert(alert_id)
        result["device_notified"] = notified
        return result

    def resolve_alert(self, alert_id: str, operator_id: str, note: str | None = None) -> dict:
        now = utcnow()
        with self.transaction():
            alert = self._require_alert(alert_id)
            if not alert.is_open:
                raise FacadeError("This alert is already closed", 409)
            alert.status = AlertStatus.RESOLVED.value
            alert.resolved_at = now
            alert.resolved_by = operator_id
            alert.resolution_note = (note or "").strip()[:500] or None
            if alert.acknowledged_at is None:
                alert.acknowledged_at, alert.acknowledged_by = now, operator_id
            self._reprioritize(alert, now)
            self._add_event(alert, "resolved", now, actor=operator_id, note=alert.resolution_note)
            self._refresh_risk(alert.device, now)
        return self.get_alert(alert_id)

    def _require_alert(self, alert_id: str) -> Alert:
        alert = self.alerts.get(alert_id) if alert_id else None
        if alert is None:
            raise FacadeError("Alert not found", 404)
        return alert
