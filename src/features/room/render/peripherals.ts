import type { Graphics } from 'pixi.js';
import { mix } from '@/core/render/ink';
import { MUG } from './mug';
import type { DeskGeo } from './persp';
import type { Theme } from '@/core/render/theme';

// What lies on the desk in front of the monitor: the mat, the keyboard and the mouse. Each is a small box (or a dome) placed on the desk top in plan: a centre, a
// yaw (they are turned a few degrees, like things somebody uses) and sizes in plan units; a point of it is turned, put on the desk top in the room's perspective
// (`persp.ts`: its sides run to the vanishing point) and lifted by its height. Plan depth is squashed to the screen by `MUG.e`, the same squash as the mug's rim.

type Pt = [number, number];
export interface PeriphLook { plastic: string; plasticLo: string; line: string; paper: string }

/** The keyboard (plan width, plan depth, height), turned `yaw` degrees; the mouse (width, length, height of its crest: about 0.65 of the width, as in the owner's photos). Sizes against the 24 inch. */
export const KEYBOARD = { w: 6200, d: 2900, h: 260, yaw: 7 };
export const MOUSE = { w: 900, l: 1800, h: 575, yaw: -35 };

/** Turns plan points about a centre on the desk top and puts them on the top in perspective: `(px, pz, h)` is across, toward the viewer, and up. */
export function placer(D: DeskGeo, cx: number, cy: number, yawDeg: number) {
  const c = Math.cos((yawDeg * Math.PI) / 180), s = Math.sin((yawDeg * Math.PI) / 180);
  return (px: number, pz: number, h = 0): Pt => {
    const x = cx + px * c - pz * s, y = cy + (px * s + pz * c) * MUG.e;
    return [D.xAt(x, (y - D.P.yH) / (D.yBack - D.P.yH)), y - h];
  };
}

/** Where the keyboard is (its centre at the feet line, a little west of the monitor's middle, so its right end clears the mouse). */
export const keyboardPlacer = (D: DeskGeo, monitorCx: number) => placer(D, monitorCx - 800, D.ys + 40, KEYBOARD.yaw);
export const mousePlacer = (D: DeskGeo, monitorCx: number) => placer(D, monitorCx + MOUSE_DX, D.ys + 130, MOUSE.yaw);

/** Where the mouse is across, from the monitor's middle. */
const MOUSE_DX = 4000;
const flat = (pts: Pt[]) => pts.flat();

/** The mat: a rectangle on the desk top, with a lit front edge. */
export function drawMat(o: Graphics, T: Theme, D: DeskGeo, monitorCx: number) {
  const p = placer(D, monitorCx - 50, D.ys + 120, 0), w = KEYBOARD.w + 4200, d = 4800;
  o.poly(flat([p(-w / 2, -d / 2), p(w / 2, -d / 2), p(w / 2, d / 2), p(-w / 2, d / 2)])).fill({ color: T.dark ? '#141c36' : '#c4cedf' }).stroke({ width: 5, color: '#000000', alpha: 0.2, join: 'round' });
  o.poly(flat([p(-w / 2, d / 2), p(w / 2, d / 2), p(w / 2, d / 2 - 380), p(-w / 2, d / 2 - 380)])).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.4 });
}

/** A soft shadow of a footprint on the desk top: the outline pushed east and toward the viewer (away from the lamp and the window), three times, a little larger and fainter each. */
function contact(o: Graphics, p: ReturnType<typeof placer>, outline: Pt[], a: number) {
  for (const [k, g] of [[1.12, 0.4], [1.07, 0.6], [1.02, 1]] as const) o.poly(flat(outline.map(([x, z]): Pt => { const q = p(x * k + 150, z * k + 60, 0); return [q[0], q[1]]; }))).fill({ color: '#000000', alpha: a * g * 0.45 });
}

