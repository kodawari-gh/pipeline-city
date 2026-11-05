// The room's few things about in 3D, kept tidy: a backpack set down against the desk's drawer unit, the power strip in the cable tray under the
// desk (its leads up through the grommet, its own lead down the wall to a socket), two books on the window ledge. Plain scenery at real sizes
// (layout x and y, y down from the ceiling side; z out of the back wall), nothing answers a click.
import { Box3, Group, Mesh, Vector3, type Material } from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { drum, healNormals, place, rectBox, rounded, softBox, tube } from '@/core/render/three/geometry';
import { cloth, mat } from '@/core/render/three/materials';
import { weave } from './furniture3d';
import { FLOOR_Y, TRAY, WINDOW } from './roomplan';

/** Room units per millimetre. */
const MM = 18.7;

/** A soft bag's form in mm: half its width, its height, how far its front and its back stand off its middle, how far its top flops forward. */
interface BagForm { w: number; h: number; front: number; back: number; sag: number }
const bag = (f: BagForm): BagForm => f;
/** |c|^e, the sign kept: the superellipse's way round. */
const sp = (c: number, e: number): number => Math.sign(c) * Math.abs(c) ** e;
/**
 * A point on a bag at `t` round it (0 at +x, the front at +z) and `p` up it (-π/2 its base, π/2 its top): a boxy superellipsoid (flat base,
 * square shoulders, rounded edges), a little narrower at the top, its front fuller in the middle, with soft creases in the front's cloth.
 */
function bagAt(f: BagForm, t: number, p: number, out: Vector3): Vector3 {
  const cp = sp(Math.cos(p), 0.3), y = (f.h / 2) * (1 + sp(Math.sin(p), 0.3)), k = y / f.h, st = sp(Math.sin(t), 0.45);
  const x = f.w * (1 - 0.08 * k) * cp * sp(Math.cos(t), 0.45), d = st > 0 ? f.front * (0.72 + 0.28 * Math.sin(Math.PI * k)) : f.back;
  const crease = st > 0 ? 2.2 * Math.sin(x / 26 + 1.3) * Math.sin(y / 41 + 0.6) * st * cp : 0;
  return out.set(x, y, d * cp * st + crease + f.sag * k * k);
}

/** A book lying flat, its bottom at layout height `y`: a cloth cover and the page block showing on three sides; turned `turn` about its middle. */
function flatBook(x: number, y: number, z: number, w: number, h: number, d: number, cover: Material, pages: Material, turn: number): Group {
  const g = new Group();
  g.add(softBox({ x: -w / 2, y: -h, w, h: h * 0.16 }, -d / 2, d / 2, cover, 20), softBox({ x: -w / 2, y: -h * 0.16, w, h: h * 0.16 }, -d / 2, d / 2, cover, 20));
  g.add(rectBox({ x: -w / 2 + 60, y: -h * 0.86, w: w - 100, h: h * 0.72 }, -d / 2 + 60, d / 2 - 60, pages));
  g.add(softBox({ x: -w / 2, y: -h, w: 180, h }, -d / 2, d / 2, cover, 40));
  g.rotation.y = turn;
  g.position.set(x, -y, z);
  return g;
}

/** A pile of books from the layout height `y` up, each its own size and colour, set a little askew. */
function pile(x: number, y: number, z: number, books: readonly (readonly [number, number, number, number, number])[]): Group {
  const g = new Group(), pages = mat(0xd8d3c6, { roughness: 0.9 });
  let top = y;
  for (const [w, h, d, colour, turn] of books) {
    g.add(flatBook(x, top, z, w * MM, h * MM, d * MM, mat(colour, { roughness: 0.75 }), pages, turn));
    top -= h * MM;
  }
  return g;
}

/**
 * The things round the desk (`ped`: the x of the drawer unit's west face; `under`: the desk top's underside, layout y; `grommet`: where the
 * cables go down through the top, over the tray).
 */
