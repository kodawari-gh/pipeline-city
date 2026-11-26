// The almanac's data shapes (docs/JOBS.md): an entry, a group, and the player's record of an entry.

import type { JobClassId, Need } from '../../../economy/sim/levels';

/** The part of the machine a tip is about: the almanac draws an icon for it instead of a sentence. */
export type TipPart =
  | 'clock'
  | 'cpu'
  | 'ram'
  | 'bank'
  | 'cache'
  | 'display'
  | 'tlb'
  | 'os'
  | 'drive'
  | 'gpu'
  | 'npu'
  | 'tpm'
  | 'predictor'
  | 'net'
  | 'none';

/** One way to do a job better: a part, a few words for the chip, and the full sentence behind it. `none` marks a part that does NOT help (worth knowing before buying it). */
interface Tip {
  part: TipPart;
  short: string;
  text: string;
  none?: boolean;
}

/** One entry: a kind of job, as the labels on the monitor name it (`Key.type`). */
export interface DexEntry {
  id: string;
  name: string;
  /** The job class it belongs to (levels.ts), which decides its default needs and level. */
  cls: JobClassId;
  /** The generator template (src/sim/gen) that makes this job's program; the key keeps it, so the template names the kind of job. */
  template: string;
  /** The work scale the class sends this job at (default: the class's). */
  scale?: number;
  /** The level clients start sending it (default: the class's first level). A job arrives only once the player has reached it. */
  level?: number;
  /** What it needs from the machine, instead of the class's (default: the class's). The hardware lock. */
  needs?: Need[];
  /** Pay relative to the class's multiplier (default 1). */
  payMul?: number;
  /** Relative share among the jobs of its class that have arrived at the player's level (default 1). */
  weight?: number;
  /** What an optional part does for it, as the chip reads (the job runs without it, slower): the card of an accelerator job, with the speed-up measured on the sim's cards. */
  boost?: string;
  /** One of the jobs the class sent before it had several: while these are the only ones unlocked the class sends its own template, so a game that has not reached the new ones plays as it always did. */
  legacy?: boolean;
  /** What it is, in a line. */
  blurb: string;
  /** What the job leans on, in the order it matters: the hardware to look at first. */
  stresses: string[];
  /** The memory the job keeps, in words. */
  footprint: string;
  /** How to do it faster or better: shown once the player has finished one. Each is something the sim really does. */
  tips: Tip[];
  /** Not built yet: shown, never unlocked. */
  planned?: boolean;
  /** A cloud-storage contract (src/sim/game/contracts.ts), not a program: it has no generator template and never arrives as a key. */
  contract?: true;
}

/** A group of kinds of job, shown as one collapsible section with its own colour. */
export interface DexGroup {
  id: string;
  name: string;
  color: string;
  ids: string[];
}

/** The player's record of one entry: when it first arrived, how many were finished and the fastest run (base ticks the machine took, plug to done). */
export interface DexRecord {
  seen: number;
  runs: number;
  best: number;
}

export type DexState = 'unseen' | 'seen' | 'done' | 'planned';

/** One line of the snapshot: the entry's id, how far the player has got with it and the record. */
export interface DexSnap {
  id: string;
  state: DexState;
  runs: number;
  best: number;
  seenTick: number;
}
