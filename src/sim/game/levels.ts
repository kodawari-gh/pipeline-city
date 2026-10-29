// Player levels (docs/PROGRESSION.md): the CLIENT BASE score, the 18 levels and what each changes, the unlock table, the
// job classes with their needs and the arrival mix. Pure data plus small helpers; no DOM. ALL NUMBERS ARE PLACEHOLDERS,
// kept in this one file (the LEVELS rows and the JOB_CLASSES) so the balance pass touches one place.

import { BOARD_TIERS, CASE_TIERS, getSpec } from "../board";
import { getIspSpec, getRouterSpec, ispByTier } from "../net";
import { getOsSpec } from "../os";

// ---------- job classes and needs ----------

/** What a job needs from the machine to run. Met when the device is installed and working when the job would be picked. */
export type Need =
  | { kind: "os"; min: number } | { kind: "storage"; minTier: number } | { kind: "net"; minTier?: number }
  | { kind: "tpm"; minTier?: number } | { kind: "ecc" } | { kind: "gpu"; minTier: number } | { kind: "npu" } | { kind: "cores"; min: number } | { kind: "ram"; minBytes: number };

export type JobClassId = "cli" | "scan" | "db" | "web" | "secure" | "gpu" | "npu" | "hpc";

export interface JobClassDef {
  id: JobClassId;
  /** Generator template the job's program comes from ("cli" picks log/calc/checksum by seed). */
  template: string;
  scale: number;
  /** Payout multiplier for this class (heavier work pays more per instruction). */
  payMul: number;
  needs: Need[];
  /** The level that introduces the class: its share ramps in from there. */
  firstLevel: number;
  /** Ticks the share takes to ramp from 0 to its table value after `firstLevel` is reached. */
  rampTicks: number;
  /** Heavy classes arrive more with a good reputation and less with a bad one (docs/PROGRESSION.md "Shift with reputation"). */
  heavy: boolean;
  /** PLACEHOLDER: the class has no generator template or device of its own yet. Its jobs borrow `template`, arrive and expire. */
  placeholder?: boolean;
  /**
   * Latency SLA (docs/NETWORK.md "Web jobs"): ticks after arrival, at 1x patience, within which the job pays in full. Later the
   * pay falls in a line to the late factor at the deadline. Scaled by the level's patience like the deadline. Absent: no SLA.
   */
  slaTicks?: number;
}

export const JOB_CLASSES: readonly JobClassDef[] = [
  { id: "cli", template: "cli", scale: 1, payMul: 1, needs: [], firstLevel: 1, rampTicks: 0, heavy: false },
  { id: "scan", template: "cli.scan", scale: 4, payMul: 2, needs: [], firstLevel: 5, rampTicks: 300, heavy: false },
  // The in-memory index: a 32K table at virtual 0x10000, so it needs RAM that reaches past it (96K), an OS and a SATA SSD or better.
  { id: "db", template: "db.index", scale: 1, payMul: 2, needs: [{ kind: "os", min: 1 }, { kind: "storage", minTier: 1 }, { kind: "ram", minBytes: 0x10000 + 32 * 1024 }], firstLevel: 5, rampTicks: 600, heavy: true },
  // PLACEHOLDERS below: they need devices that do not exist yet, so they are never runnable today (they arrive and expire).
  // The network jobs: what a client asks of a server. Each kind sets its own plan tier (docs/JOBS.md); the class need is a link of any plan.
  { id: "web", template: "web.page", scale: 2, payMul: 2, needs: [{ kind: "net" }], firstLevel: 4, rampTicks: 600, heavy: true, slaTicks: 120 },
  { id: "secure", template: "secure.sign", scale: 4, payMul: 3, needs: [{ kind: "tpm" }, { kind: "ecc" }], firstLevel: 9, rampTicks: 600, heavy: true },
  // The GPU batch job (template gpu.render) needs no card: with one the program offloads its kernel, without one it runs the same work on the CPU, slower and at the same pay (docs/ACCEL.md).
  { id: "gpu", template: "gpu.render", scale: 4, payMul: 3, needs: [], firstLevel: 10, rampTicks: 600, heavy: true },
  // The inference job needs no card: NPU, then GPU, then CPU, slower down the chain at the same pay (docs/ACCEL.md).
  { id: "npu", template: "npu.infer", scale: 4, payMul: 4, needs: [], firstLevel: 12, rampTicks: 600, heavy: true },
  { id: "hpc", template: "cli.scan", scale: 8, payMul: 5, needs: [{ kind: "cores", min: 2 }], firstLevel: 14, rampTicks: 600, heavy: true, placeholder: true },
];

