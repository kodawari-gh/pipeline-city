import { describe, expect, it } from "vitest";
import { Game } from "@/worker/game/game";
import { benchKinds, BENCH_KINDS, referenceBuild, runBench, type BenchKind, type BenchResult } from "./pcbench";

/** A machine with the stock crate only: no drive, card, network, OS, and 16 KB of RAM. */
const stock = (): Game => new Game({ seed: 1, sandbox: true, preassembled: true });

const score = (r: BenchResult, kind: BenchKind): number | null => r.scores.find((s) => s.kind === kind)!.score;

describe("pcbench", () => {
  it("gives the same scores for the same build", async () => {
    const a = await runBench(referenceBuild());
    const b = await runBench(referenceBuild());
    expect(b).toEqual(a);
  }, 30_000);

  it("scores a stronger build higher than a weaker one", async () => {
    const weak = await runBench(stock());
    const strong = await runBench(referenceBuild());
    expect(score(strong, "compute")!).toBeGreaterThan(score(weak, "compute")!);
    expect(strong.overall).toBeGreaterThan(weak.overall);
  }, 30_000);

  it("gives null for a part the machine does not have", async () => {
    const r = await runBench(stock());
    for (const k of ["storage", "network", "gpu", "npu"] as BenchKind[]) {
      expect(score(r, k), k).toBeNull();
      expect(r.scores.find((s) => s.kind === k)!.note).toBeTruthy();
    }
  }, 30_000);

  it("gives null for a job whose RAM the machine lacks", async () => {
    const r = await runBench(stock());
    const memory = r.scores.find((s) => s.kind === "memory")!;
    expect(memory.score).toBeNull();
    expect(memory.note).toMatch(/KB of RAM/);
  }, 30_000);

  it("scores the reference build about 1000 on every kind it has", async () => {
    const r = await runBench(referenceBuild());
    for (const k of BENCH_KINDS) {
      const s = score(r, k);
      expect(s, k).not.toBeNull();
      expect(Math.abs(s! - 1000), k).toBeLessThanOrEqual(10);
    }
  }, 30_000);

  it("lists the kinds a machine has the hardware for", () => {
    expect(benchKinds(referenceBuild())).toEqual([...BENCH_KINDS]);
    expect(benchKinds(stock())).toEqual(["compute", "memory"]);
  });

  it("reports each kind to the progress callback, in order", async () => {
    const seen: BenchKind[] = [];
    await runBench(stock(), (k) => seen.push(k), ["compute", "gpu"]);
    expect(seen).toEqual(["compute", "gpu"]);
  }, 30_000);

  it("leaves the game it was given unchanged", async () => {
    const g = referenceBuild();
    const before = JSON.stringify(g.toSave());
    await runBench(g);
    expect(JSON.stringify(g.toSave())).toBe(before);
    expect(g.powered).toBe(false);
  }, 30_000);
});
