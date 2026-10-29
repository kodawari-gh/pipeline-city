import { describe, expect, it } from "vitest";
import { assembleGpu } from "../asm/gpu";
import {
  ballPixel, GPU_KERNEL_NAMES, gpuKernelExpected, gpuKernelSource, KERNEL_LAYOUT, kernelInputs, mandelCount, WIDE_ROWS, type GpuKernelName,
} from "../gen/gpukernels";
import { bankCycles, bankLoad, GpuFault, GpuRef } from "./gpuref";

const card = (lanes = 8, banks = 1, kb = 8) => new GpuRef({ lanes, memBytes: kb * 1024, banks });

/** Assemble and run a snippet; returns the card. */
function runAsm(src: string, lanes = 8, banks = 1, active = lanes): GpuRef {
  const g = card(lanes, banks);
  g.load(assembleGpu(src).program);
  g.reset(0, active);
  g.run();
  return g;
}

function runKernel(name: GpuKernelName, lanes: number, len: number, banks = 1, kb = 8) {
  const p = { lanes, len, scale: 5 };
  const { a, b } = kernelInputs(len, 7);
  if (name === "sphere") a[0] = 0; // the card kernel reads its phase from the first word of the `a` region
  const g = card(lanes, banks, kb);
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
    const { g, out } = runKernel("mandel", 8, 256);
    expect(new Set(out).size).toBeGreaterThan(3);
    expect(out.some((c) => c === 16)).toBe(true); // inside the set: runs to the iteration cap (16)
    expect(out.some((c) => c < 5)).toBe(true); // far outside: escapes at once
    expect(out).toEqual([...Array(256).keys()].map(mandelCount));
    // an inner-loop pass costs the same however few lanes are still going, so a lot of lane-slots are idle
    expect(g.idleLaneSlots / (g.instructions * 8)).toBeGreaterThan(0.1);
  });

  it("mandel draws an image: every row has its own imaginary part", () => {
    const { out } = runKernel("mandel", 16, 1024);
    expect(out).toEqual([...Array(1024).keys()].map(mandelCount));
    const rows = [...Array(16).keys()].map((r) => out.slice(r * 64, r * 64 + 64).join());
    expect(new Set(rows).size).toBe(16);
  });

  it("sphere draws four lit, checkered balls and the kernel matches the plain-JS pixel", () => {
    const { out } = runKernel("sphere", 16, 1024);
    expect(out).toEqual([...Array(1024).keys()].map((i) => ballPixel(i, 16, 0)));
    expect(out[0]).toBe(0); // the corner is off the ball
    expect(out.filter((v) => v > 0).length).toBeGreaterThan(500);
    expect(new Set(out).size).toBeGreaterThan(30); // shading, not flat colour
    expect(out.slice(8 * 64, 8 * 64 + 16)).not.toEqual(out.slice(8 * 64 + 16, 8 * 64 + 32)); // middle row: each ball is turned differently
    expect(ballPixel(8 * 64 + 8, 16, 0)).not.toBe(ballPixel(8 * 64 + 8, 16, 8)); // and the spin moves the checker (8 slides it one square)
    expect(runKernel("sphere", 4, 256).out).toEqual([...Array(256).keys()].map((i) => ballPixel(i, 4, 0)));
  });

  it("the 16:9 sphere picture is two bands of balls and the kernel matches the plain-JS pixel", () => {
    const n = 64 * WIDE_ROWS, { out } = runKernel("sphere", 16, n, 1, 16);
    expect(out).toEqual([...Array(n).keys()].map((i) => ballPixel(i, WIDE_ROWS, 0)));
    const band = (b: number) => out.slice(b * 18 * 64, (b + 1) * 18 * 64).join();
    expect(band(0)).not.toBe(band(1)); // the lower balls are turned differently
    expect(out.slice(9 * 64, 9 * 64 + 16).some((v) => v > 0) && out.slice(27 * 64, 27 * 64 + 16).some((v) => v > 0)).toBe(true);
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

  it("bankLoad lists the distinct addresses of every bank and agrees with bankCycles", () => {
    expect(bankLoad([0, 4, 16], 4)).toEqual([2, 1, 0, 0]);
    expect(bankLoad([0, 0, 0, 0], 4)).toEqual([1, 0, 0, 0]);
    expect(bankLoad([], 2)).toEqual([0, 0]);
    for (const a of [[0, 4, 8, 12], [0, 16, 32, 48], [0, 4, 16], []]) expect(bankCycles(a, 4)).toBe(Math.max(1, ...bankLoad(a, 4)));
  });

  it("lastStep reports the instruction, its mask, its cost and (for vld / vst) the bank loads", () => {
    const g = card(8, 4);
    g.load(assembleGpu("lane v1\nvslli v2, v1, 4\nmseteq v1, v0\nvld v3, 1024(v2)\nhalt").program);
    g.reset();
    expect(g.lastStep).toBeNull();
    g.step();
    expect(g.lastStep).toMatchObject({ pc: 0, name: "lane", kind: "alu", mask: 0xff, cost: 1, banks: null, dest: 1 });
    g.step();
    g.step();
    expect(g.lastStep).toMatchObject({ pc: 8, name: "mseteq", kind: "mask", mask: 0xff });
    g.step();
    // only lane 0 is left active, so one address in one bank
    expect(g.lastStep).toMatchObject({ pc: 12, name: "vld", kind: "ld", mask: 1, cost: 1, banks: [1, 0, 0, 0], dest: 3 });
    g.reset();
    g.load(assembleGpu("lane v1\nvslli v2, v1, 4\nvld v3, 1024(v2)\nhalt").program);
    g.reset();
    g.step(); g.step(); g.step();
    expect(g.lastStep).toMatchObject({ name: "vld", cost: 8, banks: [8, 0, 0, 0] }); // all eight lanes in bank 0
    g.step();
    expect(g.lastStep).toMatchObject({ name: "halt", kind: "sys", dest: null });
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
