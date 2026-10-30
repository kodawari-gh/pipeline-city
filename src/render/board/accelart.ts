import { Container, Graphics } from 'pixi.js';
import { geoOf } from './boardlayout';
import { BD, NIC_BRACKET_X, nicY, type Rect } from './layout';
import { box, disc, label, mix } from '../ink';
import { gpuPlan, GPU_H, GPU_LEN, moveRect, type GpuPlan } from './gpulayout';
import { EdgeFan, edgeFan } from '../room/case';
import { gpuFar, gpuNear } from '../gpu/gpuart';
import type { Theme } from '../theme';

// The accelerator parts (docs/ACCEL.md "Picker and board art"): graphics and AI cards in a PCIe slot, and the TPM module on the board's
// header. A card is drawn the way the NIC is (net.ts `nicArt`): in board space, on the slot's rail, bracket at the board's west edge,
// longer cards reaching further east (they may overhang the next slot's rail on screen, never in the sim).
// A GPU's fans stand along its top edge and its shroud covers the die; the board's `GpuView` (gpuview.ts) spins the blades and fades the cover
// away when zoomed in, so a card drawn for the board (`live`) leaves both out, and a card drawn for a shop tile has them as a still picture.

/** Card length by the spec's `visual` key. */
export const CARD_LEN: Record<string, number> = { ...GPU_LEN, 'npu-1': 1500, 'npu-2': 1900 };
const CARD_H: Record<string, number> = { ...GPU_H, 'npu-1': 196, 'npu-2': 214 };

/** How far a card's north edge is above its slot's rail: a graphics card hangs mostly below the rail (away from the CPU), the rest sit centred. */
const GPU_TOP = 150;
const cardTop = (visual: string): number => (visual.startsWith('gpu') ? GPU_TOP : (CARD_H[visual] ?? 200) / 2);

/** The board-space rectangle of a card in PCIe slot `i`: what a click or hover on it hits. */
export const cardRect = (i: number, visual: string): Rect => {
  const h = CARD_H[visual] ?? 200;
  return { x: NIC_BRACKET_X, y: nicY(i) - cardTop(visual), w: (CARD_LEN[visual] ?? 1500) + (BD.x - NIC_BRACKET_X), h };
};

/** Where a card's north-west PCB corner is in board space (the origin of its `gpuPlan`). */
export const cardOrigin = (i: number, visual: string): { x: number; y: number } => ({ x: BD.x, y: nicY(i) - cardTop(visual) });

/** The shroud plate over the die, in card-local units: dark with the heatsink's fins running across it. The view fades it away when zoomed in. */
export function gpuCover(g: Graphics, T: Theme, p: GpuPlan): Graphics {
  const b = p.body;
  box(g, b.x, b.y - 6, b.w, b.h + 6, 8, { fill: T.dark ? '#0d1220' : '#1d2536', stroke: T.line, lw: 3 });
  const fin = T.dark ? '#7d89a4' : '#b9c3d8';
  for (let x = b.x + 18; x < b.x + b.w - 10; x += 22) g.moveTo(x, b.y + 4).lineTo(x, b.y + b.h - 8);
  g.stroke({ width: 8, color: fin, alpha: 0.2 });
  for (let x = b.x + 18; x < b.x + b.w - 10; x += 22) g.moveTo(x + 9, b.y + 4).lineTo(x + 9, b.y + b.h - 8);
  g.stroke({ width: 3, color: '#000000', alpha: 0.35 });
  // two heat pipes arching over the fins
  for (const k of [0.3, 0.7]) g.moveTo(b.x + 10, b.y + b.h * k).lineTo(b.x + b.w - 10, b.y + b.h * k);
  g.stroke({ width: 10, color: T.alu, alpha: 0.22 });
  return g;
}

