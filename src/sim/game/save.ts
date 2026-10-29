// Save format: versioned plain JSON, config only (no pipeline, registers or RAM). See docs/SAVE.md.
// No DOM imports; used by the worker and by the main thread (to validate imports).

import { boardFromJson, CABLE_IDS, getSpec, type BoardJson, type Cables } from "../board";
import { getOsSpec } from "../os";
import { offerPrice } from "./economy";
import { TEMPLATES } from "../gen";
import { jobClass, MAX_LEVEL } from "./levels";

export const SAVE_VERSION = 4;

/** A key (job) as seeds/params only; the program is regenerated on load. */
export interface SavedKey {
  id: number;
  template: string;
  seed: number;
  scale: number;
  arrival: number;
  deadline: number;
  /** Job class id (`cli`, `scan`, `db`, `web`, ...). Optional and additive: absent means derived from the template. */
  cls?: string;
  /**
   * A retired USB key (docs/NETWORK.md "Retired keys"). Optional and additive, no version bump: absent in an old save means
   * not retired, except that the USB keys of a save whose link had been up are retired on load (see `fromSave`).
   */
  retired?: boolean;
  /** The tick the machine took the job (a spooled job keeps it across a save). Optional and additive: absent means unknown. */
  pluggedAt?: number;
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
  /** Both cords from the wall (the PC's and the monitor's) were plugged in (sticky; a save from before them has it true). */
  mainsConnected: boolean;
  poweredOn: boolean;
  firstKeyPlugged: boolean;
  firstJobDone: boolean;
  firstKeyEjected: boolean;
  firstPurchase: boolean;
  /** A CPU cooler was mounted on the CPU (sticky; derived from the board when loading an older save). */
  coolerInstalled: boolean;
  /** A storage device was installed (v3). */
  storageInstalled: boolean;
  /** A power-on with a key plugged happened after the first key was handed back: the manual boot loop was done once. */
  firstManualCycle: boolean;
  /** An OS was installed on a storage device (v3). */
  osInstalled: boolean;
  /** A job ingested and run by the OS was delivered to its client (v3). */
  firstOsJob: boolean;
  /** Network milestones (docs/NETWORK.md "Tutorial"): an ISP plan bought, a router installed, the ethernet cable plugged, the link up, a job delivered over the network. */
  ispBought: boolean;
  routerInstalled: boolean;
  lanConnected: boolean;
  linkUp: boolean;
  firstNetJob: boolean;
}

export const PROGRESS_KEYS: readonly (keyof Progress)[] = [
  "cpuInstalled", "psuInstalled", "ramInstalled", "monitorInstalled", "atxConnected", "cpuPowerConnected",
  "videoConnected", "mainsConnected", "poweredOn", "firstKeyPlugged", "firstJobDone", "firstKeyEjected", "firstPurchase",
  "storageInstalled", "osInstalled", "firstOsJob", "coolerInstalled", "firstManualCycle",
  "ispBought", "routerInstalled", "lanConnected", "linkUp", "firstNetJob",
];

/** Milestones added after the tutorial existed (v3): "all" (an existing or preassembled player) leaves them false. */
const NEW_FLAGS: readonly (keyof Progress)[] = ["storageInstalled", "osInstalled", "firstOsJob", "ispBought", "routerInstalled", "lanConnected", "linkUp", "firstNetJob"];

export const newProgress = (all = false): Progress =>
  Object.fromEntries(PROGRESS_KEYS.map((k) => [k, all && !NEW_FLAGS.includes(k)])) as unknown as Progress;

export interface SavedInventoryItem {
  id: string;
  spec: string;
}

/** The OS installed on a storage device (identified by the installed device's id). */
export interface SavedOs {
  /** Item id, `os1`... */
  spec: string;
  deviceId: string;
}

/** The shape before storage and the OS (v2). Only the migration reads it. */
export interface SaveV2 extends Omit<SaveV3, "version" | "os"> {
  version: 2;
}

/** The shape before the board tier ladder and the VRM (v3). Only the migration reads it. */
export interface SaveV3 extends Omit<SaveV4, "version"> {
  version: 3;
}

