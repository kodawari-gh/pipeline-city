// The street outside the room's window (drawn by `view.ts`), in metres: x east, y up from the road, z out of our facade, so the street lies
// at z < 0. The room is on the third floor, its floor 8 m up: the room's camera, moved here (`toOutside`), looks down over the front garden
// and the street to the houses across, and along a side street to the town, its towers and the hills. Pure: the sizes and the places.
import { FLOOR_Y, WALL_T } from '../roomplan';

/** Room units per metre: the room is built at real sizes. */
export const M = 18700;
/** The room's floor above the street (m): the third floor. */
export const FLOOR_UP = 8;

/** A room point (world units) in the outside's metres. A direction or a turn is the same in both. */
export const toOutside = (x: number, y: number, z: number): [number, number, number] => [x / M, (y + FLOOR_Y) / M + FLOOR_UP, (z + WALL_T) / M];

/** A small seeded random source (mulberry32): the same street every time. */
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

/** The main street's lines, front to back (z): our garden wall, our kerb, the far kerb, the back of the far pavement, the facades across. */
export const Z = { wall: -4.5, kerb: -7.2, kerbFar: -16.8, walkFar: -19.5, front: -26.5 } as const;
/** The pavements and the gardens stand this high over the road (m). */
export const CURB = 0.13;

/**
 * The side street: its axis leaves the far kerb at `x0` and runs along `dir`, a little west of straight away, so from the room's overview the
 * window looks down it to the town. `kerb`, `walk` and `front` are half-widths: to its kerbs, to the backs of its pavements, to its facades.
 */
export const SIDE = { x0: -5.1, dir: [-0.2099, -0.9777] as const, kerb: 3, walk: 5.2, front: 8.5, len: 300 } as const;

/** A point of the side street (x, z): `s` metres along it, `t` across it (to the right, walking away from us). */
export function sidePoint(s: number, t: number): [number, number] {
  const [ux, uz] = SIDE.dir;
  return [SIDE.x0 + ux * s - uz * t, Z.kerbFar + uz * s + ux * t];
}

/** The side street's coordinates of a point: how far along it and how far across (the inverse of `sidePoint`). */
export function sideOf(x: number, z: number): { s: number; t: number } {
  const [ux, uz] = SIDE.dir, dx = x - SIDE.x0, dz = z - Z.kerbFar;
  return { s: dx * ux + dz * uz, t: -dx * uz + dz * ux };
}

/** The turn (about y) that faces a thing's front (+z) along a direction (x, z) on the ground. */
export const facing = (x: number, z: number): number => Math.atan2(x, z);
/** The side street's turn: a thing turned by it has its -z along the street, away from us. */
export const SIDE_TURN = facing(-SIDE.dir[0], -SIDE.dir[1]);

// ---- the houses ----

/** A storey's height and the plinth under the ground floor (m). */
export const STOREY = 2.85, PLINTH = 0.45;
/** How many looks of each kind the kit has (`houses.ts`): walls, roof tiles, trims, doors. */
export const LOOKS = { wall: 7, tiles: 3, trim: 3, door: 5 } as const;

export interface House {
  /** The middle of the front facade (x, z) and the house's turn about y (0: it faces +z, toward us). */
  x: number; z: number; rot: number;
  /** Frontage and depth (m), storeys, the roof's ridge along the street (`side`, gables at the ends) or a gable to the street (`front`), its pitch (rad). */
  w: number; d: number; floors: number; roof: 'side' | 'front'; pitch: number;
  /** Looks (indexes into the kit): the walls, the tiles, the trims, the door. */
  wall: number; tiles: number; trim: number; door: number;
  /** The door's bay (0: the left one, seen from the street, 1: the right one), a dormer, a chimney, a canopy over the door. */
  doorBay: 0 | 1; dormer: boolean; chimney: boolean; porch: boolean;
  /** Near enough to the window for full detail: each pane back in its reveal, panelled doors, dormers. */
  near: boolean;
  seed: number;
}

/** The eaves' height of a house (m). */
export const eavesOf = (h: Pick<House, 'floors'>): number => PLINTH + h.floors * STOREY;

/** A rectangle in a facade (x across it from its middle, y up from the ground). */
export interface Box2 { x0: number; x1: number; y0: number; y1: number }
export interface Opening extends Box2 { kind: 'window' | 'door' | 'attic' }

