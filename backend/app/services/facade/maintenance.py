"""Periodic housekeeping (runs every HOUSEKEEPING_INTERVAL_S in a
background thread next to the MQTT gateway)."""
from datetime import datetime, timedelta

from app.models.base_model import iso, utcnow
from app.models.enums import CommandStatus, Severity


class MaintenanceFacadeMixin:
    _last_purge_at: datetime | None = None

    def run_housekeeping(self, now: datetime | None = None) -> dict:
        now = now or utcnow()
        summary = {"commands_timed_out": 0, "contact_lost": 0, "purged_readings": 0}
        with self.transaction():
            # 1. commands the vest never answered
            cutoff = now - timedelta(seconds=self._cfg("COMMAND_TIMEOUT_S"))
            for command in self.commands.stale_sent(cutoff):
                command.status = CommandStatus.TIMEOUT.value
                command.completed_at = now
                command.response_info = "No response from the vest"
                summary["commands_timed_out"] += 1

            # 2. lost contact with a field member is itself a safety alert
            lookback = now - timedelta(hours=self._cfg("CONTACT_LOST_LOOKBACK_H"))
            for device in self.devices.list():
                if device.last_seen_at is None or device.last_seen_at < lookback:
                    continue
                silent_s = (now - device.last_seen_at).total_seconds()
                threshold = max(self._cfg("CONTACT_LOST_AFTER_S"), 3 * device.telemetry_interval_s)
                if self._cfg("CONTACT_LOST_ALERTS") and silent_s >= threshold:
                    if self.alerts.find_open(device.device_id, "CONTACT_LOST") is None:
                        summary["contact_lost"] += 1
                    self._raise_analysis_alert(
                        device, "CONTACT_LOST", now, severity=Severity.WARNING, value=round(silent_s),
                        message=f"No data from {device.device_code} for {int(silent_s)} s",
                        context={"last_seen_at": iso(device.last_seen_at)},
                    )
                self._refresh_risk(device, now)

            # 3. unacknowledged incidents climb the queue as they age
            for alert in self.alerts.all_open():
                self._reprioritize(alert, now)

            # 4. retention: keep the Supabase free tier within its storage quota
            if self._last_purge_at is None or now - self._last_purge_at >= timedelta(hours=1):
                retention = timedelta(days=self._cfg("TELEMETRY_RETENTION_DAYS"))
                summary["purged_readings"] = self.telemetry.purge_older_than(now - retention)
                self._last_purge_at = now
        return summary
