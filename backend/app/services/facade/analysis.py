"""Read models for the AI-analysis page (transparent, explainable output)."""
from app.models.base_model import utcnow
from app.services.analysis import LEVEL_THRESHOLDS, METRIC_SPECS


class AnalysisFacadeMixin:
    def get_analysis_summary(self) -> dict:
        now = utcnow()
        baselines: dict[str, list] = {}
        for row in self.baselines.list_all():
            baselines.setdefault(row.device_id, []).append(row.to_dict())
        units = []
        for device in self.devices.list():
            units.append({
                "device_id": device.device_id,
                "device_code": device.device_code,
                "is_simulated": device.is_simulated,
                "personnel": device.personnel.summary() if device.personnel else None,
                "connection": self._connection_state(device, now),
                "risk": {"score": device.risk_score, "level": device.risk_level,
                         "factors": device.risk_reasons or []},
                "baselines": sorted(baselines.get(device.device_id, []), key=lambda b: b["metric"]),
            })
        units.sort(key=lambda u: u["risk"]["score"], reverse=True)
        return {
            "model": self.analysis_model_card(),
            "units": units,
            "findings": [alert.to_dict() for alert in self.alerts.recent_analysis(25)],
        }

    def analysis_model_card(self) -> dict:
        detector = self.anomaly_detector
        return {
            "anomaly_detection": {
                "method": "per-wearer online baseline (Welford warm-up, then EWMA mean/variance) + z-score",
                "z_threshold": detector.z_threshold,
                "warmup_samples": detector.warmup_samples,
                "ewma_alpha": detector.alpha,
                "persist_readings": self._cfg("ANALYSIS_PERSIST_READINGS"),
                "metrics": [
                    {"metric": s.name, "direction": s.direction, "min_std": s.min_std, "alert_type": s.alert_type}
                    for s in METRIC_SPECS.values()
                ],
            },
            "risk_model": {
                "levels": [{"min_score": threshold, "level": level.value} for threshold, level in LEVEL_THRESHOLDS],
                "factors": ["open incidents (type x severity)", "pre-alert", "contact lost", "posture",
                            "immobility", "heat", "active anomalies"],
            },
            "priority_model": "base(type) x severity x status + age boost (max +10 after 5 min)",
        }
