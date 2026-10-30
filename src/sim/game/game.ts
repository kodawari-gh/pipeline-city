// Headless game loop: one Machine + Board + ThermalModel + PCH + USB key tray + economy.
// Deterministic: all randomness comes from the machine PRNG. No DOM. See docs/GAME.md and docs/ASSEMBLY.md.
//
// The player builds the machine (install parts from the inventory, connect cables) and serves clients one USB key at a
// time. Without an OS: plug a key while the machine is off, press power; after POST the ROM looks at the USB port once,
// loads the key's program, runs it, writes the result back and halts; remove the key to get paid, power off and on for
// the next job. Parts and cables can only change while the machine is off.
//
// This file holds the game's state and constructor. The behaviour is split by feature into the files below: each one
// exports plain functions written as `function name(this: Game, ...)`, and every export becomes a method of `Game`
// (mixed into the prototype at the bottom). A feature file therefore imports `Game` as a type only, calls the other
// features through `this`, and never imports another feature file. Add a method by exporting it from the feature it
// belongs to; a helper that is not a method must not be exported.
//
//   parts      install and uninstall, cables, the inventory, clocks, the sandbox's maximum rig
//   shop       buying, selling, prices and the level gate
//   sandbox    the sandbox tools
//   machine    power, cold boot, phases, clock rates, the base tick
//   bill       the power bill: the rate on the metered energy, auto-pay, the wall cut for an unpaid bill
//   keys       the USB key's life: plug, eject, pay, decline; the job log and almanac entries
//   clients    arrivals, what the machine can offer a job, reputation, client base, level, patience
//   hardware   drives, GPU / NPU / TPM ports, ECC, MMU, the memory the sticks add up to
//   os         the OS on its drive, the kernel's job table, OS and storage snapshots
//   memory     RAM map and regions, page tracking, bit flips, faults, the health panel
//   network    link state, transfers, the NIC feed into the kernel, the network snapshot
//   snapshot   the snapshot the worker posts every tick
//   persist    the save and its restore

import {
  allCables, createBoard, machineConfigFor, noCables, ThermalModel,
  type Board, type Cables,
} from "../board";
import { Disk, GpuPort, Machine, NpuPort, StoragePort, TpmPort } from "../machine";
import { Prng } from "../machine/prng";
import { GPU_PORTS, NPU_PORTS, STORAGE_PORTS } from "../isa/memmap";
import { NetworkSource } from "../net";
import { Pch, type PchKey } from "../pch";
import * as bill from "./bill";
import * as clients from "./clients";
import { ECONOMY, SANDBOX_MONEY, type EconomyConfig } from "./economy";
import * as hardware from "./hardware";
import {
  MACHINE_RAM_BYTES, SANDBOX_LEVEL, LOG_CAP,
  type DriveMount, type InstalledOs, type InvItem, type Key, type Link, type NetKey, type Transfer,
} from "./internal";
import type { DexRecord } from "./jobdex";
import type { JobLogEntry } from "./joblog";
import * as keys from "./keys";
import { LEVELS, MAX_LEVEL, type ItemInfo, type JobClassId } from "./levels";
import * as machine from "./machine";
import * as memory from "./memory";
import * as network from "./network";
import * as os from "./os";
import * as parts from "./parts";
import * as persist from "./persist";
import { TRACE_CYCLES } from "./pipesnap";
import * as sandbox from "./sandbox";
import { newProgress, parseSave, PROGRESS_KEYS, type Progress } from "./save";
import * as shop from "./shop";
import * as snapshot from "./snapshot";
import type { CompletedInfo, GameEvent, GameOptions } from "./types";
import { UsbTray } from "./work";

export * from "./types";
export type { GameOptions };

/** The feature files' exports, which `Game` has as methods. */
type Features = typeof parts & typeof shop & typeof sandbox & typeof machine & typeof bill & typeof keys & typeof clients
  & typeof hardware & typeof os & typeof memory & typeof network & typeof snapshot & typeof persist;
export interface Game extends Features {}

// The fields below are the state the feature files share, so none is private.
export class Game {
  readonly cfg: EconomyConfig;
  readonly machine: Machine;
  readonly thermal: ThermalModel;
  readonly pch: Pch;
  board: Board;
  cables: Cables = noCables();
  /** Energy taken from the wall in W x ticks (a tick is a game second): metered while the machine is on. */
  wattTicks = 0;
  /** What the wall is giving the machine this tick (W), kept for the snapshot. */
  wallW = 0;
  /** The power bill (bill.ts): energy already on a bill (Wh), the tick the next one is issued, dollars issued and unpaid (and since when), the wall cut for them, dollars paid so far, the last bill. */
  billedWh = 0;
  nextBillTick: number | null = null;
  unpaid = 0;
  unpaidSince: number | null = null;
  powerCut = false;
  billPaid = 0;
  lastBill: { tick: number; wh: number; amount: number } | null = null;
  progress: Progress = newProgress();

