// The paper lanterns: the floating bedside drawer with its lantern, book and phone (`nightstand`), and the tall floor lantern (`floorLantern`).
import { Group, LatheGeometry, Mesh, TorusGeometry, Vector2 } from 'three';
import { SEG, place, rectBox, rod, softBox } from '@/core/render/three/geometry';
import { cloth, mat } from '@/core/render/three/materials';
import { PAPER, STEEL, VENEER, VENEER_GRAIN } from '../palette';
import { FLOOR_LANTERN, FLOOR_Y, NIGHTSTAND } from '../roomplan';
import { stream } from './seed';
import { board, floorShadow } from './shapes';
import { oak, weave } from './textures';
import { lanternBulb, lanternProfile, thinIndices, washiShade, washiTex } from './washi';
import type { Material, MeshStandardMaterial, V3 } from './types';

/** A paper lantern: what holds it, its paper (glows with its bulb), its bulb's glow and where the bulb is (the light's place). */
export interface Lantern {
  root: Group;
  shade: MeshStandardMaterial;
  glow: MeshStandardMaterial;
  bulb: [number, number, number];
}
export type Bedside = Lantern;

/** A floating bedside drawer on the wall (black-brown, one flush push-open front in a shadow line), a paper lantern on a black wire stand, a book and a phone. */
export function nightstand(): Bedside {
  const g = new Group(),
    { x, w, z0, z1, top, h } = NIGHTSTAND,
    cx = x + w / 2,
    cz = (z0 + z1) / 2;
  const veneer = mat(0xff_ff_ff, { map: oak(VENEER, VENEER_GRAIN), roughness: 0.5 }),
    black = mat(STEEL, { roughness: 0.45, metalness: 0.3 });
  // the box on the wall, the drawer's front nearly flush in it, a dark gap round the front
  g.add(board({ x, y: top, w, h }, [z0, z1], veneer));
  g.add(
    rectBox({ x: x + 180, y: top + 180, w: w - 360, h: h - 360 }, z1 - 40, z1 + 6, mat(0x05_06_08, { roughness: 0.9 })),
  );
  g.add(board({ x: x + 210, y: top + 210, w: w - 420, h: h - 420 }, [z1 - 40, z1 + 10], veneer));
  const lantern = bedsideLantern(g, black);
  bedsideBook(g);
  // (it floats: its shadow on the floor is soft and faint)
  g.add(floorShadow([cx, cz + 300], [w * 1.3, (z1 - z0) * 1.4], { k: 0.3 }));
  return { root: g, ...lantern };
}

/**
 * The bedside lantern: a paper round on bamboo ribs, open top and bottom (a black wire ring at each), on a wire stand of three legs; it glows
 * from the bulb inside.
 */
function bedsideLantern(g: Group, black: Material): Omit<Lantern, 'root'> {
  const { x, z0, z1, top, lamp } = NIGHTSTAND,
    lx = x + lamp.dx,
    lz = (z0 + z1) / 2 + lamp.dz,
    legH = 300,
    sh = lamp.h - legH,
    rb = 0.5 * lamp.r,
    rt = 0.42 * lamp.r,
    y0 = -top + legH;
  const paper = washiTex();
  const shade = washiShade(paper, paper);
  const { yb, yt } = bedsidePaper(g, shade, { R: lamp.r, sh, rb, rt, at: [lx, y0, lz] });
  for (const [r, y] of [
    [rb, yb],
    [rt, yt],
  ] as const) {
    const ring = place(new Mesh(new TorusGeometry(r, 26, SEG.tube, SEG.lathe), black));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(lx, y, lz);
    g.add(ring);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4,
      c = Math.cos(a),
      s = Math.sin(a);
    g.add(
      rod([lx + c * (rb + 260), -top + 20, lz + s * (rb + 260)], [lx + c * rb, yb, lz + s * rb], 24, black, SEG.cord),
    );
  }
  const by = y0 + sh / 2;
  const glow = lanternBulb(g, [lx, by, lz]);
  return { shade, glow, bulb: [lx, by, lz] };
}

/**
 * The bedside lantern's paper at `at`, `R` round, `sh` tall, its rims `rb` and `rt` round; the heights of its two rims. The side keeps its
 * ends and its bends (at most `SEG.latheProfile` points); the paper's rings keep their place on it: each point's v is its place along the
 * full side.
 */
function bedsidePaper(
  g: Group,
  shade: Material,
  p: { R: number; sh: number; rb: number; rt: number; at: V3 },
): { yb: number; yt: number } {
  const full = lanternProfile(p.R, p.sh, { rBottom: p.rb, rTop: p.rt }),
    kept = thinIndices(full, SEG.latheProfile),
    prof = kept.map((i) => full[i] ?? new Vector2());
  const lanternGeo = new LatheGeometry(prof, SEG.lathe),
    luv = lanternGeo.getAttribute('uv');
  for (let k = 0; k < luv.count; k++) {
    luv.setY(k, (kept[k % kept.length] ?? 0) / (full.length - 1));
  }
  const lantern = place(new Mesh(lanternGeo, shade));
  lantern.position.set(...p.at);
  g.add(lantern);
  return { yb: p.at[1] + (prof[0]?.y ?? 0), yt: p.at[1] + (prof.at(-1)?.y ?? 0) };
}

