// The GPU card floorplan as data (docs/GPU.md section 7, docs/DIE.md for the grammar it copies). Pure geometry, no Pixi: `gpuPlan(input)`
// (gpuplans.ts) returns the blocks and the routed links of one card in die coordinates, (0, 0) the die's north-west corner. The renderer
// draws it, the hover ids come from it (`pcie<k>.<block id>`), and the tests check it. Like the CPU die it is a tiled floorplan: the blocks fill
// the die edge to edge, separated by gutters the wires run in. Block and link shapes match `cpuplan.ts` structurally, so the layout engine and
// the router (die/cpufloor.ts) place and route both.

import type { GpuConfig } from '../../sim/gpu/engine';
import type { Grid, Pt, Rect } from '../die/cpuplan';

export type GpuBlockKind =
  // the host side
  | 'pcie' | 'launch'
  // one SM: the front end, the warps, the data path
  | 'pc' | 'fetch' | 'decode' | 'sched' | 'warps' | 'regfile' | 'lanes' | 'mask'
  // the memory path
  | 'coalescer' | 'arbiter' | 'banks' | 'l1' | 'l2' | 'dram'
  // a streaming multiprocessor's frame (gpu3)
  | 'sm';

export interface GpuBlock {
  id: string;
  kind: GpuBlockKind;
  label: string;
  sub?: string;
  rect: Rect;
  /** Entries drawn as cells, an exact `cols` x `rows`. */
  grid?: Grid;
  /** The SM frame this block sits in. */
  parent?: string;
  /** The SM it belongs to (0 on a card with one). */
  sm?: number;
}

export type GpuLinkKind = 'data' | 'control' | 'mem' | 'launch';

export interface GpuLink {
  id: string;
  kind: GpuLinkKind;
  from: string;
  to: string;
  /** Orthogonal polyline from the edge of `from` to the edge of `to`, through the gutters. */
  pts: Pt[];
  /** Parallel traces: 1 a control wire, 2 a word, 3 a wide bus. */
  lanes: 1 | 2 | 3 | 4;
  label?: string;
  both?: boolean;
}

/** What the floorplan depends on: the card's microarchitecture, nothing else. */
export interface GpuPlanInput {
  kind: 'simd' | 'warp' | 'multi';
  sms: number;
  /** Warps per SM. */
  warps: number;
  /** Lanes on the whole card. */
  lanes: number;
  /** Banks per SM. */
  banks: number;
  memBytes: number;
  lineWords: number;
  /** L1 lines per SM and L2 lines (0 = none). */
  l1Lines: number;
  l2Lines: number;
}

export interface GpuPlan {
  input: GpuPlanInput;
  die: Rect;
  blocks: GpuBlock[];
  links: GpuLink[];
}

/** The plan input of a card's config. */
export function gpuPlanInput(c: GpuConfig): GpuPlanInput {
  switch (c.kind) {
    case 'warp': return { kind: 'warp', sms: 1, warps: c.warps, lanes: c.lanes, banks: c.banks, memBytes: c.memBytes, lineWords: c.lineWords, l1Lines: 0, l2Lines: 0 };
    case 'multi': return { kind: 'multi', sms: c.sms, warps: c.warps, lanes: c.lanes, banks: c.banks, memBytes: c.memBytes, lineWords: c.lineWords, l1Lines: c.l1Lines, l2Lines: c.l2Lines };
    default: return { kind: 'simd', sms: 1, warps: 1, lanes: c.lanes, banks: c.banks, memBytes: c.memBytes, lineWords: 1, l1Lines: 0, l2Lines: 0 };
  }
}