/** The keyboard: a box turned a few degrees, its front and the side that faces the vanishing point, and a top of five rows of keycaps (the space bar in the front row) with a pair of lamps at the back. */
export function drawKeyboard(o: Graphics, T: Theme, L: PeriphLook, D: DeskGeo, monitorCx: number) {
  const p = keyboardPlacer(D, monitorCx), { w, d, h } = KEYBOARD, hw = w / 2, hd = d / 2;
  const capCol = T.dark ? '#b8c2e4' : '#ffffff', capEdge = T.dark ? '#4a5679' : '#9aabc8', side = mix(L.plasticLo, '#000000', 0.2), eastSide = monitorCx - 800 < D.P.vx;
  contact(o, p, [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]], T.dark ? 0.5 : 0.35);
  // the faces: the front, the end that faces the vanishing point, the top
  o.poly(flat([p(-hw, hd), p(hw, hd), p(hw, hd, h), p(-hw, hd, h)])).fill({ color: L.plasticLo }).stroke({ width: 5, color: '#000000', alpha: 0.3, join: 'round' });
  const e = eastSide ? hw : -hw;
  o.poly(flat([p(e, hd), p(e, -hd), p(e, -hd, h), p(e, hd, h)])).fill({ color: side }).stroke({ width: 5, color: '#000000', alpha: 0.3, join: 'round' });
  o.poly(flat([p(-hw, hd, h), p(hw, hd, h), p(hw, -hd, h), p(-hw, -hd, h)])).fill({ color: L.plastic }).stroke({ width: 5, color: L.line, join: 'round' });
  o.poly(flat([p(-hw, hd, h), p(hw, hd, h), p(hw, hd - 300, h), p(-hw, hd - 300, h)])).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.35 });
  // the keycaps: rows from the front; each cap is a little proud of the top (a dark front face, a lit top)
  const rows = 5, inset = 260, ix0 = -hw + inset, ix1 = hw - inset, rd = (d - 2 * 300) / rows, lift = 28;
  for (let r = 0; r < rows; r++) {
    const z1 = hd - 330 - r * rd, z0 = z1 - rd * 0.78;
    const n = r === 4 ? 14 : 15, caps: [number, number][] = r === 0 ? [[0, 0.1], [0.11, 0.2], [0.21, 0.3], [0.31, 0.69], [0.7, 0.79], [0.8, 0.89], [0.9, 1]] : Array.from({ length: n }, (_, k) => [k / n + 0.004, (k + 1) / n - 0.004] as [number, number]);
    for (const [a, b] of caps) {
      const x0 = ix0 + (ix1 - ix0) * a, x1 = ix0 + (ix1 - ix0) * b;
      o.poly(flat([p(x0, z1, h), p(x1, z1, h), p(x1, z1, h + lift), p(x0, z1, h + lift)])).fill({ color: mix(capCol, '#000000', 0.18), alpha: T.dark ? 0.78 : 0.97 });
      o.poly(flat([p(x0, z1, h + lift), p(x1, z1, h + lift), p(x1, z0, h + lift), p(x0, z0, h + lift)])).fill({ color: capCol, alpha: T.dark ? 0.78 : 0.97 }).stroke({ width: 3, color: capEdge, alpha: 0.7 });
    }
  }
  for (const [dx, col] of [[hw - 700, '#6dffa6'], [hw - 520, T.dark ? '#33406e' : '#aebbd6']] as const) { const q = p(dx, -hd + 150, h); o.circle(q[0], q[1], 14).fill({ color: col, alpha: 0.9 }); }
}

/** How wide the mouse is at `u` along its length (0 at the buttons, 1 at the palm), as a part of its full width, read off a top-down photo of a gaming mouse: a nearly square front with rounded corners, a slight waist, the widest a little behind the middle, and a round rear. */
const widthAt = (u: number) => {
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  if (u < 0.08) return 0.93 * (1 - (1 - u / 0.08) ** 2.4) ** (1 / 2.4);
  if (u > 0.76) return Math.sqrt(1 - ((u - 0.76) / 0.24) ** 2);
  return 0.93 - 0.015 * Math.sin(Math.PI * smooth(0.2, 0.62, u)) + 0.07 * smooth(0.45, 0.76, u);
};

/** The outline of the mouse's footprint at a scale (z toward the viewer, the palm): the front (the buttons) at the top of a plan, rounded at the corners, the rear round. */
const mouseOutline = (k: number, n = 40): Pt[] => {
  const us = Array.from({ length: n + 1 }, (_, i) => 0.5 - 0.5 * Math.cos((i / n) * Math.PI)); // closer together at the two ends, where the outline turns
  const at = (u: number, side: number): Pt => [side * (MOUSE.w / 2) * widthAt(u) * k, (u - 0.5) * MOUSE.l * k];
  return [...us.map((u) => at(u, 1)), ...[...us].reverse().slice(1, -1).map((u) => at(u, -1))];
};