/** A hardcover lying flat on the drawer (linen boards over a cream page block, its spine east), the phone on it, a little turned. */
function bedsideBook(g: Group): void {
  const { x, w, z0, z1, top } = NIGHTSTAND,
    cx = x + w / 2,
    cz = (z0 + z1) / 2;
  const bx0 = cx + 950,
    bx1 = x + w - 100,
    bz0 = cz - 1900,
    bz1 = cz + 2100,
    bh = 420,
    linen = cloth(0xff_ff_ff, { map: weave('#8d8a80', { repeat: [2, 2] }), roughness: 0.85 });
  g.add(
    softBox({ x: bx0, y: top - 55, w: bx1 - bx0, h: 55 }, bz0, bz1, linen, 20),
    softBox({ x: bx0, y: top - bh, w: bx1 - bx0, h: 55 }, bz0, bz1, linen, 20),
  );
  g.add(
    rectBox(
      { x: bx0 + 50, y: top - bh + 50, w: bx1 - bx0 - 160, h: bh - 100 },
      bz0 + 70,
      bz1 - 70,
      mat(PAPER, { roughness: 0.9 }),
    ),
  );
  g.add(softBox({ x: bx1 - 170, y: top - bh, w: 170, h: bh }, bz0, bz1, linen, 70));
  const phone = new Group(),
    alu = mat(0x2a_2d_32, { metalness: 0.7, roughness: 0.35 }),
    glass = mat(0x05_06_08, { roughness: 0.06, metalness: 0.1 });
  phone.add(
    softBox({ x: -700, y: -150, w: 1400, h: 150 }, -1425, 1425, alu, 60),
    softBox({ x: -665, y: -162, w: 1330, h: 24 }, -1390, 1390, glass, 10),
  );
  phone.position.set(cx + 2200, -(top - bh), cz + 100);
  phone.rotation.y = 0.18;
  g.add(phone);
}

/**
 * A tall paper floor lantern (`FLOOR_LANTERN`): a column of the same washi on bamboo rings, a little barrelled, open at the top, on a black
 * wire foot of three legs; its bulb on a stem up the middle, its paper glowing with it.
 */
export function floorLantern(): Lantern {
  const g = new Group(),
    { x, z, r: R, legs } = FLOOR_LANTERN,
    bulbAt = 0.55;
  const black = mat(STEEL, { roughness: 0.45, metalness: 0.3 });
  // (the same paper twice, the glow's darker away from the bulb: a tall paper is lit by it unevenly)
  const paper = washiTex(undefined, stream(29)),
    lit = washiTex((v) => 0.42 + 0.58 * Math.exp(-(((v - bulbAt) / 0.32) ** 2)), stream(29));
  const shade = washiShade(paper, lit);
  const prof = floorLanternSide(),
    y0 = -FLOOR_Y + legs,
    col = place(new Mesh(new LatheGeometry(prof, SEG.lathe), shade));
  col.position.set(x, y0, z);
  g.add(col);
  const by = y0 + FLOOR_LANTERN.h * bulbAt;
  floorLanternStand(g, black, { r0: prof[0]?.x ?? 0, rTop: prof.at(-1)?.x ?? 0, y0, by });
  const glow = lanternBulb(g, [x, by, z]);
  g.add(floorShadow([x, z], [R * 2.6, R * 2.6], { k: 0.35 }));
  return { root: g, shade, glow, bulb: [x, by, z] };
}

/**
 * The floor lantern's side, bottom to top: fullest at the middle. Two profile points a rib (the ribs are on the paper's texture), the paper
 * dipping a little at the middle of each rib.
 */
function floorLanternSide(): Vector2[] {
  const { r: R, h: H } = FLOOR_LANTERN,
    m = SEG.floorLanternProfile - 1,
    prof: Vector2[] = [];
  for (let k = 0; k <= m; k++) {
    prof.push(new Vector2(R * (0.93 + 0.07 * Math.sin((Math.PI * k) / m)) * (1 - 0.012 * (k % 2)), (H * k) / m));
  }
  return prof;
}

/**
 * The floor lantern's wire: a ring round each rim (`r0` the bottom's at `y0`, `rTop` the top's), its three legs to the floor, and a cross of
 * wire in the bottom ring that holds the bulb's stem (the bulb at `by`, a little over the middle).
 */
function floorLanternStand(g: Group, black: Material, s: { r0: number; rTop: number; y0: number; by: number }): void {
  const { x, z, h: H } = FLOOR_LANTERN,
    fl = FLOOR_Y,
    { r0, y0 } = s;
  for (const [r, y] of [
    [r0, y0],
    [s.rTop, y0 + H],
  ] as const) {
    const ring = place(new Mesh(new TorusGeometry(r, 30, SEG.tube, SEG.lathe), black));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y, z);
    g.add(ring);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.9,
      c = Math.cos(a),
      sn = Math.sin(a);
    g.add(rod([x + c * (r0 + 500), -fl + 20, z + sn * (r0 + 500)], [x + c * r0, y0, z + sn * r0], 30, black, SEG.cord));
  }
  g.add(
    rod([x - r0, y0, z], [x + r0, y0, z], 22, black, SEG.thinTube),
    rod([x, y0, z - r0], [x, y0, z + r0], 22, black, SEG.thinTube),
    rod([x, y0, z], [x, s.by - 400, z], 40, black, SEG.cord),
  );
}
