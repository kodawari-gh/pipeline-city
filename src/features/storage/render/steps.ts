// The script of one drive command: the steps the drive takes, in order, with their times (pure types). `scriptFor` in diskplayer.ts makes one.

import type { StorageCmd } from '../sim/storage';

export type StepKind = 'cmd' | 'lookup' | 'send' | 'array' | 'return' | 'seek' | 'rotate' | 'media' | 'status';

/** One step: it starts at `at` ms into the script and lasts `dur` ms. */
export interface Step {
  kind: StepKind;
  at: number;
  dur: number;
  /** What the drive is doing, in words (the counter tier shows it). */
  label: string;
  /** Links the data crosses during the step (in the plan's own direction unless `rev`). */
  links: { id: string; rev: boolean }[];
  /** Blocks that work during the step. */
  blocks: string[];
  /** The step whose data is the payload (a data packet is bigger than a command's). */
  data: boolean;
}

export interface Script {
  cmd: StorageCmd;
  steps: Step[];
  total: number;
  /** The die and the cell in it (flash), or the cell on the platter (hard disk). */
  die: number;
  cell: number;
  /** The head track before and after (hard disk). */
  fromTrack: number;
  toTrack: number;
}
