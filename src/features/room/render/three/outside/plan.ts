// The city outside the room's window (drawn by `view.ts`), in metres: x east, y up from the street, z out of our facade, so the city lies at
// z < 0. The room is a flat on the fifteenth floor, its floor 45 m up: the room's camera, moved here (`toOutside`), looks over the street
// below and the roofs of the blocks across, down an avenue to the downtown towers. A grid of streets and avenues, blocks of buildings on
// lots, taller toward the downtown core. Pure: the sizes and the places.
import { FLOOR_Y, WALL_T } from '../roomplan';

/** Room units per metre: the room is built at real sizes. */
export const M = 18700;
/** The room's floor above the street (m): the fifteenth floor. */
export const FLOOR_UP = 45;

/** A room point (world units) in the outside's metres. A direction or a turn is the same in both. */
export const toOutside = (x: number, y: number, z: number): [number, number, number] => [x / M, (y + FLOOR_Y) / M + FLOOR_UP, (z + WALL_T) / M];

/** A small seeded random source (mulberry32): the same city every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pavements stand this high over the road (m). */
export const CURB = 0.15;

/**
 * The grid. Streets run along x, one every `pz` metres away from us, the first one under our window (our facade is its north side at z = 0);
 * avenues run along z, away from us, one every `px` metres, one of them (x = `av0`) down the middle of the view. `street` and `avenue` are
 * the full widths between the facades, `walk` each pavement's width.
 */
export const GRID = { pz: 84, street: 24, px: 150, avenue: 32, av0: -36, walk: 5, rows: 50, cols: 13 } as const;

/** The middle line (z) of street `j` (0: ours) and the middle line (x) of avenue `i` (0: the one the window looks down). */
export const streetZ = (j: number): number => -GRID.street / 2 - j * GRID.pz;
export const avenueX = (i: number): number => GRID.av0 + i * GRID.px;

/** The block between streets j and j + 1 and avenues i and i + 1, to its facades' lines. */
export function blockRect(i: number, j: number): Rect {
  return { x0: avenueX(i) + GRID.avenue / 2, x1: avenueX(i + 1) - GRID.avenue / 2, z0: streetZ(j + 1) + GRID.street / 2, z1: streetZ(j) - GRID.street / 2 };
}

/** A rectangle on the ground (x0 < x1, z0 < z1). */
export interface Rect { x0: number; x1: number; z0: number; z1: number }

/** Where the downtown's towers crowd: their middle and spread (m). Two cores, the main one straight down the avenue. */
const CORES = [{ x: -300, z: -3000, r: 650, k: 1 }, { x: 900, z: -3550, r: 500, k: 0.75 }] as const;

/** How downtown a point is (0 out in the city, 1 in the core's middle). */
export function downtown(x: number, z: number): number {
  let v = 0;
  for (const c of CORES) v = Math.max(v, c.k * Math.exp(-((x - c.x) ** 2 + (z - c.z) ** 2) / (c.r * c.r)));
  return v;
}

/**
 * A building's facade: `glass` a curtain wall of tinted glass on slim mullions; `grid` an office's stone grid with deep windows; `brick` a
 * loft's brick with punched windows; `band` ribbon windows between concrete bands. Each sets the bay's width and the storey's height.
 */
export type Style = 'glass' | 'grid' | 'brick' | 'band';
export const STYLES: Record<Style, { bay: number; storey: number; win: readonly [number, number]; refl: number }> = {
  glass: { bay: 1.5, storey: 3.9, win: [0.94, 0.84], refl: 0.85 },
  grid: { bay: 3.0, storey: 3.8, win: [0.62, 0.62], refl: 0.35 },
  brick: { bay: 3.2, storey: 3.3, win: [0.42, 0.55], refl: 0.15 },
  band: { bay: 6.0, storey: 3.6, win: [0.97, 0.5], refl: 0.45 },
};

/** One stage of a building: its footprint, from y0 up to y1. A tower is a podium, its shaft set back, a top set back again. */
export interface Tier extends Rect { y0: number; y1: number }

