import { describe, expect, it } from "vitest";
import { createEngine } from "../../cpu/sim/engines";
import { GPU_BASE, NPU_BASE } from "@/core/sim/memmap";
import { GpuPort, Machine, NpuPort } from "@/core/sim";
import { generate, runReference, type Generated } from "../../jobs/sim/gen/index";
import { M, makeNetwork, networkChecksum, networkExpected, npuProgram } from "./kernels";
import { Prng } from "@/core/sim/prng";

const GPU = { base: GPU_BASE, lanes: 8, memBytes: 8192 };
const NPU4 = { base: NPU_BASE, grid: 4, memBytes: 8192 };
const NPU8 = { base: NPU_BASE, grid: 8, memBytes: 32768 };

/** One machine with a GPU in pcie0's port and an NPU in npu1's; the cards run at twice the CPU's clock. */
function onMachine(g: Generated, cards: { gpu?: boolean; npu?: { grid: number; memBytes: number } } = {}) {
  const m = new Machine({ ramSize: 64 * 1024 });
  const gpu = new GpuPort("pcie0", 0), npu = new NpuPort("npu1", 1);
  m.addDevice(gpu);
  m.addDevice(npu);
  m.clock.setRate("pcie0", { mul: 2, div: 1 });
  m.clock.setRate("npu1", { mul: 2, div: 1 });
  if (cards.gpu) gpu.configure({ lanes: 8, memBytes: 8192, banks: 1 });
  if (cards.npu) npu.configure(cards.npu);
  m.attach(createEngine({ kind: "unpipelined" }), g.program);
  let ticks = 0;
  while (!m.engine!.halted) {
    m.advanceBaseTick();
    if (++ticks > 4_000_000) throw new Error("program never halted");
  }
  return { ticks, text: m.display.text(), gpuLaunches: gpu.launches, npuLaunches: npu.launches, npuDescriptors: npu.descriptors };
}

// NPU base for slot 1 is NPU_BASE + stride; the generator is told where the card is.
const NPU1 = (t: typeof NPU4) => ({ ...t, base: NPU_BASE + 0x10000 });

describe("npu.infer job", () => {
  const seed = 11;
  const cpuOnly = generate("npu.infer", seed, { scale: 4 });
  const withGpu = generate("npu.infer", seed, { scale: 4, gpu: GPU });
  const withNpu4 = generate("npu.infer", seed, { scale: 4, npu: NPU1(NPU4) });
  const withNpu8 = generate("npu.infer", seed, { scale: 4, npu: NPU1(NPU8) });

  it("the line is the same on every path: CPU loop, GPU launches, NPU descriptors (both grids)", () => {
    expect(cpuOnly.meta.expectedText).toMatch(/^#\d\d infer \d\d OK$/);
    for (const g of [withGpu, withNpu4, withNpu8]) expect(g.meta.expectedText).toBe(cpuOnly.meta.expectedText);
    expect(runReference(cpuOnly, 400_000).text).toBe(cpuOnly.meta.expectedText);
    expect(onMachine(cpuOnly).text).toBe(cpuOnly.meta.expectedText);
    expect(onMachine(withGpu, { gpu: true }).text).toBe(cpuOnly.meta.expectedText);
    expect(onMachine(withNpu4, { npu: NPU4 }).text).toBe(cpuOnly.meta.expectedText);
    expect(onMachine(withNpu8, { npu: NPU8 }).text).toBe(cpuOnly.meta.expectedText);
  });

  it("each path really uses its card, and the others stay idle", () => {
    const g = onMachine(withGpu, { gpu: true });
    expect(g.gpuLaunches).toBe(5); // one per layer: 1 + scale
    expect(g.npuLaunches).toBe(0);
    const n = onMachine(withNpu4, { npu: NPU4 });
    expect(n.npuLaunches).toBe(1);
    expect(n.gpuLaunches).toBe(0);
    expect(n.npuDescriptors).toBe(npuProgram(makeNetwork(new Prng(0), 5)).count); // one Layer per layer
    const c = onMachine(cpuOnly);
    expect(c.gpuLaunches + c.npuLaunches).toBe(0);
  });

  it("takes strictly more ticks down the chain: NPU 8x8, NPU 4x4, GPU, CPU", () => {
    const t = {
      npu8: onMachine(withNpu8, { npu: NPU8 }).ticks,
      npu4: onMachine(withNpu4, { npu: NPU4 }).ticks,
      gpu: onMachine(withGpu, { gpu: true }).ticks,
      cpu: onMachine(cpuOnly).ticks,
    };
    expect(t.npu8).toBeLessThan(t.npu4);
    expect(t.npu4).toBeLessThan(t.gpu);
    expect(t.gpu).toBeLessThan(t.cpu);
  });

  it("with both cards the NPU is used; a card that is too small or a grid that does not divide the batch falls through", () => {
    const both = generate("npu.infer", seed, { scale: 4, gpu: GPU, npu: NPU1(NPU4) });
    expect(both.asm).toBe(withNpu4.asm);
    const smallNpu = generate("npu.infer", seed, { scale: 4, gpu: GPU, npu: NPU1({ ...NPU4, memBytes: 1024 }) });
    expect(smallNpu.asm).toBe(withGpu.asm);
    const oddGrid = generate("npu.infer", seed, { scale: 4, npu: NPU1({ ...NPU4, grid: 3 }) });
    expect(oddGrid.asm).toBe(cpuOnly.asm);
    expect(generate("npu.infer", seed, { scale: 4, gpu: { ...GPU, memBytes: 1024 } }).asm).toBe(cpuOnly.asm);
  });

  it("the seed alone picks the network; layers follow the scale", () => {
    for (let s = 1; s <= 12; s++) {
      const a = generate("npu.infer", s, { scale: 3 }), b = generate("npu.infer", s, { scale: 3, npu: NPU1(NPU4) });
      expect(b.meta.expectedText).toBe(a.meta.expectedText);
      expect(generate("npu.infer", s, { scale: 3 }).asm).toBe(a.asm);
    }
    expect(onMachine(generate("npu.infer", 4, { scale: 4 })).ticks).toBeGreaterThan(onMachine(generate("npu.infer", 4, { scale: 1 })).ticks);
  });

  it("works at every scale, hosted, within the code limit", () => {
    for (const scale of [1, 2, 4, 6, 8]) {
      const g = generate("npu.infer", 2, { scale, hosted: true, npu: NPU1(NPU4) });
      expect(g.program.length * 4).toBeLessThan(0x3000);
    }
  });
});

describe("network helpers", () => {
  it("relu keeps the activations non-negative and the answer deterministic", () => {
    const n = makeNetwork(new Prng(5), 3);
    const out = networkExpected(n);
    expect(out.every((v) => v >= 0)).toBe(true);
    expect(out.some((v) => v > 0)).toBe(true);
    expect(networkChecksum(makeNetwork(new Prng(5), 3))).toBe(networkChecksum(n));
  });
});
