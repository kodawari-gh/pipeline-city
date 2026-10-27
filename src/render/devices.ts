import { Container, Graphics } from 'pixi.js';
import type { CoolerSpec, CpuSpec, PsuSpec, RamSpec } from '../sim/board/specs';
import {
  COOLER, DIE, DIMM_H, DIMM_W, MONITOR, MONITOR_K, PKG, PORT_Y, PSU, PSU_FAN, PSU_LABEL, PSU_PANEL, PSU_PORTS, PSU_UNIT, SCREEN_D, VENTS, VIDEO_SOCKET, VRM_SINK, MONITOR_POWER,
  type Rect,
} from './layout';
import { box, dashed, disc, label, mix } from './ink';
import { dieFar, planOf } from './dieart';
import { SINK_FAN_R, sinkFanAt } from './pins';
import { hdmiPlug, rj45Plug } from './ports';
import { looseCable, movablePlug, offsetLine, type Cable, type Plug } from './routes';
import type { Theme } from './theme';

// Static art for installed devices. Everything is drawn in world coordinates unless noted.
// Live effects (glow, fan spin, chips) are added by board.ts on top.

export const SCREEN_BG = '#050a0c';

export interface Part {
  root: Container;
  /** Text labels, hidden when far out. */
  labels?: Container;
  /** A child that board.ts rotates for fans (kept above the baked far-LOD texture). */
  fan?: Container;
  /** Static art that must stay above `fan` (e.g. the PSU grill). */
  over?: Container;
  /** Sub-rects (world coords) that can flash, e.g. DRAM chips. */
  chips?: Rect[];
}

/** Draw `n` fan blades around the origin of `g` (blade length r1, root radius r0). */
export function blades(g: Graphics, n: number, r0: number, r1: number, fill: string, edge: string, edgeW: number) {
  for (let b = 0; b < n; b++) {
    const a = (b / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const R = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c];
    const p0 = R(r0, 0), c1 = R(r1 * 0.5, -r1 * 0.38), c2 = R(r1 * 0.9, -r1 * 0.3), p1 = R(r1, -r1 * 0.02);
    const c3 = R(r1 * 0.85, r1 * 0.2), c4 = R(r1 * 0.45, r1 * 0.2);
    g.moveTo(p0[0], p0[1]).bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p1[0], p1[1]).bezierCurveTo(c3[0], c3[1], c4[0], c4[1], p0[0], p0[1]);
  }
  g.fill({ color: fill });
  for (let b = 0; b < n; b++) {
    const a = (b / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const R = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c];
    const p0 = R(r0, 0), c1 = R(r1 * 0.5, -r1 * 0.38), c2 = R(r1 * 0.9, -r1 * 0.3), p1 = R(r1, -r1 * 0.02);
    g.moveTo(p0[0], p0[1]).bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p1[0], p1[1]);
  }
  g.stroke({ width: edgeW, color: edge, alpha: 0.6 });
}

// ---------------------------------------------------------------- CPU
export function cpuArt(T: Theme, spec: CpuSpec): Part {
  const root = new Container(), labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  const k = PKG, d = DIE;
  const accent = spec.visual === 'cpu-inorder-fwd' ? T.st : spec.visual === 'cpu-inorder' ? T.alu : T.mute;
  box(g, k.x, k.y, k.w, k.h, 70, { fill: T.sub, stroke: mix(T.line, accent, 0.5), lw: 7 });
  // pins: three rows around the edge
  for (let r = 0; r < 3; r++) {
    const o = 24 + r * 20;
    for (let x = k.x + 70; x <= k.x + k.w - 70; x += 20) { g.rect(x - 5, k.y + o - 5, 10, 10); g.rect(x - 5, k.y + k.h - o - 5, 10, 10); }
    for (let y = k.y + 70; y <= k.y + k.h - 70; y += 20) { g.rect(k.x + o - 5, y - 5, 10, 10); g.rect(k.x + k.w - o - 5, y - 5, 10, 10); }
  }
  g.fill({ color: T.pin, alpha: 0.85 });
  g.poly([k.x + 20, k.y + 20, k.x + 62, k.y + 20, k.x + 20, k.y + 62]).fill({ color: T.pin, alpha: 0.85 });
  // decoupling capacitors
  for (let x = k.x + 130; x <= k.x + k.w - 130; x += 46) for (const y of [k.y + 118, k.y + k.h - 132]) { g.rect(x, y, 28, 14); }
  for (let y = k.y + 130; y <= k.y + k.h - 130; y += 46) for (const x of [k.x + 118, k.x + k.w - 132]) { g.rect(x, y, 14, 28); }
  g.fill({ color: T.line });
  for (let x = k.x + 130; x <= k.x + k.w - 130; x += 46) for (const y of [k.y + 118, k.y + k.h - 132]) { g.rect(x, y, 5, 14); g.rect(x + 23, y, 5, 14); }
  for (let y = k.y + 130; y <= k.y + k.h - 130; y += 46) for (const x of [k.x + 118, k.x + k.w - 132]) { g.rect(x, y, 14, 5); g.rect(x, y + 23, 14, 5); }
  g.fill({ color: T.pin });
  // die
  box(g, d.x, d.y, d.w, d.h, 14, { fill: T.die, stroke: accent, lw: 4 });
  // the floorplan of this CPU's architecture (docs/DIE.md): blocks, stage frames and bond pads; the detail is the die view's (dieview.ts)
  dieFar(g, T, planOf(spec));
  labels.addChild(label(spec.name, k.x + 170, k.y + k.h - 148, 34, T.mute, { a: 0.75, weight: '700' }));
  labels.addChild(label('PIPELINE CITY · REV A', k.x + k.w - 170, k.y + k.h - 148, 20, T.mute, { a: 0.75, anchor: [1, 0.5] }));
  root.addChild(labels);
  return { root, labels };
}

