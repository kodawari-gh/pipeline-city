// Economy: placeholder balance config plus pure helpers (demand, reputation, payout, purchase catalog).
// No DOM. Every number that affects balance is in ECONOMY; see docs/GAME.md for how pacing was set.

import {
  BOARD_TIERS, boardFromJson, boardToJson, findDevices, getSpec, install, specsOfKind, uninstall, upgradeBoard,
  type Board, type DeviceKind, type DeviceSpec, type Result,
} from "../board";

export interface MixEntry {
  /** Template name for `generate()` ("cli" picks log/calc/checksum from the seed). */
  template: string;
  weight: number;
  /** Generator `scale` (more work and a bigger footprint), default 1. */
  scale?: number;
  /** Only offered while the installed RAM is at least this big (a bigger-RAM unlock). */
  minRamBytes: number;
  /** Payout multiplier for this kind of job (heavy memory-bound jobs pay more per instruction). Default 1. */
  payMul?: number;
  /** Onboarding ramp: the weight rises linearly from 0 to `weight` over this many base ticks. Default: no ramp. */
  rampTicks?: number;
}

/** PLACEHOLDER BALANCE. Tune by playing. */
export interface EconomyConfig {
  /**
   * CPU cycles per CPU "clock unit" per base tick. A CPU spec clock of 1 means 1 tick per base tick in the board
   * model; the game runs `cpuCyclesPerClock` real engine cycles per such tick (display clock is scaled the same
   * way). 1 tick = 1 s still holds for the world clock; this just says the toy CPU does 4 cycles per second.
   * Chosen so that the first request (about 22 instructions at 5 cycles each, about 110 cycles) takes ~30 s.
   */
  cpuCyclesPerClock: number;
  /** Request arrivals per base tick at reputation 1. */
  baseDemandPerTick: number;
  /** Turnaround (arrival to completion, base ticks) that counts as "just fine": reputation 1. */
  targetTurnaround: number;
  /** Smoothing of the turnaround moving average (weight of the newest completion). */
  emaAlpha: number;
  /** Reputation = clamp(target / averageTurnaround, repMin, repMax). Demand = baseDemand * reputation. */
  repMin: number;
  repMax: number;
  /**
   * Queue cap. When the queue is full a new arrival is dropped (counted in `dropped`, no penalty beyond the lost
   * job), so the queue is bounded and an under-provisioned machine shows a permanently full queue, long
   * turnarounds, and a falling reputation that shrinks demand.
   */
  queueCap: number;
  /** Dollars per instruction of work (reference instruction count of the program). */
  payPerInstr: number;
  /** Payout multiplier = clamp(targetTurnaround / turnaround, speedMin, speedMax). */
  speedMin: number;
  speedMax: number;
  /** Soft deadline: ticks after arrival. Finishing later multiplies the payout by lateFactor (still paid). */
  deadlineTicks: number;
  lateFactor: number;
  /** Requests already waiting at tick 0 (the guided first request). */
  startQueue: { template: string; scale?: number }[];
  /** Mix of templates for generated arrivals. */
  mix: MixEntry[];
  /** Device utilisation fed to the thermal model while no request is running. */
  idleLoad: number;
}

export const ECONOMY: EconomyConfig = {
  cpuCyclesPerClock: 4,
  baseDemandPerTick: 0.04,
  targetTurnaround: 60,
  emaAlpha: 0.3,
  repMin: 0.4,
  repMax: 4,
  queueCap: 10,
  payPerInstr: 1.2,
  speedMin: 0.5,
  speedMax: 2,
  deadlineTicks: 120,
  lateFactor: 0.5,
  startQueue: [{ template: "cli.log" }],
  mix: [
    { template: "cli", weight: 1, minRamBytes: 0 },
    { template: "cli.scan", scale: 1, weight: 0.5, minRamBytes: 0, payMul: 3, rampTicks: 300 },
  ],
  idleLoad: 0.1,
};

export function reputation(cfg: EconomyConfig, avgTurnaround: number): number {
  return Math.min(cfg.repMax, Math.max(cfg.repMin, cfg.targetTurnaround / Math.max(1, avgTurnaround)));
}

