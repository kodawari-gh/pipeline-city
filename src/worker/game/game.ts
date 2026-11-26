// Headless game loop: one Machine + Board + ThermalModel + PCH + USB key tray + economy.
// Deterministic: all randomness comes from the machine PRNG. No DOM. See src/features/economy/GAME.md and src/features/cpu/ASSEMBLY.md.
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
//   cloud      cloud-storage contracts: offers, accept and ignore, the hold, the reads, the end (model in contracts.ts)
//   snapshot   the snapshot the worker posts every tick
//   persist    the save and its restore

import * as boardSim from '../../features/board/sim';
import { Disk, GpuPort, Machine, NpuPort, StoragePort, TpmPort } from '../../core/sim';
import { Prng } from '../../core/sim/prng';
import { GPU_PORTS, NPU_PORTS, STORAGE_PORTS } from '../../core/sim/memmap';
import { NetworkSource } from '../../features/network/sim';
import { Nic } from '../../features/network/sim/nic';
import type { RttEstimate } from '../../features/network/sim/transport';
import * as pchChip from '../../features/board/sim/pch';
import * as bill from '../../features/economy/sim/bill';
import * as clients from '../../features/economy/sim/clients';
import * as economyRules from '../../features/economy/sim/economy';
import * as hardware from '../../features/board/sim/game/hardware';
import * as gameInternal from './internal';
import type { DexRecord } from '../../features/jobs/sim/jobdex';
import type { JobLogEntry } from '../../features/jobs/sim/joblog';
import * as cloud from '../../features/economy/sim/cloud';
import type { Contract, ContractOffer } from '../../features/economy/sim/contracts';
import { newContractRng } from '../../features/economy/sim/contracts';
import * as keys from '../../features/economy/sim/keys';
import * as levelTable from '../../features/economy/sim/levels';
import * as machine from '../../features/board/sim/game/machine';
import * as machineBoot from '../../features/board/sim/game/machineBoot';
import * as machineTick from '../../features/board/sim/game/machineTick';
import * as memory from '../../features/memory/sim/memory';
import * as network from '../../features/network/sim/network';
import * as os from '../../features/os/sim/os';
import * as parts from '../../features/board/sim/game/parts';
import * as partsCables from '../../features/board/sim/game/partsCables';
import * as partsInstall from '../../features/board/sim/game/partsInstall';
import * as partsInventory from '../../features/board/sim/game/partsInventory';
import * as partsPlace from '../../features/board/sim/game/partsPlace';
import * as partsSwap from '../../features/board/sim/game/partsSwap';
import * as persist from './persist';
import { TRACE_CYCLES } from '../../features/cpu/sim/pipesnap';
import * as sandbox from '../../features/sandbox/sim/sandbox';
import * as saveFormat from './save';
import * as shop from '../../features/economy/sim/shop';
import * as snapshot from './snapshot';
import type { CompletedInfo, GameEvent, GameOptions } from './types';
import { UsbTray } from '../../features/jobs/sim/work';

export type * from './types';
export type { GameOptions };

/** The feature files' exports, which `Game` has as methods. */
type Features = typeof parts &
  typeof partsInstall &
  typeof partsSwap &
  typeof partsCables &
  typeof partsInventory &
  typeof partsPlace &
  typeof shop &
  typeof sandbox &
  typeof machine &
  typeof machineBoot &
  typeof machineTick &
  typeof bill &
  typeof keys &
  typeof clients &
  typeof hardware &
  typeof os &
  typeof memory &
  typeof network &
  typeof snapshot &
  typeof persist &
  typeof cloud;
export interface Game extends Features {}

