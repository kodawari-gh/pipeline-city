// The event log shows what the OS does to the CPU, in order: an interrupt taken (Ev.Irq), the return (Ev.Iret) and a new address space (Ev.Space).
import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { INTC_BASE, INTC_REG, IRQ, MMU_BASE, MMU_REG } from "../isa/memmap";
import { Machine } from "../machine";
import { Ev } from "./common";
import { CONFIGS } from "./testutil";

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

describe("device accesses in the engine log", () => {
  for (const c of CONFIGS) {
    it(`${c.name}: a load from a device is logged like a load from RAM (the board shows what a drive or a key sends)`, () => {
      const m = new Machine();
      const e = c.make();
      m.attach(e, assemble(DEVICE_SRC).program);
      for (let cyc = 0; !e.halted && cyc < 5_000; cyc++) m.stepCpu();
      expect(e.halted).toBe(true);
      const flat = (e as unknown as { storedState(): { events: { since(n: number): number[] } } }).storedState().events.since(0);
      const mem: { kind: number; addr: number }[] = [];
      for (let k = 0; k < flat.length; k += 6) if (flat[k + 1] === Ev.Mem) mem.push({ kind: flat[k + 2]!, addr: flat[k + 3]! >>> 0 });
      expect(mem).toContainEqual({ kind: 0, addr: INTC_BASE + INTC_REG.COUNT });
      expect(mem).toContainEqual({ kind: 1, addr: INTC_BASE + INTC_REG.MASK });
    });
  }
});

describe("OS events in the engine log", () => {
  for (const c of CONFIGS) {
    it(`${c.name}: an interrupt, its return and a table switch are logged in order`, () => {
      const m = new Machine();
      const e = c.make();
      m.attach(e, assemble(SRC).program);
      for (let cyc = 0; !e.halted && cyc < 50_000; cyc++) { if (cyc === 120) m.intc.raise(IRQ.NIC); m.stepCpu(); }
      expect(e.halted).toBe(true);
      const flat = (e as unknown as { storedState(): { events: { since(n: number): number[] } } }).storedState().events.since(0);
      const kinds: number[] = [];
      for (let k = 0; k < flat.length; k += 6) kinds.push(flat[k + 1]!);
      const irq = kinds.indexOf(Ev.Irq), iret = kinds.indexOf(Ev.Iret), space = kinds.indexOf(Ev.Space);
      expect(space).toBeGreaterThanOrEqual(0);
      expect(irq).toBeGreaterThan(space);
      expect(iret).toBeGreaterThan(irq);
    });
  }
});
