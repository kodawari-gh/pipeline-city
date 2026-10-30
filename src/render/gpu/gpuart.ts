import { Container, Graphics } from 'pixi.js';
import { label, mix } from '../ink';
import type { Theme } from '../theme';
import type { Pt } from '../die/cpuplan';
import { LANE_GAP, offsetPts } from '../die/dieart';
import type { GpuBlockKind, GpuLink, GpuLinkKind, GpuPlan } from './gpuplan';
import { gpuGlyph, gpuGlyphArea } from './gpuglyph';
import { gpuCells } from './gpuplans';

// The static art of a GPU card's die, drawn from a `GpuPlan` in the CPU die's style (die/dieart.ts, docs/DIE.md): macro blocks tinted in their
// kind's colour with a rim line, dense cell arrays, trace bundles ending in solder pads, bond pads on the host edge, names and second lines.
// Two parts so the far view stays cheap: `gpuFar` (floor, SM frames, blocks, pads) and `gpuNear` (traces, cells, names), shown by zoom.

type Key = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad' | 'mute';

/** The accent of each block kind (the theme token it is drawn with; the CPU die's colours: fetch cyan, memory amber, registers green). */
export const GPU_KIND_COLOR: Record<GpuBlockKind, Key> = {
  pcie: 'alu', launch: 'br', pc: 'alu', fetch: 'alu', decode: 'alu', sched: 'mul', warps: 'mul', regfile: 'st', lanes: 'alu', mask: 'mul',
  coalescer: 'ld', arbiter: 'br', banks: 'ld', l1: 'ld', l2: 'ld', dram: 'ld', sm: 'mute',
};
export const GPU_LINK_COLOR: Record<GpuLinkKind, Key> = { data: 'alu', control: 'mute', mem: 'ld', launch: 'br' };

const tint = (T: Theme, c: string, t: number) => mix(T.die, c, t);

/** The die's floor, the SM frames, the blocks and the bond pads on the host edge: the far view. */
export function gpuFar(g: Graphics, T: Theme, plan: GpuPlan): void {
  const D = plan.die;
  g.roundRect(D.x, D.y, D.w, D.h, 6).fill({ color: mix(T.die, '#000000', 0.25) }).stroke({ width: 2, color: T.line });
  for (const b of plan.blocks) if (b.kind === 'pcie') {
    const n = Math.floor((b.rect.h - 20) / 12);
    for (let k = 0; k < n; k++) g.rect(D.x + 9, b.rect.y + 10 + k * 12, 6, 6);
    g.fill({ color: T.alu, alpha: 0.8 });
  }
  for (const b of plan.blocks) {
    if (b.kind !== 'sm') continue;
    const r = b.rect;
    g.roundRect(r.x, r.y, r.w, r.h, 5).fill({ color: mix(T.die, T.ink, 0.08) }).stroke({ width: 1.2, color: T.line });
  }
  for (const b of plan.blocks) {
    if (b.kind === 'sm') continue;
    const r = b.rect, c = T[GPU_KIND_COLOR[b.kind]];
    g.roundRect(r.x, r.y, r.w, r.h, 3).fill({ color: tint(T, c, 0.1) }).stroke({ width: 1.6, color: c });
  }
}

export interface GpuArt {
  root: Container;
  /** Trace bundles and solder pads. */
  wires: Container;
  /** Cell arrays. */
  cells: Container;
  /** Block names. */
  names: Container;
  /** The second line of a block. */
  subs: Container;
}

/** The traces of a link: one polyline per lane. */
export function gpuLaneLines(l: Pick<GpuLink, 'pts' | 'lanes'>): Pt[][] {
  const out: Pt[][] = [];
  for (let k = 0; k < l.lanes; k++) out.push(offsetPts(l.pts, (k - (l.lanes - 1) / 2) * LANE_GAP));
  return out;
}

/** Traces, cell arrays and names of a plan. */
export function gpuNear(T: Theme, plan: GpuPlan): GpuArt {
  const root = new Container(), wires = new Container(), cells = new Container(), names = new Container(), subs = new Container();
  root.addChild(wires, cells, names, subs);
  const wg = new Graphics();
  wires.addChild(wg);
  for (const l of plan.links) {
    const c = T[GPU_LINK_COLOR[l.kind]];
    for (const line of gpuLaneLines(l)) {
      wg.moveTo(line[0]![0], line[0]![1]);
      for (let i = 1; i < line.length; i++) wg.lineTo(line[i]![0], line[i]![1]);
      wg.stroke({ width: 1.3, color: c, alpha: 0.85, join: 'round' });
    }
  }
  for (const l of plan.links) {
    const c = T[GPU_LINK_COLOR[l.kind]];
    for (const p of [l.pts[0]!, l.pts[l.pts.length - 1]!]) wg.rect(p[0] - 2.5, p[1] - 2.5, 5, 5).fill({ color: c });
  }
  const cg = new Graphics();
  cells.addChild(cg);
  for (const b of plan.blocks) {
    const c = T[GPU_KIND_COLOR[b.kind]];
    if (gpuGlyphArea(b)) gpuGlyph(cg, T, b, c, (t, x, y, size) => subs.addChild(label(t, x, y, size, T.ink, { anchor: [0.5, 0.5], a: 0.85 })));
    else {
      for (const r of gpuCells(b)) cg.roundRect(r.x, r.y, r.w, r.h, 1.5);
      if (b.grid) cg.fill({ color: mix(T.die, c, 0.38) });
    }
    const r = b.rect;
    if (b.kind === 'sm') {
      names.addChild(label(b.label, r.x + 8, r.y + 12, 13, T.mute, { weight: '600', a: 0.9 }));
      if (b.sub) names.addChild(label(b.sub, r.x + 8 + b.label.length * 9 + 12, r.y + 12, 10, T.mute, { a: 0.8 }));
      continue;
    }
    const fs = Math.max(8, Math.min(15, (r.w - 14) / (b.label.length * 0.66), r.h * 0.45));
    if (r.h >= 20 && r.w >= 40) names.addChild(label(b.label, r.x + 7, r.y + 6 + fs / 2, fs, T.ink, { weight: '700' }));
    if (b.sub && r.h >= 44 && r.w >= 80) subs.addChild(label(b.sub, r.x + 7, r.y + 9 + fs + 6, 9, T.mute, { a: 0.95 }));
  }
  return { root, wires, cells, names, subs };
}