// The fields below are the state the feature files share, so none is private.
export class Game {
  readonly cfg: economyRules.EconomyConfig;
  readonly machine: Machine;
  readonly thermal: boardSim.ThermalModel;
  readonly pch: pchChip.Pch;
  board: boardSim.Board;
  cables: boardSim.Cables = boardSim.noCables();
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
  progress: saveFormat.Progress = saveFormat.newProgress();

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
  /** Build my PC's game: only the shape of a part decides whether it fits (`GameOptions.looseFit`). */
  readonly looseFit: boolean;
  /** `looseFit` only: the socket the OS's drive was in when it left, where `keepOs` puts the OS back. Not saved. */
  osSlot: string | null = null;

  inventory: gameInternal.InvItem[] = [];
  nextInvId = 1;
  readonly tray: UsbTray<gameInternal.Key>;
  plugged: gameInternal.Key | null = null;
  readonly ports: StoragePort[] = STORAGE_PORTS.map((slot, i) => new StoragePort(slot, i));
  tpm!: TpmPort;
  /** The network interface (docs/NETSTACK.md): the kernel's driver talks to it; the wire (`network.ts`) feeds it and takes what it sends. */
  nic!: Nic;
  readonly npus: NpuPort[] = NPU_PORTS.map((slot, i) => new NpuPort(slot, i));
  readonly gpus: GpuPort[] = GPU_PORTS.map((slot, i) => new GpuPort(slot, i));
  readonly disks = new Map<string, Disk>();
  os: gameInternal.InstalledOs | null = null;
  pchKey: pchChip.PchKey | null = null;
  nextKeyId = 1;
  avgTurnaround: number;
  postError: { reason: string; short: string } | null = null;
  /** Bytes the OS drive had read when the machine booted (for the boot progress bar). */
  bootRead0 = 0;
  log: GameEvent[] = [];
  /** Base tick of the first real power-on (the client patience schedule runs from here), or null before it. */
  firstBootTick: number | null = null;
  /** An install waiting for the running job to finish (not saved). */
  pendingSwaps: { invId: string; slotId: string }[] = [];
  /** Ticks the finished key has sat in the port since the halt (auto-eject, see `autoEject`). */
  autoEjectWait = 0;
  /** Base ticks of cold-boot hardware delay left before the CPU starts (the machine is powered but not running yet). */
  bootDelay = 0;
  /** The OS's boot probe of each drive on the bus (not saved): base ticks of scan and repair left, `os.ts` `startMountScan`. */
  readonly mounts = new Map<string, gameInternal.DriveMount>();
  /** Each clock domain's rate before the cpuCyclesPerClock and boost scaling (what `applyRates` set). */
  readonly rateDomains: readonly string[] = [
    'cpu',
    'display',
    'tpm',
    'nic',
    ...STORAGE_PORTS,
    ...GPU_PORTS,
    ...NPU_PORTS,
  ];
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
  recentUnlocks: levelTable.ItemInfo[] = [];
  /** Sandbox: the rules level (patience, payout, demand, mix) is pinned here instead of following the score. */
  sandboxLevel = gameInternal.SANDBOX_LEVEL;
  /** Sandbox: job classes switched off for the natural arrivals (spawnKey still adds any). Saved (docs/SAVE.md "sandbox"). */
  sandboxOff = new Set<levelTable.JobClassId>();
  /** Sandbox: kinds of job (job dex ids) switched off for the natural arrivals, on top of `sandboxOff`. Saved. */
  sandboxKindsOff = new Set<string>();