export function jobClass(id: string): JobClassDef | undefined {
  return JOB_CLASSES.find((c) => c.id === id);
}

/** The class of a job made from a plain generator template (a sandbox key, the guided first key, an old save). */
export function classOfTemplate(template: string): JobClassId {
  return template === "cli.scan" ? "scan" : template === "db.index" ? "db" : "cli";
}

/** What the machine offers to jobs. `net` is false until the network phase. */
export interface Caps {
  osTier: number;
  /** Highest tier of a working storage device, -1 if none. */
  storageTier: number;
  net: boolean;
  /** Tier of the network plan (0 when there is no usable link). */
  netTier: number;
  tpm: boolean;
  /** Tier of the best working TPM (0 when there is none). */
  tpmTier: number;
  /** Every working memory stick is error-correcting (a TPM needs it). */
  ecc: boolean;
  gpuTier: number;
  npu: boolean;
  cores: number;
  /** Installed RAM, in bytes. */
  ramBytes: number;
}

export const NO_CAPS: Caps = { osTier: 0, storageTier: -1, net: false, netTier: 0, tpm: false, tpmTier: 0, ecc: false, gpuTier: 0, npu: false, cores: 1, ramBytes: 0 };

/** Short chip text (`NEEDS GPU`) and the long phrase for a refusal. */
export function describeNeed(n: Need): { short: string; long: string } {
  switch (n.kind) {
    case "os": return { short: "OS", long: "an OS" };
    case "storage": return n.minTier >= 1 ? { short: "SSD", long: "a SATA SSD or better" } : { short: "DRIVE", long: "a storage drive" };
    case "net": return n.minTier ? { short: `NET ${n.minTier}`, long: `a ${ispByTier(n.minTier)?.name ?? "faster"} plan or better` } : { short: "NET", long: "a network link" };
    case "tpm": return n.minTier && n.minTier > 1 ? { short: `TPM ${n.minTier}`, long: "a second-generation TPM (Secure module 2)" } : { short: "TPM", long: "a TPM" };
    case "ecc": return { short: "ECC", long: "ECC RAM" };
    case "gpu": return { short: "GPU", long: "a GPU" };
    case "npu": return { short: "NPU", long: "an NPU" };
    case "cores": return { short: "CORES", long: "a multicore CPU" };
    case "ram": return { short: `${n.minBytes / 1024}K RAM`, long: `${n.minBytes / 1024}K of RAM` };
  }
}

function needOk(n: Need, c: Caps): boolean {
  switch (n.kind) {
    case "os": return c.osTier >= n.min;
    case "storage": return c.storageTier >= n.minTier;
    case "net": return c.net && c.netTier >= (n.minTier ?? 0);
    case "tpm": return c.tpm && c.tpmTier >= (n.minTier ?? 0);
    case "ecc": return c.ecc;
    case "gpu": return c.gpuTier >= n.minTier;
    case "npu": return c.npu;
    case "cores": return c.cores >= n.min;
    case "ram": return c.ramBytes >= n.minBytes;
  }
}

/** Whether every need is met, and the long phrases of the ones that are not. */
export function needsMet(needs: readonly Need[], caps: Caps): { ok: boolean; missing: string[] } {
  const missing = needs.filter((n) => !needOk(n, caps)).map((n) => describeNeed(n).long);
  return { ok: missing.length === 0, missing };
}

// ---------- levels ----------

export interface LevelDef {
  level: number;
  name: string;
  /** Client base needed to be at this level. */
  threshold: number;
  /** Multiplies the reputation target, the key deadline and the give-up turnaround. */
  patienceMul: number;
  /** Multiplies every payout. */
  payMul: number;
  /** Multiplies `baseDemandPerTick`. */
  demandMul: number;
  /** Percent of arrivals per class (rows sum to 100). */
  mix: Partial<Record<JobClassId, number>>;
  /** Offer ids that become buyable here (spec ids, `boardN`, `osN`, and planned ids that have no spec yet). */
  unlocks: string[];
}

const row = (level: number, name: string, threshold: number, patienceMul: number, payMul: number, demandMul: number,
  mix: LevelDef["mix"], unlocks: string[]): LevelDef => ({ level, name, threshold, patienceMul, payMul, demandMul, mix, unlocks });

