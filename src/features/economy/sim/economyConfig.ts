// Economy config: every number that affects balance lives in ECONOMY; see docs/GAME.md for how pacing was set.
// Types and the constant only. Pay helpers are in economyPay.ts; the purchase catalog is in economyCatalog.ts.

import { NET } from '../../network/sim';

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
interface ColdBootConfig {
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
  mix?: MixEntry[] | undefined;
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
   * An extra chance that the wire loses a segment of a download (docs/NETSTACK.md "The transport"), on top of what the parts lose (`lossTable`). 0 (the default) adds none. The NIC's ring
   * overflowing and the kernel having no free slot lose segments whatever this says. Tests set it to watch the transport send again.
   */
  wireLoss: number;
  /**
   * The loss the parts of the link make (docs/NETSTACK.md 3.5): the ISP plan's line, the router and a card that has gone unstable from heat. Default true. `false` leaves only `wireLoss`:
   * the tests that pin a transfer to the tick use it.
   */
  lossTable: boolean;
  /**
   * The power bill (docs/GAME.md "The power bill"): dollars per Wh the wall gives the machine (a flat rate; game scale, not the real tariff).
   * 0 (the default) switches the bill off, as the tests and bots need; a new campaign is given `CAMPAIGN_POWER_RATE`. The sandbox has no bill.
   */
  powerRatePerWh: number;
  /** Base ticks between bills, from the first power-on. */
  billPeriodTicks: number;
  /** Base ticks an unpaid bill waits before the power company cuts the wall (it is paid by itself the moment the money is there). */
  billGraceTicks: number;
  /** Cloud-storage contracts (docs/JOBS.md "Contracts"). All numbers are placeholders. */
  contracts: ContractEconomy;
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
  startQueue: [{ template: 'cli.log' }],
  idleLoad: 0.1,
  memoryFlipRate: 0.00005,
  startMoney: 0,
  giveUpTurnaround: 180,
  payBase: 20,
  usbEnumTicks: 3,
  usbFlashTicks: 2,
  coldBoot: {
    base: 1,
    perKiB: 0.05,
    kiBCap: 3,
    perStick: 0.5,
    max: 8,
    init: { cpu: 0.5, display: 0.5, hdd0: 1, ssd1: 0.5, nvme2: 0.25, raid2: 0.25 },
  },
  firmwareBoost: 12,
  osBootBoost: 48,
  autoEjectTicks: 3,
  levelGating: true,
  caseGating: true,
  usbFallbackTicks: NET.usbFallbackTicks,
  usbFallbackMul: NET.usbFallbackMul,
  retireUsbKeys: true,
  wireLoss: 0,
  lossTable: true,
  powerRatePerWh: 0,
  billPeriodTicks: 600,
  billGraceTicks: 120,
  contracts: {
    offerEvery: 240,
    offerCap: 3,
    offerTtl: 1500,
    holdPerKiBTick: 0.012,
    hotMul: 2.5,
    mirrorBonus: 0.5,
    completeBonus: 0.15,
    readFee: 6,
    lossPenaltyPerKiB: 12,
    breachShare: 0.5,
    lossRepUnits: 1,
    breachRepUnits: 0.5,
  },
};

/** The money side of cloud-storage contracts, in dollars at level 1 (the level's pay multiplier scales it). */
interface ContractEconomy {
  /** Base ticks between rolls for a new offer, the open offers kept at most, and how long an unanswered offer stays (it then goes away, never a penalty). */
  offerEvery: number;
  offerCap: number;
  offerTtl: number;
  /** Dollars per KiB held per tick, the multiplier for a hot (SSD) contract, the extra for data held on mirrored storage, and the bonus at the end as a share of what was earned. */
  holdPerKiBTick: number;
  hotMul: number;
  mirrorBonus: number;
  completeBonus: number;
  /** Fee for a read that was not served (a hot contract pays `hotMul` times more), and the loss penalty per KiB of lost data. */
  readFee: number;
  lossPenaltyPerKiB: number;
  /** The share of the loss penalty a breach costs, and the reputation each costs in units of a client giving up (an expired key is 1). */
  breachShare: number;
  lossRepUnits: number;
  breachRepUnits: number;
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
