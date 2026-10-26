// The CPU die floorplan as data (docs/DIE.md). Pure geometry, no Pixi: `cpuPlan(input)` returns the blocks and the links of one
// architecture in die coordinates (the die is `DIE` from layout.ts, centred on the socket). The renderer draws it, the hover ids come
// from it (`cpu.<block id>`), and the tests check it. Every block stands for something the sim models.
//
// The grammar (all architectures): the instruction flow runs west to east, the instruction side (I-cache, predictor) is north, the data
// side (D-cache, L2) is south, the register file is below the decode/execute stages with its ports linked to decode and write-back, the
// bus interface unit (BIU) is the east column facing the package pins, the clock and the interrupt controller are in the north-west corner.

import type { EngineConfig } from '../sim/engines';
import { DIE } from './layout';

export interface Rect { x: number; y: number; w: number; h: number }
export type Pt = [number, number];

export type BlockKind =
  | 'clock' | 'intc' | 'biu'
  | 'stage' | 'latch'
  | 'pc' | 'pcadd' | 'nextpc' | 'fetch' | 'imm' | 'mmio' | 'icache' | 'predictor' | 'queue'
  | 'decode' | 'bundle' | 'hazard' | 'control'
  | 'regfile' | 'alu' | 'mul' | 'branch' | 'forward' | 'lsu' | 'wb'
  | 'dcache' | 'l2'
  | 'rename' | 'rob' | 'sched' | 'resultbus' | 'commit' | 'ring';

/** Entries a block shows as cells (register file, ROB, cache lines...). `count` cells in `cols` x `rows`. */
export interface Grid { cols: number; rows: number; count: number; ring?: boolean }

export interface Block {
  id: string;
  kind: BlockKind;
  label: string;
  sub?: string;
  rect: Rect;
  grid?: Grid;
  /** Containing stage frame, for blocks drawn inside one. */
  parent?: string;
  /** Pipeline stage index (0 IF .. 4 WB) of a stage frame; instruction chips sit in it. */
  stage?: number;
  lane?: number;
  /** The core tile of a multicore die this block belongs to. */
  core?: number;
  /** A functional unit's name in the OoO engine (ALU0 ALU1 MUL LSU): chips of that unit sit here. */
  unit?: string;
}

export type LinkKind = 'data' | 'control' | 'flush' | 'forward' | 'wakeup' | 'irq' | 'mem' | 'mmio';

export interface Link {
  id: string;
  kind: LinkKind;
  from: string;
  to: string;
  /** Orthogonal polyline from the edge of `from` to the edge of `to`. */
  pts: Pt[];
  /** 1 thin control, 2 data word, 3 wide bus. */
  width: 1 | 2 | 3;
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
  /** Predictor table entries and bits per entry (default 64 x 1; none on the unpipelined engine). */
  predEntries?: number;
  predBits?: number;
  robSize?: number;
  schedSize?: number;
  fetchQueue?: number;
  commitWidth?: number;
  /** Cores tiled on the die (default 1). Nothing multicore is simulated yet. */
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
      break;
  }
  if (e.kind !== 'ref') base.cacheLines = e.cacheLines;
  return { ...base, ...extra };
}

// ---------------------------------------------------------------- geometry helpers

export const U = { x0: DIE.x + 36, y0: DIE.y + 36, x1: DIE.x + DIE.w - 36, y1: DIE.y + DIE.h - 36 };

type Side = 'N' | 'S' | 'E' | 'W';

export const edgePoint = (r: Rect, side: Side, t = 0.5): Pt => {
  switch (side) {
    case 'N': return [Math.round(r.x + t * r.w), r.y];
    case 'S': return [Math.round(r.x + t * r.w), r.y + r.h];
    case 'W': return [r.x, Math.round(r.y + t * r.h)];
    case 'E': return [r.x + r.w, Math.round(r.y + t * r.h)];
  }
};

