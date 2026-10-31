import { describe, expect, it } from "vitest";
import { assemble } from "./asm";
import { createEngine, type EngineConfig } from "./engines";
import { REG_NAMES } from "./isa/isa";
import { INTC_BASE, INTC_REG, IRQ } from "@/core/sim/memmap";
import { Machine } from "@/core/sim/index";

// Each program sums 1..n and stores the sum at an address of its own.
const prog = (n: number, out: number) => assemble(`
    li t0, 0
    li t1, 1
    li t2, ${n + 1}
  loop:
    add t0, t0, t1
    addi t1, t1, 1
    bne t1, t2, loop
    li s3, ${out}
    sw t0, 0(s3)
    ecall`).program;

const ENGINES: [string, EngineConfig][] = [
  ["ref", { kind: "ref" }],
  ["unpipelined", { kind: "unpipelined" }],
  ["inorder", { kind: "inorder", forwarding: true, cacheLines: 4 }],
  ["ooo", { kind: "ooo", width: 2, robSize: 16, schedSize: 8, fetchQueue: 8 }],
];
const A = prog(10, 0x3000), B = prog(20, 0x3004);
const B_AT = 0x1000;

function solo(cfg: EngineConfig, p: Uint32Array): number {
  const m = new Machine();
  const e = createEngine(cfg);
  m.attach(e, p);
  while (!e.halted) m.stepCpu();
  return e.cycle;
}

function run(cfg: EngineConfig, cores = 2): Machine {
  const m = new Machine({ cores });
  m.attach(createEngine(cfg), A);
  m.attachCore(1, createEngine(cfg), B, { entry: B_AT, stackTop: m.ram.length - 0x1000 });
  for (let i = 0; i < 5000 && m.cores.some((c) => !c.engine!.halted); i++) m.stepCpu();
  return m;
}

describe("Machine cores", () => {
  it("a machine has one core by default and core 0's state is the machine's", () => {
    const m = new Machine();
    expect(m.cores).toHaveLength(1);
    expect(m.regs).toBe(m.cores[0]!.regs);
    expect(m.intc).toBe(m.cores[0]!.intc);
    expect(m.mmu).toBe(m.cores[0]!.mmu);
    expect(() => new Machine({ cores: 0 })).toThrow(RangeError);
  });

  describe.each(ENGINES)("two programs side by side on %s", (_name, cfg) => {
    it("both finish with their own result and their own registers", () => {
      const m = run(cfg);
      const dv = new DataView(m.ram.buffer);
      expect(dv.getUint32(0x3000, true)).toBe(55);
      expect(dv.getUint32(0x3004, true)).toBe(210);
      const T0 = REG_NAMES.indexOf("t0");
      expect(m.cores[0]!.regs[T0]).toBe(55);
      expect(m.cores[1]!.regs[T0]).toBe(210);
      expect(m.cores[0]!.regs).not.toBe(m.cores[1]!.regs);
    });

    it("each core takes as long as it does alone, and a rerun is the same", () => {
      const m = run(cfg), again = run(cfg);
      expect(m.cores[0]!.engine!.cycle).toBe(solo(cfg, A));
      expect(m.cores[1]!.engine!.cycle).toBe(again.cores[1]!.engine!.cycle);
      expect(m.cores[1]!.engine!.cycle).toBeGreaterThan(m.cores[0]!.engine!.cycle);
    });
  });

  it("the interrupt controller is banked: the same address, one bank per core", () => {
    const m = new Machine({ cores: 2 });
    m.bus.serve(0, m.cores[0]!.mpu);
    m.bus.store32(INTC_BASE + INTC_REG.MASK, 0x5);
    m.bus.serve(1, m.cores[1]!.mpu);
    expect(m.bus.load32(INTC_BASE + INTC_REG.MASK)).toBe(0);
    m.bus.store32(INTC_BASE + INTC_REG.MASK, 0x2);
    expect(m.cores[0]!.intc.mask).toBe(5);
    expect(m.cores[1]!.intc.mask).toBe(2);
    m.bus.serve(0, m.cores[0]!.mpu);
    expect(m.bus.load32(INTC_BASE + INTC_REG.MASK)).toBe(5);
  });

  it("each core has its own timer and interrupt line", () => {
    const m = new Machine({ cores: 2 });
    m.attach(createEngine({ kind: "ref" }), A);
    m.attachCore(1, createEngine({ kind: "ref" }), B, { entry: B_AT, stackTop: m.ram.length - 0x1000 });
    m.cores[1]!.timer.interval = 3;
    for (let i = 0; i < 4; i++) m.stepCpu();
    expect(m.cores[1]!.intc.pending & (1 << IRQ.TIMER)).not.toBe(0);
    expect(m.cores[0]!.intc.pending & (1 << IRQ.TIMER)).toBe(0);
  });

  it("a 1-core machine takes the same cycles as before the split (see golden.test.ts), and ignores a missing second core", () => {
    const cfg: EngineConfig = { kind: "inorder", forwarding: true };
    expect(run(cfg, 2).cores[0]!.engine!.cycle).toBe(solo(cfg, A));
    expect(() => new Machine().attachCore(1, createEngine(cfg), B)).toThrow(RangeError);
  });
});
