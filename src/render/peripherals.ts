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
export const KEYBOARD = { w: 6200, d: 3300, h: 260, yaw: -3.5 };
export const MOUSE = { w: 1500, l: 2600, h: 500, yaw: 9 };

/** Turns plan points about a centre on the desk top and puts them on the top in perspective: `(px, pz, h)` is across, toward the viewer, and up. */
export function placer(D: DeskGeo, cx: number, cy: number, yawDeg: number) {
  const c = Math.cos((yawDeg * Math.PI) / 180), s = Math.sin((yawDeg * Math.PI) / 180);
  return (px: number, pz: number, h = 0): Pt => {
    const x = cx + px * c - pz * s, y = cy + (px * s + pz * c) * MUG.e;
    return [D.xAt(x, (y - D.P.yH) / (D.yBack - D.P.yH)), y - h];
  };
}

/** Where the keyboard is (its centre at the feet line, a little west of the monitor's middle, so its right end clears the mouse). */
export const keyboardPlacer = (D: DeskGeo, monitorCx: number) => placer(D, monitorCx - 300, D.ys - 190, KEYBOARD.yaw);
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

/** The outline of the mouse's footprint at a scale: a rounded rectangle, narrower at the front (the buttons, toward the wall) than at the back (the palm). */
const mouseOutline = (k: number, n = 36): Pt[] => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), q = 2 / 2.6, sx = Math.sign(c) * Math.abs(c) ** q, sz = Math.sign(s) * Math.abs(s) ** q;
  const z = (MOUSE.l / 2) * sz, taper = 0.8 + 0.2 * (z / MOUSE.l + 0.5);
  return [(MOUSE.w / 2) * sx * taper * k, z * k] as Pt;
});

/** The convex hull of some points (a mouse's silhouette is the hull of its rings). */
function hull(pts: Pt[]): Pt[] {
  const a = [...pts].sort((u, v) => u[0] - v[0] || u[1] - v[1]), cross = (o: Pt, u: Pt, v: Pt) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of a) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...a].reverse()) { while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** The mouse: a dome turned a few degrees on the mat, two buttons with a seam, a wheel, a lit patch on its top, and its cord running back behind the keyboard. */
export function drawMouse(o: Graphics, T: Theme, L: PeriphLook, D: DeskGeo, monitorCx: number) {
  const p = mousePlacer(D, monitorCx), kp = keyboardPlacer(D, monitorCx), { w, l, h } = MOUSE;
  const ring = (k: number, hh: number) => mouseOutline(k).map(([x, z]) => p(x, z, hh));
  const body = mix(L.plastic, '#ffffff', T.dark ? 0.12 : 0), shade = mix(L.plasticLo, '#ffffff', T.dark ? 0.05 : 0);
  // the cord first (it leaves the front and curls back behind the keyboard)
  const s0 = p(0, -l / 2, h * 0.3), e0 = kp(KEYBOARD.w / 2 - 900, -KEYBOARD.d / 2, KEYBOARD.h);
  o.moveTo(s0[0], s0[1]).bezierCurveTo(s0[0] - 120, s0[1] - 520, e0[0] + 1500, e0[1] + 260, e0[0], e0[1]).stroke({ width: 20, color: L.plasticLo, cap: 'round' });
  contact(o, p, mouseOutline(1), T.dark ? 0.55 : 0.4);
  // the silhouette: the hull of the footprint, the widest ring a little up the body and the dome's top
  o.poly(flat(hull([...ring(0.97, 0), ...ring(1, h * 0.35), ...ring(0.8, h)]))).fill({ color: shade }).stroke({ width: 5, color: '#000000', alpha: 0.3, join: 'round' });
  o.poly(flat(hull([...ring(1, h * 0.35), ...ring(0.8, h)]))).fill({ color: body, alpha: 0.35 }); // the body's own colour above the foot
  o.poly(flat(ring(0.8, h))).fill({ color: body }).stroke({ width: 6, color: mix(L.line, '#ffffff', T.dark ? 0.35 : 0), alpha: 0.9, join: 'round' });
  // the top: a lit patch, the seam between the buttons, the line under them and the wheel
  o.poly(flat(mouseOutline(0.5).map(([x, z]) => p(x - 120, z + 220, h * 1.02)))).fill({ color: '#ffffff', alpha: T.dark ? 0.16 : 0.5 });
  const seam = (x0: number, z0: number, x1: number, z1: number, wd: number, a: number) => { const u = p(x0, z0, h * 0.98), v = p(x1, z1, h * 0.98); o.moveTo(u[0], u[1]).lineTo(v[0], v[1]).stroke({ width: wd, color: L.line, alpha: a, cap: 'round' }); };
  seam(0, -l * 0.4, 0, -l * 0.04, 7, 0.9);
  seam(-w * 0.3, -l * 0.04, w * 0.3, -l * 0.04, 6, 0.7);
  const wl = [p(-70, -l * 0.34, h), p(70, -l * 0.34, h), p(70, -l * 0.2, h), p(-70, -l * 0.2, h)];
  o.poly(flat(wl)).fill({ color: T.dark ? '#aab6dc' : L.paper }).stroke({ width: 4, color: T.dark ? '#4a5679' : '#9aabc8' });
}
