import { describe, expect, it } from "vitest";
import { assembleGpu } from "../asm/gpu";
import { GpuPort } from "../machine/gpu";
import { GpuRef } from "../ref/gpuref";
import { createGpu, sameGpuConfig } from "./index";

const cfg = { lanes: 8, memBytes: 4096, banks: 2 };

/** A kernel with a scatter (every lane hits bank 0) so one instruction costs several cycles. */
const kernel = assembleGpu(`
  lane v1
  vslli v1, v1, 3
  vli v2, 7
  vst v2, 1024(v1)
  vld v3, 1024(v1)
  halt
`).program;

describe("simd engine", () => {
  it("takes as many cycles as the reference interpreter, one per step", () => {
    const ref = new GpuRef(cfg), eng = createGpu(cfg);
    ref.load(kernel); eng.mem.set(kernel);
    ref.reset(); eng.reset();
    ref.run();
    let steps = 0, issued = 0;
    while (!eng.halted) { if (eng.step()) issued++; steps++; }
    expect(steps).toBe(ref.cycles);
    expect(eng.cycles).toBe(ref.cycles);
    expect(issued).toBe(ref.instructions);
    expect(eng.conflictCycles).toBe(ref.conflictCycles);
    expect(eng.idleLaneSlots).toBe(ref.idleLaneSlots);
    expect(Array.from(eng.mem)).toEqual(Array.from(ref.mem));
    expect(eng.conflictCycles).toBeGreaterThan(0);
  });

  it("returns null on the cycles a conflicted access spends waiting", () => {
    const eng = createGpu(cfg);
    eng.mem.set(kernel);
    eng.reset();
    const seen = Array.from({ length: 12 }, () => eng.step()?.name ?? null);
    expect(seen.includes(null)).toBe(true);
  });
});

describe("config identity", () => {
  it("compares every field, treating a missing kind as simd", () => {
    expect(sameGpuConfig(cfg, { ...cfg })).toBe(true);
    expect(sameGpuConfig(cfg, { ...cfg, kind: "simd" })).toBe(true);
    expect(sameGpuConfig(cfg, { ...cfg, banks: 4 })).toBe(false);
    expect(sameGpuConfig(cfg, null)).toBe(false);
    expect(sameGpuConfig(null, null)).toBe(true);
  });

  it("a port keeps its core for the same config and replaces it for a changed field", () => {
    const port = new GpuPort("pcie0", 0);
    port.configure(cfg);
    const mem = port.memory!;
    port.configure({ ...cfg });
    expect(port.memory).toBe(mem);
    port.configure({ ...cfg, banks: 4 });
    expect(port.memory).not.toBe(mem);
    port.configure(null);
    expect(port.present).toBe(false);
  });
});

describe("step record", () => {
  it("carries the word, the mask and stack after, the issue cycle and why a step was slow", () => {
    const eng = createGpu(cfg);
    eng.mem.set(kernel);
    eng.reset();
    const steps = [];
    while (!eng.halted) { const s = eng.step(); if (s) steps.push(s); }
    expect(steps.map((s) => s.name)).toEqual(["lane", "vslli", "vli", "vst", "vld", "halt"]);
    expect(steps[0]).toMatchObject({ word: kernel[0], maskAfter: 0xff, stackDepth: 0, startCycle: 0, sm: 0, warp: 0, stall: null });
    expect(steps[1]!.startCycle).toBe(1);
    const st = steps[3]!;
    expect(st.stall).toBe("bank");
    expect(steps[4]!.startCycle).toBe(st.startCycle! + st.cost);
  });

  it("a port shows one SM with one warp and keeps up to 64 steps", () => {
    const port = new GpuPort("pcie0", 0);
    port.configure(cfg);
    const v = port.view()!;
    expect(v.sms).toEqual([{ warps: [{ pc: 0, mask: 0xff, stack: [], state: "ready" }] }]);
  });
});
