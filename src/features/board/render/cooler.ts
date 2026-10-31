import { Container, Graphics } from 'pixi.js';
import type { CoolerSpec } from '../sim/specs';
import { COOLER, type Rect } from './layout/layout';
import { box, dashed, disc, lgrad, mix, rgrad } from '@/core/render/ink';
import { EdgeFan, type FanMount } from '../../room/render/desk/case';
import { blades, type Part } from './devices';
import { roundedPath } from './wiring/routes';
import type { Theme } from '@/core/render/theme';

// The CPU cooler (docs/render/board.md "Cooler"): three looks on the same mounting plate (`COOLER`), which is the hit area, the empty-slot
// outline and where the fan cable plugs in. The stock cooler is a round aluminium heatsink with radial vanes and a small fan; the tower is
// two fin stacks with copper heat pipes either side of a big fan; the liquid loop (an AIO) is a pump head with a ring light, its two tubes
// running to the radiator the player bolted on a fan mount of the case (front or top, spanning every fan of that side; seen edge-on like the case fans, `radiatorArt`). The
// fan, or on the loop the pump's impeller, is the `fan` child the live layer spins; the radiator's fan is an `EdgeFan` it drives the same way.

type Pt = [number, number];

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
  const path = roundedPath(pts, 170);
  const stroke = (dx: number, dy: number, w: number, color: string, alpha: number) => {
    g.moveTo(path[0]![0] + dx, path[0]![1] + dy);
    for (const p of path.slice(1)) g.lineTo(p[0] + dx, p[1] + dy);
    g.stroke({ width: w, color, alpha, join: 'round', cap: 'round' });
  };
  stroke(8, 14, 62, '#000000', T.dark ? 0.32 : 0.16);
  stroke(0, 0, 60, T.dark ? '#0c1226' : '#3a4561', 1);
  stroke(0, 0, 42, mix(T.dark ? '#0c1226' : '#3a4561', tint, 0.38), 1);
  dashed(g, path, 5, 9);
  g.stroke({ width: 56, color: '#ffffff', alpha: 0.07 });
  stroke(-9, -9, 8, '#ffffff', T.dark ? 0.2 : 0.4);
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
interface Frame { L: number; S: number; P: (u: number, v: number) => Pt; rect: (u: number, v: number, du: number, dv: number) => Rect; inward: Pt }

const TANK = 200;

