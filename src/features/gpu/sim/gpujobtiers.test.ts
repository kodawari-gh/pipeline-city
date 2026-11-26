import { describe, expect, it } from 'vitest';
import { specsOfKind } from '../../board/sim/specs';
import { createEngine } from '../../cpu/sim/engines';
import { GPU_BASE } from '@/core/sim/memmap';
import { GpuPort, Machine } from '@/core/sim';
import { generate } from '../../jobs/sim/gen/index';
import { GPU_KERNEL_NAMES } from './kernels';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// The job text depends on the seed alone: every card tier prints the CPU path's line, and a faster tier finishes in fewer base ticks.
function runOn(specId: string, seed: number): { ticks: number; text: string } {
  const spec = must(specsOfKind('gpu').find((s) => s.id === specId)),
    card = must(spec.gpu);
  const g = generate('gpu.render', seed, {
    scale: 1,
    gpu: { base: GPU_BASE, lanes: card.lanes, memBytes: card.memBytes },
  });
  const m = new Machine({ ramSize: 64 * 1024 });
  const port = new GpuPort('pcie0', 0);
  m.addDevice(port);
  m.clock.setRate('pcie0', { mul: must(spec.clock).base, div: 1 });
  port.configure(card);
  m.attach(createEngine({ kind: 'unpipelined' }), g.program);
  let ticks = 0;
  while (!must(m.engine).halted) {
    m.advanceBaseTick();
    if (++ticks > 40_000_000) {
      throw new Error('program never halted');
    }
  }
  expect(m.display.text()).toBe(g.meta.expectedText);
  return { ticks, text: m.display.text() };
}

/** The first seed below 400 whose job uses the given kernel (400 when none does). */
function seedFor(kernel: string): number {
  let seed = 1;
  while (seed < 400 && !generate('gpu.render', seed, { scale: 1 }).meta.expectedText.includes(` ${kernel} `)) {
    seed++;
  }
  return seed;
}

describe('one seed on every GPU tier', { timeout: 300_000 }, () => {
  it('prints the same line on gpu1, gpu2 and gpu3, and each tier is faster than the last', () => {
    const seed = seedFor(must(GPU_KERNEL_NAMES[0]));
    const a = runOn('gpu1', seed),
      b = runOn('gpu2', seed),
      c = runOn('gpu3', seed);
    expect(b.text).toBe(a.text);
    expect(c.text).toBe(a.text);
    expect(b.ticks).toBeLessThan(a.ticks);
    expect(c.ticks).toBeLessThan(b.ticks);
  });
});
