// The CPU die floorplan as data (docs/DIE.md). Pure geometry, no Pixi: `cpuPlan(input)` (cpuplans.ts) returns the blocks and the links of one
// architecture in die coordinates (the die is `DIE` from layout.ts, centred on the socket). The renderer draws it, the hover ids come
// from it (`cpu.<block id>`), and the tests check it. Every block stands for something the sim models.
//
// A die is a **tiled floorplan**: the blocks fill the die edge to edge, separated by narrow gutters the wires run in. The parts
// that talk to the board sit on the edge their package pins are on (the memory controller east, PCIe/DMI/NVMe and the clock south,
// USB and the display west, power and SVID north); the core fills the middle.

import type { EngineConfig } from '../../sim/engines';

export interface Rect { x: number; y: number; w: number; h: number }
export type Pt = [number, number];

export type BlockKind =
  // the die's edge: the parts that talk to the board
  | 'power' | 'thermal' | 'mc' | 'pcie' | 'clock' | 'usb' | 'display' | 'intc' | 'timer' | 'mpu' | 'fabric'
  // the core
  | 'stage' | 'latch'
  | 'pc' | 'pcadd' | 'nextpc' | 'fetch' | 'port' | 'icache' | 'predictor' | 'queue'
  | 'imm' | 'decode' | 'bundle' | 'hazard' | 'control'
  | 'regfile' | 'alu' | 'mul' | 'branch' | 'forward' | 'mmio' | 'lsu' | 'wb'
  | 'dcache' | 'l2' | 'tlb'
  | 'rename' | 'rob' | 'sched' | 'resultbus' | 'ring';

/** Entries a block shows as cells, an exact `cols` x `rows` (never a partial row). */
export interface Grid { cols: number; rows: number; count: number; ring?: boolean }

export interface Block {
  id: string;
  kind: BlockKind;
  label: string;
  sub?: string;
  rect: Rect;
  grid?: Grid;
  /** The frame (a pipeline stage's column) this block sits in. */
  parent?: string;
  /** Pipeline stage index (0 IF .. 4 WB) of a stage frame; instruction chips sit in it. */
  stage?: number;
  lane?: number;
  /** The OoO functional unit (ALU0 ALU1 MUL LSU) whose chips sit in this block. */
  unit?: string;
  /** `edge`: the ring of board-facing blocks (shared by the cores); `core`: the processor proper. */
  zone: 'edge' | 'core';
  /** The core tile of a multicore die. */
  core?: number;
}

export type LinkKind = 'data' | 'control' | 'flush' | 'forward' | 'wakeup' | 'irq' | 'mem' | 'mmio' | 'power';

export interface Link {
  id: string;
  kind: LinkKind;
  from: string;
  to: string;
  /** Orthogonal polyline from the edge of `from` to the edge of `to`, through the gutters. */
  pts: Pt[];
  /** How many parallel traces the bundle has: 1 a control wire, 2 a word, 3 a wide bus, 4 the widest. */
  lanes: 1 | 2 | 3 | 4;
  label?: string;
  /** Traffic flows both ways. */
  both?: boolean;
}

export type Arch = 'unpipelined' | 'inorder' | 'inorder2' | 'ooo';

export interface PlanInput {
  arch: Arch;
  /** In-order only: bypass paths (default true). */
  forwarding?: boolean;
  /** Fetch / dispatch width of the OoO engine (default 2). */
  width?: number;
  cacheLines?: number;
  ways?: number;
  icacheLines?: number;
  l2Lines?: number;
  /** The MMU's TLB entries (0 or absent: the CPU has no MMU and no TLB block is drawn). */
  tlbEntries?: number;
  /** Predictor table entries and bits per entry (default 64 x 1; none on the unpipelined engine). */
  predEntries?: number;
  predBits?: number;
  robSize?: number;
  schedSize?: number;
  fetchQueue?: number;
  commitWidth?: number;
  /** Cores tiled on the die (default 1). */
  cores?: number;
}

export interface CpuPlan {
  arch: Arch;
  cores: number;
  die: Rect;
  blocks: Block[];
  links: Link[];
  /** For a multicore die: the rect of each core tile (the blocks of core k have ids prefixed `c<k>.`). */
  tiles?: Rect[];
}

/** The plan input of a spec's engine config (+ the feature knobs the sim will gain). */
export function planInput(e: EngineConfig, extra: Partial<PlanInput> = {}): PlanInput {
  const base: PlanInput = { arch: 'unpipelined' };
  switch (e.kind) {
    case 'ref': case 'unpipelined':
      base.arch = 'unpipelined'; break;
    case 'inorder':
      base.arch = 'inorder'; base.forwarding = e.forwarding ?? true; break;
    case 'inorder2':
      base.arch = 'inorder2'; base.forwarding = e.forwarding ?? true; break;
    case 'ooo':
      base.arch = 'ooo'; base.width = e.width ?? 2; base.robSize = e.robSize ?? 8; base.schedSize = e.schedSize ?? 6; base.fetchQueue = e.fetchQueue ?? 4;
      base.commitWidth = e.commitWidth ?? base.width;
      break;
  }
  if (e.kind !== 'ref') {
    base.cacheLines = e.cacheLines;
    if (e.ways) base.ways = e.ways;
    if (e.icacheLines) base.icacheLines = e.icacheLines;
    if (e.l2Lines) base.l2Lines = e.l2Lines;
    if (e.predEntries) base.predEntries = e.predEntries;
    if (e.predBits) base.predBits = e.predBits;
  }
  return { ...base, ...extra };
}

/**
 * `n` cells as an exact cols x rows rectangle (cols * rows = n, so a power of two gives power-of-two sides) whose cells are closest to
 * a 1.5 : 1 shape in a w x h box. A prime count is a single row or column.
 */
export function gridExact(n: number, w: number, h: number): Grid {
  let best = { cols: n, rows: 1, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    if (n % cols !== 0) continue;
    const rows = n / cols;
    const score = Math.abs(Math.log((w / cols) / (h / rows) / 1.5));
    if (score < best.score - 1e-9) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows, count: n };
}
