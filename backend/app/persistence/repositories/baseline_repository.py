"""Data access for METRIC_BASELINE."""
from app.extensions import db
from app.models.metric_baseline import MetricBaseline


class BaselineRepository:
    def for_device(self, device_id: str) -> dict[str, MetricBaseline]:
        rows = db.session.query(MetricBaseline).filter(MetricBaseline.device_id == device_id).all()
        return {row.metric: row for row in rows}

    def get_or_create(self, device_id: str, metric: str, existing: dict[str, MetricBaseline]) -> MetricBaseline:
        row = existing.get(metric)
        if row is None:
            row = MetricBaseline(device_id=device_id, metric=metric, mean=0.0, variance=0.0, samples=0,
                                 consecutive_anomalies=0)
            db.session.add(row)
            existing[metric] = row
        return row

    def list_all(self) -> list[MetricBaseline]:
        return db.session.query(MetricBaseline).all()
