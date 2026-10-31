import { describe, expect, it } from "vitest";
import { assembleGpu } from "./asm";
import { ballPixel, GPU_KERNEL_NAMES, gpuKernelExpected, gpuKernelSource, KERNEL_LAYOUT, mandelCount, PICTURE_LEN, type GpuKernelName } from "./kernels";
import { bankCycles, bankLoad, GpuFault, GpuRef } from "./ref";

const card = (lanes = 8, banks = 1, kb = 8) => new GpuRef({ lanes, memBytes: kb * 1024, banks });

/** Assemble and run a snippet; returns the card. */
function runAsm(src: string, lanes = 8, banks = 1, active = lanes): GpuRef {
  const g = card(lanes, banks);
  g.load(assembleGpu(src).program);
  g.reset(0, active);
  g.run();
  return g;
}

function runKernel(name: GpuKernelName, lanes: number, len: number, banks = 1, kb = 16, phase = 5, level = 3) {
  const p = { lanes, len, phase, level };
  const g = card(lanes, banks, kb);
  g.load(assembleGpu(gpuKernelSource(name, p)).program, KERNEL_LAYOUT.code);
  g.load([phase, level], KERNEL_LAYOUT.param);
  g.reset();
  g.run();
  return { g, out: g.read(KERNEL_LAYOUT.out, len), want: gpuKernelExpected(name, p) };
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

  it("every kernel draws the whole 64 x 40 picture like the plain-JS pixel, on the smallest card", () => {
    for (const name of ["vadd", "saxpy", "blur3", "thresh", "poly", "sphere"] as const) {
      const { out, want } = runKernel(name, 16, PICTURE_LEN, 1, 16, 9, name === "blur3" ? 4 : 120);
      expect(out, name).toEqual(want);
    }
  });

  it("the brightness, contrast and threshold levels do what they say", () => {
    const at = (name: GpuKernelName, level: number) => gpuKernelExpected(name, { lanes: 1, len: 64, phase: 0, level });
    expect(at("vadd", 40).every((v, i) => v === Math.min(255, at("vadd", 0)[i]! + 40))).toBe(true);
    expect(new Set(at("thresh", 100))).toEqual(new Set([0, 255]));
    expect(Math.max(...at("saxpy", 24))).toBeGreaterThan(Math.max(...at("saxpy", 8)));
  });

  it("thresh diverges: the two sides of the branch run under the mask", () => {
    const { g } = runKernel("thresh", 8, 64, 1, 16, 0, 100);
    expect(g.idleLaneSlots).toBeGreaterThan(0);
  });

  it("mandel is heavily divergent: lanes finish at different times and the loop runs for the slowest", () => {
    const { g, out } = runKernel("mandel", 8, 256, 1, 16, 0, 10);
    expect(new Set(out).size).toBeGreaterThan(3);
    expect(out.some((c) => c === 160)).toBe(true); // inside the set: runs to the iteration cap (10), drawn as 16 a count
    expect(out.some((c) => c < 80)).toBe(true); // far outside: escapes early
    expect(out).toEqual([...Array(256).keys()].map((i) => mandelCount(i, 10) << 4));
    expect(g.idleLaneSlots / (g.instructions * 8)).toBeGreaterThan(0.1);
  });

  it("mandel draws an image: every row has its own imaginary part", () => {
    const { out } = runKernel("mandel", 16, PICTURE_LEN, 1, 16, 0, 6);
    const rows = [...Array(40).keys()].map((r) => out.slice(r * 64, r * 64 + 64).join());
    expect(new Set(rows).size).toBeGreaterThan(15);
  });

  it("sphere draws eight lit, checkered balls and the spin moves the checker", () => {
    const { out } = runKernel("sphere", 16, PICTURE_LEN, 1, 16, 0);
    expect(out).toEqual([...Array(PICTURE_LEN).keys()].map((i) => ballPixel(i, 0)));
    expect(out[0]).toBe(0); // the corner is off the ball
    expect(out.filter((v) => v > 0).length).toBeGreaterThan(1000);
    expect(new Set(out).size).toBeGreaterThan(30); // shading, not flat colour
    const band = (b: number) => out.slice(b * 20 * 64, (b + 1) * 20 * 64).join();
    expect(band(0)).not.toBe(band(1)); // the lower balls are turned differently
    expect(ballPixel(20 * 64 / 2 + 8, 0)).not.toBe(ballPixel(20 * 64 / 2 + 8, 8)); // the checker slides when the phase moves
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
