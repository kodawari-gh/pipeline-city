// The secure module's die as data (docs/ACCEL.md "TPM", docs/DIE.md for the grammar it copies). Pure geometry, no Pixi: `tpmPlan(input)`
// (tpmplans.ts) returns the blocks and the routed links of one module in die coordinates, (0, 0) the die's north-west corner. The renderer
// draws it, the hover ids come from it (`tpm<k>.<block id>`), and the tests check it. Like the CPU die it is a tiled floorplan: the blocks fill
// the die edge to edge, separated by gutters the wires run in. Block and link shapes match `cpuplan.ts` structurally, so the layout engine and
// the router (die/cpufloor.ts) place and route it too.

import type { TpmConfig } from '../sim/tpm';
import type { Grid, Pt, Rect } from '../../cpu/render/cpuplan';

export type TpmBlockKind =
  // the header side: the link to the chipset and the six registers the CPU sees
  | 'lpc' | 'regs'
  // the command sequencer
  | 'seq'
  // the engines: measure, attest, seal / unseal
  | 'hash' | 'quote' | 'vault'
  // the memory side: the bus master the hash reads RAM with, and the guard of protected mode
  | 'ramport' | 'guard';

export interface TpmBlock {
  id: string;
  kind: TpmBlockKind;
  label: string;
  sub?: string;
  rect: Rect;
  grid?: Grid;
}

export type TpmLinkKind = 'host' | 'control' | 'data' | 'mem';

export interface TpmLink {
  id: string;
  kind: TpmLinkKind;
  from: string;
  to: string;
  /** Orthogonal polyline from the edge of `from` to the edge of `to`, through the gutters. */
  pts: Pt[];
  /** Parallel traces: 1 a control wire, 2 a word, 3 a wide bus. */
  lanes: 1 | 2 | 3 | 4;
  label?: string;
  both?: boolean;
}

/** What the floorplan depends on: how the module's engines are built (its tier), nothing else. */
export interface TpmPlanInput {
  /** Module ticks a hash round takes: 4 is a serial round unit (shift, add, xor, latch), 1 a single-cycle one. */
  hashStages: number;
  /** Signing rounds of an attestation (the attest latency in units of 20 ticks). */
  quoteRounds: number;
  /** Sealed values the vault holds in view. */
  keys: number;
}

export interface TpmPlan {
  input: TpmPlanInput;
  die: Rect;
  blocks: TpmBlock[];
  links: TpmLink[];
}

/** The plan input of a module's config. */
export function tpmPlanInput(c: TpmConfig, keys: number): TpmPlanInput {
  return { hashStages: Math.max(1, Math.round(c.measureTicks)), quoteRounds: Math.max(1, Math.round(c.attestTicks / 20)), keys };
}
