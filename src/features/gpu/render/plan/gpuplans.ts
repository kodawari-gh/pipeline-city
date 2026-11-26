// The floorplan of each GPU tier (see gpuplan.ts for the data model, die/cpufloor.ts for the layout engine and the router). The host link and
// the launch registers sit in the west; the SM (the front end, the warps, the registers and lanes, the memory path) fills the middle; the
// card memory is in the east. A multi-SM card stacks one framed SM per row and gives the L2 and the card memory the east column.

import * as cpuplan from '@/features/cpu/render/core/cpuplan';
import * as cpufloor from '@/features/cpu/render/core/cpufloor';
import type { GpuBlock, GpuBlockKind, GpuLinkKind, GpuPlan, GpuPlanInput } from './gpuplan';

/** Margins round the blocks: the bond pads run in them, and the south one carries the title and the legend. */
export const DIE_MARGIN = { x: 24, top: 24, bottom: 40 };

/**
 * The main die's size by kind: about 3:2, as a die is, and big enough for the labels and symbols to read (docs/GPU.md section 7). The card memory is a chip of its own beside it (`GPU_MEM`), so the
 * main die holds only the SM, the host link and the L2.
 */
export const GPU_DIE: Record<GpuPlanInput['kind'], { w: number; h: number }> = {
  simd: { w: 1350, h: 900 },
  warp: { w: 1500, h: 1000 },
  multi: { w: 1950, h: 1300 },
};

/** The memory die: the card memory's map of 64 x 40 cells with its row buffer under it, inside the margins. `DIE_GAP`: the gap between the two dies, where the wires cross. */
export const GPU_MEM = { w: 640, h: 520 };
export const DIE_GAP = 180;

/** Room a symbol keeps beside its cell grid: the register file's row decoder (left) and its operand latches (under), a cache's index decoder (left) and its tag compare (under). */
export function cellInset(b: Pick<GpuBlock, 'kind' | 'rect'>): { l: number; b: number } {
  const { w, h } = b.rect;
  if (b.kind === 'regfile') {
    return { l: w >= 110 ? 16 : 0, b: h >= 200 ? 28 : 0 };
  }
  if (b.kind === 'l1' || b.kind === 'l2') {
    return { l: w >= 90 ? 12 : 0, b: h >= 130 ? 24 : 0 };
  }
  return { l: 0, b: 0 };
}

/** The cell rectangles of a block's grid (die coordinates, row by row), under the block's name (and inside `cellInset`); about the area `gridExact` was asked for in `make`. */
export function gpuCells(b: GpuBlock): cpuplan.Rect[] {
  const g = b.grid;
  if (!g) {
    return [];
  }
  const r = b.rect,
    head = r.h >= 70 ? 44 : r.h * 0.55,
    ins = cellInset(b);
  const gx = r.x + 8 + ins.l,
    gy = r.y + head,
    gw = r.w - 16 - ins.l,
    gh = r.y + r.h - 6 - ins.b - gy;
  if (gw <= 8 || gh <= 6) {
    return [];
  }
  const cw = gw / g.cols,
    ch = gh / g.rows;
  return Array.from({ length: g.count }, (_, k) => ({
    x: gx + (k % g.cols) * cw + 1,
    y: gy + Math.floor(k / g.cols) * ch + 1,
    w: Math.max(1.5, cw - 2),
    h: Math.max(1.5, ch - 2),
  }));
}

type K = GpuBlockKind;
type N = cpufloor.Node<K>;
type Opt = Partial<cpufloor.Spec<K>> & { f?: number; px?: number };
const L = (id: string, kind: K, label: string, o: Opt = {}): N => cpufloor.leaf<K>(id, kind, label, o);

type W = [id: string, kind: GpuLinkKind, from: string, to: string, lanes?: 1 | 2 | 3 | 4];
const wires = (a: W[]): cpufloor.WireSpec<GpuLinkKind>[] =>
  a.map(([id, kind, from, to, lanes]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}) }));

const kb = (b: number) => `${b / 1024} KB`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

interface Built {
  tree: N;
  specs: W[];
  /** The block the launch registers feed, and the block that leaves the SM towards the card memory. */ entry: string;
  exit: string;
}

