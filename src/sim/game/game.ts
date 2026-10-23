// Headless game loop: one Machine + Board + ThermalModel + PCH + USB key tray + economy.
// Deterministic: all randomness comes from the machine PRNG. No DOM. See docs/GAME.md and docs/ASSEMBLY.md.
//
// The player builds the machine (install parts from the inventory, connect cables) and serves clients one USB key at a
// time. Without an OS: plug a key while the machine is off, press power; after POST the ROM looks at the USB port once,
// loads the key's program, runs it, writes the result back and halts; remove the key to get paid, power off and on for
// the next job. Parts and cables can only change while the machine is off.

import {
  applyEngine, applyRates, boardFromJson, boardSlots, boardToJson, bootCheck, BOARD_TIERS, CABLES, cableBlocked,
  connectCable as boardConnect, createBoard, deviceSpec, disconnectCable as boardDisconnect, engineConfigFor,
  findDevices, freeSlots, getSpec, install, machineConfigFor, noCables, allCables, pruneCables, setClock, slotAccepts,
  ThermalModel, uninstall, upgradeBoard,
  type Board, type BoardFeatures, type CableId, type Cables, type DeviceKind, type InstalledDevice, type RamSpec, type SlotType,
  specsOfKind, type StorageSpec,
} from "../board";
import { COUNTER_NAMES, type PipelineEngine } from "../engines";
import { disassemble } from "../isa";
import { BLOCK_BYTES, JOB_ROW, JobState, KDATA_BASE, KDATA_SLOTS, KSLOT, KSLOT_BYTES, PchPhase, STORAGE_PORTS } from "../isa/memmap";
import { generate, runReference } from "../gen";
import { Disk, Machine, StoragePort } from "../machine";
import { BOOT_BLOCKS, bootImage, getOsSpec, OS_SPECS, queueSlotsFor, SPOOL_BLOCKS_PER_JOB, type OsSpec } from "../os";
import { Pch, ROM_IMAGE, type PchKey } from "../pch";
import {
  applyOffer, boardTierOf, demandRate, ECONOMY, offers, patienceMul, payMulFor, payout, pickTemplate, reputation,
  type EconomyConfig,
} from "./economy";
import {
  newProgress, parseSave, SAVE_VERSION, type Progress, type SavedKey, type SavedPlugged, type SaveV4,
} from "./save";
import { UsbTray, type Job } from "./work";

export interface GameOptions {
  seed: number;
  /** Overrides for the placeholder economy (tests use this). */
  economy?: Partial<EconomyConfig>;
  /**
   * Start with the machine fully assembled, cables connected, all tutorial milestones reached and the power on
   * (dev and tests). The real app starts bare: an empty board and the starter crate in the inventory.
   */
  preassembled?: boolean;
}

/** A client job on a USB key. The program is generated when the key is plugged in. */
interface Key extends Job {
  template: string;
  seed: number;
  scale: number;
  deadline: number;
  /** Reference instruction count of the program (the payout base). */
  work: number;
  /** Short job type for the label: log, calc, checksum, scan. */
  type: string;
  /** The job number the program prints on the monitor (#NN). */
  jobNo: number;
  attempts: number;
  pluggedAt: number;
  done: boolean;
  doneAt: number;
  result: string;
}

export interface CompletedInfo {
  id: number;
  template: string;
  payout: number;
  /** Ticks from key arrival to key removal. */
  turnaround: number;
  /** Ticks from plugging the key in to the result being written (boot + program + result). */
  execTicks: number;
  late: boolean;
  attempts: number;
  /** Tick the key was removed. */
  completedAt: number;
}

export interface DeviceSnap {
  id: string;
  spec: string;
  kind: DeviceKind;
  name: string;
  /** Board slot id it sits in (e.g. "dimm1"); the renderer places it by this. */
  slot: string;
  burnt: boolean;
  requestedClock: number | null;
  effectiveClock: number;
  tempC: number;
  powerW: number;
  throttle: number;
  unstable: boolean;
}

/** The board VRM's live state (docs/VRM.md). */
export interface VrmSnap {
  phases: number;
  ampsPerPhase: number;
  /** Component quality as ripple 0..1 (lower is better). */
  ripple: number;
  tempC: number;
  /** CPU current demand over the phases' rating; above 1 the VRM is overloaded. */
  loadRatio: number;
  efficiency: number;
  /** VRM thermal factor in [0.8, 1] applied to the CPU clock. */
  throttle: number;
  unstable: boolean;
  /** The VRM burnt out: the board is dead. */
  burnt: boolean;
  /** Chance per busy tick of a voltage-droop crash. */
  errProb: number;
  /** Heat the VRM makes right now (its conversion loss), W. */
  heatW: number;
  throttleC: number;
  unstableC: number;
  damageC: number;
  /** Installed VRM heatsink device id, or null. */
  sinkDeviceId: string | null;
}

/** The motherboard: tier, features, only the slots it has, the VRM and its heatsink. */
export interface BoardSnap {
  tier: number;
  name: string;
  /** Dead board: replace it by buying a board of the same or a higher tier. */
  burnt: boolean;
  features: BoardFeatures;
  slots: SlotSnap[];
  vrm: VrmSnap;
  vrmSink: DeviceSnap | null;
}

/** One pipeline stage occupant (IF ID EX MEM WB), for the renderer. See docs/RENDER.md. */
export interface StageSnap {
  /** 0 empty, 1 instruction, 2 bubble (SlotKind). */
  kind: number;
  /** Dynamic instruction id (-1 if empty or bubble). */
  id: number;
  /** Mnemonic ("lw"), "" unless kind is 1. */
  op: string;
  /** Full disassembly ("lw a0, 4(sp)"), "" unless kind is 1. */
  text: string;
  /** Bubble cause (Cause: 0 none, 1 load, 2 data, 3 flush, 4 struct). */
  cause: number;
  /** Held this cycle (hazard stall or cache freeze). */
  stalled: boolean;
}

export interface PurchaseSnap {
  id: string;
  name: string;
  kind: DeviceKind | "board" | "os";
  price: number;
  affordable: boolean;
  /** Set if the board would refuse it right now (e.g. PSU too small, no slot). */
  blocked?: string;
  /** A planned tier that cannot be bought yet (locked in the shop). */
  later?: boolean;
  description?: string;
}

/**
 * Machine phase (see docs/ASSEMBLY.md and docs/OS.md). The first group is the no-OS flow (POST, one look at the USB
 * port, load, run, write, then "halted" until the player power-cycles; `haltReason` says why); the second is what a
 * machine with an OS goes through: it boots the kernel once, then idles, ingests keys, runs jobs and flashes results.
 * "waiting-for-key" and "done-remove-key" are the old per-job-reboot phases: kept in the type, never produced any more.
 */
export type Phase =
  | "waiting-for-key" | "done-remove-key"
  | "off" | "posting" | "loading" | "running" | "writing" | "halted" | "error"
  | "booting-os" | "idle-os" | "ingesting" | "running-os" | "flashing";

/** Where a key's job stands. Legacy (no OS) keys are "tray", then "done" once the ROM wrote the result. */
export type KeyStage = "tray" | "ingesting" | "queued" | "running" | "result" | "flashing" | "done";

/** A part you own but have not installed. */
export interface InventorySnap {
  /** Inventory item id (what `install` takes). */
  id: string;
  spec: string;
  kind: DeviceKind | "board" | "os";
  name: string;
  /** Free slot ids it fits right now (drop targets). For a board item: ["board"]; for an OS: the storage slots it can go on. */
  freeSlots: string[];
  /** Occupied slot ids it could be swapped into (the old part returns to the inventory). */
  swapSlots: string[];
  /** There is at least one valid target and the machine is off. */
  installable: boolean;
  /** Why not (first reason), when there is no valid target or the machine is on. */
  reason?: string;
}

export interface SlotSnap {
  id: string;
  type: SlotType;
  /** Installed device instance id, or null if empty. */
  deviceId: string | null;
}

export interface CableSnap {
  id: CableId;
  name: string;
  connected: boolean;
  /** Why it cannot be plugged in right now (its source part is missing). */
  blocked?: string;
}

export interface KeySnap {
  id: number;
  template: string;
  /** log, calc, checksum, scan. */
  type: string;
  /** The #NN the job prints on the monitor. */
  jobNo: number;
  /** "#72 scan". */
  label: string;
  arrivalTick: number;
  deadlineTick: number;
  /** Ticks since arrival. */
  age: number;
  /** Past the soft deadline (paid at the late factor). */
  late: boolean;
  /** Payout if served at the target turnaround. */
  payoutEstimate: number;
  attempts: number;
  /** Holds a result (only a plugged key can). */
  done: boolean;
  /** Result text on the key (when done). */
  result: string;
  /** With an OS: tray (not ingested), ingesting, queued/running/result (ingested: in the OS queue), flashing, done. */
  stage: KeyStage;
}