/** A house's openings in its front facade: two or three bays of windows on each storey, the door in one ground-floor bay, an attic window in a street gable. */
export function openings(h: House): Opening[] {
  const n = h.w > 7.6 ? 3 : 2, out: Opening[] = [];
  for (let f = 0; f < h.floors; f++) for (let i = 0; i < n; i++) {
    const cx = -h.w / 2 + (h.w * (i + 0.5)) / n, base = PLINTH + f * STOREY;
    if (f === 0 && i === h.doorBay * (n - 1)) { out.push({ kind: 'door', x0: cx - 0.55, x1: cx + 0.55, y0: PLINTH, y1: PLINTH + 2.5 }); continue; }
    const ww = n === 3 ? 1.05 : 1.25, wh = f === 0 ? 1.6 : 1.45;
    out.push({ kind: 'window', x0: cx - ww / 2, x1: cx + ww / 2, y0: base + 0.85, y1: base + 0.85 + wh });
  }
  if (h.roof === 'front') { const e = eavesOf(h); out.push({ kind: 'attic', x0: -0.45, x1: 0.45, y0: e + 0.45, y1: e + 1.5 }); }
  return out;
}

/** A wall from x0 to x1 and y0 to y1 cut round its openings (inside it, not overlapping): the pieces left, column by column. */
export function cutWall(x0: number, x1: number, y0: number, y1: number, holes: readonly Box2[]): Box2[] {
  const xs = [...new Set([x0, x1, ...holes.flatMap((h) => [h.x0, h.x1])])].filter((x) => x >= x0 && x <= x1).sort((a, b) => a - b);
  const out: Box2[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]!, b = xs[i + 1]!;
    if (b - a < 1e-6) continue;
    let y = y0;
    for (const h of holes.filter((o) => o.x0 <= a + 1e-6 && o.x1 >= b - 1e-6 && o.y0 < y1 && o.y1 > y0).sort((p, q) => p.y0 - q.y0)) {
      if (h.y0 > y) out.push({ x0: a, x1: b, y0: y, y1: h.y0 });
      y = Math.max(y, h.y1);
    }
    if (y < y1) out.push({ x0: a, x1: b, y0: y, y1 });
  }
  return out;
}

/** A row of houses: frontages from `from` to `to` along a line (`place` gives a frontage's middle), in pairs and short gaps. */
function row(out: House[], r: () => number, from: number, to: number, place: (along: number) => { x: number; z: number; rot: number }, near: (along: number) => boolean): void {
  let a = from;
  for (;;) {
    const w = 6.2 + r() * 3.4;
    if (a + w > to) return;
    const roof = w < 7.6 && r() < 0.55 ? 'front' : 'side';
    out.push({
      ...place(a + w / 2), w, d: 8.5 + r() * 2.5, floors: r() < 0.82 ? 2 : 3, roof, pitch: roof === 'front' ? 0.72 + r() * 0.12 : 0.6 + r() * 0.16,
      wall: Math.floor(r() * LOOKS.wall), tiles: Math.floor(r() * LOOKS.tiles), trim: Math.floor(r() * LOOKS.trim), door: Math.floor(r() * LOOKS.door),
      doorBay: r() < 0.5 ? 0 : 1, dormer: roof === 'side' && r() < 0.4, chimney: r() < 0.75, porch: r() < 0.4, near: near(a + w / 2), seed: Math.floor(r() * 1e6),
    });
    a += w + (r() < 0.4 ? 0.05 : 0.9 + r() * 2.4);
  }
}

/** The houses across the main street and along the side street (ours, behind the window, are never seen). */
export function houses(): House[] {
  const r = rng(11), out: House[] = [];
  const across = (x: number) => ({ x, z: Z.front, rot: 0 });
  // the side street's facades reach the main street's front line between these two
  row(out, r, -118, -17.5, across, (x) => Math.abs(x) < 48);
  row(out, r, 3.5, 118, across, (x) => Math.abs(x) < 48);
  // along the side street, each facing it: the corner houses' back gardens first
  const left = (s: number) => { const [x, z] = sidePoint(s, -SIDE.front); return { x, z, rot: facing(-SIDE.dir[1], SIDE.dir[0]) }; };
  const right = (s: number) => { const [x, z] = sidePoint(s, SIDE.front); return { x, z, rot: facing(SIDE.dir[1], -SIDE.dir[0]) }; };
  row(out, r, 27, SIDE.len, left, (s) => s < 75);
  row(out, r, 21, SIDE.len, right, (s) => s < 75);
  return out;
}

