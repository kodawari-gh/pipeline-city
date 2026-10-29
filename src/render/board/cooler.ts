import { Container, Graphics } from 'pixi.js';
import type { CoolerSpec } from '../../sim/board/specs';
import { COOLER, RADIATOR, type Rect } from './layout';
import { box, dashed, disc, lgrad, mix, rgrad } from '../ink';
import { EdgeFan } from '../room/case';
import { blades, type Part } from './devices';
import { roundedPath } from './routes';
import type { Theme } from '../theme';

// The CPU cooler (docs/render/board.md "Cooler"): three looks on the same mounting plate (`COOLER`), which is the hit area, the empty-slot
// outline and where the fan cable plugs in. The stock cooler is a round aluminium heatsink with radial vanes and a small fan; the tower is
// two fin stacks with copper heat pipes either side of a big fan; the liquid loop (an AIO) is a pump head with a ring light, its two tubes
// running up to a radiator standing in the case's top-fan position (`RADIATOR`, seen edge-on like the case fans). The fan, or on the loop the
// pump's impeller, is the `fan` child the live layer spins; the radiator's fan is an `EdgeFan` it drives the same way.

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

/** Where the two tubes meet the radiator: the ends of the barbs on its west tank's underside. */
export const radiatorPorts = (r: Rect): [Pt, Pt] => [[r.x + 50, r.y + r.h + 40], [r.x + 150, r.y + r.h + 40]];

/**
 * The AIO's radiator seen edge-on: an end tank at each end (the west one with the two barbs the tubes plug into), the finned core between
 * them and the live fan under the core (the same frame and blade strips as the case fans). `r` is the slab (RADIATOR on the board).
 */
export function radiatorArt(T: Theme, r: Rect): { root: Container; fan: EdgeFan } {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  const m = metals(T), TANK = 200, CORE = 120, GAP = 10;
  const edge = mix(T.line, m.metal, 0.5);
  const core = { x: r.x + TANK - 10, y: r.y, w: r.w - 2 * TANK + 20, h: CORE };
  const fan: Rect = { x: core.x, y: r.y + CORE + GAP, w: core.w, h: r.h - CORE - GAP };
  box(g, r.x + 14, r.y + 20, r.w, r.h, 30, { fill: '#000000', fa: T.dark ? 0.3 : 0.12 });
  // the fan strip's frame (the live blades go on top)
  box(g, fan.x, fan.y, fan.w, fan.h, 24, { fill: mix(T.sub, T.tile, 0.3), stroke: edge, lw: 5, sa: 0.8 });
  g.moveTo(fan.x + 60, fan.y + fan.h / 2).lineTo(fan.x + fan.w - 60, fan.y + fan.h / 2).stroke({ width: 14, color: T.line, alpha: 0.6, cap: 'round' });
  for (const sx of [fan.x + 36, fan.x + fan.w - 36]) screw(g, T, sx, fan.y + fan.h / 2, 11);
  // the core: fin edges as a ladder across it, a lit top edge
  g.roundRect(core.x, core.y, core.w, core.h, 10).fill(lgrad(m.hi, m.lo)).stroke({ width: 5, color: edge });
  for (let x = core.x + 14; x < core.x + core.w - 10; x += 16) g.moveTo(x, core.y + 10).lineTo(x, core.y + core.h - 10);
  g.stroke({ width: 5, color: '#000000', alpha: 0.32 });
  for (let x = core.x + 14; x < core.x + core.w - 10; x += 16) g.moveTo(x + 5, core.y + 10).lineTo(x + 5, core.y + core.h - 10);
  g.stroke({ width: 2, color: '#ffffff', alpha: T.dark ? 0.16 : 0.4 });
  g.rect(core.x + 8, core.y + 4, core.w - 16, 5).fill({ color: '#ffffff', alpha: T.dark ? 0.16 : 0.5 });
  // the end tanks
  for (const west of [true, false]) {
    const x = west ? r.x : r.x + r.w - TANK;
    g.roundRect(x, r.y, TANK, r.h, 26).fill(lgrad(m.hi, m.lo, [0.4, 1])).stroke({ width: 6, color: edge });
    g.rect(x + 22, r.y + 8, TANK - 44, 6).fill({ color: '#ffffff', alpha: T.dark ? 0.18 : 0.5 });
    g.moveTo(west ? x + TANK - 24 : x + 24, r.y + 18).lineTo(west ? x + TANK - 24 : x + 24, r.y + r.h - 18).stroke({ width: 6, color: '#000000', alpha: 0.3 });
  }
  screw(g, T, r.x + r.w - 100, r.y + 42, 20); // the fill port
  for (const [px] of radiatorPorts(r)) fitting(g, T, px, r.y + r.h - 4, 1);
  return { root, fan: new EdgeFan(fan, T) };
}

/** The cooler on the CPU. `rad` is the radiator the loop's tubes run to (only a liquid cooler uses it). */
export function coolerArt(T: Theme, spec: CoolerSpec, rad: Rect | null = RADIATOR): Part {
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
      // two tubes up from the ports to the radiator's west tank, nested so they do not cross: the lower run goes furthest
      const ports = radiatorPorts(rad), y1 = -880, y2 = -1010;
      tube(g, T, [[cx - 120, -520], [cx - 120, y1], [ports[0][0], y1], ports[0]], accent);
      tube(g, T, [[cx + 120, -520], [cx + 120, y2], [ports[1][0], y2], ports[1]], accent);
      for (const p of ports) fitting(g, T, p[0], rad.y + rad.h - 4, 1); // (over the tube ends)
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
  const r: Rect = { x: -1000, y: -1560, w: RADIATOR.w, h: RADIATOR.h };
  const ra = radiatorArt(T, r);
  holder.addChild(ra.root, ra.fan, coolerArt(T, spec, r).root);
  return holder;
}
