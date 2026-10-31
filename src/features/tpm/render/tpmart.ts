import { Graphics } from 'pixi.js';
import { label, mix } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import { planFar, planNear, type DieArt, type PlanStyle } from '../../cpu/render/die/dieart';
import type { TpmBlock, TpmBlockKind, TpmLink, TpmLinkKind, TpmPlan } from './tpmplan';
import { tpmGlyph, tpmGlyphArea } from './tpmglyph';
import { DIE_MARGIN } from './tpmplans';

// The static art of the secure module's die, drawn from a `TpmPlan` in the CPU die's style (die/dieart.ts, docs/DIE.md): macro blocks tinted in
// their kind's colour with a rim line, the symbols of tpmglyph.ts, trace bundles ending in solder pads, bond pads on the host edge, names and
// second lines. Two parts so the far view stays cheap: `tpmFar` (floor, blocks, pads) and `tpmNear` (traces, symbols, names), shown by zoom.

type Key = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'bad' | 'mute';

/** The accent of each block kind (the theme token it is drawn with: the host link cyan, registers green, control pink, crypto purple, memory amber, the guard red). */
export const TPM_KIND_COLOR: Record<TpmBlockKind, Key> = { lpc: 'alu', regs: 'st', seq: 'br', hash: 'mul', quote: 'mul', vault: 'ld', ramport: 'ld', guard: 'bad' };
export const TPM_LINK_COLOR: Record<TpmLinkKind, Key> = { host: 'alu', control: 'mute', data: 'st', mem: 'ld' };

/** The accent of the die's rim: the serial module cyan, the single-cycle one purple. */
export const tpmAccent = (T: Theme, plan: TpmPlan): string => (plan.input.hashStages > 1 ? T.alu : T.mul);

/** The line under the die's name: what the module is made of. */
export const tpmTitle = (plan: TpmPlan): string => {
  const i = plan.input;
  return `SECURE MODULE · ${i.hashStages > 1 ? `${i.hashStages}-step hash round` : 'one-cycle hash round'} · ${i.quoteRounds} signing round${i.quoteRounds === 1 ? '' : 's'}`;
};

/** The legend of the colours. */
export const TPM_LEGEND: { text: string; key: Key }[] = [
  { text: 'HOST', key: 'alu' }, { text: 'REGISTERS', key: 'st' }, { text: 'CONTROL', key: 'br' }, { text: 'CRYPTO', key: 'mul' }, { text: 'STORAGE', key: 'ld' }, { text: 'GUARD', key: 'bad' },
];

/** How the module is drawn: the CPU die's art (`planFar`, `planNear`) with the module's colours and symbols. */
export function tpmStyle(plan: TpmPlan): PlanStyle<TpmBlock, TpmLink> {
  const opt = { stages: plan.input.hashStages, rounds: plan.input.quoteRounds, keys: plan.input.keys };
  return {
    color: (T, b) => T[TPM_KIND_COLOR[b.kind]],
    linkColor: (T, l) => T[TPM_LINK_COLOR[l.kind]],
    frame: () => false,
    symbol: (b) => tpmGlyphArea(b),
    draw: (g, T, b, _a, c, put) => tpmGlyph(g, T, b, c, put, opt),
    cells: () => [],
  };
}

/** The die's floor, the blocks, the bond pads round the edge (the host edge in the link's colour) and the pin-1 mark: the far view. */
export function tpmFar(g: Graphics, T: Theme, plan: TpmPlan): void {
  const D = plan.die, accent = tpmAccent(T, plan);
  g.roundRect(D.x, D.y, D.w, D.h, 6).fill({ color: mix(T.die, '#000000', 0.25) }).stroke({ width: 3, color: mix(T.line, accent, 0.6) });
  const x0 = D.x + DIE_MARGIN.x, x1 = D.x + D.w - DIE_MARGIN.x, y0 = D.y + DIE_MARGIN.top, y1 = D.y + D.h - DIE_MARGIN.bottom;
  for (let x = x0; x + 6 <= x1; x += 12) { g.rect(x, D.y + 8, 6, 6); g.rect(x, D.y + D.h - 14, 6, 6); }
  for (let y = y0 + 12; y + 6 <= y1; y += 12) g.rect(D.x + D.w - 14, y, 6, 6);
  g.fill({ color: T.pin, alpha: 0.7 });
  g.poly([D.x + 6, D.y + 6, D.x + 22, D.y + 6, D.x + 6, D.y + 22]).fill({ color: accent, alpha: 0.9 });
  const lpc = plan.blocks.find((b) => b.kind === 'lpc');
  if (lpc) {
    const n = Math.floor((lpc.rect.h - 20) / 12);
    for (let k = 0; k < n; k++) g.rect(D.x + 9, lpc.rect.y + 10 + k * 12, 6, 6);
    g.fill({ color: T.alu, alpha: 0.8 });
  }
  planFar(g, T, plan.blocks, tpmStyle(plan));
}

/** Traces, symbols and names of a plan, and the strip under the blocks. */
export function tpmNear(T: Theme, plan: TpmPlan): DieArt {
  const art = planNear(T, plan, tpmStyle(plan));
  const D = plan.die, sy = D.y + D.h - DIE_MARGIN.bottom + 15, names = art.names;
  names.addChild(label(tpmTitle(plan), D.x + DIE_MARGIN.x, sy, 13, T.mute, { weight: '700', a: 0.85 }));
  const legend = new Graphics();
  names.addChild(legend);
  let lx = D.x + D.w * 0.46;
  for (const e of TPM_LEGEND) {
    legend.roundRect(lx, sy - 4, 8, 8, 2).fill({ color: T[e.key] });
    names.addChild(label(e.text, lx + 13, sy, 9, T.mute, { a: 0.85 }));
    lx += 13 + e.text.length * 6.2 + 14;
  }
  names.addChild(label('PIPELINE CITY · REV A', D.x + D.w - DIE_MARGIN.x, sy, 10, T.mute, { a: 0.75, anchor: [1, 0.5] }));
  return art;
}
