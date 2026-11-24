import type { Posture } from '@/shared/domain/types';
import { approach, clamp, round, wander, type Rng } from './random';

export type Environment = 'indoor' | 'outdoor';
export type Routine = 'post' | 'guard' | 'patrol';

/** What a wearer is doing right now: the daily routine, or a scripted story. */
export interface Drivers {
  /** dynamic acceleration target (g); null = the routine decides */
  activity: number | null;
  posture: Posture;
  /** torso tilt target (°); null = natural for the posture */
  tilt: number | null;
  /** extra heart rate from stress (bpm) */
  stress: number;
  /** °C added to the air around the wearer (a fire nearby) */
  heat: number;
  /** SpO₂ points lost to smoke */
  smoke: number;
  /** motionless: not even the small movements that reset the vest's "still" timer */
  still: boolean;
}

export const ROUTINE_DRIVERS: Drivers = { activity: null, posture: 'upright', tilt: null, stress: 0, heat: 0, smoke: 0, still: false };

/** One wearer's constants. */
export interface Profile {
  routine: Routine;
  environment: Environment;
  restingBpm: number;
  spo2: number;
  /** upright torso tilt (°) */
  tilt: number;
  rssi: number;
}

/** Activity of each routine (g) and how often a still wearer still shifts a little (per second). */
const ROUTINE: Record<Routine, { mean: number; sd: number; fidget: number }> = {
  post: { mean: 0.055, sd: 0.012, fidget: 0.2 },
  guard: { mean: 0.048, sd: 0.01, fidget: 0.22 },
  patrol: { mean: 0.15, sd: 0.02, fidget: 1 },
};

// Riyadh: monthly mean air temperature and half the day-night swing (°C).
const MONTH_MEAN = [14.5, 17, 21.5, 26.5, 32.5, 35.5, 37, 36.5, 33, 28, 21, 16];
const MONTH_SWING = [7, 7.5, 7.5, 7.5, 8, 8, 8, 8, 8, 7.5, 7, 6.5];

/** The MPU-6050 die sits inside the vest: it reads a few degrees above the air (self-heating, body heat). */
export const SELF_HEATING_C = 3.4;

/** Air around the wearer in Riyadh (UTC+3): warmest at 15:00, plus sun outdoors by day. */
export function airTemperature(epochMs: number, environment: Environment): number {
  const local = new Date(epochMs + 3 * 3_600_000);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  const daily = Math.cos((2 * Math.PI * (hour - 15)) / 24);
  if (environment === 'indoor') return 24.4 + 0.6 * daily;
  const month = local.getUTCMonth();
  const sun = hour > 6 && hour < 18 ? 2.2 * Math.sin((Math.PI * (hour - 6)) / 12) : 0;
  // On summer duty the units keep to shade and vehicles: routine readings stay under the 45 °C alarm.
  return Math.min(MONTH_MEAN[month] + MONTH_SWING[month] * daily, 35) + sun;
}

export interface BodyReading {
  heartRate: number;
  spo2: number;
  vestTempC: number;
  activityG: number;
  tiltDeg: number;
  posture: Posture;
  stillS: number;
  peakG: number;
  rssi: number;
}

/**
 * One wearer: movement drives the heart rate (the firmware simulator's model,
 * rest + 90·(1 − e^(−activity/0.4)), rising with τ 15 s, recovering with τ 35 s),
 * exertion and smoke lower SpO₂, and the vest's sensor follows the air temperature.
 */
export class Body {
  private level: number;
  private activity: number;
  private shownActivity: number;
  private tilt: number;
  private shownTilt: number;
  private hr: number;
  private hrWander = 0;
  private spo2: number;
  private temp: number;
  private stress = 0;
  private heat = 0;
  private smoke = 0;
  private still = 0;
  private peak = 1;
  private rssi: number;

  constructor(
    private readonly rng: Rng,
    readonly profile: Profile,
    nowMs: number,
  ) {
    const routine = ROUTINE[profile.routine];
    this.level = routine.mean;
    this.activity = routine.mean;
    this.shownActivity = routine.mean;
    this.tilt = profile.tilt;
    this.shownTilt = profile.tilt;
    this.hr = this.heartTarget('upright');
    this.spo2 = profile.spo2 - 1.2 * this.activity;
    this.temp = airTemperature(nowMs, profile.environment) + SELF_HEATING_C;
    this.rssi = profile.rssi;
  }

