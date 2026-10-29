// Shared L2 port and the invalidate-on-write rule (docs/MULTICORE.md sections 2 and 3).

import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { Machine } from "../machine";
import { DataCache, EventLog, Ev } from "./common";
import { createEngine, type EngineConfig } from "./index";
import { MemSystem } from "./memsys";
import { COUNTER_COUNT, Counter } from "./view";

const MEM = { lineBytes: 16, missPenalty: 4, l2Lines: 32, l2Penalty: 2 } as const;
const CFG: EngineConfig = { kind: "inorder", forwarding: true, cacheLines: 8, l2Lines: 32 };
const B_AT = 0x1000;
const word = (m: Machine, a: number) => new DataView(m.ram.buffer).getUint32(a, true);

/** Load a word, add one, store it back, `n` times: the address is the core's own counter. */
const bump = (addr: number, n: number) => assemble(`
    li s3, ${addr}
    li s2, ${n}
    li s1, 0
  again:
    lw t0, 0(s3)
    addi t0, t0, 1
    sw t0, 0(s3)
    addi s1, s1, 1
    bne s1, s2, again
    ecall`).program;

/** Read `n` lines starting at `base`, one word per line. */
const scan = (base: number, lines: number) => assemble(`
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
    ecall`).program;

function twoCores(a: Uint32Array, b: Uint32Array, cfg = CFG): { m: Machine; mem: MemSystem; cycles: [number, number] } {
  const mem = new MemSystem(MEM);
  const m = new Machine({ cores: 2, mem });
  m.attach(createEngine(cfg), a);
  m.attachCore(1, createEngine(cfg), b, { entry: B_AT, stackTop: m.ram.length - 0x1000 });
  for (let i = 0; i < 200_000 && m.cores.some((c) => !c.engine!.halted); i++) m.stepCpu();
  expect(m.cores.every((c) => c.engine!.halted)).toBe(true);
  return { m, mem, cycles: [m.cores[0]!.engine!.cycle, m.cores[1]!.engine!.cycle] };
}

const counters = (m: Machine, k: number) => (m.cores[k]!.engine as unknown as { view: { counters: Float64Array } }).view.counters;

/** The same program on a one-core machine with the reference interpreter: the values a correct machine must end with. */
function reference(p: Uint32Array, addr: number): number {
  const m = new Machine();
  const e = createEngine({ kind: "ref" });
  m.attach(e, p);
  while (!e.halted) m.stepCpu();
  return word(m, addr);
}

describe("false sharing", () => {
  const N = 20;
  it("two cores bumping different words of one line ping-pong it", () => {
    const { m, cycles } = twoCores(bump(0x3000, N), bump(0x3004, N));
    expect(word(m, 0x3000)).toBe(reference(bump(0x3000, N), 0x3000));
    expect(word(m, 0x3004)).toBe(N);
    for (const k of [0, 1]) {
      const c = counters(m, k);
      expect(c[Counter.CoherenceInvals]).toBeGreaterThan(5);
      expect(c[Counter.CoherenceMisses]).toBeGreaterThan(5);
      expect(c[Counter.CoherenceMisses]).toBeLessThanOrEqual(c[Counter.CacheMisses]!);
    }
    const apart = twoCores(bump(0x3000, N), bump(0x3010, N)); // a line each
    expect(word(apart.m, 0x3010)).toBe(N);
    for (const k of [0, 1]) {
      expect(counters(apart.m, k)[Counter.CoherenceInvals]).toBe(0);
      expect(counters(apart.m, k)[Counter.CoherenceMisses]).toBe(0);
      expect(counters(apart.m, k)[Counter.CacheMisses]).toBe(1); // the one cold miss
    }
    expect(Math.max(...cycles)).toBeGreaterThan(Math.max(...apart.cycles));
  });

  it("a core alone invalidates nothing, and a machine with one core takes the engine's own memory system", () => {
    const m = new Machine();
    const e = createEngine(CFG);
    m.attach(e, bump(0x3000, N));
    while (!e.halted) m.stepCpu();
    const c = (e as unknown as { view: { counters: Float64Array } }).view.counters;
    expect(c[Counter.CoherenceInvals]).toBe(0);
    expect(c[Counter.L2PortBusy]).toBe(0);
    expect(c[Counter.StallL2Port]).toBe(0);
  });

  it("a store from one core drops the line from the other core's L1 D and L1 I, not its own, and keeps the L2", () => {
    const mem = new MemSystem(MEM);
    const port = () => ({ cache: new DataCache(8, 16, 4), icache: new DataCache(8, 16, 4), counters: new Float64Array(COUNTER_COUNT), events: new EventLog() });
    const a = port(), b = port();
    mem.shared = true;
    mem.join(a); mem.join(b);
    for (const p of [a, b]) { p.cache.fill(0x3000); p.icache.fill(0x3000); p.cache.fill(0x3040); }
    mem.missCost(0x3000, 0, a.counters, a.events); // the line is in the L2
    mem.storeLanded(a, 0x3004, 5);
    expect(a.cache.hit(0x3000) && a.icache.hit(0x3000)).toBe(true);
    expect(b.cache.hit(0x3000)).toBe(false);
    expect(b.icache.hit(0x3000)).toBe(false);
    expect(b.cache.hit(0x3040)).toBe(true); // another line is untouched
    expect(b.counters[Counter.CoherenceInvals]).toBe(2);
    expect(a.counters[Counter.CoherenceInvals]).toBe(0);
    expect(mem.l2!.hit(0x3000)).toBe(true);
    expect(b.cache.takeDropped(0x3000)).toBe(true); // the next miss there is a coherence miss, once
    expect(b.cache.takeDropped(0x3000)).toBe(false);
    expect(b.events.since(0)).toContain(Ev.Inval);
  });
});

