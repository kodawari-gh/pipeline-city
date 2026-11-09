// An RJ45 jack's mouth as the eye meets it (docs/render/case.md "Rear I/O"): the board's rear I/O and the router's ports share it (a network card's
// real-size jack is nic3d's own). Laid out as a wall across x (casekit3d's `wallX`): the mouth opens at x toward -x and runs on into +x, its long
// side across depth z, its latch slot toward +y or -y (layout y). A caller that faces it another way turns the group it builds in.
import { BoxGeometry, Group, type Material, type Mesh, type Vector2 } from 'three';
import { instanced, rectBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { wallPt, wallX, type Span } from './casekit3d';

/**
 * A jack's mouth: its middle (layout y, depth z), its size across z (`w`, the contacts' way) and along y (`h`, contact side to latch side), the
 * latch slot's width and how far it runs on past the latch side, and that side (`dir` +1: toward +y).
 */
export interface Mouth { y: number; z: number; w: number; h: number; slotW: number; slot: number; dir: 1 | -1 }

/** The mouth's outline (`wallPt` points), grown by `e`: the opening, the latch slot on its latch side. */
export function mouthPts(m: Mouth, e = 0): Vector2[] {
  const c = m.y - m.dir * (m.h / 2 + e), l = m.y + m.dir * (m.h / 2 + e), s = m.y + m.dir * (m.h / 2 + m.slot + e);
  const z0 = m.z - m.w / 2 - e, z1 = m.z + m.w / 2 + e, s0 = m.z - m.slotW / 2 - e, s1 = m.z + m.slotW / 2 + e;
  return [wallPt(c, z0), wallPt(c, z1), wallPt(l, z1), wallPt(l, s1), wallPt(s, s1), wallPt(s, s0), wallPt(l, s0), wallPt(l, z0)];
}

/** The springs' gold: a satin plate (a mirror finish deep in a dark mouth only shows the dark round it). */
export const springGold = () => mat(0xd9b25e, { metalness: 0.85, roughness: 0.4 });

/**
 * A mesh in a jack's mouth: it casts no shadow (deep in a narrow mouth its own shadow only shows acne), but it takes the shell's, so in the
 * room the sun and the lamps do not light the mouth's floor.
 */
export const unshadowed = <T extends Mesh>(o: T): T => { o.castShadow = false; o.receiveShadow = true; return o; };

/** A jack's face: its shell, the insert and the springs in the mouth, the link and activity lights. */
export interface JackLook { shell: Material; insert: Material; contact: Material; link: Material; act: Material }

/** The look of a jack in this shell: the black insert, satin gold springs, a green link light and an amber activity light. */
export const jackLook = (shell: Material): JackLook => {
  const light = (c: number) => mat(0x111111, { emissive: c, emissiveIntensity: 0.8, roughness: 0.3 });
  return { shell, insert: mat(0x111214, { roughness: 0.9 }), contact: springGold(), link: light(0x58e08a), act: light(0xffb547) };
};

/**
 * A compact jack's face (the board's rear I/O's, a router's ports), `k` units a mm from its width (13.75 mm over the span's depth z): the steel
 * shell over the span `s` (its face at x, 1 mm thick), the mouth sunk through it (the plug's fit, plugs3d's `boardRj45`) with its latch slot
 * toward +y, the insert `deep` behind (`jackInside`), the lights in their windows on the contact side's corners. Returns the mouth.
 */
export function jackFace(g: Group, x: number, s: Span, deep: number, M: JackLook): Mouth {
  const k = (s.z1 - s.z0) / 13.75, zm = (s.z0 + s.z1) / 2, a = s.y0 + 1.4 * k, b = s.y1 - 1.05 * k, n = s.y1 - 0.35 * k;
  const m: Mouth = { y: (a + b) / 2, z: zm, w: 11.68 * k, h: b - a, slotW: 4.2 * k, slot: n - b, dir: 1 };
  const win = (side: number): Span => ({ y0: s.y0 + 0.25 * k, y1: s.y0 + 1.05 * k, z0: zm + side * 3.45 * k - 1.1 * k, z1: zm + side * 3.45 * k + 1.1 * k, r: 0.17 * k });
  // (the shell's opening a hair wider than the insert's lip)
  g.add(wallX(x, x + 1.05 * k, s, [mouthPts(m, 0.13 * k), win(-1), win(1)], M.shell));
  const e = 0.35 * k;
  jackInside(g, x + 0.1 * k, deep, m, { y0: s.y0 + e, y1: s.y1 - e, z0: s.z0 + e, z1: s.z1 - e }, k, M.insert, M.contact);
  // the lights' lenses, a hair proud of the insert's face behind them
  for (const [side, lm] of [[-1, M.link], [1, M.act]] as const) {
    const w = win(side), lens = rectBox({ x: x + 0.05 * k, y: w.y0, w: 0.86 * k, h: w.y1 - w.y0 }, w.z0, w.z1, lm);
    lens.receiveShadow = false;
    g.add(lens);
  }
  return m;
}

/**
 * What is seen in a jack's mouth `m` opening at x: the plastic insert round it to `deep` (its outside the span `outer`, which the shell holds) and
 * its back; the eight contact springs at the 1.02 mm pitch (`k` units a mm), each from the contact side's lip sloping back in toward the latch
 * side; the comb's ribs between them. The plug's blades meet the springs; its latch rides in the slot.
 */
export function jackInside(g: Group, x: number, deep: number, m: Mouth, outer: Span, k: number, insert: Material, contact: Material): void {
  const c = m.y - m.dir * (m.h / 2), s = m.y + m.dir * (m.h / 2 + m.slot), pitch = 1.02 * k;
  // (the insert's outside holds the whole mouth with a rim: a cut that meets the outline breaks the faces)
  const e = 0.3 * k, o: Span = { y0: Math.min(outer.y0, Math.min(c, s) - e), y1: Math.max(outer.y1, Math.max(c, s) + e), z0: Math.min(outer.z0, m.z - m.w / 2 - e), z1: Math.max(outer.z1, m.z + m.w / 2 + e) };
  g.add(unshadowed(wallX(x, x + deep, o, [mouthPts(m)], insert)));
  g.add(unshadowed(rectBox({ x: x + deep - k, y: Math.min(c, s), w: k, h: Math.abs(s - c) }, m.z - m.w / 2, m.z + m.w / 2, insert)));
  // the springs: from just inside the lip, sloping in toward the latch side as they run back, as far as the plug's blades reach
  const ax = x + 1.2 * k, bx = x + Math.min(deep - 2 * k, 9 * k), ay = c + m.dir * 0.35 * k, by = c + m.dir * Math.min(2.4 * k, m.h * 0.4);
  const len = Math.hypot(bx - ax, by - ay), rz = Math.atan2(-(by - ay), bx - ax);
  g.add(unshadowed(instanced(new BoxGeometry(1, 1, 1), contact, Array.from({ length: 8 }, (_, i) => ({ x: (ax + bx) / 2, y: -(ay + by) / 2, z: m.z + (i - 3.5) * pitch, sx: len, sy: 0.25 * k, sz: 0.42 * k, rz })))));
  // the comb: a rib between each pair of springs (and one past each end), standing off the contact side behind the lip
  const rh = Math.min(1.3 * k, m.h * 0.22), rx = x + 3 * k;
  g.add(unshadowed(instanced(new BoxGeometry(1, 1, 1), insert, Array.from({ length: 9 }, (_, i) => ({ x: (rx + x + deep) / 2, y: -(c + (m.dir * rh) / 2), z: m.z + (i - 4) * pitch, sx: x + deep - rx, sy: rh, sz: 0.3 * k })))));
}
