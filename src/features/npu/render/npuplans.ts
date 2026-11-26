// The floorplan of the AI card (see npuplan.ts for the data model, die/cpufloor.ts for the layout engine and the router). The PCIe link and the registers
// are in the west; next to them the descriptor queue over card memory; the datapath fills the rest, top to bottom the way the data goes: the tile
// registers feed the array of multiply-accumulate cells, which drains south into the bias and relu stage that writes back to card memory.

import type { Rect } from '../../cpu/render/core/cpuplan';
import * as cpufloor from '../../cpu/render/core/cpufloor';
import type { NpuBlock, NpuBlockKind, NpuLinkKind, NpuPlan, NpuPlanInput } from './npuplan';

/** Margins round the blocks: the bond pads run in them, and the south one carries the title and the legend. */
export const DIE_MARGIN = { x: 24, top: 24, bottom: 40 };

/** The main die grows with the array, about 5:4 as a die is. The card memory is a chip of its own beside it (`NPU_MEM`), `NPU_GAP` away. */
export const npuDie = (grid: number): { w: number; h: number } => ({ w: 760 + grid * 60, h: 600 + grid * 50 });
export const NPU_MEM = { w: 600, h: 480 };
export const NPU_GAP = 180;

type K = NpuBlockKind;
type N = cpufloor.Node<K>;
type Opt = Partial<cpufloor.Spec<K>> & { f?: number; px?: number };
const L = (id: string, kind: K, label: string, o: Opt = {}): N => cpufloor.leaf<K>(id, kind, label, o);

type W = [id: string, kind: NpuLinkKind, from: string, to: string, lanes?: 1 | 2 | 3 | 4];
const wires = (a: W[]): cpufloor.WireSpec<NpuLinkKind>[] =>
  a.map(([id, kind, from, to, lanes]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}) }));

function build(i: NpuPlanInput): { tree: N; specs: cpufloor.WireSpec<NpuLinkKind>[] } {
  // top to bottom the way the data goes; the host link in the north east, and every block that talks to the card memory (the die beside this one, in the east) has a free east edge
  const tree = cpufloor.col<K>(
    [
      cpufloor.row<K>(
        [
          L('ctl', 'ctl', 'CONTROL', { sub: 'what the CPU writes', f: 58 }),
          L('host', 'host', 'PCIE LINK', { sub: `x${i.lanes}, to the machine`, f: 42 }),
        ],
        { f: 16 },
      ),
      L('desc', 'desc', 'DESCRIPTORS', { sub: 'the list being run', f: 18 }),
      L('tiles', 'tiles', 'TILE REGISTERS', { sub: 'four tiles of the array size', f: 11 }),
      L('array', 'array', 'MAC ARRAY', { sub: `${i.grid} x ${i.grid} multiply-accumulate cells`, f: 43 }),
      L('post', 'post', 'BIAS AND RELU', { sub: 'after the array, before the store', f: 12 }),
    ],
    { f: 1 },
  );
  const specs: W[] = [
    ['host-ctl', 'host', 'host', 'ctl', 2],
    ['host-mem', 'host', 'host', 'cardmem', 3],
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

function make(s: cpufloor.Spec<K>, r: Rect): NpuBlock {
  const b: NpuBlock = { id: s.id, kind: s.kind, label: s.label, rect: { ...r } };
  if (s.sub) {
    b.sub = s.sub;
  }
  return b;
}

const cache = new Map<string, NpuPlan>();

/** The floorplan of a card (cached by its input). */
export function npuPlan(i: NpuPlanInput, size: { w: number; h: number } = npuDie(i.grid)): NpuPlan {
  const key = JSON.stringify([i, size]);
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  // the main die at the origin, the card memory's die beside it over the gap, its south edge on the main die's
  const core = { x: 0, y: 0, w: size.w, h: size.h },
    memory = { x: size.w + NPU_GAP, y: size.h - NPU_MEM.h, w: NPU_MEM.w, h: NPU_MEM.h };
  const die = { x: 0, y: 0, w: memory.x + memory.w, h: size.h };
  const { tree, specs } = build(i);
  const blocks: NpuBlock[] = [];
  const M = DIE_MARGIN;
  cpufloor.placeTree<K, NpuBlock>(
    tree,
    { x: M.x, y: M.top, w: size.w - 2 * M.x, h: size.h - M.top - M.bottom },
    blocks,
    (s, r) => make(s, r),
  );
  cpufloor.placeTree<K, NpuBlock>(
    L('cardmem', 'cardmem', 'CARD MEMORY', { sub: `${Math.round(i.memBytes / 1024)}K, weights and activations` }),
    { x: memory.x + M.x, y: memory.y + M.top, w: memory.w - 2 * M.x, h: memory.h - M.top - M.bottom },
    blocks,
    (s, r) => make(s, r),
  );
  const plan: NpuPlan = {
    input: i,
    die,
    core,
    memory,
    blocks,
    links: cpufloor.routeWires(die, blocks, specs, undefined, 'npuplan'),
  };
  cache.set(key, plan);
  return plan;
}