function frameOf(m: FanMount, end: 'start' | 'end'): Frame {
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
  return { tips: [fr.P(60, fr.S + 40), fr.P(140, fr.S + 40)], base: [fr.P(60, fr.S - 4), fr.P(140, fr.S - 4)], inward: fr.inward };
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
 * The two tubes from the pump's ports (`a` west, `b` east, both on top of the head) to the radiator's, nested so they do not cross: they rise to a
 * lane of their own, run along it to the side the radiator is on, then go on to its barbs (up through the case's top, or down a channel beside a side mount).
 */
export function tubeRoutes(f: RadiatorFit, a: Pt, b: Pt): [Pt[], Pt[]] {
  const yLow = -880, yHigh = -1010, ports = radiatorPorts(f), [t0, t1] = ports.tips;
  if (f.mount.side === 'top') {
    const [pw, pe] = t0[0] <= t1[0] ? [t0, t1] : [t1, t0];
    if (pw[0] < a[0]) return [[a, [a[0], yLow], [pw[0], yLow], pw], [b, [b[0], yHigh], [pe[0], yHigh], pe]];
    return [[a, [a[0], yHigh], [pw[0], yHigh], pw], [b, [b[0], yLow], [pe[0], yLow], pe]];
  }
  // the front's barbs face west: the west tube takes the upper lane to the northern barb, the east one the lower lane to the other
  const xa = t0[0] - 300, xb = t0[0] - 150;
  return [[a, [a[0], yHigh], [xa, yHigh], [xa, t0[1]], t0], [b, [b[0], yLow], [xb, yLow], [xb, t1[1]], t1]];
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

  let fr: number, nBlades: number, bezel: number, fanAt: Pt = [cx, cy];
  if (kind === 'stock') {
    // an aluminium heatsink: a ring of radial vanes round a small fan
    const R = 630;
    fr = 300; nBlades = 7; bezel = 350;
    disc(g, cx + 8, cy + 14, R, { fill: '#000000', fa: 0.3 });
    disc(g, cx, cy, R, { fill: m.lo, stroke: mix(T.line, m.metal, 0.5), lw: 8 });
    for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; g.moveTo(cx + Math.cos(a) * 340, cy + Math.sin(a) * 340).lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14)); }
    g.stroke({ width: 26, color: m.metal });
    for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2 - 0.02; g.moveTo(cx + Math.cos(a) * 340, cy + Math.sin(a) * 340).lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14)); }
    g.stroke({ width: 7, color: m.hi, alpha: 0.75 });
    disc(g, cx, cy, bezel, { fill: T.sub, stroke: m.metal, lw: 12 });
    for (const [x, y] of [[c.x + 100, c.y + 100], [c.x + c.w - 100, c.y + 100], [c.x + 100, c.y + c.h - 100], [c.x + c.w - 100, c.y + c.h - 100]] as const) screw(g, T, x, y, 34); // push pins
  } else if (kind === 'tower') {
    // a stack of fins either side of the fan, copper heat pipes running through them, a base along the south edge
    fr = 400; nBlades = 9; bezel = 440;
    const sw = 260, top = c.y + 50, h = c.h - 150;
    for (const x of [c.x + 40, c.x + c.w - 40 - sw]) {
      g.roundRect(x, top, sw, h, 16).fill(lgrad(m.hi, m.lo, [1, 0])).stroke({ width: 5, color: mix(T.line, m.metal, 0.5) });
      for (let y = top + 18; y < top + h - 10; y += 24) g.moveTo(x + 8, y).lineTo(x + sw - 8, y);
      g.stroke({ width: 6, color: '#000000', alpha: 0.3 });
      for (let y = top + 18; y < top + h - 10; y += 24) g.moveTo(x + 8, y + 7).lineTo(x + sw - 8, y + 7);
      g.stroke({ width: 2, color: '#ffffff', alpha: T.dark ? 0.2 : 0.5 });
      for (let k = 0; k < 3; k++) {
        const px = x + sw * (0.22 + k * 0.28);
        g.moveTo(px, top + 20).lineTo(px, c.y + c.h - 40).stroke({ width: 30, color: copper(T), cap: 'round' });
        g.moveTo(px - 6, top + 26).lineTo(px - 6, c.y + c.h - 50).stroke({ width: 7, color: '#ffffff', alpha: T.dark ? 0.28 : 0.5, cap: 'round' });
      }
    }
    box(g, c.x + 30, c.y + c.h - 100, c.w - 60, 70, 20, { fill: m.metal, stroke: mix(T.line, m.metal, 0.5), lw: 5 });
    g.rect(c.x + 70, c.y + c.h - 94, c.w - 140, 6).fill(lit);
    // the fan in its square frame
    const fw = 900, fx = cx - fw / 2, fy = c.y + 50;
    box(g, fx + 10, fy + 16, fw, fw, 56, { fill: '#000000', fa: 0.3 });
    box(g, fx, fy, fw, fw, 56, { fill: T.sub, stroke: accent, lw: 8, sa: 0.9 });
    for (const [x, y] of [[fx + 56, fy + 56], [fx + fw - 56, fy + 56], [fx + 56, fy + fw - 56], [fx + fw - 56, fy + fw - 56]] as const) screw(g, T, x, y, 22);
    fanAt = [cx, fy + fw / 2]; // the fan sits in the frame's middle, not the plate's
  } else {
    // a pump head on a bracket: a brushed ring, a glass dome with the ring light round the impeller, the two tube ports on top
    fr = 360; nBlades = 5; bezel = 400;
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
  if (kind === 'tower') disc(g, fx0, fy0, bezel, { fill: T.dot, stroke: T.line, lw: 7 }); else if (kind === 'stock') disc(g, cx, cy, bezel - 24, { fill: T.dot });
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
