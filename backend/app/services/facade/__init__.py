"""StaFacade — the single entry point into the business layer.

Callers (REST namespaces in ``app/api/v1`` and the MQTT dispatcher in
``app/messaging``) never touch repositories, analysis services or providers
directly. They call one facade method per use case; the facade coordinates:

  * repositories   — OperatorRepository, PersonnelRepository, DeviceRepository,
                     TelemetryRepository, AlertRepository, CommandRepository,
                     BaselineRepository (persistence layer)
  * AI analysis    — AnomalyDetector, RiskEngine, alert priority, shielding model
  * providers      — CommandPublisher (MQTT today, swappable)

The use cases live in per-domain mixins (single responsibility); this class
only wires the collaborators together.
"""
from flask import current_app

from app.persistence.repositories import (
    AlertRepository,
    BaselineRepository,
    CommandRepository,
    DeviceRepository,
    OperatorRepository,
    PersonnelRepository,
    TelemetryRepository,
)
from app.services.analysis import AnomalyDetector, RiskEngine
from app.services.facade.alerts import AlertFacadeMixin
from app.services.facade.analysis import AnalysisFacadeMixin
from app.services.facade.armor import ArmorFacadeMixin
from app.services.facade.auth import AuthFacadeMixin
from app.services.facade.commands import CommandFacadeMixin
from app.services.facade.core import FacadeCoreMixin
from app.services.facade.devices import DeviceFacadeMixin
from app.services.facade.errors import FacadeError
from app.services.facade.maintenance import MaintenanceFacadeMixin
from app.services.facade.operators import OperatorFacadeMixin
from app.services.facade.overview import OverviewFacadeMixin
from app.services.facade.personnel import PersonnelFacadeMixin
from app.services.facade.status import StatusFacadeMixin
from app.services.facade.telemetry import TelemetryFacadeMixin
from app.services.providers import CommandPublisher, NullCommandPublisher
from app.utils.rate_limit import LoginRateLimiter

__all__ = ["FacadeError", "StaFacade", "get_facade"]

EXTENSION_KEY = "sta.facade"


class StaFacade(
    FacadeCoreMixin,
    AuthFacadeMixin,
    OperatorFacadeMixin,
    PersonnelFacadeMixin,
    DeviceFacadeMixin,
    TelemetryFacadeMixin,
    AlertFacadeMixin,
    CommandFacadeMixin,
    StatusFacadeMixin,
    OverviewFacadeMixin,
    AnalysisFacadeMixin,
    ArmorFacadeMixin,
    MaintenanceFacadeMixin,
):
    def __init__(self, config, publisher: CommandPublisher | None = None):
        self.operators = OperatorRepository()
        self.personnel = PersonnelRepository()
        self.devices = DeviceRepository()
        self.telemetry = TelemetryRepository()
        self.alerts = AlertRepository()
        self.commands = CommandRepository()
        self.baselines = BaselineRepository()

        self.anomaly_detector = AnomalyDetector(
            z_threshold=config["ANALYSIS_Z_THRESHOLD"],
            warmup_samples=config["ANALYSIS_WARMUP_SAMPLES"],
            alpha=config["ANALYSIS_EWMA_ALPHA"],
        )
        self.risk_engine = RiskEngine()
        self.login_limiter = LoginRateLimiter(config["LOGIN_MAX_ATTEMPTS"], config["LOGIN_LOCKOUT_SECONDS"])
        self.publisher: CommandPublisher = publisher or NullCommandPublisher()
        self.gateway = None  # set by app.runtime when MQTT is enabled (health reporting)


def get_facade() -> StaFacade:
    """The facade bound to the current Flask app (one per app instance)."""
    return current_app.extensions[EXTENSION_KEY]