/** A storage device and its live statistics. */
export interface StorageSnap {
  deviceId: string;
  /** Board slot id (sata0, sata1, m20). */
  slot: string;
  spec: string;
  name: string;
  burnt: boolean;
  capacityBytes: number;
  usedBytes: number;
  bytesRead: number;
  bytesWritten: number;
  /** The drive is working on a command right now. */
  busy: boolean;
  /** Device ticks for a non-sequential access, and per 256-byte block. */
  latencyTicks: number;
  blockTicks: number;
  /** Streaming throughput in bytes per second at the current effective clock. */
  bytesPerSecond: number;
  /** The OS lives on this device. */
  hasOs: boolean;
}

/** One ingested job in the OS queue. */
export interface OsJobSnap {
  /** Kernel table slot (0..7). */
  slot: number;
  keyId: number;
  label: string;
  state: "queued" | "running" | "result";
  /** 0 = running now or next to run; counts queued jobs ahead of it. Results awaiting delivery use -1. */
  ahead: number;
}

export interface OsSnap {
  spec: string;
  tier: number;
  name: string;
  /** Storage device and slot it is installed on. */
  deviceId: string;
  slot: string;
  /** Programs the kernel may run at once (1 for v1). */
  programSlots: number;
  /** Jobs the queue can hold (OS tier field, bounded by disk space). */
  queueSlots: number;
  /** The kernel is up (booted and powered). */
  up: boolean;
  queue: OsJobSnap[];
  runningKeyId: number | null;
}

/** What the USB port's LED would be doing. */
export type KeyActivity = "none" | "enumerating" | "ingesting" | "flashing" | "done";

export interface GameEvent {
  tick: number;
  /** e.g. "install", "power", "key", "job", "payout", "drop", "fault". */
  kind: string;
  text: string;
}

export interface Snapshot {
  money: number;
  /** Total CPU cycles clocked since the start. */
  cycle: number;
  baseTick: number;
  /** Keys in the tray. */
  queueLength: number;
  queueCap: number;
  /** The plugged key's job, or null (kept for the old UI; `plugged` has more). */
  request: null | {
    id: number;
    template: string;
    arrivalTick: number;
    deadlineTick: number;
    payoutEstimate: number;
    /** Engine cycle since power-on or the last reset. */
    engineCycle: number;
    attempts: number;
  };
  /** Board tier (slot counts), for drawing empty sockets. */
  boardTier: number;
  /** The motherboard in detail (features, VRM, heatsink). Absent slots are not listed. */
  board: BoardSnap;
  /** Pipeline stage occupants while the machine is powered with a working CPU, else null. */
  pipe: null | { stages: StageSnap[] };
  /** What the monitor shows (POST text, the job's output, REMOVE KEY, ...). Empty when off or no monitor is connected. */
  display: string;
  /** Engine counters since power-on, by name (all zero when no engine). */
  counters: Record<string, number>;
  completed: number;
  /** Thermal errors that crashed the machine and restarted the job from boot. */
  errors: number;
  dropped: number;
  lastCompleted: CompletedInfo | null;
  avgTurnaround: number;
  reputation: number;
  /** Key arrivals per base tick right now. */
  demandRate: number;
  /** Installed parts. */
  devices: DeviceSnap[];
  power: { totalW: number; vrmLossW?: number; budgetW: number; psuFactor: number; off: boolean; tripped: boolean };
  cpuClock: { value: number; min: number; max: number } | null;
  /** What could be bought (an upgrade over what you own or installed). */
  purchases: PurchaseSnap[];
  /** Deprecated: purchases now go to the inventory. Always empty. */
  pendingPurchases: string[];

  // ---- assembly, boot and keys (docs/ASSEMBLY.md) ----
  phase: Phase;
  /** For phase "error": what is wrong. Otherwise null. */
  phaseReason: string | null;
  powered: boolean;
  /** 0..1 progress through POST and loading; 1 once the program runs. */
  bootProgress: number;
  /** The monitor is installed, its cable is connected and it is not burnt. */
  monitorLive: boolean;
  /** Why the power button would do nothing, or null. */
  noPowerReason: string | null;
  /** Why POST would fail now (missing CPU / CPU power / RAM), or null. */
  postBlocker: string | null;
  inventory: InventorySnap[];
  /** Every slot of the board and what sits in it. */
  slots: SlotSnap[];
  cables: CableSnap[];
  /** Keys lying in the tray, oldest first. */
  tray: KeySnap[];
  /** The key in the USB port. */
  plugged: KeySnap | null;
  progress: Progress;
  /** Most recent notable events, oldest first. */
  log: GameEvent[];

  // ---- storage and the OS (docs/OS.md) ----
  /** Installed storage devices with capacity, use and traffic. */
  storage: StorageSnap[];
  /** The installed OS, its queue and slot counts, or null (boot-per-key flow). */
  os: OsSnap | null;
  /** Keys the OS has ingested that the player unplugged: they wait for their result (plug them again to collect it). */
  held: KeySnap[];
  /** USB port LED: enumerating, ingesting, flashing, done (collect the key). Stays "none" for a key the ROM ignores. */
  keyActivity: KeyActivity;

  // ---- no-OS boot flow and client patience (added with the manual boot loop; all additive) ----
  /** For phase "halted": "job-done" (result written, remove the key) or "no-boot-media" (no key at boot). Otherwise null. */
  haltReason: "job-done" | "no-boot-media" | null;
  /** A key sits in the port of a running no-OS machine that already did its one look at the port: it is ignored until a power cycle. */
  keyIgnored: boolean;
  /** The last power-on ended in a POST error (phase "error", `phaseReason` says which part). */
  postFailed: boolean;
  /** The client patience schedule right now (docs/GAME.md). */
  patience: { mul: number; targetTurnaround: number; deadlineTicks: number; sinceFirstBoot: number };
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

interface InvItem {
  id: string;
  spec: string;
}

/** The installed OS: its spec, the storage device it lives on and the queue bound worked out at install time. */
interface InstalledOs {
  spec: OsSpec;
  deviceId: string;
  queueSlots: number;
}

/** A row of the kernel's job table (read from RAM). */
interface KernelJob { slot: number; state: number; key: number; len: number; seq: number }

const LOG_CAP = 16;
const BOARD_OFF_REASON = "powered off required: power the machine off to swap the board";

export class Game {
  readonly cfg: EconomyConfig;
  readonly machine: Machine;
  readonly thermal: ThermalModel;
  readonly pch: Pch;
  board: Board;
  cables: Cables = noCables();
  progress: Progress = newProgress();

  money = 0;
  baseTick = 0;
  completed = 0;
  errors = 0;
  dropped = 0;
  lastCompleted: CompletedInfo | null = null;
  powered = false;

  private inventory: InvItem[] = [];
  private nextInvId = 1;
  private readonly tray: UsbTray<Key>;
  /** Keys the OS ingested and the player unplugged, waiting for their result. */
  private held: Key[] = [];
  private plugged: Key | null = null;
  private readonly ports: StoragePort[] = STORAGE_PORTS.map((slot, i) => new StoragePort(slot, i));
  private readonly disks = new Map<string, Disk>();
  private os: InstalledOs | null = null;
  private pchKey: PchKey | null = null;
  private nextKeyId = 1;
  private avgTurnaround: number;
  private postError: { reason: string; short: string } | null = null;
  /** Bytes the OS drive had read when the machine booted (for the boot progress bar). */
  private bootRead0 = 0;
  private log: GameEvent[] = [];
  /** Base tick of the first real power-on (the client patience schedule runs from here), or null before it. */
  private firstBootTick: number | null = null;
  /** Base ticks of cold-boot hardware delay left before the CPU starts (the machine is powered but not running yet). */
  private bootDelay = 0;

  private readonly seed: number;

  constructor(opts: GameOptions) {
    this.seed = opts.seed >>> 0;
    this.cfg = { ...ECONOMY, ...opts.economy };
    this.avgTurnaround = this.cfg.targetTurnaround * this.cfg.patience.startMul; // the clients start out content: reputation 1
    this.money = this.cfg.startMoney;
    this.tray = new UsbTray<Key>(this.cfg.queueCap);
    this.board = createBoard(0);
    // RAM is fixed at construction, so the machine always has the largest RAM (64K); the installed RAM tier
    // changes the PCH-reported size, the cache miss penalty and which jobs arrive (EconomyConfig.mix).
    this.machine = new Machine({ ...machineConfigFor(this.board, opts.seed), ramSize: 64 * 1024 });
    this.pch = new Pch(this.machine.display);
    this.machine.addDevice(this.pch);
    for (const p of this.ports) this.machine.addDevice(p);
    this.thermal = new ThermalModel(this.machine.prng);
    // The crate: CPU, PSU, RAM, monitor, stock cooler (last, so the older item ids stay inv1..inv4). Nothing is mounted at the start.
    for (const spec of ["cpu0", "psu0", "ram0", "display0", "cooler0"]) this.inventory.push({ id: `inv${this.nextInvId++}`, spec });
    for (const q of this.cfg.startQueue) this.enqueue(q.template, q.scale);
    if (opts.preassembled) {
      for (const it of [...this.inventory]) this.mustInstall(it.spec, it.id);
      this.cables = allCables();
      this.progress = newProgress(true);
      this.firstBootTick = 0;
      this.syncRates(false);
      this.powerButton();
    } else {
      this.syncRates(false);
    }
  }

