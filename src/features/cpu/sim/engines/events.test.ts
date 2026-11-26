// The event log shows what the OS does to the CPU, in order: an interrupt taken (Ev.Irq), the return (Ev.Iret) and a new address space (Ev.Space).
import { describe, expect, it } from 'vitest';
import { assemble } from '../asm';
import { INTC_BASE, INTC_REG, IRQ, MMU_BASE, MMU_REG } from '@/core/sim/memmap';
import { Machine } from '@/core/sim';
import { Ev } from './events';
import { CONFIGS } from './testutil';
import type { PipelineEngine } from './contract';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const SRC = `
  la t0, isr
  li t1, ${INTC_BASE}
  sw t0, ${INTC_REG.VECTOR}(t1)
  li t0, ${1 << IRQ.NIC}
  sw t0, ${INTC_REG.MASK}(t1)
  li t0, 1
  sw t0, ${INTC_REG.CTRL}(t1)
  li t2, ${MMU_BASE}
  li t0, 4096
  sw t0, ${MMU_REG.TABLE}(t2)
  li s0, 0
  li s1, 200
loop:
  addi s0, s0, 1
  blt s0, s1, loop
  ecall
isr:
  li t0, ${INTC_BASE}
  li t1, ${1 << IRQ.NIC}
  sw t1, ${INTC_REG.ACK}(t0)
  iret
`;

/** A load from a device register and a store to it, then halt. */
const DEVICE_SRC = `
  li t1, ${INTC_BASE}
  lw t3, ${INTC_REG.COUNT}(t1)
  sw t3, ${INTC_REG.MASK}(t1)
  ecall
`;

/** Steps the CPU of `m` until `e` halts, for at most `max` cycles, raising `irq.line` on the controller at cycle `irq.at`. */
function stepToHalt(m: Machine, e: PipelineEngine, run: { max: number; irq?: { at: number; line: number } }): void {
  for (let cyc = 0; !e.halted && cyc < run.max; cyc++) {
    if (cyc === run.irq?.at) {
      m.intc.raise(run.irq.line);
    }
    m.stepCpu();
  }
}

/** The memory accesses of a flat event log: their kind (0 load, 1 store) and unsigned address. */
function memAccesses(flat: number[]): { kind: number; addr: number }[] {
  const mem: { kind: number; addr: number }[] = [];
  for (let k = 0; k < flat.length; k += 6) {
    if (flat[k + 1] === Ev.Mem) {
      mem.push({ kind: must(flat[k + 2]), addr: must(flat[k + 3]) >>> 0 });
    }
  }
  return mem;
}

describe('device accesses in the engine log', () => {
  it.each(CONFIGS)(
    '$name: a load from a device is logged like a load from RAM (the board shows what a drive or a key sends)',
    (c) => {
      const m = new Machine();
      const e = c.make();
      m.attach(e, assemble(DEVICE_SRC).program);
      stepToHalt(m, e, { max: 5000 });
      expect(e.halted).toBe(true);
      const mem = memAccesses(e.storedState().events.since(0));
      expect(mem).toContainEqual({ kind: 0, addr: INTC_BASE + INTC_REG.COUNT });
      expect(mem).toContainEqual({ kind: 1, addr: INTC_BASE + INTC_REG.MASK });
    },
  );
});

describe('OS events in the engine log', () => {
  it.each(CONFIGS)('$name: an interrupt, its return and a table switch are logged in order', (c) => {
    const m = new Machine();
    const e = c.make();
    m.attach(e, assemble(SRC).program);
    stepToHalt(m, e, { max: 50_000, irq: { at: 120, line: IRQ.NIC } });
    expect(e.halted).toBe(true);
    const flat = e.storedState().events.since(0);
    const kinds: number[] = [];
    for (let k = 0; k < flat.length; k += 6) {
      kinds.push(must(flat[k + 1]));
    }
    const irq = kinds.indexOf(Ev.Irq),
      iret = kinds.indexOf(Ev.Iret),
      space = kinds.indexOf(Ev.Space);
    expect(space).toBeGreaterThanOrEqual(0);
    expect(irq).toBeGreaterThan(space);
    expect(iret).toBeGreaterThan(irq);
  });
});
