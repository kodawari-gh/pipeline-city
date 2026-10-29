import { describe, expect, it } from "vitest";
import { assembleGpu } from "../asm/gpu";
import {
  GPU_BASE, GPU_FRAME, GPU_HOP_TICKS, GPU_MEM, GPU_PORTS, GPU_REG, GPU_STRIDE, GpuFaultCode, GpuStatus,
} from "../isa/memmap";
import { GpuRef } from "../ref/gpuref";
import { gpuKernelExpected, gpuKernelSource, KERNEL_LAYOUT, kernelInputs, type GpuKernelName } from "../gen/gpukernels";
import { getSpec } from "../board/specs";
import { GpuPort } from "./gpu";
import { Machine } from "./machine";

const R = (r: number) => GPU_BASE + r;
const W = (k: number) => GPU_BASE + GPU_MEM + 4 * k;

/** A machine with one card in pcie0 at one device tick per base tick, so `advanceBaseTick` is one card tick. */
function rig(lanes = 8, banks = 1, memBytes = 8192) {
  const m = new Machine({ ramSize: 4096 });
  const port = new GpuPort("pcie0", 0);
  m.addDevice(port);
  m.clock.setRate("pcie0", { mul: 1, div: 1 });
  port.configure({ lanes, memBytes, banks });
  const put = (at: number, words: ArrayLike<number>) => { for (let k = 0; k < words.length; k++) m.bus.store32(GPU_BASE + GPU_MEM + at + 4 * k, words[k]!); };
  const get = (at: number, n: number) => Array.from({ length: n }, (_, k) => m.bus.load32(GPU_BASE + GPU_MEM + at + 4 * k) | 0);
  const status = () => m.bus.load32(R(GPU_REG.STATUS));
  /** Launch and tick until the card is not busy; returns the ticks it took. */
  const go = (kernel = 0, lanesArg = 0): number => {
    m.bus.store32(R(GPU_REG.KERNEL), kernel);
    m.bus.store32(R(GPU_REG.LANES), lanesArg);
    m.bus.store32(R(GPU_REG.CMD), 1);
    let n = 0;
    while (status() & GpuStatus.Busy) { m.advanceBaseTick(); n++; if (n > 1_000_000) throw new Error("card never finished"); }
    return n;
  };
  return { m, port, put, get, status, go };
}

function runKernel(name: GpuKernelName, lanes: number, len: number, banks = 1) {
  const p = { lanes, len, scale: 5 };
  const { a, b } = kernelInputs(len, 7);
  const r = rig(lanes, banks);
  r.put(KERNEL_LAYOUT.code, assembleGpu(gpuKernelSource(name, p)).program);
  r.put(KERNEL_LAYOUT.a, a);
  r.put(KERNEL_LAYOUT.b, b);
  const ticks = r.go();
  // the same kernel on the reference interpreter
  const ref = new GpuRef({ lanes, memBytes: 8192, banks });
  ref.load(assembleGpu(gpuKernelSource(name, p)).program, KERNEL_LAYOUT.code);
  ref.load(a, KERNEL_LAYOUT.a);
  ref.load(b, KERNEL_LAYOUT.b);
  ref.run();
  return { ...r, ticks, ref, out: r.get(KERNEL_LAYOUT.out, len), want: gpuKernelExpected(name, p, a, b) };
}

describe("GPU tiers", () => {
  it("each tier beats the one below on blur3: fewer card cycles, and fewer base ticks at its faster clock", () => {
    const spec = (id: string) => getSpec(id) as unknown as { clock: { base: number }; gpu: { lanes: number; memBytes: number; banks: number } };
    const run = (id: string) => {
      const s = spec(id);
      const p = { lanes: s.gpu.lanes, len: 64 };
      const { a, b } = kernelInputs(64, 3);
      const r = rig(s.gpu.lanes, s.gpu.banks, s.gpu.memBytes);
      r.m.clock.setRate("pcie0", { mul: s.clock.base, div: 1 });
      r.put(KERNEL_LAYOUT.code, assembleGpu(gpuKernelSource("blur3", p)).program);
      r.put(KERNEL_LAYOUT.a, a);
      r.put(KERNEL_LAYOUT.b, b);
      const ticks = r.go();
      expect(r.get(KERNEL_LAYOUT.out, 64)).toEqual(gpuKernelExpected("blur3", p, a, b));
      return { cycles: r.m.bus.load32(R(GPU_REG.CYCLES)), baseTicks: ticks / s.clock.base };
    };
    const [g1, g2, g3] = [run("gpu1"), run("gpu2"), run("gpu3")];
    expect(g2.cycles).toBeLessThan(g1.cycles);
    expect(g3.cycles).toBeLessThan(g2.cycles);
    expect(g2.baseTicks).toBeLessThan(g1.baseTicks);
    expect(g3.baseTicks).toBeLessThan(g2.baseTicks);
  });
});