export const LEVELS: readonly LevelDef[] = [
  row(1, "Garage Bench", 0, 4.0, 1.0, 1.0, { cli: 100 }, ["cpu1", "ram1", "cooler1", "psu1", "vsink0"]),
  row(2, "Hobby Shop", 3, 4.0, 1.11, 1.12, { cli: 100 }, ["vsink1", "rsink0", "hdd0", "case1", "board1"]),
  row(3, "Local Gigs", 6, 3.0, 1.23, 1.24, { cli: 100 }, ["ssd1", "os1", "ram1b"]),
  row(4, "Small Office", 9, 2.4, 1.37, 1.36, { cli: 85, web: 15 }, ["router1", "isp1"]),
  row(5, "Storefront", 40, 2.0, 1.52, 1.48, { cli: 40, scan: 25, db: 20, web: 15 }, ["psu2", "ram2", "rsink1", "case2", "board2"]),
  row(6, "Neighbourhood", 110, 1.7, 1.69, 1.6, { cli: 37, scan: 23, db: 22, web: 18 }, ["cpu2", "cooler2", "isp2"]),
  row(7, "District", 155, 1.45, 1.87, 1.72, { cli: 33, scan: 22, db: 24, web: 21 }, ["nvme2", "vsink2", "rsink2", "fan1", "router2", "nic1"]),
  row(8, "Town Hub", 215, 1.25, 2.08, 1.84, { cli: 28, scan: 22, db: 25, web: 25 }, ["cpu3", "os2"]),
  row(9, "Business Park", 285, 1.05, 2.3, 1.96, { cli: 25, scan: 18, db: 20, web: 22, secure: 15 }, ["tpm1", "ram3", "case3", "board3", "isp3", "cpu2f", "cpu2m"]),
  row(10, "Tech Quarter", 360, 0.9, 2.56, 2.08, { cli: 20, scan: 15, db: 15, web: 18, secure: 12, gpu: 20 }, ["gpu1", "psu3", "display1"]),
  row(11, "Campus", 450, 0.8, 2.84, 2.2, { cli: 18, scan: 12, db: 14, web: 18, secure: 12, gpu: 26 }, ["cpu4", "cooler3", "router3", "nic2", "cpu3f", "cpu3m", "ram4"]),
  row(12, "Data Annex", 550, 0.72, 3.15, 2.32, { cli: 15, scan: 10, db: 12, web: 18, secure: 10, gpu: 20, npu: 15 }, ["npu1"]),
  row(13, "Colocation", 650, 0.66, 3.5, 2.44, { cli: 12, scan: 8, db: 12, web: 18, secure: 10, gpu: 20, npu: 20 }, ["tpm2", "os3", "cpu4f", "cpu4m", "ram5"]),
  row(14, "Compute Floor", 770, 0.62, 3.88, 2.56, { cli: 10, scan: 8, db: 10, web: 16, secure: 10, gpu: 18, npu: 16, hpc: 12 }, ["cpu5", "gpu2", "isp4", "os4"]),
  row(15, "Enterprise", 900, 0.58, 4.31, 2.68, { cli: 8, scan: 6, db: 10, web: 16, secure: 10, gpu: 18, npu: 16, hpc: 16 }, ["psu4", "board4", "cpu4w"]),
  row(16, "Hyperscale", 1050, 0.55, 4.78, 2.8, { cli: 6, scan: 5, db: 9, web: 16, secure: 10, gpu: 18, npu: 17, hpc: 19 }, ["gpu3", "npu2", "raid2"]),
  row(17, "Metro Grid", 1200, 0.52, 5.31, 2.92, { cli: 5, scan: 4, db: 8, web: 15, secure: 10, gpu: 18, npu: 18, hpc: 22 }, ["nic3", "router4"]),
  row(18, "Metropolis", 1350, 0.5, 5.9, 3.04, { cli: 4, scan: 3, db: 7, web: 14, secure: 10, gpu: 18, npu: 18, hpc: 26 }, ["isp5"]),
];

export const MAX_LEVEL = LEVELS.length;

/** Items of the start crate: level 1, never gated. */
export const START_CRATE: readonly string[] = ["cpu0", "ram0", "psu0", "cooler0", "display0", "board0"];

/** Items in the unlock table that have no spec in the catalog yet: listed (milestone screen), never purchasable. */
export const PLANNED_ITEMS: Readonly<Record<string, { name: string; kind: string }>> = { fan1: { name: "Case fans", kind: "fan" },
  display1: { name: "Graphics display", kind: "display" },
  cooler3: { name: "Big radiator", kind: "cooler" },
  cpu5: { name: "Multicore CPU", kind: "cpu" },
  board4: { name: "Server board", kind: "board" },
  raid2: { name: "RAID of two NVMe", kind: "raid" },
};

