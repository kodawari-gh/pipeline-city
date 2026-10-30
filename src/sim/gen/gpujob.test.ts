import { describe, expect, it } from "vitest";
import { createEngine } from "../engines";
import { GPU_BASE } from "../isa/memmap";
import { GpuPort, Machine } from "../machine";
import { generate, runReference, type Generated } from "./index";
import { framesOf, GPU_KERNEL_NAMES } from "./gpukernels";

const GPU = { base: GPU_BASE, lanes: 8, memBytes: 16384 };

/** Find a seed whose job uses the given kernel. */
function seedFor(kernel: string, scale = 1): number {
  for (let seed = 1; seed < 400; seed++) {
    if (generate("gpu.render", seed, { scale }).meta.expectedText.includes(` ${kernel} `)) return seed;
  }
  throw new Error(`no seed for ${kernel}`);
}

/** Run a program on a machine with one 8-lane card in pcie0 (card clock 2x the CPU's). Returns base ticks and the screen. */
const runs = new Map<Generated, Map<boolean, { ticks: number; text: string; launches: number }>>(); // a CPU run costs seconds: each program runs once per kind
function onMachine(g: Generated, card = true): { ticks: number; text: string; launches: number } {
  const byKind = runs.get(g) ?? new Map();
  runs.set(g, byKind);
  if (!byKind.has(card)) byKind.set(card, run(g, card));
  return byKind.get(card)!;
}

function run(g: Generated, card: boolean): { ticks: number; text: string; launches: number } {
  const m = new Machine({ ramSize: 64 * 1024 });
  const port = new GpuPort("pcie0", 0);
  m.addDevice(port);
  m.clock.setRate("pcie0", { mul: 2, div: 1 });
  if (card) port.configure({ lanes: 8, memBytes: 16384, banks: 1 });
  m.attach(createEngine({ kind: "unpipelined" }), g.program);
  let ticks = 0;
  while (!m.engine!.halted) {
    m.advanceBaseTick();
    if (++ticks > 40_000_000) throw new Error("program never halted");
  }
  return { ticks, text: m.display.text(), launches: port.launches };
}

describe("gpu.render job", { timeout: 120_000 }, () => {
  for (const kernel of GPU_KERNEL_NAMES) {
    describe(kernel, () => {
      const seed = seedFor(kernel);
      const cpuOnly = generate("gpu.render", seed, { scale: 1 });
      const withCard = generate("gpu.render", seed, { scale: 1, gpu: GPU });

      it("the CPU path prints the expected line on the reference interpreter", () => {
        const run = runReference(cpuOnly, 3_000_000);
        expect(run.text).toBe(cpuOnly.meta.expectedText);
        expect(run.steps).toBeGreaterThan(100_000); // the CPU has real work to do
      });

      // each run on the cycle-level machine takes seconds, so only the lightest and the heaviest kernel run there (accelTasks.test.ts runs one seed of every kernel)
      const heavy = kernel === "vadd" || kernel === "mandel" ? it : it.skip;
      heavy("the GPU path prints the same line as the CPU path, launching the card once per frame", () => {
        expect(withCard.meta.expectedText).toBe(cpuOnly.meta.expectedText);
        const r = onMachine(withCard);
        expect(r.text).toBe(cpuOnly.meta.expectedText);
        expect(r.launches).toBe(framesOf(1));
        expect(onMachine(cpuOnly).launches).toBe(0);
      });

      heavy("the card path takes fewer ticks than the CPU path on the same machine", () => {
        const cpu = onMachine(cpuOnly, false), gpu = onMachine(withCard);
        expect(cpu.text).toBe(gpu.text);
        expect(gpu.ticks).toBeLessThan(cpu.ticks);
      });
    });
  }

  it("the seed alone picks the job: kernel, data and answer do not depend on the hardware, and the output is deterministic", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const a = generate("gpu.render", seed, { scale: 1 }), b = generate("gpu.render", seed, { scale: 1, gpu: GPU });
      expect(b.meta.expectedText).toBe(a.meta.expectedText);
      expect(generate("gpu.render", seed, { scale: 1 }).asm).toBe(a.asm);
      expect(generate("gpu.render", seed, { scale: 1, gpu: GPU }).asm).toBe(b.asm);
      expect(b.asm).not.toBe(a.asm);
    }
  });

  it("a card too small, or lanes that do not divide the work, fall back to the CPU path", () => {
    const base = generate("gpu.render", 1, { scale: 1 });
    expect(generate("gpu.render", 1, { scale: 1, gpu: { ...GPU, memBytes: 1024 } }).asm).toBe(base.asm);
    expect(generate("gpu.render", 1, { scale: 1, gpu: { ...GPU, lanes: 24 } }).asm).toBe(base.asm);
  });

  it("works at every scale, in hosted form too", () => {
    for (const scale of [1, 2, 4, 8]) {
      const g = generate("gpu.render", 3, { scale, gpu: GPU, hosted: true });
      expect(g.program.length * 4).toBeLessThan(0x3000);
      expect(g.meta.expectedText).toMatch(/^#\d\d \w+ \d\d OK$/);
    }
  });
});
