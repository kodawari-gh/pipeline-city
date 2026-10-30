// The floorplan of each GPU tier (see gpuplan.ts for the data model, die/cpufloor.ts for the layout engine and the router). The host link and
// the launch registers sit in the west; the SM (the front end, the warps, the registers and lanes, the memory path) fills the middle; the
// card memory is in the east. A multi-SM card stacks one framed SM per row and gives the L2 and the card memory the east column.

import { gridExact, type Rect } from '../die/cpuplan';
import { col, leaf, placeTree, routeWires, row, type Node, type Spec, type WireSpec } from '../die/cpufloor';
import type { GpuBlock, GpuBlockKind, GpuLinkKind, GpuPlan, GpuPlanInput } from './gpuplan';

/** Margins round the blocks: the bond pads run in them, and the south one carries the title and the legend. */
export const DIE_MARGIN = { x: 24, top: 24, bottom: 40 };

/** The die's size by kind: the card is tall enough for the labels and symbols to read (docs/GPU.md section 7). */
export const GPU_DIE: Record<GpuPlanInput['kind'], { w: number; h: number }> = {
  simd: { w: 2300, h: 440 },
  warp: { w: 2800, h: 440 },
  multi: { w: 3400, h: 440 },
};

/** The cell rectangles of a block's grid (die coordinates, row by row), under the block's name; the same area as `gridExact` was asked for in `make`. */
export function gpuCells(b: GpuBlock): Rect[] {
  const g = b.grid;
  if (!g) return [];
  const r = b.rect, head = r.h >= 70 ? 44 : r.h * 0.55;
  const gx = r.x + 8, gy = r.y + head, gw = r.w - 16, gh = r.y + r.h - 6 - gy;
  if (gw <= 8 || gh <= 6) return [];
  const cw = gw / g.cols, ch = gh / g.rows;
  return Array.from({ length: g.count }, (_, k) => ({ x: gx + (k % g.cols) * cw + 1, y: gy + Math.floor(k / g.cols) * ch + 1, w: Math.max(1.5, cw - 2), h: Math.max(1.5, ch - 2) }));
}

type K = GpuBlockKind;
type N = Node<K>;
type Opt = Partial<Spec<K>> & { f?: number; px?: number };
const L = (id: string, kind: K, label: string, o: Opt = {}): N => leaf<K>(id, kind, label, o);

type W = [id: string, kind: GpuLinkKind, from: string, to: string, lanes?: 1 | 2 | 3 | 4];
const wires = (a: W[]): WireSpec<GpuLinkKind>[] => a.map(([id, kind, from, to, lanes]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}) }));

const kb = (b: number) => `${b / 1024} KB`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

interface Built { tree: N; specs: W[]; /** The block the launch registers feed, and the block that leaves the SM towards the card memory. */ entry: string; exit: string }

/** gpu1: one unpipelined unit, one bank, no coalescer, no cache. */
function simdSm(i: GpuPlanInput): Built {
  const lanes = i.lanes;
  // the front end is a column (the program counter, the fetch, the decoder) like the CPU's IF and ID stages: wide blocks, not tall empty ones
  const tree = row<K>([
    col<K>([
      L('pc', 'pc', 'PC', { sub: 'program counter', f: 26 }),
      L('fetch', 'fetch', 'FETCH', { sub: 'reads the kernel', f: 34 }),
      L('decode', 'decode', 'DECODE', { sub: 'op, vregs, imm', f: 40 }),
    ], { f: 16 }),
    L('regs', 'regfile', 'VECTOR REGISTERS', { sub: `8 x ${lanes} lanes`, shape: [lanes, 8], f: 13 }),
    col<K>([L('lanes', 'lanes', 'LANE ALUs', { sub: plural(lanes, 'lane'), cells: lanes, f: 60 }), L('mask', 'mask', 'EXEC MASK', { sub: 'stack 8 deep', shape: [lanes, 1], f: 24 })], { f: 17 }),
    L('arb', 'arbiter', 'BANK ARB', { sub: plural(i.banks, 'bank'), f: 6 }),
    L('banks', 'banks', 'BANKS', { shape: [1, i.banks], f: 9 }),
  ], { f: 1 });
  const specs: W[] = [
    ['pc-fetch', 'control', 'pc', 'fetch', 1], ['fetch-decode', 'control', 'fetch', 'decode', 2], ['decode-regs', 'control', 'decode', 'regs', 2],
    ['regs-lanes', 'data', 'regs', 'lanes', 3], ['mask-lanes', 'control', 'mask', 'lanes', 1], ['lanes-arb', 'mem', 'lanes', 'arb', 3], ['arb-banks', 'mem', 'arb', 'banks', 2],
  ];
  return { tree, specs, entry: 'pc', exit: 'banks' };
}

