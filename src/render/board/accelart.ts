import { Container, Graphics } from 'pixi.js';
import { geoOf } from './boardlayout';
import { BD, NIC_BRACKET_X, nicY, type Rect } from './layout';
import { box, disc, label, mix } from '../ink';
import { gpuPlan, GPU_H, GPU_LEN, moveRect, type GpuPlan } from './gpulayout';
import { EdgeFan, edgeFan } from '../room/case';
import { gpuFar, gpuNear } from '../gpu/gpuart';
import { padlock } from '../tpm/tpmglyph';
import { tpmGeo } from './tpmlayout';
import { NPU_H, NPU_LEN, npuGeo, type NpuGeo } from './npulayout';
import type { Theme } from '../theme';

// The accelerator parts (docs/ACCEL.md "Picker and board art"): graphics and AI cards in a PCIe slot, and the TPM module on the board's
// header. A card is drawn the way the NIC is (net.ts `nicArt`): in board space, on the slot's rail, bracket at the board's west edge,
// longer cards reaching further east (they may overhang the next slot's rail on screen, never in the sim).
// A GPU's fans stand along its top edge and its shroud covers the die; the board's `GpuView` (gpuview.ts) spins the blades and fades the cover
// away when zoomed in, so a card drawn for the board (`live`) leaves both out, and a card drawn for a shop tile has them as a still picture.

/** Card length by the spec's `visual` key. */
export const CARD_LEN: Record<string, number> = { ...GPU_LEN, ...NPU_LEN };
const CARD_H: Record<string, number> = { ...GPU_H, ...NPU_H };

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

/**
 * The lid over an AI card's die, in card-local units: a dark plate with fins running across it, the array's grid etched in it and the card's name. The board's
 * view (`NpuCardView`, npuview.ts) fades it away when zoomed in and the die shows through; a shop tile has it as a still picture. The better card has a
 * metal frame and a heatsink's wider fins.
 */
export function npuCover(T: Theme, geo: NpuGeo): Container {
  const root = new Container(), g = new Graphics(), r = geo.lid, two = geo.visual === 'npu-2', K = geo.grid;
  root.addChild(g);
  box(g, r.x, r.y, r.w, r.h, 10, { fill: T.dark ? '#0d1220' : '#1d2536', stroke: two ? T.alu : T.line, lw: two ? 6 : 4 });
  const fin = T.dark ? '#7d89a4' : '#b9c3d8', step = two ? 34 : 26;
  for (let x = r.x + 30; x < r.x + r.w - 20; x += step) g.moveTo(x, r.y + 14).lineTo(x, r.y + r.h - 14);
  g.stroke({ width: two ? 14 : 8, color: fin, alpha: two ? 0.3 : 0.18 });
  for (let x = r.x + 30; x < r.x + r.w - 20; x += step) g.moveTo(x + step * 0.4, r.y + 14).lineTo(x + step * 0.4, r.y + r.h - 14);
  g.stroke({ width: 3, color: '#000000', alpha: 0.35 });
  // the array's grid etched in the lid
  const size = Math.min(r.h * 0.6, 340), cell = size / K, gx = r.x + r.w * 0.6, gy = r.y + (r.h - size) / 2;
  box(g, gx - 14, gy - 14, size + 28, size + 28, 8, { fill: '#05070c', fa: 0.7, stroke: T.alu, lw: 3, sa: 0.8 });
  for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) g.rect(gx + b * cell + 2, gy + a * cell + 2, cell - 4, cell - 4);
  g.fill({ color: T.alu, alpha: 0.5 });
  disc(g, r.x + 22, r.y + 22, 6, { fill: T.alu, fa: 0.85 });
  disc(g, r.x + r.w - 22, r.y + 22, 6, { fill: T.alu, fa: 0.85 });
  root.addChild(label('AI CARD', r.x + 44, r.y + r.h * 0.3, 44, T.ink, { head: true, a: 0.9 }));
  root.addChild(label(`NPU ${K} x ${K}${two ? ' · SHIELDED' : ''}`, r.x + 44, r.y + r.h * 0.5, 28, two ? T.alu : T.mute, { head: true, a: 0.9 }));
  root.addChild(label('PIPELINE CITY', r.x + 44, r.y + r.h * 0.68, 16, T.mute, { a: 0.7 }));
  return root;
}

