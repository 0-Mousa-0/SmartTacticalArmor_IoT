/** Seeded random numbers (mulberry32): the same seed always plays the same simulation. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Normal distribution with mean 0 (Box–Muller). */
  gauss(sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** Share of the way to a target covered in `dt` seconds with time constant `tau`. */
export const approach = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);

/** One exact step of a mean-reverting random walk (Ornstein–Uhlenbeck) with stationary spread `sd`. */
export function wander(rng: Rng, value: number, mean: number, sd: number, tau: number, dt: number): number {
  const keep = Math.exp(-dt / tau);
  return mean + (value - mean) * keep + sd * Math.sqrt(1 - keep * keep) * rng.gauss();
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const round = (value: number, digits = 0): number => {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
};
