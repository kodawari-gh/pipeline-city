// The game's public shapes: the options, the snapshot the worker posts every tick and the pieces it is made of. Types only.
// game.ts re-exports all of it, so `import { Snapshot } from "./game"` keeps working.

import type { BoardFeatures, CableId, DeviceKind, SlotType } from "../board";
import type { FileKind, FsRun, MountState } from "../machine/fs";
import type { StorageCmd } from "../machine/storage";
import type { GpuView } from "../machine/gpu";
import type { NpuView } from "../machine/npu";
import type { TpmView } from "../machine/tpm";
import type { Binding } from "../net";
import type { DexSnap } from "./jobdex";
import type { JobLogEntry, JobWindow } from "./joblog";
import type { ItemInfo, LevelRowSnap } from "./levels";
import type { CoresSnap, PipeSnap, RamMap } from "./pipesnap";
import type { EconomyConfig } from "./economy";
import type { Progress } from "./save";

export interface GameOptions {
  seed: number;
  /** Overrides for the placeholder economy (tests use this). */
  economy?: Partial<EconomyConfig>;
  /**
   * Start with the machine fully assembled, cables connected, all tutorial milestones reached and the power on
   * (dev and tests). The real app starts bare: an empty board and the starter crate in the inventory.
   */
  preassembled?: boolean;
  /**
   * Sandbox mode (docs/SANDBOX.md): infinite money, everything purchasable, no tutorial, plus the sandbox tools. The
   * physics still applies. With `preassembled` the machine is assembled but left powered off, ready for the power button.
   */
  sandbox?: boolean;
  /**
   * With `sandbox` and `preassembled`: build the most powerful machine the game supports instead of the starter parts (see `buildMaxRig`). The New game dialog's
   * "Assembled machine" asks for it; tests that rely on the starter machine do not.
   */
  maxed?: boolean;
  /** Start at this player level with the client base at its threshold (tests and bots; campaign only, 1 to 18). */
  startLevel?: number;
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
  /** The PC case it sits in (docs/BOARD.md "Cases"): tier, name, the form factor of the biggest board it holds. */
  caseTier: number;
  caseName: string;
  caseForm: string;
  /** Dead board: replace it by buying a board of the same or a higher tier. */
  burnt: boolean;
  features: BoardFeatures;
  slots: SlotSnap[];
  vrm: VrmSnap;
  vrmSink: DeviceSnap | null;
  /** The memory regulator and its heatsink (same shape; its load is the DIMMs' current over 1.2 V). */
  ramVrm: VrmSnap;
  ramSink: DeviceSnap | null;
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
  kind: DeviceKind | "board" | "case" | "os" | "router" | "isp";
  price: number;
  affordable: boolean;
  /** Set if the board would refuse it right now (e.g. PSU too small, no slot). */
  blocked?: string;
  /** A planned tier that cannot be bought yet (locked in the shop). */
  later?: boolean;
  /** Set while the player level is below the item's unlock level (campaign only): show a greyed tile "Level N". */
  locked?: { level: number; name: string };
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
  | "off" | "posting" | "mounting" | "loading" | "running" | "writing" | "halted" | "error"
  | "booting-os" | "idle-os" | "ingesting" | "running-os" | "flashing";

/** Where a key's job stands. Legacy (no OS) keys are "tray", then "done" once the ROM wrote the result. */
export type KeyStage = "tray" | "ingesting" | "queued" | "running" | "result" | "flashing" | "done"
  | "offer" | "downloading" | "spooled" | "uploading";

/** A part you own but have not installed. */
export interface InventorySnap {
  /** Inventory item id (what `install` takes). */
  id: string;
  spec: string;
  kind: DeviceKind | "board" | "case" | "os" | "router";
  name: string;
  /** Free slot ids it fits right now (drop targets). For a board item: ["board"], for a case item ["case"]; for an OS: the storage slots it can go on. */
  freeSlots: string[];
  /** Occupied slot ids it could be swapped into (the old part returns to the inventory). */
  swapSlots: string[];
  /** There is at least one valid target and the machine is off. */
  installable: boolean;
  /** Why not (first reason), when there is no valid target or the machine is on. */
  reason?: string;
  /** What selling this spare returns now (`SELL_RATE` of its price; 0 in the sandbox, where money means nothing). */
  sellPrice?: number;
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
  /** Job class id: cli, scan, db, web, secure, gpu, npu, hpc. */
  cls: string;
  /** Short chips of what the job needs (`["OS", "SSD"]`), empty for a plain job. */
  needs: string[];
  /** The machine can run it now. An unrunnable job can be seen and declined but not plugged; it expires at `expiresTick`. */
  runnable: boolean;
  /** Long phrases of the unmet needs (`["a GPU"]`). */
  missing: string[];
  /** Tick the client takes an unrunnable job back (its deadline). */
  expiresTick: number;
  /** The job can be declined now (waiting: a tray key, or an ingested job that is not running yet). */
  declinable: boolean;
  /**
   * A retired USB key (docs/NETWORK.md "Retired keys"): no reputation hold, silent expiry, free decline. Optional and
   * additive: the sim always sets it; absent means false (old fixtures).
   */
  retired?: boolean;
  /** Web jobs only: the tick by which delivery pays in full (arrival plus the SLA); `payoutEstimate` falls after it. */
  slaTick?: number;
  /** The tick the machine took the job (key plugged, download begun); absent while it is still in the tray or on offer. */
  startedAt?: number;
  /** The tick the job first ran (the kernel began it); `startedAt` to here is the queue. Absent while queued and for older saves. */
  ranAt?: number;
  /** The game was loaded while the machine held this job: `live` counts only since the reload. */
  reloaded?: true;
  /** The tick the result was written, once it is. */
  finishedAt?: number;
  /** While it runs: what the engine has counted since the machine took it (the job log's window, still open). */
  live?: JobWindow;
  /** The job runs on a graphics card, so `live` is the host spinning, not the job's stalls. */
  gpu?: true;
}

/** The player level block (docs/PROGRESSION.md). In a sandbox `level` is the pinned rules level and `sandbox` is true. */
export interface LevelSnap {
  level: number;
  name: string;
  clientBase: number;
  /** Threshold of this level and of the next (null at the last level). */
  floor: number;
  next: number | null;
  /** 0..1 within the level. */
  progress: number;
  patienceMul: number;
  payMul: number;
  demandMul: number;
  /** Base tick of the latest level-up (for the celebration), null if none since the game started or loaded. */
  leveledUpAt: number | null;
  /** What the latest level-up unlocked (empty until one happens). */
  recentlyUnlocked: ItemInfo[];
  /** Every level, for the milestone screen. */
  upcoming: LevelRowSnap[];
  sandbox: boolean;
  /** Sandbox: the job classes switched off for the natural arrivals (empty elsewhere). */
  classesOff: string[];
  /** Sandbox: the kinds of job (job dex ids) switched off for the natural arrivals (empty elsewhere). */
  kindsOff: string[];
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
  /** What the blocks hold, as runs in LBA order (docs/OS.md, filesystem). */
  fs: { runs: FsRun[]; fragmentation: number; byKind: Record<FileKind, number>; files: { id: number; owner: string; kind: FileKind; lost: boolean }[] };
  /** Wear of each 8-block group, percent of its endurance (the worse member of a mirror). */
  wear: number[];
  /** The block the head (or the last command) rests on: the HDD art seeks to it. */
  headLba: number;
  /** The last commands the drive ran, oldest first: the art replays them (what, where, the seek and transfer ticks). */
  cmds: StorageCmd[];
  /** Wear 0..100 (writes against endurance), bad 8-block groups (both members of a mirror), and blocks of files whose data is lost. */
  wearPct: number;
  badGroups: number;
  lostBlocks: number;
  /** Requests the drive queue holds before reads miss, how many are ahead now, and whether this is a mirrored (RAID 1) module. */
  queueDepth: number;
  queued: number;
  mirror: boolean;
  /** The drive's superblock verdict (stays with the drive), the OS's mount phase for it this boot, and the scan or repair progress (0..1). */
  mount: { state: MountState; phase: MountPhase; progress: number };
  /** Formatting this drive: why it cannot be done now (null = it can), and how many datasets a format would lose. */
  format: { why: string | null; datasets: number };
}

/** An open contract offer, with where it would go (or why it cannot go anywhere). */
export interface ContractOfferSnap {
  id: number;
  kind: string;
  name: string;
  client: string;
  hot: boolean;
  bytes: number;
  duration: number;
  readEvery: number;
  /** Lowest storage tier of the drive that may hold it. */
  minDriveTier: number;
  /** Dollars per tick held on a plain drive and on mirrored storage; the fee per missed read; the penalty if the data is lost. */
  rate: number;
  mirrorRate: number;
  fee: number;
  penalty: number;
  /** Ticks until it goes away. */
  expiresIn: number;
  canAccept: boolean;
  why: string | null;
  /** The drive it would go on if accepted now. */
  deviceId: string | null;
  /** Every drive and whether it could hold it (null = yes). */
  drives: { deviceId: string; name: string; why: string | null }[];
}

/** A contract running: the dataset on its drive, its health, the next read and the income. */
export interface ContractSnap {
  id: number;
  kind: string;
  name: string;
  client: string;
  hot: boolean;
  deviceId: string;
  drive: string;
  bytes: number;
  mirrored: boolean;
  duration: number;
  /** Ticks left to hold. */
  left: number;
  /** `ok`: reads can be served now. `unservable`: the OS is down, the drive is not mounted or its queue is full. `lost`: the data is gone. */
  health: "ok" | "unservable" | "lost";
  /** Ticks until the next read request, and the reads waiting for the drive. */
  nextRead: number;
  pending: number;
  served: number;
  missed: number;
  maxMisses: number;
  rate: number;
  earned: number;
  fees: number;
}

export interface ContractsSnap { open: boolean; offers: ContractOfferSnap[]; active: ContractSnap[] }

/** The OS's view of a drive this boot: `unmounted` (no OS up, or the drive is unformatted), then `scanning`, `repairing` and `mounted`. */
export type MountPhase = "unmounted" | "scanning" | "repairing" | "mounted";

/** One line of the health panel. */
export interface HealthItem { level: "ok" | "warn" | "bad"; text: string }

/** One ingested job in the OS queue. */
export interface OsJobSnap {
  /** Kernel table slot (0..7). */
  slot: number;
  keyId: number;
  label: string;
  state: "queued" | "running" | "result";
  /** The job sits in the spool on the drive (always true: every kernel queue row is spooled). */
  persisted: boolean;
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
  /** The job spool on the drive (docs/NETWORK.md "Spool"). `used` counts spooled jobs and the slots reserved for downloads. */
  spool: { slotBytes: number; slots: number; used: number; freeBytes: number; full: boolean };
  /** The spool is full (same as `spool.full`, as a chip field). Optional and additive: absent means false. */
  spoolFull?: boolean;
  /** The OS menu: the spool settings and, per drive, whether it may hold spool slots, why not, and how many it holds now (docs/OS.md "OS menu"). Optional and additive. */
  config?: {
    /** Most queue slots wanted (null: as many as the OS allows) and the most this OS allows. */
    spoolWanted: number | null;
    spoolMax: number;
    drives: { deviceId: string; slot: string; name: string; tier: number; home: boolean; on: boolean; why: string | null; slots: number; freeBytes: number }[];
  };
}

/** The power bill: a flat rate on the energy the wall gave the machine, issued every period and paid by itself from the money. */
export interface BillSnap {
  /** Dollars per Wh and ticks between bills. */
  ratePerWh: number;
  periodTicks: number;
  /** Base tick the next bill is issued, or null before the first power-on (the clock starts then). */
  nextTick: number | null;
  /** Energy since the last bill (Wh) and what it would cost now (whole dollars, rounded up). */
  accruedWh: number;
  accruedCost: number;
  /** Issued and not yet paid (dollars), the tick the wall will be cut for it (null: nothing unpaid), and whether it is cut now. */
  unpaid: number;
  cutTick: number | null;
  cut: boolean;
  /** The last bill issued, and what all bills have cost so far. */
  last: { tick: number; wh: number; amount: number } | null;
  paidTotal: number;
}

/** What the USB port's LED would be doing. */
export type KeyActivity = "none" | "enumerating" | "ingesting" | "flashing" | "done";

export interface GameEvent {
  tick: number;
  /** e.g. "install", "power", "key", "job", "payout", "drop", "fault". */
  kind: string;
  text: string;
}

/** One graphics card as the view draws it: its PCIe slot (`pcie0`..) and what `GpuPort.view()` reports. */
export type GpuSnap = GpuView & { slot: string };
/** An AI card's insides and the PCIe slot it stands in. */
export type NpuSnap = NpuView & { slot: string };

export interface Snapshot {
  money: number;
  /** Sandbox game: money is a constant stand-in for infinity (show a symbol), purchases are free (price 0), the sandbox tools work. */
  sandbox: boolean;
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
  /** The PC case the board sits in (`CASE_TIERS`). */
  caseTier: number;
  /** The motherboard in detail (features, VRM, heatsink). Absent slots are not listed. */
  board: BoardSnap;
  /** Pipeline stage occupants while the machine is powered with a working CPU, else null. */
  pipe: null | PipeSnap;
  /** The logical cores of a multicore CPU while the machine is on (absent with one core): `pipe` follows the selected one. */
  cores?: CoresSnap;
  /** How full the RAM is (the memory sticks show it), while the machine is on. */
  ram?: RamMap | null;
  /** The installed graphics cards' insides (lanes, mask, banks, the last instructions), while the machine is on; absent without a card. */
  gpus?: GpuSnap[];
  /** The installed AI cards' insides (registers, descriptor list, tiles, accumulator, the last steps), while the machine is on; absent without a card. */
  npus?: NpuSnap[];
  /** The secure module's insides (registers, protected mode, sealed values, the last commands), while the machine is on; absent without a module. */
  tpm?: TpmView;
  /** What the monitor shows (POST text, the job's output, REMOVE KEY, ...). Empty when off or no monitor is connected. */
  display: string;
  /** Engine counters since power-on, by name (all zero when no engine). */
  counters: Record<string, number>;
  completed: number;
  /** Thermal errors that crashed the machine and restarted the job from boot. */
  errors: number;
  /** Jobs the OS killed for writing to protected memory (a statistic of this session; not saved). */
  faults?: number;
  /** Bit flips in the running job's memory: fixed by ECC RAM, or kept by plain RAM (this session only). */
  eccCorrected?: number;
  bitFlips?: number;
  /** The CPU's MMU while the paged OS runs a program: TLB size, translations the TLB had and missed, page faults taken (the kernel fixes most of them). Absent without an MMU. */
  mmu?: { tlb: number; hits: number; misses: number; faults: number; on: boolean };
  /** What the OS and the memory look like from outside: bookkeeping that should always add up, and what has gone wrong this session (the Trace panel shows it). */
  health?: HealthItem[];
  /** The job almanac: how far the player has got with each kind of job (docs/JOBS.md). */
  dex?: DexSnap[];
  /** The job log: the last jobs that ended, oldest first, with where their time went (docs/JOBS.md "The log"). */
  jobLog?: JobLogEntry[];
  /** Cloud-storage contracts: the open offers and the running contracts (docs/JOBS.md "Contracts"). */
  contracts?: ContractsSnap;
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
  /** The monitor's own cord is in the wall (the screen is lit): false shows a dark screen, not NO SIGNAL. */
  monitorPowered: boolean;
  /** What the machine takes from the wall right now (W, the parts' draw; a monitor with its cord out takes nothing) and the energy it has taken in total (Wh, one game tick counted as one second: the power bill reads this). */
  energy: { wallW: number; wh: number };
  /** The power bill (docs/GAME.md "The power bill"), or null when there is none (the sandbox, or a game with the rate at 0). */
  bill: BillSnap | null;
  /** Why the power button would do nothing, or null. */
  noPowerReason: string | null;
  /** Why POST would fail now (missing CPU / CPU power / RAM), or null. */
  postBlocker: string | null;
  inventory: InventorySnap[];
  /** Every slot of the board and what sits in it. */
  slots: SlotSnap[];
  cables: CableSnap[];
  /** Where the video cable's PC end is plugged: "board" or a GPU card's slot ("pcie1"); the picture comes from there. */
  videoPort: string;
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
  /** USB port LED: enumerating, ingesting, flashing, done (collect the key). Stays "none" for a key the ROM ignores. */
  keyActivity: KeyActivity;

