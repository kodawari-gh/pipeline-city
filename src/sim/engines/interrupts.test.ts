// Interrupts on every engine (docs/CPU.md "Interrupts"): a handler may start at any instruction boundary, saves and restores
// what it uses, and the interrupted program ends with exactly the registers and memory of an uninterrupted run.
import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { INTC_BASE, INTC_REG, IRQ } from "../isa/memmap";
import { Machine, RefEngine, type Engine } from "../machine";
import { RefCpu } from "../ref";
import { CONFIGS, WIDE_CONFIGS } from "./testutil";

const COUNTER = 0xf08;
const DATA = 0x2000;
const DATA_BYTES = 0x100;

const SETUP = `
  la t0, isr
  li t1, ${INTC_BASE}
  sw t0, ${INTC_REG.VECTOR}(t1)
  li t0, ${1 << IRQ.NIC}
  sw t0, ${INTC_REG.MASK}(t1)
  li t0, 1
  sw t0, ${INTC_REG.CTRL}(t1)
`;

// Loads, stores, a multiply, a data-dependent branch and a loop: plenty of hazards for an interrupt to land in the middle of.
const WORK = `
  li s0, 0
  li s1, 0
  li s2, ${DATA}
  li s3, 24
loop:
  mul t0, s0, s0
  addi t0, t0, 3
  slli t1, s0, 2
  add t1, t1, s2
  sw t0, 0(t1)
  lw t2, 0(t1)
  add s1, s1, t2
  andi t3, s0, 1
  beq t3, zero, even
  addi s1, s1, 7
even:
  addi s0, s0, 1
  blt s0, s3, loop
  mv a0, s1
  ecall
`;

const SAVE = `
  sw t0, 0xf00(zero)
  sw t1, 0xf04(zero)
  sw t2, 0xf0c(zero)
  sw t3, 0xf10(zero)
`;
const RESTORE = `
  lw t0, 0xf00(zero)
  lw t1, 0xf04(zero)
  lw t2, 0xf0c(zero)
  lw t3, 0xf10(zero)
  iret
`;

// Saves what it clobbers, counts itself, acknowledges the line, restores, returns.
const ISR = `
isr:
  sw t0, 0xf00(zero)
  sw t1, 0xf04(zero)
  li t0, ${INTC_BASE}
  li t1, ${1 << IRQ.NIC}
  sw t1, ${INTC_REG.ACK}(t0)
  lw t1, ${COUNTER}(zero)
  addi t1, t1, 1
  sw t1, ${COUNTER}(zero)
  lw t0, 0xf00(zero)
  lw t1, 0xf04(zero)
  iret
`;

// Moves the return address to `alt` (a write to EPC right before iret) instead of going back.
const ISR_REDIRECT = `
isr:
  li t0, ${INTC_BASE}
  li t1, ${1 << IRQ.NIC}
  sw t1, ${INTC_REG.ACK}(t0)
  la t1, alt
  sw t1, ${INTC_REG.EPC}(t0)
  iret
alt:
  li a0, 99
  ecall
`;

const ENGINES: { name: string; make: () => Engine }[] = [
  { name: "ref", make: () => new RefEngine() },
  ...CONFIGS.map((c) => ({ name: c.name, make: () => c.make() })),
  ...WIDE_CONFIGS.map((c) => ({ name: c.name, make: () => c.make() })),
  // the optional parts: an interrupt during an instruction cache miss, an L2 refill or a 2-bit predicted loop is still precise
  ...WIDE_CONFIGS.map((c) => ({ name: `${c.name} +I$ +2way +L2 +2bit`, make: () => c.make({ icacheLines: 4, cacheLines: 8, ways: 2, l2Lines: 16, predBits: 2 }) })),
];

interface Result { regs: number[]; data: Uint8Array; count: number; cycles: number; taken: number; maxLatency: number; machine: Machine }

