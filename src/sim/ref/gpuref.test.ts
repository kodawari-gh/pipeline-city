import { describe, expect, it } from "vitest";
import { assembleGpu } from "../asm/gpu";
import {
  GPU_KERNEL_NAMES, gpuKernelExpected, gpuKernelSource, KERNEL_LAYOUT, kernelInputs, mandelCount, type GpuKernelName,
} from "../gen/gpukernels";
import { bankCycles, GpuFault, GpuRef } from "./gpuref";

const card = (lanes = 8, banks = 1) => new GpuRef({ lanes, memBytes: 8 * 1024, banks });

/** Assemble and run a snippet; returns the card. */
function runAsm(src: string, lanes = 8, banks = 1, active = lanes): GpuRef {
  const g = card(lanes, banks);
  g.load(assembleGpu(src).program);
  g.reset(0, active);
  g.run();
  return g;
}

function runKernel(name: GpuKernelName, lanes: number, len: number, banks = 1) {
  const p = { lanes, len, scale: 5 };
  const { a, b } = kernelInputs(len, 7);
  const g = card(lanes, banks);
  g.load(assembleGpu(gpuKernelSource(name, p)).program, KERNEL_LAYOUT.code);
  g.load(a, KERNEL_LAYOUT.a);
  g.load(b, KERNEL_LAYOUT.b);
  g.reset();
  g.run();
  return { g, out: g.read(KERNEL_LAYOUT.out, len), want: gpuKernelExpected(name, p, a, b) };
}

describe("GPU reference interpreter: kernels", () => {
  for (const name of GPU_KERNEL_NAMES) {
    for (const [lanes, len] of [[8, 32], [4, 64], [16, 48]] as const) {
      it(`${name} with ${lanes} lanes over ${len} elements matches the plain-JS result`, () => {
        const { out, want } = runKernel(name, lanes, len);
        expect(out).toEqual(want);
      });
    }
  }

  it("vadd, saxpy and blur3 give known values", () => {
    const g = card(4);
    g.load(assembleGpu(gpuKernelSource("vadd", { lanes: 4, len: 4 })).program);
    g.load([1, 2, 3, 4], KERNEL_LAYOUT.a);
    g.load([10, 20, 30, 40], KERNEL_LAYOUT.b);
    g.run();
    expect(g.read(KERNEL_LAYOUT.out, 4)).toEqual([121, 242, 363, 484]); // a + 12 * b
    expect(gpuKernelExpected("saxpy", { lanes: 4, len: 4, scale: 2 }, [1, 2, 3, 4], [10, 20, 30, 40])).toEqual([34, 68, 102, 136]); // b + 12 * (2 * a)
    // blur3 over a ramp: the edges reuse their own value (3, 6, 9, 12 -> (3+3+6)/3 = 4, 6, 9, (9+12+12)/3 = 11)
    expect(gpuKernelExpected("blur3", { lanes: 4, len: 4 }, [3, 6, 9, 12], [])).toEqual([4, 6, 9, 11]);
  });

  it("blur3 actually runs the edge fix-ups under the mask (lanes sit idle while they run)", () => {
    const { g } = runKernel("blur3", 8, 32);
    expect(g.idleLaneSlots).toBeGreaterThan(0);
  });

  it("mandel is heavily divergent: lanes finish at different times and the loop runs for the slowest", () => {
    const { g, out } = runKernel("mandel", 8, 32);
    expect(new Set(out).size).toBeGreaterThan(3);
    expect(out.some((c) => c === 16)).toBe(true); // inside the set: runs to the iteration cap (16)
    expect(out.some((c) => c < 5)).toBe(true); // far outside: escapes at once
    expect(out).toEqual([...Array(32).keys()].map(mandelCount));
    // an inner-loop pass costs the same however few lanes are still going, so a lot of lane-slots are idle
    expect(g.idleLaneSlots / (g.instructions * 8)).toBeGreaterThan(0.1);
  });

  it("is deterministic and counts cycles", () => {
    const a = runKernel("saxpy", 8, 32).g, b = runKernel("saxpy", 8, 32).g;
    expect(a.cycles).toBe(b.cycles);
    expect(a.cycles).toBeGreaterThanOrEqual(a.instructions);
    expect(a.halted).toBe(true);
  });
});

