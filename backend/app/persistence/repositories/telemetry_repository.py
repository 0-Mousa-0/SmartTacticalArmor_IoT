"""Data access for TELEMETRY_READING."""
from datetime import datetime

from app.extensions import db
from app.models.telemetry_reading import TelemetryReading


class TelemetryRepository:
    def add(self, reading: TelemetryReading) -> TelemetryReading:
        db.session.add(reading)
        return reading

    def history(self, device_id: str, since: datetime, limit: int = 720) -> list[TelemetryReading]:
        """Readings since ``since``, oldest first (chart order).

        Selects the newest ``limit`` rows then reverses them, so a long
        window is truncated at its old end rather than its recent end.
        """
        rows = (
            db.session.query(TelemetryReading)
            .filter(TelemetryReading.device_id == device_id, TelemetryReading.recorded_at >= since)
            .order_by(TelemetryReading.recorded_at.desc())
            .limit(limit)
            .all()
        )
        rows.reverse()
        return rows

    def count_since(self, device_id: str, since: datetime) -> int:
        return (
            db.session.query(TelemetryReading)
            .filter(TelemetryReading.device_id == device_id, TelemetryReading.recorded_at >= since)
            .count()
        )

    def purge_older_than(self, cutoff: datetime) -> int:
        return (
            db.session.query(TelemetryReading)
            .filter(TelemetryReading.recorded_at < cutoff)
            .delete(synchronize_session=False)
        )
