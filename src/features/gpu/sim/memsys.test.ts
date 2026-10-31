import { describe, expect, it } from "vitest";
import { arbitrate, coalesce, GpuMemSystem } from "./memsys";

const seq = (n: number, strideWords = 1, base = 0) => Array.from({ length: n }, (_, l) => base + l * strideWords * 4);

describe("coalescer and arbiter", () => {
  it("lanes on consecutive words of one line are one access", () => {
    expect(coalesce(seq(8), 8)).toEqual([0]);
    expect(coalesce(seq(8), 4)).toEqual([0, 1]);
  });
  it("a broadcast (one address) is one line", () => {
    expect(coalesce(Array(8).fill(64), 8)).toEqual([2]);
  });
  it("a stride of a line scatters one line per lane", () => {
    expect(coalesce(seq(8, 8), 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it("lines go to bank line % banks", () => {
    expect(arbitrate([0, 1, 2, 3], 2)).toEqual([2, 2]);
    expect(arbitrate([0, 2, 4, 6], 2)).toEqual([4, 0]);
    expect(arbitrate([], 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("no caches", () => {
  const mk = (o = {}) => new GpuMemSystem({ banks: 2, lineWords: 8, globalLatency: 6, ...o });
  it("a coalesced load is one round and returns after the global latency", () => {
    const a = mk().load(0, seq(8), 0);
    expect(a).toMatchObject({ rounds: 1, lines: [0], misses: 1 });
    expect(a.latency).toBe(7);
  });
  it("a scattered load takes the busiest bank's lines in rounds, the last line leaves last", () => {
    const a = mk().load(0, seq(8, 8), 0); // 8 lines over 2 banks: 4 rounds
    expect(a.rounds).toBe(4);
    expect(a.perBank).toEqual([4, 4]);
    expect(a.latency).toBe(3 + 6 + 1);
  });
  it("lines all in one bank are the worst case", () => {
    const a = mk().load(0, seq(4, 16), 0); // lines 0, 2, 4, 6: all bank 0
    expect(a.perBank).toEqual([4, 0]);
    expect(a.rounds).toBe(4);
  });
  it("a store takes the same rounds and leaves no latency, an empty access still costs one round", () => {
    const m = mk();
    expect(m.store(seq(8, 8))).toMatchObject({ rounds: 4, latency: 0 });
    expect(m.store([])).toMatchObject({ rounds: 1, lines: [] });
    expect(m.load(0, [], 0).latency).toBe(0);
  });
  it("rejects a bad shape", () => {
    expect(() => mk({ lineWords: 3 })).toThrow();
    expect(() => mk({ banks: 0 })).toThrow();
  });
});

describe("L1 and L2", () => {
  const mk = () => new GpuMemSystem({ banks: 2, lineWords: 8, globalLatency: 20, sms: 2, l1Lines: 4, l1Hit: 2, l2Lines: 16, l2Hit: 5 });
  it("a miss goes to memory, the same line again is an L1 hit", () => {
    const m = mk();
    const a = m.load(0, seq(8), 0);
    expect(a).toMatchObject({ misses: 1, l1Hits: 0 });
    expect(a.latency).toBe(21);
    const b = m.load(0, seq(8), 30);
    expect(b).toMatchObject({ misses: 0, l1Hits: 1 });
    expect(b.latency).toBe(3);
  });
  it("the other SM misses its own L1 but hits the L2 the first SM filled", () => {
    const m = mk();
    m.load(0, seq(8), 0);
    const b = m.load(1, seq(8), 40);
    expect(b).toMatchObject({ l1Hits: 0, l2Hits: 1, misses: 0 });
    expect(b.latency).toBe(5 + 1);
    expect(m.l2Hits).toBe(1);
  });
  it("misses in the same cycle serialise on the L2 port", () => {
    const m = mk();
    m.load(0, [...seq(8), ...seq(8, 1, 8)], 0); // two lines into the L2
    // SM 1 asks for both at cycle 100: lines 0 and 1 are in banks 0 and 1, so both leave in round 0 and the port serves one per cycle
    const a = m.load(1, [...seq(8), ...seq(8, 1, 8)], 100);
    expect(a.l2Hits).toBe(2);
    expect(a.latency).toBe(1 + 5 + 1);
  });
  it("a store does not fill a line", () => {
    const m = mk();
    m.store(seq(8));
    expect(m.load(0, seq(8), 0)).toMatchObject({ l1Hits: 0, misses: 1 });
  });
  it("invalidate makes the caches cold again", () => {
    const m = mk();
    m.load(0, seq(8), 0);
    m.invalidate();
    expect(m.load(0, seq(8), 0).misses).toBe(1);
  });
});