// ---------------------------------------------------------------- RAM
/**
 * A DIMM stick in local coordinates; caller positions it at (DIMM_X(i), DIMM_Y(i)). Row 0 sticks (dimm0..3) have their pins at the
 * bottom, row 1 sticks (dimm4..7) are drawn upside down (pins at the top) so the pins face the memory bus between the rows.
 */
export function ramArt(T: Theme, spec: RamSpec, flip = false): Part {
  const root = new Container(), labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  const accent = spec.visual === 'dimm-lowlat' ? T.ld : spec.visual === 'dimm-fast' ? T.br : T.alu;
  const fy = (y: number, h = 0) => (flip ? DIMM_H - y - h : y);
  box(g, 0, 0, DIMM_W, DIMM_H, 10, { fill: T.sub, stroke: T.line, lw: 6 });
  box(g, 14, 50, 142, DIMM_H - 100, 6, { fill: T.die, stroke: accent, lw: 5, sa: 0.9 });
  const chips: Rect[] = [];
  for (let j = 0; j < 4; j++) {
    const cy = fy(84 + j * 128, 112);
    box(g, 27, cy, 116, 112, 8, { fill: T.tile, stroke: T.line, lw: 5 });
    chips.push({ x: 27, y: cy, w: 116, h: 112 });
    labels.addChild(label('DRAM', 85, cy + 12, 15, T.mute, { anchor: [0.5, 0.5] })); // the strip above the chip's memory map (ramview.ts)
  }
  if (spec.visual !== 'dimm-basic') {
    // heat spreader stripe on the faster sticks
    g.rect(14, 50, 12, DIMM_H - 100).fill({ color: accent, alpha: 0.7 });
    g.rect(144, 50, 12, DIMM_H - 100).fill({ color: accent, alpha: 0.7 });
  }
  for (let k = 0; k < 24; k++) g.rect(22 + k * 5.4, fy(DIMM_H - 58, 50), 3.4, 50);
  g.fill({ color: T.pin });
  for (let k = 0; k < 14; k++) g.rect(18 + k * 9.6, fy(24, 14), 8, 14);
  g.fill({ color: accent, alpha: 0.9 });
  labels.addChild(label(`${spec.banks} BANKS`, DIMM_W / 2, fy(58), 20, accent, { anchor: [0.5, 0.5], head: true })); // what the stick is, not how big (the OS knows the size)
  root.addChild(labels);
  return { root, labels, chips };
}

// ---------------------------------------------------------------- VRM heatsink (bolts onto the board's MOSFET strip)
/**
 * The three heatsinks over the VRM MOSFETs (visuals `vrm-sink-fins`, `vrm-sink-big`, `vrm-sink-fan`): thin passive fins, tall fins with a
 * heat pipe, and fins with a small fan at the east end. The fan (a spinning child returned as `fan`, kept above the bake) obeys the
 * power rules of the other fans.
 */
export function vrmSinkArt(T: Theme, visual: string, rect: Rect = VRM_SINK): Part {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const r = rect, big = visual === 'vrm-sink-big', withFan = visual === 'vrm-sink-fan';
  const metal = T.dark ? '#3b4663' : '#b7c1d3', metalHi = T.dark ? '#56628a' : '#dde4f0', metalLo = T.dark ? '#222a41' : '#8d99b1';
  const fanR = SINK_FAN_R, { x: fanCx, y: fanCy } = sinkFanAt(r);
  const finW = withFan ? fanCx - fanR - 40 - r.x : r.w;
  // base plate and drop shadow
  box(g, r.x + 8, r.y + 12, r.w, r.h, 18, { fill: '#000000', fa: 0.3 });
  box(g, r.x, r.y, r.w, r.h, 18, { fill: metalLo, stroke: mix(T.line, metal, 0.5), lw: 6 });
  // fins: thin and many (passive), fewer and taller with a lit top edge (big), a shorter block when a fan sits beside it
  const pitch = big ? 34 : 20, finH = r.h - (big ? 26 : 40);
  for (let x = r.x + 20; x < r.x + finW - 14; x += pitch) {
    g.rect(x, r.y + (r.h - finH) / 2, big ? 20 : 11, finH);
  }
  g.fill({ color: metal });
  for (let x = r.x + 20; x < r.x + finW - 14; x += pitch) g.rect(x, r.y + (r.h - finH) / 2, big ? 6 : 3, finH);
  g.fill({ color: metalHi, alpha: 0.7 });
  g.rect(r.x + 14, r.y + 8, finW - 28, 6).fill({ color: '#ffffff', alpha: T.dark ? 0.1 : 0.45 });
  if (big) {
    // a heat pipe running along the sink
    g.moveTo(r.x + 10, r.y + r.h * 0.5).lineTo(r.x + finW - 10, r.y + r.h * 0.5).stroke({ width: 22, color: T.pin, alpha: 0.85, cap: 'round' });
    g.moveTo(r.x + 10, r.y + r.h * 0.5 - 5).lineTo(r.x + finW - 10, r.y + r.h * 0.5 - 5).stroke({ width: 6, color: '#ffffff', alpha: 0.3, cap: 'round' });
  }
  let fan: Container | undefined;
  if (withFan) {
    // a small fan beside the fins: housing, blades that spin, hub
    disc(g, fanCx, fanCy, fanR + 18, { fill: T.sub, stroke: T.line, lw: 7 });
    fan = new Container();
    fan.position.set(fanCx, fanCy);
    const fg = new Graphics();
    disc(fg, 0, 0, fanR + 4, { fill: T.dot });
    blades(fg, 5, 12, fanR, T.tile, T.alu, 3);
    fan.addChild(fg);
    const hub = new Graphics();
    disc(hub, fanCx, fanCy, 14, { fill: T.tile, stroke: T.alu, lw: 4 });
    return { root, fan, over: hub };
  }
  return { root };
}

