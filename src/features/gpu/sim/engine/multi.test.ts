import { describe, expect, it } from "vitest";
import { assembleGpu } from "../isa/asm";
import { GPU_TASK_KERNELS, gpuKernelExpected, gpuKernelSource, KERNEL_LAYOUT, type GpuKernelName } from "../kernels";
import { GpuRef, type GpuStep } from "../isa/ref";
import { createGpu, type GpuEngine, type MultiConfig, type WarpConfig } from "../index";

const MEM = 16384;
const multi = (o: Partial<MultiConfig> = {}): MultiConfig => ({
  kind: "multi", lanes: 32, sms: 2, warps: 2, memBytes: MEM, banks: 4, lineWords: 8, globalLatency: 6, l1Lines: 8, l1Hit: 2, l2Lines: 64, l2Hit: 4, ...o,
});
const warp = (o: Partial<WarpConfig> = {}): WarpConfig => ({ kind: "warp", lanes: 16, warps: 2, memBytes: MEM, banks: 2, lineWords: 8, globalLatency: 6, ...o });

function runAll(eng: GpuEngine, max = 2_000_000): GpuStep[] {
  const steps: GpuStep[] = [];
  while (!eng.halted) {
    eng.step();
    steps.push(...(eng as unknown as { issuedNow: GpuStep[] }).issuedNow);
    if (eng.cycles > max) throw new Error("never halted");
  }
  return steps;
}

function boot(cfg: MultiConfig, src: string, data: Record<number, number[]> = {}): GpuEngine {
  const eng = createGpu(cfg);
  eng.mem.set(assembleGpu(src).program);
  for (const [at, ws] of Object.entries(data)) eng.mem.set(ws, Number(at) / 4);
  eng.reset();
  return eng;
}

describe("functional equivalence with the reference interpreter", () => {
  for (const name of GPU_TASK_KERNELS) {
    for (const [lanes, sms, warps] of [[32, 2, 2], [16, 2, 1], [32, 4, 1], [16, 2, 2]] as const) {
      it(`${name} on ${lanes} lanes in ${sms} SMs of ${warps} warp(s)`, () => {
        const p = { lanes, len: 64, phase: 5, level: 3 };
        const src = assembleGpu(gpuKernelSource(name as GpuKernelName, p)).program;
        const eng = createGpu(multi({ lanes, sms, warps }));
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

  it("rejects lanes that do not split over the SMs", () => {
    expect(() => createGpu(multi({ lanes: 12, sms: 2, warps: 4 }))).toThrow();
  });

  it("a launch with few lanes leaves the later SMs idle", () => {
    const eng = boot(multi(), "lane v1\nvli v2, 9\nvslli v1, v1, 2\nvst v2, 1024(v1)\nhalt");
    eng.reset(0, 5);
    const steps = runAll(eng);
    expect(steps.every((x) => x.sm === 0)).toBe(true);
    expect(eng.smViews!()[1]!.warps.every((w) => w.state === "done")).toBe(true);
    expect(Array.from(eng.mem.subarray(256, 262))).toEqual([9, 9, 9, 9, 9, 0]);
  });
});

describe("SMs and the shared L2", () => {
  it("both SMs issue in the same cycle and have their own views", () => {
    const eng = boot(multi(), "lane v1\nvli v2, 1\nhalt");
    const rows: number[] = [];
    while (!eng.halted) {
      eng.step();
      rows.push((eng as unknown as { issuedNow: GpuStep[] }).issuedNow.length);
    }
    expect(Math.max(...rows)).toBe(2);
    expect(eng.smViews!()).toHaveLength(2);
    expect(eng.smViews!()[0]!.warps).toHaveLength(2);
  });

  it("the second SM hits the L2 line the first one fetched", () => {
    // every lane loads the same word: SM 0 and SM 1 each ask for line 128
    const eng = boot(multi({ warps: 1 }), "vli v1, 0\nvld v2, 1024(v1)\nhalt", { 1024: [7] });
    runAll(eng);
    const m = (eng as unknown as { memsys: { l2Hits: number; l2Misses: number; l1Misses: number } }).memsys;
    expect(m.l1Misses).toBe(2);
    expect(m.l2Hits + m.l2Misses).toBeGreaterThan(0);
    expect(Array.from(eng.regs[2]!).every((x) => x === 7)).toBe(true);
  });

  it("a barrier only holds the warps of its own SM", () => {
    // SM 1 never reaches a long loop SM 0 spins in; both have a bar after it
    const eng = boot(multi(), "lane v1\nvsrli v2, v1, 4\nvli v3, 0\nvli v4, 6\nvli v5, 0\nmpush\nmseteq v2, v3\nloop: vaddi v4, v4, -1\nmsetne v4, v5\nbany loop\nmpop\nbar\nvli v6, 1\nhalt");
    const steps = runAll(eng);
    const lastV6 = (sm: number) => steps.filter((s) => s.sm === sm && s.name === "vli").at(-1)!.startCycle!;
    expect(lastV6(1)).toBeLessThan(lastV6(0));
  });
});

describe("against the single SM", () => {
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
  it("blur3 over 64 elements takes fewer card cycles on two SMs than on gpu2's one", () => {
    expect(cycles(multi())).toBeLessThan(cycles(warp()));
  });
});
