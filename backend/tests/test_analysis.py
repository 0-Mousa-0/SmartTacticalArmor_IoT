"""Unit tests for the AI analysis layer (pure functions, no app context)."""
import math

import pytest

from app.models.enums import RiskLevel
from app.services.analysis import (
    AnomalyDetector,
    BaselineState,
    OpenAlertView,
    RiskEngine,
    RiskInputs,
    compute_priority,
    shielding,
)


# ── anomaly detection ───────────────────────────────────────
def _warm(detector, metric, values, state=None):
    state = state or BaselineState()
    return [detector.evaluate(metric, v, state) for v in values], state


def test_no_anomaly_is_flagged_during_warm_up():
    detector = AnomalyDetector(warmup_samples=10)
    results, _ = _warm(detector, "vest_temp_c", [31, 31, 31, 45, 31, 31])
    assert not any(r.is_anomaly for r in results)
    assert all(r.warming_up for r in results)


def test_upward_spike_is_detected_after_warm_up():
    detector = AnomalyDetector(warmup_samples=10)
    _, state = _warm(detector, "vest_temp_c", [31.0, 31.1, 30.9, 31.0] * 3)
    spike = detector.evaluate("vest_temp_c", 34.0, state)
    assert spike.is_anomaly
    assert spike.z == pytest.approx((34.0 - spike.baseline_mean) / 0.4, rel=1e-6)  # noise floor applies
    assert state.consecutive == 1


def test_downward_change_ignored_for_upward_metric():
    detector = AnomalyDetector(warmup_samples=10)
    _, state = _warm(detector, "vest_temp_c", [31.0] * 12)
    assert not detector.evaluate("vest_temp_c", 20.0, state).is_anomaly


def test_spo2_drop_is_anomalous():
    detector = AnomalyDetector(warmup_samples=10)
    _, state = _warm(detector, "spo2", [98, 97, 98, 99] * 3)
    assert detector.evaluate("spo2", 88, state).is_anomaly


def test_anomalies_barely_move_the_baseline():
    detector = AnomalyDetector(warmup_samples=10, alpha=0.05)
    _, state = _warm(detector, "vest_temp_c", [31.0] * 12)
    before = state.mean
    detector.evaluate("vest_temp_c", 40.0, state)
    assert state.mean - before == pytest.approx(0.05 * 0.2 * (40.0 - before))


def test_consecutive_counter_resets():
    detector = AnomalyDetector(warmup_samples=10)
    _, state = _warm(detector, "activity_g", [0.01, 0.02] * 6)
    detector.evaluate("activity_g", 1.0, state)
    detector.evaluate("activity_g", 1.0, state)
    assert state.consecutive == 2
    detector.evaluate("activity_g", 0.015, state)
    assert state.consecutive == 0


# ── risk engine ─────────────────────────────────────────────
def test_quiet_wearer_is_normal():
    result = RiskEngine().assess(RiskInputs(posture="upright", still_s=0, vest_temp_c=31))
    assert result.score == 0
    assert result.level == RiskLevel.NORMAL


def test_sos_is_critical():
    result = RiskEngine().assess(RiskInputs(open_alerts=(OpenAlertView("SOS", "critical", "open"),)))
    assert result.score == 100
    assert result.level == RiskLevel.CRITICAL
    assert result.factors[0].code == "alert:SOS"


def test_lost_contact_and_lying_still_raise_risk():
    result = RiskEngine().assess(RiskInputs(connected=False, posture="lying", still_s=120))
    assert result.level in (RiskLevel.HIGH, RiskLevel.CRITICAL)
    codes = {factor.code for factor in result.factors}
    assert {"contact_lost", "posture:lying", "immobile"} <= codes


def test_acknowledged_alert_counts_less():
    engine = RiskEngine()
    open_ = engine.assess(RiskInputs(open_alerts=(OpenAlertView("IMPACT", "warning", "open"),)))
    acked = engine.assess(RiskInputs(open_alerts=(OpenAlertView("IMPACT", "warning", "acknowledged"),)))
    assert acked.score < open_.score


# ── alert priority ──────────────────────────────────────────
def test_priority_orders_by_danger_and_handling():
    sos = compute_priority("SOS", "critical", "open")
    fall_acked = compute_priority("FALL", "critical", "acknowledged")
    temp_warn = compute_priority("VEST_TEMP_HIGH", "warning", "open")
    closed = compute_priority("SOS", "critical", "resolved")
    assert sos == 100
    assert sos > fall_acked > closed
    assert temp_warn < sos


def test_unacknowledged_alert_climbs_with_age():
    assert compute_priority("NO_MOTION", "warning", "open", age_s=300) == \
        compute_priority("NO_MOTION", "warning", "open") + 10


# ── shielding model (team's lab data) ───────────────────────
def test_transmission_follows_beer_lambert():
    result = shielding.estimate("bi2o3", "cs137", 8.333, 1.0, incident_dose_usvh=10.0)
    assert result["transmission"] == pytest.approx(math.exp(-1.0), rel=1e-5)
    assert result["hvl_cm"] == pytest.approx(math.log(2), rel=1e-3)
    assert result["transmitted_dose_usvh"] == pytest.approx(10 * math.exp(-1.0), rel=1e-3)
    assert result["approximate"] is False


def test_bi2o3_outperforms_pbo_and_mgo_for_xrays():
    mus = {m: shielding.linear_attenuation(m, "xray", 8.333) for m in ("bi2o3", "pbo", "mgo")}
    assert mus["bi2o3"] > mus["pbo"] > mus["mgo"]


def test_unmeasured_concentration_is_rejected():
    with pytest.raises(ValueError):
        shielding.estimate("bi2o3", "xray", 5.0, 1.0)
