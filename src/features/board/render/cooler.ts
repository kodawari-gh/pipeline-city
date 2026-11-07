import { Container, Graphics } from 'pixi.js';
import type { CoolerSpec } from '../sim/specs';
import { BR, COOLER, type Rect } from './layout/layout';
import { box, dashed, disc, lgrad, mix, rgrad } from '@/core/render/ink';
import { EdgeFan, type FanMount } from '../../room/render/desk/props/case';
import { blades, type Part } from './devices';
import type { Theme } from '@/core/render/theme';
import { loopBank } from '@/core/render/fanmotor';

// The CPU cooler (docs/render/board.md "Cooler"): three looks on the same mounting plate (`COOLER`), which is the hit area, the empty-slot
// outline and where the fan cable plugs in. The stock cooler is a round aluminium heatsink with radial vanes and a small fan; the tower is
// a fin stack (rails along east-west) with copper heat pipes and an edge-on fan on its east end, blowing west through the fins; the liquid loop (an AIO) is a pump head with a ring light, its two tubes
// running to the radiator the player bolted on a fan mount of the case (front or top, spanning every fan of that side; seen edge-on like the case fans, `radiatorArt`). The
// fan, or on the loop the pump's impeller, is the `fan` child the live layer spins; the radiator's fan is an `EdgeFan` it drives the same way.

type Pt = [number, number];

/** The loop's tubes: the sleeve's width. */
export const TUBE_W = 92;

/** The brushed-metal ramp the heatsinks use (the VRM sink's tones). */
const metals = (T: Theme) => ({ metal: T.dark ? '#3b4663' : '#b7c1d3', hi: T.dark ? '#56628a' : '#dde4f0', lo: T.dark ? '#222a41' : '#8d99b1' });
const copper = (T: Theme) => (T.dark ? '#c0793a' : '#b8662a');

function screw(g: Graphics, T: Theme, x: number, y: number, r = 28): void {
  const m = metals(T);
  disc(g, x + 4, y + 6, r + 4, { fill: '#000000', fa: 0.25 });
  g.circle(x, y, r).fill(rgrad(m.hi, m.lo, [0.4, 0.35], 0.75)).stroke({ width: 4, color: mix(T.line, m.metal, 0.5) });
  g.moveTo(x - r * 0.6, y - r * 0.15).lineTo(x + r * 0.6, y + r * 0.15).stroke({ width: 5, color: '#000000', alpha: 0.5, cap: 'round' });
}

/** A rubber tube along `pts` (rounded corners): a drop shadow, the sleeve, a tinted core, a braid and a lit streak. */
function tube(g: Graphics, T: Theme, pts: Pt[], tint: string): void {
  const path = pts;
  const stroke = (dx: number, dy: number, w: number, color: string, alpha: number) => {
    g.moveTo(path[0]![0] + dx, path[0]![1] + dy);
    for (const p of path.slice(1)) g.lineTo(p[0] + dx, p[1] + dy);
    g.stroke({ width: w, color, alpha, join: 'round', cap: 'butt' });
  };
  stroke(10, 18, TUBE_W + 2, '#000000', T.dark ? 0.32 : 0.16);
  stroke(0, 0, TUBE_W, T.dark ? '#0c1226' : '#3a4561', 1);
  stroke(0, 0, TUBE_W * 0.72, mix(T.dark ? '#0c1226' : '#3a4561', tint, 0.38), 1);
  dashed(g, path, 5, 9);
  g.stroke({ width: TUBE_W * 0.93, color: '#ffffff', alpha: 0.07 });
  stroke(-TUBE_W * 0.15, -TUBE_W * 0.15, 11, '#ffffff', T.dark ? 0.2 : 0.4);
  // a hose clamp a little in from each end: it hides the cut of the sleeve and holds it on the barb
  const m = metals(T), clamp = (p: Pt, q: Pt) => {
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ux = (q[0] - p[0]) / l, uy = (q[1] - p[1]) / l, cx = p[0] + ux * 34, cy = p[1] + uy * 34, nx = -uy * (TUBE_W / 2 - 2), ny = ux * (TUBE_W / 2 - 2);
    g.moveTo(cx - nx + 6, cy - ny + 10).lineTo(cx + nx + 6, cy + ny + 10).stroke({ width: 30, color: '#000000', alpha: 0.3, cap: 'round' });
    g.moveTo(cx - nx, cy - ny).lineTo(cx + nx, cy + ny).stroke({ width: 30, color: m.metal, cap: 'round' });
    g.moveTo(cx - nx, cy - ny).lineTo(cx + nx, cy + ny).stroke({ width: 10, color: m.hi, alpha: 0.9, cap: 'round' });
    g.moveTo(cx - nx * 0.6, cy - ny * 0.6).lineTo(cx - nx * 0.6 + ux * 3, cy - ny * 0.6 + uy * 3).stroke({ width: 8, color: '#000000', alpha: 0.5, cap: 'round' });
  };
  clamp(path[0]!, path[1]!);
  clamp(path[path.length - 1]!, path[path.length - 2]!);
}

