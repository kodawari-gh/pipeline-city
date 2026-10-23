import { Container, Graphics } from 'pixi.js';
import type { CoolerSpec, CpuSpec, PsuSpec, RamSpec } from '../sim/board/specs';
import { BLOCKS, BR, COOLER, DIE, DIMM_H, DIMM_W, MONITOR, PKG, PSU, SCREEN, STAGES, type Rect, type Tile } from './layout';
import { box, dashed, disc, label } from './ink';
import type { Theme } from './theme';

// Static art for installed devices. Everything is drawn in world coordinates unless noted.
// Live effects (glow, fan spin, chips) are added by board.ts on top.

export const SCREEN_BG = '#050a0c';

export interface Part {
  root: Container;
  /** Text labels, hidden when far out. */
  labels?: Container;
  /** A child that board.ts rotates for fans. */
  fan?: Container;
  /** Sub-rects (world coords) that can flash, e.g. DRAM chips. */
  chips?: Rect[];
}

/** Draw `n` fan blades around the origin of `g` (blade length r1, root radius r0). */
function blades(g: Graphics, n: number, r0: number, r1: number, fill: string, edge: string, edgeW: number) {
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
  box(g, k.x, k.y, k.w, k.h, 70, { fill: T.sub, stroke: T.line, lw: 5 });
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
  for (let x = d.x + 24; x < d.x + d.w - 20; x += 18) { g.rect(x, d.y + 12, 7, 7); g.rect(x, d.y + d.h - 19, 7, 7); }
  for (let y = d.y + 40; y < d.y + d.h - 36; y += 18) { g.rect(d.x + 12, y, 7, 7); g.rect(d.x + d.w - 19, y, 7, 7); }
  g.fill({ color: T.line });

  const drawTile = (t: Tile, big: boolean) => {
    box(g, t.x, t.y, t.w, t.h, 12, { fill: T.tile, stroke: T.line, lw: 3, fa: big ? 1 : 0.7 });
    if (t.label) labels.addChild(label(t.label, t.x + 12, t.y + 18, big ? 22 : 17, T.mute, { weight: '700' }));
    if (t.sub) labels.addChild(label(t.sub, t.x + 12, t.y + 42, 15, T.mute, { a: 0.8 }));
  };
  for (const t of BLOCKS) drawTile(t, false);
  for (const t of STAGES) {
    box(g, t.x, t.y, t.w, t.h, 12, { fill: T.tile, stroke: T.line, lw: 3 });
    labels.addChild(label(t.label, t.x + 14, t.y + 20, 24, T.ink, { weight: '700' }));
    labels.addChild(label(t.sub, t.x + 14, t.y + 46, 15, T.mute, { a: 0.8 }));
  }
  // decor texture inside blocks
  const byId = Object.fromEntries(BLOCKS.map((b) => [b.id, b])) as Record<string, Tile>;
  const l2 = byId.L2!;
  for (let x = l2.x + 12; x < l2.x + l2.w; x += 14) g.moveTo(x, l2.y + 6).lineTo(x, l2.y + l2.h - 6);
  for (let y = l2.y + 12; y < l2.y + l2.h; y += 14) g.moveTo(l2.x + 6, y).lineTo(l2.x + l2.w - 6, y);
  g.stroke({ width: 1.2, color: T.line, alpha: 0.55 });
  for (let s = 1; s < 4; s++) g.rect(l2.x + (l2.w * s) / 4 - 8, l2.y + 6, 16, l2.h - 12);
  g.rect(l2.x + 6, l2.y + l2.h / 2 - 8, l2.w - 12, 16);
  g.fill({ color: T.die });
  const un = byId.UNCORE!;
  for (let i = 0; i < 14; i++) for (let j = 0; j < 2; j++) g.rect(un.x + 20 + i * 34, un.y + 64 + j * 34, 22, 20);
  g.fill({ color: T.line, alpha: 0.6 });
  const io = byId.IO!;
  for (let i = 0; i < 9; i++) g.rect(io.x + 14 + i * 20, io.y + 58, 10, 40);
  g.fill({ color: T.pin, alpha: 0.6 });
  const rf = byId.RF!;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.rect(rf.x + 14 + i * 45, rf.y + 40 + j * 24, 38, 18);
  g.fill({ color: T.line, alpha: 0.7 });
  for (const id of ['IC', 'DC']) {
    const b = byId[id]!;
    for (let i = 0; i < 4; i++) g.rect(b.x + 12 + i * 46, b.y + 50, 40, 36);
    g.fill({ color: T.line, alpha: 0.6 });
  }
  const mc = byId.MC!;
  for (let i = 0; i < 6; i++) g.rect(mc.x + 14, mc.y + 52 + i * 15, 172, 8);
  g.fill({ color: T.line, alpha: 0.6 });
  const clk = byId.CLK!;
  for (let i = 1; i < 4; i++) g.circle(clk.x + clk.w - 50, clk.y + clk.h / 2 + 10, i * 12);
  g.stroke({ width: 3, color: accent, alpha: 0.7 });
  // links between stages
  for (let k2 = 0; k2 < 4; k2++) {
    const a = STAGES[k2]!, b = STAGES[k2 + 1]!, y = a.y + a.h / 2 + 10;
    g.moveTo(a.x + a.w, y).lineTo(b.x, y);
  }
  g.stroke({ width: 4, color: T.line });
  // forwarding path on the forwarding CPU
  if (spec.visual === 'cpu-inorder-fwd') {
    const ex = STAGES[2]!, mem = STAGES[3]!, top = ex.y - 28;
    const pts: [number, number][] = [[mem.x + 100, mem.y], [mem.x + 100, top], [ex.x + 100, top], [ex.x + 100, ex.y]];
    dashed(g, pts, 14, 8);
    g.stroke({ width: 4, color: T.st, alpha: 0.9 });
  }
  labels.addChild(label(spec.name, k.x + 170, k.y + k.h - 148, 34, T.mute, { a: 0.75, weight: '700' }));
  labels.addChild(label('PIPELINE CITY · REV A', k.x + k.w - 170, k.y + k.h - 148, 20, T.mute, { a: 0.75, anchor: [1, 0.5] }));
  root.addChild(labels);
  return { root, labels };
}

