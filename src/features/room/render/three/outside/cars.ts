// The parked cars (`plan.ts` places them): hatchbacks, saloons and estates. Each is a body extruded from its side profile with rounded edges
// and its wheel arches cut, a glasshouse set in from the body's sides under a roof in the paint, a pillar, mirrors, wheels with rims, lamps,
// a grille and plates. In a car's own frame x runs along it (its front at +x), y up from the road, z across; `rot` turns it about y.
import { CylinderGeometry, ExtrudeGeometry, Group, Mesh, Shape, Vector2, type Material } from 'three';
import { block } from './parts';
import type { Kit } from './kit';
import { rng, type Car } from './plan';

/** A wheel's radius and its arch's, the sill's height (m). */
const WHEEL = 0.32, ARCH = 0.39, SILL = 0.2;

type Tail = 'hatch' | 'boot' | 'estate';

/** A shape of (x, y) points, extruded `w` wide across z about the middle, its edges rounded by `round`. */
function extrude(pts: readonly (readonly [number, number])[], w: number, round: number, m: Material): Mesh {
  const g = new ExtrudeGeometry(new Shape(pts.map(([x, y]) => new Vector2(x, y))), {
    depth: w - 2 * round, bevelEnabled: true, bevelThickness: round, bevelSize: round, bevelOffset: -round, bevelSegments: 3, curveSegments: 4,
  });
  g.translate(0, 0, -(w - 2 * round) / 2);
  return new Mesh(g, m);
}

/** The arc over a wheel at x, from its back to its front (the body's lower edge runs that way). */
function arch(x: number): [number, number][] {
  const out: [number, number][] = [[x - ARCH, SILL]];
  for (let i = 0; i <= 8; i++) { const a = Math.PI - (i / 8) * Math.PI; out.push([x + Math.cos(a) * ARCH, WHEEL + Math.sin(a) * ARCH]); }
  out.push([x + ARCH, SILL]);
  return out;
}

/** One car, in its frame, set at its place. */
export function car(c: Car, k: Kit): Group {
  const r = rng(c.seed), g = new Group(), paint = k.car[c.colour]!, q = r();
  const tail: Tail = q < 0.45 ? 'hatch' : q < 0.75 ? 'boot' : 'estate';
  const L = tail === 'hatch' ? Math.min(c.len, 4.2) : c.len, W = 1.76 + r() * 0.06, H = tail === 'estate' ? 1.5 : tail === 'hatch' ? 1.47 : 1.43;
  const half = L / 2, belt = 0.94, hood = tail === 'hatch' ? 0.98 : 1.12, xf = half - 0.86, xr = -half + (tail === 'estate' ? 0.92 : 0.8);
  // the body to the belt line: the nose, the bonnet, the boot (a saloon's deck stands a little higher), the tail, the sills over the wheels
  const deck: [number, number][] = tail === 'boot' ? [[-half + 1.0, belt + 0.03], [-half + 0.16, belt + 0.01]] : [[-half + 0.2, belt]];
  const body: [number, number][] = [
    [half - 0.2, SILL], [half - 0.02, 0.3], [half, 0.5], [half - 0.07, 0.68], [half - 0.45, 0.8], [half - hood, belt + 0.02], ...deck,
    [-half + 0.03, belt - 0.12], [-half, 0.5], [-half + 0.05, 0.3], [-half + 0.22, SILL], ...arch(xr), ...arch(xf),
  ];
  g.add(extrude(body, W, 0.06, paint));
  // the glasshouse, set in from the sides: the windscreen, the roof's line, the rear screen or the tailgate
  const fx = half - hood + 0.04, rf = fx - (tail === 'hatch' ? 0.72 : 0.8), rb = tail === 'boot' ? -half + 1.32 : tail === 'estate' ? -half + 0.24 : -half + 0.5;
  const back: [number, number][] = tail === 'boot' ? [[-half + 1.02, belt + 0.03]] : [[-half + (tail === 'estate' ? 0.07 : 0.12), belt + 0.08]];
  const Wc = W - 0.24;
  g.add(extrude([[fx, belt], [rf, H - 0.04], [rb, H - 0.05], ...back, [fx - 0.2, belt]], Wc, 0.05, k.carGlass));
  // the roof in the paint over the glass, the pillar between the doors, the mirrors
  g.add(block(rf - 0.1, H - 0.07, -Wc / 2 - 0.02, rb + 0.06, H + 0.005, Wc / 2 + 0.02, paint));
  const bx = (rf + rb) / 2 + 0.12;
  g.add(block(bx - 0.06, belt, -Wc / 2 - 0.012, bx + 0.06, H - 0.06, Wc / 2 + 0.012, k.trim));
  for (const s of [-1, 1]) g.add(block(fx - 0.2, belt + 0.06, s * (W / 2 - 0.02), fx - 0.06, belt + 0.17, s * (W / 2 + 0.13), paint));
  // the wheels: a tyre and its rim at each corner
  for (const x of [xf, xr]) for (const s of [-1, 1]) {
    const tyre = new Mesh(new CylinderGeometry(WHEEL, WHEEL, 0.21, 18), k.tyre), rim = new Mesh(new CylinderGeometry(0.2, 0.2, 0.216, 12), k.rim);
    for (const m of [tyre, rim]) { m.rotation.x = Math.PI / 2; m.position.set(x, WHEEL, s * (W / 2 - 0.15)); g.add(m); }
  }
  // the front's lamps, grille and plate; the tail's lamps and plate
  for (const s of [-1, 1]) {
    g.add(block(half - 0.14, 0.58, s * (W / 2 - 0.44), half - 0.02, 0.68, s * (W / 2 - 0.1), k.head));
    g.add(block(-half - 0.004, 0.74, s * (W / 2 - 0.4), -half + 0.1, 0.87, s * (W / 2 - 0.09), k.tail));
  }
  g.add(block(half - 0.06, 0.4, -0.42, half + 0.006, 0.56, 0.42, k.trim), block(half - 0.01, 0.29, -0.26, half + 0.014, 0.4, 0.26, k.plate));
  g.add(block(-half - 0.012, 0.46, -0.26, -half + 0.03, 0.57, 0.26, k.plate));
  g.position.set(c.x, 0, c.z);
  g.rotation.y = c.rot;
  g.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  return g;
}
