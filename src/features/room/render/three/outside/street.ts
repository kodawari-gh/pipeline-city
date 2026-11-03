// The streets' ground and what stands on it (`plan.ts` gives the places): the road, the pavements with their kerbs (the corners into the side
// street rounded), the front gardens with their walls or hedges, gate piers and paths, the tree pits, the street lamps, the road's paint, the
// drains and the covers, the parked cars, and the stone sill under our own window. All on the kit's materials, merged with the houses.
import { ConeGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, Shape, Vector2, Vector3, type Material } from 'three';
import { block } from './houses';
import { car } from './cars';
import type { Kit } from './kit';
import { CURB, SIDE, SIDE_TURN, Z, cars, lamps, openings, rng, sidePoint, toOutside, type House, type Tree } from './plan';
import { WALL_T, WINDOW } from '../roomplan';

type P = readonly [number, number];

/** How far the street's ground reaches: east and west along the main street, and down the side street (m). */
const REACH = 400, SIDE_END = 320;
/** The gardens' grass and the paths lie a little under the pavements' top. */
const LAWN = CURB - 0.03, PATH = CURB - 0.01;

/** A flat piece of ground: the polygon (x, z) from y0 up to y1, its top's uvs in metres. */
function ground(pts: readonly P[], y0: number, y1: number, m: Material): Mesh {
  const g = new ExtrudeGeometry(new Shape(pts.map(([x, z]) => new Vector2(x, -z))), { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2).translate(0, y0, 0);
  return new Mesh(g, m);
}

const sub = (a: P, b: P): [number, number] => [a[0] - b[0], a[1] - b[1]];
const norm = (a: P): [number, number] => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

/** The convex corner `c` (between the edges to `a` and to `b`) rounded with radius `r`: the arc's points. */
function fillet(a: P, c: P, b: P, r: number, n = 7): P[] {
  const u = norm(sub(a, c)), v = norm(sub(b, c)), half = Math.acos(Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1]))) / 2;
  const d = r / Math.tan(half), bis = norm([u[0] + v[0], u[1] + v[1]]), k = r / Math.sin(half);
  const o: P = [c[0] + bis[0] * k, c[1] + bis[1] * k], t1: P = [c[0] + u[0] * d, c[1] + u[1] * d], t2: P = [c[0] + v[0] * d, c[1] + v[1] * d];
  const a1 = Math.atan2(t1[1] - o[1], t1[0] - o[0]);
  let da = Math.atan2(t2[1] - o[1], t2[0] - o[0]) - a1;
  if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
  const out: P[] = [];
  for (let i = 0; i <= n; i++) { const t = a1 + (da * i) / n; out.push([o[0] + Math.cos(t) * r, o[1] + Math.sin(t) * r]); }
  return out;
}

/** Is the point inside the polygon? */
function inside(poly: readonly P[], p: P): boolean {
  let s = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) s = !s;
  }
  return s;
}

/** A band `w` wide along a path, on the side of it where `into` lies: the kerb stones along a pavement's road edge. */
function band(path: readonly P[], w: number, into: readonly P[]): P[] {
  const off = (side: number) => path.map((p, i) => {
    const a = path[Math.max(0, i - 1)]!, b = path[Math.min(path.length - 1, i + 1)]!, t = norm(sub(b, a));
    return [p[0] - t[1] * w * side, p[1] + t[0] * w * side] as P;
  });
  const m = Math.floor(path.length / 2), o = off(1);
  return [...path, ...(inside(into, o[m]!) ? o : off(-1)).reverse()];
}

/** Where the side street's line `t` across it meets the main street's line at `z`. */
function meet(t: number, z: number): P {
  const [ux, uz] = SIDE.dir;
  return sidePoint((z - Z.kerbFar - ux * t) / uz, t);
}

/** A thing in the side street's frame (x across it, -z along it away from us) at (s, t). */
function sideFrame(s: number, t: number, ...parts: Mesh[]): Group {
  const g = new Group(), [x, z] = sidePoint(s, t);
  g.add(...parts);
  g.position.set(x, 0, z);
  g.rotation.y = SIDE_TURN;
  return g;
}

/** A street lamp: a cast iron column on its base, a square lantern under its cap. Returns where its light is. */
function lamp(g: Group, x: number, z: number, k: Kit): Vector3 {
  const at = (geo: CylinderGeometry | ConeGeometry, m: Material, y: number, turn = 0) => {
    const o = new Mesh(geo, m);
    o.position.set(x, CURB + y, z);
    o.rotation.y = turn;
    g.add(o);
  };
  at(new CylinderGeometry(0.15, 0.2, 0.7, 12), k.post, 0.35);
  at(new CylinderGeometry(0.11, 0.13, 0.12, 12), k.post, 0.76);
  at(new CylinderGeometry(0.055, 0.085, 3.7, 10), k.post, 2.67);
  at(new CylinderGeometry(0.1, 0.07, 0.18, 10), k.post, 4.58);
  at(new CylinderGeometry(0.24, 0.15, 0.55, 4), k.lantern, 4.95, Math.PI / 4);
  at(new ConeGeometry(0.3, 0.32, 4, 1, true), k.post, 5.38, Math.PI / 4);
  at(new CylinderGeometry(0.02, 0.04, 0.22, 6), k.post, 5.6);
  return new Vector3(x, CURB + 4.95, z);
}

