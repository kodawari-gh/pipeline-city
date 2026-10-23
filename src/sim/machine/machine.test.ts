import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { DISPLAY_BASE, STATUS_BASE } from "../isa/memmap";
import { ClockScheduler, Machine, Prng, RefEngine } from "./index";

describe("Prng", () => {
  it("is deterministic per seed", () => {
    const a = new Prng(42);
    const b = new Prng(42);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
    expect(new Prng(1).nextU32()).not.toBe(new Prng(2).nextU32());
  });

  it("round-trips state through JSON", () => {
    const a = new Prng(7);
    for (let i = 0; i < 10; i++) a.next();
    const saved = JSON.parse(JSON.stringify(a.getState())) as number;
    const expected = Array.from({ length: 20 }, () => a.nextInt(1000));
    const b = new Prng(0);
    b.setState(saved);
    expect(Array.from({ length: 20 }, () => b.nextInt(1000))).toEqual(expected);
  });

  it("nextInt stays in range and next in [0,1)", () => {
    const p = new Prng(3);
    for (let i = 0; i < 1000; i++) {
      const n = p.nextInt(6);
      expect(n >= 0 && n < 6).toBe(true);
      const f = p.next();
      expect(f >= 0 && f < 1).toBe(true);
    }
  });
});

describe("ClockScheduler", () => {
  function counts(rates: [number, number][], baseTicks: number): number[] {
    const s = new ClockScheduler();
    const c = rates.map(() => 0);
    rates.forEach(([mul, div], i) => s.addDomain(`d${i}`, { mul, div }, () => c[i]!++));
    for (let i = 0; i < baseTicks; i++) s.advanceBaseTick();
    return c;
  }

  it("fires exact counts for divider and multiplier ratios", () => {
    // 1/1, 1/3, 4/1, 3/2, 1/7
    expect(counts([[1, 1], [1, 3], [4, 1], [3, 2], [1, 7]], 1000)).toEqual([1000, 333, 4000, 1500, 142]);
  });

  it("stays exact across a mid-run rate change", () => {
    const s = new ClockScheduler();
    let n = 0;
    s.addDomain("cpu", { mul: 1, div: 1 }, () => n++);
    for (let i = 0; i < 100; i++) s.advanceBaseTick();
    s.setRate("cpu", { mul: 3, div: 1 });
    for (let i = 0; i < 100; i++) s.advanceBaseTick();
    s.setRate("cpu", { mul: 1, div: 4 });
    for (let i = 0; i < 100; i++) s.advanceBaseTick();
    expect(n).toBe(100 + 300 + 25);
    expect(s.ticks("cpu")).toBe(n);
    expect(s.baseTicks).toBe(300);
  });

  it("is identical across runs, including interleaving", () => {
    const run = (): string[] => {
      const s = new ClockScheduler();
      const log: string[] = [];
      s.addDomain("a", { mul: 3, div: 2 }, (t) => log.push(`a${t}@${s.subTicks}`));
      s.addDomain("b", { mul: 1, div: 3 }, (t) => log.push(`b${t}@${s.subTicks}`));
      s.advance(5000);
      s.setRate("a", { mul: 5, div: 3 });
      s.advance(5000);
      return log;
    };
    expect(run()).toEqual(run());
  });

  it("delivers cross-domain transfers after N destination ticks", () => {
    const s = new ClockScheduler();
    const log: string[] = [];
    s.addDomain("src", { mul: 1, div: 1 }, () => {});
    s.addDomain("dst", { mul: 1, div: 2 }, (t) => log.push(`tick${t}`));
    s.advanceBaseTick(); // dst has not ticked yet
    s.schedule("dst", 2, () => log.push("arrive"));
    for (let i = 0; i < 10; i++) s.advanceBaseTick();
    // dst ticks at base 2,4,6,...; scheduled after base 1 -> arrives on its 2nd tick (base 4), before that tick's onTick
    expect(log.slice(0, 4)).toEqual(["tick1", "arrive", "tick2", "tick3"]);
  });
});

const HELLO = `
  la t0, msg
  li t1, 0x40000000
loop:
  lbu t2, 0(t0)
  beq t2, zero, done
  sb t2, 0(t1)
  addi t0, t0, 1
  addi t1, t1, 1
  j loop
done:
  ecall
  .align
msg: .string "Hello"
`;

describe("Machine", () => {
  it("routes to display, status and RAM; faults when unmapped", () => {
    const m = new Machine();
    m.bus.store8(DISPLAY_BASE, 65);
    m.bus.store32(DISPLAY_BASE + 4, 0x44434241);
    expect(m.display.text()).toBe("A   ABCD");
    expect(m.bus.load32(DISPLAY_BASE + 4)).toBe(0x44434241);
    m.bus.store32(STATUS_BASE, 0xdeadbeef);
    expect(m.bus.load32(STATUS_BASE)).toBe(0xdeadbeef);
    m.bus.store32(0x100, 0x01020304);
    expect(m.ram[0x100]).toBe(4);
    expect(m.bus.load8(0x103)).toBe(1);
    expect(() => m.bus.load8(0x2000_0000)).toThrow(RangeError);
    expect(() => m.bus.load32(0x102)).toThrow(RangeError);
  });

  it("display write latency lands writes in its own clock domain", () => {
    const m = new Machine({ displayLatency: 3, displayRate: { mul: 1, div: 1 } });
    m.bus.store8(DISPLAY_BASE, 72);
    m.bus.store8(DISPLAY_BASE + 1, 105);
    expect(m.display.pending).toBe(2);
    m.advanceBaseTick();
    m.advanceBaseTick();
    expect(m.display.text()).toBe("");
    m.advanceBaseTick();
    expect(m.display.text()).toBe("H");
    for (let i = 0; i < 3; i++) m.advanceBaseTick();
    expect(m.display.text()).toBe("Hi");
  });

  it("runs a program end to end on the CPU clock", () => {
    const prog = assemble(HELLO).program;
    const m = new Machine();
    const e = new RefEngine();
    m.attach(e, prog);
    let ticks = 0;
    while (!e.halted && ticks < 1000) {
      m.advanceBaseTick();
      ticks++;
    }
    expect(m.display.text()).toBe("Hello");
    // la (2) + li (1) + 5 chars * 6 + final lbu, beq (2) + ecall (1)
    expect(ticks).toBe(2 + 1 + 5 * 6 + 2 + 1);
    expect(e.cycle).toBe(ticks);
  });

  it("overclocking the CPU shortens wall time and is deterministic", () => {
    const prog = assemble(HELLO).program;
    const run = (rate: { mul: number; div: number }): number => {
      const m = new Machine({ cpuRate: rate });
      m.attach(new RefEngine(), prog);
      while (!m.engine!.halted) m.advanceBaseTick();
      return m.clock.baseTicks;
    };
    expect(run({ mul: 1, div: 1 })).toBe(36);
    expect(run({ mul: 4, div: 1 })).toBe(9);
    expect(run({ mul: 1, div: 2 })).toBe(72);
    expect(run({ mul: 1, div: 2 })).toBe(72);
  });

  it("slow display delays text without stalling the CPU", () => {
    const m = new Machine({ displayLatency: 10 });
    const e = new RefEngine();
    m.attach(e, assemble(HELLO).program);
    while (!e.halted) m.advanceBaseTick();
    expect(m.display.text()).not.toBe("Hello");
    for (let i = 0; i < 60; i++) m.advanceBaseTick();
    expect(m.display.text()).toBe("Hello");
  });
});