/** A GPU or NPU card on slot `i`, `visual` = the spec's key (`gpu-1`...`npu-2`). `live`: a card on the board, whose blades and cover (a GPU) or whose lid and die (an NPU) the views draw. */
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
    // the matrix unit: its die lies under a lid (npuCover; the board's view fades it away and draws the die), the bigger card has a power lead
    const geo = npuGeo(visual), K = geo.grid, d = geo.die;
    for (let k = 0; k < 4; k++) { g.rect(x0 + 40 + k * 34, top + 12, 18, 30); g.rect(x0 + 40 + k * 34, top + H - 42, 18, 30); }
    g.fill({ color: mix(pcb, '#000000', 0.45) });
    box(g, x0 + d.x - 12, top + d.y - 12, d.w + 24, d.h + 24, 12, { fill: mix(pcb, '#000000', 0.5) });
    if (visual === 'npu-2') box(g, x0 + L - 150, top - 10, 120, 44, 6, { fill: '#05070c', stroke: T.line, lw: 3 }); // its power lead
    box(g, NIC_BRACKET_X, top - 10, 30, H + 20, 4, { fill: T.dark ? '#aab4c9' : '#d6dce8', stroke: T.line, lw: 4 });
    disc(g, NIC_BRACKET_X - 20, y, 11, { fill: '#05070c', stroke: T.line, lw: 3, sa: 0.7 });
    root.addChild(label(`NPU ${K}x${K}`, x0 + 200, top + 32, 34, T.alu, { head: true, a: 0.9 }));
    if (!live) {
      const cover = npuCover(T, geo);
      cover.position.set(x0, top);
      root.addChild(cover);
    }
  }
  return root;
}

/** A header's rectangle in board space (`HeaderGeo`: pins of `cols` x `rows` at 52 spacing with a 24 border, as boardArt draws it). */
export interface HeaderBox { x: number; y: number; cols: number; rows: number }
export const headerRect = (h: HeaderBox): Rect => ({ x: h.x, y: h.y, w: h.cols * 52 + 24, h: h.rows * 52 + 24 });

/**
 * The lid over the module's die, in board space: a dark plate with the module's name etched in it. The board's view (`TpmView`, tpmview.ts) fades it
 * away when zoomed in, like a card's shroud, and the die shows through; a shop tile has it as a still picture. The better module has a metal frame.
 */
export function tpmCover(T: Theme, visual: string, band: Rect): Container {
  const root = new Container(), g = new Graphics(), two = visual === 'tpm-2';
  root.addChild(g);
  box(g, band.x, band.y, band.w, band.h, 6, { fill: T.dark ? '#0b101c' : '#1d2536', stroke: two ? T.alu : T.line, lw: two ? 4 : 3 });
  if (two) box(g, band.x + 6, band.y + 6, band.w - 12, band.h - 12, 4, { stroke: mix(T.alu, '#000000', 0.4), lw: 1.5, sa: 0.8 });
  disc(g, band.x + 14, band.y + 14, 4.5, { fill: T.alu, fa: 0.85 });
  // the lock the module is named for
  padlock(g, band.x + band.w - 40, band.y + band.h / 2 + 4, 30, true, two ? T.alu : mix(T.ink, T.bg, 0.5), T.dark ? '#0b101c' : '#1d2536');
  root.addChild(label('SECURE MODULE', band.x + 34, band.y + band.h * 0.34, 22, T.ink, { head: true, a: 0.9 }));
  root.addChild(label(two ? 'TPM 2 · SHIELDED' : 'TPM 1', band.x + 34, band.y + band.h * 0.62, 16, two ? T.alu : T.mute, { head: true, a: 0.9 }));
  root.addChild(label('PIPELINE CITY', band.x + 34, band.y + band.h * 0.82, 10, T.mute, { a: 0.7 }));
  return root;
}

/** The TPM module standing on its header: a small daughterboard under a lid. `live`: on the board, where the view (tpmview.ts) draws the lid and the die. */
export function tpmArt(T: Theme, visual: string, h: HeaderBox, live = false): Container {
  const root = new Container(), g = new Graphics();
  root.addChild(g);
  const r = headerRect(h), geo = tpmGeo(visual, r), p = geo.pcb;
  const pcb = T.dark ? '#1f3b2e' : '#6faa86';
  box(g, p.x + 24, p.y + 58, p.w, p.h - 18, 8, { fill: '#000000', fa: 0.3 });
  box(g, p.x, p.y, p.w, p.h, 8, { fill: pcb, stroke: T.alu, lw: 4, sa: 0.6 });
  box(g, geo.band.x - 3, geo.band.y - 3, geo.band.w + 6, geo.band.h + 6, 7, { fill: mix(pcb, '#000000', 0.45) });
  for (let k = 0; k < h.cols; k++) g.rect(r.x + 18 + k * 52, r.y + r.h - 12, 16, 22);
  g.fill({ color: T.pin, alpha: 0.9 });
  root.addChild(label('TPM', p.x + 12, p.y + 4, 26, T.alu, { head: true, a: 0.9 }));
  if (!live) root.addChild(tpmCover(T, visual, geo.band));
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