  // ---- no-OS boot flow and client patience (added with the manual boot loop; all additive) ----
  /** For phase "halted": "job-done" (result written, remove the key) or "no-boot-media" (no key at boot). Otherwise null. */
  haltReason: "job-done" | "no-boot-media" | null;
  /** A key sits in the port of a running no-OS machine that already did its one look at the port: it is ignored until a power cycle. */
  keyIgnored: boolean;
  /** True when a finished key ejects and pays by itself (always, unless a test turns it off): the UI says so instead of "remove the key". */
  autoEject: boolean;
  /** An install queued behind the running job: it happens (power off, install, power on) as soon as the job is done. */
  pendingSwap: { invId: string; slotId: string | null } | null;
  /** The last power-on ended in a POST error (phase "error", `phaseReason` says which part). */
  postFailed: boolean;
  /** Client patience right now: the level's multiplier (docs/PROGRESSION.md). `sinceFirstBoot` is informational. */
  patience: { mul: number; targetTurnaround: number; deadlineTicks: number; sinceFirstBoot: number };

  // ---- levels, job needs and POST time (docs/PROGRESSION.md; all additive) ----
  level: LevelSnap;
  /** Unrunnable jobs the client took back at their deadline (lifetime). */
  expired: number;
  /** Jobs the player declined (lifetime). */
  declined: number;
  /** POST (cold boot) time of the machine as built, in ticks. */
  postTicks: number;

