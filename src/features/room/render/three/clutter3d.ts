// The room's few things about in 3D, kept tidy: a backpack set down against the desk's drawer unit, the power strip in the cable tray under the
// desk (its leads up through the grommet, its own lead down the wall to a socket), two books on the window ledge. Plain scenery at real sizes
// (layout x and y, y down from the ceiling side; z out of the back wall), nothing answers a click.
import { Box3, Group, Mesh, type Material } from 'three';
import { drum, place, rectBox, rounded, softBox, tube } from '@/core/render/three/geometry';
import { cloth, mat } from '@/core/render/three/materials';
import { pillow, weave } from './furniture3d';
import { FLOOR_Y, TRAY, WINDOW } from './roomplan';

/** Room units per millimetre. */
const MM = 18.7;

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

  // ---- the backpack: set down by the drawer unit, its back to it, leant back on it; a front pocket, a grab loop, the shoulder straps on its
  // back from the top to the bottom corners ----
  const pack = new Group(), canvas = cloth(0xffffff, { map: weave('#2b313b', { repeat: [3, 4] }) }), black = mat(0x141517, { roughness: 0.6 });
  const body = place(new Mesh(pillow(300 * MM, 150 * MM, 430 * MM, { pinch: 0.06, lumps: 0.18, seed: 2 }), canvas));
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 215 * MM, 0);
  const pocket = place(new Mesh(pillow(240 * MM, 70 * MM, 200 * MM, { pinch: 0.08, lumps: 0.1, seed: 4 }), canvas));
  pocket.rotation.x = Math.PI / 2;
  pocket.position.set(0, 130 * MM, 80 * MM);
  pack.add(body, pocket);
  pack.add(tube([[-50, 425, -10], [-30, 470, 0], [30, 470, 0], [50, 425, -10]].map(([a, b, c]) => [a! * MM, b! * MM, c! * MM] as const), 9 * MM, black, 6));
  // a zip pull on each zip: a small dark tab
  pack.add(rectBox({ x: 70 * MM, y: -175 * MM, w: 12 * MM, h: 40 * MM }, 116 * MM, 122 * MM, black), rectBox({ x: -100 * MM, y: -380 * MM, w: 12 * MM, h: 40 * MM }, 74 * MM, 80 * MM, black));
  for (const s of [-1, 1]) pack.add(tube([[s * 40, 410, -70], [s * 100, 300, -95], [s * 120, 150, -95], [s * 130, 40, -70]].map(([a, b, c]) => [a! * MM, b! * MM, c! * MM] as const), 14 * MM, black, 6));
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