export const isPlannedItem = (id: string): boolean => id in PLANNED_ITEMS;

/** Level a purchasable id unlocks at: 1 for the start crate and for anything the table does not list. */
export function unlockLevelOf(id: string): number {
  for (const l of LEVELS) if (l.unlocks.includes(id)) return l.level;
  return 1;
}

export interface ItemInfo { id: string; name: string; kind: string; planned: boolean }

/** Name and kind of an unlock-table id (real spec, board tier, OS or planned item). */
export function itemInfo(id: string): ItemInfo {
  const planned = PLANNED_ITEMS[id];
  if (planned) return { id, ...planned, planned: true };
  const board = /^board([0-9]+)$/.exec(id);
  if (board) return { id, name: BOARD_TIERS[Number(board[1])]?.name ?? id, kind: "board", planned: false };
  const pcCase = /^case([0-9]+)$/.exec(id);
  if (pcCase) return { id, name: CASE_TIERS[Number(pcCase[1])]?.name ?? id, kind: "case", planned: false };
  const router = getRouterSpec(id);
  if (router) return { id, name: router.name, kind: "router", planned: false };
  const isp = getIspSpec(id);
  if (isp) return { id, name: `${isp.name} plan`, kind: "isp", planned: false };
  const os = getOsSpec(id);
  if (os) return { id, name: os.name, kind: "os", planned: !!os.later };
  const spec = getSpec(id);
  return { id, name: spec?.name ?? id, kind: spec?.kind ?? "?", planned: false };
}

/** Points one delivered job adds to the client base. */
export function pointsFor(reputation: number): number {
  return Math.min(2, Math.max(0.5, reputation));
}

/** The highest level whose threshold the client base has reached (monotonic in the score). */
export function levelFor(clientBase: number): number {
  let n = 1;
  for (const l of LEVELS) if (clientBase >= l.threshold) n = l.level;
  return n;
}

export const levelDef = (level: number): LevelDef => LEVELS[Math.min(MAX_LEVEL, Math.max(1, Math.round(level))) - 1]!;
export const patienceMul = (level: number): number => levelDef(level).patienceMul;
export const levelPayMul = (level: number): number => levelDef(level).payMul;
export const levelDemandMul = (level: number): number => levelDef(level).demandMul;

/**
 * Arrival weights per class at `level`. A class ramps from 0 to its table share over `rampTicks` after its first level
 * was reached (`levelTicks[firstLevel]`; unknown means fully ramped), heavy classes scale with the reputation
 * (clamped 0.5 to 1.5). The weights are not normalised; pick with `r * total`.
 */
export function jobMix(level: number, reputation: number, levelTicks: Readonly<Record<number, number>>, tick: number): [JobClassDef, number][] {
  const shares = levelDef(level).mix;
  const heavy = Math.min(1.5, Math.max(0.5, reputation));
  const out: [JobClassDef, number][] = [];
  for (const c of JOB_CLASSES) {
    const share = shares[c.id];
    if (!share) continue;
    const since = levelTicks[c.firstLevel];
    const ramp = c.rampTicks > 0 && since !== undefined ? Math.min(1, Math.max(0, (tick - since) / c.rampTicks)) : 1;
    out.push([c, share * ramp * (c.heavy ? heavy : 1)]);
  }
  return out;
}

/** Pick a class from `jobMix` with a uniform draw `r` in [0, 1). */
export function pickClass(mix: [JobClassDef, number][], r: number): JobClassDef {
  const total = mix.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [c, w] of mix) {
    if (x < w) return c;
    x -= w;
  }
  return mix[mix.length - 1]![0];
}

// ---------- snapshot data ----------

export interface LevelRowSnap {
  level: number;
  name: string;
  threshold: number;
  patienceMul: number;
  payMul: number;
  unlocks: { id: string; name: string; kind: string; planned: boolean }[];
  /** Job classes that first arrive at this level. */
  newJobs: string[];
}

/** Every level for the milestone screen (static). */
export function levelRows(): LevelRowSnap[] {
  return LEVELS.map((l) => ({
    level: l.level, name: l.name, threshold: l.threshold, patienceMul: l.patienceMul, payMul: l.payMul,
    unlocks: l.unlocks.map(itemInfo), newJobs: JOB_CLASSES.filter((c) => c.firstLevel === l.level).map((c) => c.id),
  }));
}
