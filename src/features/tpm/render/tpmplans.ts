// The floorplan of the secure module (see tpmplan.ts for the data model, die/cpufloor.ts for the layout engine and the router). The link to the
// chipset is in the west, the six registers next to it; the sequencer sits under the registers and drives the engines in the middle column (the hash,
// the quote engine, the sealed storage); the bus master and the range guard are in the east, where the module meets the memory bus.

import type { Rect } from '../../cpu/render/core/cpuplan';
import { col, leaf, placeTree, routeWires, row, type Node, type Spec, type WireSpec } from '../../cpu/render/core/cpufloor';
import type { TpmBlock, TpmBlockKind, TpmLinkKind, TpmPlan, TpmPlanInput } from './tpmplan';

/** Margins round the blocks: the bond pads run in them, and the south one carries the title and the legend. */
export const DIE_MARGIN = { x: 24, top: 24, bottom: 40 };
/** The die: wide and short, like the module it sits in. */
export const TPM_DIE = { w: 1500, h: 480 };

type K = TpmBlockKind;
type N = Node<K>;
type Opt = Partial<Spec<K>> & { f?: number; px?: number };
const L = (id: string, kind: K, label: string, o: Opt = {}): N => leaf<K>(id, kind, label, o);

type W = [id: string, kind: TpmLinkKind, from: string, to: string, lanes?: 1 | 2 | 3 | 4];
const wires = (a: W[]): WireSpec<TpmLinkKind>[] => a.map(([id, kind, from, to, lanes]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}) }));

function build(i: TpmPlanInput): { tree: N; specs: WireSpec<TpmLinkKind>[] } {
  const tree = row<K>([
    L('lpc', 'lpc', 'LPC LINK', { sub: 'header to the chipset', f: 11 }),
    col<K>([
      L('regs', 'regs', 'REGISTERS', { sub: 'what the CPU reads and writes', f: 70 }),
      L('seq', 'seq', 'SEQUENCER', { sub: 'one command at a time', f: 30 }),
    ], { f: 18 }),
    col<K>([
      L('hash', 'hash', 'HASH ENGINE', { sub: i.hashStages > 1 ? `serial round, ${i.hashStages} ticks a word` : 'one tick a word', f: 40 }),
      L('quote', 'quote', 'QUOTE ENGINE', { sub: `${i.quoteRounds} signing round${i.quoteRounds === 1 ? '' : 's'}`, f: 22 }),
      L('vault', 'vault', 'SEALED STORAGE', { sub: 'survives a reset', f: 38 }),
    ], { f: 38 }),
    col<K>([
      L('ramport', 'ramport', 'BUS MASTER', { sub: 'reads RAM for a measure', f: 42 }),
      L('guard', 'guard', 'RANGE GUARD', { sub: 'protected mode', f: 58 }),
    ], { f: 33 }),
  ], { f: 1 });
  const specs: W[] = [
    ['lpc-regs', 'host', 'lpc', 'regs', 2],
    ['regs-seq', 'control', 'regs', 'seq', 2],
    ['seq-hash', 'control', 'seq', 'hash', 1],
    ['seq-quote', 'control', 'seq', 'quote', 1],
    ['seq-vault', 'control', 'seq', 'vault', 1],
    ['seq-guard', 'control', 'seq', 'guard', 1],
    ['regs-hash', 'data', 'regs', 'hash', 2],
    ['regs-quote', 'data', 'regs', 'quote', 2],
    ['regs-vault', 'data', 'regs', 'vault', 2],
    ['hash-ram', 'mem', 'hash', 'ramport', 2],
    ['ram-guard', 'mem', 'ramport', 'guard', 2],
  ];
  return { tree, specs: wires(specs) };
}

function make(s: Spec<K>, r: Rect): TpmBlock {
  const b: TpmBlock = { id: s.id, kind: s.kind, label: s.label, rect: { ...r } };
  if (s.sub) b.sub = s.sub;
  return b;
}

const cache = new Map<string, TpmPlan>();

/** The floorplan of a module (cached by its input). */
export function tpmPlan(i: TpmPlanInput, size: { w: number; h: number } = TPM_DIE): TpmPlan {
  const key = JSON.stringify([i, size]);
  const hit = cache.get(key);
  if (hit) return hit;
  const die = { x: 0, y: 0, w: size.w, h: size.h };
  const { tree, specs } = build(i);
  const blocks: TpmBlock[] = [];
  const M = DIE_MARGIN;
  placeTree<K, TpmBlock>(tree, { x: M.x, y: M.top, w: size.w - 2 * M.x, h: size.h - M.top - M.bottom }, blocks, (s, r) => make(s, r));
  const plan: TpmPlan = { input: i, die, blocks, links: routeWires(die, blocks, specs, undefined, 'tpmplan') };
  cache.set(key, plan);
  return plan;
}