/** gpu1: one unpipelined unit, one bank, no coalescer, no cache. */
function simdSm(i: GpuPlanInput): Built {
  const { lanes } = i;
  // the front end is a column (the program counter, the fetch, the decoder) like the CPU's IF and ID stages: wide blocks, not tall empty ones
  // two bands on the left, the way the data goes (the front end and the registers above, the lanes under them), the bank arbiter and the banks, the way out to the card memory, in the east
  const tree = cpufloor.row<K>(
    [
      cpufloor.col<K>(
        [
          cpufloor.row<K>(
            [
              cpufloor.col<K>(
                [
                  L('pc', 'pc', 'PC', { sub: 'program counter', f: 34 }),
                  L('fetch', 'fetch', 'FETCH', { sub: 'reads the kernel', f: 31 }),
                  L('decode', 'decode', 'DECODE', { sub: 'op, vregs, imm', f: 35 }),
                ],
                { f: 36 },
              ),
              L('regs', 'regfile', 'VECTOR REGISTERS', { sub: `8 x ${lanes} lanes`, shape: [lanes, 8], f: 64 }),
            ],
            { f: 50 },
          ),
          cpufloor.col<K>(
            [
              L('lanes', 'lanes', 'LANE ALUs', { sub: plural(lanes, 'lane'), cells: lanes, f: 60 }),
              L('mask', 'mask', 'EXEC MASK', { sub: 'stack 8 deep', shape: [lanes, 1], f: 24 }),
            ],
            { f: 50 },
          ),
        ],
        { f: 76 },
      ),
      L('arb', 'arbiter', 'BANK ARB', { sub: plural(i.banks, 'bank'), f: 8 }),
      L('banks', 'banks', 'BANKS', { shape: [1, i.banks], f: 16 }),
    ],
    { f: 1 },
  );
  const specs: W[] = [
    ['pc-fetch', 'control', 'pc', 'fetch', 1],
    ['fetch-decode', 'control', 'fetch', 'decode', 2],
    ['decode-regs', 'control', 'decode', 'regs', 2],
    ['regs-lanes', 'data', 'regs', 'lanes', 3],
    ['mask-lanes', 'control', 'mask', 'lanes', 1],
    ['lanes-arb', 'mem', 'lanes', 'arb', 3],
    ['arb-banks', 'mem', 'arb', 'banks', 2],
  ];
  return { tree, specs, entry: 'pc', exit: 'banks' };
}

/** The part of an SM every warp engine shares: warps, scoreboard scheduler, registers, lanes and the coalescing memory path. `p` prefixes the ids. */
function warpSm(i: GpuPlanInput, p: string, cached: boolean): Built {
  const lanes = i.lanes / i.sms,
    id = (s: string) => p + s;
  const fetch = L(id('fetch'), 'fetch', 'FETCH', { sub: 'one a cycle', f: 8 });
  const decode = L(id('decode'), 'decode', 'DECODE', { sub: 'op, vregs, imm', f: 9 });
  const sched = L(id('sched'), 'sched', 'SCHEDULER', { sub: 'scoreboard · round robin', shape: [8, i.warps], f: 11 });
  const regs = L(id('regs'), 'regfile', 'VECTOR REGISTERS', { sub: `8 x ${lanes} lanes`, shape: [lanes, 8], f: 11 });
  const lanesCol = cpufloor.col<K>(
    [
      L(id('lanes'), 'lanes', 'LANE ALUs', { sub: plural(lanes, 'lane'), cells: lanes, f: 60 }),
      L(id('mask'), 'mask', 'EXEC MASKS', { sub: 'one per warp', shape: [Math.min(lanes, 16), 1], f: 24 }),
    ],
    { f: 12 },
  );
  const coal = L(id('coal'), 'coalescer', 'COALESCER', { sub: `${i.lineWords}-word lines`, f: 6 });
  const specs: W[] = [
    [id('fetch-decode'), 'control', id('fetch'), id('decode'), 2],
    [id('decode-sched'), 'control', id('decode'), id('sched'), 2],
    [id('sched-regs'), 'control', id('sched'), id('regs'), 2],
    [id('regs-lanes'), 'data', id('regs'), id('lanes'), 3],
    [id('mask-lanes'), 'control', id('mask'), id('lanes'), 1],
    [id('lanes-coal'), 'mem', id('lanes'), id('coal'), 3],
    [id('coal-arb'), 'mem', id('coal'), id('arb'), 2],
  ];
  if (!cached) {
    // gpu2: warps sit under the front end, the banks are a column of their own
    const warps = L(id('warps'), 'warps', 'WARPS', { sub: 'pc · mask · stack each', shape: [i.warps, 1], f: 40 });
    specs.push(
      [id('sched-warps'), 'control', id('sched'), id('warps'), 2],
      [id('arb-banks'), 'mem', id('arb'), id('banks'), 2],
    );
    const tree = cpufloor.row<K>(
      [
        cpufloor.col<K>(
          [
            cpufloor.row<K>(
              [
                cpufloor.col<K>([cpufloor.row<K>([fetch, decode, sched], { f: 40 }), warps], { f: 56 }),
                { ...regs, f: 44 },
              ],
              {
                f: 50,
              },
            ),
            cpufloor.row<K>(
              [
                { ...lanesCol, f: 70 },
                { ...coal, f: 30 },
              ],
              { f: 50 },
            ),
          ],
          { f: 74 },
        ),
        L(id('arb'), 'arbiter', 'BANK ARB', { sub: plural(i.banks, 'bank'), f: 10 }),
        L(id('banks'), 'banks', 'BANKS', { shape: [1, i.banks], f: 16 }),
      ],
      { f: 1 },
    );
    return { tree, specs, entry: id('fetch'), exit: id('banks') };
  }
  // gpu3: warps are a column of their own, the banks sit in the arbiter, an L1 leaves the SM
  const warps = L(id('warps'), 'warps', 'WARPS', { sub: 'pc · mask · stack', shape: [i.warps, 1], f: 8 });
  specs.push(
    [id('sched-warps'), 'control', id('sched'), id('warps'), 2],
    [id('arb-l1'), 'mem', id('arb'), id('l1'), 2],
  );
  const tree = cpufloor.row<K>(
    [
      cpufloor.col<K>(
        [
          cpufloor.row<K>([fetch, decode, sched, warps], { f: 34 }),
          cpufloor.row<K>(
            [
              { ...regs, f: 30 },
              { ...lanesCol, f: 50 },
              { ...coal, f: 20 },
            ],
            { f: 66 },
          ),
        ],
        { f: 72 },
      ),
      L(id('arb'), 'arbiter', 'BANK ARB', { sub: plural(i.banks, 'bank'), shape: [1, i.banks], f: 12 }),
      L(id('l1'), 'l1', 'L1', { sub: `${i.l1Lines} lines`, cells: i.l1Lines, f: 16 }),
    ],
    { f: 1 },
  );
  return { tree, specs, entry: id('fetch'), exit: id('l1') };
}

