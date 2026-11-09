// "Build my PC" benchmark: short fixed jobs per task type, scored in work per simulated second. Pure TS, no DOM.
//
// Method. Each kind runs one fixed job on a copy of the machine:
//   compute  cli.crc (CPU clock, branches)           memory   mem.stream (RAM bandwidth, open rows)
//   network  web.page (link plan, router, CPU)       gpu      gpu.render (a card, else not applicable)
//   npu      npu.infer (an NPU, else not applicable)
//   storage  no fixed job reads a drive in place, so the bench drives the OS drive's port directly: 64 sequential
//            block reads, then 64 scattered ones (stride 37). The port's own clock sets the time.
// The job's work is `Key.work` (the reference step count of the generated program, the same on every machine).
// Its time is the game's own execution time: `Game.lastCompleted.execTicks`, where one base tick is one simulated
// second at 1x. So for a job: rate = work / seconds (storage: bytes / seconds).
//
// Score. score = 1000 x rate / REFERENCE_RATE[kind], rounded. REFERENCE_RATE is the rate of `referenceBuild()`, a mid
// machine with every part kind fitted (Mainstream board, 250 W PSU, cpu2, ram2, NVMe with the OS, GbE card with a
// router and a Cable plan, a GPU and an NPU), so that machine scores about 1000 on every kind. A kind the machine
// does not have is null with a note. overall = geometric mean of the scores that are not null (0 when none is).
//
// Copy and determinism. The bench never touches the live game. Each kind runs on a fresh `Game.fromSave` copy of
// the build: no keys, no inventory (so the bot installs nothing from it), no arrivals (`setJobClasses` turns them
// all off), a fixed random state (the player's history does not change the score). Same build -> same score.
//
// Cost. Each kind boots its own copy (a few hundred base ticks) and runs its job. About 0.3 ms per base tick.
// `runBench` yields to the event loop between kinds so the UI can show progress.

import { Game } from "@/worker/game/game";
import { Prng } from "@/core/sim/prng";
import { BLOCK_BYTES, STORAGE_REG } from "@/core/sim/memmap";
import { deviceSpec } from "../../board/sim";
import { Operator } from "../../economy/sim/operator";
import { JOB_CLASSES } from "../../economy/sim/levels";
import { JOB_DEX } from "../../jobs/sim/jobdex";

export type BenchKind = "compute" | "memory" | "storage" | "network" | "gpu" | "npu";
export interface BenchScore { kind: BenchKind; score: number | null; note?: string }
export interface BenchResult { scores: BenchScore[]; overall: number }

/** The kinds in the order they run and print. */
export const BENCH_KINDS: readonly BenchKind[] = ["compute", "memory", "storage", "network", "gpu", "npu"];

/** The fixed job per kind (not storage). Scales keep each run to a few hundred base ticks on the reference build. */
const JOBS: Record<Exclude<BenchKind, "storage">, { template: string; scale: number }> = {
  compute: { template: "cli.crc", scale: 16 },
  memory: { template: "mem.stream", scale: 8 },
  network: { template: "web.page", scale: 8 },
  gpu: { template: "gpu.render", scale: 1 },
  npu: { template: "npu.infer", scale: 4 },
};

/** The storage plan: sequential blocks from 0, then scattered blocks (stride 37 blocks apart). */
const STORAGE_SEQ = 64;
const STORAGE_SCATTER = 64;
const STORAGE_STRIDE = 37;

/** Give up on a job after this many base ticks (a stalled or very weak machine). */
const MAX_JOB_TICKS = 6000;
/** Boot wait (OS up, link up) before the job starts. */
const MAX_BOOT_TICKS = 3000;

/**
 * Rate of the reference build (work per second; storage in bytes per second), measured on `referenceBuild()`.
 * Test `pcbench.test.ts` checks that build scores about 1000 on every kind: re-measure these when the sim's balance moves.
 */
export const REFERENCE_RATE: Record<BenchKind, number> = {
  compute: 34.792,
  memory: 8.271,
  storage: 20605.205,
  network: 6.165,
  gpu: 327.968,
  npu: 27.914,
};

/** The kinds this machine has the hardware for. Storage, network, gpu and npu need a fitted part; compute and memory always apply. */
export function benchKinds(game: Game): BenchKind[] {
  return BENCH_KINDS.filter((k) => applies(game, k).ok);
}

/** Run every requested kind (default: all six, in order). Kinds without the hardware score null. Does not change `game`. */
export async function runBench(game: Game, onProgress?: (kind: BenchKind) => void, kinds?: BenchKind[]): Promise<BenchResult> {
  const list = BENCH_KINDS.filter((k) => (kinds ?? BENCH_KINDS).includes(k));
  const scores: BenchScore[] = [];
  for (const kind of list) {
    onProgress?.(kind);
    scores.push(scoreOf(game, kind));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { scores, overall: overallOf(scores) };
}

/** Geometric mean of the scores that are not null; 0 when none is. */
export function overallOf(scores: readonly BenchScore[]): number {
  const got = scores.map((s) => s.score).filter((s): s is number => s !== null && s > 0);
  if (got.length === 0) return 0;
  return Math.round(Math.exp(got.reduce((sum, s) => sum + Math.log(s), 0) / got.length));
}

/** The mid machine the reference rates were measured on (see the header). Exported for the test and for re-measuring. */
export function referenceBuild(): Game {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true });
  for (const id of ["board2", "psu2", "cpu2", "ram2", "nvme2", "nic1", "router2", "gpu1", "npu1", "os1"]) {
    const b = g.purchase(id);
    if (!b.ok) throw new Error(`reference build: buy ${id}: ${b.reason}`);
    const r = g.install(b.invId);
    if (!r.ok) throw new Error(`reference build: install ${id}: ${r.reason}`);
  }
  const plan = g.purchase("isp2"); // a plan needs no install: it is the link's ISP
  if (!plan.ok) throw new Error(`reference build: isp2: ${plan.reason}`);
  const lan = g.connectLan();
  if (!lan.ok) throw new Error(`reference build: lan: ${lan.reason}`);
  return g;
}

