// Save format: versioned plain JSON, config only (no pipeline, registers or RAM). See docs/SAVE.md.
// No DOM imports; used by the worker and by the main thread (to validate imports).

import { boardFromJson, type BoardJson } from "../board";
import { offerPrice } from "./economy";
import { TEMPLATES } from "../gen";

export const SAVE_VERSION = 1;

/** A request as seeds/params only; the program is regenerated on load. */
export interface SavedRequest {
  id: number;
  template: string;
  seed: number;
  scale: number;
  arrival: number;
  deadline: number;
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

export interface SaveV1 {
  version: 1;
  /** Seed the machine was created with (kept for reference; the live stream is `prngState`). */
  seed: number;
  /** Machine PRNG state (one uint32). */
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
  /** Bought but not yet applied (a request was running). */
  pending: string[];
  /** Waiting requests, in order. */
  queue: SavedRequest[];
  /** In-flight request; restarts from its first instruction on load. */
  current: (SavedRequest & { startTick: number; attempts: number }) | null;
  /** PSU hard trip flag. Temperatures and wear restart at ambient/zero. */
  tripped: boolean;
}

export type Save = SaveV1;

/** Chain of upgrades: MIGRATIONS[n] turns a version-n save into version n+1. Empty while v1 is current. */
const MIGRATIONS: Record<number, (s: any) => any> = {};

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
export function parseSave(input: unknown): SaveV1 {
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
  num("money"); int("baseTick"); int("nextReqId", 1); int("completed"); int("errors"); int("dropped"); num("avgTurnaround", 1e-9);
  if (typeof s.tripped !== "boolean") throw new Error('save: "tripped" must be a boolean');
  if (!isObj(s.board)) throw new Error('save: "board" missing');
  try {
    boardFromJson(s.board as unknown as BoardJson);
  } catch (e) {
    throw new Error(`save: invalid board (${(e as Error).message})`);
  }
  if (!Array.isArray(s.pending) || s.pending.some((p) => typeof p !== "string" || offerPrice(p) === undefined)) {
    throw new Error('save: "pending" must be a list of known item ids');
  }
  if (!Array.isArray(s.queue)) throw new Error('save: "queue" must be an array');
  s.queue.forEach((r, i) => checkRequest(r, `queue[${i}]`));
  if (s.current !== null) {
    checkRequest(s.current, "current");
    const c = s.current as Record<string, unknown>;
    if (!isNat(c.startTick) || !isNat(c.attempts)) throw new Error('save: "current" needs startTick and attempts');
  }
  if (s.lastCompleted !== null && !isObj(s.lastCompleted)) throw new Error('save: "lastCompleted" must be an object or null');
  return s as unknown as SaveV1;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNat = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

function checkRequest(r: unknown, where: string): void {
  if (!isObj(r)) throw new Error(`save: ${where} must be an object`);
  if (typeof r.template !== "string" || !(r.template in TEMPLATES)) throw new Error(`save: ${where} has unknown template "${String(r.template)}"`);
  for (const k of ["id", "seed", "scale", "arrival", "deadline"]) {
    if (!isNat(r[k])) throw new Error(`save: ${where}.${k} must be a non-negative integer`);
  }
  if ((r.scale as number) < 1 || (r.scale as number) > 16) throw new Error(`save: ${where}.scale out of range`);
}
