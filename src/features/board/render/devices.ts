import { Container, Graphics } from 'pixi.js';
import type { CpuSpec, PsuSpec, RamSpec } from '../sim/specs';
import * as layout from './layout/layout';
import { SINK_FAN, SINK_FAN_RIM } from './layout/boardlayout';
import { brandLockup } from '../../room/render/shell/casedecor';
import { box, disc, label, mix } from '@/core/render/ink';
import { dieFar, planOf } from '../../cpu/render/die/dieart';
import * as routes from './wiring/routes';
import type { Theme } from '@/core/render/theme';

// Static art for installed devices. Everything is drawn in world coordinates unless noted.
// Live effects (glow, fan spin, chips) are added by board.ts on top.

const SCREEN_BG = '#050a0c';

export interface Part {
  root: Container;
  /** Text labels, hidden when far out. */
  labels?: Container;
  /** A child that board.ts rotates for fans (kept above the baked far-LOD texture). */
  fan?: Container | undefined;
  /** A second fan the PSU spins in the case's rear wall (the PSU's exhaust). */
  rearFan?: Container | undefined;
  /** Static art that must stay above `fan` (e.g. the PSU grill). */
  over?: Container;
  /** Sub-rects (world coords) that can flash, e.g. DRAM chips. */
  chips?: layout.Rect[];
  /** A heat sink's fin rails and heat pipe as drawn (world coords), for the 3D view to stand up. */
  fins?: layout.Rect[];
  pipe?: layout.Rect;
}

/** Draw `n` fan blades around the origin of `g` (blade length r1, root radius r0). */
export function blades(g: Graphics, n: number, r0: number, r1: number, fill: string, edge: string, edgeW: number) {
  for (let b = 0; b < n; b++) {
    const a = (b / n) * Math.PI * 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    const R = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c];
    const p0 = R(r0, 0),
      c1 = R(r1 * 0.5, -r1 * 0.38),
      c2 = R(r1 * 0.9, -r1 * 0.3),
      p1 = R(r1, -r1 * 0.02);
    const c3 = R(r1 * 0.85, r1 * 0.2),
      c4 = R(r1 * 0.45, r1 * 0.2);
    g.moveTo(p0[0], p0[1])
      .bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p1[0], p1[1])
      .bezierCurveTo(c3[0], c3[1], c4[0], c4[1], p0[0], p0[1]);
  }
  g.fill({ color: fill });
  for (let b = 0; b < n; b++) {
    const a = (b / n) * Math.PI * 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    const R = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c];
    const p0 = R(r0, 0),
      c1 = R(r1 * 0.5, -r1 * 0.38),
      c2 = R(r1 * 0.9, -r1 * 0.3),
      p1 = R(r1, -r1 * 0.02);
    g.moveTo(p0[0], p0[1]).bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p1[0], p1[1]);
  }
  g.stroke({ width: edgeW, color: edge, alpha: 0.6 });
}

// ---------------------------------------------------------------- CPU
/** The package's decoupling capacitors, in a ring between the pad rows and the die (the 3D stands them up where the art draws them). */
export function cpuCaps(): layout.Rect[] {
  const k = layout.PKG,
    cin = 84,
    cout = 98,
    out: layout.Rect[] = [];
  for (let x = k.x + 110; x <= k.x + k.w - 110; x += 46) {
    for (const y of [k.y + cin, k.y + k.h - cout]) {
      out.push({ x, y, w: 28, h: 14 });
    }
  }
  for (let y = k.y + 110; y <= k.y + k.h - 110; y += 46) {
    for (const x of [k.x + cin, k.x + k.w - cout]) {
      out.push({ x, y, w: 14, h: 28 });
    }
  }
  return out;
}

