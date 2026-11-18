import { describe, expect, it } from "vitest";
import { Game } from "@/worker/game/game";
import { JOB_DEX } from "../../jobs/sim/jobdex";
import {
  BENCH_GROUPS, BENCH_TASKS, benchable, benchIssue, benchTask, measureTask, overallOf, QUICK_TASKS, referenceBuild, referenceRig, REFERENCE_RATE, runBenchTasks,
  type TaskResult,
} from "./pcbench";

/** A machine with the stock crate only: no drive, card, network, OS, and 16 KB of RAM. */
const stock = (): Game => new Game({ seed: 1, sandbox: true, preassembled: true });
const task = (id: string) => benchTask(id)!;
const result = (r: TaskResult[], id: string): TaskResult => r.find((x) => x.id === id)!;

describe("the tasks", () => {
  it("has a task for every program in the almanac, and the drive test", () => {
    const programs = JOB_DEX.filter((e) => !e.contract && !e.planned && e.template).map((e) => e.id);
    expect(BENCH_TASKS.map((t) => t.id).sort()).toEqual([...programs, "disk"].sort());
    expect(new Set(BENCH_TASKS.map((t) => t.id)).size).toBe(BENCH_TASKS.length);
  });

  it("lists every task once, under the almanac's groups and then the drive", () => {
    expect(BENCH_GROUPS.flatMap((g) => g.tasks.map((t) => t.id)).sort()).toEqual(BENCH_TASKS.map((t) => t.id).sort());
    expect(BENCH_GROUPS.map((g) => g.id)).toEqual(["everyday", "memory", "network", "trust", "accel", "hpc", "system"]);
    for (const g of BENCH_GROUPS) expect(g.tasks.length, g.id).toBeGreaterThan(0);
  });

  it("names real tasks in the quick set, one of each kind of work", () => {
    for (const id of QUICK_TASKS) expect(benchTask(id), id).toBeDefined();
    expect(new Set(QUICK_TASKS.map((id) => task(id).group)).size).toBeGreaterThanOrEqual(5);
  });

  it("has a reference rate for every task", () => {
    for (const t of BENCH_TASKS) expect(REFERENCE_RATE[t.id], t.id).toBeGreaterThan(0);
  });
});

describe("the score", () => {
  // Every task on the machine built for it scores about 1000 (when the sim's balance moves, the failing line names the rate to put in REFERENCE_RATE).
  it.each(BENCH_TASKS.map((t) => t.id))("scores about 1000 on the reference machine: %s", async (id) => {
    const t = task(id);
    const r = await measureTask(referenceRig(t.rig), t);
    expect(r.note, id).toBeUndefined();
    expect(r.crashed, id).toBeUndefined();
    expect(Math.abs(r.score! - 1000), `${id}: the rate is ${r.rate}`).toBeLessThanOrEqual(10);
  }, 60_000);

  it("gives the same score for the same build, whatever else is picked", async () => {
    const alone = await runBenchTasks(referenceBuild(), ["crc"]);
    const again = await runBenchTasks(referenceBuild(), ["crc"]);
    const among = await runBenchTasks(referenceBuild(), ["fib", "crc", "disk"]);
    expect(again).toEqual(alone);
    expect(result(among, "crc")).toEqual(alone[0]);
  }, 60_000);

  it("scores a stronger build higher than a weaker one", async () => {
    const ids = ["crc", "popcount"];
    const weak = await runBenchTasks(stock(), ids);
    const strong = await runBenchTasks(referenceBuild(), ids);
    for (const id of ids) expect(result(strong, id).score!, id).toBeGreaterThan(result(weak, id).score!);
    expect(overallOf(strong)).toBeGreaterThan(overallOf(weak));
  }, 60_000);

  it("takes the geometric mean of the scores that have one", () => {
    const r = (score: number | null): TaskResult => ({ id: "x", score, seconds: score === null ? null : 1 });
    expect(overallOf([r(1000), r(250), r(null)])).toBe(500);
    expect(overallOf([r(null)])).toBe(0);
    expect(overallOf([])).toBe(0);
  });

  it("does not count the crashes the player's machine had before", async () => {
    const g = referenceBuild();
    g.errors = 7;
    const [r] = await runBenchTasks(g, ["crc"]);
    expect(r!.crashed).toBeUndefined();
    expect(r!.score).not.toBeNull();
  }, 60_000);
});

