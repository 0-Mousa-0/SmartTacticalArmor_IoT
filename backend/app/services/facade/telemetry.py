"""Telemetry ingestion: the "sensor data -> AI analysis" pipeline.

For each telemetry message:
  1. parse + validate the payload (anti-corruption layer)
  2. update the vest's live state (last seen, boot time, snapshot)
  3. score every metric against the wearer's personal baseline
  4. raise / clear analysis alerts for persistent anomalies
  5. store the reading (down-sampled) for history and charts
  6. re-assess the wearer's risk score
all in one transaction.
"""
from datetime import datetime

from app.models.base_model import utcnow
from app.models.device import Device
from app.models.telemetry_reading import TelemetryReading
from app.services.analysis import METRIC_SPECS, BaselineState, MetricEvaluation
from app.services.ingest import TelemetryPayload, parse_telemetry

_METRIC_UNITS = {"vest_temp_c": "°C", "activity_g": "g", "heart_rate": "bpm", "spo2": "%",
                 "skin_temp_c": "°C", "radiation_usvh": "µSv/h"}


class TelemetryFacadeMixin:
    def ingest_telemetry(self, device_code: str, raw, received_at: datetime | None = None) -> dict | None:
        received_at = received_at or utcnow()
        payload = parse_telemetry(device_code, raw)
        with self.transaction():
            device = self._resolve_device(payload.device_code)
            if device is None:
                return None
            previous = device.last_telemetry or {}
            self._mark_seen(device, received_at, payload.uptime_s)
            device.reported_online = True
            if payload.rssi is not None:
                device.rssi = payload.rssi

            evaluations = self._run_anomaly_detection(device, payload, received_at)
            scores = [abs(e.z) for e in evaluations if e.z is not None]
            anomaly_score = round(max(scores), 2) if scores else None

            stored = self._should_store(device, payload, previous, received_at)
            if stored:
                self.telemetry.add(self._reading_from(device, payload, received_at, anomaly_score))
                device.last_stored_at = received_at

            snapshot = payload.snapshot()
            snapshot["anomaly_score"] = anomaly_score
            device.last_telemetry = snapshot
            device.last_telemetry_at = received_at

            self._clear_analysis_alert(device, "CONTACT_LOST", received_at, note="Contact restored")
            assessment = self._refresh_risk(device, received_at)
        return {
            "device_code": payload.device_code,
            "stored": stored,
            "anomalies": [e.metric for e in evaluations if e.is_anomaly],
            "risk_score": assessment.score,
        }

    def _run_anomaly_detection(self, device: Device, payload: TelemetryPayload,
                               now: datetime) -> list[MetricEvaluation]:
        metrics = {name: value for name, value in payload.metrics().items() if name in METRIC_SPECS}
        if not metrics:
            return []
        persist = self._cfg("ANALYSIS_PERSIST_READINGS")
        rows = self.baselines.for_device(device.device_id)
        evaluations = []
        for name, value in metrics.items():
            row = self.baselines.get_or_create(device.device_id, name, rows)
            state = BaselineState(row.mean or 0.0, row.variance or 0.0, row.samples or 0,
                                  row.consecutive_anomalies or 0)
            evaluation = self.anomaly_detector.evaluate(name, value, state)
            row.mean, row.variance = state.mean, state.variance
            row.samples, row.consecutive_anomalies = state.samples, state.consecutive
            row.last_value = value
            row.last_z = evaluation.z
            if evaluation.is_anomaly:
                row.last_anomaly_at = now
            evaluations.append(evaluation)

            spec = METRIC_SPECS[name]
            if state.consecutive >= persist:
                unit = _METRIC_UNITS.get(name, "")
                self._raise_analysis_alert(
                    device, spec.alert_type, now,
                    value=value,
                    message=(f"{name} = {value:.2f}{unit}, usual {evaluation.baseline_mean:.2f}"
                             f" ± {evaluation.baseline_std:.2f}{unit} (z = {evaluation.z:.1f})"),
                    context={
                        "metric": name,
                        "z": round(evaluation.z, 2),
                        "baseline_mean": round(evaluation.baseline_mean, 3),
                        "baseline_std": round(evaluation.baseline_std, 3),
                        "consecutive": state.consecutive,
                    },
                )
            elif state.consecutive == 0:
                self._clear_analysis_alert(device, spec.alert_type, now, note=f"{name} back within baseline")
        return evaluations

    def _should_store(self, device: Device, payload: TelemetryPayload, previous: dict, now: datetime) -> bool:
        """Down-sample history to protect the Supabase free-tier storage,
        but never drop a sample where the alert picture changed."""
        if device.last_stored_at is None or payload.prealert:
            return True
        if payload.alert_mask != (previous.get("alert_mask") or 0):
            return True
        interval = self._cfg("TELEMETRY_STORE_MIN_INTERVAL_S")
        return (now - device.last_stored_at).total_seconds() >= interval - 0.5

    @staticmethod
    def _reading_from(device: Device, p: TelemetryPayload, now: datetime, anomaly_score) -> TelemetryReading:
        return TelemetryReading(
            device_id=device.device_id,
            recorded_at=now,
            device_ts=p.device_ts,
            seq=p.seq,
            uptime_s=p.uptime_s,
            vest_temp_c=p.vest_temp_c,
            tilt_deg=p.tilt_deg,
            posture=p.posture,
            activity_g=p.activity_g,
            peak_g=p.peak_g,
            still_s=p.still_s,
            rssi=p.rssi,
            alert_mask=p.alert_mask,
            prealert=p.prealert,
            heart_rate=p.heart_rate,
            spo2=p.spo2,
            skin_temp_c=p.skin_temp_c,
            lat=p.lat,
            lng=p.lng,
            radiation_usvh=p.radiation_usvh,
            radiation_dose_usv=p.radiation_dose_usv,
            battery_pct=p.battery_pct,
            anomaly_score=anomaly_score,
        )