// ---------------------------------------------------------------- RAM
/** A DIMM stick in local coordinates; caller positions it at (DIMM_X(i), DIMM_Y). */
export function ramArt(T: Theme, spec: RamSpec): Part {
  const root = new Container(), labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  const accent = spec.visual === 'dimm-lowlat' ? T.ld : spec.visual === 'dimm-fast' ? T.br : T.alu;
  box(g, 0, 0, DIMM_W, DIMM_H, 10, { fill: T.sub, stroke: T.line, lw: 6 });
  box(g, 14, 50, 142, DIMM_H - 100, 6, { fill: T.die, stroke: accent, lw: 5, sa: 0.9 });
  const chips: Rect[] = [];
  for (let j = 0; j < 8; j++) {
    const cy = 100 + j * 182;
    box(g, 27, cy, 116, 150, 8, { fill: T.tile, stroke: T.line, lw: 5 });
    chips.push({ x: 27, y: cy, w: 116, h: 150 });
    labels.addChild(label('DRAM', 85, cy + 75, 26, T.mute, { anchor: [0.5, 0.5] }));
  }
  if (spec.visual !== 'dimm-basic') {
    // heat spreader stripe on the faster sticks
    g.rect(14, 50, 12, DIMM_H - 100).fill({ color: accent, alpha: 0.7 });
    g.rect(144, 50, 12, DIMM_H - 100).fill({ color: accent, alpha: 0.7 });
  }
  for (let k = 0; k < 24; k++) g.rect(22 + k * 5.4, DIMM_H - 58, 3.4, 50);
  g.fill({ color: T.pin });
  for (let k = 0; k < 14; k++) g.rect(18 + k * 9.6, 24, 8, 14);
  g.fill({ color: accent, alpha: 0.9 });
  labels.addChild(label(`${spec.sizeBytes / 1024}K`, DIMM_W / 2, 56, 40, accent, { anchor: [0.5, 0.5], head: true }));
  root.addChild(labels);
  return { root, labels, chips };
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
    // tubes up to the top edge with glowing coolant
    g.moveTo(cx - 90, c.y).lineTo(cx - 90, c.y - 140).lineTo(cx - 520, c.y - 140);
    g.moveTo(cx + 90, c.y).lineTo(cx + 90, c.y - 110).lineTo(cx + 520, c.y - 110);
    g.stroke({ width: 40, color: T.line });
    g.moveTo(cx - 90, c.y).lineTo(cx - 90, c.y - 140).lineTo(cx - 520, c.y - 140);
    g.moveTo(cx + 90, c.y).lineTo(cx + 90, c.y - 110).lineTo(cx + 520, c.y - 110);
    g.stroke({ width: 20, color: T.mul, alpha: 0.8 });
  }
  return { root, fan };
}

