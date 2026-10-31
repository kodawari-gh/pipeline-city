import { Graphics } from 'pixi.js';
import { mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import { planFar, planNear, type DieArt, type PlanStyle } from '../../cpu/render/die/dieart';
import { cellRects } from '../../cpu/render/die/dieart';
import type { DiskBlock, DiskLink, DiskPlan } from './diskfloor';
import { flatGrid, headTrack, platterCell, queueLanes, type Cell } from './diskplan';
import type { DriveKind } from './drives';

// The art of a drive's cutaway, in the CPU die's style (die/dieart.ts): a dark floor with a rim line in the tier's accent, macro blocks tinted in their
// kind's colour with a rim, trace bundles ending in pads, names and second lines (all by `planFar` and `planNear`). The data is drawn over it from the
// cells of `diskplan.ts`: the capacity map (one cell per block group) and, deeper, the cells inside the NAND dies or on the platter, with the head arm.

type Key = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad' | 'mute';
const BLOCK_COLOR: Record<DiskBlock['kind'], Key> = { iface: 'alu', ctrl: 'br', cache: 'ld', nand: 'mul', queue: 'st', pre: 'ld' };
const LINK_COLOR: Record<DiskLink['kind'], Key> = { host: 'alu', data: 'st', channel: 'mul', ctl: 'mute' };

/** The accent of a tier's rim: the spinning disk amber, the SATA SSD purple, the NVMe cyan. */
export const accentOf = (T: Theme, kind: DriveKind): string => (kind === 'hdd' ? T.ld : kind === 'ssd-sata' ? T.mul : T.alu);

/** The die's art for a drive plan: blocks and links in the die's own look; the NAND dies' cells and the platter are drawn live. */
const STYLE: PlanStyle<DiskBlock, DiskLink> = {
  color: (T, b) => T[BLOCK_COLOR[b.kind]],
  linkColor: (T, l) => T[LINK_COLOR[l.kind]],
  frame: () => false,
  symbol: () => null,
  draw: () => undefined,
  cells: () => [],
};

export interface StaticArt {
  /** The floor with its pads (and the platter's disc): the ground of the capacity map. */
  far: Graphics;
  /** The macro blocks in the die's own look: they come in with the architecture stage. */
  blocks: Graphics;
  /** Traces, names and second lines. */
  near: DieArt;
}

/** The part of the cutaway that never changes with the drive's contents. */
export function diskStatic(T: Theme, kind: DriveKind, plan: DiskPlan): StaticArt {
  const g = new Graphics(), accent = accentOf(T, kind);
  g.roundRect(0, 0, plan.w, plan.h, Math.min(plan.w, plan.h) * 0.03).fill({ color: mix(T.die, '#000000', 0.25) }).stroke({ width: Math.max(1.5, plan.h * 0.008), color: mix(T.line, accent, 0.6) });
  // bond pads along the edges, like the die's
  const pad = plan.h * 0.016, step = pad * 2;
  for (let x = plan.w * 0.04; x + pad < plan.w * 0.96; x += step) { g.rect(x, plan.h * 0.012, pad, pad); g.rect(x, plan.h * 0.988 - pad, pad, pad); }
  g.fill({ color: T.pin, alpha: 0.55 });
  g.poly([plan.w * 0.012, plan.h * 0.012, plan.w * 0.04, plan.h * 0.012, plan.w * 0.012, plan.h * 0.06]).fill({ color: accent, alpha: 0.9 });
  if (plan.platter) {
    const p = plan.platter;
    g.circle(p.cx, p.cy, p.R + p.R * 0.05).fill({ color: mix(T.die, '#000000', 0.45) }).stroke({ width: Math.max(1.2, plan.h * 0.006), color: accent, alpha: 0.7 });
  }
  const blocks = new Graphics();
  planFar(blocks, T, plan.blocks, STYLE);
  return { far: g, blocks, near: planNear(T, plan, STYLE) };
}

/** What the data layers need besides the cells. */
export interface DataCtx {
  /** Colour slot of the owner of each dataset file id (see `ownerSlot`). */
  owners: ReadonlyMap<number, number>;
  /** Data shows dimmed (the drive is not mounted). */
  dim: boolean;
  /** The drive burnt: every dataset is lost. */
  burnt: boolean;
}

/** The colour of a cell, and how strongly it shows. */
export function cellStyle(T: Theme, c: Cell, x: DataCtx): { color: string; a: number } {
  const dimK = x.dim ? 0.4 : 1;
  if (c.kind === 'free') return { color: mix(T.die, T.ink, 0.1), a: 0.7 };
  if (c.kind === 'bad') return { color: T.bad, a: 0.95 };
  const lost = c.kind === 'lost' || (x.burnt && c.kind === 'dataset');
  if (lost) return { color: mix(T.bad, T.bg, 0.5), a: 0.95 * dimK };
  const owned = [T.ld, T.br, mix(T.ld, T.bad, 0.5), mix(T.alu, T.mul, 0.5)];
  const color = c.kind === 'os' ? T.alu : c.kind === 'spool' ? T.st : c.kind === 'program' ? T.mul : c.kind === 'meta' ? T.mute : owned[x.owners.get(c.file) ?? 0]!;
  return { color, a: (0.3 + 0.7 * c.fill) * dimK };
}

/** Wear as a red shade over a cell (flash only; a fresh cell has none). */
const wearShade = (c: Cell): number => (c.kind === 'bad' ? 0 : Math.min(0.5, (c.wear / 100) * 0.5));

/**
 * The capacity map: one cell per block group over the whole floor. A flash drive gets a flat grid, a hard disk its platter as rings (the first blocks on
 * the outer ring) of sectors.
 */
export function drawMap(g: Graphics, T: Theme, kind: DriveKind, plan: DiskPlan, cells: readonly Cell[], x: DataCtx): void {
  g.clear();
  if (plan.platter) {
    const p = plan.platter, ring = (p.R * 0.86) / p.tracks;
    cells.forEach((c, i) => {
      const { track, sector } = platterCell(i, p.sectors);
      const r1 = p.R * 0.97 - track * ring, r0 = r1 - ring * 0.9, a0 = (sector / p.sectors) * Math.PI * 2 - Math.PI / 2, a1 = ((sector + 1) / p.sectors) * Math.PI * 2 - Math.PI / 2 - 0.02;
      const s = cellStyle(T, c, x);
      const pts: number[] = [];
      for (let k = 0; k <= 3; k++) { const a = a0 + ((a1 - a0) * k) / 3; pts.push(p.cx + Math.cos(a) * r1, p.cy + Math.sin(a) * r1); }
      for (let k = 3; k >= 0; k--) { const a = a0 + ((a1 - a0) * k) / 3; pts.push(p.cx + Math.cos(a) * r0, p.cy + Math.sin(a) * r0); }
      g.poly(pts).fill({ color: s.color, alpha: s.a });
    });
    g.circle(p.cx, p.cy, p.hub).fill({ color: mix(T.die, T.ink, 0.25) }).stroke({ width: Math.max(1, plan.h * 0.006), color: accentOf(T, kind) });
    return;
  }
  const m = plan.h * 0.06, w = plan.w - m * 2, h = plan.h - m * 2, grid = flatGrid(cells.length, w, h);
  cells.forEach((c, i) => {
    const s = cellStyle(T, c, x), cx = m + (i % grid.cols) * grid.cw, cy = m + Math.floor(i / grid.cols) * grid.ch;
    g.roundRect(cx + 1, cy + 1, Math.max(1.5, grid.cw - 2), Math.max(1.5, grid.ch - 2), 1.5).fill({ color: s.color, alpha: s.a });
  });
}

/** The live state the architecture layer shows beside the cells. */
export interface ArchLive {
  /** The block the head rests on and a smoothed track (the arm eases to it). */
  headLba: number;
  totalBlocks: number;
  track: number;
  /** Requests waiting at the drive and its queue depth. */
  queued: number;
  depth: number;
  busy: boolean;
}

/** The cells in the NAND dies (wear shaded), or on the platter's arm side: the arm seeking to the block in use; the queue lanes lit for the waiting requests. */
export function drawArch(g: Graphics, T: Theme, kind: DriveKind, plan: DiskPlan, cells: readonly Cell[], x: DataCtx, live: ArchLive): void {
  g.clear();
  const accent = accentOf(T, kind);
  if (plan.arm && plan.platter) {
    const p = plan.platter, a = plan.arm, ring = (p.R * 0.86) / p.tracks;
    const ang = Math.atan2(a.py - p.cy, a.px - p.cx), r = p.R * 0.97 - live.track * ring - ring * 0.45;
    const ex = p.cx + Math.cos(ang) * r, ey = p.cy + Math.sin(ang) * r;
    g.moveTo(a.px, a.py).lineTo(ex, ey).stroke({ width: plan.h * 0.03, color: mix(T.mute, T.ink, 0.3), cap: 'round', alpha: 0.95 });
    g.moveTo(a.px, a.py).lineTo(ex, ey).stroke({ width: plan.h * 0.008, color: '#ffffff', alpha: 0.2, cap: 'round' });
    g.circle(a.px, a.py, plan.h * 0.03).fill({ color: mix(T.die, T.ink, 0.3) }).stroke({ width: 1.5, color: accent });
    g.circle(ex, ey, plan.h * 0.018).fill({ color: live.busy ? T.ld : mix(T.ld, T.bg, 0.4) });
    // where the head is: a mark on its track's ring
    g.circle(ex, ey, plan.h * 0.034).stroke({ width: 1.5, color: T.ld, alpha: live.busy ? 0.9 : 0.4 });
    return;
  }
  for (const d of plan.dies) {
    const b = plan.blocks.find((x2) => x2.id === d.block)!;
    const rects = cellRects(b);
    for (let k = 0; k < d.slice.count; k++) {
      const c = cells[d.slice.first + k], r = rects[k];
      if (!c || !r) continue;
      const s = cellStyle(T, c, x);
      g.roundRect(r.x, r.y, r.w, r.h, 1.5).fill({ color: s.color, alpha: s.a });
      const w = wearShade(c);
      if (w > 0.02) g.roundRect(r.x, r.y, r.w, r.h, 1.5).fill({ color: T.bad, alpha: w });
    }
  }
  const q = plan.blocks.find((b) => b.kind === 'queue');
  if (q) {
    const { lanes, lit } = queueLanes(live.queued, live.depth), rects = cellRects(q);
    for (let k = 0; k < lanes && k < rects.length; k++) {
      const r = rects[k]!;
      g.roundRect(r.x, r.y, r.w, r.h, 1.5).fill({ color: k < lit ? T.st : mix(T.die, T.st, 0.15), alpha: k < lit ? 0.95 : 0.8 });
    }
  }
}

/** The fill bar of the far view: the share of the drive that holds data, along the bottom of the casing. */
export function drawBar(g: Graphics, T: Theme, w: number, h: number, used: number, cap: number, burnt: boolean): void {
  g.clear();
  const bw = w * 0.5, bh = Math.max(4, h * 0.028), x = w * 0.04, y = h - bh - h * 0.035, share = cap > 0 ? Math.min(1, used / cap) : 0;
  g.roundRect(x, y, bw, bh, bh / 2).fill({ color: '#000000', alpha: 0.45 });
  if (share > 0) g.roundRect(x, y, Math.max(bh, bw * share), bh, bh / 2).fill({ color: burnt ? T.bad : share > 0.9 ? T.ld : T.alu, alpha: 0.95 });
  g.roundRect(x, y, bw, bh, bh / 2).stroke({ width: 1.2, color: mix(T.line, T.ink, 0.3), alpha: 0.8 });
}

/** The head track the arm eases to (re-export for the view). */
export const trackFor = (lba: number, total: number, tracks: number): number => headTrack(lba, total, tracks);