  /** The job log: the last jobs that ended, oldest first (docs/JOBS.md "The log"). */
  jobLog: JobLogEntry[] = [];
  /** Cloud-storage contracts (cloud.ts): the open offers, the accepted ones, the next id (offers and contracts share it) and the stream that rolls offers. Saved. */
  contractOffers: ContractOffer[] = [];
  contracts: Contract[] = [];
  nextContractId = 1;
  contractRng = newContractRng(0);
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
  video = 'board';
  /** The link has been up once: USB keys retired (sticky, saved). */
  networkLinked = false;
  deadTicks = 0;
  /** The link was usable at the end of the last tick (a transition into it retires the USB keys). Not saved. */
  linkWasUsable = false;
  readonly offersQ: NetworkSource<gameInternal.Key>;
  downloads: gameInternal.Transfer[] = [];
  /** Finished downloads in the NIC rx window (RAM) waiting to be written to the spool. */
  rx: gameInternal.Key[] = [];
  /** Jobs written to the spool on the drive, in ingest order (survive power loss). */
  spool: gameInternal.Key[] = [];
  /** The OS menu's spool settings (docs/OS.md "OS menu"): most queue slots wanted (null: as many as the OS allows) and the drives that hold none. Saved. */
  osCfg: {
    spoolSlots: number | null;
    spoolOff: string[];
    spoolAlloc: Record<string, number>;
    dataReserve: Record<string, number>;
  } = { spoolSlots: null, spoolOff: [], spoolAlloc: {}, dataReserve: {} };
  /** Where the queue slots are now: per drive, how many (set by `layoutSpool` at power-on). Not saved. */
  spoolPlan: { deviceId: string; slots: number }[] = [];
  uploads: gameInternal.Transfer[] = [];
  /** Spooled jobs the kernel does not know (a boot wiped its table): the NIC replays their program from the spool, nothing crosses the wire. RAM: lost on power loss. */
  restores: gameInternal.Transfer[] = [];
  /** The wire between the senders and the NIC (RAM-like: lost with the link): segments on their way to the NIC's input, acknowledgements on their way back. */
  wireQ: gameInternal.WireSegment[] = [];
  wireAcks: gameInternal.WireAck[] = [];
  /** What the senders have done since the game started (the transport's counters, not saved): segments put on the wire, the resends among them, segments the wire lost, timeouts. */
  netWire = { sent: 0, resent: 0, lost: 0, timeouts: 0 };
  /** The round trip the senders have measured to this machine (the smoothed time and its deviation), shared by the downloads of the link; null until the first download. RAM-like: lost with the link. */
  netRtt: RttEstimate | null = null;
  link: gameInternal.Link = {
    state: 'no-device',
    reason: 'no ISP plan',
    port: { kind: null, deviceId: null, mbps: 0 },
    router: null,
    isp: null,
    bw: { downMbps: 0, upMbps: 0, clients: 0, binding: null },
  };
  netCount = { delivered: 0, downloaded: 0, uploaded: 0, lost: 0 };
  /** The frames the uplink port has received and sent since the game started (fractions kept; counted from the bytes the transfers move, `network.ts` `countFrames`). Not saved. */
  netFrames = { rx: 0, tx: 0 };

  readonly seed: number;