  // ---------- public API: building the machine ----------

  /**
   * Install an inventory item. With a `slotId` it goes there (a free slot, or an occupied slot of the same kind to
   * swap: the old part returns to the inventory, a burnt one is scrapped). Without, the first free compatible slot,
   * else it swaps with the installed part of its kind. A board item (`board1`) upgrades the board in place and
   * carries every part over. Only while the machine is off. Unplugs cables whose source part left.
   */
  install(invId: string, slotId?: string): Result<{ deviceId: string | null; slot: string }> {
    if (this.powered) return { ok: false, reason: "power the machine off first" };
    const item = this.inventory.find((i) => i.id === invId);
    if (!item) return { ok: false, reason: `no inventory item "${invId}"` };
    const osSpec = getOsSpec(item.spec);
    if (osSpec) return this.installOs(item, osSpec, slotId);
    const tier = boardTierOf(item.spec);
    if (tier !== undefined) {
      const r = upgradeBoard(this.board, tier);
      if (!r.ok) return r;
      this.removeItem(item.id);
      this.note("install", `${BOARD_TIERS[tier]!.name} installed`);
      return { ok: true, deviceId: null, slot: "board" };
    }
    const r = this.placeInto(this.board, item.spec, slotId);
    if (!r.ok) return r;
    this.removeItem(item.id);
    if (r.replaced) {
      const old = r.replaced;
      this.disks.delete(old.id);
      if (!old.burnt) this.inventory.push({ id: `inv${this.nextInvId++}`, spec: old.spec });
    }
    this.afterBoardChange();
    this.flagInstalled(getSpec(item.spec)!.kind);
    this.note("install", `${getSpec(item.spec)!.name} installed in ${r.slot}`);
    return { ok: true, deviceId: r.id, slot: r.slot };
  }

  /** Take an installed part out; it goes to the inventory (a burnt part is scrapped). Only while off. */
  uninstall(deviceId: string): Result<{ invId: string | null }> {
    if (this.powered) return { ok: false, reason: "power the machine off first" };
    const dev = this.board.devices.find((d) => d.id === deviceId);
    if (!dev) return { ok: false, reason: `no installed device "${deviceId}"` };
    if (this.os?.deviceId === deviceId) return { ok: false, reason: `the OS is installed on ${deviceSpec(dev).name}: uninstall the OS first` };
    const r = uninstall(this.board, deviceId);
    if (!r.ok) return r;
    this.disks.delete(deviceId);
    let invId: string | null = null;
    if (!dev.burnt) {
      invId = `inv${this.nextInvId++}`;
      this.inventory.push({ id: invId, spec: dev.spec });
    }
    // The cooler mounts on the CPU: taking the CPU out takes the cooler with it, back into the inventory.
    if (deviceSpec(dev).kind === "cpu" && !findDevices(this.board, "cpu").length) {
      for (const c of findDevices(this.board, "cooler")) {
        uninstall(this.board, c.id);
        if (!c.burnt) this.inventory.push({ id: `inv${this.nextInvId++}`, spec: c.spec });
        this.note("install", `${deviceSpec(c).name} removed with the CPU`);
      }
    }
    this.afterBoardChange();
    this.note("install", `${deviceSpec(dev).name} removed`);
    return { ok: true, invId };
  }

  /** Plug a cable in (needs its source part installed). Only while off. */
  connectCable(cable: string): Result<{ cable: CableId }> {
    if (this.powered) return { ok: false, reason: "power the machine off first" };
    const r = boardConnect(this.board, this.cables, cable);
    if (!r.ok) return r;
    const flag = { atx: "atxConnected", cpu: "cpuPowerConnected", video: "videoConnected" }[r.cable] as keyof Progress;
    this.progress[flag] = true;
    this.note("cable", `${CABLES.find((c) => c.id === r.cable)!.name} connected`);
    return r;
  }

  disconnectCable(cable: string): Result<{ cable: CableId }> {
    if (this.powered) return { ok: false, reason: "power the machine off first" };
    const r = boardDisconnect(this.cables, cable);
    if (r.ok) this.note("cable", `${CABLES.find((c) => c.id === r.cable)!.name} disconnected`);
    return r;
  }

  /**
   * Buy an item (a device spec id or a board tier id): money is spent now and the part goes to the inventory, not into
   * the machine. Only upgrades over what you own (installed or in the inventory) are offered, and the board must be
   * able to take the whole plan (a bigger CPU needs a big enough PSU somewhere in the plan).
   */
  purchase(itemId: string): Result<{ invId: string }> {
    const extra = this.extraOffers().find((o) => o.id === itemId);
    if (extra) {
      if (extra.blocked) return { ok: false, reason: extra.blocked };
      if (this.money < extra.price) return { ok: false, reason: `needs $${extra.price}, have $${this.money}` };
      this.money -= extra.price;
      const invId = `inv${this.nextInvId++}`;
      this.inventory.push({ id: invId, spec: itemId });
      this.progress.firstPurchase = true;
      this.note("purchase", `bought ${extra.name} for $${extra.price}`);
      return { ok: true, invId };
    }
    const cand = offers(this.plannedBoard()).find((s) => s.id === itemId);
    if (!cand) return { ok: false, reason: `"${itemId}" is not an available upgrade` };
    if (cand.kind === "board" && this.powered) return { ok: false, reason: BOARD_OFF_REASON };
    if (this.money < cand.price) return { ok: false, reason: `needs $${cand.price}, have $${this.money}` };
    const r = applyOffer(this.plannedBoard(), itemId);
    if (!r.ok) return r;
    this.money -= cand.price;
    const invId = `inv${this.nextInvId++}`;
    this.inventory.push({ id: invId, spec: itemId });
    this.progress.firstPurchase = true;
    this.note("purchase", `bought ${cand.name} for $${cand.price}`);
    return { ok: true, invId };
  }

  /** Set the requested CPU clock (overclock/underclock), in the spec's range. Takes effect on the next tick. */
  setCpuClock(clock: number): { ok: true } | { ok: false; reason: string } {
    const cpu = findDevices(this.board, "cpu")[0];
    if (!cpu) return { ok: false, reason: "no CPU" };
    const r = setClock(this.board, cpu.id, clock);
    if (r.ok) this.syncRates(this.powered);
    return r;
  }

  // ---------- public API: power, keys ----------

  /**
   * The power button. Off to on: needs a PSU with the 24-pin ATX cable connected, otherwise nothing happens (refused
   * with a reason). Then the PCH runs its self-test (POST): without a CPU, cooler, CPU power (8-pin) or RAM the machine
   * stops in phase "error" with the message on the monitor (a POST error, not a refusal). Powered in any phase (posting,
   * running, halted, error) it is a hard power-off at once: a job in progress is lost, its key stays plugged and the job
   * restarts at the next boot. Clears a PSU trip.
   */
  powerButton(): Result<{ powered: boolean }> {
    if (this.powered) {
      const phase = this.currentPhase();
      if (this.plugged && !this.plugged.done && !this.os && (phase === "loading" || phase === "running" || phase === "writing")) {
        this.plugged.attempts++;
        this.note("fault", `hard power-off: the job on key ${this.plugged.id} is lost (it restarts at the next boot)`);
      }
      this.powered = false;
      this.postError = null;
      this.machine.engine = null;
      this.pch.powerOff();
      this.machine.display.clear();
      this.thermal.powerCycle();
      this.returnHeld();
      this.note("power", "powered off");
      return { ok: true, powered: false };
    }
    const chk = bootCheck(this.board, this.cables);
    if (chk.noPower) return { ok: false, reason: `no power: ${chk.noPower}` };
    this.powered = true;
    this.note("power", "powered on");
    this.coldBoot();
    return { ok: true, powered: true };
  }

  /** Clear a PSU hard trip and reboot (the player flips the switch). */
  powerCycle(): void {
    this.thermal.powerCycle();
    if (this.powered) this.coldBoot();
  }

  /** Plug a key from the tray into the USB port. One program at a time: a key already in the port must come out first. */
  plugKey(keyId: number): Result<{ key: number }> {
    if (this.plugged) return { ok: false, reason: "a key is already plugged in: remove it first" };
    const heldAt = this.held.findIndex((k) => k.id === keyId);
    const key = heldAt >= 0 ? this.held.splice(heldAt, 1)[0] : this.tray.take(keyId);
    if (!key) return { ok: false, reason: `no key ${keyId} in the tray` };
    let program: Uint32Array;
    try {
      program = generate(key.template, key.seed, { row: JOB_ROW, scale: key.scale, hosted: true }).program;
    } catch (e) {
      this.tray.giveBack(key);
      return { ok: false, reason: `the key is unreadable (${(e as Error).message})` };
    }
    if (heldAt < 0) key.pluggedAt = this.baseTick;
    this.plugged = key;
    this.pchKey = { id: key.id, program, done: key.done, result: key.result };
    this.pch.plug(this.pchKey);
    this.progress.firstKeyPlugged = true;
    this.note("key", `key ${key.id} plugged in`);
    return { ok: true, key: key.id };
  }