/** The main die's tree (the card memory is a die of its own: `gpuPlan` places it) and every wire, the ones to the memory too. */
function build(i: GpuPlanInput): { tree: N; specs: cpufloor.WireSpec<GpuLinkKind>[] } {
  const west = cpufloor.col<K>(
    [
      L('pcie', 'pcie', 'PCIe', { sub: 'host link', f: 1 }),
      L('launch', 'launch', 'LAUNCH', { sub: 'regs · command', f: 1 }),
    ],
    { f: 7 },
  );
  const specs: W[] = [['pcie-launch', 'launch', 'pcie', 'launch', 2]];
  if (i.sms === 1) {
    const sm = i.kind === 'simd' ? simdSm(i) : warpSm(i, '', false);
    specs.push([`launch-${sm.entry}`, 'launch', 'launch', sm.entry, 1], ...sm.specs, [
      `${sm.exit}-dram`,
      'mem',
      sm.exit,
      'dram',
      3,
    ]);
    // the one SM is framed like each SM of a multi-SM card (id `sm0`; its blocks keep their plain ids)
    const frame = {
      id: 'sm0',
      kind: 'sm' as const,
      label: i.kind === 'simd' ? 'SIMD UNIT' : 'SM 0',
      sub: `${plural(i.warps, 'warp')} · ${plural(i.lanes, 'lane')}`,
    };
    return {
      tree: cpufloor.row<K>([west, { ...(sm.tree as Extract<N, { dir: string }>), frame, pad: 8, title: 22, f: 90 }], {
        f: 1,
      }),
      specs: wires(specs),
    };
  }
  const frames: N[] = [];
  for (let k = 0; k < i.sms; k++) {
    const p = `sm${k}.`,
      sm = warpSm(i, p, true);
    frames.push({
      ...(sm.tree as Extract<N, { dir: string }>),
      frame: {
        id: `sm${k}`,
        kind: 'sm',
        label: `SM ${k}`,
        sub: `${plural(i.warps, 'warp')} · ${plural(i.lanes / i.sms, 'lane')}`,
      },
      pad: 8,
      title: 22,
      f: 1,
    });
    specs.push([`launch-${sm.entry}`, 'launch', 'launch', sm.entry, 1], ...sm.specs, [
      `${sm.exit}-l2`,
      'mem',
      sm.exit,
      'l2',
      2,
    ]);
  }
  specs.push(['l2-dram', 'mem', 'l2', 'dram', 3]);
  const l2 = L('l2', 'l2', 'L2', { sub: `shared · ${i.l2Lines} lines`, cells: i.l2Lines, f: 17 });
  return { tree: cpufloor.row<K>([west, cpufloor.col<K>(frames, { f: 76 }), l2], { f: 1 }), specs: wires(specs) };
}