export function mess(ped: number, under: number, grommet: { x: number; z: number }): Group {
  const g = new Group(), fl = FLOOR_Y;

  // ---- the backpack: set down by the drawer unit, its back to it, leant back on it; a front pocket, the zips round the top and across the
  // pocket, a grab loop, the shoulder straps on its back from the top to the bottom corners ----
  const pack = new Group(), canvas = cloth(0xffffff, { map: weave('#343b47', { repeat: [3, 4] }) }), black = mat(0x141517, { roughness: 0.6 });
  const body = bag({ w: 150, h: 430, front: 85, back: 55, sag: 14 }), pocket = bag({ w: 110, h: 190, front: 38, back: 5, sag: 0 });
  const sewn = (f: BagForm) => { const o = place(new Mesh(healNormals(new ParametricGeometry((u: number, v: number, out: Vector3) => bagAt(f, u * Math.PI * 2, -Math.PI / 2 + Math.PI * v, out), 48, 32), 49), canvas)); o.scale.setScalar(MM); return o; };
  const front = sewn(pocket);
  front.position.set(0, 55 * MM, 70 * MM);
  pack.add(sewn(body), front);
  // the zips: the main one up one side, over the top and down the other, near the front; the pocket's across its top
  const zip = (f: BagForm, pts: [number, number][], dy: number, dz: number) => tube(pts.map(([t, p]) => { const q = bagAt(f, t, p, new Vector3()); return [q.x * 1.015 * MM, (q.y * 1.006 + dy) * MM, (q.z * 1.03 + dz) * MM] as const; }), 4 * MM, black, 5);
  const side = (t: number, from: number) => Array.from({ length: 12 }, (_, k) => [t, from + ((Math.PI / 2 - 0.02 - from) * k) / 11] as [number, number]);
  pack.add(zip(body, [...side(0.55, -0.7), ...side(Math.PI - 0.55, -0.7).reverse()], 0, 0));
  pack.add(zip(pocket, Array.from({ length: 12 }, (_, k) => [0.4 + ((Math.PI - 0.8) * k) / 11, 0.85] as [number, number]), 55, 70));
  pack.add(tube([[-50, 418, -10], [-30, 462, 0], [30, 462, 0], [50, 418, -10]].map(([a, b, c]) => [a! * MM, b! * MM, c! * MM] as const), 9 * MM, black, 6));
  // a zip pull on each zip: a small dark tab
  const pull = (q: Vector3, dy: number, dz: number) => rectBox({ x: (q.x - 6) * MM, y: -(q.y + dy) * MM, w: 12 * MM, h: 40 * MM }, (q.z + dz) * MM, (q.z + dz + 6) * MM, black);
  pack.add(pull(bagAt(body, 0.55, 0.9, new Vector3()), 0, 4), pull(bagAt(pocket, 1.1, 0.8, new Vector3()), 55, 74));
  for (const s of [-1, 1]) pack.add(tube([[s * 40, 410, -62], [s * 100, 300, -82], [s * 120, 150, -82], [s * 130, 40, -62]].map(([a, b, c]) => [a! * MM, b! * MM, c! * MM] as const), 14 * MM, black, 6));
  // tilted back about its own width, turned so its back faces the drawer unit (+x); then set down on the floor and moved against the unit's
  // side: it touches both, it goes into neither
  pack.rotation.set(-0.12, -Math.PI / 2 + 0.1, 0, 'YXZ');
  pack.position.set(ped - 3000, -fl, 8000);
  pack.updateMatrixWorld(true);
  const bb = new Box3().setFromObject(pack, true);
  pack.position.x += ped - 20 - bb.max.x;
  pack.position.y += -fl - bb.min.y;
  pack.name = 'backpack';
  g.add(pack);

  // ---- the power strip in the cable tray: four plugs, their leads up into the grommet's sleeve; its own lead out of the tray's back and down
  // the wall to a socket over the skirting ----
  const t = TRAY, base = under + t.drop + t.h - 60, shell = mat(0x1d1e21, { roughness: 0.45 }), lead = mat(0x141517, { roughness: 0.55 });
  const sl = 330 * MM, sw = 55 * MM, sh = 45 * MM, sx = grommet.x - 1200, sz = (t.z0 + t.z1) / 2 - sw / 2, mid = sz + sw / 2;
  g.add(softBox({ x: sx, y: base - sh, w: sl, h: sh }, sz, sz + sw, shell, 200));
  for (let k = 0; k < 4; k++) {
    const px = sx + (40 + k * 75) * MM, top = base - sh - 32 * MM, cx = px + 22 * MM;
    g.add(softBox({ x: px, y: top, w: 45 * MM, h: 32 * MM }, sz + 6 * MM, sz + 48 * MM, lead, 120));
    g.add(tube([[cx, -top, mid], [cx + (grommet.x - cx) * 0.5, -(top - 160), (mid + grommet.z) / 2], [grommet.x + (k - 1.5) * 80, -(under + 200), grommet.z]], 60, lead, 6));
  }
  // (2D y down here; the lead runs on the tray's floor, up its back wall's inside, over its top under the desk, down between it and the wall)
  const wx = t.x0 + 1000, sockY = fl - 3000, ry = under + t.drop - 200;
  const path: [number, number, number][] = [[sx, base - sh / 2, mid], [sx - 600, base - 75, mid], [wx, base - 75, t.z0 + 260], [wx, ry, t.z0 + 260], [wx, ry, 200], [wx, sockY - 1000, 200], [wx, sockY - 400, 380]];
  g.add(tube(rounded(path.map(([x, y, z]) => [x, -y, z] as const), 250), 70, lead, 6));
  // the socket: a flat plate on the wall, its outlet, the plug in it
  g.add(softBox({ x: wx - 700, y: sockY - 700, w: 1400, h: 1400 }, 0, 80, mat(0x23262b, { roughness: 0.3 }), 40), drum(wx, sockY, 80, 100, 380, mat(0x15161a, { roughness: 0.6 }), 20));
  g.add(softBox({ x: wx - 300, y: sockY - 400, w: 600, h: 800 }, 100, 660, shell, 100));

  // ---- books: two on the ledge ----
  g.add(pile(WINDOW.x + 1800, WINDOW.y + WINDOW.h, 1200, [[200, 24, 135, 0x26303d, -0.1], [190, 16, 130, 0xd9d6cf, 0.08]]));

  return g;
}
