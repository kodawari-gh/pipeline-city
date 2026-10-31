import { describe, expect, it } from "vitest";
import { assembleGpu } from "../isa/asm";
import { GPU_TASK_KERNELS, gpuKernelExpected, gpuKernelSource, KERNEL_LAYOUT, type GpuKernelName } from "../kernels";
import { GpuRef, type GpuStep } from "../isa/ref";
import { createGpu, type GpuEngine, type WarpConfig } from "../index";

const MEM = 16384;
const warp = (o: Partial<WarpConfig> = {}): WarpConfig => ({ kind: "warp", lanes: 16, warps: 2, memBytes: MEM, banks: 2, lineWords: 8, globalLatency: 6, ...o });

/** Run an engine to the end; returns every instruction it issued. */
function runAll(eng: GpuEngine, max = 2_000_000): GpuStep[] {
  const steps: GpuStep[] = [];
  while (!eng.halted) {
    const s = eng.step();
    if (s) steps.push(s);
    if (eng.cycles > max) throw new Error("never halted");
  }
  return steps;
}

function boot(cfg: WarpConfig, src: string, data: Record<number, number[]> = {}): GpuEngine {
  const eng = createGpu(cfg);
  eng.mem.set(assembleGpu(src).program);
  for (const [at, ws] of Object.entries(data)) eng.mem.set(ws, Number(at) / 4);
  eng.reset();
  return eng;
}

describe("functional equivalence with the reference interpreter", () => {
  for (const name of GPU_TASK_KERNELS) {
    for (const [lanes, warps] of [[16, 2], [16, 4], [8, 1], [32, 2]] as const) {
      it(`${name} on ${lanes} lanes in ${warps} warp(s)`, () => {
        const p = { lanes, len: 64, phase: 5, level: 3 };
        const src = assembleGpu(gpuKernelSource(name as GpuKernelName, p)).program;
        const eng = createGpu(warp({ lanes, warps }));
        eng.mem.set(src, KERNEL_LAYOUT.code / 4);
        eng.mem.set([p.phase, p.level], KERNEL_LAYOUT.param / 4);
        eng.reset();
        runAll(eng);
        const ref = new GpuRef({ lanes, memBytes: MEM, banks: 1 });
        ref.load(src, KERNEL_LAYOUT.code);
        ref.load([p.phase, p.level], KERNEL_LAYOUT.param);
        ref.run();
        const out = (m: Uint32Array) => Array.from(m.subarray(KERNEL_LAYOUT.out / 4, KERNEL_LAYOUT.out / 4 + p.len), (w) => w | 0);
        expect(out(eng.mem)).toEqual(out(ref.mem));
        expect(out(eng.mem)).toEqual(gpuKernelExpected(name as GpuKernelName, p));
      });
    }
  }

  it("a launch with fewer lanes than the card runs only those lanes, and a warp with none finishes at once", () => {
    const eng = boot(warp(), "lane v1\nvli v2, 9\nvslli v1, v1, 2\nvst v2, 1024(v1)\nhalt");
    eng.reset(0, 5);
    const steps = runAll(eng);
    expect(steps.every((x) => x.warp === 0)).toBe(true);
    expect(eng.instructions).toBe(5);
    expect(Array.from(eng.mem.subarray(256, 262))).toEqual([9, 9, 9, 9, 9, 0]);
  });
});

