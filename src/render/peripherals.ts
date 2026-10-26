import type { Graphics } from 'pixi.js';
import { mix } from './ink';
import { MUG } from './mug';
import type { DeskGeo } from './persp';
import type { Theme } from './theme';

// What lies on the desk in front of the monitor: the mat, the keyboard and the mouse. Each is a small box (or a dome) placed on the desk top in plan: a centre, a
// yaw (they are turned a few degrees, like things somebody uses) and sizes in plan units; a point of it is turned, put on the desk top in the room's perspective
// (`persp.ts`: its sides run to the vanishing point) and lifted by its height. Plan depth is squashed to the screen by `MUG.e`, the same squash as the mug's rim.

type Pt = [number, number];
export interface PeriphLook { plastic: string; plasticLo: string; line: string; paper: string }

/** The keyboard (plan width, plan depth, height), turned `yaw` degrees; the mouse (width, length, height of its dome). Sizes against the 24 inch. */
export const KEYBOARD = { w: 6200, d: 2900, h: 260, yaw: -7 };
export const MOUSE = { w: 1250, l: 2500, h: 430, yaw: -9 };

/** Turns plan points about a centre on the desk top and puts them on the top in perspective: `(px, pz, h)` is across, toward the viewer, and up. */
export function placer(D: DeskGeo, cx: number, cy: number, yawDeg: number) {
  const c = Math.cos((yawDeg * Math.PI) / 180), s = Math.sin((yawDeg * Math.PI) / 180);
  return (px: number, pz: number, h = 0): Pt => {
    const x = cx + px * c - pz * s, y = cy + (px * s + pz * c) * MUG.e;
    return [D.xAt(x, (y - D.P.yH) / (D.yBack - D.P.yH)), y - h];
  };
}

/** Where the keyboard is (its centre at the feet line, a little west of the monitor's middle, so its right end clears the mouse). */
export const keyboardPlacer = (D: DeskGeo, monitorCx: number) => placer(D, monitorCx - 300, D.ys - 210, KEYBOARD.yaw);
export const mousePlacer = (D: DeskGeo, monitorCx: number) => placer(D, monitorCx - 300 + KEYBOARD.w / 2 + 1000, D.ys - 40, MOUSE.yaw);

const flat = (pts: Pt[]) => pts.flat();

/** The mat: a rectangle on the desk top, with a lit front edge. */
export function drawMat(o: Graphics, T: Theme, D: DeskGeo, monitorCx: number) {
  const p = placer(D, monitorCx - 300 + 500, D.ys + 50, 0), w = KEYBOARD.w + 4200, d = 4800;
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
  const capCol = T.dark ? '#b8c2e4' : '#ffffff', capEdge = T.dark ? '#4a5679' : '#9aabc8', side = mix(L.plasticLo, '#000000', 0.2), eastSide = monitorCx - 300 < D.P.vx;
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

/** The mouse: just its basic shape for now (no buttons, seam or wheel): a body turned a few degrees on the mat, built from rings of its outline at rising heights (each band lighter, so the top is round), flat sides and a dark skirt. It has no cord. */
export function drawMouse(o: Graphics, T: Theme, L: PeriphLook, D: DeskGeo, monitorCx: number) {
  const p = mousePlacer(D, monitorCx), { l, h } = MOUSE;
  // a teardrop in profile: higher at the palm (toward the viewer) than at the buttons
  const wedge = (z: number) => { const u = z / l + 0.5; return u <= 0.72 ? 0.34 + 0.66 * Math.sin((u / 0.72) * (Math.PI / 2)) : 1 - 0.14 * ((u - 0.72) / 0.28) ** 2; }; // low at the buttons, the crest about three quarters of the way back, then the rear rounds down
  const ringP = (k: number, f: number) => mouseOutline(k).map(([x, z]) => ({ x, s: p(x, z, f * h * wedge(z)) }));
  const body = mix(L.plastic, '#ffffff', T.dark ? 0.06 : 0), shade = mix(L.plasticLo, '#000000', T.dark ? 0.1 : 0), crown = T.dark ? mix(L.plastic, '#9fb0e0', 0.4) : '#ffffff';
  contact(o, p, mouseOutline(1), T.dark ? 0.55 : 0.4);
  // flat sides: the walls go straight up to half the height, then the shoulder rounds over to the crown
  const prof: [number, number][] = [[0.98, 0], [0.99, 0.09], [0.99, 0.3], [0.99, 0.5], ...Array.from({ length: 8 }, (_, i) => { const u = ((i + 1) / 8) * (Math.PI / 2) * 0.985; return [Math.max(0.3, 0.99 * Math.cos(u) ** 0.7), 0.5 + 0.5 * Math.sin(u) ** 0.9] as [number, number]; })], rings = prof.map(([k, f]) => ringP(k, f)), skirt = T.dark ? '#0d1122' : '#7e879c';
  for (let i = 0; i + 1 < prof.length; i++) {
    const t = Math.max(0, (i - 1) / (prof.length - 3)), col = i === 0 ? skirt : t < 0.5 ? mix(shade, body, t * 2) : mix(body, crown, (t - 0.5) * 2);
    o.poly(flat(hull([...rings[i]!, ...rings[i + 1]!].map((q) => q.s)))).fill({ color: col });
  }
  const edge = rings[1]!.map((q) => q.s), mid = edge.reduce((m, q) => m + q[1], 0) / edge.length, near = edge.filter((q) => q[1] >= mid); // the skirt's top edge, the half toward the viewer only (the far half is behind the body)
  o.poly(flat(near), false).stroke({ width: 3, color: '#ffffff', alpha: T.dark ? 0.12 : 0.35, join: 'round' });
  o.poly(flat(hull(rings.flat().map((q) => q.s)))).stroke({ width: 5, color: '#000000', alpha: 0.3, join: 'round' });
}
