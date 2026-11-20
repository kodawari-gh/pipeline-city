// The Swiss triple socket of the studio's wall (SN 441011: three type 13 sockets in a pinwheel round a screw, a 62 mm insert in a 91 mm frame, as on a real
// wall). The recess is the traced one of plugs3d.ts (`T13`, `lozenge`); each takes a type 12 plug (`swissPlug`) whose pins go into its three holes, the earth
// one nearest the screw. World frame as the wall's: x east, y up, z toward the viewer; `MM` = 23 units a mm. The plan of it is pure (`pinwheel`); `tripleSocket` builds it.
// The room's two-gang plate (`wallPlate`) is cut with the same recess, drawn at the room's smaller scale (`ROOM_SOCKET`).
import { Group, Vector2, type Material } from 'three';
import { drum, rectBox, SEG, type RectLike } from '@/core/render/three/geometry';
import { outlinePts, shapeOf, slab } from './casekit3d';
import { lozenge, T13 } from './plugs3d';

/** Units a mm. */
const MM = 23;

/**
 * The triple socket's real size (mm, as a photo of a real one measures): the frame and the insert in it; each recess's middle `reach` from the screw (its earth
 * hole 11.8 from the screw and the live and the neutral hole 19.3), the three turned 120 degrees from each other (`spin`: the angle, from east, of each recess's
 * outer side, the side of its live and neutral holes), the top one first.
 */
export const TRIPLE = { frame: 91, insert: 62, reach: 17.35, spin: [90, 210, 330] } as const;

/** One of the three sockets: its recess's middle in mm from the screw (y up), and the turn of a plug in it, in radians (the plug's keyed side toward the screw). */
export interface PinSocket { x: number; y: number; roll: number }

/** The three sockets of the pinwheel, top, lower left, lower right, in mm from the screw (y up). */
export function pinwheel(): [PinSocket, PinSocket, PinSocket] {
  const at = (deg: number): PinSocket => {
    const a = (deg * Math.PI) / 180;
    return { x: TRIPLE.reach * Math.cos(a), y: TRIPLE.reach * Math.sin(a), roll: a - Math.PI / 2 };
  };
  return [at(TRIPLE.spin[0]), at(TRIPLE.spin[1]), at(TRIPLE.spin[2])];
}

/** A point of a socket's own frame (mm round its recess's middle, y toward its live and neutral holes) in mm from the screw. */
export function inPinwheel(s: PinSocket, p: readonly [number, number]): [number, number] {
  const c = Math.cos(s.roll), n = Math.sin(s.roll);
  return [s.x + p[0] * c - p[1] * n, s.y + p[0] * n + p[1] * c];
}

/** A socket's three contact holes in mm from the screw: the live and the neutral one, then the earth one. */
export function pinHoles(s: PinSocket): [number, number][] {
  return [[-T13.pitch / 2, T13.ln], [T13.pitch / 2, T13.ln], [0, T13.ln - T13.earth]].map(([x, y]) => inPinwheel(s, [x!, y!]));
}

/** One recess of a plate: its middle in world units (y up) and the turn of a plug in it, as `PinSocket.roll` (0: the earth pin down). */
export interface Recess { x: number; y: number; roll: number }

/** A recess's outline in the world at `k` units a mm: the traced hexagon, turned and moved to its place. */
export function recessOutline(r: Recess, k: number): Vector2[] {
  const c = Math.cos(r.roll), n = Math.sin(r.roll);
  return lozenge(0, SEG.plug).map(([x, y]) => new Vector2(r.x + (x * c - y * n) * k, r.y + (x * n + y * c) * k));
}

/** A recess's three contact holes in the world at `k` units a mm: the live and the neutral one, then the earth one. */
export function recessHoles(r: Recess, k: number): [number, number][] {
  const c = Math.cos(r.roll), n = Math.sin(r.roll);
  return ([[-T13.pitch / 2, T13.ln], [T13.pitch / 2, T13.ln], [0, T13.ln - T13.earth]] as const).map(([x, y]): [number, number] => [r.x + (x * c - y * n) * k, r.y + (x * n + y * c) * k]);
}

/** The black mouths of the contact holes in the floor of each recess (`floor`: the z of the floor), at `k` units a mm. */
function cutHoles(into: Group, rs: readonly Recess[], k: number, floor: number, black: Material): void {
  for (const r of rs) for (const [x, y] of recessHoles(r, k)) into.add(drum(x, -y, floor - 2, floor + 0.3 * k, (T13.hole / 2) * k, black, SEG.part));
}

/** What the socket is made of: the frame and the insert (one colour), the black of a hole and of the screw's slot, the screw's steel. */
export interface TripleLook { plate: Material; black: Material; steel: Material }