/** A tube fitting: a collar with a lip at its far end. `dir` is the way it points from the part (-1 north, 1 south), `y` where it leaves it. */
function fitting(g: Graphics, T: Theme, x: number, y: number, dir: -1 | 1): void {
  const m = metals(T), y0 = dir < 0 ? y - 60 : y;
  box(g, x - 40, y0, 80, 60, 10, { fill: m.metal, stroke: mix(T.line, m.metal, 0.5), lw: 4 });
  g.rect(x - 46, dir < 0 ? y0 : y0 + 46, 92, 14).fill({ color: m.hi, alpha: 0.9 });
  g.rect(x - 28, y0 + 10, 12, 36).fill({ color: '#ffffff', alpha: T.dark ? 0.1 : 0.35 });
}

/** A radiator mount of the case with the end of it the tubes come to (`end`: the start tank, or the far one: north / west for a top mount). */
export interface RadiatorFit { mount: FanMount; end: 'start' | 'end' }

/** A radiator is a slab seen edge-on: `L` long along the mount, `S` across it, `P(u, v)` the world point `u` along it and `v` across it from the outboard face. */
export interface Frame { L: number; S: number; P: (u: number, v: number) => Pt; rect: (u: number, v: number, du: number, dv: number) => Rect; inward: Pt }

/** A radiator's end tank: its length along the mount. */
export const TANK = 200;

export function frameOf(m: FanMount, end: 'start' | 'end'): Frame {
  const r = m.rect, top = m.side === 'top', L = top ? r.w : r.h, S = top ? r.h : r.w, flip = top && end === 'end';
  const at = (u: number, v: number): Pt => {
    const uu = flip ? L - u : u;
    return m.side === 'top' ? [r.x + uu, r.y + v] : m.side === 'front' ? [r.x + r.w - v, r.y + uu] : [r.x + v, r.y + uu];
  };
  return {
    L, S, P: at,
    rect: (u, v, du, dv) => { const a = at(u, v), b = at(u + du, v + dv); return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) }; },
    inward: m.side === 'top' ? [0, 1] : m.side === 'front' ? [-1, 0] : [1, 0],
  };
}

/** The tank of a radiator mount that is nearer the pump (a top mount has a tank at each end; the side ones take the tubes at the north end). */
export function radiatorFit(m: FanMount, pumpX: number): RadiatorFit {
  if (m.side !== 'top') return { mount: m, end: 'start' };
  const r = m.rect;
  return { mount: m, end: Math.abs(pumpX - (r.x + TANK / 2)) <= Math.abs(pumpX - (r.x + r.w - TANK / 2)) ? 'start' : 'end' };
}

