// Messages between the main thread and the sim worker. Keep this file
// free of DOM and Pixi imports: it is shared by both sides.

import type { Snapshot } from './game/game';
import type { SaveV4 } from './game/save';
import type { CrashReport } from './crash';

export type { Snapshot, SaveV4, CrashReport };
/** The current save shape (older versions are migrated on load). The old name is kept for the main thread. */
export type SaveV1 = SaveV4;

/**
 * Speed as a multiplier of base ticks per second (0 = paused). The player sees it divided by 4: the pace the game is
 * designed around (4 ticks a second) is "1x", so 1, 2, 4, 8, 12 read as 0.25x, 0.5x, 1x, 2x, 3x.
 */
export type Speed = 0 | 1 | 2 | 4 | 8 | 12 | 16 | 64;
export const SPEEDS: Speed[] = [0, 1, 2, 4, 8, 12];
/** The sandbox also offers 4x and 16x on screen (the host refuses 64 in a campaign game). */
export const SANDBOX_SPEEDS: Speed[] = [0, 1, 2, 4, 8, 12, 16, 64];

export type ToSim =
  /** Start (or restart) the sim, from a save if given, else a new game with `seed`. */
  | { type: 'init'; save?: SaveV1 | null; seed?: number; sandbox?: boolean; preassembled?: boolean; maxed?: boolean }
  | { type: 'setSpeed'; speed: Speed }
  /** While paused: run the machine for this many CPU cycles (1 to 100000) or for one whole base tick. Replies with a snapshot. */
  | { type: 'step'; cycles: number }
  | { type: 'stepTick' }
  /** While paused: tick the card in a PCIe slot (`pcie0`...) for this many of its cycles (1 to 100000). Replies with a snapshot. */
  | { type: 'stepGpu'; slot: string; cycles: number }
  /** Follow a logical core of a multicore CPU: the snapshot's `pipe` (the die's detail, the Trace panel) is its hardware core's. Replies with a snapshot. */
  | { type: 'viewCore'; core: number }
  /** Buy a part: it goes to the inventory, not into the machine. */
  | { type: 'purchase'; id: string }
  | { type: 'sell'; invId: string }
  | { type: 'setCpuClock'; clock: number }
  | { type: 'setRamClock'; deviceId: string; clock: number }
  | { type: 'powerCycle' }
  // Assembly and keys (docs/ASSEMBLY.md). Each replies with a snapshot, plus an error message if it was refused.
  | { type: 'install'; invId: string; slotId?: string }
  | { type: 'uninstall'; deviceId: string }
  /** `port` is for the ethernet cable ("lan"): "board" or a network card's device id (default: the board jack). The lan cable can be plugged while the machine is on. */
  | { type: 'connectCable'; cable: string; port?: string }
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
  /** Format a data drive with the OS's filesystem (off only); `confirm` accepts losing datasets. */
  | { type: 'formatDrive'; deviceId: string; confirm?: boolean }
  /** Accept a cloud-storage contract offer (docs/JOBS.md "Contracts"); `deviceId` picks the drive, else the slowest that qualifies. Ignoring just removes the offer. */
  | { type: 'acceptContract'; offerId: number; deviceId?: string }
  | { type: 'ignoreContract'; offerId: number }
  | { type: 'requestSave' }
  // Sandbox tools (docs/SANDBOX.md): refused with a reason outside a sandbox game. Each replies with a snapshot.
  | { type: 'spawnKey'; template: string; scale?: number }
  | { type: 'clearQueue' }
  | { type: 'repairAll' }
  | { type: 'setReputation'; value: number }
  /** Pin the sandbox rules level (patience, payout, demand, job mix), 1 to 18. */
  | { type: 'setLevel'; level: number }
  /** Sandbox: the job classes that stop arriving on their own (empty = all arrive). */
  | { type: 'setJobClasses'; off: string[] }
  /** Sandbox: the kinds of job (job dex ids) that stop arriving on their own (empty = all arrive). */
  | { type: 'setJobKinds'; off: string[] };

export type FromSim =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'saved'; save: SaveV1 }
  | { type: 'error'; message: string }
  /** The sim threw while running: it is paused, and the report says where and why (docs/ARCHITECTURE.md "Crash report"). */
  | { type: 'crash'; report: CrashReport };
