// Full SMT in the out-of-order engine (docs/MULTICORE.md section 5): two threads in the pipeline at once, sharing the scheduler and the units.

import { afterAll, describe, expect, it } from 'vitest';
import { assemble } from '../../asm';
import { generate, TEMPLATES } from '@/features/jobs/sim/gen';
import { parSum } from '@/features/jobs/sim/gen/threadtest';
import { INTC_BASE, INTC_REG, IRQ } from '@/core/sim/memmap';
import { REG_NAMES } from '../../isa/isa';
import { Machine } from '@/core/sim';
import { RefThreads } from '../../ref';
import { createEngine, OooEngine } from '../index';
import type * as engineTypes from '../index';
import { Counter } from '../view';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

TEMPLATES['test.parS2'] = parSum(2);
afterAll(() => {
  delete TEMPLATES['test.parS2'];
});

const SMT: engineTypes.EngineConfig = {
  kind: 'ooo',
  width: 2,
  robSize: 16,
  schedSize: 8,
  fetchQueue: 8,
  cacheLines: 8,
  missPenalty: 12,
  threads: 2,
};
const PLAIN: engineTypes.EngineConfig = {
  kind: 'ooo',
  width: 2,
  robSize: 16,
  schedSize: 8,
  fetchQueue: 8,
  cacheLines: 8,
  missPenalty: 12,
};
const OUT = 0x30_00;
const word = (m: Machine, a: number) => new DataView(m.ram.buffer).getInt32(a, true);

/** The out-of-order engine `cfg` describes. */
function oooOf(cfg: engineTypes.EngineConfig): OooEngine {
  const e = createEngine(cfg);
  if (!(e instanceof OooEngine)) {
    throw new TypeError(`${cfg.kind} is not an out-of-order engine`);
  }
  return e;
}

/** Steps the CPU of `m` until `e` halts, for at most `max` cycles. */
function runToHalt(m: Machine, e: OooEngine, max: number): void {
  for (let i = 0; i < max && !e.halted; i++) {
    m.stepCpu();
  }
}

/** Stores `words` into memory one after another from `at`. */
function storeWords(m: Machine, at: number, words: Uint32Array): void {
  for (const [k, w] of words.entries()) {
    m.bus.store32(at + 4 * k, w);
  }
}

/** Sum `lines` words, one per 16-byte line from `base` (every load a miss on a small cache), and store the sum at `out`. */
const scan = (base: number, lines: number, out: number) =>
  assemble(`
    li s3, ${base}
    li t1, ${lines * 16}
    li t2, 0
    li s0, 0
  next:
    add t3, s3, t2
    lw t0, 0(t3)
    add s0, s0, t0
    addi t2, t2, 16
    bne t2, t1, next
    li t4, ${out}
    sw s0, 0(t4)
    ecall`).program;

/** A dependent chain through the multiplier: one thread cannot fill both ALUs with it. */
const chain = (n: number, out: number) =>
  assemble(`
    li s0, 3
    li s1, 5
    li t1, ${n}
  again:
    mul s0, s0, s1
    addi s0, s0, 3
    andi s0, s0, 1023
    addi t1, t1, -1
    bne t1, zero, again
    li t4, ${out}
    sw s0, 0(t4)
    ecall`).program;

/** Where to fill, how many lines and the first value: `fill` writes `seed + 7i` to the first word of line `i`. */
type Fill = [base: number, lines: number, seed: number];

function fill(m: Machine, [base, lines, seed]: Fill): void {
  for (let i = 0; i < lines; i++) {
    m.bus.store32(base + i * 16, seed + i * 7);
  }
}

/** One program alone on a plain engine (or an SMT engine with one thread). */
function alone(cfg: engineTypes.EngineConfig, p: Uint32Array, fills: Fill[] = []) {
  const m = new Machine();
  const e = oooOf(cfg);
  m.attach(e, p);
  for (const f of fills) {
    fill(m, f);
  }
  runToHalt(m, e, 400_000);
  expect(e.halted).toBe(true);
  return { m, e, cycles: e.cycle, counters: [...e.view.counters] };
}

/** Two programs as the two threads of one core. */
function pair(a: Uint32Array, b: Uint32Array, fills: Fill[] = []) {
  const m = new Machine({ cores: 2 });
  const e = oooOf(SMT);
  m.attach(e, a);
  m.attachThread(1, 0, b, { entry: 0x10_00, stackTop: m.ram.length - 0x10_00 });
  for (const f of fills) {
    fill(m, f);
  }
  runToHalt(m, e, 400_000);
  expect(e.halted).toBe(true);
  return { m, e, cycles: e.cycle };
}

const A = 0x80_00,
  B = 0xa0_00,
  LINES = 40;
const fills: Fill[] = [
  [A, LINES, 1],
  [B, LINES, 1000],
];

/** The cycles a memory-bound thread and a multiplier chain take as the two threads of one core. */
const mixedPairCycles = () => pair(scan(A, LINES, OUT), chain(100, OUT + 0x1_00), fills).cycles;

