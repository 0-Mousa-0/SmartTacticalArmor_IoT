"""AI analysis — wearer risk assessment ("wearer status").

Fuses everything known about one field member into a single 0-100 risk
score plus the list of factors that produced it, so the operations room
can rank people by urgency and see *why* someone is ranked high.

Score = strongest open incident
      + 15 % of the remaining incidents (capped at 20)
      + context factors (pre-alert, lost contact, lying posture,
        immobility, heat, active anomalies)
clamped to 0..100.
"""
from dataclasses import dataclass

from app.models.alert_catalog import ALERT_CATALOG
from app.models.enums import RiskLevel

SEVERITY_WEIGHT = {"critical": 1.0, "warning": 0.6, "info": 0.3}
LEVEL_THRESHOLDS = ((75, RiskLevel.CRITICAL), (50, RiskLevel.HIGH), (20, RiskLevel.ELEVATED))


@dataclass(frozen=True)
class OpenAlertView:
    alert_type: str
    severity: str
    status: str


@dataclass(frozen=True)
class RiskInputs:
    open_alerts: tuple[OpenAlertView, ...] = ()
    connected: bool = True
    has_telemetry: bool = True
    prealert: bool = False
    posture: str | None = None
    still_s: int | None = None
    vest_temp_c: float | None = None
    anomalous_metrics: tuple[str, ...] = ()


@dataclass(frozen=True)
class RiskFactor:
    code: str
    points: int
    detail: str | None = None

    def to_dict(self) -> dict:
        return {"code": self.code, "points": self.points, "detail": self.detail}


@dataclass(frozen=True)
class RiskAssessment:
    score: int
    level: RiskLevel
    factors: tuple[RiskFactor, ...]


def level_for(score: int) -> RiskLevel:
    for threshold, level in LEVEL_THRESHOLDS:
        if score >= threshold:
            return level
    return RiskLevel.NORMAL


class RiskEngine:
    def assess(self, inputs: RiskInputs) -> RiskAssessment:
        factors: list[RiskFactor] = []

        alert_scores = sorted(
            ((self._alert_points(view), view) for view in inputs.open_alerts),
            key=lambda item: item[0],
            reverse=True,
        )
        if alert_scores:
            top_points, top = alert_scores[0]
            factors.append(RiskFactor(f"alert:{top.alert_type}", round(top_points), top.severity))
            secondary = min(20.0, 0.15 * sum(points for points, _ in alert_scores[1:]))
            if secondary >= 1:
                factors.append(RiskFactor("alerts:additional", round(secondary), str(len(alert_scores) - 1)))

        if inputs.prealert:
            factors.append(RiskFactor("prealert", 30))
        if inputs.has_telemetry and not inputs.connected:
            factors.append(RiskFactor("contact_lost", 30))
        if inputs.posture == "lying":
            factors.append(RiskFactor("posture:lying", 15))
        elif inputs.posture == "bent":
            factors.append(RiskFactor("posture:bent", 5))
        if inputs.still_s is not None and inputs.still_s >= 30:
            factors.append(RiskFactor("immobile", round(min(20.0, 10 + (inputs.still_s - 30) / 9)),
                                      str(inputs.still_s)))
        if inputs.vest_temp_c is not None:
            if inputs.vest_temp_c >= 45:
                factors.append(RiskFactor("heat:severe", 15, f"{inputs.vest_temp_c:.1f}"))
            elif inputs.vest_temp_c >= 40:
                factors.append(RiskFactor("heat", 8, f"{inputs.vest_temp_c:.1f}"))
        for metric in inputs.anomalous_metrics[:2]:
            factors.append(RiskFactor(f"anomaly:{metric}", 10))

        score = max(0, min(100, round(sum(factor.points for factor in factors))))
        return RiskAssessment(score=score, level=level_for(score), factors=tuple(factors))

    @staticmethod
    def _alert_points(view: OpenAlertView) -> float:
        info = ALERT_CATALOG.get(view.alert_type)
        base = info.base_priority if info else 40
        points = base * SEVERITY_WEIGHT.get(view.severity, 0.3)
        if view.status == "acknowledged":
            points *= 0.8  # help is on the way, but the person is not safe yet
        return points
