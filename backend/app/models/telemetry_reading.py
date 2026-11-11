"""TELEMETRY_READING — one stored sample of a vest's sensor data.

Columns for Phase-2+ sensors (vitals, GPS, radiation, battery) are nullable
so the schema already matches the full Smart Tactical Armor concept; they
stay NULL until those sensors are fitted to the vest.
"""
from app.extensions import db
from app.models.base_model import BigIntPK, UTCDateTime, UUIDType, iso, utcnow


class TelemetryReading(db.Model):
    __tablename__ = "telemetry_readings"
    __table_args__ = (db.Index("ix_telemetry_device_time", "device_id", "recorded_at"),)

    reading_id = db.Column(BigIntPK, primary_key=True, autoincrement=True)
    device_id = db.Column(UUIDType, db.ForeignKey("devices.device_id", ondelete="CASCADE"), nullable=False)
    recorded_at = db.Column(UTCDateTime(), nullable=False, default=utcnow)  # server receive time
    device_ts = db.Column(UTCDateTime(), nullable=True)                   # vest NTP clock, if synced
    seq = db.Column(db.Integer, nullable=True)
    uptime_s = db.Column(db.Integer, nullable=True)

    # Phase 1 — MPU-6050 IMU + its on-die temperature sensor
    vest_temp_c = db.Column(db.Float, nullable=True)
    tilt_deg = db.Column(db.Float, nullable=True)
    posture = db.Column(db.String(10), nullable=True)
    activity_g = db.Column(db.Float, nullable=True)
    peak_g = db.Column(db.Float, nullable=True)
    still_s = db.Column(db.Integer, nullable=True)
    rssi = db.Column(db.Integer, nullable=True)
    alert_mask = db.Column(db.Integer, nullable=False, default=0)
    prealert = db.Column(db.Boolean, nullable=False, default=False)

    # Phase 2+ — vitals, GPS, radiation, battery
    heart_rate = db.Column(db.Integer, nullable=True)
    spo2 = db.Column(db.Integer, nullable=True)
    skin_temp_c = db.Column(db.Float, nullable=True)
    lat = db.Column(db.Float, nullable=True)
    lng = db.Column(db.Float, nullable=True)
    radiation_usvh = db.Column(db.Float, nullable=True)
    radiation_dose_usv = db.Column(db.Float, nullable=True)
    battery_pct = db.Column(db.Integer, nullable=True)

    # AI analysis: largest |z-score| of this sample against the wearer baseline
    anomaly_score = db.Column(db.Float, nullable=True)

    def to_dict(self) -> dict:
        return {
            "t": iso(self.recorded_at),
            "seq": self.seq,
            "vest_temp_c": self.vest_temp_c,
            "tilt_deg": self.tilt_deg,
            "posture": self.posture,
            "activity_g": self.activity_g,
            "peak_g": self.peak_g,
            "still_s": self.still_s,
            "rssi": self.rssi,
            "alert_mask": self.alert_mask,
            "prealert": self.prealert,
            "heart_rate": self.heart_rate,
            "spo2": self.spo2,
            "skin_temp_c": self.skin_temp_c,
            "lat": self.lat,
            "lng": self.lng,
            "radiation_usvh": self.radiation_usvh,
            "radiation_dose_usv": self.radiation_dose_usv,
            "battery_pct": self.battery_pct,
            "anomaly_score": self.anomaly_score,
        }