describe("shared L2 port", () => {
  it("cores missing in the same cycle queue for the L2, one lookup per cycle", () => {
    const a = scan(0x4000, 16), b = scan(0x5000, 16);
    const { m, mem, cycles } = twoCores(a, b);
    const total = counters(m, 0)[Counter.StallL2Port]! + counters(m, 1)[Counter.StallL2Port]!;
    expect(total).toBeGreaterThan(0);
    expect(counters(m, 0)[Counter.L2PortBusy]! + counters(m, 1)[Counter.L2PortBusy]!).toBe(mem.portBusy);
    expect(counters(m, 0)[Counter.L2Misses]! + counters(m, 1)[Counter.L2Misses]!).toBe(32);
    // alone, the same scan never waits and is no slower
    const solo = new Machine({ cores: 2, mem: new MemSystem(MEM) });
    solo.attach(createEngine(CFG), a);
    const e = solo.cores[0]!.engine!;
    while (!e.halted) solo.stepCpu();
    expect(counters(solo, 0)[Counter.StallL2Port]).toBe(0);
    expect(e.cycle).toBeLessThanOrEqual(cycles[0]);
  });

  it("a collision costs the loser one cycle, once: it is then a cycle behind and they no longer collide", () => {
    const { m } = twoCores(scan(0x4000, 16), scan(0x5000, 16));
    const s = [counters(m, 0)[Counter.StallL2Port]!, counters(m, 1)[Counter.StallL2Port]!];
    expect(s[0]! + s[1]!).toBe(1);
  });

  it("a second lookup in the same cycle waits one cycle; one a cycle later does not", () => {
    const mem = new MemSystem(MEM);
    mem.shared = true;
    const c = new Float64Array(COUNTER_COUNT), ev = new EventLog();
    mem.missCost(0x100, 10, c, ev);
    expect(mem.missCost(0x200, 10, c, ev)).toBe(4 + 1); // the missPenalty (no DRAM) plus a cycle of waiting
    mem.reset(); mem.shared = true;
    mem.missCost(0x100, 10, c, ev);
    expect(mem.missCost(0x300, 11, c, ev)).toBe(4); // a lookup a cycle later does not wait
  });

  it("is deterministic", () => {
    const run = () => twoCores(scan(0x4000, 16), bump(0x3000, 10)).cycles;
    expect(run()).toEqual(run());
  });

  it("values equal the reference whatever the timing", () => {
    for (const cfg of [CFG, { kind: "ooo", width: 2, robSize: 16, schedSize: 8, fetchQueue: 8, cacheLines: 4, l2Lines: 32 } as EngineConfig, { kind: "unpipelined", cacheLines: 4, l2Lines: 32 } as EngineConfig]) {
      const { m } = twoCores(bump(0x3000, 15), bump(0x3004, 9), cfg);
      expect(word(m, 0x3000), cfg.kind).toBe(15);
      expect(word(m, 0x3004), cfg.kind).toBe(9);
    }
  });
});
