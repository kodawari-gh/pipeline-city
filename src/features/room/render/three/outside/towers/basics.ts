// The words the city's buildings (`mass.ts`) are made of: what a vertex is and how a thin thing holds its width, a point, a vertex's paint,
// a rect set in or sized round a middle, a building's foot and top tiers, and a box's walls.
import type { Building, Rect, Tier, V3 } from './types';

/** What a vertex is: an office's facade, a roof, a plain surface, a beacon, a lit crown, a band of LEDs, a home's facade (lit room by room), a solar panel, a sign, a spire in its floodlights. */
export enum Kind {
  Facade = 0,
  Roof = 1,
  Plain = 2,
  Beacon = 3,
  Crown = 4,
  Led = 5,
  Home = 6,
  Solar = 7,
  Sign = 8,
  Flood = 9,
}
/** How a thin thing (a plain mast, a beacon, a line of LEDs) holds a pixel's width far off: `look` is its middle and this, the axes it grows on. */
export enum Wide {
  Across = 1,
  Up = 2,
  All = 3,
}

/** The rect r set in by k on each side (out, if k is under 0). */
export const inset = (r: Rect, k: number): Rect => ({ x0: r.x0 + k, x1: r.x1 - k, z0: r.z0 + k, z1: r.z1 - k });
/** A rect w by d round its middle (x, z). */
export const sized = ([x, z]: readonly [number, number], [w, d]: readonly [number, number]): Rect => ({
  x0: x - w / 2,
  x1: x + w / 2,
  z0: z - d / 2,
  z1: z + d / 2,
});

/** A building's first tier, its foot (a building has one at least). */
export function footOf(b: Building): Tier {
  const [t] = b.tiers;
  if (t === undefined) {
    throw new Error('a building has no tier');
  }
  return t;
}

/** A building's last tier, its top. */
export function headOf(b: Building): Tier {
  const t = b.tiers.at(-1);
  if (t === undefined) {
    throw new Error('a building has no tier');
  }
  return t;
}

/** A box's four walls from their left foot to their right foot, each with its outward normal. */
export function wallsOf({ x0, x1, z0, z1 }: Rect): [V3, V3, V3][] {
  return [
    [
      [x0, 0, z1],
      [x1, 0, z1],
      [0, 0, 1],
    ],
    [
      [x1, 0, z1],
      [x1, 0, z0],
      [1, 0, 0],
    ],
    [
      [x1, 0, z0],
      [x0, 0, z0],
      [0, 0, -1],
    ],
    [
      [x0, 0, z0],
      [x0, 0, z1],
      [-1, 0, 0],
    ],
  ];
}