export function cpuArt(T: Theme, spec: CpuSpec): Part {
  const root = new Container(),
    labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  const { PKG: k, DIE: d } = layout;
  const accent = spec.visual === 'cpu-inorder-fwd' ? T.st : spec.visual === 'cpu-inorder' ? T.alu : T.mute;
  box(g, k.x, k.y, k.w, k.h, 70, { fill: T.sub, stroke: mix(T.line, accent, 0.5), lw: 7 });
  // pins: three rows around the edge
  for (let r = 0; r < 3; r++) {
    const o = 24 + r * 20;
    for (let x = k.x + 70; x <= k.x + k.w - 70; x += 20) {
      g.rect(x - 5, k.y + o - 5, 10, 10);
      g.rect(x - 5, k.y + k.h - o - 5, 10, 10);
    }
    for (let y = k.y + 70; y <= k.y + k.h - 70; y += 20) {
      g.rect(k.x + o - 5, y - 5, 10, 10);
      g.rect(k.x + k.w - o - 5, y - 5, 10, 10);
    }
  }
  g.fill({ color: T.pin, alpha: 0.85 });
  g.poly([k.x + 20, k.y + 20, k.x + 62, k.y + 20, k.x + 20, k.y + 62]).fill({ color: T.pin, alpha: 0.85 });
  // decoupling capacitors in a ring between the pad rows and the die, a pad at each end
  const caps = cpuCaps();
  for (const c of caps) {
    g.rect(c.x, c.y, c.w, c.h);
  }
  g.fill({ color: T.line });
  for (const c of caps) {
    if (c.w > c.h) {
      g.rect(c.x, c.y, 5, c.h);
      g.rect(c.x + c.w - 5, c.y, 5, c.h);
    } else {
      g.rect(c.x, c.y, c.w, 5);
      g.rect(c.x, c.y + c.h - 5, c.w, 5);
    }
  }
  g.fill({ color: T.pin });
  // die
  box(g, d.x, d.y, d.w, d.h, 10, { fill: T.die, stroke: accent, lw: 3 });
  // the floorplan of this CPU's architecture (docs/DIE.md): blocks, stage frames and bond pads, in the die's own frame drawn at `CPU_S`; the
  // detail is the die view's (dieview.ts)
  const fp = new Graphics();
  fp.scale.set(layout.CPU_S);
  root.addChild(fp);
  dieFar(fp, T, planOf(spec));
  labels.addChild(label(spec.name, k.x + 110, k.y + k.h - 116, 24, T.mute, { a: 0.75, weight: '700' }));
  root.addChild(labels);
  return { root, labels };
}

// ---------------------------------------------------------------- RAM
/**
 * A stick's trim by its `visual` (the 2D stripes): no tier colours, the tiers read by how premium they look. Plain on the bare sticks (SDR, the
 * server ECC sticks), stamped steel (DDR2), dark anodised fins (DDR3), polished silver on the light-bar sticks (DDR4, brightest on DDR5).
 */
const ramAccent = (T: Theme, visual: string): string =>
  (
    ({ 'dimm-fast': '#8d939c', 'dimm-ddr3': '#5b616c', 'dimm-lowlat': '#aeb4bd', 'dimm-ddr5': '#d6dbe2' }) as Record<
      string,
      string
    >
  )[visual] ?? T.line;

/** Each generation's key notch sits in a different place, so a stick fits only its own slot: the pin (of 24) where the pin row has its gap. */
export const ramNotch = (visual: string): number =>
  (
    ({
      'dimm-basic': 6,
      'dimm-fast': 8,
      'dimm-ddr3': 10,
      'dimm-lowlat': 12,
      'dimm-ecc': 12,
      'dimm-ddr5': 14,
      'dimm-ddr5ecc': 14,
    }) as Record<string, number>
  )[visual] ?? 12;

/** The DRAM chips of a stick, in its local frame (the 2D lays it flat, its pins down its west edge): two groups of four along it, the gap
 * between them for the ECC chip and the DDR5 power chip. The live memory map lands on these (memory/render/ramlayout.ts), the 3D's too. */
const RAM_CHIP_W = 116,
  RAM_CHIP_H = 230,
  RAM_CHIP_PITCH = 262;
export const ramChips = (): layout.Rect[] =>
  Array.from({ length: 8 }, (_, j) => ({
    x: 34,
    y: (j < 4 ? 80 : layout.DIMM_H - 80 - 4 * RAM_CHIP_PITCH + 32) + (j % 4) * RAM_CHIP_PITCH,
    w: RAM_CHIP_W,
    h: RAM_CHIP_H,
  }));