/** The part of an SM every warp engine shares: warps, scoreboard scheduler, registers, lanes and the coalescing memory path. `p` prefixes the ids. */
function warpSm(i: GpuPlanInput, p: string, cached: boolean): Built {
  const lanes = i.lanes / i.sms, id = (s: string) => p + s;
  const fetch = L(id('fetch'), 'fetch', 'FETCH', { sub: 'one a cycle', f: 8 });
  const decode = L(id('decode'), 'decode', 'DECODE', { sub: 'op, vregs, imm', f: 9 });
  const sched = L(id('sched'), 'sched', 'SCHEDULER', { sub: 'scoreboard · round robin', shape: [8, i.warps], f: 11 });
  const regs = L(id('regs'), 'regfile', 'VECTOR REGISTERS', { sub: `8 x ${lanes} lanes`, shape: [lanes, 8], f: 11 });
  const lanesCol = col<K>([
    L(id('lanes'), 'lanes', 'LANE ALUs', { sub: plural(lanes, 'lane'), cells: lanes, f: 60 }),
    L(id('mask'), 'mask', 'EXEC MASKS', { sub: 'one per warp', shape: [Math.min(lanes, 16), 1], f: 24 }),
  ], { f: 12 });
  const coal = L(id('coal'), 'coalescer', 'COALESCER', { sub: `${i.lineWords}-word lines`, f: 6 });
  const specs: W[] = [
    [id('fetch-decode'), 'control', id('fetch'), id('decode'), 2], [id('decode-sched'), 'control', id('decode'), id('sched'), 2], [id('sched-regs'), 'control', id('sched'), id('regs'), 2],
    [id('regs-lanes'), 'data', id('regs'), id('lanes'), 3], [id('mask-lanes'), 'control', id('mask'), id('lanes'), 1], [id('lanes-coal'), 'mem', id('lanes'), id('coal'), 3], [id('coal-arb'), 'mem', id('coal'), id('arb'), 2],
  ];
  if (!cached) {
    // gpu2: warps sit under the front end, the banks are a column of their own
    const warps = L(id('warps'), 'warps', 'WARPS', { sub: 'pc · mask · stack each', shape: [i.warps, 1], f: 40 });
    specs.push([id('sched-warps'), 'control', id('sched'), id('warps'), 2], [id('arb-banks'), 'mem', id('arb'), id('banks'), 2]);
    const tree = row<K>([
      col<K>([row<K>([fetch, decode, sched], { f: 40 }), warps], { f: 31 }),
      regs, lanesCol, coal,
      L(id('arb'), 'arbiter', 'BANK ARB', { sub: plural(i.banks, 'bank'), f: 6 }),
      L(id('banks'), 'banks', 'BANKS', { shape: [1, i.banks], f: 4 }),
    ], { f: 1 });
    return { tree, specs, entry: id('fetch'), exit: id('banks') };
  }
  // gpu3: warps are a column of their own, the banks sit in the arbiter, an L1 leaves the SM
  const warps = L(id('warps'), 'warps', 'WARPS', { sub: 'pc · mask · stack', shape: [i.warps, 1], f: 8 });
  specs.push([id('sched-warps'), 'control', id('sched'), id('warps'), 2], [id('arb-l1'), 'mem', id('arb'), id('l1'), 2]);
  const tree = row<K>([
    fetch, decode, sched, warps, regs, lanesCol, coal,
    L(id('arb'), 'arbiter', 'BANK ARB', { sub: plural(i.banks, 'bank'), shape: [1, i.banks], f: 6 }),
    L(id('l1'), 'l1', 'L1', { sub: `${i.l1Lines} lines`, cells: i.l1Lines, f: 4 }),
  ], { f: 1 });
  return { tree, specs, entry: id('fetch'), exit: id('l1') };
}

