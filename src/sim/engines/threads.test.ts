// Switch-on-miss threads in the in-order engine (docs/MULTICORE.md section 5).

import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { INTC_BASE, INTC_REG, IRQ } from "../isa/memmap";
import { Machine } from "../machine";
import { createEngine, type EngineConfig } from "./index";
import { Counter } from "./view";

const CFG: EngineConfig = { kind: "inorder", forwarding: true, cacheLines: 8, missPenalty: 12 };
const OUT = 0x3000;
const word = (m: Machine, a: number) => new DataView(m.ram.buffer).getInt32(a, true);

/** Sum `lines` words, one per 16-byte line from `base` (every load a miss on a small cache), and store the sum at `out`. */
const scan = (base: number, lines: number, out: number) => assemble(`
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
const spin = (n: number, out: number) => assemble(`
    li s0, 0
    li t1, ${n}
  again:
    addi s0, s0, 3
    addi t1, t1, -1
    bne t1, zero, again
    li t4, ${out}
    sw s0, 0(t4)
    ecall`).program;

function fill(m: Machine, base: number, lines: number, seed: number): void {
  for (let i = 0; i < lines; i++) m.bus.store32(base + i * 16, seed + i * 7);
}

/** One thread alone on a plain engine: its cycles and its stored value. */
function alone(p: Uint32Array, fills: [number, number, number][], out: number): { cycles: number; value: number; m: Machine } {
  const m = new Machine();
  const e = createEngine(CFG);
  m.attach(e, p);
  for (const f of fills) fill(m, ...f);
  for (let i = 0; i < 400_000 && !e.halted; i++) m.stepCpu();
  expect(e.halted).toBe(true);
  return { cycles: e.cycle, value: word(m, out), m };
}

/** Two threads on one core. */
function pair(a: Uint32Array, b: Uint32Array, fills: [number, number, number][]): { m: Machine; cycles: number; e: ReturnType<typeof createEngine> } {
  const m = new Machine({ cores: 2 });
  const e = createEngine(CFG);
  m.attach(e, a);
  m.attachThread(1, 0, b, { entry: 0x1000, stackTop: m.ram.length - 0x1000 });
  for (const f of fills) fill(m, ...f);
  for (let i = 0; i < 400_000 && !e.halted; i++) m.stepCpu();
  expect(e.halted).toBe(true);
  return { m, cycles: e.cycle, e };
}

const counters = (e: unknown) => (e as { view: { counters: Float64Array } }).view.counters;

describe("switch-on-miss threads", () => {
  const A = 0x8000, B = 0xa000, LINES = 40;
  const fills: [number, number, number][] = [[A, LINES, 1], [B, LINES, 1000]];

  it("a second thread that never runs leaves the cycles exactly as they were", () => {
    const solo = alone(scan(A, LINES, OUT), fills, OUT);
    const m = new Machine({ cores: 2 });
    const e = createEngine(CFG);
    m.attach(e, scan(A, LINES, OUT));
    m.attachThread(1, 0);
    m.parkCore(1, 0x40);
    for (const f of fills) fill(m, ...f);
    for (let i = 0; i < 400_000 && !e.halted; i++) m.stepCpu();
    expect(e.halted).toBe(true);
    expect(e.cycle).toBe(solo.cycles);
    expect(word(m, OUT)).toBe(solo.value);
    expect(counters(e)[Counter.ThreadSwitches]).toBe(0);
  });

  it("two memory-bound threads finish sooner than one after the other, with the values the reference gives", () => {
    const pa = scan(A, LINES, OUT), pb = scan(B, LINES, OUT + 0x100);
    const a = alone(pa, fills, OUT), b = alone(pb, fills, OUT + 0x100);
    const both = pair(pa, pb, fills);
    expect(word(both.m, OUT)).toBe(a.value);
    expect(word(both.m, OUT + 0x100)).toBe(b.value);
    expect(both.cycles).toBeLessThan((a.cycles + b.cycles) * 0.85);
    expect(counters(both.e)[Counter.ThreadSwitches]).toBeGreaterThan(5);
  });

  it("agrees with the reference interpreter", () => {
    const run = (p: Uint32Array, base: number, seed: number, out: number): number => {
      const m = new Machine();
      const e = createEngine({ kind: "ref" });
      m.attach(e, p);
      fill(m, base, LINES, seed);
      while (!e.halted) m.stepCpu();
      return word(m, out);
    };
    const both = pair(scan(A, LINES, OUT), scan(B, LINES, OUT + 0x100), fills);
    expect(word(both.m, OUT)).toBe(run(scan(A, LINES, OUT), A, 1, OUT));
    expect(word(both.m, OUT + 0x100)).toBe(run(scan(B, LINES, OUT + 0x100), B, 1000, OUT + 0x100));
  });

  it("a compute-bound pair gains nothing, and still gets its values", () => {
    const pa = spin(300, OUT), pb = spin(300, OUT + 0x100);
    const a = alone(pa, [], OUT), b = alone(pb, [], OUT + 0x100);
    const both = pair(pa, pb, []);
    expect(word(both.m, OUT)).toBe(900);
    expect(word(both.m, OUT + 0x100)).toBe(900);
    expect(both.cycles).toBeGreaterThanOrEqual(a.cycles + b.cycles - 4);
    expect(counters(both.e)[Counter.ThreadSwitches]).toBeGreaterThanOrEqual(1); // the first thread ends, and the timeout hands the pipeline over now and then
  });

  it("a parked thread woken by an interrupt gets the core from a thread that never misses, runs its handler and parks again", () => {
    const m = new Machine({ cores: 2 });
    const e = createEngine(CFG);
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
      sw t0, ${OUT + 0x200}(zero)
      li t2, ${INTC_BASE}
      li t0, ${1 << IRQ.IPI}
      sw t0, ${INTC_REG.ACK}(t2)
      li t0, 1
      sw t0, ${INTC_REG.PARK}(t2)
    hold:
      j hold`).program;
    m.attach(e, main);
    m.attachThread(1, 0);
    handler.forEach((w, k) => m.bus.store32(0x2000 + 4 * k, w));
    m.parkCore(1, 0x2000);
    for (let i = 0; i < 100_000 && !e.halted; i++) m.stepCpu();
    expect(e.halted).toBe(true);
    expect(word(m, OUT)).toBe(1200);
    expect(word(m, OUT + 0x200)).toBe(77);
    expect(m.cores[1]!.intc.taken).toBe(1);
    expect(m.cores[1]!.intc.parked).toBe(true);
    expect(counters(e)[Counter.ThreadSwitches]).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic", () => {
    const run = () => pair(scan(A, LINES, OUT), scan(B, LINES, OUT + 0x100), fills).cycles;
    expect(run()).toBe(run());
  });
});