  /** The routine's activity level right now: where a story ramps back to. */
  get routineLevel(): number {
    return this.level;
  }

  get currentActivity(): number {
    return this.activity;
  }

  get temperature(): number {
    return this.temp;
  }

  private heartTarget(posture: Posture): number {
    return this.profile.restingBpm + 90 * (1 - Math.exp(-this.activity / 0.4)) - (posture === 'lying' ? 6 : 0) + this.stress;
  }

  step(dt: number, nowMs: number, drivers: Drivers): void {
    const { rng, profile } = this;
    const routine = ROUTINE[profile.routine];

    this.level = clamp(wander(rng, this.level, routine.mean, routine.sd, 60, dt), 0.015, 0.4);
    this.activity += ((drivers.activity ?? this.level) - this.activity) * approach(dt, 3);
    this.shownActivity = Math.max(0.002, this.activity + rng.gauss(0.004 + 0.06 * this.activity));

    const tiltTarget = drivers.tilt ?? (drivers.posture === 'lying' ? 80 : drivers.posture === 'bent' ? 40 : profile.tilt);
    this.tilt += (tiltTarget - this.tilt) * approach(dt, 1.2);
    this.shownTilt = clamp(this.tilt + rng.gauss(0.8), 0, 180);

    // Nobody on duty stands perfectly still for long: a shift of weight at least every ~40 s
    // (only a scripted story - someone down - keeps the vest's "still" timer running to 60 s).
    const restless = this.still >= 40;
    const moved = !drivers.still && (this.shownActivity > 0.05 || restless || rng.chance(1 - Math.exp(-dt * routine.fidget)));
    this.still = moved ? 0 : this.still + dt;

    this.stress += (drivers.stress - this.stress) * approach(dt, drivers.stress > this.stress ? 8 : 90);
    this.heat += (drivers.heat - this.heat) * approach(dt, drivers.heat > this.heat ? 20 : 70);
    this.smoke += (drivers.smoke - this.smoke) * approach(dt, 20);

    const hrTarget = this.heartTarget(drivers.posture);
    this.hr += (hrTarget - this.hr) * approach(dt, hrTarget > this.hr ? 15 : 35);
    this.hrWander = wander(rng, this.hrWander, 0, 1.6, 25, dt);

    const spo2Target = profile.spo2 - 1.2 * Math.min(this.activity, 1) - this.smoke;
    this.spo2 += (spo2Target - this.spo2) * approach(dt, 8);

    const air = airTemperature(nowMs, profile.environment) + this.heat;
    this.temp += (air + SELF_HEATING_C - this.temp) * approach(dt, 30);

    this.rssi = wander(rng, this.rssi, profile.rssi, 2.5, 40, dt);
    this.peak = Math.max(this.peak, 1 + 1.6 * this.activity * (1 + Math.abs(rng.gauss(0.25))));
  }

  /** A fall or a hard hit: the next report carries this peak acceleration. */
  jolt(peakG: number): void {
    this.peak = Math.max(this.peak, peakG);
  }

  /** What the vest measures right now (rounded like the firmware sends it). */
  reading(): BodyReading {
    const { rng } = this;
    const tilt = Math.round(this.shownTilt);
    return {
      heartRate: Math.round(clamp(this.hr + this.hrWander + rng.gauss(0.8), 35, 220)),
      spo2: Math.round(clamp(this.spo2 + rng.gauss(0.35), 70, 100)),
      vestTempC: round(this.temp + rng.gauss(0.05), 1),
      activityG: round(this.shownActivity, 3),
      tiltDeg: tilt,
      posture: tilt >= 55 ? 'lying' : tilt >= 35 ? 'bent' : 'upright',
      stillS: Math.floor(this.still),
      peakG: round(this.peak, 2),
      rssi: Math.round(this.rssi),
    };
  }

  /** Peak acceleration is "since the last report". */
  resetPeak(): void {
    this.peak = 1;
  }
}