/** A GPU or NPU card on slot `i`, `visual` = the spec's key (`gpu-1`...`npu-2`). `live`: a GPU on the board, whose blades and cover the `GpuView` draws. */
export function cardArt(T: Theme, visual: string, i: number, live = false): Container {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  const isGpu = visual.startsWith('gpu');
  const L = CARD_LEN[visual] ?? 1500, H = CARD_H[visual] ?? 200, y = nicY(i), x0 = BD.x, top = y - cardTop(visual);
  const pcb = isGpu ? (T.dark ? '#1b2236' : '#3a4560') : (T.dark ? '#2a1d46' : '#6e5aa8');
  box(g, x0 + 10, top + 16, L, H, 14, { fill: '#000000', fa: 0.3 });
  box(g, x0, top, L, H, 14, { fill: pcb, stroke: T.alu, lw: 6, sa: 0.55 });
  // gold edge fingers over the slot
  for (let k = 0; k < 18; k++) g.rect(-2830 + k * 34, y - 14, 18, 28);
  g.fill({ color: T.pin, alpha: 0.85 });
  if (isGpu) {
    // the shroud frame, a row of fans along the top edge in their bezels, an accent stripe, the power plug blocks on the end
    const p = gpuPlan(visual), o = { x: x0, y: top };
    box(g, o.x + p.shroud.x, o.y + p.shroud.y, p.shroud.w, p.shroud.h, 10, { fill: T.dark ? '#0d1220' : '#1d2536', stroke: T.line, lw: 4 });
    for (const f of p.fans) edgeFan(g, T, moveRect(f, o), false, '#1d2536', mix(T.alu, T.bg, 0.4)); // the case fans' look, edge-on
    g.rect(o.x + p.shroud.x + 14, o.y + p.shroud.y + p.shroud.h - 10, p.shroud.w - 28, 6);
    g.fill({ color: T.alu, alpha: 0.9 });
    box(g, x0 + L - 150, top - 10, 120, 44, 6, { fill: '#05070c', stroke: T.line, lw: 3 });
    if (visual === 'gpu-3') box(g, x0 + L - 290, top - 10, 120, 44, 6, { fill: '#05070c', stroke: T.line, lw: 3 }); // the second lead
    // bracket with the display outputs
    box(g, NIC_BRACKET_X, top - 10, 30, H + 20, 4, { fill: T.dark ? '#aab4c9' : '#d6dce8', stroke: T.line, lw: 4 });
    for (let k = 0; k < 3; k++) box(g, NIC_BRACKET_X - 54, y - 70 + k * 52, 54, 34, 4, { fill: '#05070c', stroke: T.line, lw: 3 });
    if (!live) {
      // a still picture (shop tile): the cover and the blades drawn in
      // the die itself under the fans (the board's view fades the shroud away to this), the shroud only as the frame
      const die = new Graphics(), near = gpuNear(T, p.die);
      gpuFar(die, T, p.die);
      die.position.set(o.x + p.origin.x, o.y + p.origin.y);
      near.root.position.set(o.x + p.origin.x, o.y + p.origin.y);
      root.addChild(die, near.root);
      for (const f of p.fans) {
        const fan = new EdgeFan(moveRect(f, o), T);
        fan.spin(0, 0.3);
        root.addChild(fan);
      }
    }
    root.addChild(label(visual.toUpperCase().replace('-', ' '), x0 + 18, top + 142, 30, T.alu, { head: true, a: 0.9 }));
  } else {
    // the matrix unit: a die with its grid of multiply-accumulate cells, a heatsink on the bigger card
    const K = visual === 'npu-2' ? 8 : 4, die = 150 + K * 14, cx = x0 + 420, c0 = { x: cx - die / 2, y: y - die / 2 };
    box(g, c0.x, c0.y, die, die, 10, { fill: '#0a0f1a', stroke: T.alu, lw: 4, sa: 0.9 });
    const cell = (die - 36) / K;
    for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) g.rect(c0.x + 18 + a * cell + 2, c0.y + 18 + b * cell + 2, cell - 4, cell - 4);
    g.fill({ color: T.alu, alpha: 0.55 });
    for (let k = 0; k < 4; k++) { g.rect(x0 + 760 + k * 60, top + 24, 30, 54); g.rect(x0 + 760 + k * 60, y + H / 2 - 78, 30, 54); }
    g.fill({ color: mix(pcb, '#000000', 0.45) });
    if (visual === 'npu-2') {
      const hs = { x: x0 + 1060, y: y - 80, w: 640, h: 160 }, metal = T.dark ? '#7d89a4' : '#b9c3d8';
      box(g, hs.x, hs.y, hs.w, hs.h, 8, { fill: metal, stroke: T.line, lw: 4 });
      for (let x = hs.x + 22; x < hs.x + hs.w - 14; x += 26) g.moveTo(x, hs.y + 10).lineTo(x, hs.y + hs.h - 10);
      g.stroke({ width: 7, color: '#000000', alpha: 0.28 });
      box(g, x0 + L - 150, top - 10, 120, 44, 6, { fill: '#05070c', stroke: T.line, lw: 3 }); // its power lead
    }
    box(g, NIC_BRACKET_X, top - 10, 30, H + 20, 4, { fill: T.dark ? '#aab4c9' : '#d6dce8', stroke: T.line, lw: 4 });
    disc(g, NIC_BRACKET_X - 20, y, 11, { fill: '#05070c', stroke: T.line, lw: 3, sa: 0.7 });
    root.addChild(label(`NPU ${K}x${K}`, x0 + 60, top + 10, 34, T.alu, { head: true, a: 0.9 }));
  }
  return root;
}

