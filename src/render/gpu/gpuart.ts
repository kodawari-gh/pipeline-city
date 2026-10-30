import { Container, Graphics } from 'pixi.js';
import { label, mix } from '../ink';
import type { Theme } from '../theme';
import type { Pt } from '../die/cpuplan';
import { LANE_GAP, offsetPts } from '../die/dieart';
import type { GpuBlockKind, GpuLink, GpuLinkKind, GpuPlan } from './gpuplan';
import { gpuGlyph, gpuGlyphArea } from './gpuglyph';
import { DIE_MARGIN, gpuCells } from './gpuplans';

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

/** The accent of a card's die rim, by its microarchitecture (the CPU die's rim does the same by tier). */
export const gpuAccent = (T: Theme, plan: GpuPlan): string => (plan.input.kind === 'multi' ? T.mul : plan.input.kind === 'warp' ? T.st : T.alu);

/** The line under the die's name: what the card is made of. */
export function gpuTitle(plan: GpuPlan): string {
  const i = plan.input, lanes = `${i.lanes} lanes`;
  if (i.kind === 'simd') return `SIMD UNIT · ${lanes} · ${i.banks} bank${i.banks === 1 ? '' : 's'}`;
  if (i.kind === 'warp') return `WARP SM · ${i.warps} warps · ${lanes}`;
  return `${i.sms} SMs · ${i.warps} warps each · ${lanes} · L2`;
}

/** The legend of the colours (the instruction and block colours of the die). */
export const GPU_LEGEND: { text: string; key: Key }[] = [
  { text: 'ALU', key: 'alu' }, { text: 'MEMORY', key: 'ld' }, { text: 'REGISTERS', key: 'st' }, { text: 'SCHEDULING', key: 'mul' }, { text: 'CONTROL', key: 'br' },
];

/** The die's floor, the SM frames, the blocks, the bond pads round the edge and the pin-1 mark: the far view. */
export function gpuFar(g: Graphics, T: Theme, plan: GpuPlan): void {
  const D = plan.die, accent = gpuAccent(T, plan);
  g.roundRect(D.x, D.y, D.w, D.h, 6).fill({ color: mix(T.die, '#000000', 0.25) }).stroke({ width: 3, color: mix(T.line, accent, 0.6) });
  // the bond pad ring in the margin (the CPU die's gold pads), the host edge in the link's colour
  const x0 = D.x + DIE_MARGIN.x, x1 = D.x + D.w - DIE_MARGIN.x, y0 = D.y + DIE_MARGIN.top, y1 = D.y + D.h - DIE_MARGIN.bottom;
  for (let x = x0; x + 6 <= x1; x += 12) { g.rect(x, D.y + 8, 6, 6); g.rect(x, D.y + D.h - 14, 6, 6); }
  for (let y = y0 + 12; y + 6 <= y1; y += 12) g.rect(D.x + D.w - 14, y, 6, 6);
  g.fill({ color: T.pin, alpha: 0.7 });
  g.poly([D.x + 6, D.y + 6, D.x + 22, D.y + 6, D.x + 6, D.y + 22]).fill({ color: accent, alpha: 0.9 });
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
      wg.stroke({ width: 1.6, color: c, alpha: 0.92, join: 'round' });
    }
  }
  for (const l of plan.links) {
    const c = T[GPU_LINK_COLOR[l.kind]];
    for (const p of [l.pts[0]!, l.pts[l.pts.length - 1]!]) wg.rect(p[0] - 2.5, p[1] - 2.5, 5, 5).fill({ color: c }); // solder pads at both ends, as on the CPU die
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
  // the strip under the blocks: the card's name, the colour legend, the revision (the CPU package's text, docs/DIE.md)
  const D = plan.die, sy = D.y + D.h - DIE_MARGIN.bottom + 15;
  names.addChild(label(gpuTitle(plan), D.x + DIE_MARGIN.x, sy, 13, T.mute, { weight: '700', a: 0.85 }));
  const legend = new Graphics();
  names.addChild(legend);
  let lx = D.x + D.w * 0.42;
  for (const e of GPU_LEGEND) {
    legend.rect(lx, sy - 4, 8, 8).fill({ color: T[e.key] });
    names.addChild(label(e.text, lx + 13, sy, 9, T.mute, { a: 0.85 }));
    lx += 13 + e.text.length * 6.2 + 16;
  }
  names.addChild(label('PIPELINE CITY · REV A', D.x + D.w - DIE_MARGIN.x, sy, 10, T.mute, { a: 0.75, anchor: [1, 0.5] }));
  return { root, wires, cells, names, subs };
}