  /**
   * Remove the plugged key. If it holds a result, the client collects it: payout and reputation are applied now
   * (turnaround is key arrival to this moment). If the job is not finished, it is aborted: the key goes back to the
   * tray unserved, and a machine that was loading or running crashes and reboots.
   */
  ejectKey(): Result<{ payout: number; done: boolean }> {
    const key = this.plugged;
    if (!key) return { ok: false, reason: "no key is plugged in" };
    const phase = this.currentPhase();
    this.plugged = null;
    this.pchKey = null;
    this.pch.unplug();
    if (!key.done) {
      if (this.kernelJobs().some((j) => j.key === key.id)) {
        // Ingested by the OS: the client lets the player keep the key until the result is ready; plug it again to collect.
        this.held.push(key);
        this.note("key", `key ${key.id} ingested: plug it again for the result`);
        return { ok: true, payout: 0, done: false };
      }
      if (!this.os) key.attempts++;
      this.tray.giveBack(key);
      this.note("key", `key ${key.id} pulled before the job finished`);
      if (this.powered && !this.postError && (phase === "loading" || phase === "running" || phase === "writing")) this.coldBoot();
      return { ok: true, payout: 0, done: false };
    }
    const turnaround = this.baseTick - key.arrival;
    const late = this.baseTick > key.deadline;
    const pay = payout(this.cfg, key.work * payMulFor(this.cfg, key.template, key.scale), turnaround, late);
    this.money += pay;
    this.completed++;
    this.avgTurnaround += this.cfg.emaAlpha * (turnaround - this.avgTurnaround);
    this.progress.firstKeyEjected = true;
    if (this.os) {
      this.progress.firstOsJob = true;
      this.freeKernelSlot(key.id); // delivery is the receipt: the kernel's slot for this job is free again
    }
    this.lastCompleted = {
      id: key.id, template: key.template, payout: pay, turnaround, execTicks: key.doneAt - key.pluggedAt, late,
      attempts: key.attempts, completedAt: this.baseTick,
    };
    this.note("payout", `key ${key.id} collected: $${pay}${late ? " (late)" : ""}`);
    return { ok: true, payout: pay, done: true };
  }

  /** Ids of the keys in the tray, oldest first. */
  trayKeyIds(): number[] {
    return this.tray.waiting().map((k) => k.id);
  }

  /** The plugged key's id and whether it holds a result, or null. */
  pluggedKey(): { id: number; done: boolean } | null {
    return this.plugged && { id: this.plugged.id, done: this.plugged.done };
  }

  /** Whether `install(invId)` would succeed now (the machine must be off, so a powered one says no). */
  canInstall(invId: string): boolean {
    const it = this.inventorySnap(true).find((i) => i.id === invId);
    return !!it && it.installable;
  }

  /** Whether an OS is installed. */
  hasOs(): boolean {
    return this.os !== null;
  }

  /** Under an OS: held keys (ingested and unplugged) and whether each has its result ready; plus the queue bound. For bots. */
  osHeld(): { ids: number[]; ready: number[]; queueSlots: number; jobs: number } {
    const jobs = this.kernelJobs();
    return {
      ids: this.held.map((k) => k.id),
      ready: this.held.filter((k) => jobs.some((j) => j.key === k.id && j.state === JobState.Result)).map((k) => k.id),
      queueSlots: this.os?.queueSlots ?? 0,
      jobs: jobs.length,
    };
  }

  /** Under an OS: the plugged key is in the kernel's queue (queued or running), so it can be unplugged and held. For bots. */
  pluggedIngested(): boolean {
    const k = this.plugged;
    return !!k && !k.done && this.kernelJobs().some((j) => j.key === k.id && (j.state === JobState.Queued || j.state === JobState.Running));
  }

  /** Cables that could be plugged in (source part installed) but are not. */
  missingCables(): CableId[] {
    return CABLES.filter((c) => !this.cables[c.id] && !cableBlocked(this.board, c.id)).map((c) => c.id);
  }

  /** Items in the inventory (ids and spec ids). */
  inventoryItems(): readonly { id: string; spec: string }[] {
    return this.inventory;
  }

  // ---------- simulation ----------

  /** Advance one base tick: key arrivals, run the machine if it is on, thermal step, clock rates. */
  advanceBaseTick(): void {
    this.baseTick++;
    this.arrivals();
    const running = this.powered && !this.postError && !this.fault();
    if (running && this.bootDelay > 0) this.bootDelay--;
    else if (running) {
      this.pch.usbTick();
      this.machine.advanceBaseTick();
      this.afterMachine();
    }
    const phase = this.currentPhase();
    const busy = phase === "posting" || phase === "loading" || phase === "running" || phase === "writing"
      || phase === "booting-os" || phase === "ingesting" || phase === "running-os" || phase === "flashing";
    const load = busy ? 1 : this.cfg.idleLoad;
    const diskLoad = this.ports.reduce((a, p) => p.takeActivity() || a, false) ? 1 : this.cfg.idleLoad;
    const boardWasOk = !this.board.burnt;
    this.thermal.step(this.board, { cpu: load, ram: load, display: load, storage: diskLoad }, this.powered);
    this.syncStorage(); // a drive that burnt out drops off the bus
    if (boardWasOk && this.board.burnt) this.note("fault", "the VRM burnt out: board dead: replace the board");
    if (this.powered && busy && !this.board.burnt) {
      // A thermal error or a VRM voltage droop crashes the machine: it reboots and the job restarts from the ROM; no payout for the attempt.
      const cpu = findDevices(this.board, "cpu")[0];
      const why = cpu && this.thermal.errorRoll(cpu.id) ? "thermal error" : this.thermal.vrmErrorRoll() ? "VRM voltage droop" : null;
      if (why) {
        this.errors++;
        if (this.plugged && !this.plugged.done) this.plugged.attempts++;
        this.note("fault", `${why}: the machine crashed and rebooted`);
        this.coldBoot();
      }
    }
    this.syncRates(true);
  }

  // ---------- snapshot and save ----------

  snapshot(): Snapshot {
    const eng = this.machine.engine as PipelineEngine | null;
    const counters: Record<string, number> = {};
    COUNTER_NAMES.forEach((n, i) => { counters[n] = eng?.view ? eng.view.counters[i]! : 0; });
    const rep = this.reputation();
    const cpu = findDevices(this.board, "cpu")[0];
    const cpuSpec = cpu ? deviceSpec(cpu) : undefined;
    const planned = this.plannedBoard();
    const purchases: PurchaseSnap[] = offers(planned).map((s) => {
      const p: PurchaseSnap = { id: s.id, name: s.name, kind: s.kind, price: s.price, affordable: this.money >= s.price };
      const r = applyOffer(boardFromJson(boardToJson(planned)), s.id);
      if (s.kind === "board" && this.powered) p.blocked = BOARD_OFF_REASON;
      else if (!r.ok) p.blocked = r.reason;
      return p;
    });
    for (const o of this.extraOffers()) {
      purchases.push({
        id: o.id, name: o.name, kind: o.kind, price: o.price, affordable: this.money >= o.price,
        ...(o.blocked ? { blocked: o.blocked } : {}), ...(o.later ? { later: true } : {}), ...(o.description ? { description: o.description } : {}),
      });
    }
    const phase = this.currentPhase();
    const live = this.monitorLive();
    const plugged = this.plugged;
    const chk = bootCheck(this.board, this.cables);
    const jobs = this.kernelJobs();
    return {
      money: this.money,
      cycle: this.machine.clock.ticks("cpu"),
      baseTick: this.baseTick,
      queueLength: this.tray.waiting().length,
      queueCap: this.cfg.queueCap,
      request: plugged && {
        id: plugged.id,
        template: plugged.template,
        arrivalTick: plugged.arrival,
        deadlineTick: plugged.deadline,
        payoutEstimate: this.estimate(plugged),
        engineCycle: eng ? eng.cycle : 0,
        attempts: plugged.attempts,
      },
      boardTier: this.board.tier,
      pipe: this.powered && eng?.view ? this.pipeSnap(eng) : null,
      display: this.powered && live ? this.machine.display.text() : "",
      counters,
      completed: this.completed,
      errors: this.errors,
      dropped: this.dropped,
      lastCompleted: this.lastCompleted && { ...this.lastCompleted },
      avgTurnaround: this.avgTurnaround,
      reputation: rep,
      demandRate: demandRate(this.cfg, rep),
      devices: this.board.devices.map((d) => this.deviceSnap(d)),
      board: this.boardSnap(),
      power: { ...this.thermal.power },
      cpuClock: cpu && cpuSpec?.clock ? { value: cpu.clock ?? cpuSpec.clock.base, min: cpuSpec.clock.min, max: cpuSpec.clock.max } : null,
      purchases,
      pendingPurchases: [],
      phase,
      phaseReason: phase === "error" ? (this.postError?.reason ?? this.fault()) : null,
      powered: this.powered,
      bootProgress: this.bootProgress(phase),
      monitorLive: live,
      noPowerReason: chk.noPower,
      postBlocker: chk.post?.reason ?? null,
      inventory: this.inventorySnap(),
      slots: this.slotSnaps(),
      cables: CABLES.map((c) => {
        const blocked = cableBlocked(this.board, c.id);
        return { id: c.id, name: c.name, connected: this.cables[c.id], ...(blocked && !this.cables[c.id] ? { blocked } : {}) };
      }),
      tray: this.tray.waiting().map((k) => this.keySnap(k, jobs)),
      plugged: plugged && this.keySnap(plugged, jobs),
      progress: { ...this.progress },
      log: this.log.map((e) => ({ ...e })),
      storage: this.storageSnaps(),
      os: this.osSnap(jobs),
      held: this.held.map((k) => this.keySnap(k, jobs)),
      keyActivity: this.keyActivity(),
      haltReason: phase !== "halted" ? null : this.pch.phase === PchPhase.Halted ? "job-done" : "no-boot-media",
      keyIgnored: this.keyIgnored(),
      postFailed: !!this.postError,
      patience: {
        mul: this.patience(), targetTurnaround: this.targetTurnaround(), deadlineTicks: this.deadlineTicks(),
        sinceFirstBoot: this.sinceFirstBoot(),
      },
    };
  }