function make(s: cpufloor.Spec<K>, r: GpuBlock['rect'], parent: string | undefined): GpuBlock {
  const b: GpuBlock = { id: s.id, kind: s.kind, label: s.label, rect: { ...r } };
  if (s.sub) {
    b.sub = s.sub;
  }
  if (parent) {
    b.parent = parent;
  }
  const sm = /(?<=^sm)\d+/u.exec(s.id);
  if (sm) {
    b.sm = Number(sm[0]);
  }
  if (s.shape) {
    b.grid = { cols: s.shape[0], rows: s.shape[1], count: s.shape[0] * s.shape[1] };
  } else if (s.cells) {
    b.grid = cpuplan.gridExact(s.cells, r.w - 16, Math.max(8, r.h - 44));
  }
  return b;
}

/** Stack slots of an execution mask. */
const MASK_SLOTS = 8;

/** The mask strip (one bit per lane) and the stack slots in the lower part of a mask block (die coordinates). */
export function maskParts(
  r: cpuplan.Rect,
  bits: number,
): { strip: cpuplan.Rect; bits: cpuplan.Rect[]; stack: cpuplan.Rect; slots: cpuplan.Rect[] } {
  const head = Math.min(44, Math.max(24, r.h * 0.4)),
    body = r.h - head - 6,
    bh = Math.max(4, body * 0.4),
    sh = Math.max(4, Math.min(16, body * 0.4));
  const strip: cpuplan.Rect = { x: r.x + 8, y: r.y + head, w: r.w - 16, h: bh },
    bw = strip.w / bits;
  const sw = Math.min(16, (r.w - 16) / MASK_SLOTS - 3),
    y = r.y + head + bh + Math.max(2, body * 0.12);
  return {
    strip,
    bits: Array.from({ length: bits }, (_, k) => ({ x: strip.x + k * bw, y: strip.y, w: bw - 1, h: bh })),
    stack: { x: r.x + 8, y, w: MASK_SLOTS * (sw + 3) - 3, h: sh },
    slots: Array.from({ length: MASK_SLOTS }, (_, k) => ({ x: r.x + 8 + k * (sw + 3), y, w: sw, h: sh })),
  };
}

const cache = new Map<string, GpuPlan>();

/** The floorplan of a card (cached by its input). */
export function gpuPlan(i: GpuPlanInput, size: { w: number; h: number } = GPU_DIE[i.kind]): GpuPlan {
  const key = JSON.stringify([i, size]);
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  // the main die at the origin, the memory die beside it over the gap, its south edge on the main die's (the way out to the memory leaves the SM's south east corner)
  const core = { x: 0, y: 0, w: size.w, h: size.h },
    memory = { x: size.w + DIE_GAP, y: size.h - GPU_MEM.h, w: GPU_MEM.w, h: GPU_MEM.h };
  const die = { x: 0, y: 0, w: memory.x + memory.w, h: size.h };
  const { tree, specs } = build(i);
  const blocks: GpuBlock[] = [];
  const M = DIE_MARGIN;
  cpufloor.placeTree<K, GpuBlock>(
    tree,
    { x: M.x, y: M.top, w: size.w - 2 * M.x, h: size.h - M.top - M.bottom },
    blocks,
    (s, r, parent) => make(s, r, parent),
  );
  cpufloor.placeTree<K, GpuBlock>(
    L('dram', 'dram', 'CARD MEMORY', { sub: kb(i.memBytes) }),
    { x: memory.x + M.x, y: memory.y + M.top, w: memory.w - 2 * M.x, h: memory.h - M.top - M.bottom },
    blocks,
    (s, r, parent) => make(s, r, parent),
  );
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const dram = byId.get('dram');
  if (dram) {
    dram.bytes = i.memBytes;
  }
  for (const b of blocks) {
    if (b.parent && b.sm === undefined) {
      b.sm = byId.get(b.parent)?.sm;
    }
  }
  const plan: GpuPlan = {
    input: i,
    die,
    core,
    memory,
    blocks,
    links: cpufloor.routeWires(die, blocks, specs, undefined, 'gpuplan'),
  };
  cache.set(key, plan);
  return plan;
}
