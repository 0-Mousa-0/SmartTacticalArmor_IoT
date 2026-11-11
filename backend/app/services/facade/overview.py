"""Command-centre overview and system health."""
from collections import Counter

from sqlalchemy import text

from app.extensions import db
from app.models.base_model import iso, utcnow


class OverviewFacadeMixin:
    def get_overview(self) -> dict:
        now = utcnow()
        devices = self.devices.list()
        open_alerts = self.alerts.all_open()
        grouped: dict[str, list] = {}
        for alert in open_alerts:
            grouped.setdefault(alert.device_id, []).append(alert)
        units = [self._device_view(d, now, grouped.get(d.device_id, [])) for d in devices]

        severities = Counter(alert.severity for alert in open_alerts)
        online = [u for u in units if u["connection"] == "online"]
        risks = [u["risk"]["score"] for u in units if u["connection"] != "never"]
        kpis = {
            "units_total": len(units),
            "units_online": len(online),
            "units_offline": len(units) - len(online),
            "units_simulated": sum(1 for u in units if u["is_simulated"]),
            "personnel_assigned": sum(1 for u in units if u["personnel"]),
            "alerts_open": len(open_alerts),
            "alerts_critical": severities.get("critical", 0),
            "alerts_warning": severities.get("warning", 0),
            "alerts_pending": sum(1 for a in open_alerts if a.status == "pending"),
            "risk_average": round(sum(risks) / len(risks)) if risks else 0,
            "risk_max": max(risks) if risks else 0,
        }
        queue = sorted(units, key=lambda u: (u["risk"]["score"], len(u["open_alerts"])), reverse=True)
        top_alerts = sorted(open_alerts, key=lambda a: (a.priority, a.last_event_at), reverse=True)[:8]
        return {
            "generated_at": iso(now),
            "kpis": kpis,
            "units": units,
            "priority_queue": [u["device_id"] for u in queue[:5]],
            "alerts": [alert.to_dict() for alert in top_alerts],
            "system": self.system_health(),
        }

    def system_health(self) -> dict:
        try:
            db.session.execute(text("SELECT 1"))
            database = "ok"
        except Exception:  # noqa: BLE001 — health endpoint must never raise
            db.session.rollback()
            database = "error"
        gateway = getattr(self, "gateway", None)
        return {
            "status": "ok" if database == "ok" else "degraded",
            "database": database,
            "mqtt": gateway.health() if gateway else {"enabled": False, "connected": False},
            "version": self._cfg("API_VERSION"),
            "time": iso(utcnow()),
        }