  private deviceSnap(d: InstalledDevice): DeviceSnap {
    const s = deviceSpec(d);
    const t = this.thermal.state(d.id);
    return {
      id: d.id, spec: d.spec, kind: s.kind, name: s.name, slot: d.slot, burnt: !!d.burnt,
      requestedClock: d.clock ?? null,
      effectiveClock: t?.effClock ?? 0,
      tempC: t?.tempC ?? 25,
      powerW: t?.powerW ?? 0,
      throttle: t?.throttle ?? 1,
      unstable: t?.unstable ?? false,
    };
  }

  private slotSnaps(): SlotSnap[] {
    return boardSlots(this.board).map((s) => ({ id: s.id, type: s.type, deviceId: this.board.devices.find((d) => d.slot === s.id)?.id ?? null }));
  }

  private boardSnap(): BoardSnap {
    const t = BOARD_TIERS[this.board.tier]!;
    const v = this.thermal.vrm;
    const sink = findDevices(this.board, "vrm-sink")[0];
    return {
      tier: t.tier, name: t.name, burnt: !!this.board.burnt, features: { ...t.features }, slots: this.slotSnaps(),
      vrm: {
        phases: t.vrm.phases, ampsPerPhase: t.vrm.ampsPerPhase, ripple: t.vrm.ripple,
        tempC: v.tempC, loadRatio: v.loadRatio, efficiency: v.efficiency, throttle: v.throttle, unstable: v.unstable,
        burnt: !!this.board.burnt, errProb: v.errProb, heatW: v.heatW,
        throttleC: t.vrm.throttleC, unstableC: t.vrm.unstableC, damageC: t.vrm.damageC, sinkDeviceId: sink?.id ?? null,
      },
      vrmSink: sink ? this.deviceSnap(sink) : null,
    };
  }

  /** Config-only save (no pipeline, registers or RAM). See docs/SAVE.md. */
  toSave(): SaveV4 {
    const sk = (k: Key): SavedKey => ({ id: k.id, template: k.template, seed: k.seed, scale: k.scale, arrival: k.arrival, deadline: k.deadline });
    const p = this.plugged;
    const plugged: SavedPlugged | null = p && { ...sk(p), attempts: p.attempts, pluggedAt: p.pluggedAt, done: p.done, doneAt: p.doneAt, result: p.result };
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      prngState: this.machine.prng.getState(),
      money: this.money,
      baseTick: this.baseTick,
      nextKeyId: this.nextKeyId,
      completed: this.completed,
      errors: this.errors,
      dropped: this.dropped,
      avgTurnaround: this.avgTurnaround,
      lastCompleted: this.lastCompleted && { ...this.lastCompleted },
      board: boardToJson(this.board),
      inventory: this.inventory.map((i) => ({ ...i })),
      nextInvId: this.nextInvId,
      cables: { ...this.cables },
      // Keys held by the OS come back as plain tray keys: the kernel's queue is RAM and does not survive a load.
      tray: [...this.tray.waiting(), ...this.held].sort((a, b) => a.id - b.id).map(sk),
      plugged,
      tripped: this.thermal.power.tripped,
      progress: { ...this.progress },
      os: this.os && { spec: this.os.spec.id, deviceId: this.os.deviceId },
      firstBootTick: this.firstBootTick,
    };
  }

  /**
   * Rebuild a game from a save (validated; throws Error with a clear message). The machine loads powered off; a
   * plugged key stays plugged and its job restarts from boot at the next power-on. `economy` must match the saving
   * game's. A version 1 save is migrated first (see save.ts).
   */
  static fromSave(input: unknown, economy?: Partial<EconomyConfig>): Game {
    const s = parseSave(input);
    const g = new Game({ seed: s.seed, economy });
    g.board = boardFromJson(s.board);
    g.machine.prng.setState(s.prngState);
    g.money = s.money;
    g.baseTick = s.baseTick;
    g.nextKeyId = s.nextKeyId;
    g.completed = s.completed;
    g.errors = s.errors;
    g.dropped = s.dropped;
    g.avgTurnaround = s.avgTurnaround;
    g.lastCompleted = s.lastCompleted && { ...s.lastCompleted };
    g.inventory = s.inventory.map((i) => ({ ...i }));
    g.nextInvId = s.nextInvId;
    g.cables = { ...s.cables };
    g.progress = { ...s.progress };
    // The patience schedule runs from the first boot; a save without the field (older v4) restarts it at the load tick.
    g.firstBootTick = s.progress.poweredOn ? (s.firstBootTick ?? s.baseTick) : null;
    g.log = [];
    if (s.os) g.formatOs(getOsSpec(s.os.spec)!, s.os.deviceId, false);
    try {
      g.tray.set(s.tray.map((k) => g.rebuild(k)));
      if (s.plugged) {
        const p = s.plugged;
        const key = g.rebuild(p);
        key.attempts = p.attempts;
        key.pluggedAt = p.pluggedAt;
        key.done = p.done;
        key.doneAt = p.doneAt;
        key.result = p.result;
        g.plugged = key;
        g.pchKey = { id: key.id, program: generate(key.template, key.seed, { row: JOB_ROW, scale: key.scale, hosted: true }).program, done: key.done, result: key.result };
        g.pch.plug(g.pchKey);
      }
    } catch (e) {
      throw new Error(`save: cannot regenerate a key (${(e as Error).message})`);
    }
    if (s.tripped) g.thermal.power = { ...g.thermal.power, tripped: true };
    g.powered = false;
    g.syncStorage();
    g.syncRates(false);
    return g;
  }

  // ---------- internals: parts ----------

  private mustInstall(spec: string, invId?: string): void {
    const r = install(this.board, spec);
    if (!r.ok) throw new Error(`starting board: ${r.reason}`);
    if (invId) this.removeItem(invId);
    this.flagInstalled(getSpec(spec)!.kind);
  }

  private removeItem(invId: string): void {
    this.inventory = this.inventory.filter((i) => i.id !== invId);
  }

  private flagInstalled(kind: DeviceKind): void {
    const flag: Partial<Record<DeviceKind, keyof Progress>> = { cpu: "cpuInstalled", psu: "psuInstalled", ram: "ramInstalled", display: "monitorInstalled", storage: "storageInstalled", cooler: "coolerInstalled" };
    const f = flag[kind];
    if (f) this.progress[f] = true;
  }

  /** Unplug cables whose source part is gone. */
  private afterBoardChange(): void {
    for (const c of pruneCables(this.board, this.cables)) this.note("cable", `${CABLES.find((x) => x.id === c)!.name} came unplugged`);
  }