describe("timing", () => {
  const one = (o: Partial<WarpConfig> = {}) => warp({ lanes: 8, warps: 1, ...o });

  it("independent ALU work issues one a cycle after the fill, then drains", () => {
    const eng = boot(one(), "vli v1, 1\nvli v2, 2\nvadd v3, v1, v2\nvadd v4, v3, v3\nhalt");
    const steps = runAll(eng);
    expect(steps.map((s) => s.startCycle)).toEqual([2, 3, 4, 5, 6]);
    expect(eng.cycles).toBe(6 + 1 + 2);
  });

  it("a load stalls its first consumer for the global latency but not unrelated work", () => {
    const eng = boot(one(), "lane v1\nvslli v1, v1, 2\nvld v2, 1024(v1)\nvli v5, 1\nvadd v3, v2, v2\nhalt", { 1024: [1, 2, 3, 4, 5, 6, 7, 8] });
    const steps = runAll(eng);
    const ld = steps.find((s) => s.name === "vld")!, indep = steps.find((s) => s.name === "vli")!, use = steps.find((s) => s.name === "vadd")!;
    expect(indep.startCycle).toBe(ld.startCycle! + 1);
    // one line, one round: the data is back 1 + the global latency (6) cycles after the issue
    expect(use.startCycle).toBe(ld.startCycle! + 7);
    expect(Array.from(eng.regs[3]!)).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it("a scattered load takes several rounds and holds the memory unit", () => {
    // stride 8 words = one line per lane, 2 banks: 4 rounds
    const eng = boot(one(), "lane v1\nvslli v1, v1, 5\nvld v2, 1024(v1)\nvld v3, 1024(v1)\nhalt");
    const steps = runAll(eng);
    const [a, b] = steps.filter((s) => s.name === "vld") as [GpuStep, GpuStep];
    expect(a.cost).toBe(4);
    expect(a.stall).toBe("bank");
    expect(b.startCycle).toBe(a.startCycle! + 4);
    expect(eng.conflictCycles).toBe(6);
  });

  it("a taken branch costs its warp the branch penalty", () => {
    const eng = boot(one(), "jmp over\nvli v1, 1\nover: vli v2, 2\nhalt");
    const steps = runAll(eng);
    expect(steps.map((s) => s.name)).toEqual(["jmp", "vli", "halt"]);
    expect(steps[1]!.startCycle).toBe(steps[0]!.startCycle! + 1 + 2);
  });

  it("two warps hide latency: both together take fewer cycles than the two run one after the other", () => {
    const chain = "lane v1\nvslli v1, v1, 2\nvld v2, 1024(v1)\nvadd v3, v2, v2\nvst v3, 2048(v1)\nvld v4, 2048(v1)\nvadd v5, v4, v4\nvst v5, 3072(v1)\nhalt";
    const single = boot(one({ lanes: 8 }), chain);
    runAll(single);
    const pair = boot(warp({ lanes: 16, warps: 2 }), chain);
    runAll(pair);
    expect(pair.cycles).toBeLessThan(2 * single.cycles);
    expect(pair.instructions).toBe(2 * single.instructions);
  });

  it("divergence idles only the warp that diverges", () => {
    // lanes 0..11 stay active: warp 0 (lanes 0-7) is all in, warp 1 (lanes 8-15) is half in
    const eng = boot(warp(), "lane v1\nvli v2, 12\nmpush\nmsetlt v1, v2\nvli v3, 1\nmpop\nhalt");
    let masks: number[] = [];
    while (!eng.halted) {
      const s = eng.step();
      if (s?.name === "vli" && s.pc === 16) masks = eng.smViews!()[0]!.warps.map((w) => w.mask);
    }
    expect(masks.at(0)).toBe(0xff);
    // warp 1 ran the vli and the mpop with four lanes off; warp 0 never had one off
    expect(eng.idleLaneSlots).toBe(4 + 4);
  });

  it("a barrier holds the early warp until the late one arrives", () => {
    const prog = (bar: string) => `
      lane v1
      vsrli v2, v1, 3
      vli v3, 0
      vli v4, 6
      vli v5, 0
      mpush
      mseteq v2, v3
      loop: vaddi v4, v4, -1
      msetne v4, v5
      bany loop
      mpop
      ${bar}
      vli v6, 1
      halt`;
    const run = (bar: string) => {
      const steps = runAll(boot(warp(), prog(bar)));
      const lastV6 = (w: number) => steps.filter((s) => s.warp === w && s.name === "vli").at(-1)!.startCycle!;
      return { after1: lastV6(1), barAt: steps.filter((s) => s.name === "bar").map((s) => s.startCycle!) };
    };
    const withBar = run("bar"), without = run("vli v7, 0");
    // warp 1 skips the loop warp 0 spins in; with the barrier it cannot pass until warp 0 has issued its bar
    expect(withBar.after1).toBeGreaterThan(Math.max(...withBar.barAt));
    expect(without.after1).toBeLessThan(withBar.after1);
  });

  it("a warp that finishes releases the others waiting at a barrier", () => {
    const eng = boot(warp(), "lane v1\nvsrli v2, v1, 3\nvli v3, 0\nmpush\nmseteq v2, v3\nbar\nmpop\nvli v6, 1\nhalt");
    expect(() => runAll(eng, 5000)).not.toThrow();
  });
});

describe("golden chart", () => {
  it("two warps over a load chain", () => {
    const eng = boot(warp(), "lane v1\nvslli v1, v1, 2\nvld v2, 1024(v1)\nvadd v3, v2, v2\nvst v3, 2048(v1)\nhalt");
    const rows: string[] = [];
    while (!eng.halted) {
      const c = eng.cycles, s = eng.step();
      rows.push(`${String(c).padStart(2)} ${s ? `w${s.warp} ${s.name}` : "-"}`);
    }
    expect(rows.join("\n")).toMatchInlineSnapshot(`
      " 0 -
       1 -
       2 w0 lane
       3 w1 lane
       4 w0 vslli
       5 w1 vslli
       6 w0 vld
       7 w1 vld
       8 -
       9 -
      10 -
      11 -
      12 -
      13 w0 vadd
      14 w1 vadd
      15 w0 vst
      16 w1 vst
      17 w0 halt
      18 w1 halt
      19 -
      20 -"
    `);
  });
});

describe("against the unpipelined unit", () => {
  it("blur3 over 64 elements takes fewer card cycles on the two-warp SM than on gpu1's unit", () => {
    const cycles = (cfg: Parameters<typeof createGpu>[0]) => {
      const p = { lanes: cfg.lanes, len: 64, phase: 3, level: 2 };
      const eng = createGpu(cfg);
      eng.mem.set(assembleGpu(gpuKernelSource("blur3", p)).program, KERNEL_LAYOUT.code / 4);
      eng.mem.set([p.phase, p.level], KERNEL_LAYOUT.param / 4);
      eng.reset();
      runAll(eng);
      expect(Array.from(eng.mem.subarray(KERNEL_LAYOUT.out / 4, KERNEL_LAYOUT.out / 4 + 64), (w) => w | 0)).toEqual(gpuKernelExpected("blur3", p));
      return eng.cycles;
    };
    const g1 = cycles({ lanes: 8, memBytes: MEM, banks: 1 });
    const g2 = cycles(warp());
    expect(g2).toBeLessThan(g1);
  });
});
