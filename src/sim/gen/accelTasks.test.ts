// The accelerator jobs, one per kernel and one per depth of network (docs/JOBS.md "The catalogue"): each prints the same line with and without a card.
import { describe, expect, it } from "vitest";
import { createEngine } from "../engines";
import { GPU_BASE, NPU_BASE } from "../isa/memmap";
import { GpuPort, Machine, NpuPort } from "../machine";
import { generate, runReference, type Generated } from "./index";
import { GPU_TASK_KERNELS, sphereFrames } from "./gpukernels";
import { npuBytes, makeNetwork } from "./npukernels";
import { Prng } from "../machine/prng";

const GPU = { base: GPU_BASE, lanes: 8, memBytes: 8192 };
const NPU = { base: NPU_BASE + 0x10000, grid: 4, memBytes: 8192 }; // the card in the second slot, as npujob.test.ts does

/** Run a program on a machine with an 8-lane card in pcie0 and/or a 4x4 NPU in pcie1. Returns base ticks and the screen. */
function onMachine(g: Generated, cards: { gpu?: boolean; npu?: boolean }): { ticks: number; text: string; gpuLaunches: number; npuLaunches: number } {
  const m = new Machine({ ramSize: 64 * 1024 });
  const gpu = new GpuPort("pcie0", 0), npu = new NpuPort("npu1", 1);
  m.addDevice(gpu);
  m.addDevice(npu);
  m.clock.setRate("pcie0", { mul: 2, div: 1 });
  m.clock.setRate("npu1", { mul: 2, div: 1 });
  if (cards.gpu) gpu.configure({ lanes: 8, memBytes: 8192, banks: 1 });
  if (cards.npu) npu.configure({ grid: 4, memBytes: 8192 });
  m.attach(createEngine({ kind: "unpipelined" }), g.program);
  let ticks = 0;
  while (!m.engine!.halted) {
    m.advanceBaseTick();
    if (++ticks > 4_000_000) throw new Error("program never halted");
  }
  return { ticks, text: m.display.text(), gpuLaunches: gpu.launches, npuLaunches: npu.launches };
}

describe("one job per GPU kernel", () => {
  for (const k of GPU_TASK_KERNELS) {
    const template = `gpu.${k}`;
    it(`${template}: always the same kernel, the same line with a card as without, and the card is launched once per frame`, () => {
      for (const seed of k === "mandel" || k === "sphere" ? [1] : [1, 2, 3]) { // the CPU path of a Mandelbrot row is long
        const cpu = generate(template, seed, { scale: 4 }), card = generate(template, seed, { scale: 4, gpu: GPU });
        expect(cpu.meta.expectedText).toContain(` ${k} `);
        expect(card.meta.expectedText).toBe(cpu.meta.expectedText);
        expect(runReference(cpu, 600_000).text).toBe(cpu.meta.expectedText);
        const withCard = onMachine(card, { gpu: true }), without = onMachine(cpu, {});
        expect(withCard.text).toBe(cpu.meta.expectedText);
        expect(without.text).toBe(cpu.meta.expectedText);
        expect(withCard.gpuLaunches).toBe(k === "sphere" ? sphereFrames(16) : 1);
        expect(without.gpuLaunches).toBe(0);
      }
    }, 30_000);
  }

  it("the two new kernels do real work under the mask: a branch per element (thresh) and a chain of multiplies (poly)", () => {
    const t = generate("gpu.thresh", 5, { scale: 4 }), p = generate("gpu.poly", 5, { scale: 4 });
    expect(t.asm).toContain("blt");
    expect(p.asm.match(/mul t2, t2, t0/g)).toHaveLength(8);
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