export interface Building {
  tiers: Tier[];
  style: Style;
  /** The walls' colour (the frame round the windows) and the glass's tint, sRGB hex. */
  frame: number; tint: number;
  /** A roof crown: a mast with a beacon, a spire, a lit crown, or none. */
  crown: 'none' | 'mast' | 'spire' | 'lantern';
  seed: number;
}

/** The height of a building's top. */
export const topOf = (b: Building): number => b.tiers[b.tiers.length - 1]!.y1;

const FRAMES: Record<Style, readonly number[]> = {
  glass: [0x2c3138, 0x3c434b, 0x8e969e, 0x1e2226],
  grid: [0xd6d0c4, 0xbcb6aa, 0xe2ded6, 0x9a958c, 0xc7c0b0],
  brick: [0x8c4a36, 0x9e5a3e, 0x6e3b2e, 0xb08262, 0x7a5040],
  band: [0xd9d9d4, 0xa8aaa8, 0xc4bfb4, 0x6a6e72],
};
const TINTS: Record<Style, readonly number[]> = {
  glass: [0x5f7f96, 0x4f7c7a, 0x8a7a5c, 0x6c7a8c, 0x3f5a78, 0x7d8b93],
  grid: [0x3a4450, 0x4a5058, 0x34404a],
  brick: [0x2a2e33, 0x33373b],
  band: [0x41566a, 0x3d4a50, 0x55626e],
};

/** The tall landmarks, set by hand in the middles of their blocks (i, j): the footprint's half sizes, the height, the crown. */
const LANDMARKS = [
  { i: -2, j: 35, hx: 26, hz: 26, h: 440, crown: 'spire' },
  { i: 0, j: 30, hx: 30, hz: 22, h: 300, crown: 'lantern' },
  { i: -3, j: 39, hx: 24, hz: 26, h: 360, crown: 'mast' },
  { i: 6, j: 41, hx: 28, hz: 26, h: 290, crown: 'mast' },
  { i: 1, j: 9, hx: 20, hz: 20, h: 105, crown: 'lantern' },
] as const;

/** A random entry of a list. */
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

/** One building on a lot, its height drawn from how downtown the lot is. */
function building(lot: Rect, r: () => number, forced?: { h: number; crown: Building['crown'] }): Building {
  // the blocks nearest the window are old and low, so the window sees over them into the city
  const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2, d = downtown(cx, cz), out = Math.min(1, Math.hypot(cx - GRID.av0, cz) / 900);
  const tower = forced || r() < 0.035 * out + 0.6 * d;
  let h = forced?.h ?? (tower ? 50 + r() * 60 * out + d * (60 + r() * 170) : 11 + r() * (14 + 22 * out) + d * 30);
  // out of the core a tower stays under the line from the window to the sky over the city, so the skyline is the downtown's
  if (!forced && d < 0.3) h = Math.min(h, 38 + 0.075 * Math.hypot(cx - GRID.av0, cz));
  const style: Style = tower ? (r() < 0.62 ? 'glass' : r() < 0.6 ? 'grid' : 'band') : r() < 0.45 ? 'brick' : r() < 0.5 ? 'grid' : r() < 0.6 ? 'band' : 'glass';
  const s = STYLES[style];
  h = Math.max(s.storey * 3, Math.round(h / s.storey) * s.storey);
  const tiers: Tier[] = [];
  const w = lot.x1 - lot.x0, dd = lot.z1 - lot.z0;
  if (tower && h > 60 && Math.min(w, dd) > 26) {
    // a podium on the whole lot, the shaft set back from it, a top set back again
    const pod = s.storey * (2 + Math.floor(r() * 3)), inset = 3 + r() * 4, top = h * (0.72 + r() * 0.15);
    tiers.push({ ...lot, y0: 0, y1: pod });
    const shaft = { x0: lot.x0 + inset, x1: lot.x1 - inset, z0: lot.z0 + inset, z1: lot.z1 - inset };
    tiers.push({ ...shaft, y0: pod, y1: Math.round(top / s.storey) * s.storey });
    const k = 2 + r() * 3;
    if (r() < 0.7) tiers.push({ x0: shaft.x0 + k, x1: shaft.x1 - k, z0: shaft.z0 + k, z1: shaft.z1 - k, y0: tiers[1]!.y1, y1: h });
    else tiers[1]!.y1 = h;
  } else tiers.push({ ...lot, y0: 0, y1: h });
  const crown: Building['crown'] = forced?.crown ?? (h > 120 && r() < 0.45 ? 'mast' : h > 150 && r() < 0.3 ? 'lantern' : 'none');
  return { tiers, style, frame: pick(r, FRAMES[style]), tint: pick(r, TINTS[style]), crown, seed: Math.floor(r() * 1e6) };
}