describe("GPU reference interpreter: divergence and the mask", () => {
  it("a branch runs both sides, each under the mask, and restores it", () => {
    const g = runAsm(`
      lane v1
      vli v2, 3
      vli v6, 0
      mpush
      msetlt v1, v2        # lanes 0..2
      vli v3, 100
      melse                # lanes 3..7
      vli v3, 200
      mpop
      vslli v4, v1, 2
      vst v3, 1024(v4)
      halt`);
    expect(g.read(1024, 8)).toEqual([100, 100, 100, 200, 200, 200, 200, 200]);
    expect(g.mask).toBe(0xff);
    expect(g.idleLaneSlots).toBeGreaterThan(0);
  });

  it("nested ifs narrow and restore", () => {
    const g = runAsm(`
      lane v1
      vli v2, 6
      vli v3, 2
      vli v5, 1
      mpush
      msetlt v1, v2        # 0..5
      mpush
      msetge v1, v3        # 2..5
      vli v4, 7
      mpop
      mpop
      vslli v6, v1, 2
      vst v4, 1024(v6)
      halt`);
    expect(g.read(1024, 8)).toEqual([0, 0, 7, 7, 7, 7, 0, 0]);
  });

  it("bany loops until the last lane is done: each lane counts down its own lane id", () => {
    const g = runAsm(`
      lane v1
      vli v2, 0
      vli v3, 0
      mpush
      msetne v1, v2        # lane 0 is done at once
    loop:
      vaddi v3, v3, 1
      vaddi v1, v1, -1
      msetne v1, v2
      bany loop
      mpop
      lane v4
      vslli v4, v4, 2
      vst v3, 1024(v4)
      halt`);
    expect(g.read(1024, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("only the lanes the launch asked for run", () => {
    const g = runAsm("lane v1\nvaddi v1, v1, 1\nvslli v2, v1, 2\nvst v1, 1020(v2)\nhalt", 8, 1, 3);
    expect(g.read(1024, 8)).toEqual([1, 2, 3, 0, 0, 0, 0, 0]);
  });

  it("a plain jmp skips instructions", () => {
    const g = runAsm("vli v1, 1\njmp over\nvli v1, 99\nover: vli v2, 5\nvst v1, 1024(v0)\nhalt");
    expect(g.read(1024, 1)).toEqual([1]);
  });
});

describe("GPU reference interpreter: card memory banks", () => {
  it("counts the busiest bank's distinct addresses", () => {
    expect(bankCycles([0, 4, 8, 12], 4)).toBe(1); // one word per bank
    expect(bankCycles([0, 16, 32, 48], 4)).toBe(4); // all in bank 0
    expect(bankCycles([0, 0, 0, 0], 4)).toBe(1); // a broadcast shares one access
    expect(bankCycles([0, 4, 16], 4)).toBe(2);
    expect(bankCycles([], 2)).toBe(1);
  });

  it("a strided access serializes and an in-order one does not", () => {
    const body = (shift: number) => `lane v1\nvslli v2, v1, ${shift}\nvld v3, 1024(v2)\nhalt`;
    const unit = runAsm(body(2), 8, 4); // words 0..7 across 4 banks: two words per bank
    const wide = runAsm(body(4), 8, 4); // every 4th word: all in bank 0
    expect(unit.conflictCycles).toBe(1);
    expect(wide.conflictCycles).toBe(7);
    expect(wide.cycles - unit.cycles).toBe(6);
    // more banks, no conflict for the unit stride
    expect(runAsm(body(2), 8, 8).conflictCycles).toBe(0);
  });

  it("masked-off lanes do not take part in a conflict", () => {
    const g = runAsm("lane v1\nvslli v2, v1, 4\nvli v3, 1\nmpush\nmseteq v1, v0\nvld v4, 1024(v2)\nmpop\nhalt", 8, 4);
    expect(g.conflictCycles).toBe(0);
  });
});

describe("GPU reference interpreter: faults", () => {
  it("faults on a misaligned or out-of-range access", () => {
    expect(() => runAsm("vli v1, 2\nvld v2, 0(v1)\nhalt")).toThrow(GpuFault);
    expect(() => runAsm("vli v1, 4\nvli v2, 16000\nvld v3, 16000(v2)\nhalt")).toThrow(/outside card memory/);
    expect(() => runAsm("vli v1, -4\nvld v2, 0(v1)\nhalt")).toThrow(GpuFault);
  });

  it("faults on a mask stack underflow, overflow and a stray melse", () => {
    expect(() => runAsm("mpop\nhalt")).toThrow(/empty mask stack/);
    expect(() => runAsm("melse\nhalt")).toThrow(/empty mask stack/);
    expect(() => runAsm("mpush\n".repeat(9) + "halt")).toThrow(/overflow/);
  });

  it("faults on an illegal instruction, a runaway fetch and a kernel that never halts", () => {
    const g = card();
    g.mem[0] = 0xfffffffe;
    expect(() => g.run()).toThrow(/illegal instruction/);
    expect(() => runAsm("jmp 1000000")).toThrow(/fetch outside/);
    const loop = card();
    loop.load(assembleGpu("l: jmp l").program);
    expect(() => loop.run(1000)).toThrow(/no halt/);
  });
});
