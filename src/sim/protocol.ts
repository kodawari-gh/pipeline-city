// Messages between the main thread and the sim worker. Keep this file
// free of DOM and Pixi imports: it is shared by both sides.

import type { Snapshot } from './game/game';
import type { SaveV3 } from './game/save';

export type { Snapshot, SaveV3 };
/** The current save shape (older versions are migrated on load). The old name is kept for the main thread. */
export type SaveV1 = SaveV3;

/** Speed as a multiplier of base ticks per second (0 = paused). */
export type Speed = 0 | 1 | 4 | 16;
export const SPEEDS: Speed[] = [0, 1, 4, 16];

export type ToSim =
  /** Start (or restart) the sim, from a save if given, else a new game with `seed`. */
  | { type: 'init'; save?: SaveV1 | null; seed?: number }
  | { type: 'setSpeed'; speed: Speed }
  /** Buy a part: it goes to the inventory, not into the machine. */
  | { type: 'purchase'; id: string }
  | { type: 'setCpuClock'; clock: number }
  | { type: 'powerCycle' }
  // Assembly and keys (docs/ASSEMBLY.md). Each replies with a snapshot, plus an error message if it was refused.
  | { type: 'install'; invId: string; slotId?: string }
  | { type: 'uninstall'; deviceId: string }
  | { type: 'connectCable'; cable: string }
  | { type: 'disconnectCable'; cable: string }
  | { type: 'powerButton' }
  | { type: 'plugKey'; keyId: number }
  | { type: 'ejectKey' }
  | { type: 'requestSave' };

export type FromSim =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'saved'; save: SaveV1 }
  | { type: 'error'; message: string };