  money = 0;
  baseTick = 0;
  completed = 0;
  errors = 0;
  /** Memory faults the OS has handled, and how many the MPU had counted at the last check. */
  faults = 0;
  mpuSeen = 0;
  eccCorrected = 0;
  bitFlips = 0;
  readonly flipRng: Prng;
  dropped = 0;
  lastCompleted: CompletedInfo | null = null;
  powered = false;
  /** Sandbox game: free purchases, the sandbox tools work. */
  readonly sandbox: boolean;

  inventory: InvItem[] = [];
  nextInvId = 1;
  readonly tray: UsbTray<Key>;
  plugged: Key | null = null;
  readonly ports: StoragePort[] = STORAGE_PORTS.map((slot, i) => new StoragePort(slot, i));
  tpm!: TpmPort;
  readonly npus: NpuPort[] = NPU_PORTS.map((slot, i) => new NpuPort(slot, i));
  readonly gpus: GpuPort[] = GPU_PORTS.map((slot, i) => new GpuPort(slot, i));
  readonly disks = new Map<string, Disk>();
  os: InstalledOs | null = null;
  pchKey: PchKey | null = null;
  nextKeyId = 1;
  avgTurnaround: number;
  postError: { reason: string; short: string } | null = null;
  /** Bytes the OS drive had read when the machine booted (for the boot progress bar). */
  bootRead0 = 0;
  log: GameEvent[] = [];
  /** Base tick of the first real power-on (the client patience schedule runs from here), or null before it. */
  firstBootTick: number | null = null;
  /** An install waiting for the running job to finish (not saved). */
  pendingSwap: { invId: string; slotId?: string } | null = null;
  /** Ticks the finished key has sat in the port since the halt (auto-eject, see `autoEject`). */
  autoEjectWait = 0;
  /** Base ticks of cold-boot hardware delay left before the CPU starts (the machine is powered but not running yet). */
  bootDelay = 0;
  /** The OS's boot probe of each drive on the bus (not saved): base ticks of scan and repair left, `os.ts` `startMountScan`. */
  readonly mounts = new Map<string, DriveMount>();
  /** Each clock domain's rate before the cpuCyclesPerClock and boost scaling (what `applyRates` set). */
  readonly rateDomains: readonly string[] = ["cpu", "display", "tpm", ...STORAGE_PORTS, ...GPU_PORTS, ...NPU_PORTS];
  readonly baseRates = new Map<string, { mul: number; div: number }>();
  /** Cycles of history the next snapshot's trace carries: a step of the paused machine asks for more so none of it is lost. */
  traceCycles = TRACE_CYCLES;
  /** The logical core the snapshot's `pipe` (the die's detailed view and the Trace panel) follows (memory.ts `setViewCore`). */
  viewCore = 0;

  /** Client base score (campaign only; the sandbox leaves it at 0) and the level derived from it (never decreases). */
  clientBase = 0;
  lvl = 1;
  /** Base tick each level was first reached (drives the job-class ramp); a level not listed counts as long reached. */
  levelTicks: Record<number, number> = {};
  declined = 0;
  expired = 0;
  leveledUpAt: number | null = null;
  recentUnlocks: ItemInfo[] = [];
  /** Sandbox: the rules level (patience, payout, demand, mix) is pinned here instead of following the score. */
  sandboxLevel = SANDBOX_LEVEL;
  /** Sandbox: job classes switched off for the natural arrivals (spawnKey still adds any). Saved (docs/SAVE.md "sandbox"). */
  sandboxOff = new Set<JobClassId>();
  /** Sandbox: kinds of job (job dex ids) switched off for the natural arrivals, on top of `sandboxOff`. Saved. */
  sandboxKindsOff = new Set<string>();

  /** The job log: the last jobs that ended, oldest first (docs/JOBS.md "The log"). */
  jobLog: JobLogEntry[] = [];
  /** The job almanac's record per kind of job (docs/JOBS.md). */
  dex: Record<string, DexRecord> = {};

  /** The pages the running program has written to outside the OS and its own image, and the key it belongs to (memory.ts). */
  claimed = new Set<number>();
  claimKey = -1;
  /** Consecutive snapshots a health check has failed on (memory.ts). */
  leakSeen = 0;
  timerSeen = 0;

  // ---- network state (docs/NETWORK.md) ----
  /** Tier of the router standing in its spot (0 none) and of the ISP plan bought (0 none). */
  routerTier = 0;
  ispTier = 0;
  /** Where the ethernet cable is plugged: "board", a NIC device id, or null. */
  lan: string | null = null;
  /** Where the video cable's PC end is plugged: "board" (the rear HDMI port) or the slot of a GPU card ("pcie1"), which needs a graphics display. */
  video = "board";
  /** The link has been up once: USB keys retired (sticky, saved). */
  networkLinked = false;
  deadTicks = 0;
  /** The link was usable at the end of the last tick (a transition into it retires the USB keys). Not saved. */
  linkWasUsable = false;
  readonly offersQ: NetworkSource<Key>;
  downloads: Transfer[] = [];
  /** Finished downloads in the NIC rx window (RAM) waiting to be written to the spool. */
  rx: Key[] = [];
  /** Jobs written to the spool on the drive, in ingest order (survive power loss). */
  spool: Key[] = [];
  uploads: Transfer[] = [];
  netKey: NetKey | null = null;
  netCooldown = 0;
  link: Link = { state: "no-device", reason: "no ISP plan", port: { kind: null, deviceId: null, mbps: 0 }, router: null, isp: null, bw: { downMbps: 0, upMbps: 0, clients: 0, binding: null } };
  netCount = { delivered: 0, downloaded: 0, uploaded: 0, lost: 0 };