// ---------------------------------------------------------------- PSU (off the board, right side)
export function psuArt(T: Theme, spec: PsuSpec): Part {
  const root = new Container(), labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  const r = PSU;
  const accent = spec.visual === 'psu-big' ? T.br : spec.visual === 'psu-mid' ? T.alu : T.pin;
  box(g, r.x, r.y, r.w, r.h, 40, { fill: T.sub, stroke: accent, lw: 10 });
  // vent slots
  for (let y = r.y + 70; y < r.y + r.h - 70; y += 44) g.moveTo(r.x + r.w - 260, y).lineTo(r.x + r.w - 50, y);
  g.stroke({ width: 10, color: T.line });
  // wires to the board's 24-pin connector, bundled
  const colours = [T.ld, T.st, T.bad, T.alu, T.mul, T.pin];
  const y0 = BR.atx.y + 110;
  for (let i = 0; i < 6; i++) {
    g.moveTo(r.x, y0 + i * 80).lineTo(BR.atx.x + BR.atx.w + 30 + i * 6, y0 + i * 80).stroke({ width: 22, color: colours[i]!, alpha: 0.9, cap: 'round' });
  }
  const fan = new Container();
  fan.position.set(r.x + 460, r.y + r.h / 2);
  const fg = new Graphics();
  disc(fg, 0, 0, 440, { fill: T.die, stroke: T.line, lw: 9 });
  blades(fg, 7, 50, 400, T.dot, accent, 4);
  fan.addChild(fg);
  root.addChild(fan);
  const hub = new Graphics();
  hub.position.set(r.x + 460, r.y + r.h / 2);
  disc(hub, 0, 0, 56, { fill: T.tile, stroke: accent, lw: 7 });
  root.addChild(hub);
  labels.addChild(label(`${spec.watts} W`, r.x + r.w - 150, r.y + r.h - 120, 100, accent, { head: true, anchor: [0.5, 0.5] }));
  labels.addChild(label('PSU', r.x + 30, r.y - 40, 60, T.ink, { a: 0.5 }));
  root.addChild(labels);
  return { root, labels, fan };
}

/** Power load meter drawn on the PSU (live, redrawn per snapshot). */
export function drawPsuMeter(g: Graphics, T: Theme, ratio: number, tripped: boolean) {
  g.clear();
  const r = PSU, x = r.x + 40, y = r.y + 70, w = r.w - 80, h = 54;
  box(g, x, y, w, h, 10, { fill: T.die, stroke: T.line, lw: 4 });
  const f = Math.min(1, ratio);
  const col = tripped || ratio > 1 ? T.bad : ratio > 0.8 ? T.ld : T.st;
  box(g, x + 6, y + 6, Math.max(0, (w - 12) * f), h - 12, 6, { fill: col });
}

// ---------------------------------------------------------------- monitor (off the board, left side)
export function monitorArt(T: Theme, on: boolean): Part {
  const root = new Container(), labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  const m = MONITOR, s = SCREEN;
  box(g, m.x, m.y, m.w, m.h, 70, { fill: T.sub, stroke: T.line, lw: 12 });
  box(g, s.x, s.y, s.w, s.h, 30, { fill: SCREEN_BG, stroke: on ? T.st : T.line, lw: 8, sa: on ? 0.8 : 1 });
  // stand + cable to the rear I/O
  g.rect(m.x + m.w / 2 - 120, m.y + m.h, 240, 70).fill({ color: T.line });
  g.moveTo(m.x + m.w, m.y + m.h * 0.55).lineTo(-3400 + 200, m.y + m.h * 0.55).lineTo(-3400 + 200, -1500).stroke({ width: 22, color: T.mul, alpha: 0.8, cap: 'round', join: 'round' });
  labels.addChild(label('CLI MONITOR', m.x + 30, m.y - 40, 60, T.ink, { a: 0.5 }));
  root.addChild(labels);
  return { root, labels };
}

