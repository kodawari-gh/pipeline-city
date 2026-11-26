// The accelerator jobs, one per kernel and one per depth of network (docs/JOBS.md "The catalogue"): each prints the same line with and without a card.
import { describe, expect, it } from 'vitest';
import { createEngine } from '@/features/cpu/sim/engines';
import { GPU_BASE, NPU_BASE } from '@/core/sim/memmap';
import { GpuPort, Machine, NpuPort } from '@/core/sim';
import { generate, runReference } from './index';
import type * as genTypes from './index';
import { framesOf, GPU_TASK_KERNELS } from '@/features/gpu/sim/kernels';
import { npuBytes, makeNetwork } from '@/features/npu/sim/kernels';
import { Prng } from '@/core/sim/prng';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const GPU = { base: GPU_BASE, lanes: 8, memBytes: 16_384 };
const NPU = { base: NPU_BASE + 0x1_00_00, grid: 4, memBytes: 8192 }; // the card in the second slot, as npujob.test.ts does

/** Run a program on a machine with an 8-lane card in pcie0 and/or a 4x4 NPU in pcie1. Returns base ticks and the screen. */
function onMachine(
  g: genTypes.Generated,
  cards: { gpu?: boolean; npu?: boolean },
): { ticks: number; text: string; gpuLaunches: number; npuLaunches: number } {
  const m = new Machine({ ramSize: 64 * 1024 });
  const gpu = new GpuPort('pcie0', 0),
    npu = new NpuPort('npu1', 1);
  m.addDevice(gpu);
  m.addDevice(npu);
  m.clock.setRate('pcie0', { mul: 2, div: 1 });
  m.clock.setRate('npu1', { mul: 2, div: 1 });
  if (cards.gpu === true) {
    gpu.configure({ lanes: 8, memBytes: 16_384, banks: 1 });
  }
  if (cards.npu === true) {
    npu.configure({ grid: 4, memBytes: 8192 });
  }
  m.attach(createEngine({ kind: 'unpipelined' }), g.program);
  let ticks = 0;
  while (!must(m.engine).halted) {
    m.advanceBaseTick();
    if (++ticks > 30_000_000) {
      throw new Error('program never halted');
    }
  }
  return { ticks, text: m.display.text(), gpuLaunches: gpu.launches, npuLaunches: npu.launches };
}

/** The bytes of card memory a network of `layers` layers (seed 7) needs. */
const weightBytes = (layers: number) => npuBytes(makeNetwork(new Prng(7), layers));

describe('one job per GPU kernel', () => {
  it.each(GPU_TASK_KERNELS)(
    'gpu.%s: always the same kernel, the same line with a card as without, and the card is launched once per frame',
    (k) => {
      const template = `gpu.${k}`;
      for (const seed of [1]) {
        const cpu = generate(template, seed, { scale: 1 }),
          card = generate(template, seed, { scale: 1, gpu: GPU });
        expect(cpu.meta.expectedText).toContain(` ${k} `);
        expect(card.meta.expectedText).toBe(cpu.meta.expectedText);
        expect(runReference(cpu, 3_000_000).text).toBe(cpu.meta.expectedText);
        const withCard = onMachine(card, { gpu: true });
        expect(withCard.text).toBe(cpu.meta.expectedText);
        expect(withCard.gpuLaunches).toBe(framesOf(1));
      }
    },
    120_000,
  );

  // A CPU run on the cycle-level machine takes seconds: one kernel proves it, the reference runs above cover the rest.
  it('gpu.vadd: the same line on the cycle-level machine without a card, which launches none', () => {
    const cpu = generate('gpu.vadd', 1, { scale: 1 });
    const without = onMachine(cpu, {});
    expect(without.text).toBe(cpu.meta.expectedText);
    expect(without.gpuLaunches).toBe(0);
  }, 120_000);

  it('the two new kernels do real work under the mask: a branch per element (thresh) and a chain of multiplies (poly)', () => {
    const t = generate('gpu.thresh', 5, { scale: 4 }),
      p = generate('gpu.poly', 5, { scale: 4 });
    expect(t.asm).toContain('blt');
    expect(p.asm).toContain('mul t2, t3, t3');
  });
});

describe('one job per depth of network', () => {
  it('each prints the same line on the NPU, the GPU and the CPU, and a different one at another scale', () => {
    for (const template of ['npu.perceptron', 'npu.infer', 'npu.deep']) {
      const lines = new Set<string>();
      for (const scale of [1, 4]) {
        const cpu = generate(template, 3, { scale }),
          npu = generate(template, 3, { scale, npu: NPU }),
          gpu = generate(template, 3, { scale, gpu: GPU });
        for (const g of [cpu, npu, gpu]) {
          expect(g.meta.expectedText).toBe(cpu.meta.expectedText);
        }
        expect(runReference(cpu, 800_000).text).toBe(cpu.meta.expectedText);
        const run = onMachine(npu, { npu: true });
        expect(run.text).toBe(cpu.meta.expectedText);
        expect(run.npuLaunches).toBe(1);
        lines.add(cpu.meta.expectedText);
      }
      expect(lines.size, `for ${template}`).toBe(2);
    }
  });

  it("a deeper network needs more of the card's memory for its weights", () => {
    expect(weightBytes(6)).toBeGreaterThan(weightBytes(2));
    expect(weightBytes(2)).toBeGreaterThan(weightBytes(1));
  });
});
