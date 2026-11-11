"""METRIC_BASELINE — the learned "normal" of one metric for one wearer.

Persisted (not kept in memory) because the Render free plan restarts and
sleeps the API; the AI analysis must not forget what normal looks like.
"""
from app.extensions import db
from app.models.base_model import BigIntPK, UTCDateTime, UUIDType, iso, utcnow


class MetricBaseline(db.Model):
    __tablename__ = "metric_baselines"
    __table_args__ = (db.UniqueConstraint("device_id", "metric", name="uq_metric_baselines_device_metric"),)

    baseline_id = db.Column(BigIntPK, primary_key=True, autoincrement=True)
    device_id = db.Column(UUIDType, db.ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False)
    metric = db.Column(db.String(32), nullable=False)
    mean = db.Column(db.Float, nullable=False, default=0.0)
    variance = db.Column(db.Float, nullable=False, default=0.0)
    samples = db.Column(db.Integer, nullable=False, default=0)
    consecutive_anomalies = db.Column(db.Integer, nullable=False, default=0)
    last_value = db.Column(db.Float, nullable=True)
    last_z = db.Column(db.Float, nullable=True)
    last_anomaly_at = db.Column(UTCDateTime(), nullable=True)
    updated_at = db.Column(UTCDateTime(), nullable=False, default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict:
        return {
            "metric": self.metric,
            "mean": round(self.mean, 4),
            "std": round(self.variance ** 0.5, 4) if self.variance > 0 else 0.0,
            "samples": self.samples,
            "consecutive_anomalies": self.consecutive_anomalies,
            "last_value": self.last_value,
            "last_z": round(self.last_z, 2) if self.last_z is not None else None,
            "last_anomaly_at": iso(self.last_anomaly_at),
            "updated_at": iso(self.updated_at),
        }