// ---------------------------------------------------------------- cooler (sits on the CPU)
export function coolerArt(T: Theme, spec: CoolerSpec): Part {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const c: Rect = COOLER, cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  const liquid = spec.visual === 'cooler-liquid', tower = spec.visual === 'cooler-tower';
  box(g, c.x, c.y, c.w, c.h, 60, { fill: T.tile, stroke: tower ? T.alu : liquid ? T.mul : T.line, lw: 10 });
  // fins
  for (let x = c.x + 40; x < c.x + c.w - 30; x += 26) g.moveTo(x, c.y + 24).lineTo(x, c.y + c.h - 24);
  g.stroke({ width: 8, color: T.line, alpha: 0.9 });
  for (const [x, y] of [[c.x + 40, c.y + 40], [c.x + c.w - 40, c.y + 40], [c.x + 40, c.y + c.h - 40], [c.x + c.w - 40, c.y + c.h - 40]] as const) disc(g, x, y, 22, { fill: T.pin });
  const fan = new Container();
  fan.position.set(cx, cy);
  const fr = tower ? 560 : liquid ? 330 : 430;
  const fg = new Graphics();
  disc(fg, 0, 0, fr + 30, { fill: T.sub, stroke: T.line, lw: 9 });
  blades(fg, tower ? 9 : liquid ? 5 : 7, 60, fr, T.dot, tower ? T.alu : T.br, 4);
  fan.addChild(fg);
  root.addChild(fan);
  const hub = new Graphics();
  hub.position.set(cx, cy);
  disc(hub, 0, 0, 62, { fill: T.tile, stroke: tower ? T.alu : T.br, lw: 7 });
  disc(hub, 0, 0, 20, { fill: tower ? T.alu : T.br });
  root.addChild(hub);
  if (tower) {
    // heat pipes
    for (let i = 0; i < 4; i++) g.moveTo(c.x + 120 + i * 40, c.y + c.h).lineTo(c.x + 120 + i * 40, c.y + c.h + 60);
    g.stroke({ width: 16, color: T.pin, alpha: 0.9 });
  }
  if (liquid) {
    // tubes up from the water block, each ending in a fitting (the radiator is off the board)
    const tubes: [number, number][][] = [
      [[cx - 90, c.y], [cx - 90, c.y - 140], [cx - 520, c.y - 140]],
      [[cx + 90, c.y], [cx + 90, c.y - 110], [cx + 520, c.y - 110]],
    ];
    for (const t of tubes) { g.moveTo(t[0]![0], t[0]![1]); for (const q of t.slice(1)) g.lineTo(q[0], q[1]); }
    g.stroke({ width: 40, color: T.line, join: 'round' });
    for (const t of tubes) { g.moveTo(t[0]![0], t[0]![1]); for (const q of t.slice(1)) g.lineTo(q[0], q[1]); }
    g.stroke({ width: 20, color: T.mul, alpha: 0.8, join: 'round' });
    for (const t of tubes) { const e = t[t.length - 1]!; disc(g, e[0], e[1], 34, { fill: T.tile, stroke: T.mul, lw: 8 }); }
  }
  return { root, fan };
}

// ---------------------------------------------------------------- PSU (below the board)
/**
 * The power supply as the case holds it: the PSU unit at the east end (fan grill, label with the rated watts, the output sockets on its
 * top edge, the power switch), and beside it, along the rest of the bottom, the shroud that hides the cables: vents, a brand stripe
 * and the live readout panel. `PSU` is the whole strip (the drop target), `PSU_UNIT` the unit.
 */
