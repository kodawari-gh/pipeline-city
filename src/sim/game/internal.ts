// What the feature files of the game share but the outside world never sees: the internal records and a few constants.

import type { Binding, IspSpec, RouterSpec } from "../net";
import type { OsSpec } from "../os";
import type { PchKey } from "../pch";
import { levelRows, type LevelRowSnap, type Need } from "./levels";
import type { JobWindow } from "./joblog";
import type { LinkState, MountPhase } from "./types";
import type { Job } from "./work";

/** The memory array the machine is built with: the most a paged OS manages (its 20-bit virtual space). */
export const MACHINE_RAM_BYTES = 1024 * 1024;

/** A client job on a USB key. The program is generated when the key is plugged in. */
export interface Key extends Job {
  template: string;
  seed: number;
  scale: number;
  deadline: number;
  /** Reference instruction count of the program (the payout base). */
  work: number;
  /** Short job type for the label: log, calc, checksum, scan, or the class id (db, web, gpu...). */
  type: string;
  /** Job class id (levels.ts) and what it needs from the machine. */
  cls: string;
  needs: Need[];
  /** Payout multiplier of the class. */
  payMul: number;
  /** The job number the program prints on the monitor (#NN). */
  jobNo: number;
  attempts: number;
  pluggedAt: number;
  done: boolean;
  doneAt: number;
  /**
   * The tick the job first ran: the kernel began it (`stampRan`), or the plug when there is no OS. `pluggedAt` to here is queue, USB or
   * download ingest and spool; from here to `doneAt` is the run. Absent until then and for keys from older saves (the run then reads from `pluggedAt`).
   * Saved only on a key that holds its result: a job that is mid-run at a save starts over after the load and stamps it again.
   */
  ranAt?: number;
  /** The game was loaded while the machine held this job (not saved): the counters restarted at the load, so its window and `ranAt` are re-stamped when it runs and cover only the time since. */
  reloaded?: true;
  /** The engine's counters when the job first ran (not saved): the job log reports the change by the time it finishes. */
  c0?: number[];
  /** What the counters changed by from the job being taken to its result landing (set when `doneAt` is). */
  win?: JobWindow;
  /** The result landed while no OS was installed (not saved): ejecting it under an OS later is not an OS job. */
  doneBeforeOs?: boolean;
  result: string;
  /**
   * A USB key the client left behind when the link came up (docs/NETWORK.md "Retired keys"): it no longer holds
   * reputation, expires silently at its deadline and declining it is free. Still servable until then.
   */
  retired: boolean;
}

/** A download or upload in progress (RAM, lost on power loss). */
export interface Transfer {
  key: Key;
  totalMB: number;
  doneMB: number;
  /** An upload whose result is read out but has no client slot yet (docs/NETWORK.md "Web jobs"): it moves no bytes. */
  waiting?: boolean;
}

/** The link as evaluated each tick. */
export interface Link {
  state: LinkState;
  reason: string | null;
  port: { kind: "board" | "nic" | null; deviceId: string | null; mbps: number };
  router: RouterSpec | null;
  isp: IspSpec | null;
  bw: { downMbps: number; upMbps: number; clients: number; binding: Binding | null };
}

/** The job the virtual USB key (the NIC feed) currently carries into or out of the kernel. */
export interface NetKey { key: Key; kind: "ingest" | "flash"; pch: PchKey; since: number; fromRx: boolean }

export interface InvItem {
  id: string;
  spec: string;
}

/** The installed OS: its spec, the storage device it lives on and the queue bound worked out at install time. */
export interface InstalledOs {
  spec: OsSpec;
  deviceId: string;
  queueSlots: number;
}

/** The OS's boot probe of one drive: the scan, then (for a `dirty` drive) the repair, in base ticks. `left` counts down to 0. */
export interface DriveMount { phase: MountPhase; scanTicks: number; repairTicks: number; left: number }

/** A row of the kernel's job table (read from RAM). */
export interface KernelJob { slot: number; state: number; key: number; len: number; seq: number }

export const lockText = (l: { level: number; name: string }): string => `needs Level ${l.level} (${l.name})`;
export const LOG_CAP = 16;
/** The level the sandbox rules are pinned at until `setLevel`. */
export const SANDBOX_LEVEL = 8;
export const NOT_SANDBOX = { ok: false, reason: "sandbox mode only" } as const;

/** The static milestone rows of the level snapshot (built once). */
export const LEVEL_ROWS: LevelRowSnap[] = levelRows();