/** Run to halt, raising the NIC line at each given cycle. */
function run(make: () => Engine, src: string, raiseAt: number[] = [], maxCycles = 100_000): Result {
  const m = new Machine();
  const e = make();
  m.attach(e, assemble(src).program);
  let cyc = 0;
  while (!e.halted) {
    if (cyc >= maxCycles) throw new Error("did not halt");
    if (raiseAt.includes(cyc)) m.intc.raise(IRQ.NIC);
    m.stepCpu();
    cyc++;
  }
  return {
    regs: Array.from(m.regs), data: m.ram.slice(DATA, DATA + DATA_BYTES), count: m.bus.load32(COUNTER),
    cycles: cyc, taken: m.intc.taken, maxLatency: m.intc.maxLatency, machine: m,
  };
}

const MAIN = SETUP + WORK + ISR;

describe("interrupts: the interrupted program is unchanged", () => {
  const base = run(() => new RefEngine(), MAIN);

  it("an uninterrupted run takes none", () => {
    expect(base.taken).toBe(0);
    expect(base.count).toBe(0);
    expect(base.regs[3]).toBeGreaterThan(0);
  });

  for (const eng of ENGINES) {
    it(`${eng.name}: one interrupt at any cycle leaves registers and memory as an uninterrupted run`, () => {
      const quiet = run(eng.make, MAIN);
      expect(quiet.regs).toEqual(base.regs);
      const last = Math.floor(quiet.cycles * 0.85);
      const step = Math.max(1, Math.floor(last / 120));
      for (let at = 0; at <= last; at += step) {
        const r = run(eng.make, MAIN, [at]);
        expect(r.count, `${eng.name} raised at ${at}`).toBe(1);
        expect(r.taken).toBe(1);
        expect(r.regs, `${eng.name} raised at ${at}`).toEqual(base.regs);
        expect(r.data, `${eng.name} raised at ${at}`).toEqual(base.data);
      }
    });

    it(`${eng.name}: a burst of interrupts is handled and the result still matches`, () => {
      const quiet = run(eng.make, MAIN);
      const last = Math.floor(quiet.cycles * 0.6);
      for (let at = 5; at < last; at += 37) {
        const r = run(eng.make, MAIN, [at, at + 2, at + 31, at + 90]);
        expect(r.count, `raised at ${at}`).toBeGreaterThanOrEqual(1);
        expect(r.count).toBeLessThanOrEqual(4);
        expect(r.regs, `raised at ${at}`).toEqual(base.regs);
        expect(r.data).toEqual(base.data);
      }
    });

    it(`${eng.name}: a handler that rewrites EPC redirects the return`, () => {
      const src = SETUP + WORK + ISR_REDIRECT;
      const quiet = run(eng.make, src);
      const last = Math.floor(quiet.cycles * 0.85);
      for (let at = 0; at <= last; at += Math.max(1, Math.floor(last / 40))) {
        const r = run(eng.make, src, [at]);
        expect(r.regs[3], `raised at ${at}`).toBe(99);
        expect(r.taken).toBe(1);
      }
    });

    it(`${eng.name}: the delay before the handler starts is bounded by the pipeline`, () => {
      const quiet = run(eng.make, MAIN);
      let worst = 0;
      for (let at = 0; at <= Math.floor(quiet.cycles * 0.85); at += 3) worst = Math.max(worst, run(eng.make, MAIN, [at]).maxLatency);
      // A pipeline empties in a handful of cycles (a cache miss freeze adds a few more); the reference is instant.
      expect(worst).toBeLessThanOrEqual(eng.name === "ref" ? 0 : 40);
    });

    it(`${eng.name}: interrupts stay off until they are enabled, and a masked line never fires`, () => {
      const noIe = SETUP.replace(`sw t0, ${INTC_REG.CTRL}(t1)`, "nop") + WORK + ISR;
      const a = run(eng.make, noIe, [10, 20]);
      expect(a.taken).toBe(0);
      expect(a.regs).toEqual(base.regs);
      const masked = SETUP.replace(`li t0, ${1 << IRQ.NIC}`, "li t0, 0") + WORK + ISR;
      const b = run(eng.make, masked, [10, 20]);
      expect(b.taken).toBe(0);
      expect(b.machine.intc.pending).toBe(1 << IRQ.NIC); // still latched, waiting for the mask
      expect(b.regs).toEqual(base.regs);
    });
  }

  it("the run is deterministic", () => {
    for (const eng of ENGINES) {
      const a = run(eng.make, MAIN, [40, 77]);
      const b = run(eng.make, MAIN, [40, 77]);
      expect(b.cycles).toBe(a.cycles);
      expect(b.regs).toEqual(a.regs);
    }
  });
});