  /**
   * Put `specId` into a slot of `board` (mutates it, restoring it exactly on failure): the given slot, else the first
   * free compatible one, else swap with the installed part of the same kind. Returns the swapped-out device, if any.
   */
  private placeInto(board: Board, specId: string, slotId?: string): Result<{ id: string; slot: string; replaced?: InstalledDevice }> {
    const spec = getSpec(specId);
    if (!spec) return { ok: false, reason: `unknown device "${specId}"` };
    let slot = slotId;
    let occupant: InstalledDevice | undefined;
    if (slot !== undefined) {
      const info = boardSlots(board).find((s) => s.id === slot);
      if (!info) return { ok: false, reason: `board has no slot "${slot}"` };
      if (!slotAccepts(info.type, spec.slot)) return { ok: false, reason: `${spec.name} needs a ${spec.slot} slot, "${slot}" is ${info.type}` };
      occupant = board.devices.find((d) => d.slot === slot);
      if (occupant && deviceSpec(occupant).kind !== spec.kind) return { ok: false, reason: `slot "${slot}" is occupied by ${deviceSpec(occupant).name}` };
    } else {
      slot = freeSlots(board, spec.slot)[0]?.id;
      if (slot === undefined) {
        const slots = boardSlots(board);
        occupant = findDevices(board, spec.kind).find((d) => slotAccepts(slots.find((s) => s.id === d.slot)!.type, spec.slot));
        if (!occupant) return install(board, specId); // fails with the board's own reason
        slot = occupant.slot;
      }
    }
    if (occupant && occupant.id === this.os?.deviceId) return { ok: false, reason: `the OS is installed on ${deviceSpec(occupant).name}: uninstall the OS first` };
    if (spec.kind === "cooler" && !findDevices(board, "cpu").length) return { ok: false, reason: "install the CPU first: the cooler mounts on it" };
    const backup = boardToJson(board);
    if (occupant) uninstall(board, occupant.id);
    const r = install(board, specId, slot);
    if (!r.ok) {
      const b = boardFromJson(backup);
      board.devices = b.devices;
      board.nextId = b.nextId;
      return r;
    }
    return occupant ? { ...r, replaced: occupant } : r;
  }

  /**
   * The best machine you could build from what you own: the installed board with every inventory item that is an
   * upgrade applied (lowest tier first, a part never replaces a better one). For validating and listing purchases.
   */
  private plannedBoard(): Board {
    const b = boardFromJson(boardToJson(this.board));
    const tierOf = (id: string): number => (boardTierOf(id) !== undefined ? -1 : getSpec(id)!.tier);
    // Storage drives and OSes are not one-per-machine upgrades: they never replace a part in the plan.
    const planned = this.inventory.filter((it) => !getOsSpec(it.spec) && getSpec(it.spec)?.kind !== "storage");
    for (const it of planned.sort((a, c) => tierOf(a.spec) - tierOf(c.spec))) {
      const spec = getSpec(it.spec);
      const have = spec ? findDevices(b, spec.kind)[0] : undefined;
      if (have && deviceSpec(have).tier >= spec!.tier && !have.burnt) continue;
      applyOffer(b, it.spec);
    }
    return b;
  }

  private inventorySnap(ignorePower = false): InventorySnap[] {
    const off = ignorePower || !this.powered;
    return this.inventory.map((it) => {
      const os = getOsSpec(it.spec);
      if (os) {
        const free: string[] = [];
        let why: string | undefined = os.later ? `${os.name} is not available yet` : this.os ? `${this.os.spec.name} is already installed` : undefined;
        if (why === undefined) {
          for (const d of this.board.devices) {
            if (deviceSpec(d).kind !== "storage") continue;
            const block = this.osBlock(os, d);
            if (block) why ??= block;
            else free.push(d.slot);
          }
          if (free.length === 0) why ??= "install a storage drive first";
        }
        const ok = free.length > 0 && off;
        return {
          id: it.id, spec: it.spec, kind: "os" as const, name: os.name, freeSlots: free, swapSlots: [], installable: ok,
          ...(ok ? {} : { reason: !off && free.length > 0 ? "power the machine off first" : why }),
        };
      }
      const tier = boardTierOf(it.spec);
      if (tier !== undefined) {
        const t = boardFromJson(boardToJson(this.board));
        const r = upgradeBoard(t, tier);
        const ok = r.ok && off;
        return {
          id: it.id, spec: it.spec, kind: "board" as const, name: BOARD_TIERS[tier]!.name,
          freeSlots: r.ok ? ["board"] : [], swapSlots: [], installable: ok,
          ...(ok ? {} : { reason: !off ? "power the machine off first" : (r as { reason: string }).reason }),
        };
      }
      const spec = getSpec(it.spec)!;
      const free: string[] = [];
      const swap: string[] = [];
      let why: string | undefined;
      for (const s of boardSlots(this.board)) {
        if (!slotAccepts(s.type, spec.slot)) continue;
        const occ = this.board.devices.find((d) => d.slot === s.id);
        if (occ && deviceSpec(occ).kind !== spec.kind) continue;
        const r = this.placeInto(boardFromJson(boardToJson(this.board)), it.spec, s.id);
        if (r.ok) (occ ? swap : free).push(s.id);
        else why ??= r.reason;
      }
      if (free.length + swap.length === 0) why ??= `no ${spec.slot} slot for ${spec.name}`;
      const installable = free.length + swap.length > 0 && off;
      return {
        id: it.id, spec: it.spec, kind: spec.kind, name: spec.name, freeSlots: free, swapSlots: swap, installable,
        ...(installable ? {} : { reason: !off ? "power the machine off first" : why }),
      };
    });
  }

  // ---------- internals: storage and the OS ----------

  /** The drive's media for an installed storage device (created blank the first time). */
  private diskFor(d: InstalledDevice): Disk {
    let disk = this.disks.get(d.id);
    if (!disk) {
      const s = deviceSpec(d) as StorageSpec;
      disk = new Disk(s.capacityBytes, s.latencyTicks, s.blockTicks);
      this.disks.set(d.id, disk);
    }
    return disk;
  }

  /** Attach each working drive to its port (a burnt or removed drive drops off the bus). */
  private syncStorage(): void {
    for (const port of this.ports) {
      const d = this.board.devices.find((x) => x.slot === port.name && deviceSpec(x).kind === "storage" && !x.burnt);
      port.attach(d ? this.diskFor(d) : null);
    }
  }

  /** The port the OS boots from, if its drive works. */
  private osPort(): StoragePort | null {
    if (!this.os) return null;
    const d = this.board.devices.find((x) => x.id === this.os!.deviceId);
    if (!d || d.burnt) return null;
    const port = this.ports.find((p) => p.name === d.slot);
    return port?.media ? port : null;
  }

  /** The kernel's job table, read straight from RAM (empty unless the kernel is up). */
  private kernelJobs(): KernelJob[] {
    if (!this.powered || !this.pch.osMode || this.postError) return [];
    const bus = this.machine.bus;
    const out: KernelJob[] = [];
    for (let i = 0; i < KDATA_SLOTS; i++) {
      const at = KDATA_BASE + i * KSLOT_BYTES;
      const state = bus.load32(at + KSLOT.STATE);
      if (state === JobState.Free) continue;
      out.push({ slot: i, state, key: bus.load32(at + KSLOT.KEY), len: bus.load32(at + KSLOT.LEN), seq: bus.load32(at + KSLOT.SEQ) });
    }
    return out;
  }

  private freeKernelSlot(keyId: number): void {
    for (const j of this.kernelJobs()) if (j.key === keyId) this.machine.bus.store32(KDATA_BASE + j.slot * KSLOT_BYTES + KSLOT.STATE, JobState.Free);
  }

  /** Power off or reboot loses the kernel's queue (it is RAM): the client takes back every ingested key unserved. */
  private returnHeld(): void {
    for (const k of this.held) this.tray.giveBack(k);
    this.held = [];
  }

  /** Why the OS cannot go on this drive, or null. */
  private osBlock(os: OsSpec, d: InstalledDevice): string | null {
    const s = deviceSpec(d);
    if (d.burnt) return `${s.name} is burnt out`;
    const ram = this.installedRamBytes();
    if (ram < os.minRamBytes) return `${os.name} needs ${os.minRamBytes / 1024}K of RAM, only ${ram / 1024}K installed`;
    const disk = this.diskFor(d);
    const need = os.diskBytes + SPOOL_BLOCKS_PER_JOB * BLOCK_BYTES;
    const free = disk.capacityBytes - disk.usedBytes;
    if (free < need) return `${os.name} needs ${need / 1024}K free on ${s.name}, only ${Math.floor(free / 1024)}K free`;
    return null;
  }

  private installOs(item: InvItem, os: OsSpec, slotId?: string): Result<{ deviceId: string | null; slot: string }> {
    if (this.powered) return { ok: false, reason: "power the machine off first" };
    if (os.later) return { ok: false, reason: `${os.name} is not available yet` };
    if (this.os) return { ok: false, reason: `${this.os.spec.name} is already installed: uninstall it first` };
    const drives = this.board.devices.filter((d) => deviceSpec(d).kind === "storage" && (slotId === undefined || d.slot === slotId));
    if (drives.length === 0) return { ok: false, reason: slotId === undefined ? "install a storage drive first" : `no storage drive in slot "${slotId}"` };
    let why = "";
    for (const d of drives) {
      const block = this.osBlock(os, d);
      if (block) {
        why ||= block;
        continue;
      }
      this.formatOs(os, d.id, true);
      this.removeItem(item.id);
      this.progress.osInstalled = true;
      this.note("install", `${os.name} installed on ${deviceSpec(d).name}`);
      return { ok: true, deviceId: d.id, slot: d.slot };
    }
    return { ok: false, reason: why };
  }

