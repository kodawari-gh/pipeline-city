import { Graphics } from 'pixi.js';
import { label, mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import { planFar, planNear, type DieArt, type PlanStyle } from '../../cpu/render/die/dieart';
import type { NpuBlock, NpuBlockKind, NpuLink, NpuLinkKind, NpuPlan } from './npuplan';
import { npuGlyph, npuGlyphArea } from './npuglyph';
import { DIE_MARGIN } from './npuplans';

// The static art of the AI card's die, drawn from a `NpuPlan` in the CPU die's style (die/dieart.ts, docs/DIE.md): macro blocks tinted in their kind's
// colour with a rim line, the symbols of npuglyph.ts, trace bundles ending in solder pads, bond pads on the host edge, names and second lines. Two
// parts so the far view stays cheap: `npuFar` (floor, blocks, pads) and `npuNear` (traces, symbols, names), shown by zoom.

type Key = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad' | 'mute';

/** The accent of each block kind (the theme token it is drawn with: the host link cyan, registers green, control pink, memory amber, compute purple). */
export const NPU_KIND_COLOR: Record<NpuBlockKind, Key> = { host: 'alu', ctl: 'st', desc: 'br', tiles: 'ld', array: 'mul', post: 'mul', cardmem: 'ld' };
export const NPU_LINK_COLOR: Record<NpuLinkKind, Key> = { host: 'alu', control: 'mute', data: 'mul', mem: 'ld' };

/** The line under the die's name: what the card is made of. */
export const npuTitle = (plan: NpuPlan): string => `AI CARD · ${plan.input.grid} x ${plan.input.grid} MAC array · ${Math.round(plan.input.memBytes / 1024)}K memory`;

/** The legend of the colours. */
export const NPU_LEGEND: { text: string; key: Key }[] = [
  { text: 'HOST', key: 'alu' }, { text: 'REGISTERS', key: 'st' }, { text: 'CONTROL', key: 'br' }, { text: 'MEMORY', key: 'ld' }, { text: 'COMPUTE', key: 'mul' },
];

/** How the card is drawn: the CPU die's art (`planFar`, `planNear`) with the card's colours and symbols. */
export function npuStyle(plan: NpuPlan): PlanStyle<NpuBlock, NpuLink> {
  const opt = { grid: plan.input.grid, memBytes: plan.input.memBytes };
  return {
    color: (T, b) => T[NPU_KIND_COLOR[b.kind]],
    linkColor: (T, l) => T[NPU_LINK_COLOR[l.kind]],
    frame: () => false,
    symbol: (b) => npuGlyphArea(b),
    draw: (g, T, b, _a, c, put) => npuGlyph(g, T, b, c, put, opt),
    cells: () => [],
  };
}

/** The die's floor, the blocks, the bond pads round the edge (the host edge in the link's colour) and the pin-1 mark: the far view. */
export function npuFar(g: Graphics, T: Theme, plan: NpuPlan): void {
  const D = plan.die;
  g.roundRect(D.x, D.y, D.w, D.h, 6).fill({ color: mix(T.die, '#000000', 0.25) }).stroke({ width: 3, color: mix(T.line, T.mul, 0.6) });
  const x0 = D.x + DIE_MARGIN.x, x1 = D.x + D.w - DIE_MARGIN.x, y0 = D.y + DIE_MARGIN.top, y1 = D.y + D.h - DIE_MARGIN.bottom;
  for (let x = x0; x + 6 <= x1; x += 12) { g.rect(x, D.y + 8, 6, 6); g.rect(x, D.y + D.h - 14, 6, 6); }
  for (let y = y0 + 12; y + 6 <= y1; y += 12) g.rect(D.x + D.w - 14, y, 6, 6);
  g.fill({ color: T.pin, alpha: 0.7 });
  g.poly([D.x + 6, D.y + 6, D.x + 22, D.y + 6, D.x + 6, D.y + 22]).fill({ color: T.mul, alpha: 0.9 });
  const host = plan.blocks.find((b) => b.kind === 'host');
  if (host) {
    const n = Math.floor((host.rect.h - 20) / 12);
    for (let k = 0; k < n; k++) g.rect(D.x + 9, host.rect.y + 10 + k * 12, 6, 6);
    g.fill({ color: T.alu, alpha: 0.8 });
  }
  planFar(g, T, plan.blocks, npuStyle(plan));
}

/** Traces, symbols and names of a plan, and the strip under the blocks. */
export function npuNear(T: Theme, plan: NpuPlan): DieArt {
  const art = planNear(T, plan, npuStyle(plan));
  const D = plan.die, sy = D.y + D.h - DIE_MARGIN.bottom + 15, names = art.names;
  names.addChild(label(npuTitle(plan), D.x + DIE_MARGIN.x, sy, 13, T.mute, { weight: '700', a: 0.85 }));
  const legend = new Graphics();
  names.addChild(legend);
  let lx = D.x + D.w * 0.5;
  for (const e of NPU_LEGEND) {
    legend.roundRect(lx, sy - 4, 8, 8, 2).fill({ color: T[e.key] });
    names.addChild(label(e.text, lx + 13, sy, 9, T.mute, { a: 0.85 }));
    lx += 13 + e.text.length * 6.2 + 14;
  }
  names.addChild(label('PIPELINE CITY · REV A', D.x + D.w - DIE_MARGIN.x, sy, 10, T.mute, { a: 0.75, anchor: [1, 0.5] }));
  return art;
}