/** A front garden in its house's frame: the path to the door, its wall (or hedge) on the pavement with gate piers and a gate, a bin, a hedge to the neighbour. */
function garden(g: Group, h: House, depth: number, k: Kit): void {
  const r = rng(h.seed + 7), door = openings(h).find((o) => o.kind === 'door')!, cx = (door.x0 + door.x1) / 2, hw = h.w / 2;
  g.add(block(cx - 0.6, LAWN - 0.02, 0.6, cx + 0.6, PATH, depth, k.paving));
  const gap0 = cx - 0.65, gap1 = cx + 0.65;
  if (r() < 0.55) {
    // a low wall with a stone coping, a pier each side of the gate with its cap, an iron gate
    const wall = h.wall < 2 ? k.walls[h.wall]! : k.walls[r() < 0.5 ? 0 : 1]!, z0 = depth - 0.3, top = CURB + 0.7;
    for (const [a, b] of [[-hw, gap0 - 0.38], [gap1 + 0.38, hw]] as const) if (b - a > 0.05) {
      g.add(block(a, 0, z0, b, top, depth, wall), block(a - 0.02, top, z0 - 0.04, b + 0.02, top + 0.08, depth + 0.04, k.stone));
    }
    for (const x of [gap0 - 0.19, gap1 + 0.19]) g.add(block(x - 0.19, 0, z0 - 0.04, x + 0.19, top + 0.32, depth + 0.04, wall), block(x - 0.23, top + 0.32, z0 - 0.08, x + 0.23, top + 0.42, depth + 0.08, k.stone));
    const gz = depth - 0.15, gy = CURB + 0.05;
    g.add(block(gap0, gy, gz - 0.02, gap1, gy + 0.05, gz + 0.02, k.iron), block(gap0, gy + 0.8, gz - 0.02, gap1, gy + 0.86, gz + 0.02, k.iron));
    for (let i = 0; i <= 8; i++) { const x = gap0 + 0.04 + (i / 8) * (gap1 - gap0 - 0.08); g.add(block(x - 0.012, gy, gz - 0.012, x + 0.012, gy + 0.86, gz + 0.012, k.iron)); }
  } else {
    // a clipped hedge, broken for the gate
    const hh = CURB + 0.9 + r() * 0.35;
    for (const [a, b] of [[-hw, gap0], [gap1, hw]] as const) if (b - a > 0.05) g.add(block(a, 0, depth - 0.7, b, hh, depth - 0.02, k.hedge));
  }
  if (r() < 0.5) {
    const bx = cx + (cx > 0 ? -1.3 : 1.3);
    g.add(block(bx - 0.29, LAWN, depth - 1.5, bx + 0.29, LAWN + 1.05, depth - 0.78, k.post), block(bx - 0.31, LAWN + 1.05, depth - 1.55, bx + 0.31, LAWN + 1.1, depth - 0.74, k.post));
  }
  if (r() < 0.5) g.add(block(hw - 0.55, 0, 0.2, hw - 0.05, CURB + 0.95, depth - 0.9, k.hedge));
}