describe('full SMT in the out-of-order engine', () => {
  it('one thread is cycle-identical to the plain engine, counters and all', () => {
    for (const p of [chain(200, OUT), scan(A, LINES, OUT)]) {
      const plain = alone(PLAIN, p, fills),
        one = alone(SMT, p, fills);
      expect(one.cycles).toBe(plain.cycles);
      expect(one.counters.slice(0, Counter.SmtUnitConflicts)).toStrictEqual(
        plain.counters.slice(0, Counter.SmtUnitConflicts),
      );
      expect(word(one.m, OUT)).toBe(word(plain.m, OUT));
    }
  });

  it('a second thread that never runs leaves the values as they were', () => {
    const plain = alone(PLAIN, chain(200, OUT));
    const m = new Machine({ cores: 2 });
    const e = oooOf(SMT);
    m.attach(e, chain(200, OUT));
    m.attachThread(1, 0);
    m.parkCore(1, 0x40);
    runToHalt(m, e, 400_000);
    expect(e.halted).toBe(true);
    // the parked thread still takes its half of the ROB and the fetch queue, so the cycles may differ; the values do not
    expect(word(m, OUT)).toBe(word(plain.m, OUT));
  });

  it("two threads raise the core's instructions per cycle, with each thread's values intact", () => {
    const one = alone(PLAIN, chain(300, OUT));
    const both = pair(chain(300, OUT), chain(300, OUT + 0x1_00));
    expect(word(both.m, OUT)).toBe(word(one.m, OUT));
    expect(word(both.m, OUT + 0x1_00)).toBe(word(one.m, OUT));
    const ipc1 = must(one.counters[Counter.Retired]) / one.cycles;
    const ipc2 = must(both.e.view.counters[Counter.Retired]) / both.cycles;
    expect(ipc2).toBeGreaterThan(ipc1 * 1.2);
    expect(both.cycles).toBeLessThan(one.cycles * 2 * 0.85);
    const v = both.e.view;
    expect(must(v.threadRetired[0]) + must(v.threadRetired[1])).toBe(v.counters[Counter.Retired]);
    expect(v.threadRetired[1]).toBeGreaterThan(0);
    expect(v.threadIssued[1]).toBeGreaterThan(0);
  });

  it('two memory-bound threads are no slower than one after the other (one load at a time in the unit), with the values the plain engine gives', () => {
    const a = alone(PLAIN, scan(A, LINES, OUT), fills),
      b = alone(PLAIN, scan(B, LINES, OUT + 0x1_00), fills);
    const both = pair(scan(A, LINES, OUT), scan(B, LINES, OUT + 0x1_00), fills);
    expect(word(both.m, OUT)).toBe(word(a.m, OUT));
    expect(word(both.m, OUT + 0x1_00)).toBe(word(b.m, OUT + 0x1_00));
    expect(both.cycles).toBeLessThanOrEqual(a.cycles + b.cycles);
  });

  it('the threads fight for the units', () => {
    const both = pair(chain(300, OUT), chain(300, OUT + 0x1_00));
    expect(both.e.view.counters[Counter.SmtUnitConflicts]).toBeGreaterThan(0);
  });

  it('a parked thread woken by an interrupt runs its handler alongside the other thread and parks again', () => {
    const m = new Machine({ cores: 2 });
    const e = oooOf(SMT);
    const main = assemble(`
      li s0, 0
      li t1, 100
    first:
      addi s0, s0, 3
      addi t1, t1, -1
      bne t1, zero, first
      li t0, ${INTC_BASE}
      li t2, 2
      sw t2, ${INTC_REG.IPI}(t0)
      li t1, 300
    second:
      addi s0, s0, 3
      addi t1, t1, -1
      bne t1, zero, second
      li t4, ${OUT}
      sw s0, 0(t4)
      ecall`).program;
    const handler = assemble(`
      li t0, 77
      sw t0, ${OUT + 0x2_00}(zero)
      li t2, ${INTC_BASE}
      li t0, ${1 << IRQ.IPI}
      sw t0, ${INTC_REG.ACK}(t2)
      li t0, 1
      sw t0, ${INTC_REG.PARK}(t2)
    hold:
      j hold`).program;
    m.attach(e, main);
    m.attachThread(1, 0);
    storeWords(m, 0x20_00, handler);
    m.parkCore(1, 0x20_00);
    runToHalt(m, e, 100_000);
    expect(e.halted).toBe(true);
    expect(word(m, OUT)).toBe(1200);
    expect(word(m, OUT + 0x2_00)).toBe(77);
    expect(must(m.cores[1]).intc.taken).toBe(1);
    expect(must(m.cores[1]).intc.parked).toBe(true);
  });

  it("runs a threaded program on both threads of a core with the reference's text", () => {
    const A0 = REG_NAMES.indexOf('a0'),
      A1 = REG_NAMES.indexOf('a1');
    const g = generate('test.parS2', 5, { row: 0, jobId: 3, scale: 2 });
    const m = new Machine({ cores: 2 });
    const e = oooOf(SMT);
    const top = m.ram.length;
    m.attach(e, g.program);
    m.attachThread(1, 0, g.program, { entry: 0, stackTop: top - 0x10_00 });
    for (let k = 0; k < 2; k++) {
      must(m.cores[k]).regs[A0] = k;
      must(m.cores[k]).regs[A1] = 2;
      must(m.cores[k]).regs[2] = top - k * 0x10_00;
    }
    runToHalt(m, e, 400_000);
    expect(e.halted).toBe(true);
    for (let i = 0; i < 2000; i++) {
      m.stepCpu();
    }
    expect(m.display.text()).toBe(new RefThreads(g.program, 2).run({ kind: 'random', seed: 9 }));
    expect(m.display.text()).toBe(g.meta.expectedText);
  });

  it('is deterministic', () => {
    expect(mixedPairCycles()).toBe(mixedPairCycles());
  });
});