export interface SaveV4 {
  version: 4;
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
  /** The installed OS, or null (the machine then boots one job per key). Disk contents are rebuilt on load. */
  os: SavedOs | null;
  /** Base tick of the first boot (the client patience schedule runs from it). Optional: older v4 saves lack it. */
  firstBootTick?: number | null;
  /** Sandbox game (docs/SANDBOX.md). Optional and additive: absent means a campaign game; written only when true. */
  sandbox?: boolean;
  /** The guided tutorial's per-viewer state (skipped, acks...), attached by the UI so a loaded save resumes it. Opaque to the sim; sanitised by the UI. */
  tutorial?: unknown;
  /**
   * Client base score and the derived level (docs/PROGRESSION.md). Optional and additive, no version bump: a save without
   * `clientBase` gets `completed * 1.1` on load (the level is derived from the score, `level` is informational).
   */
  clientBase?: number;
  level?: number;
  /** Base tick at which each level was first reached (drives the job-class ramp). Keys are level numbers. */
  levelTicks?: Record<string, number>;
  /** Jobs the player declined (lifetime) and clients that took an unrunnable job back at its deadline. */
  declined?: number;
  expired?: number;
  /** Network state (docs/NETWORK.md "Save"). Optional and additive, no version bump: absent means no plan, no router, no cable. */
  net?: SavedNet;
  /** The job almanac: per job type, when it first arrived, how many were finished and the fastest run (docs/JOBS.md). Optional and additive, no version bump. */
  jobDex?: Record<string, { seen: number; runs: number; best: number }>;
  /** The job log: the last jobs that ended and where their time went (docs/JOBS.md "The log"). Optional and additive, no version bump. */
  jobLog?: import("./joblog").JobLogEntry[];
  /** The energy meter and the power bill (docs/GAME.md "The power bill"). Optional and additive, no version bump: absent means a fresh meter and no bill yet. */
  bill?: SavedBill;
}

/** The meter (Wh, all time) and the bill's state; `nextTick` and `unpaidSince` are base ticks. */
export interface SavedBill {
  wh: number;
  billedWh: number;
  nextTick: number | null;
  unpaid: number;
  unpaidSince: number | null;
  powerCut: boolean;
  paid: number;
  last: { tick: number; wh: number; amount: number } | null;
}

/** Network state. Transfers are not saved: downloads and finished-but-unspooled jobs come back as offers. */
export interface SavedNet {
  /** Tier of the ISP plan bought (0 none) and of the router installed (0 none). */
  ispTier: number;
  routerTier: number;
  /** Where the ethernet cable is plugged: "board", an installed NIC's device id, or null. */
  lan: string | null;
  networkLinked: boolean;
  deadTicks: number;
  /** Jobs waiting at the ISP side (offers and interrupted downloads). */
  offers: SavedKey[];
  /** Spooled jobs (on the OS drive): they survive power loss and are re-ingested at the next boot. */
  spool: SavedKey[];
}