export function psuArt(T: Theme, spec: PsuSpec): Part {
  const root = new Container(), labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  const r = PSU, u = PSU_UNIT;
  const accent = spec.visual === 'psu-big' ? T.br : spec.visual === 'psu-mid' ? T.alu : T.pin;
  const body = T.dark ? mix(T.sub, T.tile, 0.45) : mix(T.sub, T.tile, 0.3);
  const shroud = T.dark ? mix(T.sub, T.bg, 0.35) : mix(T.sub, T.tile, 0.15);
  const sh = { x: r.x, y: r.y + 24, w: u.x - 70 - r.x, h: r.h - 48 };

  // the shroud: a long plate over the cables, a lit top edge, a perforated vent field, a brand stripe, the readout panel on it
  box(g, sh.x + 8, sh.y + 14, sh.w, sh.h, 50, { fill: '#000000', fa: 0.22 });
  box(g, sh.x, sh.y, sh.w, sh.h, 50, { fill: shroud, stroke: T.line, lw: 8, sa: 0.9 });
  g.rect(sh.x + 30, sh.y + 16, sh.w - 60, 12).fill({ color: '#ffffff', alpha: T.dark ? 0.06 : 0.28 });
  g.rect(sh.x + 60, sh.y + sh.h - 30, sh.w - 120, 8).fill({ color: accent, alpha: 0.6 });
  for (const sx of [sh.x + 60, sh.x + sh.w - 60]) for (const sy of [sh.y + 60, sh.y + sh.h - 60]) disc(g, sx, sy, 18, { fill: T.line, stroke: T.mute, lw: 4, sa: 0.4 });
  {
    const v = VENTS;
    if (v.w >= 300) {
      box(g, v.x, v.y, v.w, v.h, 24, { fill: T.dark ? '#02040a' : mix(shroud, '#000000', 0.4), fa: 0.55, stroke: T.line, lw: 4, sa: 0.5 });
      for (let y = v.y + 50; y < v.y + v.h - 30; y += 56) for (let x = v.x + 50 + (Math.round((y - v.y) / 56) % 2) * 28; x < v.x + v.w - 30; x += 56) g.circle(x, y, 13);
      g.fill({ color: T.dark ? '#000000' : mix(shroud, '#000000', 0.55), alpha: 0.8 });
    }
  }
  labels.addChild(label('PIPELINE CITY', sh.x + sh.w - 70, sh.y + 58, 40, T.mute, { head: true, anchor: [1, 0.5], a: 0.75 }));
  // readout panel frame (live content is drawn by Live)
  {
    const p = PSU_PANEL;
    box(g, p.x, p.y, p.w, p.h, 24, { fill: SCREEN_BG, stroke: accent, lw: 7, sa: 0.8 });
    box(g, p.x + 10, p.y + 10, p.w - 20, p.h - 20, 16, { stroke: T.line, lw: 3, sa: 0.5 });
    g.moveTo(p.x + 1150, p.y + 40).lineTo(p.x + 1150, p.y + p.h - 40).moveTo(p.x + 1620, p.y + 40).lineTo(p.x + 1620, p.y + p.h - 40);
    g.stroke({ width: 3, color: T.line, alpha: 0.7 });
    labels.addChild(label('LOAD', p.x + 50, p.y + 62, 46, '#8d9bc4', { head: true }));
    labels.addChild(label('TEMP', p.x + 1190, p.y + 62, 46, '#8d9bc4', { head: true }));
    labels.addChild(label('FAN', p.x + 1660, p.y + 62, 46, '#8d9bc4', { head: true }));
  }

  // the PSU unit: its own box, bolted to the case, with a seam between it and the shroud
  box(g, u.x + 10, u.y + 18, u.w, u.h, 40, { fill: '#000000', fa: 0.25 });
  box(g, u.x, u.y, u.w, u.h, 40, { fill: body, stroke: accent, lw: 10, sa: 0.9 });
  g.rect(u.x + 30, u.y + 16, u.w - 60, 14).fill({ color: '#ffffff', alpha: T.dark ? 0.07 : 0.3 });
  for (const sx of [u.x + 56, u.x + u.w - 56]) for (const sy of [u.y + 56, u.y + u.h - 56]) disc(g, sx, sy, 18, { fill: T.line, stroke: T.mute, lw: 4, sa: 0.5 });
  // fan grill (blades spin underneath the static grill)
  const fc = PSU_FAN;
  disc(g, fc.x, fc.y, fc.r + 70, { fill: T.die, stroke: T.line, lw: 9 });
  const fan = new Container();
  fan.position.set(fc.x, fc.y);
  const fg = new Graphics();
  disc(fg, 0, 0, fc.r + 20, { fill: T.dot });
  blades(fg, 7, 60, fc.r, T.tile, accent, 5);
  fan.addChild(fg);
  root.addChild(fan);
  const grill = new Graphics();
  grill.position.set(fc.x, fc.y);
  for (const rr of [120, 220, 320, 420]) grill.circle(0, 0, rr);
  grill.stroke({ width: 7, color: T.mute, alpha: 0.5 });
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; grill.moveTo(Math.cos(a) * 70, Math.sin(a) * 70).lineTo(Math.cos(a) * 440, Math.sin(a) * 440); }
  grill.stroke({ width: 5, color: T.mute, alpha: 0.35 });
  disc(grill, 0, 0, 70, { fill: T.tile, stroke: accent, lw: 7 });
  disc(grill, 0, 0, 22, { fill: accent });
  const over = new Container();
  over.addChild(grill);
  // label plate: model and rated capacity, and the efficiency badge
  {
    const l = PSU_LABEL;
    box(g, l.x, l.y, l.w, l.h, 22, { fill: T.die, stroke: T.line, lw: 5 });
    g.rect(l.x + 36, l.y + 128, l.w - 72, 6).fill({ color: accent, alpha: 0.8 });
    labels.addChild(label('PIPELINE CITY', l.x + 40, l.y + 62, 48, T.ink, { head: true, a: 0.85 }));
    labels.addChild(label(spec.name.replace(/ \(.*$/, ''), l.x + 40, l.y + 176, 36, T.mute));
    labels.addChild(label(`${spec.watts}`, l.x + 40, l.y + 380, 240, accent, { head: true, anchor: [0, 0.5] }));
    labels.addChild(label('WATTS', l.x + l.w - 44, l.y + 470, 62, T.mute, { head: true, anchor: [1, 0.5], a: 0.9 }));
    labels.addChild(label('12V', l.x + 40, l.y + 620, 38, T.mute, { a: 0.7 }));
    disc(g, l.x + l.w - 110, l.y + 640, 62, { stroke: accent, lw: 6, sa: 0.8 });
    labels.addChild(label('80+', l.x + l.w - 110, l.y + 640, 40, accent, { head: true, anchor: [0.5, 0.5] }));
  }
  // vent slots along the unit's bottom edge
  for (let k = 0; k < 6; k++) g.moveTo(u.x + 140 + k * 40, u.y + u.h - 150).lineTo(u.x + 140 + k * 40, u.y + u.h - 70);
  g.stroke({ width: 14, color: T.dark ? '#02040a' : mix(body, '#000000', 0.35), cap: 'round', alpha: 0.7 });
  // output sockets on the top edge: where the cables plug in
  for (const [x, w, name] of [[PSU_PORTS.pcie, 130, 'PCIe'], [PSU_PORTS.atx, 170, 'ATX 24'], [PSU_PORTS.cpu, 130, 'CPU 8']] as const) {
    box(g, x - w / 2, PORT_Y - 4, w, 90, 14, { fill: '#05070b', stroke: accent, lw: 5, sa: 0.7 });
    for (let k = 0; k < Math.floor((w - 40) / 26); k++) g.rect(x - w / 2 + 24 + k * 26, PORT_Y + 18, 14, 38);
    g.fill({ color: T.pin, alpha: 0.7 });
    labels.addChild(label(name, x, PORT_Y + 140, 38, T.mute, { anchor: [0.5, 0.5], a: 0.9 }));
  }
  // power switch
  box(g, u.x + 130, u.y + u.h - 240, 110, 150, 16, { fill: '#05070b', stroke: T.line, lw: 5 });
  g.rect(u.x + 148, u.y + u.h - 222, 74, 74).fill({ color: T.mute, alpha: 0.6 });
  labels.addChild(label('I/O', u.x + 185, u.y + u.h - 66, 32, T.mute, { anchor: [0.5, 0.5] }));
  root.addChild(labels);
  return { root, fan, over };
}