describe("interrupts: entry and return", () => {
  it("a bare reference CPU has no interrupt controller for iret", () => {
    const cpu = new RefCpu();
    cpu.load(assemble("iret").program);
    expect(() => cpu.step()).toThrow(/iret without an interrupt controller/);
  });

  it("an engine that cannot be interrupted never takes one", () => {
    const m = new Machine();
    const e = new RefEngine();
    m.attach(e, assemble(MAIN).program);
    Object.defineProperty(e, "drained", { value: undefined });
    m.intc.raise(IRQ.NIC);
    for (let k = 0; k < 2000 && !e.halted; k++) m.stepCpu();
    expect(m.intc.taken).toBe(0);
  });

  it("the handler sees the line and the return address in the controller's registers", () => {
    const src = SETUP + WORK + `
isr:${SAVE}
  li t0, ${INTC_BASE}
  lw t1, ${INTC_REG.CAUSE}(t0)
  sw t1, 0xf20(zero)
  lw t1, ${INTC_REG.EPC}(t0)
  sw t1, 0xf24(zero)
  li t1, ${1 << IRQ.NIC}
  sw t1, ${INTC_REG.ACK}(t0)
${RESTORE}`;
    for (const eng of ENGINES) {
      const r = run(eng.make, src, [30]);
      expect(r.machine.bus.load32(0xf20), eng.name).toBe(IRQ.NIC);
      const epc = r.machine.bus.load32(0xf24);
      expect(epc % 4, eng.name).toBe(0);
      expect(epc, eng.name).toBeGreaterThan(0);
    }
  });

  const base = run(() => new RefEngine(), MAIN);

  it("a line that is not acknowledged fires again as soon as iret enables interrupts", () => {
    const src = SETUP + WORK + `
isr:${SAVE}
  lw t0, ${COUNTER}(zero)
  addi t0, t0, 1
  sw t0, ${COUNTER}(zero)
  li t1, 3
  blt t0, t1, back
  li t0, ${INTC_BASE}
  li t1, ${1 << IRQ.NIC}
  sw t1, ${INTC_REG.ACK}(t0)
back:
${RESTORE}`;
    for (const eng of ENGINES) {
      const r = run(eng.make, src, [30]);
      expect(r.count, eng.name).toBe(3);
      expect(r.taken, eng.name).toBe(3);
      expect(r.machine.intc.pending, eng.name).toBe(0);
      expect(r.regs, eng.name).toEqual(base.regs);
    }
  });

  it("the lowest pending line is taken first", () => {
    const src = SETUP.replace(`li t0, ${1 << IRQ.NIC}`, `li t0, ${(1 << IRQ.NIC) | (1 << IRQ.USB)}`) + WORK + `
isr:${SAVE}
  li t0, ${INTC_BASE}
  lw t1, ${INTC_REG.CAUSE}(t0)
  li t2, 1
  sll t2, t2, t1
  sw t2, ${INTC_REG.ACK}(t0)
  lw t3, 0xf28(zero)
  slli t3, t3, 4
  add t3, t3, t1
  sw t3, 0xf28(zero)
${RESTORE}`;
    for (const eng of ENGINES) {
      const m = new Machine();
      const e = eng.make();
      m.attach(e, assemble(src).program);
      for (let k = 0; k < 60; k++) m.stepCpu();
      m.intc.raise(IRQ.USB);
      m.intc.raise(IRQ.NIC);
      for (let k = 0; k < 100_000 && !e.halted; k++) m.stepCpu();
      // Both were served, the NIC (line 1) before the USB port (line 3): 0x13.
      expect(m.bus.load32(0xf28), eng.name).toBe(0x13);
    }
  });
});
