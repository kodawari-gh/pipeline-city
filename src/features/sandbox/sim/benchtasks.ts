// The benchmark's tasks: every program in the job almanac, and the drive test. Pure data, no `Game`: the screens that list the tasks (Build my PC) load this and
// only this; the runner that plays them on a copy of the machine is `pcbench.ts`.
//
// A task is one kind of job (`JOB_DEX`: everyday, memory, network, trust, accelerators, high-performance) at one size. One more is not a job, the drive test: no job
// reads a drive in place, so the runner drives the OS drive's port directly. Cloud-storage contracts are not programs and are not tasks.

import type { Need } from "../../economy/sim/levels";
import { CODE_SOURCE } from "../../jobs/sim/jobcode";
import { DEX_GROUPS, JOB_DEX, taskNeeds, type DexEntry } from "../../jobs/sim/jobdex";

/** The reference machines a task is scored against (`pcbench.ts`, `referenceRig`). */
export type RigId = "mid" | "fibre" | "trust" | "trust2" | "cores2" | "cores4" | "cores8";

export interface BenchTask {
  /** The almanac's id (`fib`, `mandel`, `hpc-fft`), or `disk`. */
  id: string;
  name: string;
  /** The almanac's group (`everyday`, `memory`, `network`, `trust`, `accel`, `hpc`) or `system`. */
  group: string;
  /** The generator template, or null for the drive test. */
  template: string | null;
  /** The size it runs at (`BENCH_SCALE`). */
  scale: number;
  /** What the almanac says it needs from the machine. */
  needs: Need[];
  /** A card does the work (a GPU; for an inference job an NPU or a GPU): the bench asks for one. */
  accel: "gpu" | "npu" | null;
  /** What it leans on, in the order it matters; and what it is, in a line. */
  stresses: string[];
  blurb: string;
  /** The machine its score is against. */
  rig: RigId;
}

export interface BenchGroup { id: string; name: string; color: string; tasks: BenchTask[] }

/** One task's outcome: a score and the time it took, or why there is none. `rate` is work per second (the drive test: bytes per second). */
export interface TaskResult {
  id: string;
  score: number | null;
  /** Simulated seconds the run took (1x). */
  seconds: number | null;
  rate?: number;
  /** Why there is no score. */
  note?: string;
  /** The machine crashed during the run (the first cause, as the game logs it): the time includes the restarts. */
  crashed?: string;
}

/** Geometric mean of the scores that are not null; 0 when none is. */
export function overallOf(results: readonly Pick<TaskResult, "score">[]): number {
  const got = results.map((r) => r.score).filter((s): s is number => s !== null && s > 0);
  if (got.length === 0) return 0;
  return Math.round(Math.exp(got.reduce((sum, s) => sum + Math.log(s), 0) / got.length));
}

/**
 * The size each task runs at: the biggest size the almanac lists for it (`CODE_SOURCE`), which is a size the game sends and the listed needs cover. A bigger
 * size means less of the time is fixed start-up, so the score follows the hardware more. These run at a smaller size: the reference takes over 300 s at the
 * next one up (`db`, `chase`, `transpose`, `hashtab`, `npu`, `deep`), the card jobs stop growing after size 1 but take 60% longer (`vadd` to `sphere`), and
 * `matmul` from size 4 on is a job that a small machine runs 6 times slower.
 */
const BENCH_SCALE: Record<string, number> = {
  matmul: 2, db: 1, chase: 1, transpose: 1, hashtab: 1, npu: 1, deep: 1,
  vadd: 1, saxpy: 1, thresh: 1, blur3: 1, poly: 1, mandel: 1, sphere: 1,
};

const DISK: BenchTask = {
  id: "disk", name: "Disk read", group: "system", template: null, scale: 1, needs: [{ kind: "storage", minTier: 0 }], accel: null, rig: "mid",
  stresses: ["drive speed", "seek time"], blurb: "Read 64 blocks in order, then 64 scattered ones, straight from the drive.",
};

const CORES: Record<string, RigId> = { 2: "cores2", 4: "cores4", 8: "cores8" };

/** The reference machine that has what the job needs: the biggest need decides (a TPM, then the cores, then a fibre plan). */
function rigOf(needs: Need[]): RigId {
  const tpm = needs.find((n): n is Extract<Need, { kind: "tpm" }> => n.kind === "tpm");
  if (tpm) return (tpm.minTier ?? 1) > 1 ? "trust2" : "trust";
  const cores = needs.find((n): n is Extract<Need, { kind: "cores" }> => n.kind === "cores");
  if (cores) return CORES[cores.min] ?? "cores2";
  const net = needs.find((n): n is Extract<Need, { kind: "net" }> => n.kind === "net");
  return (net?.minTier ?? 0) >= 3 ? "fibre" : "mid";
}

function taskOf(e: DexEntry): BenchTask {
  const needs = taskNeeds(e);
  return {
    id: e.id, name: e.name, group: DEX_GROUPS.find((g) => g.ids.includes(e.id))?.id ?? e.cls, template: e.template, needs, rig: rigOf(needs),
    accel: e.template.startsWith("gpu.") ? "gpu" : e.template.startsWith("npu.") ? "npu" : null,
    scale: BENCH_SCALE[e.id] ?? Math.max(...(CODE_SOURCE[e.id]?.scales ?? [e.scale ?? 1])), stresses: e.stresses, blurb: e.blurb,
  };
}

/** Every task, in the almanac's order, then the drive test. A cloud-storage contract is not a program: it has no task. */
export const BENCH_TASKS: readonly BenchTask[] = [
  ...DEX_GROUPS.flatMap((g) => g.ids).map((id) => JOB_DEX.find((e) => e.id === id)).filter((e): e is DexEntry => !!e && !e.contract && !e.planned && !!e.template).map(taskOf),
  DISK,
];

/** The tasks by group, the almanac's groups first (their names and colours) and the drive test's own. */
export const BENCH_GROUPS: readonly BenchGroup[] = [
  ...DEX_GROUPS.map((g) => ({ id: g.id, name: g.name, color: g.color, tasks: BENCH_TASKS.filter((t) => t.group === g.id) })),
  { id: "system", name: "Drive", color: "#9aa7d8", tasks: [DISK] },
].filter((g) => g.tasks.length > 0);

export const benchTask = (id: string): BenchTask | undefined => BENCH_TASKS.find((t) => t.id === id);

/** One of each kind of work, for a quick look at a machine: compute, memory, drive, network, graphics, AI. */
export const QUICK_TASKS: readonly string[] = ["crc", "stream", "disk", "page", "vadd", "npu"];