  readonly seed: number;

  constructor(opts: GameOptions) {
    this.seed = opts.seed >>> 0;
    this.cfg = { ...ECONOMY, ...opts.economy };
    this.sandbox = !!opts.sandbox;
    if (this.sandbox) { this.cables.pcmains = true; this.cables.monmains = true; } // a sandbox machine is plugged into the wall from the start
    const start = Math.min(MAX_LEVEL, Math.max(1, Math.round(opts.startLevel ?? 1)));
    this.lvl = this.sandbox ? 1 : start;
    this.clientBase = this.sandbox ? 0 : LEVELS[start - 1]!.threshold;
    this.levelTicks = this.sandbox || start > 1 ? {} : { 1: 0 };
    this.avgTurnaround = this.cfg.targetTurnaround * this.patience(); // the clients start out content: reputation 1
    this.money = this.sandbox ? SANDBOX_MONEY : this.cfg.startMoney;
    this.tray = new UsbTray<Key>(this.cfg.queueCap);
    this.offersQ = new NetworkSource<Key>(this.cfg.queueCap);
    this.board = createBoard(0);
    // The machine's memory array is built once at the most the paged OSes can use (1 MiB, their 20-bit virtual space); the installed RAM
    // changes the PCH-reported size (what the OS manages and the screens show), the cache miss penalty and which jobs arrive (EconomyConfig.mix).
    this.flipRng = new Prng((opts.seed ^ 0x5eed_ecc) >>> 0); // its own stream: the flips never disturb the machine's or the clients' randomness
    this.machine = new Machine({ ...machineConfigFor(this.board, opts.seed), ramSize: MACHINE_RAM_BYTES });
    this.pch = new Pch(this.machine.display);
    this.pch.onPhase = () => this.applyBoost();
    this.machine.addDevice(this.pch);
    for (const p of this.ports) this.machine.addDevice(p);
    for (const p of this.gpus) this.machine.addDevice(p);
    for (const p of this.npus) this.machine.addDevice(p);
    this.tpm = new TpmPort(this.machine.bus, this.machine.ram, this.machine.prng);
    this.machine.addDevice(this.tpm);
    this.thermal = new ThermalModel(this.machine.prng);
    // The crate: CPU, PSU, RAM, monitor, stock cooler (last, so the older item ids stay inv1..inv4). Nothing is mounted at the start.
    for (const spec of ["cpu0", "psu0", "ram0", "display0", "cooler0"]) this.inventory.push({ id: `inv${this.nextInvId++}`, spec });
    for (const q of this.cfg.startQueue) this.enqueue(q.template, q.scale);
    if (opts.preassembled) {
      for (const it of [...this.inventory]) this.mustInstall(it.spec, it.id);
      this.cables = allCables(this.board);
      this.progress = newProgress(true);
      this.firstBootTick = 0;
      this.syncRates(false);
      if (!this.sandbox) this.powerButton(); // a sandbox machine is assembled but waits for the player's power press
    } else {
      this.syncRates(false);
    }
    // No tutorial in the sandbox: every milestone is reached from the start.
    if (this.sandbox) this.progress = Object.fromEntries(PROGRESS_KEYS.map((k) => [k, true])) as unknown as Progress;
    if (this.sandbox && opts.preassembled && opts.maxed) this.buildMaxRig();
  }

  /**
   * Rebuild a game from a save (validated; throws Error with a clear message). The machine loads powered off; a
   * plugged key stays plugged and its job restarts from boot at the next power-on. `economy` must match the saving
   * game's. A version 1 save is migrated first (see save.ts).
   */
  static fromSave(input: unknown, economy?: Partial<EconomyConfig>): Game {
    const s = parseSave(input);
    const g = new Game({ seed: s.seed, economy, sandbox: s.sandbox === true });
    g.restoreSave(s);
    return g;
  }

  /** The player level (campaign) or the pinned rules level (sandbox). */
  get level(): number {
    return this.sandbox ? this.sandboxLevel : this.lvl;
  }

  /** The link is carrying traffic (up, or up but out of client slots). */
  get linkUsable(): boolean {
    return this.link.state === "link-up" || this.link.state === "saturated";
  }

  note(kind: string, text: string): void {
    this.log.push({ tick: this.baseTick, kind, text });
    if (this.log.length > LOG_CAP) this.log.shift();
  }
}

Object.assign(
  Game.prototype,
  parts, shop, sandbox, machine, bill, keys, clients, hardware, os, memory, network, snapshot, persist,
);
