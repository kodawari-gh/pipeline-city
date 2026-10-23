// Save format: versioned plain JSON, config only (no pipeline, registers or RAM). See docs/SAVE.md.
// No DOM imports; used by the worker and by the main thread (to validate imports).

import { boardFromJson, CABLE_IDS, type BoardJson, type Cables } from "../board";
import { offerPrice } from "./economy";
import { TEMPLATES } from "../gen";

export const SAVE_VERSION = 2;

/** A key (job) as seeds/params only; the program is regenerated on load. */
export interface SavedKey {
  id: number;
  template: string;
  seed: number;
  scale: number;
  arrival: number;
  deadline: number;
}

export interface SavedPlugged extends SavedKey {
  attempts: number;
  /** Tick it was plugged in. */
  pluggedAt: number;
  /** The key already holds its result (waiting to be removed). */
  done: boolean;
  /** Tick the result was written (0 if not done). */
  doneAt: number;
  result: string;
}

export interface SavedCompleted {
  id: number;
  template: string;
  payout: number;
  turnaround: number;
  execTicks: number;
  late: boolean;
  attempts: number;
  completedAt: number;
}

/** Tutorial milestones, sticky once true. See docs/ASSEMBLY.md. */
export interface Progress {
  cpuInstalled: boolean;
  psuInstalled: boolean;
  ramInstalled: boolean;
  monitorInstalled: boolean;
  atxConnected: boolean;
  cpuPowerConnected: boolean;
  videoConnected: boolean;
  poweredOn: boolean;
  firstKeyPlugged: boolean;
  firstJobDone: boolean;
  firstKeyEjected: boolean;
  firstPurchase: boolean;
}

export const PROGRESS_KEYS: readonly (keyof Progress)[] = [
  "cpuInstalled", "psuInstalled", "ramInstalled", "monitorInstalled", "atxConnected", "cpuPowerConnected",
  "videoConnected", "poweredOn", "firstKeyPlugged", "firstJobDone", "firstKeyEjected", "firstPurchase",
];

export const newProgress = (all = false): Progress =>
  Object.fromEntries(PROGRESS_KEYS.map((k) => [k, all])) as unknown as Progress;

export interface SavedInventoryItem {
  id: string;
  spec: string;
}

export interface SaveV2 {
  version: 2;
  /** Seed the machine was created with (kept for reference; the live stream is `prngState`). */
  seed: number;
  /** Machine PRNG state (one uint32). */
  prngState: number;
  money: number;
  baseTick: number;
  nextKeyId: number;
  completed: number;
  errors: number;
  dropped: number;
  avgTurnaround: number;
  lastCompleted: SavedCompleted | null;
  /** Installed parts. */
  board: BoardJson;
  /** Owned, not installed: device spec ids or a board tier id like `board1`. */
  inventory: SavedInventoryItem[];
  nextInvId: number;
  cables: Cables;
  /** Keys lying in the tray, oldest first. */
  tray: SavedKey[];
  /** The key in the USB port. A job in progress restarts from boot on load (the machine loads powered off). */
  plugged: SavedPlugged | null;
  /** PSU hard trip flag. Temperatures and wear restart at ambient/zero. */
  tripped: boolean;
  progress: Progress;
}

export type Save = SaveV2;

/** The shape before the USB keys (v1). Only the migration reads it. */
export interface SaveV1 {
  version: 1;
  seed: number;
  prngState: number;
  money: number;
  baseTick: number;
  nextReqId: number;
  completed: number;
  errors: number;
  dropped: number;
  avgTurnaround: number;
  lastCompleted: SavedCompleted | null;
  board: BoardJson;
  pending: string[];
  queue: SavedKey[];
  current: (SavedKey & { startTick: number; attempts: number }) | null;
  tripped: boolean;
}

/** Chain of upgrades: MIGRATIONS[n] turns a version-n save into version n+1. */
const MIGRATIONS: Record<number, (s: any) => any> = {
  /**
   * v1 -> v2: the machine becomes fully assembled and powered off with every cable connected; the queue (and the
   * in-flight request, first) becomes keys in the tray; purchases that were waiting for the board become
   * inventory (the money was already spent). Money, reputation, PRNG and counters are kept.
   */
  1: (s: SaveV1): SaveV2 => {
    if (!isObj(s.board) || !Array.isArray(s.queue) || !Array.isArray(s.pending)) throw new Error("save: not a valid version 1 save");
    const strip = (k: SavedKey): SavedKey => ({ id: k.id, template: k.template, seed: k.seed, scale: k.scale, arrival: k.arrival, deadline: k.deadline });
    const keys = [...(s.current ? [strip(s.current)] : []), ...s.queue.map(strip)].sort((a, b) => a.id - b.id);
    return {
      version: 2,
      seed: s.seed, prngState: s.prngState, money: s.money, baseTick: s.baseTick, nextKeyId: s.nextReqId,
      completed: s.completed, errors: s.errors, dropped: s.dropped, avgTurnaround: s.avgTurnaround,
      lastCompleted: s.lastCompleted,
      board: s.board,
      inventory: s.pending.map((spec, i) => ({ id: `inv${i + 1}`, spec })),
      nextInvId: s.pending.length + 1,
      cables: { atx: true, cpu: true, video: true },
      tray: keys,
      plugged: null,
      tripped: s.tripped,
      progress: newProgress(true),
    };
  },
};