export function demandRate(cfg: EconomyConfig, rep: number): number {
  return cfg.baseDemandPerTick * rep;
}

/** Payout multiplier of a job kind: looked up from the mix by template and scale (1 if it is not in the mix). */
export function payMulFor(cfg: EconomyConfig, template: string, scale: number): number {
  return cfg.mix.find((m) => m.template === template && (m.scale ?? 1) === scale)?.payMul ?? 1;
}

export function payout(cfg: EconomyConfig, work: number, turnaround: number, late: boolean): number {
  const speed = Math.min(cfg.speedMax, Math.max(cfg.speedMin, cfg.targetTurnaround / Math.max(1, turnaround)));
  return Math.round(cfg.payPerInstr * work * speed * (late ? cfg.lateFactor : 1));
}

/** Pick a template from the mix that the installed RAM allows. */
export function pickTemplate(cfg: EconomyConfig, ramBytes: number, r: number, tick = Infinity): MixEntry {
  const ok = cfg.mix.filter((m) => m.minRamBytes <= ramBytes);
  const w = (m: MixEntry) => (m.rampTicks ? m.weight * Math.min(1, tick / m.rampTicks) : m.weight);
  const total = ok.reduce((s, m) => s + w(m), 0);
  let x = r * total;
  for (const m of ok) {
    if (x < w(m)) return m;
    x -= w(m);
  }
  return ok[ok.length - 1]!;
}

// ---------- purchases ----------

const BUYABLE: DeviceKind[] = ["cpu", "ram", "cooler", "psu"];

/**
 * Replace the installed part of the spec's kind with `specId`, going through board install/validation.
 * On any failure the board is restored exactly.
 */
export function swapPart(board: Board, specId: string): Result<object> {
  const spec = getSpec(specId);
  if (!spec) return { ok: false, reason: `unknown item "${specId}"` };
  const backup = boardToJson(board);
  const old = findDevices(board, spec.kind)[0];
  if (old) uninstall(board, old.id);
  const r = install(board, specId);
  if (!r.ok) {
    const b = boardFromJson(backup);
    board.devices = b.devices;
    board.nextId = b.nextId;
    return r;
  }
  return { ok: true };
}

/** Something the player can buy: a device spec id, or a board tier (`board1`). */
export interface Offer { id: string; name: string; kind: DeviceKind | "board"; price: number }

const BOARD_ID = /^board([0-9]+)$/;

/** Board tier of an offer id like "board1", or undefined for a device id. */
export function boardTierOf(id: string): number | undefined {
  const m = BOARD_ID.exec(id);
  return m ? Number(m[1]) : undefined;
}

export function offerPrice(id: string): number | undefined {
  const t = boardTierOf(id);
  return t !== undefined ? BOARD_TIERS[t]?.price : getSpec(id)?.price;
}

/** Buy an offer on a board: swap a part, or move to the bigger board (every device is carried over). */
export function applyOffer(board: Board, id: string): Result<object> {
  const t = boardTierOf(id);
  return t !== undefined ? upgradeBoard(board, t) : swapPart(board, id);
}

/** Offers that are an upgrade (higher tier than the installed part, next board tier) or a replacement of a burnt part. */
export function offers(board: Board): Offer[] {
  const out: Offer[] = [];
  const nextBoard = BOARD_TIERS[board.tier + 1];
  if (nextBoard) out.push({ id: `board${nextBoard.tier}`, name: nextBoard.name, kind: "board", price: nextBoard.price });
  for (const s of upgradeCandidates(board)) out.push({ id: s.id, name: s.name, kind: s.kind, price: s.price });
  return out;
}

/** Specs that would be an upgrade (higher tier than the installed part) or a replacement of a burnt part. */
function upgradeCandidates(board: Board): DeviceSpec[] {
  const out: DeviceSpec[] = [];
  for (const kind of BUYABLE) {
    const cur = findDevices(board, kind)[0];
    const curSpec = cur ? getSpec(cur.spec)! : undefined;
    for (const s of specsOfKind(kind)) {
      if (!curSpec || s.tier > curSpec.tier || (cur?.burnt && s.id === cur.spec)) out.push(s);
    }
  }
  return out;
}