  // ---- network (docs/NETWORK.md; additive) ----
  net: NetSnap;
}

export type LinkState = "no-device" | "no-cable" | "no-os" | "link-up" | "saturated" | "down";

export interface TransferSnap {
  jobId: number;
  label: string;
  dir: "down" | "up";
  totalMB: number;
  doneMB: number;
  percent: number;
  etaTicks: number;
  /** Transfers are RAM: lost on power loss (the spooled job is not). */
  persisted: false;
}

/** The network block (docs/NETWORK.md "Snapshot"). */
export interface NetSnap {
  state: LinkState;
  reason: string | null;
  port: { kind: "board" | "nic" | null; deviceId: string | null; mbps: number };
  router: { id: string; name: string; mbps: number; clients: number; visual: string } | null;
  isp: { id: string; name: string; downMbps: number; upMbps: number; clients: number } | null;
  bandwidth: { downMbps: number; upMbps: number; clients: number; binding: Binding | null };
  transfers: TransferSnap[];
  /** Results read out of the kernel that wait for a client slot to be sent (the router's and plan's `clients` cap both directions). */
  uploadsWaiting: number;
  /** Jobs waiting at the ISP side, oldest first. */
  offers: KeySnap[];
  /** Jobs on the drive spool (queued, running, result or uploading), also while the OS is down. */
  spooled: KeySnap[];
  /** USB keys retired because the link has been up (sticky). */
  usbRetired: boolean;
  usbFallback: { state: "off" | "retired" | "waiting" | "fallback"; deadTicks: number; startsIn: number | null; keyRateMul: number };
  /** Retired keys lying in the USB tray (docs/NETWORK.md "Retired keys"). */
  retiredKeys: number;
  /**
   * The key id of the USB key parked in the port while the kernel has feed work (finished downloads or spooled jobs to
   * ingest) that the virtual NIC key cannot use. Null when nothing blocks the feed. The UI shows a hint.
   */
  portBusyKey: number | null;
  counters: { delivered: number; downloaded: number; uploaded: number; lost: number };
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };
