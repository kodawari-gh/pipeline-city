// amoadd / amoswap: every engine against the reference, the semantics by hand, the text round trip and two cores sharing a word.
import { describe, expect, it } from "vitest";
import { assemble } from "../../asm";
import { disassemble } from "../../isa";
import { REG_NAMES } from "../../isa/isa";
import { createEngine, type EngineConfig } from "../index";
import { Machine } from "@/core/sim";
import { RefCpu } from "../../ref";
import { genData, genProgram } from "../testgen";
import { CONFIGS, WIDE_CONFIGS, firstMemDiff, runEngine, runRef } from "../testutil";

const ALL = [...CONFIGS, ...WIDE_CONFIGS];

const HAND = `
    li s3, 4096
    li t0, 100
    sw t0, 0(s3)
    li t1, 23
    amoadd a0, t1, (s3)
    lw a1, 0(s3)
    li t2, -7
    amoswap a2, t2, (s3)
    lw a3, 0(s3)
    amoadd zero, t1, (s3)
    lw s0, 0(s3)
    addi t3, s3, 4
    li t4, 5
    amoadd t4, t4, (t3)
    amoswap t3, t3, (t3)
    lw s2, 4(s3)
    ecall`;

describe("atomics in the reference", () => {
  it("amoadd and amoswap return the old word and update memory", () => {
    const cpu = new RefCpu();
    cpu.load(assemble(HAND).program);
    cpu.run();
    const r = (n: string) => cpu.regs[(REG_NAMES as readonly string[]).indexOf(n)]!;
    expect([r("a0"), r("a1"), r("a2"), r("a3"), r("s0")]).toEqual([100, 123, 123, -7, 16]);
    expect(r("t4")).toBe(0); // the old value of the fresh word
    expect(r("s2")).toBe(4100); // swapped in the address itself
  });

  it("a misaligned or unmapped address faults", () => {
    for (const src of ["li a0, 4097\n amoadd a1, a1, (a0)\n ecall", "lui a0, 0x80000\n amoswap a1, a1, (a0)\n ecall"]) {
      const cpu = new RefCpu();
      cpu.load(assemble(src).program);
      expect(() => cpu.run()).toThrow();
    }
  });
});

describe("atomics text", () => {
  it("assemble and disassemble round trip", () => {
    for (const line of ["amoadd a0, a1, (a2)", "amoswap t0, zero, (s3)"]) {
      const w = assemble(line).program[0]!;
      expect(disassemble(w)).toBe(line);
    }
  });
});

describe.each(ALL)("atomics vs reference: $name", ({ make }) => {
  it("hand-written semantics", () => {
    const ref = runRef(HAND);
    const got = runEngine(make(), HAND);
    expect(got.regs).toEqual(ref.regs);
    expect(firstMemDiff(got.mem, ref.mem)).toBe(-1);
    expect(got.counters[1]).toBe(ref.cycles);
  });

  it("random programs with atomics", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const src = genProgram(seed, 40, true);
      const data = genData(seed);
      const ref = runRef(src, data);
      const got = runEngine(make(), src, data);
      expect(got.regs, `seed ${seed} regs`).toEqual(ref.regs);
      expect(firstMemDiff(got.mem, ref.mem), `seed ${seed} mem`).toBe(-1);
      expect(got.counters[1], `seed ${seed} retired`).toBe(ref.cycles);
    }
  });

  it("random programs with atomics under cache invalidations and predictor flips", () => {
    for (let seed = 100; seed < 130; seed++) {
      const src = genProgram(seed, 45, true);
      const data = genData(seed);
      const ref = runRef(src, data);
      const got = runEngine(make(), src, data, { seed: seed + 1, p: 0.15 });
      expect(got.regs, `seed ${seed} regs`).toEqual(ref.regs);
      expect(firstMemDiff(got.mem, ref.mem), `seed ${seed} mem`).toBe(-1);
    }
  });
});

// ---- Two cores on one word ----

const LOCK = 0x3000;
const COUNT = 0x3004;
const B_AT = 0x1000;
const ROUNDS = 25;

const counter = (body: string) => assemble(`
    li s3, ${LOCK}
    li s1, ${ROUNDS}
  again:
${body}
    addi s1, s1, -1
    bne s1, zero, again
    ecall`).program;

/** Each round takes the lock with amoswap, bumps the count with a plain load and store, and frees the lock with a store. */
const LOCKED = counter(`
    li t0, 1
  spin:
    amoswap t1, t0, (s3)
    bne t1, zero, spin
    lw t2, 4(s3)
    addi t2, t2, 1
    sw t2, 4(s3)
    sw zero, 0(s3)`);

/** Each round adds one with a single atomic. */
const ADDED = counter(`
    li t0, 1
    addi t3, s3, 4
    amoadd zero, t0, (t3)`);

const KINDS: [string, EngineConfig][] = [
  ["ref", { kind: "ref" }],
  ["unpipelined", { kind: "unpipelined" }],
  ["inorder", { kind: "inorder", forwarding: true, cacheLines: 4 }],
  ["inorder2", { kind: "inorder", width: 2, forwarding: true, cacheLines: 4 }],
  ["ooo", { kind: "ooo", width: 2, robSize: 16, schedSize: 8, fetchQueue: 8 }],
  ["ooo tiny", { kind: "ooo", robSize: 2, schedSize: 1, fetchQueue: 2 }],
];

function twoCores(cfg: EngineConfig, a: Uint32Array, b: Uint32Array): Machine {
  const m = new Machine({ cores: 2 });
  m.attach(createEngine(cfg), a);
  m.attachCore(1, createEngine(cfg), b, { entry: B_AT, stackTop: m.ram.length - 0x1000 });
  for (let i = 0; i < 200_000 && m.cores.some((c) => !c.engine!.halted); i++) m.stepCpu();
  expect(m.cores.every((c) => c.engine!.halted)).toBe(true);
  return m;
}

describe.each(KINDS)("two cores sharing a word on %s", (_n, cfg) => {
  it("amoadd from both cores loses no update", () => {
    const m = twoCores(cfg, ADDED, ADDED);
    expect(new DataView(m.ram.buffer).getUint32(COUNT, true)).toBe(2 * ROUNDS);
  });

  it("an amoswap spin lock keeps the count exact", () => {
    const m = twoCores(cfg, LOCKED, LOCKED);
    const dv = new DataView(m.ram.buffer);
    expect(dv.getUint32(COUNT, true)).toBe(2 * ROUNDS);
    expect(dv.getUint32(LOCK, true)).toBe(0);
  });
});