function build(i: GpuPlanInput): { tree: N; specs: WireSpec<GpuLinkKind>[] } {
  const west = col<K>([L('pcie', 'pcie', 'PCIe', { sub: 'host link', f: 1 }), L('launch', 'launch', 'LAUNCH', { sub: 'regs · command', f: 1 })], { f: 7 });
  const dram = L('dram', 'dram', 'CARD MEMORY', { sub: kb(i.memBytes), f: 9 });
  const specs: W[] = [['pcie-launch', 'launch', 'pcie', 'launch', 2]];
  if (i.sms === 1) {
    const sm = i.kind === 'simd' ? simdSm(i) : warpSm(i, '', false);
    specs.push([`launch-${sm.entry}`, 'launch', 'launch', sm.entry, 1], ...sm.specs, [`${sm.exit}-dram`, 'mem', sm.exit, 'dram', 3]);
    return { tree: row<K>([west, { ...sm.tree, f: 56 }, dram], { f: 1 }), specs: wires(specs) };
  }
  const frames: N[] = [];
  for (let k = 0; k < i.sms; k++) {
    const p = `sm${k}.`, sm = warpSm(i, p, true);
    frames.push({ ...(sm.tree as Extract<N, { dir: string }>), frame: { id: `sm${k}`, kind: 'sm', label: `SM ${k}`, sub: `${plural(i.warps, 'warp')} · ${plural(i.lanes / i.sms, 'lane')}` }, pad: 8, title: 22, f: 1 });
    specs.push([`launch-${sm.entry}`, 'launch', 'launch', sm.entry, 1], ...sm.specs, [`${sm.exit}-l2`, 'mem', sm.exit, 'l2', 2]);
  }
  specs.push(['l2-dram', 'mem', 'l2', 'dram', 3]);
  const l2 = L('l2', 'l2', 'L2', { sub: `shared · ${i.l2Lines} lines`, cells: i.l2Lines, f: 8 });
  return { tree: row<K>([west, col<K>(frames, { f: 56 }), l2, dram], { f: 1 }), specs: wires(specs) };
}

function make(s: Spec<K>, r: GpuBlock['rect'], parent: string | undefined): GpuBlock {
  const b: GpuBlock = { id: s.id, kind: s.kind, label: s.label, rect: { ...r } };
  if (s.sub) b.sub = s.sub;
  if (parent) b.parent = parent;
  const m = /^sm(\d+)/.exec(s.id);
  if (m) b.sm = Number(m[1]);
  if (s.shape) b.grid = { cols: s.shape[0], rows: s.shape[1], count: s.shape[0] * s.shape[1] };
  else if (s.cells) b.grid = gridExact(s.cells, r.w - 16, Math.max(8, r.h - 44));
  return b;
}

/** Stack slots of an execution mask. */
export const MASK_SLOTS = 8;

/** The mask strip (one bit per lane) and the stack slots in the lower part of a mask block (die coordinates). */
export function maskParts(r: Rect, bits: number): { strip: Rect; bits: Rect[]; stack: Rect; slots: Rect[] } {
  const head = Math.min(44, Math.max(24, r.h * 0.4)), body = r.h - head - 6, bh = Math.max(4, body * 0.4), sh = Math.max(4, Math.min(16, body * 0.4));
  const strip: Rect = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: bh }, bw = strip.w / bits;
  const sw = Math.min(16, (r.w - 16) / MASK_SLOTS - 3), y = r.y + head + bh + Math.max(2, body * 0.12);
  return {
    strip, bits: Array.from({ length: bits }, (_, k) => ({ x: strip.x + k * bw, y: strip.y, w: bw - 1, h: bh })),
    stack: { x: r.x + 8, y, w: MASK_SLOTS * (sw + 3) - 3, h: sh }, slots: Array.from({ length: MASK_SLOTS }, (_, k) => ({ x: r.x + 8 + k * (sw + 3), y, w: sw, h: sh })),
  };
}

const cache = new Map<string, GpuPlan>();

/** The floorplan of a card (cached by its input). */
export function gpuPlan(i: GpuPlanInput, size: { w: number; h: number } = GPU_DIE[i.kind]): GpuPlan {
  const key = JSON.stringify([i, size]);
  const hit = cache.get(key);
  if (hit) return hit;
  const die = { x: 0, y: 0, w: size.w, h: size.h };
  const { tree, specs } = build(i);
  const blocks: GpuBlock[] = [];
  const M = DIE_MARGIN;
  placeTree<K, GpuBlock>(tree, { x: M.x, y: M.top, w: size.w - 2 * M.x, h: size.h - M.top - M.bottom }, blocks, (s, r, parent) => make(s, r, parent));
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const dram = byId.get('dram');
  if (dram) dram.bytes = i.memBytes;
  for (const b of blocks) if (b.parent && b.sm === undefined) b.sm = byId.get(b.parent)?.sm;
  const plan: GpuPlan = { input: i, die, blocks, links: routeWires(die, blocks, specs, undefined, 'gpuplan') };
  cache.set(key, plan);
  return plan;
}
