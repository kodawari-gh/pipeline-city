// Switch-on-miss threads in the in-order engine (docs/MULTICORE.md section 5).

import { describe, expect, it } from 'vitest';
import { assemble } from '../../asm';
import { INTC_BASE, INTC_REG, IRQ } from '@/core/sim/memmap';
import { Machine } from '@/core/sim';
import { createEngine, InOrderEngine } from '../index';
import type * as engineTypes from '../index';
import { Counter } from '../view';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const CFG: engineTypes.EngineConfig = { kind: 'inorder', forwarding: true, cacheLines: 8, missPenalty: 12 };
const OUT = 0x30_00;
const word = (m: Machine, a: number) => new DataView(m.ram.buffer).getInt32(a, true);

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

/** Pure arithmetic: no loads at all. */
const spin = (n: number, out: number) =>
  assemble(`
    li s0, 0
    li t1, ${n}
  again:
    addi s0, s0, 3
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

/** The in-order engine `CFG` describes. */
function inorder(): InOrderEngine {
  const e = createEngine(CFG);
  if (!(e instanceof InOrderEngine)) {
    throw new TypeError(`${CFG.kind} is not the in-order engine`);
  }
  return e;
}

/** Steps the CPU of `m` until `e` halts, for at most `max` cycles. */
function runToHalt(m: Machine, e: ReturnType<typeof createEngine>, max: number): void {
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

/** The word program `p` stores at `out` on the reference interpreter, with memory filled as `f` says. */
function refValue(p: Uint32Array, f: Fill, out: number): number {
  const m = new Machine();
  const e = createEngine({ kind: 'ref' });
  m.attach(e, p);
  fill(m, f);
  while (!e.halted) {
    m.stepCpu();
  }
  return word(m, out);
}

/** One thread alone on a plain engine: its cycles and its stored value. */
function alone(p: Uint32Array, fills: Fill[], out: number): { cycles: number; value: number; m: Machine } {
  const m = new Machine();
  const e = inorder();
  m.attach(e, p);
  for (const f of fills) {
    fill(m, f);
  }
  runToHalt(m, e, 400_000);
  expect(e.halted).toBe(true);
  return { cycles: e.cycle, value: word(m, out), m };
}

/** Two threads on one core. */
function pair(a: Uint32Array, b: Uint32Array, fills: Fill[]): { m: Machine; cycles: number; e: InOrderEngine } {
  const m = new Machine({ cores: 2 });
  const e = inorder();
  m.attach(e, a);
  m.attachThread(1, 0, b, { entry: 0x10_00, stackTop: m.ram.length - 0x10_00 });
  for (const f of fills) {
    fill(m, f);
  }
  runToHalt(m, e, 400_000);
  expect(e.halted).toBe(true);
  return { m, cycles: e.cycle, e };
}

const A = 0x80_00,
  B = 0xa0_00,
  LINES = 40;
const fills: Fill[] = [
  [A, LINES, 1],
  [B, LINES, 1000],
];

/** The cycles two memory-bound threads take on one core. */
const scanPairCycles = () => pair(scan(A, LINES, OUT), scan(B, LINES, OUT + 0x1_00), fills).cycles;

describe('switch-on-miss threads', () => {
  it('a second thread that never runs leaves the cycles exactly as they were', () => {
    const solo = alone(scan(A, LINES, OUT), fills, OUT);
    const m = new Machine({ cores: 2 });
    const e = inorder();
    m.attach(e, scan(A, LINES, OUT));
    m.attachThread(1, 0);
    m.parkCore(1, 0x40);
    for (const f of fills) {
      fill(m, f);
    }
    runToHalt(m, e, 400_000);
    expect(e.halted).toBe(true);
    expect(e.cycle).toBe(solo.cycles);
    expect(word(m, OUT)).toBe(solo.value);
    expect(e.view.counters[Counter.ThreadSwitches]).toBe(0);
  });

  it('two memory-bound threads finish sooner than one after the other, with the values the reference gives', () => {
    const pa = scan(A, LINES, OUT),
      pb = scan(B, LINES, OUT + 0x1_00);
    const a = alone(pa, fills, OUT),
      b = alone(pb, fills, OUT + 0x1_00);
    const both = pair(pa, pb, fills);
    expect(word(both.m, OUT)).toBe(a.value);
    expect(word(both.m, OUT + 0x1_00)).toBe(b.value);
    expect(both.cycles).toBeLessThan((a.cycles + b.cycles) * 0.85);
    expect(both.e.view.counters[Counter.ThreadSwitches]).toBeGreaterThan(5);
  });

  it('agrees with the reference interpreter', () => {
    const both = pair(scan(A, LINES, OUT), scan(B, LINES, OUT + 0x1_00), fills);
    expect(word(both.m, OUT)).toBe(refValue(scan(A, LINES, OUT), [A, LINES, 1], OUT));
    expect(word(both.m, OUT + 0x1_00)).toBe(refValue(scan(B, LINES, OUT + 0x1_00), [B, LINES, 1000], OUT + 0x1_00));
  });

  it('a compute-bound pair gains nothing, and still gets its values', () => {
    const pa = spin(300, OUT),
      pb = spin(300, OUT + 0x1_00);
    const a = alone(pa, [], OUT),
      b = alone(pb, [], OUT + 0x1_00);
    const both = pair(pa, pb, []);
    expect(word(both.m, OUT)).toBe(900);
    expect(word(both.m, OUT + 0x1_00)).toBe(900);
    expect(both.cycles).toBeGreaterThanOrEqual(a.cycles + b.cycles - 4);
    expect(both.e.view.counters[Counter.ThreadSwitches]).toBeGreaterThanOrEqual(1); // the first thread ends, and the timeout hands the pipeline over now and then
  });

  it('a parked thread woken by an interrupt gets the core from a thread that never misses, runs its handler and parks again', () => {
    const m = new Machine({ cores: 2 });
    const e = inorder();
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
    expect(e.view.counters[Counter.ThreadSwitches]).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic', () => {
    expect(scanPairCycles()).toBe(scanPairCycles());
  });
});
