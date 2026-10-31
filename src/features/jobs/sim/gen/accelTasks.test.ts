// The accelerator jobs, one per kernel and one per depth of network (docs/JOBS.md "The catalogue"): each prints the same line with and without a card.
import { describe, expect, it } from "vitest";
import { createEngine } from "@/features/cpu/sim/engines";
import { GPU_BASE, NPU_BASE } from "@/core/sim/memmap";
import { GpuPort, Machine, NpuPort } from "@/core/sim";
import { generate, runReference, type Generated } from "./index";
import { framesOf, GPU_TASK_KERNELS } from "@/features/gpu/sim/kernels";
import { npuBytes, makeNetwork } from "@/features/npu/sim/kernels";
import { Prng } from "@/core/sim/prng";

const GPU = { base: GPU_BASE, lanes: 8, memBytes: 16384 };
const NPU = { base: NPU_BASE + 0x10000, grid: 4, memBytes: 8192 }; // the card in the second slot, as npujob.test.ts does

/** Run a program on a machine with an 8-lane card in pcie0 and/or a 4x4 NPU in pcie1. Returns base ticks and the screen. */
function onMachine(g: Generated, cards: { gpu?: boolean; npu?: boolean }): { ticks: number; text: string; gpuLaunches: number; npuLaunches: number } {
  const m = new Machine({ ramSize: 64 * 1024 });
  const gpu = new GpuPort("pcie0", 0), npu = new NpuPort("npu1", 1);
  m.addDevice(gpu);
  m.addDevice(npu);
  m.clock.setRate("pcie0", { mul: 2, div: 1 });
  m.clock.setRate("npu1", { mul: 2, div: 1 });
  if (cards.gpu) gpu.configure({ lanes: 8, memBytes: 16384, banks: 1 });
  if (cards.npu) npu.configure({ grid: 4, memBytes: 8192 });
  m.attach(createEngine({ kind: "unpipelined" }), g.program);
  let ticks = 0;
  while (!m.engine!.halted) {
    m.advanceBaseTick();
    if (++ticks > 30_000_000) throw new Error("program never halted");
  }
  return { ticks, text: m.display.text(), gpuLaunches: gpu.launches, npuLaunches: npu.launches };
}

describe("one job per GPU kernel", () => {
  for (const k of GPU_TASK_KERNELS) {
    const template = `gpu.${k}`;
    it(`${template}: always the same kernel, the same line with a card as without, and the card is launched once per frame`, () => {
      for (const seed of [1]) {
        const cpu = generate(template, seed, { scale: 1 }), card = generate(template, seed, { scale: 1, gpu: GPU });
        expect(cpu.meta.expectedText).toContain(` ${k} `);
        expect(card.meta.expectedText).toBe(cpu.meta.expectedText);
        expect(runReference(cpu, 3_000_000).text).toBe(cpu.meta.expectedText);
        const withCard = onMachine(card, { gpu: true }), without = k === "vadd" ? onMachine(cpu, {}) : null; // a CPU run on the cycle-level machine takes seconds: one kernel proves it, the reference run above covers the rest
        expect(withCard.text).toBe(cpu.meta.expectedText);
        if (without) expect(without.text).toBe(cpu.meta.expectedText);
        expect(withCard.gpuLaunches).toBe(framesOf(1));
        if (without) expect(without.gpuLaunches).toBe(0);
      }
    }, 120_000);
  }

  it("the two new kernels do real work under the mask: a branch per element (thresh) and a chain of multiplies (poly)", () => {
    const t = generate("gpu.thresh", 5, { scale: 4 }), p = generate("gpu.poly", 5, { scale: 4 });
    expect(t.asm).toContain("blt");
    expect(p.asm).toContain("mul t2, t3, t3");
  });
});

describe("one job per depth of network", () => {
  it("each prints the same line on the NPU, the GPU and the CPU, and a different one at another scale", () => {
    for (const template of ["npu.perceptron", "npu.infer", "npu.deep"]) {
      const lines = new Set<string>();
      for (const scale of [1, 4]) {
        const cpu = generate(template, 3, { scale }), npu = generate(template, 3, { scale, npu: NPU }), gpu = generate(template, 3, { scale, gpu: GPU });
        for (const g of [cpu, npu, gpu]) expect(g.meta.expectedText).toBe(cpu.meta.expectedText);
        expect(runReference(cpu, 800_000).text).toBe(cpu.meta.expectedText);
        const run = onMachine(npu, { npu: true });
        expect(run.text).toBe(cpu.meta.expectedText);
        expect(run.npuLaunches).toBe(1);
        lines.add(cpu.meta.expectedText);
      }
      expect(lines.size, template).toBe(2);
    }
  });

  it("a deeper network needs more of the card's memory for its weights", () => {
    const bytes = (layers: number) => npuBytes(makeNetwork(new Prng(7), layers));
    expect(bytes(6)).toBeGreaterThan(bytes(2));
    expect(bytes(2)).toBeGreaterThan(bytes(1));
  });
});