describe("GPU card on the bus", () => {
  it("reports what it is and an idle status", () => {
    const { m, status } = rig(8, 2, 8192);
    expect(status()).toBe(GpuStatus.Present);
    expect(m.bus.load32(R(GPU_REG.LANES_MAX))).toBe(8);
    expect(m.bus.load32(R(GPU_REG.MEM_BYTES))).toBe(8192);
    expect(m.bus.load32(R(GPU_REG.BANKS))).toBe(2);
  });

  it("sits at a fixed window per PCIe slot", () => {
    expect(GPU_PORTS).toEqual(["pcie0", "pcie1", "pcie2", "pcie3"]);
    expect(new GpuPort("pcie2", 2).base).toBe(GPU_BASE + 2 * GPU_STRIDE);
  });

  it("card memory is readable and writable through the window, byte by byte", () => {
    const { m, put, get } = rig();
    put(0, [0x11223344, -1]);
    expect(get(0, 2)).toEqual([0x11223344, -1]);
    expect(m.bus.load8(GPU_BASE + GPU_MEM + 1)).toBe(0x33);
    m.bus.store8(GPU_BASE + GPU_MEM + 1, 0xaa);
    expect(get(0, 1)).toEqual([0x1122aa44]);
    expect(m.bus.load32(W(2048))).toBe(0); // past the end of an 8K card reads as zero
  });

  for (const name of ["vadd", "saxpy", "blur3", "mandel"] as const) {
    it(`${name}: same result as the reference interpreter, in the cycles it counts plus a PCIe hop each way`, () => {
      const { out, want, ref, ticks, port } = runKernel(name, 8, 32);
      expect(out).toEqual(want);
      expect(ticks).toBe(2 * GPU_HOP_TICKS + ref.cycles);
      expect(port.lastStats).toEqual({ instructions: ref.instructions, idleLaneSlots: ref.idleLaneSlots, conflictCycles: ref.conflictCycles });
    });
  }

  it("bank conflicts cost ticks, exactly as in the reference", () => {
    const one = runKernel("vadd", 8, 32, 1);
    const four = runKernel("vadd", 8, 32, 4);
    expect(four.out).toEqual(four.want);
    expect(four.ticks).toBe(2 * GPU_HOP_TICKS + four.ref.cycles);
    expect(one.ref.conflictCycles).toBeGreaterThan(0); // one bank: every access of 8 distinct words queues
    expect(four.ref.conflictCycles).toBeLessThan(one.ref.conflictCycles);
  });

  it("golden trace: blur3 on 8 lanes over 32 elements", () => {
    const { ref, ticks, port } = runKernel("blur3", 8, 32);
    expect({ instructions: ref.instructions, cycles: ref.cycles, conflictCycles: ref.conflictCycles, ticks, idle: port.lastStats.idleLaneSlots })
      .toEqual({ instructions: 93, cycles: 205, conflictCycles: 112, ticks: 221, idle: 140 });
  });

  it("Busy while the launch is in flight, Done afterwards, until the next launch", () => {
    const r = rig();
    r.put(0, assembleGpu("halt").program);
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.status() & GpuStatus.Busy).toBeTruthy();
    expect(r.status() & GpuStatus.Done).toBe(0);
    for (let i = 0; i < GPU_HOP_TICKS; i++) r.m.advanceBaseTick(); // the launch has crossed the link
    expect(r.status() & GpuStatus.Busy).toBeTruthy();
    while (r.status() & GpuStatus.Busy) r.m.advanceBaseTick();
    expect(r.status()).toBe(GpuStatus.Present | GpuStatus.Done);
    expect(r.m.bus.load32(R(GPU_REG.CYCLES))).toBe(1);
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.status() & GpuStatus.Done).toBe(0);
  });

  it("LANES limits how many lanes run", () => {
    const r = rig();
    r.put(0, assembleGpu("lane v1\nvaddi v1, v1, 1\nvslli v2, v1, 2\nvst v1, 2044(v2)\nhalt").program);
    r.go(0, 3);
    expect(r.get(2048, 8)).toEqual([1, 2, 3, 0, 0, 0, 0, 0]);
  });

  it("flags a bad launch instead of hanging: busy, no card, too many lanes, a bad kernel address", () => {
    const r = rig();
    r.put(0, assembleGpu("halt").program);
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    r.m.bus.store32(R(GPU_REG.CMD), 1); // while the first is in flight
    expect(r.status() & GpuStatus.Error).toBeTruthy();
    expect(r.m.bus.load32(R(GPU_REG.FAULT))).toBe(GpuFaultCode.BadLaunch);
    while (r.status() & GpuStatus.Busy) r.m.advanceBaseTick();
    r.m.bus.store32(R(GPU_REG.LANES), 9);
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.status() & GpuStatus.Error).toBeTruthy();
    expect(r.status() & GpuStatus.Busy).toBe(0);
    r.m.bus.store32(R(GPU_REG.LANES), 0);
    r.m.bus.store32(R(GPU_REG.KERNEL), 2); // misaligned
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.m.bus.load32(R(GPU_REG.FAULT))).toBe(GpuFaultCode.BadLaunch);
    r.m.bus.store32(R(GPU_REG.KERNEL), 0x10000); // outside the 8K card
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.status() & GpuStatus.Error).toBeTruthy();

    const empty = new Machine({ ramSize: 4096 });
    const none = new GpuPort("pcie0", 0);
    empty.addDevice(none);
    expect(empty.bus.load32(R(GPU_REG.STATUS))).toBe(0);
    empty.bus.store32(R(GPU_REG.CMD), 1);
    expect(empty.bus.load32(R(GPU_REG.STATUS))).toBe(GpuStatus.Error);
  });

  it("a kernel that faults ends the launch with Error and the Kernel fault code", () => {
    const r = rig();
    r.put(0, assembleGpu("vli v1, 2\nvld v2, 0(v1)\nhalt").program); // misaligned gather
    r.go();
    expect(r.status()).toBe(GpuStatus.Present | GpuStatus.Error | GpuStatus.Done);
    expect(r.m.bus.load32(R(GPU_REG.FAULT))).toBe(GpuFaultCode.Kernel);
    r.put(0, assembleGpu("halt").program);
    r.go(); // the card recovers
    expect(r.status()).toBe(GpuStatus.Present | GpuStatus.Done);
  });

  it("a reset (power-on) wipes card memory and forgets the launch", () => {
    const r = rig();
    r.put(0, assembleGpu("halt").program);
    r.go();
    r.port.reset();
    expect(r.get(0, 1)).toEqual([0]);
    expect(r.status()).toBe(GpuStatus.Present);
  });

  it("takeActivity is true for a launch and false once it has finished", () => {
    const r = rig();
    r.put(0, assembleGpu("halt").program);
    expect(r.port.takeActivity()).toBe(false);
    r.go();
    expect(r.port.takeActivity()).toBe(true);
    expect(r.port.takeActivity()).toBe(false);
  });

  it("view() shows the last instructions of a launch (at most 24), clears them at the next launch, and is null without a card", () => {
    const r = rig(8, 4);
    expect(r.port.view()).toMatchObject({ lanes: 8, banks: 4, memBytes: 8192, phase: "idle", trace: [], regs: [], launches: 0 });
    r.put(0, assembleGpu(`${"vli v1, 1\n".repeat(30)}lane v2\nvslli v3, v2, 4\nvld v4, 1024(v3)\nhalt`).program);
    r.go();
    const v = r.port.view()!;
    expect(v.launches).toBe(1);
    expect(v.trace).toHaveLength(24);
    expect(v.trace.at(-1)).toMatchObject({ name: "halt", kind: "sys" });
    expect(v.trace.at(-2)).toMatchObject({ name: "vld", kind: "ld", banks: [8, 0, 0, 0] });
    expect(v.regs).toHaveLength(8);
    expect(v.regs[2]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(v.stats).toMatchObject({ instructions: 34, conflictCycles: 7 });
    // a second launch starts a fresh window
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    expect(r.port.view()!.trace).toEqual([]);
    r.port.configure(null);
    expect(r.port.view()).toBeNull();
  });

  it("view().frame is the output region of card memory: empty before a launch, the kernel output after it, blank after a reset", () => {
    const r = runKernel("mandel", 8, 64);
    expect(r.port.view()!.frame).toHaveLength(GPU_FRAME.words);
    expect(r.port.view()!.frame.slice(0, 64)).toEqual(r.want.map((v) => v >>> 0));
    r.port.reset(); // card memory is volatile: the frame is blank again
    expect(r.port.view()!.frame.every((w) => w === 0)).toBe(true);
    expect(rig(8, 1).port.view()!.frame).toEqual([]);
  });

  it("a stopped clock freezes a launch, and removing the card takes it off the bus status", () => {
    const r = rig();
    r.put(0, assembleGpu("halt").program);
    r.m.clock.setRate("pcie0", { mul: 0, div: 1 });
    r.m.bus.store32(R(GPU_REG.CMD), 1);
    for (let i = 0; i < 50; i++) r.m.advanceBaseTick();
    expect(r.status() & GpuStatus.Busy).toBeTruthy();
    r.port.configure(null);
    expect(r.status()).toBe(0);
  });
});