/** Where the two tubes meet the radiator: the tips of the barbs on its inboard face (the first is the one nearer the tank's end), and the way the tubes arrive. */
export function radiatorPorts(f: RadiatorFit): { tips: [Pt, Pt]; base: [Pt, Pt]; inward: Pt } {
  const fr = frameOf(f.mount, f.end);
  return { tips: [fr.P(52, fr.S + 40), fr.P(152, fr.S + 40)], base: [fr.P(52, fr.S - 4), fr.P(152, fr.S - 4)], inward: fr.inward };
}

/** The look of a radiator by its grade (1 slim, 2 thick, 3 big): the fin pitch and the stripes on the tanks. */
export const radiatorGrade = (visual: string): 1 | 2 | 3 => (visual === 'radiator-big' ? 3 : visual === 'radiator-thick' ? 2 : 1);

/**
 * A radiator seen edge-on, bolted along a side of the case: an end tank at each end (one with the two barbs the tubes plug into), the finned
 * core against the outside and the live fans on the inside of it (the same frame and blade strips as the case fans), `count` of them, one per
 * fan mount of the side it spans. It replaces those mounts' fans.
 */
export function radiatorArt(T: Theme, f: RadiatorFit, grade: 1 | 2 | 3 = 2, count = 1): { root: Container; fans: EdgeFan[] } {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  const fr = frameOf(f.mount, f.end), { L, S } = fr, r = f.mount.rect;
  const m = metals(T), CORE = Math.round(S * 0.5), GAP = 10;
  const edge = mix(T.line, m.metal, 0.5);
  const cu0 = TANK - 10, cuL = L - 2 * TANK + 20;
  const core = fr.rect(cu0, 0, cuL, CORE), fan = fr.rect(cu0, CORE + GAP, cuL, S - CORE - GAP);
  const line = (u0: number, v0: number, u1: number, v1: number) => { const a = fr.P(u0, v0), b = fr.P(u1, v1); g.moveTo(a[0], a[1]).lineTo(b[0], b[1]); };
  box(g, r.x + 14, r.y + 20, r.w, r.h, 30, { fill: '#000000', fa: T.dark ? 0.3 : 0.12 });
  // the fan strip's frame (the live blades go on top)
  box(g, fan.x, fan.y, fan.w, fan.h, 24, { fill: mix(T.sub, T.tile, 0.3), stroke: edge, lw: 5, sa: 0.8 });
  const fanV = CORE + GAP + (S - CORE - GAP) / 2, seg = cuL / count;
  // the fans side by side along the strip: a hub bar and two screws on each, a divider between them
  const strips = Array.from({ length: count }, (_, k) => fr.rect(cu0 + k * seg, CORE + GAP, seg, S - CORE - GAP));
  for (let k = 0; k < count; k++) {
    line(cu0 + k * seg + 60, fanV, cu0 + (k + 1) * seg - 60, fanV);
    g.stroke({ width: 14, color: T.line, alpha: 0.6, cap: 'round' });
    for (const u of [cu0 + k * seg + 36, cu0 + (k + 1) * seg - 36]) { const p = fr.P(u, fanV); screw(g, T, p[0], p[1], 11); }
    if (k > 0) { line(cu0 + k * seg, CORE + GAP + 8, cu0 + k * seg, S - 8); g.stroke({ width: 8, color: edge, alpha: 0.8 }); }
  }
  // the core: fin edges as a ladder across it, a lit outer edge (a finer ladder the bigger the grade)
  g.roundRect(core.x, core.y, core.w, core.h, 10).fill(lgrad(m.hi, m.lo)).stroke({ width: 5, color: edge });
  const pitch = grade === 3 ? 11 : grade === 2 ? 16 : 22;
  for (let u = cu0 + 14; u < cu0 + cuL - 10; u += pitch) line(u, 10, u, CORE - 10);
  g.stroke({ width: grade === 3 ? 4 : 5, color: '#000000', alpha: 0.32 });
  for (let u = cu0 + 14; u < cu0 + cuL - 10; u += pitch) line(u + 5, 10, u + 5, CORE - 10);
  g.stroke({ width: 2, color: '#ffffff', alpha: T.dark ? 0.16 : 0.4 });
  const lit = fr.rect(cu0 + 8, 4, cuL - 16, 5);
  g.rect(lit.x, lit.y, lit.w, lit.h).fill({ color: '#ffffff', alpha: T.dark ? 0.16 : 0.5 });
  // the end tanks, with a stripe per grade
  for (const first of [true, false]) {
    const u0 = first ? 0 : L - TANK, tk = fr.rect(u0, 0, TANK, S);
    g.roundRect(tk.x, tk.y, tk.w, tk.h, 26).fill(lgrad(m.hi, m.lo, [0.4, 1])).stroke({ width: 6, color: edge });
    const sh = fr.rect(u0 + 22, 8, TANK - 44, 6);
    g.rect(sh.x, sh.y, sh.w, sh.h).fill({ color: '#ffffff', alpha: T.dark ? 0.18 : 0.5 });
    const gu = first ? u0 + TANK - 24 : u0 + 24;
    line(gu, 18, gu, S - 18);
    g.stroke({ width: 6, color: '#000000', alpha: 0.3 });
    for (let k = 0; k < grade; k++) { const s = fr.rect(u0 + (first ? 30 : 70) + k * 30, S * 0.5, 12, S * 0.35); g.rect(s.x, s.y, s.w, s.h).fill({ color: T.mul, alpha: 0.7 }); }
  }
  const fill = fr.P(L - 100, 42);
  screw(g, T, fill[0], fill[1], 20); // the fill port
  // the barbs on the inboard face of the tank the tubes come to
  const ports = radiatorPorts(f);
  ports.base.forEach((b) => {
    const fg = new Graphics();
    fg.position.set(b[0], b[1]);
    fg.rotation = Math.atan2(-ports.inward[0], ports.inward[1]); // the collar is drawn pointing south; turn it to point inboard
    fitting(fg, T, 0, 0, 1);
    root.addChild(fg);
  });
  return { root, fans: strips.map((r) => new EdgeFan(r, T)) };
}

