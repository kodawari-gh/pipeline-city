import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { RefCpu, RefFault } from "./index";

function run(src: string, maxSteps?: number): RefCpu {
  const cpu = new RefCpu();
  cpu.load(assemble(src).program);
  cpu.run(maxSteps);
  return cpu;
}
const reg = (cpu: RefCpu, n: number): number => cpu.regs[n]!;

describe("reference interpreter", () => {
  it("sums 1..10 in a loop", () => {
    const cpu = run(`
      li a0, 0
      li a1, 1
      li a2, 11
    loop:
      add a0, a0, a1
      addi a1, a1, 1
      blt a1, a2, loop
      ecall
    `);
    expect(reg(cpu, 3)).toBe(55);
    expect(cpu.halted).toBe(true);
  });

  it("supports call/ret with stack", () => {
    const cpu = run(`
      li a0, 6
      call fact
      ecall
    fact:                 # a0 = a0!
      addi sp, sp, -8
      sw ra, 0(sp)
      sw a0, 4(sp)
      li t0, 2
      blt a0, t0, base
      addi a0, a0, -1
      call fact
      lw t1, 4(sp)
      mul a0, a0, t1
      j done
    base:
      li a0, 1
    done:
      lw ra, 0(sp)
      addi sp, sp, 8
      ret
    `);
    expect(reg(cpu, 3)).toBe(720);
    expect(reg(cpu, 2)).toBe(64 * 1024); // sp restored
  });

  it("does loads and stores of words and bytes", () => {
    const cpu = run(`
      la t0, buf
      li a0, -2
      sw a0, 0(t0)
      lw a1, 0(t0)
      lb a2, 0(t0)
      lbu a3, 0(t0)
      li t1, 0x7f
      sb t1, 4(t0)
      lbu t2, 4(t0)
      ecall
      .align
    buf: .word 0, 0
    `);
    expect(reg(cpu, 4)).toBe(-2);
    expect(reg(cpu, 5)).toBe(-2); // lb sign-extends
    expect(reg(cpu, 6)).toBe(0xfe); // lbu zero-extends
    expect(reg(cpu, 9)).toBe(0x7f);
  });

  it("handles ALU edge cases", () => {
    const cpu = run(`
      li a0, 0xdeadbeef
      li a1, -8
      srai a2, a1, 1
      srli a3, a1, 28
      li t0, 3
      sltu t1, t0, a1
      slt t2, a1, t0
      li t3, 0x10000
      mul t4, t3, t3
      zeroed: addi zero, zero, 5
      ecall
    `);
    expect(reg(cpu, 3) >>> 0).toBe(0xdeadbeef);
    expect(reg(cpu, 5)).toBe(-4);
    expect(reg(cpu, 6)).toBe(15);
    expect(reg(cpu, 8)).toBe(1);
    expect(reg(cpu, 9)).toBe(1);
    expect(reg(cpu, 11)).toBe(0); // 2^32 wraps
    expect(reg(cpu, 0)).toBe(0);
  });

  it("writes a string to the display", () => {
    const cpu = run(`
      li t0, 0x40000000     # DISPLAY_BASE
      la t1, msg
    next:
      lbu t2, 0(t1)
      beq t2, zero, end
      sb t2, 0(t0)
      addi t0, t0, 1
      addi t1, t1, 1
      j next
    end: ecall
    msg: .string "HELLO, CITY"
    `);
    expect(cpu.mem.displayText()).toBe("HELLO, CITY");
  });

  it("faults on bad access, illegal opcode and runaway loops", () => {
    expect(() => run("li a0, 0x20000000\nlw a1, 0(a0)")).toThrow(RefFault);
    expect(() => run("li a0, 1\nlw a1, 0(a0)")).toThrow(/misaligned/);
    expect(() => run(".word 0")).toThrow(/illegal/);
    expect(() => run("l: j l", 100)).toThrow(/exceeded/);
  });
});