/**
 * A power supply as a box on its own (for the shop and the inventory): the fan grill, the label with the rated watts, the vents and the
 * output sockets. The one in the machine is the long shroud with the readout (`psuArt`); this is the same unit, small.
 */
export function psuBoxArt(T: Theme, spec: PsuSpec): Container {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  const W = 2100, H = 1500;
  const accent = spec.visual === 'psu-big' ? T.br : spec.visual === 'psu-mid' ? T.alu : T.pin;
  const body = T.dark ? mix(T.sub, T.tile, 0.45) : mix(T.sub, T.tile, 0.3);
  box(g, 18, 26, W, H, 80, { fill: '#000000', fa: 0.28 });
  box(g, 0, 0, W, H, 80, { fill: body, stroke: accent, lw: 12, sa: 0.9 });
  g.rect(40, 24, W - 80, 16).fill({ color: '#ffffff', alpha: T.dark ? 0.07 : 0.3 });
  // fan grill
  const fx = 640, fy = H / 2, fr = 470;
  disc(g, fx, fy, fr + 70, { fill: T.die, stroke: T.line, lw: 10 });
  const bl = new Graphics();
  bl.position.set(fx, fy);
  blades(bl, 7, 60, fr - 20, T.tile, accent, 5);
  root.addChild(bl);
  for (const rr of [140, 240, 340, 440]) g.circle(fx, fy, rr);
  g.stroke({ width: 7, color: T.mute, alpha: 0.5 });
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; g.moveTo(fx + Math.cos(a) * 80, fy + Math.sin(a) * 80).lineTo(fx + Math.cos(a) * (fr + 20), fy + Math.sin(a) * (fr + 20)); }
  g.stroke({ width: 5, color: T.mute, alpha: 0.35 });
  disc(g, fx, fy, 74, { fill: T.tile, stroke: accent, lw: 8 }); disc(g, fx, fy, 24, { fill: accent });
  // label plate: the rated watts, big
  const l = { x: 1250, y: 150, w: 740, h: 640 };
  box(g, l.x, l.y, l.w, l.h, 30, { fill: T.die, stroke: T.line, lw: 6 });
  g.rect(l.x + 40, l.y + 120, l.w - 80, 7).fill({ color: accent, alpha: 0.85 });
  root.addChild(label('PIPELINE CITY', l.x + 40, l.y + 66, 54, T.ink, { head: true, a: 0.85 }));
  root.addChild(label(`${spec.watts}`, l.x + 40, l.y + 330, 250, accent, { head: true, anchor: [0, 0.5] }));
  root.addChild(label('WATTS', l.x + l.w - 40, l.y + 560, 70, T.mute, { head: true, anchor: [1, 0.5], a: 0.9 }));
  // vents and the output sockets along the bottom edge
  for (let y = 880; y < 1180; y += 56) g.moveTo(1250, y).lineTo(1990, y);
  g.stroke({ width: 16, color: T.dark ? '#02040a' : mix(body, '#000000', 0.35), cap: 'round', alpha: 0.7 });
  for (const [x, w] of [[1260, 200], [1500, 230], [1780, 200]] as const) {
    box(g, x, H - 170, w, 90, 14, { fill: '#05070b', stroke: accent, lw: 5, sa: 0.7 });
    for (let k = 0; k < Math.floor((w - 40) / 26); k++) g.rect(x + 24 + k * 26, H - 150, 14, 38);
    g.fill({ color: T.pin, alpha: 0.7 });
  }
  return root;
}

