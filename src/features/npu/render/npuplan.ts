// The AI card's die as data (docs/ACCEL.md "NPU internal view", docs/DIE.md for the grammar it copies). Pure geometry, no Pixi: `npuPlan(input)`
// (npuplans.ts) returns the blocks and the routed links of one card in die coordinates, (0, 0) the die's north-west corner. The renderer draws it,
// the hover ids come from it (`pcie<k>.<block id>`, and `pcie<k>.mac<row>x<col>` for each cell of the array), and the tests check it. Like the CPU die it
// is a tiled floorplan: the blocks fill the die edge to edge, separated by gutters the wires run in. Block and link shapes match `cpuplan.ts`
// structurally, so the layout engine and the router (die/cpufloor.ts) place and route it too.

import type { Grid, Pt, Rect } from '../../cpu/render/core/cpuplan';

export type NpuBlockKind =
  // the host side: the PCIe link, and the registers the CPU writes
  | 'host' | 'ctl'
  // the command processor's descriptor queue
  | 'desc'
  // the datapath: tile registers, the systolic array, the bias and relu stage after it
  | 'tiles' | 'array' | 'post'
  // card memory
  | 'cardmem';

export interface NpuBlock {
  id: string;
  kind: NpuBlockKind;
  label: string;
  sub?: string;
  rect: Rect;
  grid?: Grid;
}

export type NpuLinkKind = 'host' | 'control' | 'data' | 'mem';

export interface NpuLink {
  id: string;
  kind: NpuLinkKind;
  from: string;
  to: string;
  /** Orthogonal polyline from the edge of `from` to the edge of `to`, through the gutters. */
  pts: Pt[];
  /** Parallel traces: 1 a control wire, 2 a word, 3 a wide bus. */
  lanes: 1 | 2 | 3 | 4;
  label?: string;
  both?: boolean;
}

/** What the floorplan depends on: the array's size, the card memory and the slot's width. */
export interface NpuPlanInput {
  /** The array is `grid` x `grid` cells. */
  grid: number;
  /** Card memory in bytes. */
  memBytes: number;
  /** PCIe lanes of the card (the link block's label). */
  lanes: number;
}

export interface NpuPlan {
  input: NpuPlanInput;
  die: Rect;
  blocks: NpuBlock[];
  links: NpuLink[];
}