/** Bring any known older save up to the current version. Identity for current-version saves. */
export function migrate(save: unknown): unknown {
  if (!isObj(save)) throw new Error("save: not an object");
  const ver = save.version;
  if (typeof ver !== "number" || !Number.isInteger(ver)) throw new Error("save: missing or invalid version");
  let v: number = ver;
  if (v > SAVE_VERSION) throw new Error(`save: version ${v} is newer than this game supports (${SAVE_VERSION})`);
  if (v < 1) throw new Error(`save: unknown version ${v}`);
  let s: any = save;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`save: no migration from version ${v}`);
    s = step(s);
    v = s.version;
  }
  return s;
}

/** Migrate and validate untrusted input (parsed JSON). Throws Error with a clear message. */
export function parseSave(input: unknown): SaveV2 {
  const s = migrate(input) as Record<string, unknown>;
  const num = (k: string, min = 0): number => {
    const x = s[k];
    if (typeof x !== "number" || !Number.isFinite(x) || x < min) throw new Error(`save: "${k}" must be a number >= ${min}`);
    return x;
  };
  const int = (k: string, min = 0): number => {
    const x = num(k, min);
    if (!Number.isInteger(x)) throw new Error(`save: "${k}" must be an integer`);
    return x;
  };
  int("seed");
  if (int("prngState") > 0xffffffff) throw new Error('save: "prngState" must be a uint32');
  num("money"); int("baseTick"); int("nextKeyId", 1); int("completed"); int("errors"); int("dropped"); num("avgTurnaround", 1e-9);
  int("nextInvId", 1);
  if (typeof s.tripped !== "boolean") throw new Error('save: "tripped" must be a boolean');
  if (!isObj(s.board)) throw new Error('save: "board" missing');
  try {
    boardFromJson(s.board as unknown as BoardJson);
  } catch (e) {
    throw new Error(`save: invalid board (${(e as Error).message})`);
  }
  if (!Array.isArray(s.inventory) || s.inventory.some((p) => !isObj(p) || typeof p.id !== "string" || typeof p.spec !== "string" || offerPrice(p.spec) === undefined)) {
    throw new Error('save: "inventory" must be a list of {id, spec} with known item ids');
  }
  if (!isObj(s.cables) || CABLE_IDS.some((c) => typeof (s.cables as Record<string, unknown>)[c] !== "boolean")) {
    throw new Error('save: "cables" must say whether each cable is connected');
  }
  if (!isObj(s.progress) || PROGRESS_KEYS.some((k) => typeof (s.progress as Record<string, unknown>)[k] !== "boolean")) {
    throw new Error('save: "progress" must be a list of boolean milestones');
  }
  if (!Array.isArray(s.tray)) throw new Error('save: "tray" must be an array');
  s.tray.forEach((r, i) => checkKey(r, `tray[${i}]`));
  if (s.plugged !== null) {
    checkKey(s.plugged, "plugged");
    const c = s.plugged as Record<string, unknown>;
    if (!isNat(c.attempts) || !isNat(c.pluggedAt) || !isNat(c.doneAt) || typeof c.done !== "boolean" || typeof c.result !== "string") {
      throw new Error('save: "plugged" needs attempts, pluggedAt, doneAt, done and result');
    }
  }
  if (s.lastCompleted !== null && !isObj(s.lastCompleted)) throw new Error('save: "lastCompleted" must be an object or null');
  return s as unknown as SaveV2;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNat = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

function checkKey(r: unknown, where: string): void {
  if (!isObj(r)) throw new Error(`save: ${where} must be an object`);
  if (typeof r.template !== "string" || !(r.template in TEMPLATES)) throw new Error(`save: ${where} has unknown template "${String(r.template)}"`);
  for (const k of ["id", "seed", "scale", "arrival", "deadline"]) {
    if (!isNat(r[k])) throw new Error(`save: ${where}.${k} must be a non-negative integer`);
  }
  if ((r.scale as number) < 1 || (r.scale as number) > 16) throw new Error(`save: ${where}.scale out of range`);
}