  /** Write the boot image to the drive and record the OS (also used when loading a save). */
  private formatOs(os: OsSpec, deviceId: string, count = true): void {
    const dev = this.board.devices.find((d) => d.id === deviceId);
    if (!dev || deviceSpec(dev).kind !== "storage") throw new Error("save: the OS drive is missing");
    const disk = this.diskFor(dev);
    const osBlocks = Math.ceil(os.diskBytes / BLOCK_BYTES);
    const queueSlots = queueSlotsFor(os, disk.capacityBytes - disk.usedBytes - os.diskBytes, BLOCK_BYTES);
    if (queueSlots < 1) throw new Error("save: the OS does not fit its drive");
    disk.poke(0, bootImage({ queueSlots, programSlots: os.programSlots, spoolLba: osBlocks, spoolBlocks: SPOOL_BLOCKS_PER_JOB, tier: os.tier }));
    disk.reserve(0, osBlocks);
    if (count) disk.bytesWritten += os.diskBytes;
    this.os = { spec: os, deviceId, queueSlots };
  }

  /** Take the OS off its drive (back to the inventory; the drive is wiped). Only while off. */
  uninstallOs(): Result<{ invId: string }> {
    if (this.powered) return { ok: false, reason: "power the machine off first" };
    const os = this.os;
    if (!os) return { ok: false, reason: "no OS is installed" };
    this.disks.get(os.deviceId)?.format();
    this.os = null;
    this.returnHeld();
    const invId = `inv${this.nextInvId++}`;
    this.inventory.push({ id: invId, spec: os.spec.id });
    this.note("install", `${os.spec.name} removed`);
    return { ok: true, invId };
  }

  /** Storage drives and OS tiers for sale, with the first reason each cannot be bought now. */
  private extraOffers(): PurchaseSnap[] {
    const out: PurchaseSnap[] = [];
    const plan = this.plannedBoard();
    const ownedSpecs = new Set([...this.board.devices.map((d) => d.spec), ...this.inventory.map((i) => i.spec)]);
    const planSlots = boardSlots(plan);
    for (const s of specsOfKind("storage")) {
      if (ownedSpecs.has(s.id)) continue;
      const total = planSlots.filter((x) => slotAccepts(x.type, s.slot)).length;
      const used = this.board.devices.filter((d) => deviceSpec(d).kind === "storage" && deviceSpec(d).slot === s.slot).length
        + this.inventory.filter((i) => getSpec(i.spec)?.kind === "storage" && getSpec(i.spec)!.slot === s.slot).length;
      const o: PurchaseSnap = { id: s.id, name: s.name, kind: "storage", price: s.price, affordable: this.money >= s.price };
      if (total === 0) o.blocked = s.slot === "m2" ? "needs an M.2 slot (bigger board)" : "the board has no SATA slot";
      else if (used >= total) o.blocked = `no free ${s.slot === "m2" ? "M.2" : "SATA"} slot (${total} of ${total} used or owned)`;
      out.push(o);
    }
    const haveDrive = this.board.devices.some((d) => deviceSpec(d).kind === "storage") || this.inventory.some((i) => getSpec(i.spec)?.kind === "storage");
    const planRam = findDevices(plan, "ram").reduce((n, d) => n + (deviceSpec(d) as RamSpec).sizeBytes, 0);
    const haveOs = !!this.os || this.inventory.some((i) => getOsSpec(i.spec));
    for (const os of OS_SPECS) {
      const o: PurchaseSnap = {
        id: os.id, name: os.name, kind: "os", price: os.price, affordable: this.money >= os.price, description: os.description,
        ...(os.later ? { later: true } : {}),
      };
      if (os.later) o.blocked = "planned: not available yet";
      else if (haveOs) o.blocked = "you already own an OS";
      else if (!haveDrive) o.blocked = "needs a storage drive to install on";
      else if (planRam < os.minRamBytes) o.blocked = `needs ${os.minRamBytes / 1024}K of RAM`;
      out.push(o);
    }
    return out;
  }

  private storageSnaps(): StorageSnap[] {
    return this.board.devices.filter((d) => deviceSpec(d).kind === "storage").map((d) => {
      const s = deviceSpec(d) as StorageSpec;
      const disk = this.diskFor(d);
      const port = this.ports.find((p) => p.name === d.slot);
      const clk = this.thermal.state(d.id)?.effClock ?? 0;
      return {
        deviceId: d.id, slot: d.slot, spec: d.spec, name: s.name, burnt: !!d.burnt,
        capacityBytes: disk.capacityBytes, usedBytes: disk.usedBytes, bytesRead: disk.bytesRead, bytesWritten: disk.bytesWritten,
        busy: !!port?.isBusy && port.media === disk, latencyTicks: s.latencyTicks, blockTicks: s.blockTicks,
        bytesPerSecond: Math.round((clk * this.cfg.cpuCyclesPerClock * BLOCK_BYTES) / s.blockTicks),
        hasOs: this.os?.deviceId === d.id,
      };
    });
  }

  private osSnap(jobs: KernelJob[]): OsSnap | null {
    const os = this.os;
    if (!os) return null;
    const dev = this.board.devices.find((d) => d.id === os.deviceId)!;
    const running = jobs.find((j) => j.state === JobState.Running);
    const queued = jobs.filter((j) => j.state === JobState.Queued).sort((a, b) => a.seq - b.seq);
    const results = jobs.filter((j) => j.state === JobState.Result).sort((a, b) => a.seq - b.seq);
    const label = (id: number): string => {
      const k = this.plugged?.id === id ? this.plugged : this.held.find((x) => x.id === id);
      return k ? this.keySnap(k, jobs).label : `key ${id}`;
    };
    const row = (j: KernelJob, state: OsJobSnap["state"], ahead: number): OsJobSnap => ({ slot: j.slot, keyId: j.key, label: label(j.key), state, ahead });
    return {
      spec: os.spec.id, tier: os.spec.tier, name: os.spec.name, deviceId: os.deviceId, slot: dev.slot,
      programSlots: os.spec.programSlots, queueSlots: os.queueSlots, up: this.powered && this.pch.osMode && !this.postError,
      queue: [
        ...(running ? [row(running, "running", 0)] : []),
        ...queued.map((j, i) => row(j, "queued", i + (running ? 1 : 0))),
        ...results.map((j) => row(j, "result", -1)),
      ],
      runningKeyId: running?.key ?? null,
    };
  }

  private stageOf(k: Key, jobs: KernelJob[]): KeyStage {
    if (k.done) return "done";
    const j = jobs.find((x) => x.key === k.id);
    const byState = (s: number): KeyStage => (s === JobState.Result ? "result" : s === JobState.Running ? "running" : "queued");
    if (k === this.plugged) {
      if (this.pch.flashing) return "flashing";
      if (j) return byState(j.state);
      return this.pch.phase === PchPhase.OsIngest ? "ingesting" : "tray";
    }
    return j ? byState(j.state) : this.held.includes(k) ? "queued" : "tray";
  }

  /** Without an OS the ROM looks at the port once at boot: a key that is in the port after that is never read. */
  private keyIgnored(): boolean {
    const k = this.plugged;
    return !!k && !k.done && this.powered && !this.os && !this.postError && this.currentPhase() === "halted";
  }

  private keyActivity(): KeyActivity {
    const k = this.plugged;
    if (!k) return "none";
    if (k.done) return "done";
    if (this.pch.flashing) return "flashing";
    if (!this.pch.ready) return "enumerating";
    return this.pch.phase === PchPhase.OsIngest ? "ingesting" : "none";
  }

  // ---------- internals: machine ----------

  private monitorLive(): boolean {
    const d = findDevices(this.board, "display")[0];
    return !!d && !d.burnt && this.cables.video;
  }

  /** Why a powered machine is stopped (PSU trip, burnt CPU), or null. */
  private fault(): string | null {
    if (!this.powered) return null;
    if (this.board.burnt) return "board dead: replace the board";
    if (this.thermal.power.tripped) return "the PSU overloaded and tripped (power cycle to reset)";
    const cpu = findDevices(this.board, "cpu")[0];
    if (cpu?.burnt) return "the CPU burnt out";
    const psu = findDevices(this.board, "psu")[0];
    if (psu?.burnt) return "the PSU burnt out";
    if (this.os && this.pch.osMode && this.board.devices.find((d) => d.id === this.os!.deviceId)?.burnt) return "the OS drive burnt out";
    return null;
  }

