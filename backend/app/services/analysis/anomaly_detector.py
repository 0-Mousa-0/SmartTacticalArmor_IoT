"""AI analysis — explainable online anomaly detection.

For every wearer and every metric the detector learns what "normal" looks
like (an exponentially weighted mean and variance) and scores each new
sample with a z-score against that personal baseline:

    z = (x - mean) / max(std, min_std)

* Warm-up: the first N samples only build the baseline (Welford's method).
* Direction: temperature only matters when it rises, SpO2 when it drops.
* ``min_std`` is a noise floor so a very steady signal cannot produce huge
  z-scores from tiny, physically meaningless changes.
* Anomalous samples only nudge the mean (at a fifth of the normal rate) and
  never widen the spread. Letting them inflate the variance would make a
  sustained abnormal shift look "normal" after ~15 readings; this way it
  stays flagged for ~150 readings (≈12 min at 5 s) before the baseline
  accepts it as the wearer's new normal (slow concept drift).

The method is deliberately simple, cheap (O(1) per sample) and explainable:
every finding can be shown to an operator as "value, usual value, how many
standard deviations away". It needs no training data, which Phase 1 does
not have yet; a trained model can replace it behind the same interface.
"""
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class MetricSpec:
    name: str
    direction: str      # "up" | "down" | "both"
    min_std: float      # noise floor, in the metric's unit
    alert_type: str     # analysis alert raised when the anomaly persists


METRIC_SPECS: dict[str, MetricSpec] = {
    spec.name: spec
    for spec in (
        MetricSpec("vest_temp_c", "up", 0.4, "TEMP_ANOMALY"),
        MetricSpec("activity_g", "up", 0.03, "ACTIVITY_ANOMALY"),
        MetricSpec("heart_rate", "both", 4.0, "HR_ANOMALY"),
        MetricSpec("spo2", "down", 1.0, "SPO2_ANOMALY"),
        MetricSpec("skin_temp_c", "both", 0.3, "SKIN_TEMP_ANOMALY"),
        MetricSpec("radiation_usvh", "up", 0.05, "RADIATION_ANOMALY"),
    )
}


@dataclass
class BaselineState:
    """Mutable learning state for one metric of one wearer."""
    mean: float = 0.0
    variance: float = 0.0
    samples: int = 0
    consecutive: int = 0  # consecutive anomalous samples

    @property
    def std(self) -> float:
        return math.sqrt(self.variance) if self.variance > 0 else 0.0


@dataclass(frozen=True)
class MetricEvaluation:
    metric: str
    value: float
    z: float | None
    baseline_mean: float
    baseline_std: float
    is_anomaly: bool
    warming_up: bool


class AnomalyDetector:
    def __init__(self, z_threshold: float = 3.0, warmup_samples: int = 30, alpha: float = 0.05,
                 anomaly_weight: float = 0.2):
        if not 0 < alpha < 1:
            raise ValueError("alpha must be between 0 and 1")
        self.z_threshold = z_threshold
        self.warmup_samples = max(2, warmup_samples)
        self.alpha = alpha
        self.anomaly_weight = anomaly_weight

    def evaluate(self, metric: str, value: float, state: BaselineState) -> MetricEvaluation:
        """Score ``value`` against ``state`` and then learn from it (in place)."""
        spec = METRIC_SPECS[metric]
        warming_up = state.samples < self.warmup_samples
        mean_before, std_before = state.mean, state.std

        z = None
        is_anomaly = False
        if state.samples >= 2:
            z = (value - state.mean) / max(state.std, spec.min_std)
            if not warming_up:
                if spec.direction == "up":
                    is_anomaly = z > self.z_threshold
                elif spec.direction == "down":
                    is_anomaly = z < -self.z_threshold
                else:
                    is_anomaly = abs(z) > self.z_threshold

        self._learn(state, value, is_anomaly, warming_up)
        state.consecutive = state.consecutive + 1 if is_anomaly else 0
        return MetricEvaluation(metric, value, z, mean_before, std_before, is_anomaly, warming_up)

    def _learn(self, state: BaselineState, x: float, is_anomaly: bool, warming_up: bool) -> None:
        if warming_up or state.samples < 2:
            # Welford's online algorithm (population variance).
            n = state.samples + 1
            delta = x - state.mean
            mean = state.mean + delta / n
            m2 = state.variance * state.samples + delta * (x - mean)
            state.mean, state.variance, state.samples = mean, m2 / n, n
            return
        delta = x - state.mean
        if is_anomaly:
            # Robust update: drift the mean slowly, keep the spread as learned.
            state.mean += self.alpha * self.anomaly_weight * delta
            state.samples += 1
            return
        # Exponentially weighted mean / variance (Finch, 2009).
        state.mean += self.alpha * delta
        state.variance = (1 - self.alpha) * (state.variance + self.alpha * delta * delta)
        state.samples += 1
