import type { Unit, Wearer } from '@/features/units/domain/Unit';

/** Who the simulation plays: one vest and the person wearing it. */
export interface RosterEntry {
  deviceId: string;
  code: string;
  name: string;
  firmwareVersion: string | null;
  notes: string | null;
  wearer: Wearer | null;
}

const BUILT_IN: [string, string, number, number][] = [
  ['01', 'مركز الرياض الدولي للمؤتمرات والمعارض', 24.75316823074473, 46.72672938465661],
  ['02', 'حي العليا', 24.6905, 46.6854],
  ['03', 'حي الملقا', 24.8052, 46.6149],
  ['04', 'حي النرجس', 24.8255, 46.6632],
  ['05', 'حي الروضة', 24.7402, 46.7646],
  ['06', 'حي السفارات', 24.6782, 46.6194],
];

/**
 * Used when the live registry cannot be read (server asleep, sign-in needed):
 * the six wearers of `flask seed-demo`, ALPHA-01 at its current post.
 */
export const BUILT_IN_ROSTER: RosterEntry[] = BUILT_IN.map(([n, zone, lat, lng]) => ({
  deviceId: `demo-sta-${n}`,
  code: `STA-${n}`,
  name: `Vest STA-${n}`,
  firmwareVersion: '2.1.0',
  notes: null,
  wearer: {
    id: `demo-alpha-${n}`,
    callsign: `ALPHA-${n}`,
    fullName: `فرد ميداني ${n}`,
    rank: null,
    unitName: 'Riyadh Response Team',
    bloodType: null,
    zone,
    postLat: lat,
    postLng: lng,
  },
}));

/** The real fleet (names, posts, vest codes) becomes the cast of the simulation. */
export function rosterFromUnits(units: Unit[]): RosterEntry[] {
  return units
    .filter((unit) => unit.isActive)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((unit) => ({
      deviceId: unit.id,
      code: unit.code,
      name: unit.name,
      firmwareVersion: unit.firmwareVersion,
      notes: unit.notes,
      wearer: unit.wearer,
    }));
}
