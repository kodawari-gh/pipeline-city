// The DRAM behind the caches (docs/RAM.md): rows, banks, the open row. Timing only: every program must still match the reference, and an
// engine without a `dram` setting must not move.
import { describe, expect, it } from "vitest";
import { Dram, RowOutcome, type DramSettings } from "./dram";
import { createEngine, Counter, type EngineConfig, type PipelineEngine } from "./index";
import { Ev } from "./common";
import { genData, genProgram } from "./testgen";
import { firstMemDiff, runEngine, runRef } from "./testutil";

const S: DramSettings = { channels: 1, banks: 4, bankGroups: 2, rowBytes: 256, tCL: 3, tRCD: 5, tRP: 4, burst: 2, ccdS: 2, ccdL: 4, refreshEvery: 0, tRFC: 10, policy: "open" };

describe("the DRAM model", () => {
  it("interleaves pages over channels, then banks: consecutive pages are in different places", () => {
    const d = new Dram({ ...S, channels: 2 });
    expect(d.locate(0)).toEqual({ channel: 0, bank: 0, row: 0 });
    expect(d.locate(255)).toEqual({ channel: 0, bank: 0, row: 0 });
    expect(d.locate(256)).toEqual({ channel: 1, bank: 4, row: 0 });
    expect(d.locate(512)).toEqual({ channel: 0, bank: 1, row: 0 });
    expect(d.locate(2 * 4 * 256)).toEqual({ channel: 0, bank: 0, row: 1 });
    // pageOf inverts it
    for (const page of [0, 1, 2, 7, 8, 9, 31, 64]) { const l = d.locate(page * 256); expect(d.pageOf(l.bank, l.row)).toBe(page); }
  });

  it("a closed bank costs tRCD + tCL, the open row tCL, another row tRP + tRCD + tCL, plus the burst", () => {
    const d = new Dram(S);
    expect(d.access(0, 0)).toMatchObject({ cycles: 5 + 3 + 2, outcome: RowOutcome.Empty, bank: 0, row: 0, prev: -1 });
    expect(d.access(64, 100)).toMatchObject({ cycles: 3 + 2, outcome: RowOutcome.Hit });
    expect(d.access(4 * 256, 200)).toMatchObject({ cycles: 4 + 5 + 3 + 2, outcome: RowOutcome.Conflict, row: 1, prev: 0 });
    expect(d.access(256, 300)).toMatchObject({ cycles: 5 + 3 + 2, outcome: RowOutcome.Empty, bank: 1 });
    expect(d.openRows()).toEqual([1, 0, -1, -1]);
  });

  it("back to back misses queue on the channel's bus; another bank group is cheaper than the same one", () => {
    const sameGroup = new Dram(S);
    sameGroup.access(0, 0); // bank 0, group 0
    const same = sameGroup.access(2 * 256, 0); // bank 2, group 0 (same group), same cycle
    const otherGroup = new Dram(S);
    otherGroup.access(0, 0);
    const other = otherGroup.access(256, 0); // bank 1, group 1
    expect(same.cycles).toBeGreaterThan(other.cycles);
    expect(other.cycles).toBeGreaterThan(5 + 3 + 2 - 1); // it also waited for the first burst
  });

  it("two channels serve two misses at once; one channel makes the second wait", () => {
    const one = new Dram(S), two = new Dram({ ...S, channels: 2 });
    one.access(0, 0); two.access(0, 0);
    const second1 = one.access(256, 0).cycles, second2 = two.access(256, 0).cycles; // page 1: bank 1 on one channel, channel 1 on two
    expect(second2).toBeLessThan(second1);
    expect(second2).toBe(5 + 3 + 2); // no wait at all
  });

  it("page policies: closed never hits or conflicts, adaptive closes a row after a conflict", () => {
    const closed = new Dram({ ...S, policy: "closed" });
    expect(closed.access(0, 0).outcome).toBe(RowOutcome.Empty);
    expect(closed.access(0, 50).outcome).toBe(RowOutcome.Empty);
    expect(closed.access(4 * 256, 100).outcome).toBe(RowOutcome.Empty);
    expect(closed.openRows().every((r) => r === -1)).toBe(true);
    const ad = new Dram({ ...S, policy: "adaptive" });
    ad.access(0, 0);
    expect(ad.access(0, 50).outcome).toBe(RowOutcome.Hit); // streaming keeps the row
    expect(ad.access(4 * 256, 100).outcome).toBe(RowOutcome.Conflict);
    expect(ad.openRows()[0]).toBe(-1); // closed after the conflict
    expect(ad.access(8 * 256, 150).outcome).toBe(RowOutcome.Empty);
  });

  it("a refresh closes one bank's row in turn and keeps the bank busy for tRFC", () => {
    const d = new Dram({ ...S, refreshEvery: 100 });
    for (let b = 0; b < 4; b++) d.access(b * 256, 0);
    const log: [number, number, number][] = [];
    const seen = (c: number, bank: number, row: number) => log.push([c, bank, row]);
    const r = d.access(0, 101, seen); // bank 0 was refreshed at 100: its row is gone and the bank is busy until 110
    expect(log[0]).toEqual([100, 0, -1]);
    expect(r.outcome).toBe(RowOutcome.Empty);
    expect(r.cycles).toBeGreaterThanOrEqual(110 - 101 + 5 + 3);
    expect(d.openRows()[1]).toBe(0);
  });

  it("rejects odd geometry", () => {
    expect(() => new Dram({ ...S, banks: 3 })).toThrow(RangeError);
    expect(() => new Dram({ ...S, channels: 3 })).toThrow(RangeError);
    expect(() => new Dram({ ...S, bankGroups: 8 })).toThrow(RangeError);
    expect(() => new Dram({ ...S, tCL: -1 })).toThrow(RangeError);
  });
});