/** A header's rectangle in board space (`HeaderGeo`: pins of `cols` x `rows` at 52 spacing with a 24 border, as boardArt draws it). */
export interface HeaderBox { x: number; y: number; cols: number; rows: number }
export const headerRect = (h: HeaderBox): Rect => ({ x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 });

/** The TPM module standing on its header: a small daughterboard with the secure chip (and a shield on the better one). */
export function tpmArt(T: Theme, visual: string, h: HeaderBox): Container {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  const r = headerRect(h), pad = 16, two = visual === 'tpm-2';
  const pcb = T.dark ? '#1f3b2e' : '#6faa86';
  box(g, r.x + 8, r.y + 12, r.w, r.h + 40, 8, { fill: '#000000', fa: 0.3 });
  box(g, r.x - pad, r.y - pad - 30, r.w + 2 * pad, r.h + 2 * pad + 30, 8, { fill: pcb, stroke: T.alu, lw: 4, sa: 0.6 });
  const chip = { x: r.x + r.w * 0.18, y: r.y - 6, w: r.w * 0.5, h: r.h * 0.62 };
  box(g, chip.x, chip.y, chip.w, chip.h, 6, { fill: '#0a0f1a', stroke: two ? T.alu : T.line, lw: 3 });
  disc(g, chip.x + 14, chip.y + 14, 5, { fill: T.alu, fa: 0.8 });
  if (two) box(g, r.x + r.w * 0.72, r.y + 4, r.w * 0.18, r.h * 0.4, 4, { fill: mix(pcb, '#ffffff', 0.25), stroke: T.line, lw: 2 });
  for (let k = 0; k < h.cols; k++) g.rect(r.x + 18 + k * 52, r.y + r.h - 12, 16, 22);
  g.fill({ color: T.pin, alpha: 0.9 });
  root.addChild(label('TPM', r.x - pad + 12, r.y - pad - 26, 26, T.alu, { head: true, a: 0.9 }));
  return root;
}

/** The TPM header of a board tier (Mainstream and up), or null. */
export const tpmHeader = (tier: number): HeaderBox | null => geoOf(tier).hdrs.find((h) => h.name === 'TPM') ?? null;

/** What a click on the TPM header (empty or filled) hits: the header and the module standing on it. */
export function tpmRect(tier: number): Rect | null {
  const h = tpmHeader(tier);
  if (!h) return null;
  const r = headerRect(h);
  return { x: r.x - 16, y: r.y - 46, w: r.w + 32, h: r.h + 62 };
}
