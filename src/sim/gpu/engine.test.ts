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
  vst v2, 0(v1)
  vld v3, 0(v1)
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
