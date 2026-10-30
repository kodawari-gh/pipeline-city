// The floorplan of the AI card (see npuplan.ts for the data model, die/cpufloor.ts for the layout engine and the router). The PCIe link and the registers
// are in the west; next to them the descriptor queue over card memory; the datapath fills the rest, top to bottom the way the data goes: the tile
// registers feed the array of multiply-accumulate cells, which drains south into the bias and relu stage that writes back to card memory.

import type { Rect } from '../die/cpuplan';
import { col, leaf, placeTree, routeWires, row, type Node, type Spec, type WireSpec } from '../die/cpufloor';
import type { NpuBlock, NpuBlockKind, NpuLinkKind, NpuPlan, NpuPlanInput } from './npuplan';

/** Margins round the blocks: the bond pads run in them, and the south one carries the title and the legend. */
export const DIE_MARGIN = { x: 24, top: 24, bottom: 40 };

/** The die grows with the array: wide enough for the cells to read at a zoom, and as tall. */
export const npuDie = (grid: number): { w: number; h: number } => ({ w: 840 + grid * 100, h: 400 + grid * 40 });

type K = NpuBlockKind;
type N = Node<K>;
type Opt = Partial<Spec<K>> & { f?: number; px?: number };
const L = (id: string, kind: K, label: string, o: Opt = {}): N => leaf<K>(id, kind, label, o);

type W = [id: string, kind: NpuLinkKind, from: string, to: string, lanes?: 1 | 2 | 3 | 4];
const wires = (a: W[]): WireSpec<NpuLinkKind>[] => a.map(([id, kind, from, to, lanes]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}) }));

function build(i: NpuPlanInput): { tree: N; specs: WireSpec<NpuLinkKind>[] } {
  const tree = row<K>([
    col<K>([
      L('host', 'host', 'PCIE LINK', { sub: `x${i.lanes}, to the machine`, f: 30 }),
      L('ctl', 'ctl', 'CONTROL', { sub: 'what the CPU writes', f: 70 }),
    ], { f: 14 }),
    col<K>([
      L('desc', 'desc', 'DESCRIPTORS', { sub: 'the list being run', f: 62 }),
      L('cardmem', 'cardmem', 'CARD MEMORY', { sub: `${Math.round(i.memBytes / 1024)}K, weights and activations`, f: 38 }),
    ], { f: 26 }),
    col<K>([
      L('tiles', 'tiles', 'TILE REGISTERS', { sub: 'four tiles of the array size', f: 20 }),
      L('array', 'array', 'MAC ARRAY', { sub: `${i.grid} x ${i.grid} multiply-accumulate cells`, f: 62 }),
      L('post', 'post', 'BIAS AND RELU', { sub: 'after the array, before the store', f: 18 }),
    ], { f: 60 }),
  ], { f: 1 });
  const specs: W[] = [
    ['host-ctl', 'host', 'host', 'ctl', 2],
    ['ctl-desc', 'control', 'ctl', 'desc', 2],
    ['desc-mem', 'mem', 'desc', 'cardmem', 2],
    ['desc-tiles', 'control', 'desc', 'tiles', 1],
    ['desc-array', 'control', 'desc', 'array', 1],
    ['mem-tiles', 'mem', 'cardmem', 'tiles', 3],
    ['tiles-array', 'data', 'tiles', 'array', 3],
    ['array-post', 'data', 'array', 'post', 3],
    ['post-mem', 'mem', 'post', 'cardmem', 3],
  ];
  return { tree, specs: wires(specs) };
}

function make(s: Spec<K>, r: Rect): NpuBlock {
  const b: NpuBlock = { id: s.id, kind: s.kind, label: s.label, rect: { ...r } };
  if (s.sub) b.sub = s.sub;
  return b;
}

const cache = new Map<string, NpuPlan>();

/** The floorplan of a card (cached by its input). */
export function npuPlan(i: NpuPlanInput, size: { w: number; h: number } = npuDie(i.grid)): NpuPlan {
  const key = JSON.stringify([i, size]);
  const hit = cache.get(key);
  if (hit) return hit;
  const die = { x: 0, y: 0, w: size.w, h: size.h };
  const { tree, specs } = build(i);
  const blocks: NpuBlock[] = [];
  const M = DIE_MARGIN;
  placeTree<K, NpuBlock>(tree, { x: M.x, y: M.top, w: size.w - 2 * M.x, h: size.h - M.top - M.bottom }, blocks, (s, r) => make(s, r));
  const plan: NpuPlan = { input: i, die, blocks, links: routeWires(die, blocks, specs, undefined, 'npuplan') };
  cache.set(key, plan);
  return plan;
}
