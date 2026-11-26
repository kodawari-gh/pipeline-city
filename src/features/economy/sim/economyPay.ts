// Economy pay helpers: demand, reputation, payout, SLA factor, contract hold/loss, and POST time.
// Config lives in economyConfig.ts.

import * as boardSim from '../../board/sim';
import type { EconomyConfig, MixEntry } from './economyConfig';

interface HoldPayOpts {
  cfg: EconomyConfig;
  kib: number;
  hot: boolean;
  mirrored: boolean;
  levelPay?: number;
}

/** Dollars per tick for holding `kib` KiB for a client: more for a hot contract, a bonus for mirrored storage, scaled by the level (`levelPay`). */
export function holdPay({ cfg, kib, hot, mirrored, levelPay = 1 }: HoldPayOpts): number {
  const c = cfg.contracts;
  return kib * c.holdPerKiBTick * (hot ? c.hotMul : 1) * (mirrored ? 1 + c.mirrorBonus : 1) * levelPay;
}

/** Dollars a missed read costs. */
export function readFee(cfg: EconomyConfig, hot: boolean, levelPay = 1): number {
  return Math.round(cfg.contracts.readFee * (hot ? cfg.contracts.hotMul : 1) * levelPay);
}

interface LossPenaltyOpts {
  cfg: EconomyConfig;
  kib: number;
  levelPay?: number;
  breach?: boolean;
}

/** Dollars lost data costs (a breach pays `breachShare` of it). */
export function lossPenalty({ cfg, kib, levelPay = 1, breach = false }: LossPenaltyOpts): number {
  const c = cfg.contracts;
  return Math.round(kib * c.lossPenaltyPerKiB * levelPay * (breach ? c.breachShare : 1));
}

/**
 * POST time of the machine as built: `base + min(kiBCap, perKiB * RAM KiB) + perStick * sticks + init of every working
 * device`, capped at `max` (the Starter machine comes to 3). The override `coldBootTicks` wins when defined.
 */
export function postTicks(cfg: EconomyConfig, board: boardSim.Board): number {
  if (cfg.coldBootTicks !== undefined) {
    return cfg.coldBootTicks;
  }
  const c = cfg.coldBoot;
  let kib = 0;
  let sticks = 0;
  let init = 0;
  for (const d of board.devices) {
    if (d.burnt === true) {
      continue;
    }
    const s = boardSim.deviceSpec(d);
    if (s.kind === 'ram') {
      kib += s.sizeBytes / 1024;
      sticks++;
    }
    init += c.init[s.id] ?? c.init[s.kind] ?? 0;
  }
  return Math.min(c.max, Math.round(c.base + Math.min(c.kiBCap, c.perKiB * kib) + c.perStick * sticks + init));
}

export function reputation(cfg: EconomyConfig, avgTurnaround: number, target = cfg.targetTurnaround): number {
  return Math.min(cfg.repMax, Math.max(cfg.repMin, target / Math.max(1, avgTurnaround)));
}

/** Arrivals per tick: the base rate times the level's demand multiplier times the reputation. */
export function demandRate(cfg: EconomyConfig, rep: number, demandMul = 1): number {
  return cfg.baseDemandPerTick * demandMul * rep;
}

/** Payout multiplier of a job kind in a test-override mix (1 if it is not in it). */
export function payMulFor(cfg: EconomyConfig, template: string, scale: number): number {
  return cfg.mix?.find((m) => m.template === template && (m.scale ?? 1) === scale)?.payMul ?? 1;
}

interface PayoutOpts {
  cfg: EconomyConfig;
  work: number;
  turnaround: number;
  late: boolean;
  levelPay?: number;
}

/** Payout after speed and lateness, times the level's pay multiplier (`levelPay`, 1 = level 1). */
export function payout({ cfg, work, turnaround, late, levelPay = 1 }: PayoutOpts): number {
  const speed = Math.min(cfg.speedMax, Math.max(cfg.speedMin, cfg.targetTurnaround / Math.max(1, turnaround)));
  return Math.round((cfg.payBase + cfg.payPerInstr * work) * speed * (late ? cfg.lateFactor : 1) * levelPay);
}

interface SlaFactorOpts {
  cfg: EconomyConfig;
  turnaround: number;
  slaTicks: number;
  deadlineTicks: number;
}

/**
 * The pay factor of a job with a latency SLA (docs/NETWORK.md "Web jobs"): 1 when delivered within `slaTicks` of arrival,
 * falling in a straight line to `lateFactor` at the deadline and staying there after it. It replaces the late factor of
 * `payout` for such a job (pass `late = false` there), so the pay is continuous across the deadline.
 */
export function slaFactor({ cfg, turnaround, slaTicks, deadlineTicks }: SlaFactorOpts): number {
  if (turnaround <= slaTicks) {
    return 1;
  }
  if (turnaround >= deadlineTicks || deadlineTicks <= slaTicks) {
    return cfg.lateFactor;
  }
  return 1 - (1 - cfg.lateFactor) * ((turnaround - slaTicks) / (deadlineTicks - slaTicks));
}

interface PickTemplateOpts {
  mix: MixEntry[];
  ramBytes: number;
  r: number;
  tick?: number;
}

/** Pick a template from the test-override mix that the installed RAM allows. */
export function pickTemplate({ mix, ramBytes, r, tick = Infinity }: PickTemplateOpts): MixEntry {
  const ok = mix.filter((m) => m.minRamBytes <= ramBytes);
  const w = (m: MixEntry): number =>
    m.rampTicks !== undefined && m.rampTicks !== 0 ? m.weight * Math.min(1, tick / m.rampTicks) : m.weight;
  const total = ok.reduce((s, m) => s + w(m), 0);
  let x = r * total;
  for (const m of ok) {
    if (x < w(m)) {
      return m;
    }
    x -= w(m);
  }
  const last = ok.at(-1);
  if (last === undefined) {
    throw new Error('mix is empty');
  }
  return last;
}
