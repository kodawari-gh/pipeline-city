// The high-performance compute jobs (docs/MULTICORE.md section 7): the text equals the TypeScript expectation under any interleaving and any thread count,
// the threads split the work (bare cores finish sooner with more of them), and the thread count a kind declares is the one the OS makes contexts for.
import { assert, describe, expect, it } from 'vitest';
import { createEngine } from '@/features/cpu/sim/engines';
import { REG_NAMES } from '@/features/cpu/sim/isa/isa';
import { Machine } from '@/core/sim';
import { RefThreads } from '@/features/cpu/sim/ref';
import { generate, TEMPLATE_NAMES } from './index';
import { HPC_TEMPLATES, HPC_THREADS } from './tasks.hpc';

const KINDS = Object.keys(HPC_TEMPLATES);
const A0 = REG_NAMES.indexOf('a0'),
  A1 = REG_NAMES.indexOf('a1');

/** The program on `cores` bare in-order cores, thread k on core k (`threads` of them): the cycle the last one ended at, and the text. */
function bare(kind: string, scale: number, { threads, cores }: { threads: number; cores: number }) {
  const g = generate(kind, 5, { row: 0, jobId: 3, scale });
  const m = new Machine({ cores });
  const top = m.ram.length;
  for (let k = 0; k < cores; k++) {
    const cfg = { kind: 'inorder', forwarding: true, cacheLines: 16, l2Lines: 64 } as const;
    if (k === 0) {
      m.attach(createEngine(cfg), g.program);
    } else {
      m.attachCore(k, createEngine(cfg), g.program, { entry: 0, stackTop: top - k * 0x10_00 });
    }
    const core = m.cores[k];
    assert.exists(core);
    core.regs[A0] = k;
    const core2 = m.cores[k];
    assert.exists(core2);
    core2.regs[A1] = threads;
    const core3 = m.cores[k];
    assert.exists(core3);
    core3.regs[2] = top - k * 0x10_00;
  }
  for (
    let i = 0;
    i < 2_000_000 &&
    m.cores.some((c) => {
      assert.exists(c.engine);
      return !c.engine.halted;
    });
    i++
  ) {
    m.stepCpu();
  }
  expect(
    m.cores.every((c) => {
      assert.exists(c.engine);
      return c.engine.halted;
    }),
    `${kind} ended`,
  ).toBe(true);
  for (let i = 0; i < 2000; i++) {
    m.stepCpu();
  }
  return {
    cycles: Math.max(
      ...m.cores.map((c) => {
        assert.exists(c.engine);
        return c.engine.cycle;
      }),
    ),
    text: m.display.text(),
    expected: g.meta.expectedText,
  };
}

describe('hpc kinds', () => {
  it('are templates, with the thread counts of the plan', () => {
    expect(KINDS.toSorted()).toStrictEqual([
      'hpc.bfs',
      'hpc.fft',
      'hpc.matmul',
      'hpc.montecarlo',
      'hpc.nbody',
      'hpc.reduce',
      'hpc.sort',
    ]);
    for (const k of KINDS) {
      expect(TEMPLATE_NAMES).toContain(k);
    }
    expect(HPC_THREADS).toStrictEqual({
      'hpc.reduce': 2,
      'hpc.matmul': 2,
      'hpc.nbody': 2,
      'hpc.montecarlo': 4,
      'hpc.sort': 4,
      'hpc.bfs': 8,
      'hpc.fft': 8,
    });
    for (const k of KINDS) {
      expect(generate(k, 3, { scale: 2 }).meta.threads, `for ${k}`).toBe(HPC_THREADS[k]);
    }
  });

  it('print their line, and their size follows the scale', () => {
    for (const k of KINDS) {
      const small = generate(k, 4, { scale: 1, row: 2, jobId: 9 }),
        big = generate(k, 4, { scale: 8, row: 2, jobId: 9 });
      expect(small.meta.expectedText.split('\n')[2], `for ${k}`).toMatch(
        new RegExp(`^#09 ${k.replace('.', String.raw`\.`)}=\\d{4} OK$`, 'u'),
      );
      expect(big.meta.codeWords, `for ${k}`).toBeGreaterThanOrEqual(small.meta.codeWords);
    }
  });

  it.each(KINDS)('%s: the text is the expectation under every interleaving and every thread count', (kind) => {
    for (const seed of [1, 2, 3]) {
      const g = generate(kind, seed, { row: 0, jobId: 3, scale: 2 });
      for (const threads of [1, 2, 4, 8]) {
        for (const how of [
          { kind: 'round-robin' },
          { kind: 'burst', n: 13 },
          { kind: 'random', seed: 7 + seed, max: 9 },
        ] as const) {
          expect(new RefThreads(g.program, threads).run(how), `${kind} seed ${seed} T ${threads} ${how.kind}`).toBe(
            g.meta.expectedText,
          );
        }
      }
    }
  });

  it.each(KINDS)('%s: more cores finish sooner, with the same text', (kind) => {
    const t = HPC_THREADS[kind];
    assert.exists(t);
    const one = bare(kind, 2, { threads: 1, cores: 1 }),
      all = bare(kind, 2, { threads: t, cores: t });
    expect(one.text).toBe(one.expected);
    expect(all.text).toBe(all.expected);
    expect(all.cycles, `${kind}: ${t} cores ${all.cycles} against 1 core ${one.cycles}`).toBeLessThan(one.cycles * 0.8);
  });
});