/** Axis-aligned route p0 -> via... -> p1 that leaves along `outH` and arrives along `inH` (true = horizontal). Misaligned corners get an elbow. */
export function ortho(p0: Pt, outH: boolean, via: Pt[], p1: Pt, inH: boolean): Pt[] {
  const pts: Pt[] = [p0];
  let h = outH;
  // Leaving and arriving along the same axis with the ends misaligned: a Z in the middle.
  if (via.length === 0 && outH === inH && (outH ? p0[1] !== p1[1] : p0[0] !== p1[0])) {
    via = [outH ? [Math.round((p0[0] + p1[0]) / 2), p0[1]] : [p0[0], Math.round((p0[1] + p1[1]) / 2)]];
  }
  const targets = [...via, p1];
  targets.forEach((q, i) => {
    const last = pts[pts.length - 1]!;
    if (q[0] === last[0] && q[1] === last[1]) return;
    if (last[0] === q[0] || last[1] === q[1]) { pts.push(q); h = last[1] === q[1]; return; }
    const horizFirst = i === targets.length - 1 ? !inH : h;
    pts.push(horizFirst ? [q[0], last[1]] : [last[0], q[1]], q);
    h = !horizFirst;
  });
  // drop collinear middle points
  const out: Pt[] = [];
  for (const p of pts) {
    const n = out.length;
    if (n >= 2) {
      const a = out[n - 2]!, b = out[n - 1]!;
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop();
    }
    out.push(p);
  }
  return out;
}

export interface LinkOpts { ft?: number; tt?: number; via?: Pt[]; width?: 1 | 2 | 3; label?: string; both?: boolean }

export class Builder {
  blocks: Block[] = [];
  links: Link[] = [];
  private byId = new Map<string, Block>();

  add(id: string, kind: BlockKind, label: string, x: number, y: number, w: number, h: number, o: Partial<Block> = {}): Block {
    const b: Block = { id, kind, label, rect: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }, ...o };
    this.blocks.push(b);
    this.byId.set(id, b);
    return b;
  }

  get(id: string): Block {
    const b = this.byId.get(id);
    if (!b) throw new Error(`cpuplan: no block ${id}`);
    return b;
  }

  /** Fraction along a block's side for an absolute y (E/W sides) or x (N/S sides). */
  ty(id: string, y: number): number { const r = this.get(id).rect; return (y - r.y) / r.h; }
  tx(id: string, x: number): number { const r = this.get(id).rect; return (x - r.x) / r.w; }

  /** A stage frame (a container the stage's sub-blocks sit in) and its sub-blocks, stacked top to bottom. */
  frame(id: string, label: string, stage: number, x: number, y: number, w: number, h: number): Block {
    return this.add(id, 'stage', label, x, y, w, h, { stage });
  }

  link(id: string, kind: LinkKind, from: string, fs: Side, to: string, ts: Side, o: LinkOpts = {}): void {
    const a = this.get(from), b = this.get(to);
    const p0 = edgePoint(a.rect, fs, o.ft), p1 = edgePoint(b.rect, ts, o.tt);
    const pts = ortho(p0, fs === 'E' || fs === 'W', o.via ?? [], p1, ts === 'E' || ts === 'W');
    this.links.push({ id, kind, from, to, pts, width: o.width ?? 2, ...(o.label ? { label: o.label } : {}), ...(o.both ? { both: true } : {}) });
  }
}

/** Near-square cols x rows for `n` cells in a w x h box. */
export function gridFor(n: number, w: number, h: number, minCols = 1): Grid {
  let cols = Math.max(minCols, Math.round(Math.sqrt((n * w) / Math.max(1, h))));
  cols = Math.min(n, Math.max(1, cols));
  return { cols, rows: Math.ceil(n / cols), count: n };
}

export const cacheSub = (lines: number, ways: number): string => `${lines} lines${ways > 1 ? ` · ${ways}-way` : ''}`;