  /** Power-on reset: blank RAM, run the PCH self-test, shadow the ROM into RAM and start the CPU on it. */
  private coldBoot(): void {
    this.machine.ram.fill(0);
    this.machine.display.clear();
    this.machine.display.connected = this.monitorLive();
    this.machine.engine = null;
    this.bootDelay = this.cfg.coldBootTicks;
    this.postError = bootCheck(this.board, this.cables).post;
    if (this.postError) {
      this.pch.powerOff();
      this.machine.display.setText(["PCH BIOS 1.0", "", `POST FAILED: ${this.postError.short}`, "", "POWER OFF TO FIX"]);
      this.note("fault", `POST failed: ${this.postError.reason}`);
      return;
    }
    const ram = findDevices(this.board, "ram").filter((d) => !d.burnt).reduce((n, d) => n + (deviceSpec(d) as RamSpec).sizeBytes, 0);
    const cpu = findDevices(this.board, "cpu")[0]!;
    this.pch.powerOn(ram >> 10, deviceSpec(cpu).tier);
    // A bootable OS drive: the ROM loads the kernel from it. USB then has latency (enumerating, flashing).
    this.syncStorage();
    this.returnHeld();
    for (const p of this.ports) p.reset();
    const boot = this.osPort();
    this.pch.bootDev = boot ? boot.base : 0;
    this.pch.enumTicks = boot ? this.cfg.usbEnumTicks : 0;
    this.pch.flashTicks = boot ? this.cfg.usbFlashTicks : 0;
    if (boot && this.pchKey) this.pch.plug(this.pchKey); // the plugged key enumerates again
    this.bootRead0 = boot?.media?.bytesRead ?? 0;
    this.syncRates(false);
    applyEngine(this.board, this.machine, ROM_IMAGE);
    if (this.progress.firstKeyEjected && this.plugged && !this.plugged.done) this.progress.firstManualCycle = true;
    if (!this.progress.poweredOn) {
      // The first real boot starts the clock: keys waiting from the beginning arrive now, not while the player built the PC.
      this.progress.poweredOn = true;
      for (const k of [...this.tray.waiting(), ...(this.plugged ? [this.plugged] : [])]) {
        k.arrival = this.baseTick;
        k.deadline = this.baseTick + this.deadlineTicks();
      }
    }
    this.firstBootTick ??= this.baseTick;
  }

  /** Current machine phase. */
  currentPhase(): Phase {
    if (!this.powered) return "off";
    if (this.postError || this.fault()) return "error";
    switch (this.pch.phase) {
      case PchPhase.Waiting: return "waiting-for-key";
      case PchPhase.Loading: return "loading";
      case PchPhase.Running: return "running";
      case PchPhase.Writing: return "writing";
      case PchPhase.Done: return "done-remove-key";
      case PchPhase.Halted: case PchPhase.NoMedia: return "halted";
      case PchPhase.OsBoot: return "booting-os";
      case PchPhase.OsIdle: return "idle-os";
      case PchPhase.OsIngest: return "ingesting";
      case PchPhase.OsRun: return "running-os";
      case PchPhase.OsFlash: return "flashing";
      default: return "posting";
    }
  }

  private bootProgress(phase: Phase): number {
    switch (phase) {
      case "posting": return (this.pch.progress / 4) * 0.4;
      case "waiting-for-key": return 0.4;
      case "halted": return this.pch.phase === PchPhase.Halted ? 1 : 0.4;
      case "loading": return 0.4 + 0.6 * Math.min(1, this.pch.wordsRead / Math.max(1, this.pchKey?.program.length ?? 1));
      case "booting-os": {
        const read = (this.osPort()?.media?.bytesRead ?? 0) - this.bootRead0;
        return 0.4 + 0.6 * Math.min(1, read / (BOOT_BLOCKS * BLOCK_BYTES));
      }
      case "running": case "writing": case "done-remove-key": case "idle-os": case "ingesting": case "running-os": case "flashing": return 1;
      default: return 0;
    }
  }

  private afterMachine(): void {
    const k = this.plugged;
    const pk = this.pchKey;
    if (k && pk && pk.done && !k.done) {
      k.done = true;
      k.doneAt = this.baseTick;
      k.result = pk.result;
      this.progress.firstJobDone = true;
      this.note("job", `key ${k.id} holds its result: ${k.result}`);
    }
  }

  /** Set the CPU and display domain rates from the board, then scale by cpuCyclesPerClock. */
  private syncRates(useThermal: boolean): void {
    applyRates(this.board, this.machine, useThermal ? this.thermal : undefined);
    for (const name of ["cpu", "display", ...STORAGE_PORTS]) {
      const r = this.machine.clock.getRate(name);
      this.machine.clock.setRate(name, { mul: r.mul * this.cfg.cpuCyclesPerClock, div: r.div });
    }
  }

  private pipeSnap(eng: PipelineEngine): { stages: StageSnap[] } {
    const v = eng.view;
    const t = v.timeline;
    const stages: StageSnap[] = [];
    for (let i = 0; i < 5; i++) {
      const kind = v.stageKind[i]!;
      const id = v.stageId[i]!;
      let text = "";
      if (kind === 1 && id >= 0) {
        const row = id % t.rows;
        if (t.id[row] === id) text = disassemble(t.word[row]!);
      }
      stages.push({
        kind, id, op: text.split(" ")[0] ?? "", text, cause: v.stageCause[i]!, stalled: v.stageStalled[i]! !== 0,
      });
    }
    return { stages };
  }

  // ---------- internals: keys and economy ----------

  private installedRamBytes(): number {
    return findDevices(this.board, "ram").filter((d) => !d.burnt).reduce((n, d) => n + (deviceSpec(d) as RamSpec).sizeBytes, 0);
  }

  private rebuild(r: SavedKey): Key {
    const g = generate(r.template, r.seed, { scale: r.scale });
    return {
      id: r.id, arrival: r.arrival, template: r.template, seed: r.seed, scale: r.scale, deadline: r.deadline,
      work: runReference(g).steps, type: /^# (?:\S*\.)?(\w+) request/.exec(g.asm)?.[1] ?? "cli", jobNo: g.meta.params.jobId,
      attempts: 1, pluggedAt: 0, done: false, doneAt: 0, result: "",
    };
  }

  /** A key arrives from a client: it goes in the tray, or the client gives up if the tray is full. */
  private enqueue(template: string, scale = 1): boolean {
    const seed = this.machine.prng.nextU32();
    if (this.tray.waiting().length >= this.cfg.queueCap) {
      this.dropped++;
      // The client takes the key back: that counts against the turnaround average, so it costs reputation.
      this.avgTurnaround += this.cfg.emaAlpha * (this.cfg.giveUpTurnaround * this.patience() - this.avgTurnaround);
      this.note("drop", "tray full: a client gave up");
      return false;
    }
    const key = this.rebuild({ id: this.nextKeyId++, template, seed, scale, arrival: this.baseTick, deadline: this.baseTick + this.deadlineTicks() });
    this.tray.offer(key);
    return true;
  }

  private arrivals(): void {
    const rate = demandRate(this.cfg, this.reputation());
    const prng = this.machine.prng;
    // Two draws per tick whatever happens, so the PRNG stream does not depend on state.
    const hit = prng.next() < rate;
    const pick = prng.next();
    // No clients before the first boot: the market opens when the player's PC first comes up.
    if (hit && this.progress.poweredOn) {
      const m = pickTemplate(this.cfg, this.installedRamBytes(), pick, this.baseTick);
      this.enqueue(m.template, m.scale);
    }
  }

  /** Turnaround that drives reputation: the average, or the oldest waiting key's age if that is worse. */
  private serviceTurnaround(): number {
    const waiting = [...this.tray.waiting(), ...this.held];
    const oldest = waiting.reduce<Key | undefined>((o, k) => (!o || k.arrival < o.arrival ? k : o), undefined);
    const age = oldest && this.progress.poweredOn ? this.baseTick - oldest.arrival : 0;
    return Math.max(this.avgTurnaround, age);
  }

  private reputation(): number {
    return reputation(this.cfg, this.serviceTurnaround(), this.targetTurnaround());
  }

  /** Base ticks since the first boot (0 before it). */
  private sinceFirstBoot(): number {
    return this.firstBootTick === null ? 0 : Math.max(0, this.baseTick - this.firstBootTick);
  }

  /** Client patience multiplier now (docs/GAME.md, patience schedule). */
  private patience(): number {
    return patienceMul(this.cfg, this.sinceFirstBoot());
  }

  /** The turnaround that counts as fine for reputation right now. */
  private targetTurnaround(): number {
    return this.cfg.targetTurnaround * this.patience();
  }

  /** Ticks a key arriving now may take before it is late. */
  private deadlineTicks(): number {
    return Math.round(this.cfg.deadlineTicks * this.patience());
  }

  private estimate(k: Key): number {
    return payout(this.cfg, k.work * payMulFor(this.cfg, k.template, k.scale), this.cfg.targetTurnaround, false);
  }

  private keySnap(k: Key, jobs: KernelJob[]): KeySnap {
    return {
      stage: this.stageOf(k, jobs),
      id: k.id, template: k.template, type: k.type, jobNo: k.jobNo, label: `#${String(k.jobNo).padStart(2, "0")} ${k.type}`,
      arrivalTick: k.arrival, deadlineTick: k.deadline, age: this.progress.poweredOn ? this.baseTick - k.arrival : 0,
      late: this.baseTick > k.deadline && this.progress.poweredOn,
      payoutEstimate: this.estimate(k), attempts: k.attempts, done: k.done, result: k.result,
    };
  }

  private note(kind: string, text: string): void {
    this.log.push({ tick: this.baseTick, kind, text });
    if (this.log.length > LOG_CAP) this.log.shift();
  }
}