/** The middle of the gap between the stick's two groups of chips (the ECC chip, the DDR5 power chip). */
const ramGapY = (): number => {
  const c = ramChips();
  return (c[3]!.y + c[3]!.h + c[4]!.y) / 2;
};

/** A DIMM stick in local coordinates, laid flat with its gold fingers down its west edge (on its socket's pin column); the caller positions it at (DIMM_X(i), DIMM_Y(i)). */
export function ramArt(T: Theme, spec: RamSpec): Part {
  const root = new Container(),
    labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  const accent = ramAccent(T, spec.visual),
    notch = ramNotch(spec.visual);
  const ddr5 = spec.visual === 'dimm-ddr5' || spec.visual === 'dimm-ddr5ecc';
  box(g, 0, 0, layout.DIMM_W, layout.DIMM_H, 10, { fill: T.sub, stroke: T.line, lw: 6 });
  box(g, 22, 40, 134, layout.DIMM_H - 80, 6, { fill: T.die, stroke: accent, lw: 5, sa: 0.9 });
  const chips = ramChips();
  for (const c of chips) {
    box(g, c.x, c.y, c.w, c.h, 8, { fill: T.tile, stroke: T.line, lw: 5 });
  }
  const gy = ramGapY();
  if (spec.ecc) {
    // the extra chip of an error-correcting stick: the parity bits, a chip of its own between the two groups
    box(g, 34, gy - 70, 116, 140, 6, { fill: T.tile, stroke: accent, lw: 4 });
    for (let k = 0; k < 8; k++) {
      g.rect(43 + k * 13, gy - 20, 8, 40).fill({ color: accent, alpha: 0.55 });
    }
  }
  if (spec.visual !== 'dimm-basic') {
    // heat spreader stripe on the faster sticks
    g.rect(22, 40, 10, layout.DIMM_H - 80).fill({ color: accent, alpha: 0.7 });
    g.rect(146, 40, 10, layout.DIMM_H - 80).fill({ color: accent, alpha: 0.7 });
  }
  if (ddr5) {
    // DDR5 carries its own power management chip on the stick
    box(g, 100, gy + (spec.ecc ? 80 : -11), 40, 22, 4, { fill: T.tile, stroke: accent, lw: 3 });
  }
  // the gold fingers down the west edge, the key notch where the generation puts it (a fraction of the way along, as on a real stick)
  const n = 96,
    step = (layout.DIMM_H - 140) / n,
    ny = Math.round((notch / 24) * n);
  for (let k = 0; k < n; k++) {
    if (k < ny - 1 || k > ny + 1) {
      g.rect(2, 70 + k * step, 16, step * 0.62);
    }
  }
  g.fill({ color: T.pin });
  // the maker's label strip across the north end
  g.rect(40, 14, 100, 14).fill({ color: accent, alpha: 0.9 });
  root.addChild(labels);
  return { root, labels, chips };
}

// ---------------------------------------------------------------- VRM heatsink (bolts onto the board's MOSFET strip)
/**
 * The three heatsinks over the VRM's power stages and chokes (visuals `vrm-sink-fins`, `vrm-sink-big`, `vrm-sink-fan`): thin passive fins, tall
 * fins with a heat pipe, and fins with a housing for a 40 mm fan over the fan's square (`fanRect`: the board's, else centred on the sink). The
 * housing is the sink's; the fan is a part of its own: `fan` (its blades, spun) and `over` (the housing's grille and the fan's screws over
 * them), shown only when one is fitted.
 */
