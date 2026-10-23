// Messages between the main thread and the sim worker. Keep this file
// free of DOM and Pixi imports: it is shared by both sides.

import type { Snapshot } from './game/game';
import type { SaveV1 } from './game/save';

export type { Snapshot, SaveV1 };

/** Speed as a multiplier of base ticks per second (0 = paused). */
export type Speed = 0 | 1 | 4 | 16;
export const SPEEDS: Speed[] = [0, 1, 4, 16];

export type ToSim =
  /** Start (or restart) the sim, from a save if given, else a new game with `seed`. */
  | { type: 'init'; save?: SaveV1 | null; seed?: number }
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'purchase'; id: string }
  | { type: 'setCpuClock'; clock: number }
  | { type: 'powerCycle' }
  | { type: 'requestSave' };

export type FromSim =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'saved'; save: SaveV1 }
  | { type: 'error'; message: string };