/**
 * A smooth curve along the corners of `ctrl` (a clamped uniform cubic B-spline): it leaves the first point along the first leg, arrives along the last one, and cuts every
 * corner into a sweep that stays inside the polyline, so a route laid round obstacles keeps clear of them.
 */
function smooth(ctrl: Pt[], per = 14): Pt[] {
  const p = [ctrl[0]!, ctrl[0]!, ...ctrl, ctrl[ctrl.length - 1]!, ctrl[ctrl.length - 1]!], out: Pt[] = [];
  for (let i = 0; i + 3 < p.length; i++) {
    for (let k = i === 0 ? 0 : 1; k <= per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const b0 = (1 - t) ** 3 / 6, b1 = (3 * t3 - 6 * t2 + 4) / 6, b2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, b3 = t3 / 6;
      out.push([b0 * p[i]![0] + b1 * p[i + 1]![0] + b2 * p[i + 2]![0] + b3 * p[i + 3]![0], b0 * p[i]![1] + b1 * p[i + 1]![1] + b2 * p[i + 2]![1] + b3 * p[i + 3]![1]]);
    }
  }
  out[0] = ctrl[0]!; out[out.length - 1] = ctrl[ctrl.length - 1]!; // exactly the ends, not their float shadow
  return out;
}

/**
 * The two tubes from the pump's ports (`a` west, `b` east, both on top of the head) to the radiator's barbs, nested so they do not cross: they rise to a lane of their
 * own, run along it to the side the radiator is on, then go on to its barbs (up through the case's top, or down a channel beside a side mount). The corners are
 * smoothed into sweeping curves (`smooth`); a route is a dense list of points along the curve, starting at its port and ending at its barb's tip.
 */