export function vrmSinkArt(T: Theme, visual: string, rect: layout.Rect = layout.VRM_SINK, fanRect?: layout.Rect): Part {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const r = rect,
    big = visual === 'vrm-sink-big',
    withFan = visual === 'vrm-sink-fan';
  const metal = '#3b4663',
    metalHi = '#56628a',
    metalLo = '#222a41';
  // base plate and drop shadow
  box(g, r.x + 8, r.y + 12, r.w, r.h, 18, { fill: '#000000', fa: 0.3 });
  box(g, r.x, r.y, r.w, r.h, 18, { fill: metalLo, stroke: mix(T.line, metal, 0.5), lw: 6 });
  // fins: long rails along the sink (east to west), stacked across it: many thin ones (passive), fewer thick ones (big)
  const n = big ? 5 : 7,
    pitch = (r.h - 30) / n,
    rail = pitch * (big ? 0.62 : 0.5);
  const fins: layout.Rect[] = Array.from({ length: n }, (_, k) => ({
    x: r.x + 16,
    y: r.y + 15 + k * pitch + (pitch - rail) / 2,
    w: r.w - 32,
    h: rail,
  }));
  for (const f of fins) {
    g.rect(f.x, f.y, f.w, f.h);
  }
  g.fill({ color: metal });
  for (const f of fins) {
    g.rect(f.x, f.y, f.w, Math.max(3, rail * 0.3));
  }
  g.fill({ color: metalHi, alpha: 0.7 });
  let pipe: layout.Rect | undefined;
  if (big) {
    // a heat pipe standing across the rails
    const px = r.x + r.w * 0.3;
    pipe = { x: px - 11, y: r.y + 8, w: 22, h: r.h - 16 };
    g.moveTo(px, r.y + 8)
      .lineTo(px, r.y + r.h - 8)
      .stroke({ width: 22, color: T.pin, alpha: 0.85, cap: 'round' });
    g.moveTo(px - 5, r.y + 8)
      .lineTo(px - 5, r.y + r.h - 8)
      .stroke({ width: 6, color: '#ffffff', alpha: 0.3, cap: 'round' });
  }
  if (!withFan) {
    return { root, fins, ...(pipe ? { pipe } : {}) };
  }
  // the fan's housing, one casting with the sink over the fan's square: a cover with a round grille, the fins the fan blows onto under it
  const f = fanRect ?? { x: r.x + r.w / 2 - SINK_FAN / 2, y: r.y + r.h / 2 - SINK_FAN / 2, w: SINK_FAN, h: SINK_FAN };
  const cx = f.x + f.w / 2,
    cy = f.y + f.h / 2,
    R = f.w * 0.46,
    m = SINK_FAN_RIM,
    edge = mix(T.line, metal, 0.5);
  const H = { x: f.x - m, y: f.y - m, w: f.w + 2 * m, h: f.h + 2 * m },
    screwAt = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].map(([sx, sy]) => [cx + sx! * f.w * 0.41, cy + sy! * f.h * 0.41] as const);
  g.roundRect(H.x + 10, H.y + 16, H.w, H.h, 60).fill({ color: '#000000', alpha: 0.3 });
  g.roundRect(H.x, H.y, H.w, H.h, 60).fill(metalLo);
  disc(g, cx, cy, R, { fill: mix(metalLo, '#000000', 0.5) });
  // (the fins in the well, along the rails' channels)
  for (let k = 1; k < 18; k++) {
    const y = cy - R + (k * 2 * R) / 18,
      dx = Math.sqrt(R * R - (y - cy) ** 2) - 4;
    g.rect(cx - dx, y - 5, 2 * dx, 10);
  }
  g.fill({ color: metal, alpha: 0.8 });
  g.roundRect(H.x, H.y, H.w, H.h, 60).fill(metal).circle(cx, cy, R).cut();
  g.roundRect(H.x, H.y, H.w, H.h, 60).stroke({ width: 6, color: edge });
  g.circle(cx, cy, R).stroke({ width: 10, color: metalHi, alpha: 0.55 });
  for (const [x, y] of screwAt) {
    disc(g, x, y, 16, { fill: '#000000', fa: 0.55 });
  }
  // the grille (drawn again over the fan's blades when one is fitted): four spokes to a round badge, a ring halfway
  // (flat fills: the 3D sink draws this art too, where there is no canvas for a gradient)
  const grille = (q: Graphics) => {
    for (const k of [1, 3, 5, 7]) {
      const a = (k * Math.PI) / 4;
      q.moveTo(cx + Math.cos(a) * R * 0.28, cy + Math.sin(a) * R * 0.28).lineTo(
        cx + Math.cos(a) * (R - 2),
        cy + Math.sin(a) * (R - 2),
      );
    }
    q.stroke({ width: 22, color: metal });
    q.circle(cx, cy, R * 0.64).stroke({ width: 18, color: metal });
    disc(q, cx, cy, R * 0.3, { fill: metal, stroke: edge, lw: 6 });
    disc(q, cx, cy, R * 0.2, { fill: metalHi, fa: 0.6 });
  };
  grille(g);
  // the fan: its blades turn in the well; the grille and the fan's four screws through the cover stay still over them
  const fan = new Container(),
    fg = new Graphics(),
    over = new Container(),
    og = new Graphics();
  fan.position.set(cx, cy);
  fan.addChild(fg);
  disc(fg, 0, 0, R, { fill: T.dot });
  blades(fg, 7, R * 0.28, R * 0.95, T.tile, T.alu, 4);
  over.addChild(og);
  grille(og);
  for (const [x, y] of screwAt) {
    disc(og, x, y, 20, { fill: metalHi, stroke: metalLo, lw: 5 });
  }
  return { root, fan, over, fins };
}