/** The convex hull of some points (a mouse's silhouette is the hull of its rings). */
function hull(pts: Pt[]): Pt[] {
  const a = [...pts].sort((u, v) => u[0] - v[0] || u[1] - v[1]), cross = (o: Pt, u: Pt, v: Pt) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of a) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...a].reverse()) { while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** The mouse's side line from the owner's drawing, as `[u, height as a part of the crest]` with `u` 0 at the buttons and 1 at the palm: low at the front, a steady climb, the crest about half way, then a long curve down that turns steeply at the rear. (The drawing's scroll-wheel bump is left out: it is a part of its own.) */
/** The skirt's height as a part of the height there. */
const SK = 0.12;
const SIDE: [number, number][] = [[0, 0.34], [0.144, 0.61], [0.294, 0.84], [0.387, 0.955], [0.486, 1], [0.585, 0.983], [0.694, 0.871], [0.784, 0.73], [0.874, 0.53], [0.955, 0.264], [1, 0.15]];
/** The height of the mouse's top line at `u`: a smooth curve through `SIDE` (a cubic that follows the neighbours' slope at each point, level at the crest). */
const heightAt = (u: number) => {
  const n = SIDE.length, slope = (k: number) => (SIDE[k]![0] === 0.486 ? 0 : (SIDE[Math.min(n - 1, k + 1)]![1] - SIDE[Math.max(0, k - 1)]![1]) / (SIDE[Math.min(n - 1, k + 1)]![0] - SIDE[Math.max(0, k - 1)]![0]));
  let i = 0; while (i < n - 2 && u > SIDE[i + 1]![0]) i++;
  const [x0, y0] = SIDE[i]!, [x1, y1] = SIDE[i + 1]!, d = x1 - x0, t = Math.min(1, Math.max(0, (u - x0) / d)), t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * d * slope(i) + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * d * slope(i + 1);
};

/** The mouse, from the owner's wireframe: a body turned a few degrees on the mat, made of cross-sections along its length (the plan from a top-down photo, the top line from a side drawing, the dome section from a back photo), lit tile by tile, on a dark skirt, with a scroll wheel in a slot. It has no cord or buttons yet. */
export function drawMouse(o: Graphics, T: Theme, L: PeriphLook, D: DeskGeo, monitorCx: number) {
  const p = mousePlacer(D, monitorCx), { l, h } = MOUSE;
  const wedge = (z: number) => heightAt(z / l + 0.5);
  const body = mix(L.plastic, '#ffffff', T.dark ? 0.06 : 0), shade = mix(L.plasticLo, '#000000', T.dark ? 0.1 : 0), crown = T.dark ? mix(L.plastic, '#9fb0e0', 0.4) : '#ffffff', skirt = T.dark ? '#0d1122' : '#7e879c';
  contact(o, p, mouseOutline(1), T.dark ? 0.55 : 0.4);
  // the surface is built from cross-sections: at each station along the length (u) the section across the width is the dome's profile `prof` (k of the half width at that station, f of the height there), and the top line along the length is the owner's side drawing, so the side view matches it exactly
  // from the owner's back view: a short dark skirt a little inset, then a dome that is widest at its foot and rounds in all the way up (a superellipse of exponent 2.2 in section)
  const prof: [number, number][] = [[0.93, 0], [0.93, SK], ...Array.from({ length: 13 }, (_, j) => { const u = (j / 12) * (Math.PI / 2) * 0.985; return [Math.max(0.12, 0.995 * Math.cos(u) ** (2 / 2.2)), SK + (1 - SK) * Math.sin(u) ** (2 / 2.2)] as [number, number]; })];
  const NZ = 28, us = Array.from({ length: NZ + 1 }, (_, i) => 0.5 - 0.5 * Math.cos((i / NZ) * Math.PI));
  const grid = us.map((u) => { const z = (u - 0.5) * l, hh = h * heightAt(u), hw = (MOUSE.w / 2) * widthAt(u); return prof.map(([k, f]): [Pt, Pt] => [p(hw * k, z, f * hh), p(-hw * k, z, f * hh)]); });
  const all: Pt[] = grid.flat(2);
  const tile = (i: number) => {
    const um = (us[i]! + us[i + 1]!) / 2, hh = h * heightAt(um), hw = (MOUSE.w / 2) * widthAt(um), du = us[i + 1]! - us[i]!;
    const gz = ((heightAt(us[i + 1]!) - heightAt(us[i]!)) * h) / (du * l); // how fast the top rises toward the viewer
    const dw = ((widthAt(us[i + 1]!) - widthAt(us[i]!)) * (MOUSE.w / 2)) / (du * l); // how fast the half width grows toward the viewer (the outline's slope: its normal turns toward the viewer at the rounded rear)
    for (let j = 0; j + 1 < prof.length; j++) {
      const [k0, f0] = prof[j]!, [k1, f1] = prof[j + 1]!, T = (f1 - f0) * hh / Math.max(1e-3, (k0 - k1) * hw), fa = (f0 + f1) / 2;
      for (const side of [0, 1] as const) {
        // the tile's normal (x east, y up, z toward the viewer): the dome's slope across the width turned to face away from the outline, and the top line's slope along the length; lit from the west, above and a little from the front
        const sg = side === 0 ? 1 : -1, pl = Math.hypot(1, dw * (k0 + k1) / 2) || 1, nx = sg * Math.min(T, 60) / pl, nz = (-dw * (k0 + k1) / 2 * Math.min(T, 60)) / pl - gz * fa, nl = Math.hypot(nx, 1, nz);
        const lit = (-0.5 * nx + 0.8 + 0.4 * nz) / nl / 1.025, col = j === 0 ? skirt : mix(shade, crown, Math.max(0, Math.min(1, 0.6 + 1.2 * (lit - 0.78))));
        o.poly(flat([grid[i]![j]![side], grid[i]![j + 1]![side], grid[i + 1]![j + 1]![side], grid[i + 1]![j]![side]])).fill({ color: col }).stroke({ width: 1.5, color: col });
      }
    }
    // the small flat crown between the two sides of the top ring
    const gt = gz, cl = Math.max(0, Math.min(1, 0.6 + 1.2 * ((0.8 - 0.4 * gt) / Math.hypot(gt, 1) / 1.025 - 0.78))), cc = mix(shade, crown, cl), tp = prof.length - 1;
    o.poly(flat([grid[i]![tp]![0], grid[i]![tp]![1], grid[i + 1]![tp]![1], grid[i + 1]![tp]![0]])).fill({ color: cc }).stroke({ width: 1.5, color: cc });
  };
  // painter's order, from the far end (the buttons) to the near one; the wheel goes in between: the tiles nearer than its slot are drawn after it, because the dome rises behind it (toward the viewer) and hides what is under their line of sight
  const w = wheelGeom(D, monitorCx), zNearEnd = w.zNear + 14;
  for (let i = 0; i < NZ; i++) if ((us[i]! - 0.5) * l < zNearEnd) tile(i);
  drawWheel(o, T, p, w);
  for (let i = 0; i < NZ; i++) if ((us[i]! - 0.5) * l >= zNearEnd) tile(i);
  // the skirt's top edge, on the half toward the viewer only (the far half is behind the body)
  const near = [...grid.slice(NZ >> 1).map((st) => st[1]![0]), ...grid.slice(NZ >> 1).reverse().map((st) => st[1]![1])];
  o.poly(flat(near), false).stroke({ width: 3, color: '#ffffff', alpha: T.dark ? 0.12 : 0.35, join: 'round' });
  o.poly(flat(hull(all))).stroke({ width: 5, color: '#000000', alpha: 0.3, join: 'round' });
}

/** The height of the mouse's shell at a point `(x across, z toward the viewer)` of its plan: the dome's section (a superellipse of exponent 2.2) at that station, scaled to the top line there. */
const shellH = (x: number, z: number) => {
  const u = z / MOUSE.l + 0.5, hw = (MOUSE.w / 2) * widthAt(u), k = Math.min(0.995, Math.abs(x) / Math.max(1, hw));
  return MOUSE.h * heightAt(u) * (SK + (1 - SK) * (1 - (k / 0.995) ** 2.2) ** (1 / 2.2));
};

/** The scroll wheel: a narrow cylinder whose axis runs across the mouse (along x), square to the centre line and through it, a little behind the front, sunk in a slot of the shell so only its top arc stands out. Its ends, the tread's edges and the slot follow the shell's curve. */
const WHEEL = { u: 0.21, r: 200 * MOUSE.w / 1250, w: 120 * MOUSE.w / 1250, out: 120 * MOUSE.w / 1250 }; // the wireframe's numbers (for a mouse 1250 wide), scaled with the mouse
function wheelGeom(D: DeskGeo, monitorCx: number) {
  const { r, w, out } = WHEEL, hw = w / 2, zm = (WHEEL.u - 0.5) * MOUSE.l, th = Math.atan((shellH(0, zm + 20) - shellH(0, zm - 20)) / 40);
  const zc = zm + (r - out) * Math.sin(th), hc = shellH(0, zm) - (r - out) * Math.cos(th); // the circle's centre sits under the shell, square to its slope, so the bump is even on both sides
  const west = monitorCx + MOUSE_DX > D.P.vx; // the mouse is east of the vanishing point: its west side is the one that faces it
  const e = west ? -hw : hw, cz = (a: number) => zc + r * Math.cos(a), ch = (a: number) => hc + r * Math.sin(a);
  // the part of the circle that stands out of the shell at a distance `x` from the centre line (found by stepping out from the top): the shell falls away toward the sides, so the wheel shows more there
  const ex = (x: number): [number, number] => {
    let lo = Math.PI / 2, hi = Math.PI / 2;
    while (lo > -0.6 && ch(lo - 0.02) >= shellH(x, cz(lo - 0.02))) lo -= 0.02;
    while (hi < Math.PI + 0.6 && ch(hi + 0.02) >= shellH(x, cz(hi + 0.02))) hi += 0.02;
    return [lo, hi];
  };
  const [aLo, aHi] = ex(hw);
  return { hw, e, cz, ch, ex, aLo, aHi, zNear: cz(aLo), zFar: cz(aHi) };
}
function drawWheel(o: Graphics, T: Theme, p: ReturnType<typeof placer>, g: ReturnType<typeof wheelGeom>) {
  const { hw, e, cz, ch, ex, aLo, aHi, zNear, zFar } = g, sw = hw + 14, z0 = zFar - 14, z1 = zNear + 14, zs = Array.from({ length: 9 }, (_, i) => z0 + (i / 8) * (z1 - z0));
  const dark = T.dark ? '#141a30' : '#39405a', lite = T.dark ? '#7f8db8' : '#aab3cf';
  // the dark opening in the shell around the wheel
  o.poly(flat([...zs.map((z) => p(-sw, z, shellH(sw, z))), ...[...zs].reverse().map((z) => p(sw, z, shellH(sw, z)))])).fill({ color: T.dark ? '#02030a' : '#262b3d', alpha: 0.75 });
  // the wall at the end that faces the vanishing point (closed below along the shell), then the tread in strips from the far side to the near one, each cut below along the shell at the centre and at both edges
  const n = 14, arc = Array.from({ length: n + 1 }, (_, k) => aHi - (k / n) * (aHi - aLo)), xs = [-hw, 0, hw] as const;
  o.poly(flat([...arc.map((a) => p(e, cz(a), ch(a))), ...Array.from({ length: 7 }, (_, i) => zNear + ((i + 1) / 8) * (zFar - zNear)).map((z) => p(e, z, shellH(e, z)))])).fill({ color: mix(dark, lite, 0.18) }).stroke({ width: 3, color: '#000000', alpha: 0.4, join: 'round' });
  const at = (x: number, a: number): Pt => { const [lo, hi] = ex(Math.abs(x)), b = Math.min(hi, Math.max(lo, a)); return p(x, cz(b), ch(b)); };
  for (let k = 0; k < n; k++) {
    const a1 = arc[k]!, a2 = arc[k + 1]!, am = (a1 + a2) / 2, lit = 0.25 + 0.6 * Math.max(0, Math.sin(am - 0.2)) + (k % 2 ? 0.12 : -0.05);
    o.poly(flat([...xs.map((x) => at(x, a1)), ...[...xs].reverse().map((x) => at(x, a2))])).fill({ color: mix(dark, lite, Math.min(1, lit)) }).stroke({ width: 2, color: '#000000', alpha: 0.25, join: 'round' });
  }
}