// ---------- applicability ----------

function applies(game: Game, kind: BenchKind): { ok: true } | { ok: false; note: string } {
  const has = (k: string): boolean => game.board.devices.some((d) => !d.burnt && deviceSpec(d).kind === k);
  switch (kind) {
    case "compute":
    case "memory":
      return { ok: true };
    case "storage":
      return has("storage") ? { ok: true } : { ok: false, note: "no storage drive fitted" };
    case "network":
      return has("nic") ? { ok: true } : { ok: false, note: "no network card fitted" };
    case "gpu":
      return has("gpu") ? { ok: true } : { ok: false, note: "no GPU fitted" };
    case "npu":
      return has("npu") ? { ok: true } : { ok: false, note: "no NPU fitted" };
  }
}

// ---------- one kind ----------

function scoreOf(game: Game, kind: BenchKind): BenchScore {
  const ok = applies(game, kind);
  if (!ok.ok) return { kind, score: null, note: ok.note };
  if (!game.sandbox) return { kind, score: null, note: "the bench needs a sandbox game" };
  const rate = kind === "storage" ? storageRate(game) : jobRate(game, kind);
  if ("note" in rate) return { kind, score: null, note: rate.note };
  return { kind, score: Math.round((1000 * rate.value) / REFERENCE_RATE[kind]) };
}

/** A copy of the build, powered and booted (OS up, and the link up for a network job). Never the live game. */
function bootedCopy(game: Game, kind: BenchKind): Game | { note: string } {
  // (fromSave resets the power, the tray and the drives' in-flight commands; the copy starts cold, as a saved game does.)
  const s = game.toSave();
  const g = Game.fromSave({ ...s, tray: [], plugged: null, inventory: [], prngState: new Prng(s.seed).getState() });
  g.setJobClasses(JOB_CLASSES.map((c) => c.id)); // no arrivals: the job is the only key
  if (!g.powered) g.powerButton();
  const op = new Operator(g);
  const ready = (): boolean => (!g.hasOs() || !!g.snapshot().os?.up) && (kind !== "network" || g.linkUsable);
  for (let t = 0; t < MAX_BOOT_TICKS && !ready(); t++) {
    g.advanceBaseTick();
    op.step();
  }
  if (!ready()) return { note: kind === "network" ? "no network link (an OS and a linked router are needed)" : "the OS did not come up" };
  return g;
}

/** Work per second of the fixed job, or a note when it could not run. */
function jobRate(game: Game, kind: Exclude<BenchKind, "storage">): { value: number } | { note: string } {
  const job = JOBS[kind];
  // A job the RAM cannot hold never starts (the key waits for it): say so instead of waiting out the timeout.
  const ram = JOB_DEX.find((e) => e.template === job.template)?.needs?.find((n) => n.kind === "ram");
  if (ram?.kind === "ram" && game.installedRamBytes() < ram.minBytes) {
    return { note: `needs ${Math.ceil(ram.minBytes / 1024)} KB of RAM, this machine has ${Math.floor(game.installedRamBytes() / 1024)} KB` };
  }
  const g = bootedCopy(game, kind);
  if (!(g instanceof Game)) return g;
  const r = g.spawnKey(job.template, job.scale);
  if (!r.ok) return { note: r.reason };
  const work = g.tray.waiting().find((k) => k.id === r.keyId)?.work ?? 0;
  const op = new Operator(g);
  for (let t = 0; t < MAX_JOB_TICKS && g.lastCompleted?.id !== r.keyId; t++) {
    g.advanceBaseTick();
    op.step();
  }
  const done = g.lastCompleted;
  if (!done || done.id !== r.keyId) return { note: `the job did not finish in ${MAX_JOB_TICKS} s` };
  return { value: work / Math.max(1, done.execTicks) };
}

/** Bytes per second of the storage plan on the OS drive (or the first drive), timed by the port's own clock. */
function storageRate(game: Game): { value: number } | { note: string } {
  const g = bootedCopy(game, "storage");
  if (!(g instanceof Game)) return g;
  const port = g.osPort() ?? g.ports.find((p) => p.media !== null) ?? null;
  if (!port?.media) return { note: "no drive is attached" };
  const clock = g.machine.clock;
  const rate = clock.getRate(port.name);
  if (rate.mul <= 0) return { note: "the drive's clock is stopped" };
  const blocks = port.media.blocks;
  const plan: number[] = [];
  for (let i = 0; i < STORAGE_SEQ; i++) plan.push(i % blocks);
  for (let i = 0; i < STORAGE_SCATTER; i++) plan.push((i * STORAGE_STRIDE) % blocks);
  const before = clock.ticks(port.name);
  for (const lba of plan) {
    for (let k = 0; k < 4; k++) port.write(STORAGE_REG.LBA + k, (lba >>> (8 * k)) & 0xff);
    port.write(STORAGE_REG.CMD, 1); // 1 = read block LBA into the buffer
    for (let guard = 0; port.isBusy && guard < 1_000_000; guard++) clock.advance(1);
    if (port.isBusy) return { note: "the drive did not answer" };
  }
  const domainTicks = clock.ticks(port.name) - before;
  const seconds = (domainTicks * rate.div) / rate.mul; // domain ticks per base tick = mul / div; one base tick = 1 s
  return { value: (plan.length * BLOCK_BYTES) / Math.max(1e-9, seconds) };
}