/** The blocks that are a park (trees on a lawn), by their (i, j). */
export const PARKS = [[0, 2], [-3, 6], [2, 9]] as const;
const isPark = (i: number, j: number): boolean => PARKS.some(([a, b]) => a === i && b === j);

/** Every building of the city, block by block: each block cut into lots across and along, some lots joined for a tower. */
export function buildings(): Building[] {
  const r = rng(11), out: Building[] = [];
  for (let j = 0; j < GRID.rows; j++) for (let i = -GRID.cols; i < GRID.cols; i++) {
    if (isPark(i, j)) continue;
    const b = blockRect(i, j), mid: [number, number] = [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
    // far out the city thins to the edge of the view
    if (Math.hypot(mid[0] * 0.8, mid[1]) > 4300) continue;
    const mark = LANDMARKS.find((l) => l.i === i && l.j === j);
    if (mark) {
      const [x, z] = mid;
      out.push(building({ x0: x - mark.hx, x1: x + mark.hx, z0: z - mark.hz, z1: z + mark.hz }, r, { h: mark.h, crown: mark.crown }));
      // its plaza round it, low wings at the block's ends
      for (const [x0, x1] of [[b.x0, b.x0 + 18], [b.x1 - 18, b.x1]] as const) out.push(building({ x0, x1, z0: b.z0, z1: b.z1 }, r, { h: 14 + r() * 10, crown: 'none' }));
      continue;
    }
    // lots: two or three rows along z, cut across x in widths of 14 to 40 m; a tower takes a deeper lot
    const rows = r() < 0.5 ? 2 : 1, depth = (b.z1 - b.z0) / rows;
    for (let q = 0; q < rows; q++) {
      const z0 = b.z0 + q * depth, z1 = z0 + depth;
      for (let x = b.x0; x < b.x1 - 6;) {
        let w = 14 + r() * 26;
        if (b.x1 - (x + w) < 12) w = b.x1 - x;
        out.push(building({ x0: x, x1: x + w, z0, z1 }, r));
        x += w;
      }
    }
  }
  return out;
}

// ---- the street's things ----

export type TreeKind = 'plane' | 'lime' | 'shrub';
export interface Tree { x: number; z: number; kind: TreeKind; h: number; seed: number }
/** A lamp's place and turn: its arm reaches along (cos rot, -sin rot) over the road. */
export interface Lamp { x: number; z: number; rot: number }
export interface Car { x: number; z: number; rot: number; len: number; colour: number; seed: number }

/** The paint colours of the cars. */
export const CAR_COLOURS = [0xb9bdc3, 0x1c2633, 0x7a1d1f, 0xe9e7e2, 0x2e4a3b, 0x17191c, 0x4c6c8e, 0x8c8f93, 0xd8b23a] as const;

/** How far from the window the street's detail reaches (m): the trees, the lamps, the cars, the road's paint. */
export const DETAIL = 520;
const nearby = (x: number, z: number): boolean => Math.hypot(x - GRID.av0, z * 0.7) < DETAIL;

/** The street trees: rows on the avenues' pavements and the streets', and the parks' trees on their lawns. */
export function trees(): Tree[] {
  const r = rng(23), out: Tree[] = [];
  const add = (x: number, z: number, kind: TreeKind, h: number) => out.push({ x, z, kind, h, seed: Math.floor(r() * 1e6) });
  const kerb = GRID.walk - 1.2;
  for (let i = -3; i <= 3; i++) for (const side of [-1, 1]) {
    const x = avenueX(i) + side * (GRID.avenue / 2 - kerb);
    for (let j = 0; j < GRID.rows; j++) {
      const z1 = streetZ(j) - GRID.street / 2, z0 = streetZ(j + 1) + GRID.street / 2;
      for (let z = z1 - 6; z > z0 + 4; z -= 9 + r() * 3) if (nearby(x, z) && r() < 0.85) add(x + (r() - 0.5) * 0.4, z, 'plane', 9 + r() * 4);
    }
  }
  for (let j = 1; j < GRID.rows; j++) for (const side of [-1, 1]) {
    const z = streetZ(j) + side * (GRID.street / 2 - kerb);
    for (let i = -4; i < 4; i++) {
      const x0 = avenueX(i) + GRID.avenue / 2, x1 = avenueX(i + 1) - GRID.avenue / 2;
      for (let x = x0 + 6; x < x1 - 4; x += 10 + r() * 4) if (nearby(x, z) && r() < 0.7) add(x, z + (r() - 0.5) * 0.4, 'lime', 7.5 + r() * 3);
    }
  }
  for (const [i, j] of PARKS) {
    const b = blockRect(i, j);
    for (let n = 0; n < 70; n++) {
      const x = b.x0 + 5 + r() * (b.x1 - b.x0 - 10), z = b.z0 + 5 + r() * (b.z1 - b.z0 - 10);
      add(x, z, r() < 0.2 ? 'shrub' : r() < 0.6 ? 'plane' : 'lime', r() < 0.2 ? 1.5 + r() : 9 + r() * 7);
    }
  }
  return out;
}

/** The street lamps: along both kerbs of the near avenues and streets, their arms over the road. */
export function lamps(): Lamp[] {
  const out: Lamp[] = [], kerb = GRID.walk - 0.5;
  for (let i = -2; i <= 2; i++) for (const side of [-1, 1]) {
    const x = avenueX(i) + side * (GRID.avenue / 2 - kerb);
    for (let z = -30; z > -DETAIL * 1.4; z -= 28) if (nearby(x, z) && !onCrossing(x, z)) out.push({ x, z, rot: side > 0 ? Math.PI : 0 });
  }
  for (let j = 0; j < 6; j++) for (const side of [-1, 1]) {
    if (j === 0 && side > 0) continue;
    const z = streetZ(j) + side * (GRID.street / 2 - kerb);
    for (let x = -460; x < 400; x += 30) if (nearby(x, z) && !onCrossing(x, z)) out.push({ x, z, rot: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
  }
  return out;
}

/** Is a point in a crossing: where an avenue and a street meet, out to their pavements? */
export function onCrossing(x: number, z: number): boolean {
  const i = Math.round((x - GRID.av0) / GRID.px), j = Math.round((-z - GRID.street / 2) / GRID.pz);
  return Math.abs(x - avenueX(i)) < GRID.avenue / 2 + 1 && Math.abs(z - streetZ(j)) < GRID.street / 2 + 1;
}

/** The cars: traffic in the avenues' lanes (both ways) and the streets', bunched at the lights, some parked by the kerbs. */
export function cars(): Car[] {
  const r = rng(37), out: Car[] = [];
  const put = (x: number, z: number, rot: number) => {
    if (!nearby(x, z) || onCrossing(x, z)) return;
    out.push({ x, z, rot, len: 4.1 + r() * 0.7, colour: Math.floor(r() * CAR_COLOURS.length), seed: Math.floor(r() * 1e6) });
  };
  const road = GRID.avenue / 2 - GRID.walk, lanes = [-road + 2.2, -road + 5.6, road - 5.6, road - 2.2];
  for (let i = -2; i <= 2; i++) lanes.forEach((off, li) => {
    // northbound (away from us) on the east lanes, southbound on the west; the kerb lanes are parking
    const away = off > 0, park = li === 0 || li === 3;
    for (let z = -26 - r() * 20; z > -DETAIL * 1.4; z -= park ? 5.6 + r() * 6 : 7 + r() * 22) if (!park || r() < 0.7) put(avenueX(i) + off, z, away ? Math.PI / 2 : -Math.PI / 2);
  });
  const sroad = GRID.street / 2 - GRID.walk;
  for (let j = 0; j < 6; j++) for (const off of [-sroad + 2, sroad - 2]) {
    for (let x = -460 + r() * 10; x < 400; x += off > 0 ? 6 + r() * 14 : 9 + r() * 25) put(x, streetZ(j) + off, off > 0 ? 0 : Math.PI);
  }
  return out;
}