/** The square of the fan a board's sink can carry (`vrmSinkArt`'s bracket). */
export const sinkFanRect = (kind: 'vrm-sink' | 'ram-sink'): layout.Rect =>
  kind === 'ram-sink' ? layout.RAM_FAN : layout.VRM_FAN;

// (the cooler and the AIO's radiator are in cooler.ts)

// ---------------------------------------------------------------- PSU (below the board)
/** The PSU fan seen edge-on: a slab in the unit's bottom face (it draws air up from under the case). */
export const psuFanRect = (): layout.Rect => ({
  x: layout.PSU_UNIT.x + 300,
  y: layout.PSU_UNIT.y + layout.PSU_UNIT.h - 190,
  w: 2 * layout.PSU_FAN.r,
  h: 110,
});

/**
 * A power supply as a box on its own (for the shop and the inventory): the fan grill, the label with the rated watts, the vents and the
 * output sockets. The one in the machine is the long shroud with the readout (`psuArt`); this is the same unit, small.
 */
export function psuBoxArt(T: Theme, spec: PsuSpec): Container {
  const root = new Container(),
    g = new Graphics();
  root.addChild(g);
  const W = 2100,
    H = 1500;
  const accent = spec.visual === 'psu-big' ? T.br : spec.visual === 'psu-mid' ? T.alu : T.pin;
  const body = mix(T.sub, T.tile, 0.45);
  box(g, 18, 26, W, H, 80, { fill: '#000000', fa: 0.28 });
  box(g, 0, 0, W, H, 80, { fill: body, stroke: accent, lw: 12, sa: 0.9 });
  g.rect(40, 24, W - 80, 16).fill({ color: '#ffffff', alpha: 0.07 });
  // fan grill
  const fx = 640,
    fy = H / 2,
    fr = 470;
  disc(g, fx, fy, fr + 70, { fill: T.die, stroke: T.line, lw: 10 });
  const bl = new Graphics();
  bl.position.set(fx, fy);
  blades(bl, 7, 60, fr - 20, T.tile, accent, 5);
  root.addChild(bl);
  for (const rr of [140, 240, 340, 440]) {
    g.circle(fx, fy, rr);
  }
  g.stroke({ width: 7, color: T.mute, alpha: 0.5 });
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    g.moveTo(fx + Math.cos(a) * 80, fy + Math.sin(a) * 80).lineTo(
      fx + Math.cos(a) * (fr + 20),
      fy + Math.sin(a) * (fr + 20),
    );
  }
  g.stroke({ width: 5, color: T.mute, alpha: 0.35 });
  disc(g, fx, fy, 74, { fill: T.tile, stroke: accent, lw: 8 });
  disc(g, fx, fy, 24, { fill: accent });
  // label plate: the rated watts, big
  const l = { x: 1250, y: 150, w: 740, h: 640 };
  box(g, l.x, l.y, l.w, l.h, 30, { fill: T.die, stroke: T.line, lw: 6 });
  g.rect(l.x + 40, l.y + 120, l.w - 80, 7).fill({ color: accent, alpha: 0.85 });
  root.addChild(label(`${spec.watts}`, l.x + 40, l.y + 330, 250, accent, { head: true, anchor: [0, 0.5] }));
  root.addChild(label('WATTS', l.x + l.w - 40, l.y + 560, 70, T.mute, { head: true, anchor: [1, 0.5], a: 0.9 }));
  // vents and the output sockets along the bottom edge
  for (let y = 880; y < 1180; y += 56) {
    g.moveTo(1250, y).lineTo(1990, y);
  }
  g.stroke({ width: 16, color: '#02040a', cap: 'round', alpha: 0.7 });
  for (const [x, w] of [
    [1260, 200],
    [1500, 230],
    [1780, 200],
  ] as const) {
    box(g, x, H - 170, w, 90, 14, { fill: '#05070b', stroke: accent, lw: 5, sa: 0.7 });
    for (let k = 0; k < Math.floor((w - 40) / 26); k++) {
      g.rect(x + 24 + k * 26, H - 150, 14, 38);
    }
    g.fill({ color: T.pin, alpha: 0.7 });
  }
  return root;
}