/** Where it stands: the screw's x and y (world units), the wall's face and the frame's face (z). */
export interface TripleIn { x: number; y: number; z: number; face: number; look: TripleLook }

/** A layout rect (y down) over a box of the world (y up). */
const lay = (x0: number, x1: number, y0: number, y1: number): RectLike => ({ x: x0, y: -y1, w: x1 - x0, h: y1 - y0 });

/**
 * The socket: the frame round the insert with its edge rolled, the insert a hair under the frame's face with a recess cut for each socket down to the floor
 * (`T13.deep` under the face), the three contact holes in each floor, the screw (a slotted steel head) at the middle.
 */
export function tripleSocket(into: Group, o: TripleIn): Group {
  const { x: cx, y: cy, z, face: fz, look: m } = o, g = new Group();
  g.name = 'wall.mains';
  // (a square of `h` mm half-side round the screw, its corners `r` mm)
  const sq = (h: number, r: number): Vector2[] => outlinePts(lay(cx - h * MM, cx + h * MM, cy - h * MM, cy + h * MM), r * MM, undefined, SEG.cornerCoarse);
  const floor = fz - T13.deep * MM, top = fz - 0.4 * MM, half = TRIPLE.insert / 2;
  // (each socket of the pinwheel as a recess of the world: its middle moved from the screw, its turn the pinwheel's)
  const recesses = pinwheel().map((s): Recess => ({ x: cx + s.x * MM, y: cy + s.y * MM, roll: s.roll }));
  // the frame, with the insert's opening; the insert: its floor under the recesses, its face with a recess in it for each socket
  g.add(slab(shapeOf(sq(TRIPLE.frame / 2, 5), [sq(half, 1.2)]), z, fz, m.plate, 2.2 * MM));
  g.add(slab(shapeOf(sq(half, 1.2)), z, floor, m.plate));
  g.add(slab(shapeOf(sq(half, 1.2), recesses.map((r) => recessOutline(r, MM))), floor, top, m.plate, 0.5 * MM));
  // the holes in each floor: a black mouth
  cutHoles(g, recesses, MM, floor, m.black);
  // the screw at the middle: a steel head let into the face, its slot
  g.add(drum(cx, -cy, top - 0.6 * MM, top + 0.3 * MM, 3.1 * MM, m.steel, SEG.part));
  g.add(rectBox(lay(cx - 0.45 * MM, cx + 0.45 * MM, cy - 2.6 * MM, cy + 2.6 * MM), top - 0.1 * MM, top + 0.4 * MM, m.black));
  into.add(g);
  return g;
}

/**
 * The room's wall sockets are drawn small (its plate is 1500 x 800 units, a two-gang plate's shape in a smaller scale): the recess at `k` units a mm, so two stand
 * on it with a web between them, and the plate's face `face` units off the wall (the recess's depth and a little more). The room's plugs are built at the same `k`.
 */
export const ROOM_SOCKET = { k: 14, face: 230 } as const;

/** A plate on a wall: `rect` (layout units, y down), a recess upright at each of `outlets` (their middles, layout units), the plate's face at `face` (z) from the wall at 0. */
export interface WallPlateIn { rect: RectLike; outlets: readonly { x: number; y: number }[]; face: number; k: number; look: { plate: Material; black: Material } }

/**
 * A wall plate as the triple socket's: a frame with its edge rolled, the insert in it a hair under the frame's face with a recess cut for each outlet down to
 * its floor (`T13.deep` under the face) and the three contact holes in each floor. Every recess takes the type 12 plug of `swissPlug` upright, its earth pin down.
 */
export function wallPlate(into: Group, o: WallPlateIn): Group {
  const { rect: r, face, k } = o, g = new Group(), rim = 5.5 * k, floor = face - T13.deep * k, top = face - 0.4 * k;
  g.name = 'wall.plate';
  const edge = outlinePts(r, 3 * k, undefined, SEG.cornerCoarse), inner = outlinePts({ x: r.x + rim, y: r.y + rim, w: r.w - 2 * rim, h: r.h - 2 * rim }, 1.2 * k, undefined, SEG.cornerCoarse);
  const recesses = o.outlets.map((p): Recess => ({ x: p.x, y: -p.y, roll: 0 }));
  g.add(slab(shapeOf(edge, [inner]), 0, face, o.look.plate, 2.2 * k));
  g.add(slab(shapeOf(inner), 0, floor, o.look.plate));
  g.add(slab(shapeOf(inner, recesses.map((c) => recessOutline(c, k))), floor, top, o.look.plate, 0.5 * k));
  cutHoles(g, recesses, k, floor, o.look.black);
  into.add(g);
  return g;
}
