// The room's lived-in mess in 3D: what a person leaves about. A backpack dropped against the desk's drawer unit, a power strip on the floor under
// the desk with its leads, books stacked on the floor by the window and on the sill, a flattened delivery box against the bookcase. Plain
// scenery at real sizes (layout x and y, y down from the ceiling side; z out of the back wall), nothing answers a click.
import { Group, Mesh, type Material } from 'three';
import { place, rectBox, softBox, tube } from '@/core/render/three/geometry';
import { cloth, mat } from '@/core/render/three/materials';
import { pillow, weave } from './furniture3d';
import { BOOKCASE, FLOOR_Y, WINDOW } from './roomplan';

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
  const g = new Group(), pages = mat(0xf1ece0, { roughness: 0.9 });
  let top = y;
  for (const [w, h, d, colour, turn] of books) {
    g.add(flatBook(x, top, z, w * MM, h * MM, d * MM, mat(colour, { roughness: 0.75 }), pages, turn));
    top -= h * MM;
  }
  return g;
}

/** The mess, round the desk (`ped`: the x of the drawer unit's west face). */
export function mess(ped: number): Group {
  const g = new Group(), fl = FLOOR_Y;

  // ---- the backpack: dropped against the drawer unit's side, leaning on it; a front pocket, a grab loop, the straps lying out ----
  const pack = new Group(), canvas = cloth(0xffffff, { map: weave('#3c4654', { repeat: [3, 4] }) }), black = mat(0x1d1e21, { roughness: 0.6 });
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
  for (const s of [-1, 1]) pack.add(tube([[s * 90, 400, -70], [s * 105, 250, -95], [s * 115, 60, -110], [s * 140, 8, -250], [s * 150, 6, -360]].map(([a, b, c]) => [a! * MM, b! * MM, c! * MM] as const), 14 * MM, black, 6));
  pack.rotation.set(0.0, -Math.PI / 2 + 0.25, 0.16);
  pack.position.set(ped - 120 * MM, -fl, 9500);
  g.add(pack);

  // ---- the power strip on the floor under the desk, its leads up the back to the desk's things ----
  const white = mat(0xf2f1ee, { roughness: 0.4 }), lead = mat(0x1e1f22, { roughness: 0.55 }), sx = ped - 6200, sz = 2600;
  g.add(softBox({ x: sx, y: fl - 45 * MM, w: 330 * MM, h: 45 * MM }, sz, sz + 55 * MM, white, 200));
  for (let k = 0; k < 4; k++) {
    const px = sx + (40 + k * 75) * MM;
    g.add(softBox({ x: px, y: fl - 75 * MM, w: 45 * MM, h: 32 * MM }, sz + 6 * MM, sz + 48 * MM, lead, 120));
    g.add(tube([[px + 22 * MM, -fl + 60 * MM, sz + 20 * MM], [px + (k - 1.5) * 900, -fl + 300, sz - 900], [px + (k - 1.5) * 1400, -fl + 4000, 500], [px + (k - 1.5) * 1600, -fl + 11000, 350]], 70, lead, 6));
  }
  g.add(tube([[sx, -fl + 25 * MM, sz + 27 * MM], [sx - 2500, -fl + 30, sz + 1400], [sx - 6000, -fl + 30, sz + 300], [sx - 9000, -fl + 30, 300], [sx - 9200, -fl + 1500, 160]], 75, white, 6));

  // ---- books: a pile on the floor in front of the radiator, two on the sill ----
  g.add(pile(WINDOW.x + 2600, fl, 7600, [[240, 34, 170, 0x2f4b63, 0.12], [230, 22, 155, 0xd9d4c8, -0.08], [210, 40, 140, 0x8a3b2e, 0.2], [180, 18, 120, 0x2a2a2a, -0.05]]));
  g.add(pile(WINDOW.x + 1800, WINDOW.y + WINDOW.h, 1200, [[200, 24, 135, 0xc9a14a, -0.1], [190, 16, 130, 0x3d5a4a, 0.08]]));

  // ---- a flattened delivery box against the bookcase's side, its tape across ----
  const card = mat(0xffffff, { map: weave('#b88e5e', { repeat: [2, 2] }), roughness: 0.9 }), tape = mat(0xcdb58c, { roughness: 0.35 });
  const box = new Group(), bw = 520 * MM, bh = 430 * MM;
  box.add(softBox({ x: -bw / 2, y: -bh, w: bw, h: bh }, -60 * MM / 2, 60 * MM / 2, card, 40));
  box.add(rectBox({ x: -bw / 2 - 10, y: -bh * 0.55, w: bw + 20, h: 48 * MM }, -32 * MM, 32 * MM, tape));
  box.rotation.set(-0.18, Math.PI / 2, 0);
  box.position.set(BOOKCASE.x + BOOKCASE.w + 700, -fl, BOOKCASE.z1 + 400 + bw / 2);
  g.add(box);

  return g;
}
