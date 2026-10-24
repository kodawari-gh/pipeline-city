// Messages between the main thread and the sim worker. Keep this file
// free of DOM and Pixi imports: it is shared by both sides.

import type { Snapshot } from './game/game';
import type { SaveV4 } from './game/save';

export type { Snapshot, SaveV4 };
/** The current save shape (older versions are migrated on load). The old name is kept for the main thread. */
export type SaveV1 = SaveV4;

/** Speed as a multiplier of base ticks per second (0 = paused). */
export type Speed = 0 | 1 | 4 | 16 | 64;
export const SPEEDS: Speed[] = [0, 1, 4, 16];
/** The sandbox also offers 64x (the host refuses it in a campaign game). */
export const SANDBOX_SPEEDS: Speed[] = [0, 1, 4, 16, 64];

export type ToSim =
  /** Start (or restart) the sim, from a save if given, else a new game with `seed`. */
  | { type: 'init'; save?: SaveV1 | null; seed?: number; sandbox?: boolean; preassembled?: boolean }
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
  /** Decline a waiting job (a tray key, or an ingested key that has not started): small reputation cost, free in the sandbox. */
  | { type: 'declineKey'; keyId: number }
  /** Decline an OS queue row (by key id); the network phase adds offers. */
  | { type: 'declineJob'; id: number }
  // Storage and the OS (docs/OS.md). Installing a drive or an OS uses `install` (an OS takes the storage slot id as slotId).
  | { type: 'uninstallOs' }
  | { type: 'requestSave' }
  // Sandbox tools (docs/SANDBOX.md): refused with a reason outside a sandbox game. Each replies with a snapshot.
  | { type: 'spawnKey'; template: string; scale?: number }
  | { type: 'clearQueue' }
  | { type: 'repairAll' }
  | { type: 'setReputation'; value: number }
  /** Pin the sandbox rules level (patience, payout, demand, job mix), 1 to 18. */
  | { type: 'setLevel'; level: number };

export type FromSim =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'saved'; save: SaveV1 }
  | { type: 'error'; message: string };