describe("what cannot run", () => {
  it("says what is missing, from the needs the almanac lists", () => {
    const g = stock();
    expect(benchIssue(g, task("stream"))).toMatch(/Needs .*RAM/);
    expect(benchIssue(g, task("hashtab"))).toMatch(/Needs an OS and .*RAM/);
    expect(benchIssue(g, task("page"))).toMatch(/ISP plan/);
    expect(benchIssue(g, task("secure"))).toMatch(/Needs a TPM and ECC RAM/);
    expect(benchIssue(g, task("attest"))).toMatch(/second-generation TPM/);
    expect(benchIssue(g, task("hpc-reduce"))).toMatch(/Needs a CPU with 2 logical cores and .*OS/);
    expect(benchIssue(g, task("disk"))).toMatch(/storage drive/);
  });

  it("asks for the card in the jobs a card does", () => {
    const g = stock();
    expect(benchIssue(g, task("vadd"))).toMatch(/graphics card/);
    expect(benchIssue(g, task("npu"))).toMatch(/AI card or a graphics card/);
  });

  it("lets a bare machine run the plain jobs", () => {
    const g = stock();
    for (const id of ["log", "crc", "scan"]) expect(benchIssue(g, task(id)), id).toBeNull();
    expect(benchable(g).map((t) => t.id)).toEqual(expect.arrayContaining(["log", "crc", "scan"]));
    expect(benchable(g).map((t) => t.id)).not.toContain("vadd");
    expect(benchable(g, ["crc", "vadd"]).map((t) => t.id)).toEqual(["crc"]);
  });

  it("finds nothing missing on the machine built for the task", () => {
    for (const t of BENCH_TASKS) expect(benchIssue(referenceRig(t.rig), t), t.id).toBeNull();
  }, 60_000);

  it("needs a sandbox game", () => {
    expect(benchIssue(new Game({ seed: 1 }), task("crc"))).toMatch(/sandbox/);
  });

  it("gives a note instead of a score, and still runs the rest", async () => {
    const r = await runBenchTasks(stock(), ["crc", "vadd", "page"]);
    expect(r.map((x) => x.id)).toEqual(["crc", "page", "vadd"]);
    expect(result(r, "crc").score).not.toBeNull();
    expect(result(r, "vadd")).toMatchObject({ score: null, seconds: null });
    expect(result(r, "vadd").note).toMatch(/graphics card/);
    expect(result(r, "page").note).toMatch(/ISP plan/);
  }, 60_000);
});

describe("a run", () => {
  it("reports each task to the callbacks in the almanac's order", async () => {
    const started: string[] = [], got: string[] = [];
    const out = await runBenchTasks(stock(), ["crc", "fib", "vadd"], {
      onStart: (t, i, n) => started.push(`${t.id} ${i + 1}/${n}`),
      onResult: (r, t) => got.push(`${t.id}:${r.id}`),
    });
    expect(started).toEqual(["fib 1/3", "crc 2/3", "vadd 3/3"]);
    expect(got).toEqual(["fib:fib", "crc:crc", "vadd:vadd"]);
    expect(out.map((r) => r.id)).toEqual(["fib", "crc", "vadd"]);
  }, 60_000);

  it("stops when asked, with no result for the task it was in", async () => {
    const stop = { aborted: false }, started: string[] = [];
    const out = await runBenchTasks(stock(), ["log", "calc", "fib"], { stop, onStart: (t) => started.push(t.id), onResult: () => { stop.aborted = true; } });
    expect(started).toEqual(["log"]);
    expect(out.map((r) => r.id)).toEqual(["log"]);
    const mid = { aborted: false };
    const cut = await runBenchTasks(stock(), ["crc"], { stop: mid, onStart: () => setTimeout(() => { mid.aborted = true; }, 0) });
    expect(cut).toEqual([]);
  }, 60_000);

  it("leaves the game it was given unchanged", async () => {
    const g = referenceBuild();
    const before = JSON.stringify(g.toSave());
    await runBenchTasks(g, ["crc", "page", "disk"]);
    expect(JSON.stringify(g.toSave())).toBe(before);
    expect(g.powered).toBe(false);
  }, 60_000);
});