export function tubeRoutes(f: RadiatorFit, a: Pt, b: Pt): [Pt[], Pt[]] {
  const yLow = -880, yHigh = -1010, ports = radiatorPorts(f), [t0, t1] = ports.tips, run: Pt = [-ports.inward[0], -ports.inward[1]];
  // a straight lead-in over the barb, so every tube meets it square
  const lead = (t: Pt): Pt => [t[0] - run[0] * 340, t[1] - run[1] * 340];
  const up = (p: Pt): Pt => [p[0], p[1] - 240];
  if (f.mount.side === 'top') {
    const [pw, pe] = t0[0] <= t1[0] ? [t0, t1] : [t1, t0];
    const [la, lb] = pw[0] < a[0] ? [yLow, yHigh] : [yHigh, yLow];
    return [smooth([a, up(a), [a[0], la], [pw[0], la], lead(pw), pw]), smooth([b, up(b), [b[0], lb], [pe[0], lb], lead(pe), pe])];
  }
  // the front's barbs face west, far across the board: the tubes run along their lanes under the regulator, cross the memory sockets low, then climb the free strip
  // between the M.2 sockets and the ATX plug and land level on their barbs. The upper lane turns first (nearer the sockets) and takes the northern barb, so the pair nests.
  const m2 = BR.m2, gap = BR.atx.x - (m2.x + m2.w), xa = m2.x + m2.w + gap * 0.02, xb = m2.x + m2.w + gap * 0.3, mid = (y0: number, y1: number): number => (y0 + y1) / 2;
  return [smooth([a, up(a), [a[0], yHigh], [xa, yHigh], [xa, mid(yHigh, t0[1])], [xa, t0[1]], lead(t0), t0]), smooth([b, up(b), [b[0], yLow], [xb, yLow], [xb, mid(yLow, t1[1])], [xb, t1[1]], lead(t1), t1])];
}

const COLD_WATER = '#3fa9ff', HOT_WATER = '#ff6a3d';
/** The colour of water at `c` degrees: blue at the room temperature, orange at 60 (a few degrees show: the two tubes of a loop differ). */
export const waterColor = (c: number): string => mix(COLD_WATER, HOT_WATER, Math.max(0, Math.min(1, (c - 25) / 35)));

/**
 * The water in a loop's two tubes, over the sleeves: a tint of the water's temperature (`loopBank`: the hot tube leaves the pump for the radiator, the cold one
 * comes back) and drops that travel along them, as fast as the pump turns. The live layer drives it like a fan (`spin`, fed the pump's speed).
 */
export class CoolantFlow extends Container {
  private g = new Graphics();
  /** How far the drops have travelled (kept across a rebuild, so the water never jumps back). */
  phase = 0;
  private paths: { pts: Pt[]; at: number[]; len: number; hot: boolean }[];
  constructor(routes: [Pt[], Pt[]]) {
    super();
    this.addChild(this.g);
    this.paths = routes.map((r, i) => {
      const pts = r, at = [0];
      for (let k = 1; k < pts.length; k++) at.push(at[k - 1]! + Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]));
      return { pts, at, len: at[at.length - 1]!, hot: i === 0 };
    });
    this.draw();
  }
  spin(d: number) {
    this.phase += d * 140;
    this.draw();
  }
  /** The point `s` along a path. */
  private pointAt(p: { pts: Pt[]; at: number[]; len: number }, s: number): Pt {
    let k = 1;
    while (k < p.at.length - 1 && p.at[k]! < s) k++;
    const a = p.pts[k - 1]!, b = p.pts[k]!, span = (p.at[k]! - p.at[k - 1]!) || 1, t = Math.max(0, Math.min(1, (s - p.at[k - 1]!) / span));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  private draw() {
    const g = this.g, w = loopBank.get();
    g.clear();
    for (const p of this.paths) {
      if (p.len < 1) continue;
      const col = waterColor(w ? (p.hot ? w.hotC : w.coldC) : 25);
      g.moveTo(p.pts[0]![0], p.pts[0]![1]);
      for (const q of p.pts.slice(1)) g.lineTo(q[0], q[1]);
      g.stroke({ width: TUBE_W * 0.62, color: col, alpha: w && w.flow > 0.05 ? 0.7 : 0.35, join: 'round', cap: 'round' });
      if (!w || w.flow < 0.05) continue;
      // drops: the hot tube runs from the pump to the radiator, the cold one the other way
      const gap = 230, n = Math.max(1, Math.floor(p.len / gap)), loopLen = n * gap;
      for (let k = 0; k < n; k++) {
        const s = ((((this.phase + k * gap) % loopLen) + loopLen) % loopLen) / loopLen * p.len, [x, y] = this.pointAt(p, p.hot ? s : p.len - s);
        g.circle(x, y, 20).fill({ color: mix(col, '#ffffff', 0.45), alpha: 0.9 });
      }
    }
  }
}