// ---------------------------------------------------------------- monitor (west of the board, 16:9)
export function monitorArt(T: Theme, on: boolean): Part {
  const root = new Container(), labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  // drawn at its design size (3300 x 1995, the screen inset by 90 / 80) and scaled up into place
  root.position.set(MONITOR.x, MONITOR.y); root.scale.set(MONITOR_K);
  const m = { x: 0, y: 0, w: 3300, h: 1995 }, s = { x: 90, y: 80, w: SCREEN_D.w, h: SCREEN_D.h };
  const shell = T.dark ? '#171d2b' : '#2a313f', shellHi = mix(shell, '#ffffff', T.dark ? 0.1 : 0.14), shellLo = mix(shell, '#000000', 0.35);
  const cx = m.x + m.w / 2, by = m.y + m.h;
  // ---- the stand: a flat oval base on a rubber strip, a neck that fans out to a hinge under the bezel (lit on the left, shaded on the right) ----
  box(g, cx - 780, by + 345, 1560, 90, 45, { fill: '#000000', fa: 0.22 });
  box(g, cx - 800, by + 318, 1600, 82, 41, { fill: shell, stroke: T.line, lw: 5 });
  box(g, cx - 780, by + 322, 1560, 34, 17, { fill: shellHi, fa: 0.55 });
  g.rect(cx - 740, by + 388, 1480, 12).fill({ color: '#000000', alpha: 0.45 });
  g.poly([cx - 130, by, cx + 130, by, cx + 250, by + 322, cx - 250, by + 322]).fill({ color: shell }).stroke({ width: 4, color: T.line, alpha: 0.8 });
  g.poly([cx - 130, by, cx - 10, by, cx - 20, by + 322, cx - 250, by + 322]).fill({ color: shellHi, alpha: 0.55 });
  g.poly([cx + 60, by, cx + 130, by, cx + 250, by + 322, cx + 130, by + 322]).fill({ color: '#000000', alpha: 0.25 });
  box(g, cx - 210, by - 22, 420, 74, 34, { fill: shellLo, stroke: T.line, lw: 4 });
  // ---- the body: a soft shadow on the wall, the shell (a lit rim along the top, a darker chin), the glass set deep in a black border ----
  box(g, m.x + 14, m.y + 26, m.w, m.h, 80, { fill: '#000000', fa: 0.26 });
  box(g, m.x, m.y, m.w, m.h, 80, { fill: shell, stroke: T.line, lw: 7 });
  box(g, m.x + 8, m.y + 8, m.w - 16, m.h * 0.46, 72, { fill: shellHi, fa: 0.4 });
  box(g, m.x + 8, m.y + m.h * 0.72, m.w - 16, m.h * 0.28 - 8, 72, { fill: '#000000', fa: 0.18 });
  g.roundRect(m.x + 4, m.y + 4, m.w - 8, m.h - 8, 76).stroke({ width: 5, color: '#ffffff', alpha: T.dark ? 0.12 : 0.18 });
  box(g, s.x - 26, s.y - 26, s.w + 52, s.h + 52, 38, { fill: '#020406' });
  g.roundRect(s.x - 26, s.y - 26, s.w + 52, s.h + 52, 38).stroke({ width: 4, color: '#000000', alpha: 0.6 });
  box(g, s.x, s.y, s.w, s.h, 14, { fill: SCREEN_BG });
  if (on) g.roundRect(s.x, s.y, s.w, s.h, 14).stroke({ width: 10, color: T.st, alpha: 0.08 });
  // scanlines and glass: a sheen across, a lit line along the top edge, the corners darker
  for (let y = s.y + 8; y < s.y + s.h; y += 10) g.moveTo(s.x, y).lineTo(s.x + s.w, y);
  g.stroke({ width: 3, color: on ? T.st : '#ffffff', alpha: on ? 0.035 : 0.02 });
  g.poly([s.x + 20, s.y + s.h - 20, s.x + 700, s.y + 20, s.x + 1120, s.y + 20, s.x + 440, s.y + s.h - 20]).fill({ color: '#ffffff', alpha: 0.03 });
  g.poly([s.x + 1300, s.y + s.h - 20, s.x + 1700, s.y + 20, s.x + 1820, s.y + 20, s.x + 1420, s.y + s.h - 20]).fill({ color: '#ffffff', alpha: 0.018 });
  g.rect(s.x + 30, s.y + 4, s.w - 60, 6).fill({ color: '#ffffff', alpha: 0.07 });
  for (const [qx, qy] of [[s.x, s.y], [s.x + s.w - 160, s.y], [s.x, s.y + s.h - 160], [s.x + s.w - 160, s.y + s.h - 160]] as const) g.rect(qx, qy, 160, 160).fill({ color: '#000000', alpha: 0.05 });
  // ---- the chin: a little skyline mark and the brand, the power lamp and the touch buttons ----
  const cy = s.y + s.h + 26 + (m.y + m.h - (s.y + s.h + 26)) / 2;
  for (const [dx, hh] of [[0, 20], [14, 34], [28, 26], [42, 40], [56, 22]] as const) g.rect(cx - 150 + dx, cy + 20 - hh, 10, hh).fill({ color: T.mute, alpha: 0.7 });
  labels.addChild(label('PIPELINE CITY', cx + 40, cy, 40, T.mute, { head: true, anchor: [0, 0.5], a: 0.85 }));
  for (let k = 0; k < 4; k++) disc(g, m.x + m.w - 520 + k * 62, cy, 7, { fill: T.mute, fa: 0.35 });
  disc(g, m.x + m.w - 220, cy, 26, { fill: '#000000', fa: 0.4 });
  disc(g, m.x + m.w - 220, cy, 14, { fill: on ? T.st : T.mute, fa: on ? 1 : 0.4 });
  if (on) disc(g, m.x + m.w - 220, cy, 34, { fill: T.st, fa: 0.12 });
  // no sockets: the monitor's video cable and its mains cord are built in and come out from behind it
  labels.addChild(label('CLI MONITOR', m.x + 20, m.y - 40, 56, T.ink, { a: 0.8 }));
  root.addChild(labels);
  return { root };
}