// ---- the street's furniture and its trees ----

export type TreeKind = 'plane' | 'lime' | 'birch' | 'shrub';
export interface Tree { x: number; z: number; kind: TreeKind; h: number; seed: number }
export interface Lamp { x: number; z: number }
export interface Car { x: number; z: number; rot: number; len: number; colour: number; seed: number }

/** The paint colours of the parked cars. */
export const CAR_COLOURS = [0xb9bdc3, 0x1c2633, 0x7a1d1f, 0xe9e7e2, 0x2e4a3b, 0x17191c, 0x4c6c8e, 0x8c8f93] as const;

/** The trees: two rows along the main street (none in front of our window's slot of view), a row each side of the side street, a birch in our garden, shrubs in the gardens across. */
export function trees(): Tree[] {
  const r = rng(23), out: Tree[] = [];
  const add = (x: number, z: number, kind: TreeKind, h: number) => out.push({ x, z, kind, h, seed: Math.floor(r() * 1e6) });
  for (const x of [-57, -44, -31, -18.5, -8.8, 5.2, 18, 31, 44, 57]) add(x + (r() - 0.5) * 1.2, Z.kerb + 0.75, 'plane', 12 + r() * 3);
  for (const x of [-61, -48, -35, -22.5, 7.8, 20.5, 33, 46, 59]) add(x + (r() - 0.5) * 1.2, Z.kerbFar - 0.75, 'plane', 11.5 + r() * 3.5);
  // young limes down the side street, spaced out so the window still sees down it to the town
  for (let s = 34; s < SIDE.len - 10; s += 26) {
    const [x, z] = sidePoint(s + (r() - 0.5) * 3, -(SIDE.kerb + 0.8));
    add(x, z, 'lime', 7.5 + r() * 2);
    const [x2, z2] = sidePoint(s + 13 + (r() - 0.5) * 3, SIDE.kerb + 0.8);
    add(x2, z2, 'lime', 7.5 + r() * 2);
  }
  add(3.4, -2.4, 'birch', 9.5);
  for (let x = -60; x < 60; x += 4.5 + r() * 5) {
    if (x > -19 && x < 4) continue;
    add(x, Z.front + 1.4 + r() * 3.5, 'shrub', 1.1 + r() * 1.3);
  }
  for (let s = 26; s < 140; s += 6 + r() * 8) {
    const t = (r() < 0.5 ? -1 : 1) * (SIDE.walk + 1 + r() * 2);
    const [x, z] = sidePoint(s, t);
    add(x, z, 'shrub', 1 + r() * 1.2);
  }
  return out;
}

/** The street lamps: each side of the main street and down one side of the side street. */
export function lamps(): Lamp[] {
  const out: Lamp[] = [];
  for (const x of [-38, -13.5, 14, 40]) out.push({ x, z: Z.kerb + 0.35 });
  for (const x of [-50, -25, 24, 51]) out.push({ x, z: Z.kerbFar - 0.35 });
  for (let s = 16; s < SIDE.len; s += 30) { const [x, z] = sidePoint(s, SIDE.kerb + 0.35); out.push({ x, z }); }
  return out;
}

/** The parked cars: in each parking lane of the main street, and along the side street's left kerb. */
export function cars(): Car[] {
  const r = rng(37), out: Car[] = [];
  const lane = (xs: readonly number[], z: number) => {
    for (const x of xs) out.push({ x, z, rot: r() < 0.5 ? 0 : Math.PI, len: 4.1 + r() * 0.6, colour: Math.floor(r() * CAR_COLOURS.length), seed: Math.floor(r() * 1e6) });
  };
  lane([-37, -31.4, -19.5, 10.5, 16, 33.5], Z.kerb - 1.0);
  lane([-44, -33, -27.2, 9.5, 21, 26.6, 38.5], Z.kerbFar + 1.0);
  for (const s of [24, 30, 52, 79, 85, 118, 160, 166, 214, 250]) {
    const [x, z] = sidePoint(s, -(SIDE.kerb - 1.0));
    out.push({ x, z, rot: SIDE_TURN + Math.PI / 2 + (r() < 0.5 ? 0 : Math.PI), len: 4.1 + r() * 0.6, colour: Math.floor(r() * CAR_COLOURS.length), seed: Math.floor(r() * 1e6) });
  }
  return out;
}