/** The radius of the stock cooler's ring of vanes: the fan blows down into them and the air leaves sideways at this distance. */
export const STOCK_VANES_R = 630;

/** The round fan (or the loop's pump impeller) of the stock cooler and the loop: its blade length and count. The art and the airflow lens both read these. */
export const COOLER_FANS = { stock: { r: 300, blades: 7 }, liquid: { r: 360, blades: 5 } } as const;

/** A tower fan, seen edge-on: a slab on an end of the cooler, as tall as its fins. Both blow west: spot 0 on the east end pushes through the fins, spot 1 on the west end pulls. */
export const towerFanRect = (spot = 0): Rect => ({ x: spot ? COOLER.x + 40 : COOLER.x + COOLER.w - 40 - 170, y: COOLER.y + 50, w: 170, h: COOLER.h - 160 });

/** Where a round cooler's fan sits and how big it is (`visual` is the cooler spec's: `cooler-liquid` the pump, else the stock one; the tower's is `towerFanRect`). */
export function coolerFanAt(visual: string): { x: number; y: number; r: number; blades: number } {
  const c = COOLER, cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  return { x: cx, y: cy, ...(visual === 'cooler-liquid' ? COOLER_FANS.liquid : COOLER_FANS.stock) };
}

/** The cooler on the CPU. `rad` is the radiator the loop's tubes run to (only a liquid cooler uses it; with none the pump's ports are bare). */
export function coolerArt(T: Theme, spec: CoolerSpec, rad: RadiatorFit | null = null): Part {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  const kind = spec.visual === 'cooler-liquid' ? 'liquid' : spec.visual === 'cooler-tower' ? 'tower' : 'stock';
  const c: Rect = COOLER, cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  const m = metals(T), accent = kind === 'tower' ? T.alu : kind === 'liquid' ? T.mul : T.mute;
  const lit = { color: '#ffffff', alpha: T.dark ? 0.1 : 0.4 };

  // the mounting plate with its drop shadow, a lit top edge and a screw in each corner
  box(g, c.x + 14, c.y + 22, c.w, c.h, 60, { fill: '#000000', fa: T.dark ? 0.32 : 0.14 });
  g.roundRect(c.x, c.y, c.w, c.h, 60).fill(lgrad(mix(m.metal, '#ffffff', T.dark ? 0.08 : 0.25), mix(m.lo, '#000000', T.dark ? 0.2 : 0.05), [1, 1])).stroke({ width: 10, color: mix(T.line, accent, 0.6) });
  g.rect(c.x + 60, c.y + 12, c.w - 120, 8).fill(lit);

  let fr = 0, nBlades = 0, bezel = 0, fanAt: Pt = [cx, cy];
  if (kind === 'stock') {
    // an aluminium heatsink: a ring of radial vanes round a small fan
    const R = STOCK_VANES_R;
    fr = COOLER_FANS.stock.r; nBlades = COOLER_FANS.stock.blades; bezel = 350;
    disc(g, cx + 8, cy + 14, R, { fill: '#000000', fa: 0.3 });
    disc(g, cx, cy, R, { fill: m.lo, stroke: mix(T.line, m.metal, 0.5), lw: 8 });
    for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; g.moveTo(cx + Math.cos(a) * 340, cy + Math.sin(a) * 340).lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14)); }
    g.stroke({ width: 26, color: m.metal });
    for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2 - 0.02; g.moveTo(cx + Math.cos(a) * 340, cy + Math.sin(a) * 340).lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14)); }
    g.stroke({ width: 7, color: m.hi, alpha: 0.75 });
    disc(g, cx, cy, bezel, { fill: T.sub, stroke: m.metal, lw: 12 });
    for (const [x, y] of [[c.x + 100, c.y + 100], [c.x + c.w - 100, c.y + 100], [c.x + 100, c.y + c.h - 100], [c.x + c.w - 100, c.y + c.h - 100]] as const) screw(g, T, x, y, 34); // push pins
  } else if (kind === 'tower') {
    // a stack of fins with copper heat pipes standing through them, the fan on its east end, edge-on, blowing west along the fin channels
    const slab = towerFanRect(), fin = { x: c.x + 40, y: c.y + 50, w: slab.x - 24 - (c.x + 40), h: c.h - 160 };
    g.roundRect(fin.x, fin.y, fin.w, fin.h, 16).fill(m.lo).stroke({ width: 5, color: mix(T.line, m.metal, 0.5) });
    const pitch = 40, rail = 22;
    for (let y = fin.y + 14; y + rail < fin.y + fin.h - 8; y += pitch) g.roundRect(fin.x + 12, y, fin.w - 24, rail, 6);
    g.fill(lgrad(m.hi, m.metal, [0, 1]));
    for (let y = fin.y + 14; y + rail < fin.y + fin.h - 8; y += pitch) g.moveTo(fin.x + 20, y + 4).lineTo(fin.x + fin.w - 20, y + 4);
    g.stroke({ width: 3, color: '#ffffff', alpha: T.dark ? 0.2 : 0.5 });
    for (let k = 0; k < 3; k++) {
      const px = fin.x + fin.w * (0.2 + k * 0.28);
      g.moveTo(px, fin.y + 24).lineTo(px, fin.y + fin.h - 24).stroke({ width: 30, color: copper(T), cap: 'round' });
      g.moveTo(px - 6, fin.y + 30).lineTo(px - 6, fin.y + fin.h - 30).stroke({ width: 7, color: '#ffffff', alpha: T.dark ? 0.28 : 0.5, cap: 'round' });
    }
    box(g, c.x + 30, c.y + c.h - 100, c.w - 60, 70, 20, { fill: m.metal, stroke: mix(T.line, m.metal, 0.5), lw: 5 });
    g.rect(c.x + 70, c.y + c.h - 94, c.w - 140, 6).fill(lit);
    // the fan's frame; the blades (an `EdgeFan`, as on the case's fans) slide along it
    box(g, slab.x + 10, slab.y + 16, slab.w, slab.h, 30, { fill: '#000000', fa: 0.3 });
    box(g, slab.x, slab.y, slab.w, slab.h, 30, { fill: T.sub, stroke: accent, lw: 8, sa: 0.9 });
    const edge = new EdgeFan(slab, T);
    root.addChild(edge);
    return { root, fan: edge };
  } else {
    // a pump head on a bracket: a brushed ring, a glass dome with the ring light round the impeller, the two tube ports on top
    fr = COOLER_FANS.liquid.r; nBlades = COOLER_FANS.liquid.blades; bezel = 400;
    disc(g, cx, cy, 590, { fill: mix(m.lo, '#000000', 0.45), stroke: mix(T.line, m.metal, 0.5), lw: 6 });
    for (const [x, y] of [[c.x + 100, c.y + 100], [c.x + c.w - 100, c.y + 100], [c.x + 100, c.y + c.h - 100], [c.x + c.w - 100, c.y + c.h - 100]] as const) screw(g, T, x, y, 34);
    if (rad) {
      // two tubes up from the ports to the radiator the player bolted on, nested so they do not cross
      const [ta, tb] = tubeRoutes(rad, [cx - 120, -520], [cx + 120, -520]);
      tube(g, T, ta, accent);
      tube(g, T, tb, accent);
    }
    disc(g, cx + 12, cy + 20, 548, { fill: '#000000', fa: 0.35 });
    g.circle(cx, cy, 548).fill(rgrad(m.hi, m.lo, [0.38, 0.32], 0.75)).stroke({ width: 8, color: accent, alpha: 0.8 });
    for (const rr of [510, 490, 470]) g.circle(cx, cy, rr);
    g.stroke({ width: 3, color: '#000000', alpha: 0.22 });
    disc(g, cx, cy, 450, { fill: T.die, stroke: mix(T.line, '#000000', 0.4), lw: 8 });
    g.circle(cx, cy, 424).stroke({ width: 44, color: accent, alpha: 0.12 });
    g.circle(cx, cy, 424).stroke({ width: 12, color: accent, alpha: 0.85 });
    for (const sx of [-120, 120]) fitting(g, T, cx + sx, cy - 528, -1);
  }

  const fan = new Container();
  const [fx0, fy0] = fanAt;
  fan.position.set(fx0, fy0);
  const fg = new Graphics();
  if (kind === 'stock') disc(g, cx, cy, bezel - 24, { fill: T.dot });
  disc(fg, 0, 0, fr + 24, { fill: kind === 'liquid' ? T.dot : mix(T.dot, '#000000', 0.2) });
  blades(fg, nBlades, kind === 'liquid' ? 70 : 54, fr, kind === 'liquid' ? mix(T.tile, accent, 0.25) : T.tile, accent, 4);
  fan.addChild(fg);
  root.addChild(fan);

  // the hub (and on the loop the glass sheen across the dome) stays still above the spinning blades
  const hub = new Graphics();
  hub.position.set(fx0, fy0);
  hub.circle(0, 0, 74).fill(rgrad(m.hi, m.lo, [0.4, 0.35], 0.75)).stroke({ width: 7, color: accent });
  disc(hub, 0, 0, 22, { fill: accent });
  if (kind === 'liquid') hub.ellipse(-150, -190, 240, 90).fill({ color: '#ffffff', alpha: T.dark ? 0.07 : 0.22 });
  root.addChild(hub);
  return { root, fan };
}

/** A picture of the part for a shop tile: the cooler alone, or for the loop the pump with its tubes and a radiator above it. */
export function coolerKitArt(T: Theme, spec: CoolerSpec): Container {
  const holder = new Container();
  if (spec.visual !== 'cooler-liquid') { holder.addChild(coolerArt(T, spec).root); return holder; }
  const fit = kitFit();
  const ra = radiatorArt(T, fit, 2, 2);
  holder.addChild(ra.root, ...ra.fans, coolerArt(T, spec, fit).root);
  return holder;
}

/** A top-mounted radiator on the west of the pump, for the shop pictures. */
const kitFit = (): RadiatorFit => radiatorFit({ id: 'top0', side: 'top', rect: { x: -1000, y: -1560, w: 1700, h: 230 } }, 0);

/** A picture of a radiator for a shop tile: the slab alone, its fan switched off. */
export function radiatorKitArt(T: Theme, visual: string): Container {
  const holder = new Container();
  const ra = radiatorArt(T, kitFit(), radiatorGrade(visual), 2);
  holder.addChild(ra.root, ...ra.fans);
  return holder;
}
