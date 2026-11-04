// The streets' ground and what stands on it (`plan.ts` gives the places): the asphalt under the whole grid, each block's pavement round it,
// the parks' lawns and paths, the road's paint near the window (lane lines, the avenues' double centre line, zebra crossings and stop lines),
// the tree pits, the street lamps with their arms over the road, the traffic lights at the near crossings, the cars, and the stone sill under
// our own window. All on the kit's materials, merged by `view.ts`.
import { CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import { car } from './cars';
import type { Kit } from './kit';
import { block } from './parts';
import { CURB, DETAIL, GRID, PARKS, avenueX, blockRect, cars, lamps, streetZ, toOutside, type Lamp, type Tree } from './plan';
import { WALL_T, WINDOW } from '../roomplan';

/** How far the grid's ground reaches each way (m). */
const REACH_X = 2400, REACH_Z = 4600;
/** A painted line's height over the road. */
const PAINT = 0.006;

/** A modern street lamp: a tapered steel pole, an arm out over the road, a flat head with its glowing lens. Returns where its light is. */
function lamp(g: Group, l: Lamp, k: Kit): Vector3 {
  const lg = new Group(), pole = new Mesh(new CylinderGeometry(0.07, 0.12, 8.2, 10), k.post);
  pole.position.y = CURB + 4.1;
  lg.add(pole, block(-0.06, CURB + 7.95, -0.05, 2.3, CURB + 8.05, 0.05, k.post));
  lg.add(block(1.7, CURB + 7.86, -0.2, 2.6, CURB + 8.02, 0.2, k.post), block(1.75, CURB + 7.84, -0.16, 2.55, CURB + 7.87, 0.16, k.lantern));
  lg.position.set(l.x, 0, l.z);
  lg.rotation.y = l.rot;
  g.add(lg);
  return new Vector3(l.x + Math.cos(l.rot) * 2.15, CURB + 7.6, l.z - Math.sin(l.rot) * 2.15);
}

/** A traffic light on a crossing's corner: its pole, the arm over the road, the head with its three lamps' hoods. */
function signal(g: Group, x: number, z: number, rot: number, k: Kit): void {
  const s = new Group(), pole = new Mesh(new CylinderGeometry(0.1, 0.12, 6, 10), k.iron);
  pole.position.y = CURB + 3;
  s.add(pole, block(0, CURB + 5.8, -0.06, 6, CURB + 5.92, 0.06, k.iron), block(4.6, CURB + 4.7, -0.2, 5.0, CURB + 5.8, 0.2, k.trim));
  s.position.set(x, 0, z);
  s.rotation.y = rot;
  g.add(s);
}

/** The streets' still things in one group (to merge), and where the lamps' lights are. */
export function street(k: Kit, ts: readonly Tree[]): { group: Group; lights: Vector3[] } {
  const g = new Group();
  // the asphalt under the whole grid
  g.add(block(-REACH_X, -0.05, -REACH_Z, REACH_X, 0, 2, k.asphalt));
  // each block's pavement out to the kerbs; a park's lawn inside its pavement, two paths crossing it
  const w = GRID.walk;
  for (let j = 0; j < GRID.rows; j++) for (let i = -GRID.cols; i < GRID.cols; i++) {
    const b = blockRect(i, j), far = Math.hypot((b.x0 + b.x1) / 2, b.z1) > 1800;
    g.add(block(b.x0 - w, 0, b.z0 - w, b.x1 + w, CURB, b.z1 + w, far ? k.kerb : k.paving));
    if (PARKS.some(([a, c]) => a === i && c === j)) {
      g.add(block(b.x0 + 1, CURB, b.z0 + 1, b.x1 - 1, CURB + 0.08, b.z1 - 1, k.grass));
      const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
      g.add(block(mx - 2, CURB + 0.08, b.z0 + 1, mx + 2, CURB + 0.1, b.z1 - 1, k.paving), block(b.x0 + 1, CURB + 0.08, mz - 2, b.x1 - 1, CURB + 0.1, mz + 2, k.paving));
    }
  }
  // our own pavement under the window
  g.add(block(-REACH_X, 0, -w, REACH_X, CURB, 2, k.paving));

  // the road's paint near the window: the avenues' double centre line and lane lines, the streets' centre dashes, zebras and stop lines
  const road = GRID.avenue / 2 - w, sroad = GRID.street / 2 - w;
  for (let i = -3; i <= 3; i++) {
    const x = avenueX(i);
    for (let j = 0; j < 8; j++) {
      const z1 = streetZ(j) - GRID.street / 2, z0 = streetZ(j + 1) + GRID.street / 2;
      for (const dx of [-0.2, 0.2]) g.add(block(x + dx - 0.06, 0, z0 + 3, x + dx + 0.06, PAINT, z1 - 3, k.yellow));
      for (const lx of [-road / 2, road / 2]) for (let z = z1 - 4; z > z0 + 4; z -= 9) g.add(block(x + lx - 0.07, 0, z - 3, x + lx + 0.07, PAINT, z, k.paint));
      // the zebra across the avenue at the crossing's near and far side, the stop lines before them
      for (const [zc, side] of [[z1 + 1.8, 1], [z0 - 1.8, -1]] as const) {
        for (let s = -road + 0.4; s < road - 0.4; s += 1.1) g.add(block(x + s, 0, zc - 1.6, x + s + 0.6, PAINT, zc + 1.6, k.paint));
        g.add(block(side > 0 ? x : x - road, 0, zc - side * 2.4 - 0.2, side > 0 ? x + road : x, PAINT, zc - side * 2.4 + 0.2, k.paint));
      }
    }
  }
  for (let j = 0; j < 8; j++) {
    const z = streetZ(j);
    for (let i = -4; i < 4; i++) {
      const x0 = avenueX(i) + GRID.avenue / 2, x1 = avenueX(i + 1) - GRID.avenue / 2;
      for (let x = x0 + 4; x < x1 - 6; x += 7) g.add(block(x, 0, z - 0.07, x + 3, PAINT, z + 0.07, k.paint));
      for (const xc of [x0 - 1.8, x1 + 1.8]) for (let s = -sroad + 0.4; s < sroad - 0.4; s += 1.1) g.add(block(xc - 1.6, 0, z + s, xc + 1.6, PAINT, z + s + 0.6, k.paint));
    }
  }
  // the drains by the kerbs
  for (let i = -2; i <= 2; i++) for (let z = -30; z > -DETAIL; z -= 37) for (const s of [-1, 1]) {
    const x = avenueX(i) + s * (road - 0.25);
    g.add(block(x - 0.25, 0, z, x + 0.25, PAINT * 2, z + 0.6, k.iron));
  }

  // the street trees' pits: a square of soil in the paving, an iron grille round it
  for (const t of ts) {
    if (t.kind === 'shrub') continue;
    g.add(block(t.x - 0.7, CURB - 0.02, t.z - 0.7, t.x + 0.7, CURB + 0.004, t.z + 0.7, k.soil));
    for (const [a, b, c, d] of [[-0.8, -0.8, 0.8, -0.7], [-0.8, 0.7, 0.8, 0.8], [-0.8, -0.7, -0.7, 0.7], [0.7, -0.7, 0.8, 0.7]] as const) g.add(block(t.x + a, CURB - 0.02, t.z + b, t.x + c, CURB + 0.012, t.z + d, k.iron));
  }

  // the traffic lights at the near crossings of the avenue we look down
  for (let j = 0; j < 4; j++) for (const i of [0, 1, -1]) {
    const x = avenueX(i), z = streetZ(j);
    signal(g, x + GRID.avenue / 2 - 1, z - GRID.street / 2 + 1, Math.PI, k);
    signal(g, x - GRID.avenue / 2 + 1, z + GRID.street / 2 - 1, 0, k);
  }

  // the stone sill under our window
  const [wx0, sy] = toOutside(WINDOW.x, -(WINDOW.y + WINDOW.h), -WALL_T), [wx1] = toOutside(WINDOW.x + WINDOW.w, 0, 0);
  g.add(block(wx0 - 0.06, sy - 0.08, -0.12, wx1 + 0.06, sy - 0.005, 0.05, k.stone));

  const lights = lamps().map((l) => lamp(g, l, k));
  for (const c of cars()) g.add(car(c, k));
  return { group: g, lights };
}