export type Save = SaveV4;

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
      cables: { atx: true, cpu: true, video: true, lan: false, pcmains: true, monmains: true, pcie: false },
      tray: keys,
      plugged: null,
      tripped: s.tripped,
      progress: newProgress(true),
    };
  },
  /**
   * v3 -> v4: the board tier ladder was renumbered. Old tier 0 (2 DIMMs) becomes Basic (1), old tier 1 becomes Mainstream (2);
   * inventory board ids shift the same way. Every old slot id exists on the new tier, so installed parts stay valid.
   */
  3: (s: SaveV3): SaveV4 => {
    if (!isObj(s.board) || !Array.isArray(s.inventory)) throw new Error("save: not a valid version 3 save");
    const tier = (t: number): number => (t === 0 ? 1 : t === 1 ? 2 : t);
    return {
      ...s, version: 4,
      board: { ...s.board, tier: tier(s.board.tier) },
      inventory: s.inventory.map((i) => {
        const m = /^board([0-9]+)$/.exec(i.spec);
        return m ? { ...i, spec: `board${tier(Number(m[1]))}` } : i;
      }),
    };
  },
  /** v2 -> v3: no storage or OS yet, so the machine keeps the reboot-per-job flow; the three new milestones start false. */
  2: (s: SaveV2): SaveV3 => {
    if (!isObj(s.progress) || !isObj(s.board)) throw new Error("save: not a valid version 2 save");
    return { ...s, version: 3, os: null, progress: { ...s.progress, storageInstalled: false, osInstalled: false, firstOsJob: false } };
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
export function parseSave(input: unknown): SaveV4 {
  const s = migrate(input) as Record<string, unknown>;
  // Saves from before the cooler became an install step have no `coolerInstalled`: it was pre-mounted, so derive it.
  if (isObj(s.progress) && typeof s.progress.coolerInstalled !== "boolean" && isObj(s.board) && Array.isArray(s.board.devices)) {
    s.progress = { ...s.progress, coolerInstalled: (s.board.devices as Array<{ spec?: unknown }>).some((d) => typeof d.spec === "string" && getSpec(d.spec)?.kind === "cooler") };
  }
  // Saves from before the manual boot loop have no `firstManualCycle`: whoever handed back a key had cycled the machine.
  if (isObj(s.progress) && typeof s.progress.firstManualCycle !== "boolean") {
    s.progress = { ...s.progress, firstManualCycle: s.progress.firstKeyEjected === true };
  }
  // Saves from before the network: the ethernet cable is unplugged and the network milestones are not reached.
  if (isObj(s.cables) && typeof (s.cables as Record<string, unknown>).lan !== "boolean") s.cables = { ...s.cables, lan: false };
  // Saves from before the accelerators have no PCIe power lead: it is unplugged (additive, no version bump, like the ethernet cable).
  if (isObj(s.cables) && (s.cables as Record<string, unknown>).pcie === undefined) s.cables = { ...s.cables, pcie: false };
  if (isObj(s.progress)) {
    const p = { ...s.progress } as Record<string, unknown>;
    for (const k of PROGRESS_KEYS) if (typeof p[k] !== "boolean" && NEW_FLAGS.includes(k)) p[k] = false;
    s.progress = p;
  }
  if (s.net !== undefined) {
    const n = s.net;
    if (!isObj(n) || !isNat(n.ispTier) || !isNat(n.routerTier) || !isNat(n.deadTicks) || typeof n.networkLinked !== "boolean"
      || !(n.lan === null || typeof n.lan === "string") || !Array.isArray(n.offers) || !Array.isArray(n.spool)) {
      throw new Error('save: "net" is not a valid network block');
    }
    (n.offers as unknown[]).forEach((r, i) => checkKey(r, `net.offers[${i}]`));
    (n.spool as unknown[]).forEach((r, i) => checkKey(r, `net.spool[${i}]`));
  }
  if (s.firstBootTick !== undefined && s.firstBootTick !== null && !isNat(s.firstBootTick)) throw new Error('save: "firstBootTick" must be a non-negative integer or null');
  if (s.sandbox !== undefined && typeof s.sandbox !== "boolean") throw new Error('save: "sandbox" must be a boolean');
  for (const k of ["clientBase"] as const) {
    if (s[k] !== undefined && (typeof s[k] !== "number" || !Number.isFinite(s[k]) || (s[k] as number) < 0)) throw new Error(`save: "${k}" must be a finite number >= 0`);
  }
  for (const k of ["level", "declined", "expired"] as const) {
    if (s[k] !== undefined && !isNat(s[k])) throw new Error(`save: "${k}" must be a non-negative integer`);
  }
  if (s.level !== undefined && (s.level as number) > MAX_LEVEL) throw new Error(`save: "level" must be at most ${MAX_LEVEL}`);
  if (s.levelTicks !== undefined) {
    const lt = s.levelTicks;
    if (!isObj(lt) || Object.entries(lt).some(([k, v]) => !/^[0-9]+$/.test(k) || !isNat(v))) throw new Error('save: "levelTicks" must map level numbers to ticks');
  }
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
  // the wall cords and their milestone came later: a save without them is read as plugged in (additive, no version bump)
  const optional = (k: string) => k === "pcmains" || k === "monmains" || k === "mainsConnected";
  const flag = (o: unknown, k: string) => { const v = (o as Record<string, unknown>)[k]; return typeof v === "boolean" || (optional(k) && v === undefined); };
  if (!isObj(s.cables) || CABLE_IDS.some((c) => !flag(s.cables, c))) {
    throw new Error('save: "cables" must say whether each cable is connected');
  }
  if (!isObj(s.progress) || PROGRESS_KEYS.some((k) => !flag(s.progress, k))) {
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
  if (s.os !== null) {
    const o = s.os;
    if (!isObj(o) || typeof o.spec !== "string" || typeof o.deviceId !== "string") throw new Error('save: "os" must be {spec, deviceId} or null');
    const os = getOsSpec(o.spec);
    if (!os || os.later) throw new Error(`save: unknown OS "${String(o.spec)}"`);
    const dev = (s.board as unknown as BoardJson).devices.find((d) => d.id === o.deviceId);
    if (!dev || getSpec(dev.spec)?.kind !== "storage") throw new Error('save: "os" must name an installed storage device');
  }
  if (s.bill !== undefined) {
    const b = s.bill;
    const money = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
    const tickOrNull = (x: unknown) => x === null || isNat(x);
    if (!isObj(b) || !money(b.wh) || !money(b.billedWh) || !tickOrNull(b.nextTick) || !isNat(b.unpaid) || !tickOrNull(b.unpaidSince)
      || typeof b.powerCut !== "boolean" || !isNat(b.paid) || (b.unpaid as number) > 0 && b.unpaidSince === null
      || (b.last !== null && (!isObj(b.last) || !isNat(b.last.tick) || !money(b.last.wh) || !isNat(b.last.amount)))) {
      throw new Error('save: "bill" must be the meter and the bill\'s state');
    }
  }
  if (s.lastCompleted !== null && !isObj(s.lastCompleted)) throw new Error('save: "lastCompleted" must be an object or null');
  return s as unknown as SaveV4;
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
  if (r.cls !== undefined && (typeof r.cls !== "string" || !jobClass(r.cls))) throw new Error(`save: ${where}.cls is not a known job class`);
}