  constructor(opts: GameOptions) {
    this.seed = opts.seed >>> 0;
    this.contractRng = newContractRng(this.seed);
    this.cfg = { ...economyRules.ECONOMY, ...opts.economy };
    this.sandbox = Boolean(opts.sandbox);
    this.looseFit = this.sandbox && Boolean(opts.looseFit);
    const start = Math.min(levelTable.MAX_LEVEL, Math.max(1, Math.round(opts.startLevel ?? 1)));
    this.lvl = this.sandbox ? 1 : start;
    this.clientBase = this.sandbox ? 0 : levelTable.LEVELS[start - 1]!.threshold;
    this.levelTicks = this.sandbox || start > 1 ? {} : { 1: 0 };
    this.avgTurnaround = this.cfg.targetTurnaround * this.patience(); // the clients start out content: reputation 1
    this.money = this.sandbox ? economyRules.SANDBOX_MONEY : this.cfg.startMoney;
    this.tray = new UsbTray<gameInternal.Key>(this.cfg.queueCap);
    this.offersQ = new NetworkSource<gameInternal.Key>(this.cfg.queueCap);
    this.board = boardSim.createBoard(0);
    // The machine's memory array is built once at the most the paged OSes can use (1 MiB, their 20-bit virtual space); the installed RAM
    // changes the PCH-reported size (what the OS manages and the screens show), the cache miss penalty and which jobs arrive (EconomyConfig.mix).
    this.flipRng = new Prng((opts.seed ^ 0x5_ee_de_cc) >>> 0); // its own stream: the flips never disturb the machine's or the clients' randomness
    this.machine = new Machine({
      ...boardSim.machineConfigFor(this.board, opts.seed),
      ramSize: gameInternal.MACHINE_RAM_BYTES,
    });
    this.pch = new pchChip.Pch(this.machine.display);
    this.pch.onPhase = () => this.applyBoost();
    this.machine.addDevice(this.pch);
    for (const p of this.ports) {
      this.machine.addDevice(p);
    }
    for (const p of this.gpus) {
      this.machine.addDevice(p);
    }
    for (const p of this.npus) {
      this.machine.addDevice(p);
    }
    this.tpm = new TpmPort(this.machine.bus, this.machine.ram, this.machine.prng);
    this.machine.addDevice(this.tpm);
    this.nic = new Nic(this.machine.ram, (line) => this.machine.raise(line));
    this.nic.pull = () => this.wirePull();
    this.nic.onTransmit = (p) => this.wireSend(p);
    this.machine.addDevice(this.nic);
    this.thermal = new boardSim.ThermalModel(this.machine.prng);
    // The case comes with two basic fans on its front mounts (their cables still out).
    for (const m of ['front0', 'front1']) {
      this.mustInstall('fan92', { slot: m });
    }
    // The crate: CPU, PSU, RAM, monitor, stock heatsink and its fan (last, so the older item ids stay inv1..inv4). Nothing else is mounted at the start.
    for (const spec of ['cpu0', 'psu0', 'ram0', 'display0', 'cooler0', 'fan92']) {
      this.inventory.push({ id: `inv${this.nextInvId++}`, spec });
    }
    for (const q of this.cfg.startQueue) {
      this.enqueue(q.template, q.scale);
    }
    if (opts.preassembled) {
      for (const it of [...this.inventory]) {
        this.mustInstall(it.spec, { invId: it.id });
      }
      this.cables = boardSim.allCables(this.board);
      this.progress = saveFormat.newProgress(true);
      this.firstBootTick = 0;
      this.syncRates(false);
      if (!this.sandbox) {
        this.powerButton(); // a sandbox machine is assembled but waits for the player's power press
      }
    } else {
      this.syncRates(false);
    }
    // No tutorial in the sandbox: every milestone is reached from the start.
    if (this.sandbox) {
      this.progress = Object.fromEntries(
        saveFormat.PROGRESS_KEYS.map((k) => [k, true]),
      ) as unknown as saveFormat.Progress;
    }
    if (this.sandbox && opts.preassembled && opts.maxed) {
      this.buildMaxRig();
    }
  }

  /**
   * Rebuild a game from a save (validated; throws Error with a clear message). The machine loads powered off; a
   * plugged key stays plugged and its job restarts from boot at the next power-on. `economy` must match the saving
   * game's. A version 1 save is migrated first (see save.ts).
   */
  static fromSave(input: unknown, economy?: Partial<economyRules.EconomyConfig>): Game {
    const s = saveFormat.parseSave(input);
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
    return this.link.state === 'link-up' || this.link.state === 'saturated';
  }

  note(kind: string, text: string): void {
    this.log.push({ tick: this.baseTick, kind, text });
    if (this.log.length > gameInternal.LOG_CAP) {
      this.log.shift();
    }
  }
}

Object.assign(
  Game.prototype,
  parts,
  partsInstall,
  partsSwap,
  partsCables,
  partsInventory,
  partsPlace,
  shop,
  sandbox,
  machine,
  machineBoot,
  machineTick,
  bill,
  keys,
  clients,
  hardware,
  os,
  memory,
  network,
  snapshot,
  persist,
  cloud,
);