const DRAM: DramSettings = { channels: 2, banks: 4, bankGroups: 2, rowBytes: 64, tCL: 2, tRCD: 3, tRP: 3, burst: 1, ccdS: 1, ccdL: 2, refreshEvery: 200, tRFC: 5, policy: "adaptive" };
const KINDS: { name: string; cfg: EngineConfig }[] = [
  { name: "inorder", cfg: { kind: "inorder", forwarding: true, cacheLines: 8, dram: DRAM } },
  { name: "inorder2 + L2", cfg: { kind: "inorder2", forwarding: true, cacheLines: 16, ways: 2, icacheLines: 8, l2Lines: 32, dram: DRAM } },
  { name: "ooo", cfg: { kind: "ooo", width: 2, robSize: 16, schedSize: 8, fetchQueue: 8, cacheLines: 16, dram: DRAM } },
];
const make = (cfg: EngineConfig, extra: Record<string, unknown> = {}) => createEngine({ ...cfg, ...extra } as EngineConfig) as PipelineEngine;

describe.each(KINDS)("with a DRAM, programs stay correct: $name", ({ cfg }) => {
  it("random programs match the reference", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const src = genProgram(seed, 40), data = genData(seed), ref = runRef(src, data);
      const got = runEngine(make(cfg), src, data, { seed: seed + 1, p: 0.1 });
      expect(got.regs, `seed ${seed}`).toEqual(ref.regs);
      expect(firstMemDiff(got.mem, ref.mem), `seed ${seed}`).toBe(-1);
    }
  });

  it("every miss that reaches RAM is exactly one row hit, one activate or one conflict, and the open rows follow the log", () => {
    const e = make(cfg);
    runEngine(e, genProgram(7, 60), genData(7));
    const c = e.view.counters;
    const reach = c[Counter.RowHits]! + c[Counter.RowEmpty]! + c[Counter.RowConflicts]!;
    expect(reach).toBeGreaterThan(0);
    const l2m = c[Counter.L2Misses]!;
    expect(reach).toBe(cfg.kind === "inorder" ? c[Counter.CacheMisses]! + c[Counter.ICacheMisses]! : (l2m || reach));
    const st = e.storedState();
    expect(st.dram).toMatchObject({ channels: 2, banks: 4, rowBytes: 64 });
    expect(st.dram!.open).toHaveLength(8);
    // the last Row event of each bank says which row is open
    const rows = new Map<number, number>();
    const ev = st.events.since(0);
    for (let k = 0; k < ev.length; k += 6) if (ev[k + 1] === Ev.Row) rows.set(ev[k + 2]!, ev[k + 3]!);
    for (const [bank, row] of rows) expect(st.dram!.open[bank]).toBe(row);
  });
});

describe("what a row buffer does to timing", () => {
  const SCAN = `
    li s0, 4096
    li t0, 0
    li t1, 64
  loop:
    lw a0, 0(s0)
    add a1, a1, a0
    addi s0, s0, 16
    addi t0, t0, 1
    bne t0, t1, loop
    ecall`;
  const RANDOM = `
    li s0, 4096
    li s1, 0
    li t0, 0
    li t1, 64
  loop:
    andi s1, s1, 1023
    slli a2, s1, 5
    add a2, a2, s0
    lw a0, 0(a2)
    add a1, a1, a0
    addi s1, s1, 37
    addi t0, t0, 1
    bne t0, t1, loop
    ecall`;
  const cycles = (src: string, extra: Record<string, unknown>) => { const e = make({ kind: "inorder", forwarding: true, cacheLines: 8, missPenalty: 7 }, extra); runEngine(e, src); return { n: e.cycle, c: e.view.counters }; };

  it("a sequential scan stays on open rows; scattered accesses keep opening new ones", () => {
    const seq = cycles(SCAN, { dram: DRAM }), rnd = cycles(RANDOM, { dram: DRAM });
    const hitRate = (x: typeof seq) => x.c[Counter.RowHits]! / Math.max(1, x.c[Counter.RowHits]! + x.c[Counter.RowEmpty]! + x.c[Counter.RowConflicts]!);
    expect(hitRate(seq)).toBeGreaterThan(0.6);
    expect(hitRate(rnd)).toBeLessThan(hitRate(seq));
    expect(rnd.c[Counter.RowConflicts]!).toBeGreaterThan(seq.c[Counter.RowConflicts]!);
  });

  it("without a dram setting the flat penalty applies and nothing is counted", () => {
    const flat = cycles(SCAN, {});
    expect(flat.c[Counter.RowHits]! + flat.c[Counter.RowEmpty]! + flat.c[Counter.RowConflicts]!).toBe(0);
    const again = cycles(SCAN, {});
    expect(again.n).toBe(flat.n);
  });

  it("is deterministic", () => {
    expect(cycles(RANDOM, { dram: DRAM }).n).toBe(cycles(RANDOM, { dram: DRAM }).n);
  });
});