/** The streets' still things in one group (to merge), and where the lamps' lights are. */
export function street(k: Kit, hs: readonly House[], ts: readonly Tree[]): { group: Group; lights: Vector3[] } {
  const g = new Group(), r = rng(53), kz = Z.kerbFar;
  // the road: one sheet of asphalt under all
  g.add(ground([[-REACH, 2], [REACH, 2], [REACH, -SIDE_END - 20], [-REACH, -SIDE_END - 20]], -0.05, 0, k.asphalt));

  // the far pavements, each an L round the corner into the side street, the corner rounded; the grass of the gardens and the blocks behind
  for (const s of [-1, 1] as const) {
    const end: P = [s * REACH, kz], p = meet(s * SIDE.kerb, kz), q = sidePoint(SIDE_END, s * SIDE.kerb);
    const edge: P[] = [end, ...fillet(end, p, q, 2.6), q];
    const back: P[] = [sidePoint(SIDE_END, s * SIDE.walk), meet(s * SIDE.walk, Z.walkFar), [s * REACH, Z.walkFar]];
    const walk = [...edge, ...back];
    g.add(ground(walk, 0, CURB, k.paving), ground(band(edge, 0.16, walk), 0, CURB + 0.006, k.kerb));
    g.add(ground([back[2]!, back[1]!, back[0]!, [s * REACH, back[0]![1]]], 0, LAWN, k.grass));
  }
  // our pavement, our garden and its wall along it, a gate and a path for each house of our row (ours by the birch)
  g.add(ground([[-REACH, Z.kerb], [REACH, Z.kerb], [REACH, Z.wall], [-REACH, Z.wall]], 0, CURB, k.paving));
  g.add(block(-REACH, 0, Z.kerb, REACH, CURB + 0.006, Z.kerb + 0.16, k.kerb));
  g.add(ground([[-REACH, Z.wall], [REACH, Z.wall], [REACH, 0], [-REACH, 0]], 0, LAWN, k.grass));
  const ourWall = k.walls[0]!, top = CURB + 0.85;
  let x0 = -REACH;
  for (let gx = 1.2 - 7.8 * 50; gx < REACH; gx += 7.8) {
    if (gx - 0.95 > x0) g.add(block(x0, 0, Z.wall, gx - 0.95, top, Z.wall + 0.3, ourWall), block(x0, top, Z.wall - 0.04, gx - 0.95, top + 0.08, Z.wall + 0.34, k.stone));
    for (const px of [gx - 0.75, gx + 0.75]) g.add(block(px - 0.2, 0, Z.wall - 0.03, px + 0.2, top + 0.3, Z.wall + 0.33, ourWall), block(px - 0.24, top + 0.3, Z.wall - 0.07, px + 0.24, top + 0.4, Z.wall + 0.37, k.stone));
    g.add(block(gx - 0.55, LAWN - 0.02, Z.wall + 0.3, gx + 0.55, PATH, -0.02, k.paving));
    x0 = gx + 0.95;
  }
  g.add(block(x0, 0, Z.wall, REACH, top, Z.wall + 0.3, ourWall));
  // the beds under our wall, and the stone sill under our window
  g.add(block(-REACH, LAWN - 0.02, Z.wall + 0.3, REACH, LAWN + 0.015, Z.wall + 1.0, k.soil));
  const [wx0, sy] = toOutside(WINDOW.x, -(WINDOW.y + WINDOW.h), -WALL_T), [wx1] = toOutside(WINDOW.x + WINDOW.w, 0, 0);
  g.add(block(wx0 - 0.06, sy - 0.08, -0.12, wx1 + 0.06, sy - 0.005, 0.05, k.stone));

  // the gardens across: 7 m deep on the main street, 3.3 m down the side street
  for (const h of hs) {
    const gg = new Group();
    garden(gg, h, h.rot === 0 ? Z.walkFar - Z.front : SIDE.front - SIDE.walk, k);
    gg.position.set(h.x, 0, h.z);
    gg.rotation.y = h.rot;
    g.add(gg);
  }

  // the street trees' pits: a square of soil in the paving, a stone edge round it
  for (const t of ts) {
    if (t.kind !== 'plane' && t.kind !== 'lime') continue;
    const pit = [block(-0.65, CURB - 0.02, -0.65, 0.65, CURB + 0.004, 0.65, k.soil)];
    for (const [a, b, c, d] of [[-0.75, -0.75, 0.75, -0.65], [-0.75, 0.65, 0.75, 0.75], [-0.75, -0.65, -0.65, 0.65], [0.65, -0.65, 0.75, 0.65]] as const) pit.push(block(a, CURB - 0.02, b, c, CURB + 0.012, d, k.kerb));
    const pg = new Group();
    pg.add(...pit);
    pg.position.set(t.x, 0, t.z);
    if (t.kind === 'lime') pg.rotation.y = SIDE_TURN;
    g.add(pg);
  }

  // the road's paint: the main street's broken centre line (not across the junction), the give-way lines at the side street's mouth, its own centre line
  const mid = (Z.kerb + kz) / 2;
  for (let x = -REACH + 2; x < REACH - 3; x += 9) if (x + 3 < -12 || x > 2) g.add(block(x, 0, mid - 0.05, x + 3, 0.004, mid + 0.05, k.paint));
  const marks: Mesh[] = [];
  for (const s of [0.9, 1.35]) for (let t = -SIDE.kerb + 0.15; t < SIDE.kerb - 0.4; t += 0.9) marks.push(block(t, 0, -s - 0.1, t + 0.6, 0.004, -s + 0.1, k.paint));
  g.add(sideFrame(0, 0, ...marks));
  for (let s = 8; s < SIDE_END - 4; s += 9) g.add(sideFrame(s, 0, block(-0.05, 0, -3, 0.05, 0.004, 0, k.paint)));
  // the drains by the kerbs, a few covers in the road
  for (let x = -REACH + 12; x < REACH; x += 24 + r() * 6) {
    if (x > -14 && x < 4) continue;
    g.add(block(x, 0, Z.kerb - 0.42, x + 0.55, 0.008, Z.kerb - 0.02, k.iron), block(x + 3, 0, kz + 0.02, x + 3.55, 0.008, kz + 0.42, k.iron));
  }
  for (const [x, z] of [[-24, -11], [9, -13.5], [36, -10.5], ...[30, 95, 170].map((s) => sidePoint(s, 0.8))] as const) {
    const c = new Mesh(new CylinderGeometry(0.34, 0.34, 0.012, 20), k.iron);
    c.position.set(x, 0.004, z);
    g.add(c);
  }

  // the lamps, the cars
  const lights = lamps().map((l) => lamp(g, l.x, l.z, k));
  for (const c of cars()) g.add(car(c, k));
  return { group: g, lights };
}
