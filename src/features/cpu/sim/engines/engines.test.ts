import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { RefCpu } from "../ref";
import { Machine } from "@/core/sim";
import { createEngine, InOrderEngine, UnpipelinedEngine, type EngineConfig } from "./index";
import { genData, genProgram } from "./testgen";
import { CONFIGS, firstMemDiff, runEngine, runRef } from "./testutil";

const HAND: Record<string, string> = {
  sum: `
    li a0, 0
    li a1, 1
    li a2, 11
  loop:
    add a0, a0, a1
    addi a1, a1, 1
    blt a1, a2, loop
    ecall`,
  callRet: `
    li a0, 5
    call fact
    ecall
  fact:
    addi sp, sp, -8
    sw ra, 4(sp)
    sw a0, 0(sp)
    li t0, 2
    blt a0, t0, base
    addi a0, a0, -1
    call fact
    lw t1, 0(sp)
    mul a0, a0, t1
    j out
  base:
    li a0, 1
  out:
    lw ra, 4(sp)
    addi sp, sp, 8
    ret`,
  memcpy: `
    li s3, 4096
    li t0, 0
    li t1, 40
  fill:
    add t2, t0, t0
    addi t2, t2, 3
    add t3, s3, t0
    sb t2, 0(t3)
    addi t0, t0, 1
    bne t0, t1, fill
    li t0, 0
    li t4, 100
  copy:
    add t3, s3, t0
    lbu t2, 0(t3)
    add t3, t3, t4
    sb t2, 0(t3)
    lw a0, 0(s3)
    add a1, a1, a0
    addi t0, t0, 1
    bne t0, t1, copy
    ecall`,
  loadUse: `
    li s3, 4096
    sw s3, 0(s3)
    lw t0, 0(s3)
    add t1, t0, t0
    lw t2, 0(t0)
    sw t2, 8(s3)
    lw t3, 8(s3)
    mul t4, t3, t3
    ecall`,
  jalrAndLui: `
    lui a0, 3
    auipc a1, 1
    la a2, target
    jalr ra, a2, 0
    li a3, 99
  target:
    sub a3, a0, a1
    slt t0, a3, zero
    sltu t1, a3, zero
    sra t2, a3, t0
    ecall`,
  display: `
    lui a0, 0x80000
    li a1, 72
    sb a1, 0(a0)
    li a1, 105
    sb a1, 1(a0)
    ecall`,
};

function expectSame(name: string, src: string, make: () => ReturnType<(typeof CONFIGS)[number]["make"]>, seed: number, chaos: boolean): void {
  const data = genData(seed);
  const ref = runRef(src, data);
  const got = runEngine(make(), src, data, chaos ? { seed: seed + 1, p: 0.15 } : undefined);
  expect(got.regs, `${name} regs`).toEqual(ref.regs);
  expect(firstMemDiff(got.mem, ref.mem), `${name} first differing mem byte`).toBe(-1);
  expect(got.counters[1], `${name} retired`).toBe(ref.cycles);
}

describe.each(CONFIGS)("correctness vs reference: $name", ({ make }) => {
  for (const [name, src] of Object.entries(HAND)) {
    it(`hand-written: ${name}`, () => {
      if (name === "display") {
        // 0x80000 << 11 = 0x4000_0000 (display base)
        const cpu = new RefCpu();
        cpu.load(assemble(src).program);
        cpu.run();
        const e = make();
        const out = runEngine(e, src);
        expect(out.regs).toEqual(Array.from(cpu.regs));
        expect(out.machine.display.text()).toBe(cpu.mem.displayText());
        expect(out.machine.display.text()).toBe("Hi");
      } else {
        expectSame(name, src, make, 7, false);
        expectSame(name, src, make, 8, true);
      }
    });
  }

  it("random programs", () => {
    for (let seed = 1; seed <= 40; seed++) expectSame(`seed ${seed}`, genProgram(seed), make, seed, false);
  });

  it("random programs with cache invalidations and predictor flips", () => {
    for (let seed = 100; seed < 140; seed++) expectSame(`seed ${seed}`, genProgram(seed, 45), make, seed, true);
  });

  it("zero-penalty and tiny caches stay correct", () => {
    for (let seed = 200; seed < 210; seed++) {
      const src = genProgram(seed);
      const data = genData(seed);
      const ref = runRef(src, data);
      for (const extra of [{ missPenalty: 0 }, { cacheLines: 1, cacheLineBytes: 4, missPenalty: 7 }]) {
        const got = runEngine(make(extra), src, data, { seed, p: 0.1 });
        expect(got.regs).toEqual(ref.regs);
        expect(firstMemDiff(got.mem, ref.mem)).toBe(-1);
      }
    }
  });
});

describe("determinism", () => {
  it("same seed gives identical results, cycles and counters; different seeds differ", () => {
    for (const { name, make } of CONFIGS) {
      const run = (seed: number) => {
        const o = runEngine(make(), genProgram(seed), genData(seed), { seed, p: 0.1 });
        return JSON.stringify([o.regs, Array.from(o.mem), o.cycles, o.counters]);
      };
      expect(run(5), name).toBe(run(5));
      expect(run(5), name).not.toBe(run(6));
    }
  });

  it("generator is deterministic", () => {
    expect(genProgram(3)).toBe(genProgram(3));
    expect(genProgram(3)).not.toBe(genProgram(4));
  });
});

describe("engine selector and machine integration", () => {
  const prog = assemble(HAND.sum!).program;
  const configs: EngineConfig[] = [
    { kind: "ref" },
    { kind: "unpipelined" },
    { kind: "inorder" },
    { kind: "inorder", forwarding: false, sharedPort: true, missPenalty: 2 },
  ];
  it.each(configs)("attaches %j and runs under the clock scheduler", (cfg) => {
    const m = new Machine();
    m.attach(createEngine(cfg), prog);
    for (let i = 0; i < 400 && !m.engine!.halted; i++) m.advanceBaseTick();
    expect(m.engine!.halted).toBe(true);
    expect(m.regs[3]).toBe(55);
  });

  it("factory returns the right classes", () => {
    expect(createEngine({ kind: "unpipelined" })).toBeInstanceOf(UnpipelinedEngine);
    expect(createEngine({ kind: "inorder" })).toBeInstanceOf(InOrderEngine);
  });

  it("reset gives a cold, repeatable run", () => {
    const e = new InOrderEngine();
    const m = new Machine();
    m.attach(e, prog);
    while (!e.halted) e.step();
    const first = [e.cycle, Array.from(e.view.counters)];
    m.attach(e, prog);
    while (!e.halted) e.step();
    expect([e.cycle, Array.from(e.view.counters)]).toEqual(first);
  });
});