// ---------------------------------------------------------------- cables (PSU to board, board to monitor)
export const ACCENT = (T: Theme, k: Cable['kind']) => (k === 'atx' ? T.ld : k === 'cpu' ? T.alu : k === 'pcie' ? T.br : T.st);

export function plugRect(p: Plug): Rect {
  return p.dx !== 0
    ? { x: p.dx > 0 ? p.x : p.x - p.l, y: p.y - p.w / 2, w: p.l, h: p.w }
    : { x: p.x - p.w / 2, y: p.dy > 0 ? p.y : p.y - p.l, w: p.w, h: p.l };
}

export function drawPlug(g: Graphics, T: Theme, p: Plug, accent: string, host: boolean, shape: 'power' | 'hdmi' | 'rj45' = 'power') {
  // the signal plugs are drawn in side profile (ports.ts), the power plugs seen from above
  if (shape === 'hdmi') return hdmiPlug(g, T, p, accent);
  if (shape === 'rj45') return rj45Plug(g, T, p, accent);
  const r = plugRect(p);
  const body = T.dark ? '#1b2230' : '#2c3442';
  box(g, r.x + 6, r.y + 10, r.w, r.h, 16, { fill: '#000000', fa: 0.25 });
  box(g, r.x, r.y, r.w, r.h, 16, { fill: body, stroke: accent, lw: 6, sa: 0.9 });
  const horiz = p.dx !== 0;
  // grip ridges toward the cable end
  for (let i = 0; i < 5; i++) {
    const t = 0.52 + i * 0.09;
    if (horiz) { const x = p.dx > 0 ? r.x + r.w * t : r.x + r.w * (1 - t); g.moveTo(x, r.y + 12).lineTo(x, r.y + r.h - 12); }
    else { const y = p.dy > 0 ? r.y + r.h * t : r.y + r.h * (1 - t); g.moveTo(r.x + 12, y).lineTo(r.x + r.w - 12, y); }
  }
  g.stroke({ width: 5, color: '#ffffff', alpha: 0.16 });
  const [cols, rows] = p.pins;
  if (host && cols * rows > 1) {
    // pin holes on the socket-side part, laid out along the long axis
    const long = horiz ? r.h : r.w, step = long / (cols + 0.6);
    for (let c = 0; c < cols; c++) for (let k = 0; k < rows; k++) {
      const along = (c + 0.8) * step, across = (k + 0.5) / rows;
      const x = horiz ? (p.dx > 0 ? r.x + r.w * (0.1 + across * 0.3) : r.x + r.w * (0.9 - across * 0.3)) - 9 : r.x + along - 9;
      const y = horiz ? r.y + along - 9 : (p.dy > 0 ? r.y + r.h * (0.1 + across * 0.3) : r.y + r.h * (0.9 - across * 0.3)) - 9;
      g.rect(x, y, 18, 18);
    }
    g.fill({ color: '#000000', alpha: 0.55 });
  }
  if (host && cols * rows <= 1) {
    // HDMI shell: metal face
    const sx = horiz ? (p.dx > 0 ? r.x + 6 : r.x + r.w * 0.55) : r.x + 6, sw = horiz ? r.w * 0.45 : r.w - 12;
    g.rect(sx, r.y + 10, sw, r.h - 20).fill({ color: '#aeb8c8', alpha: 0.5 });
  }
  // coloured sleeve band where the cable leaves the plug
  const bx = horiz ? (p.dx > 0 ? r.x + r.w - 26 : r.x) : r.x, by = horiz ? r.y : (p.dy > 0 ? r.y + r.h - 26 : r.y);
  g.rect(bx, by, horiz ? 26 : r.w, horiz ? r.h : 26).fill({ color: accent, alpha: 0.85 });
}

