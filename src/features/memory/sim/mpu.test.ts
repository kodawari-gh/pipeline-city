import { describe, expect, it } from "vitest";
import { assemble } from "../../cpu/sim/asm";
import { createEngine, type EngineConfig } from "../../cpu/sim/engines";
import { KERNEL_FAULT, MPU_BASE, MPU_REG } from "@/core/sim/memmap";
import { Machine } from "@/core/sim/machine";

const PROGRAM = `
  li s0, ${MPU_BASE}
  li t0, 0x2000
  sw t0, ${MPU_REG.R0_LO}(s0)
  li t0, 0x3000
  sw t0, ${MPU_REG.R0_HI}(s0)
  li t1, 7
  li s1, 0x2800
  sw t1, 0(s1)          # not protected yet: lands
  li t0, 1
  sw t0, ${MPU_REG.ENABLE}(s0)
  sw t1, 4(s1)          # protected: dropped, the CPU is sent to the handler
  li t2, 99
  sw t2, 0x700(zero)    # never reached
spin:
  j spin`;

// the "kernel's" fault handler, at the fault vector
const HANDLER = `
  li t0, 0xBEEF
  sw t0, 0x500(zero)
  ecall`;

const ENGINES: { name: string; cfg: EngineConfig }[] = [
  { name: "inorder", cfg: { kind: "inorder", forwarding: true } },
  { name: "inorder2", cfg: { kind: "inorder2", forwarding: true } },
  { name: "ooo", cfg: { kind: "ooo", robSize: 8, commitWidth: 2 } },
  { name: "unpipelined", cfg: { kind: "unpipelined" } },
];

function run(cfg: EngineConfig): Machine {
  const m = new Machine();
  const e = createEngine(cfg);
  m.attach(e, assemble(PROGRAM).program);
  assemble(HANDLER).program.forEach((w, i) => m.bus.store32(KERNEL_FAULT + 4 * i, w));
  for (let i = 0; i < 5000 && !e.halted; i++) m.stepCpu();
  return m;
}

describe("memory protection unit", () => {
  it("is off after reset and stores anywhere land", () => {
    const m = new Machine();
    expect(m.mpu.enabled).toBe(false);
    m.bus.store32(0x2800, 5);
    expect(m.bus.load32(0x2800)).toBe(5);
    expect(m.mpu.faults).toBe(0);
  });

  it("registers read back as words and bytes", () => {
    const m = new Machine();
    m.bus.store32(MPU_BASE + MPU_REG.R1_LO, 0x1234_5678);
    expect(m.mpu.lo[1]).toBe(0x1234_5678);
    expect(m.bus.load32(MPU_BASE + MPU_REG.R1_LO)).toBe(0x1234_5678);
    m.bus.store32(MPU_BASE + MPU_REG.ENABLE, 1);
    expect(m.mpu.enabled).toBe(true);
  });

  it.each(ENGINES)("$name: a store into a protected range is dropped and sends the CPU to the fault handler", ({ cfg }) => {
    const m = run(cfg);
    expect(m.bus.load32(0x2800)).toBe(7); // before the unit was on
    expect(m.bus.load32(0x2804)).toBe(0); // refused
    expect(m.bus.load32(0x500)).toBe(0xbeef); // the handler ran
    expect(m.bus.load32(0x700)).toBe(0); // the job did not go on
    expect(m.mpu.faults).toBe(1);
    expect(m.mpu.faultAddr).toBe(0x2804);
    expect(m.mpu.enabled).toBe(false); // the handler runs as the kernel
  });
});