// ---------------------------------------------------------------- monitor (west of the board, 16:9)
/** `gfx`: the graphics display (`display1`): a bluer shell, an accent line under the glass and its own name; the CLI monitor is the plain one. */
export function monitorArt(T: Theme, on: boolean, gfx = false): Part {
  const root = new Container(),
    labels = new Container();
  const g = new Graphics();
  root.addChild(g);
  // drawn at its design size (3300 x 1995, the screen inset by 90 / 80) and scaled up into place
  root.position.set(layout.MONITOR.x, layout.MONITOR.y);
  root.scale.set(layout.MONITOR_K);
  const m = { x: 0, y: 0, w: 3300, h: 1995 },
    s = { x: 90, y: 80, w: layout.SCREEN_D.w, h: layout.SCREEN_D.h };
  const shell = gfx ? '#141c30' : '#171d2b',
    shellHi = mix(shell, '#ffffff', 0.1),
    shellLo = mix(shell, '#000000', 0.35);
  const cx = m.x + m.w / 2,
    by = m.y + m.h;
  // ---- the stand: a flat oval base on a rubber strip, a neck that fans out to a hinge under the bezel (lit on the left, shaded on the right) ----
  box(g, cx - 780, by + 345, 1560, 90, 45, { fill: '#000000', fa: 0.22 });
  box(g, cx - 800, by + 318, 1600, 82, 41, { fill: shell, stroke: T.line, lw: 5 });
  box(g, cx - 780, by + 322, 1560, 34, 17, { fill: shellHi, fa: 0.55 });
  g.rect(cx - 740, by + 388, 1480, 12).fill({ color: '#000000', alpha: 0.45 });
  g.poly([cx - 130, by, cx + 130, by, cx + 250, by + 322, cx - 250, by + 322])
    .fill({ color: shell })
    .stroke({ width: 4, color: T.line, alpha: 0.8 });
  g.poly([cx - 130, by, cx - 10, by, cx - 20, by + 322, cx - 250, by + 322]).fill({ color: shellHi, alpha: 0.55 });
  g.poly([cx + 60, by, cx + 130, by, cx + 250, by + 322, cx + 130, by + 322]).fill({ color: '#000000', alpha: 0.25 });
  box(g, cx - 210, by - 22, 420, 74, 34, { fill: shellLo, stroke: T.line, lw: 4 });
  // ---- the body: a soft shadow on the wall, the shell (a lit rim along the top, a darker chin), the glass set deep in a black border ----
  box(g, m.x + 14, m.y + 26, m.w, m.h, 80, { fill: '#000000', fa: 0.26 });
  box(g, m.x, m.y, m.w, m.h, 80, { fill: shell, stroke: T.line, lw: 7 });
  box(g, m.x + 8, m.y + 8, m.w - 16, m.h * 0.46, 72, { fill: shellHi, fa: 0.4 });
  box(g, m.x + 8, m.y + m.h * 0.72, m.w - 16, m.h * 0.28 - 8, 72, { fill: '#000000', fa: 0.18 });
  g.roundRect(m.x + 4, m.y + 4, m.w - 8, m.h - 8, 76).stroke({ width: 5, color: '#ffffff', alpha: 0.12 });
  box(g, s.x - 26, s.y - 26, s.w + 52, s.h + 52, 38, { fill: '#020406' });
  g.roundRect(s.x - 26, s.y - 26, s.w + 52, s.h + 52, 38).stroke({ width: 4, color: '#000000', alpha: 0.6 });
  box(g, s.x, s.y, s.w, s.h, 14, { fill: SCREEN_BG });
  if (on) {
    g.roundRect(s.x, s.y, s.w, s.h, 14).stroke({ width: 10, color: T.st, alpha: 0.08 });
  }
  // scanlines and glass: a sheen across, a lit line along the top edge, the corners darker
  for (let y = s.y + 8; y < s.y + s.h; y += 10) {
    g.moveTo(s.x, y).lineTo(s.x + s.w, y);
  }
  g.stroke({ width: 3, color: on ? T.st : '#ffffff', alpha: on ? 0.035 : 0.02 });
  g.poly([s.x + 20, s.y + s.h - 20, s.x + 700, s.y + 20, s.x + 1120, s.y + 20, s.x + 440, s.y + s.h - 20]).fill({
    color: '#ffffff',
    alpha: 0.03,
  });
  g.poly([s.x + 1300, s.y + s.h - 20, s.x + 1700, s.y + 20, s.x + 1820, s.y + 20, s.x + 1420, s.y + s.h - 20]).fill({
    color: '#ffffff',
    alpha: 0.018,
  });
  g.rect(s.x + 30, s.y + 4, s.w - 60, 6).fill({ color: '#ffffff', alpha: 0.07 });
  for (const [qx, qy] of [
    [s.x, s.y],
    [s.x + s.w - 160, s.y],
    [s.x, s.y + s.h - 160],
    [s.x + s.w - 160, s.y + s.h - 160],
  ] as const) {
    g.rect(qx, qy, 160, 160).fill({ color: '#000000', alpha: 0.05 });
  }
  if (gfx) {
    g.rect(s.x + 120, s.y + s.h + 38, s.w - 240, 8).fill({ color: T.alu, alpha: on ? 0.55 : 0.25 });
  }
  // ---- the chin: the maker's lockup (`core/render/brands`, as on the 3D monitor), the power lamp and the touch buttons ----
  const cy = s.y + s.h + 26 + (m.y + m.h - (s.y + s.h + 26)) / 2;
  brandLockup(labels, 'hikari', cx, cy, 48, T.mute);
  for (let k = 0; k < 4; k++) {
    disc(g, m.x + m.w - 520 + k * 62, cy, 7, { fill: T.mute, fa: 0.35 });
  }
  disc(g, m.x + m.w - 220, cy, 26, { fill: '#000000', fa: 0.4 });
  disc(g, m.x + m.w - 220, cy, 14, { fill: on ? T.st : T.mute, fa: on ? 1 : 0.4 });
  if (on) {
    disc(g, m.x + m.w - 220, cy, 34, { fill: T.st, fa: 0.12 });
  }
  // no sockets: the monitor's video cable and its mains cord are built in and come out from behind it
  labels.addChild(label(gfx ? 'GRAPHICS MONITOR' : 'CLI MONITOR', m.x + 20, m.y - 40, 56, T.ink, { a: 0.8 }));
  root.addChild(labels);
  return { root };
}

// ---------------------------------------------------------------- cables (PSU to board, board to monitor)
export const ACCENT = (T: Theme, k: routes.Cable['kind']) =>
  k === 'atx' ? T.ld : k === 'cpu' ? T.alu : routes.isPcieKind(k) ? T.br : T.st;

export function plugRect(p: routes.Plug): layout.Rect {
  return p.dx !== 0
    ? { x: p.dx > 0 ? p.x : p.x - p.l, y: p.y - p.w / 2, w: p.l, h: p.w }
    : { x: p.x - p.w / 2, y: p.dy > 0 ? p.y : p.y - p.l, w: p.w, h: p.l };
}