/** A fat sleeved cable with plugs at both ends. Static; the glow lives in Live. */
export function cableArt(T: Theme, c: Cable): Part {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const pts = c.path.pts, w = c.w, accent = ACCENT(T, c.kind);
  const sleeve = T.dark ? '#171d29' : '#2a313d';
  const line = (list: [number, number][]) => { g.moveTo(list[0]![0], list[0]![1]); for (let i = 1; i < list.length; i++) g.lineTo(list[i]![0], list[i]![1]); };
  // drop shadow, sleeve, braid, highlight
  line(pts.map(([x, y]) => [x + 10, y + 14] as [number, number]));
  g.stroke({ width: w + 8, color: '#000000', alpha: 0.28, cap: 'round', join: 'round' });
  const outside = c.kind === 'video' && T.dark; // the video cable runs over the wall: a pale rim keeps it readable on the dark slats
  if (outside) { line(pts); g.stroke({ width: w * 2, color: '#8fa3d6', alpha: 0.1, cap: 'round', join: 'round' }); line(pts); g.stroke({ width: w * 1.4, color: '#8fa3d6', alpha: 0.2, cap: 'round', join: 'round' }); }
  line(pts); g.stroke({ width: w, color: outside ? '#2a3554' : sleeve, cap: 'round', join: 'round' });
  line(pts); g.stroke({ width: w, color: accent, alpha: 0.12, cap: 'round', join: 'round' });
  // braid: short diagonal ticks across the sleeve
  for (let i = 2; i < pts.length - 2; i += 2) {
    const a = pts[i - 1]!, b = pts[i + 1]!, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l, tx = dx / l, ty = dy / l, h = w * 0.46;
    g.moveTo(pts[i]![0] + nx * h - tx * w * 0.16, pts[i]![1] + ny * h - ty * w * 0.16).lineTo(pts[i]![0] - nx * h + tx * w * 0.16, pts[i]![1] - ny * h + ty * w * 0.16);
  }
  g.stroke({ width: Math.max(3, w * 0.05), color: '#ffffff', alpha: T.dark ? 0.1 : 0.14 });
  line(offsetLine(pts, -w * 0.24)); g.stroke({ width: w * 0.12, color: '#ffffff', alpha: T.dark ? 0.1 : 0.16, cap: 'round', join: 'round' });
  line(offsetLine(pts, w * 0.3)); g.stroke({ width: w * 0.1, color: '#000000', alpha: 0.22, cap: 'round', join: 'round' });
  const shape = c.kind === 'video' ? 'hdmi' : 'power';
  drawPlug(g, T, c.a, accent, c.kind === 'video', shape);
  if (c.kind !== 'video') drawPlug(g, T, c.b, accent, true, shape); // (the video cable's other end is inside the monitor)
  return { root };
}

/** An unplugged cable: a short stub from the PSU socket / monitor port ending in a loose plug lying at rest. */
export function looseCableArt(T: Theme, c: Cable): Part {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const lo = looseCable(c), pts = lo.path.pts, w = c.w * (c.kind === 'video' ? 1 : 0.62), accent = ACCENT(T, c.kind);
  const sleeve = T.dark ? '#171d29' : '#2a313d';
  const line = (list: [number, number][]) => { g.moveTo(list[0]![0], list[0]![1]); for (let i = 1; i < list.length; i++) g.lineTo(list[i]![0], list[i]![1]); };
  line(pts.map(([x, y]) => [x + 8, y + 12] as [number, number]));
  g.stroke({ width: w + 6, color: '#000000', alpha: 0.28, cap: 'round', join: 'round' });
  const outside = c.kind === 'video' && T.dark;
  if (outside) { line(pts); g.stroke({ width: w * 2, color: '#8fa3d6', alpha: 0.1, cap: 'round', join: 'round' }); line(pts); g.stroke({ width: w * 1.4, color: '#8fa3d6', alpha: 0.2, cap: 'round', join: 'round' }); }
  line(pts); g.stroke({ width: w, color: outside ? '#2a3554' : sleeve, cap: 'round', join: 'round' });
  line(pts); g.stroke({ width: w, color: accent, alpha: 0.14, cap: 'round', join: 'round' });
  const shape = c.kind === 'video' ? 'hdmi' : 'power';
  if (c.kind !== 'video') drawPlug(g, T, c.a, accent, false, shape); // (a video cable comes out of the monitor: no plug there)
  drawPlug(g, T, lo.plug, accent, true, shape);
  void movablePlug;
  return { root };
}
