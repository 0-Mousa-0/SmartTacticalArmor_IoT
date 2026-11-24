import type { Drivers, Environment, Profile } from './body';

/*
 * The simulation's storyline: what happens to whom, and when.
 * Stories only change what a wearer *does* (move, fall, press SOS, walk into
 * smoke...). Every reading, alert and risk score follows from that through the
 * same rules as the real vest firmware and server.
 */

export type StoryKey = 'pursuit' | 'fall' | 'heat' | 'sos' | 'contact' | 'stumble';

export type StoryAction =
  /** replace the scripted drivers (unset fields fall back to the routine) */
  | { type: 'drive'; drivers: Partial<Drivers> }
  /** walk/rest back into the routine over N seconds */
  | { type: 'ramp'; seconds: number }
  /** back to the routine at once */
  | { type: 'routine' }
  /** free fall + impact: the vest starts a pre-alert */
  | { type: 'fall'; peakG: number }
  /** the wearer answers the pre-alert ("I'm OK") */
  | { type: 'cancel' }
  /** hard hit, no fall */
  | { type: 'impact'; peakG: number }
  /** SOS button held for 2 s */
  | { type: 'sos' }
  /** fire nearby: the air heats until the vest reads about `reachC` */
  | { type: 'fire'; reachC: number }
  /** the vest's link drops or comes back */
  | { type: 'radio'; on: boolean };

export interface StoryStep {
  at: number;
  actions: StoryAction[];
}

export const STORIES: Record<StoryKey, StoryStep[]> = {
  // Sprint after a suspect: heart rate above 160 (HR_HIGH), unusual activity and heart rate for the AI.
  pursuit: [
    { at: 0, actions: [{ type: 'drive', drivers: { activity: 0.82, stress: 20 } }] },
    { at: 95, actions: [{ type: 'drive', drivers: { activity: 0.32 } }] },
    { at: 245, actions: [{ type: 'ramp', seconds: 240 }] },
  ],
  // Falls and stays down: pre-alert, no answer -> critical FALL, then NO_MOTION while lying still.
  fall: [
    { at: 0, actions: [{ type: 'fall', peakG: 3.4 }, { type: 'drive', drivers: { activity: 0.004, posture: 'lying', tilt: 82, still: true, stress: 32 } }] },
    { at: 200, actions: [{ type: 'drive', drivers: { activity: 0.06, posture: 'upright', stress: 10 } }] },
    { at: 320, actions: [{ type: 'ramp', seconds: 120 }] },
  ],
  // A vehicle fire nearby: the vest heats past 45 °C, smoke pulls SpO2 under 92 %.
  heat: [
    // `drive` replaces the drivers, so the fire comes after it.
    { at: 0, actions: [{ type: 'drive', drivers: { activity: 0.2, stress: 4, smoke: 7.5 } }, { type: 'fire', reachC: 48 }] },
    { at: 150, actions: [{ type: 'drive', drivers: { activity: 0.2, heat: 0, smoke: 0 } }] },
    { at: 330, actions: [{ type: 'routine' }] },
  ],
  // Struck hard, takes cover, then calls for help.
  sos: [
    { at: 0, actions: [{ type: 'impact', peakG: 6.9 }, { type: 'drive', drivers: { activity: 0.12, posture: 'bent', stress: 26 } }] },
    { at: 8, actions: [{ type: 'sos' }] },
    { at: 24, actions: [{ type: 'drive', drivers: { activity: 0.22 } }] },
    { at: 150, actions: [{ type: 'ramp', seconds: 120 }] },
  ],
  // The vest's link drops (dead zone): offline, then CONTACT_LOST from the server.
  contact: [
    { at: 0, actions: [{ type: 'radio', on: false }] },
    { at: 130, actions: [{ type: 'radio', on: true }] },
  ],
  // Trips, the vest suspects a fall, the wearer presses "I'm OK" within seconds.
  stumble: [
    { at: 0, actions: [{ type: 'fall', peakG: 2.9 }, { type: 'drive', drivers: { activity: 0.03, posture: 'lying', tilt: 74 } }] },
    { at: 5, actions: [{ type: 'cancel' }, { type: 'drive', drivers: { activity: 0.09 } }] },
    { at: 40, actions: [{ type: 'routine' }] },
  ],
};

/** The storyline repeats every 12 minutes. */
export const CYCLE_S = 720;

export interface Cue {
  /** seconds into the cycle */
  at: number;
  story: StoryKey;
  /** which unit of the roster (sorted by vest code) */
  slot: number;
}

export const TIMELINE: Cue[] = [
  { at: 10, story: 'pursuit', slot: 2 },
  { at: 75, story: 'fall', slot: 3 },
  { at: 210, story: 'heat', slot: 4 },
  { at: 330, story: 'sos', slot: 1 },
  { at: 420, story: 'contact', slot: 5 },
  { at: 600, story: 'stumble', slot: 0 },
];

/** Earlier today (seconds before the simulation starts), so charts and the closed-alerts list have history. */
export const EARLIER_TODAY: Cue[] = [
  { at: -5 * 3600 - 1200, story: 'heat', slot: 4 },
  { at: -3 * 3600 - 2400, story: 'stumble', slot: 3 },
  { at: -2 * 3600 - 600, story: 'contact', slot: 5 },
  { at: -52 * 60, story: 'pursuit', slot: 2 },
];

/** How long each story is news for the scenario panel: the visible part, not the slow recovery after it. */
export const HEADLINE_S: Record<StoryKey, number> = { pursuit: 150, fall: 200, heat: 180, sos: 150, contact: 130, stumble: 10 };

const PROFILES: Profile[] = [
  { routine: 'post', environment: 'indoor', restingBpm: 66, spo2: 98.2, tilt: 4, rssi: -54 },
  { routine: 'patrol', environment: 'outdoor', restingBpm: 72, spo2: 97.6, tilt: 6, rssi: -63 },
  { routine: 'patrol', environment: 'outdoor', restingBpm: 70, spo2: 97.9, tilt: 5, rssi: -66 },
  { routine: 'guard', environment: 'outdoor', restingBpm: 68, spo2: 98, tilt: 3, rssi: -60 },
  { routine: 'patrol', environment: 'outdoor', restingBpm: 71, spo2: 97.4, tilt: 7, rssi: -69 },
  { routine: 'guard', environment: 'outdoor', restingBpm: 64, spo2: 98.4, tilt: 4, rssi: -71 },
];

/** Who does what: an indoor post, patrols and guards; larger fleets alternate patrol and guard. */
export function profileFor(slot: number): Profile {
  if (slot < PROFILES.length) return PROFILES[slot];
  const environment: Environment = 'outdoor';
  return {
    routine: slot % 2 === 0 ? 'guard' : 'patrol',
    environment,
    restingBpm: 64 + ((slot * 7) % 10),
    spo2: 97.4 + ((slot * 3) % 10) / 10,
    tilt: 3 + (slot % 5),
    rssi: -58 - ((slot * 5) % 15),
  };
}
