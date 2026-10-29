// Economy: placeholder balance config plus pure helpers (demand, reputation, payout, purchase catalog).
// No DOM. Every number that affects balance is in ECONOMY; see docs/GAME.md for how pacing was set.

import { getIspSpec, getRouterSpec, NET } from "../net";
import { getOsSpec } from "../os";
import {
  BOARD_TIERS, CASE_TIERS, caseFor, deviceSpec, getSpec, specsOfKind,
  type Board, type DeviceKind, type RamSpec,
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

/** POST (cold boot) time as a function of the machine (docs/PROGRESSION.md "POST time"). PLACEHOLDER BALANCE. */
export interface ColdBootConfig {
  base: number;
  /** Ticks per KiB of installed RAM, capped at `kiBCap` ticks in total. */
  perKiB: number;
  kiBCap: number;
  perStick: number;
  /** Hard cap of the whole formula. */
  max: number;
  /** Init ticks per installed device, by spec id (wins) or by kind. */
  init: Record<string, number>;
}

export interface EconomyConfig {
  /**
   * CPU cycles per CPU "clock unit" per base tick. A CPU spec clock of 1 means 1 tick per base tick in the board
   * model; the game runs `cpuCyclesPerClock` real engine cycles per such tick (display clock is scaled the same
   * way). 1 tick = 1 s still holds for the world clock; this just says the starting toy CPU does 36 cycles per
   * second. Chosen so that the first job (boot ROM ~320 instructions at 5 cycles each, about 1600 cycles) takes
   * about 45 s from power-on to the result on the key.
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
  /**
   * TEST OVERRIDE: a fixed template mix for generated arrivals. Undefined (the default) means the level-driven job
   * classes of levels.ts (docs/PROGRESSION.md "arrival mix").
   */
  mix?: MixEntry[];
  /** Device utilisation fed to the thermal model while the machine is idle (waiting for a key, or showing REMOVE KEY). */
  idleLoad: number;
  /**
   * Chance per base tick that a bit flips in the memory the running job uses (cosmic rays, heat). ECC RAM corrects it (counted); other RAM keeps it and the
   * job may crash or answer wrongly. 0 (the default) switches it off: the rate is a balance decision still to be made (docs/RAM.md "ECC").
   */
  memoryFlipRate: number;
  /** Dollars a game starts with in the sim itself (0: the tests and bots depend on it; a new campaign is given `CAMPAIGN_START_MONEY`). */
  startMoney: number;
  /**
   * What a key the client had to take back (tray full) counts as in the turnaround average, so overflow costs
   * reputation. Should be well past `targetTurnaround`.
   */
  giveUpTurnaround: number;
  /** Flat dollars per job, on top of `payPerInstr * work`: covers the boot and the manual plug/unplug. */
  payBase: number;
  /**
   * USB latency under an OS (base ticks): a plugged key needs this long to enumerate before the kernel may read it,
   * and a result needs `usbFlashTicks` to land on the key. Without an OS both are 0. The network source removes them.
   */
  usbEnumTicks: number;
  usbFlashTicks: number;
  /**
   * Cold-boot hardware delay (base ticks) as a function of the machine: PSU power-good, fans, BIOS init and counting the
   * RAM take this long before the CPU runs the first ROM instruction (the monitor stays black). A faster CPU does not
   * shorten it, so the no-OS loop (one cold boot per job) has a fixed cost per job that an OS (one cold boot) does not pay.
   */
  coldBoot: ColdBootConfig;
  /** Override: when defined it replaces the `coldBoot` function with this fixed number of ticks (tests use 0). */
  coldBootTicks?: number;
  /**
   * Firmware clock boost: while the boot ROM runs its own phases (POST, loading a key, writing the result, loading the OS
   * kernel) the CPU and storage run this many times faster than the job does. Real firmware is not the workload; without
   * this a first boot takes most of a minute. 1 turns it off (tests that measure raw cycles use that).
   */
  firmwareBoost: number;
  /** The same for loading the OS kernel from the drive (the player waits for this one on every cold start). */
  osBootBoost: number;
  /**
   * Without an OS the player no longer pulls the finished key out by hand: this many base ticks after the job's JOB DONE
   * message the key ejects itself and pays (the manual loop keeps its other chores: plugging in, power cycling). With an OS
   * the collect-and-remove flow is unchanged. 0 turns it off (tests of the manual removal use that).
   */
  autoEjectTicks: number;
  /**
   * Gate purchases by player level (docs/PROGRESSION.md "Unlock table"). Default true; tests that buy everything switch it
   * off. The sandbox never gates.
   */
  levelGating: boolean;
  /**
   * A board needs a case that holds it (docs/BOARD.md "Cases"): a bigger board is refused until the player owns a bigger case.
   * Default true; tests of the sim that do not care switch it off (the case then follows the board). The sandbox never gates.
   */
  caseGating: boolean;
  /** Network (docs/NETWORK.md "USB fallback"): dead-link ticks before keys come back, and their rate share then. */
  usbFallbackTicks: number;
  usbFallbackMul: number;
  /**
   * Retired keys (docs/NETWORK.md "Retired keys"): the USB keys the client left behind when the link comes up do not hold
   * reputation, expire silently and cost nothing to decline. Default true. `false` reproduces the old behaviour (tests use
   * it for the before and after comparison only).
   */
  retireUsbKeys: boolean;
  /**
   * The power bill (docs/GAME.md "The power bill"): dollars per Wh the wall gives the machine (a flat rate; game scale, not the real tariff).
   * 0 (the default) switches the bill off, as the tests and bots need; a new campaign is given `CAMPAIGN_POWER_RATE`. The sandbox has no bill.
   */
  powerRatePerWh: number;
  /** Base ticks between bills, from the first power-on. */
  billPeriodTicks: number;
  /** Base ticks an unpaid bill waits before the power company cuts the wall (it is paid by itself the moment the money is there). */
  billGraceTicks: number;
}

export const ECONOMY: EconomyConfig = {
  cpuCyclesPerClock: 36,
  baseDemandPerTick: 0.02,
  targetTurnaround: 60,
  emaAlpha: 0.3,
  repMin: 0.4,
  repMax: 4,
  queueCap: 10,
  payPerInstr: 1.2,
  speedMin: 0.5,
  speedMax: 2,
  deadlineTicks: 180,
  lateFactor: 0.5,
  startQueue: [{ template: "cli.log" }],
  idleLoad: 0.1,
  memoryFlipRate: 0.00005,
  startMoney: 0,
  giveUpTurnaround: 180,
  payBase: 20,
  usbEnumTicks: 3,
  usbFlashTicks: 2,
  coldBoot: { base: 1, perKiB: 0.05, kiBCap: 3, perStick: 0.5, max: 8, init: { cpu: 0.5, display: 0.5, hdd0: 1, ssd1: 0.5, nvme2: 0.25 } },
  firmwareBoost: 12,
  osBootBoost: 48,
  autoEjectTicks: 3,
  levelGating: true,
  caseGating: true,
  usbFallbackTicks: NET.usbFallbackTicks,
  usbFallbackMul: NET.usbFallbackMul,
  retireUsbKeys: true,
  powerRatePerWh: 0,
  billPeriodTicks: 600,
  billGraceTicks: 120,
};

/**
 * POST time of the machine as built: `base + min(kiBCap, perKiB * RAM KiB) + perStick * sticks + init of every working
 * device`, capped at `max` (the Starter machine comes to 3). The override `coldBootTicks` wins when defined.
 */
export function postTicks(cfg: EconomyConfig, board: Board): number {
  if (cfg.coldBootTicks !== undefined) return cfg.coldBootTicks;
  const c = cfg.coldBoot;
  let kib = 0;
  let sticks = 0;
  let init = 0;
  for (const d of board.devices) {
    if (d.burnt) continue;
    const s = deviceSpec(d);
    if (s.kind === "ram") {
      kib += (s as RamSpec).sizeBytes / 1024;
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

/** Payout after speed and lateness, times the level's pay multiplier (`levelPay`, 1 = level 1). */
export function payout(cfg: EconomyConfig, work: number, turnaround: number, late: boolean, levelPay = 1): number {
  const speed = Math.min(cfg.speedMax, Math.max(cfg.speedMin, cfg.targetTurnaround / Math.max(1, turnaround)));
  return Math.round((cfg.payBase + cfg.payPerInstr * work) * speed * (late ? cfg.lateFactor : 1) * levelPay);
}

/**
 * The pay factor of a job with a latency SLA (docs/NETWORK.md "Web jobs"): 1 when delivered within `slaTicks` of arrival,
 * falling in a straight line to `lateFactor` at the deadline and staying there after it. It replaces the late factor of
 * `payout` for such a job (pass `late = false` there), so the pay is continuous across the deadline.
 */
export function slaFactor(cfg: EconomyConfig, turnaround: number, slaTicks: number, deadlineTicks: number): number {
  if (turnaround <= slaTicks) return 1;
  if (turnaround >= deadlineTicks || deadlineTicks <= slaTicks) return cfg.lateFactor;
  return 1 - (1 - cfg.lateFactor) * ((turnaround - slaTicks) / (deadlineTicks - slaTicks));
}

/** Pick a template from the test-override mix that the installed RAM allows. */
export function pickTemplate(mix: MixEntry[], ramBytes: number, r: number, tick = Infinity): MixEntry {
  const ok = mix.filter((m) => m.minRamBytes <= ramBytes);
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

/** Every kind of device the shop sells. */
const DEVICE_KINDS: DeviceKind[] = ["cpu", "ram", "psu", "cooler", "display", "storage", "vrm-sink", "ram-sink", "nic", "gpu", "npu", "tpm"];

/** Something the player can buy: a device spec id, or a board tier (`board1`). */
export interface Offer { id: string; name: string; kind: DeviceKind | "board" | "case"; price: number }

const BOARD_ID = /^board([0-9]+)$/;
const CASE_ID = /^case([0-9]+)$/;

/** Case tier of an offer id like "case1", or undefined. */
export function caseTierOf(id: string): number | undefined {
  const m = CASE_ID.exec(id);
  return m ? Number(m[1]) : undefined;
}

/** Board tier of an offer id like "board1", or undefined for a device id. */
export function boardTierOf(id: string): number | undefined {
  const m = BOARD_ID.exec(id);
  return m ? Number(m[1]) : undefined;
}

export function offerPrice(id: string): number | undefined {
  const t = boardTierOf(id), c = caseTierOf(id);
  if (c !== undefined) return CASE_TIERS[c]?.price;
  return t !== undefined ? BOARD_TIERS[t]?.price : (getSpec(id)?.price ?? getOsSpec(id)?.price ?? getRouterSpec(id)?.price ?? getIspSpec(id)?.price);
}

/** Selling a spare part back returns this share of its list price: the rest is lost (docs/GAME.md "Selling"). */
export const SELL_RATE = 0.8;

/** What a spare is worth when sold, in whole dollars: `SELL_RATE` of the price the shop asks (the starter crate's free parts count as the `SPARE_FLOOR`). */
export const sellValue = (spec: string): number => Math.floor(Math.max(offerPrice(spec) ?? 0, SPARE_FLOOR) * SELL_RATE);

/** Why a board of this tier cannot go into the board's case. */
export const caseTooSmall = (board: Board, boardTier: number): string =>
  `the ${CASE_TIERS[board.caseTier]?.name ?? "case"} is too small for a ${BOARD_TIERS[boardTier]?.name ?? "bigger"} board: buy a ${CASE_TIERS[caseFor(boardTier)]?.name ?? "bigger case"} first`;

/** The cheapest a spare costs: the starter crate's parts are free to receive but not to buy again. */
export const SPARE_FLOOR = 10;

/**
 * Everything the shop sells, in a campaign and in the sandbox: every board tier, every case tier and every device spec, whatever is
 * fitted and however many are owned (spares, downgrades, a second machine). Nothing here asks whether it fits: the inventory says
 * what a part can go into (`reason`), and the level gate (`levelLock`) is the game's only restriction.
 */
export function catalog(): Offer[] {
  const out: Offer[] = [];
  const at = (price: number) => Math.max(price, SPARE_FLOOR);
  for (const t of BOARD_TIERS) out.push({ id: `board${t.tier}`, name: t.name, kind: "board", price: at(t.price) });
  for (const c of CASE_TIERS) out.push({ id: `case${c.tier}`, name: c.name, kind: "case", price: at(c.price) });
  for (const kind of DEVICE_KINDS) for (const s of specsOfKind(kind)) out.push({ id: s.id, name: s.name, kind: s.kind, price: at(s.price) });
  return out;
}

/** The constant the sandbox shows as "money": the player never spends or earns (the UI shows an infinity symbol). */
export const SANDBOX_MONEY = 1_000_000_000;

/**
 * What a new campaign starts with: enough to buy nearly everything the tutorial asks for (about $490), so a new player is
 * never held up by money while learning. Someone who does not understand a part does not spend on it anyway.
 */
export const CAMPAIGN_START_MONEY = 600;

/** A new campaign's power rate ($ per Wh): a 54 W machine pays about $2 per 10-minute bill, a few percent of what it earns (a placeholder). */
export const CAMPAIGN_POWER_RATE = 0.15;
