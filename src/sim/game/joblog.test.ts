import { describe, expect, it } from "vitest";
import { Game } from "./game";
import { ECONOMY } from "./economy";
import { COUNTER_NAMES } from "../engines/view";
import { aggregate, byKind, JOB_LOG_CAP, phasesOf, stallShares, summarise, verdictOf, windowOf, type JobLogEntry, type JobWindow } from "./joblog";
import { netRig, rig } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const win = (o: Partial<JobWindow> = {}): JobWindow => ({ cycles: 1000, retired: 800, stallLoad: 0, stallData: 0, stallFlush: 0, stallStruct: 0, stallCache: 0, cacheHits: 0, cacheMisses: 0, tlbMisses: 0, pageFaults: 0, ...o });
const entry = (o: Partial<JobLogEntry> = {}): JobLogEntry => ({
  id: 1, type: "log", scale: 1, outcome: "done", arrival: 0, start: 10, finish: 40, end: 45, deadline: 200, payout: 20, late: false, attempts: 1, os: 1, win: win(), ...o,
});

describe("job log pieces", () => {
  it("splits the time into waiting, running and collecting", () => {
    expect(phasesOf(entry())).toEqual({ wait: 10, run: 30, collect: 5, total: 45 });
    expect(phasesOf(entry({ outcome: "expired", end: 90 }))).toEqual({ wait: 90, run: 0, collect: 0, total: 90 });
  });

  it("reads a window out of two counter readings, and gives none when the counters went back", () => {
    const n = COUNTER_NAMES.length, a = new Array<number>(n).fill(0), b = new Array<number>(n).fill(0);
    const at = (name: string) => COUNTER_NAMES.indexOf(name as (typeof COUNTER_NAMES)[number]);
    a[at("cycles")] = 100; b[at("cycles")] = 160; b[at("retired")] = 40; b[at("stallCache")] = 12;
    expect(windowOf(a, b)).toMatchObject({ cycles: 60, retired: 40, stallCache: 12 });
    expect(windowOf(b, a)).toBeUndefined();
    expect(windowOf(undefined, b)).toBeUndefined();
  });

  it("names what dominated", () => {
    expect(verdictOf(entry({ start: 80, finish: 100, end: 102 })).where).toBe("wait");
    expect(verdictOf(entry({ start: 2, finish: 6, end: 60 })).where).toBe("collect");
    const mem = verdictOf(entry({ win: win({ stallCache: 500 }) }));
    expect(mem.where).toBe("run");
    expect(mem.text).toContain("memory");
    expect(verdictOf(entry({ win: win({ stallFlush: 400 }) })).text).toContain("mispredicted");
    expect(verdictOf(entry({ win: win({ pageFaults: 300, tlbMisses: 900 }) })).text).toContain("page faults");
    expect(verdictOf(entry()).text).toContain("CPI");
    expect(verdictOf(entry({ win: undefined })).hint).toContain("restarted");
    expect(verdictOf(entry({ outcome: "expired" })).text).toContain("took it back");
  });

  it("sums up a list", () => {
    const s = summarise([entry(), entry({ id: 2, finish: 70, end: 75, late: true }), entry({ id: 3, outcome: "declined" })]);
    expect(s).toMatchObject({ done: 2, declined: 1, expired: 0, late: 1, wait: 20, run: 90, collect: 10 });
    expect(s.slowest!.id).toBe(2);
  });
});

describe("the job log in a game", () => {
  it("a finished job is logged with its timings and the machine's counters, and the log survives a save", () => {
    const g = rig("ssd1", { keys: [{ template: "cli.log" }] });
    expect(g.snapshot().jobLog).toEqual([]);
    g.powerButton();
    for (let t = 0; t < 400 && g.currentPhase() !== "idle-os"; t++) g.advanceBaseTick();
    g.plugKey(g.trayKeyIds()[0]!);
    for (let t = 0; t < 600 && g.completed < 1; t++) g.advanceBaseTick();
    const log = g.snapshot().jobLog!;
    expect(log).toHaveLength(1);
    const e = log[0]!;
    expect(e).toMatchObject({ outcome: "done", type: "log", os: 1 });
    expect(e.start).toBeLessThanOrEqual(e.finish);
    expect(e.finish).toBeLessThanOrEqual(e.end);
    expect(e.arrival).toBeLessThanOrEqual(e.start);
    expect(e.win?.cycles ?? 0).toBeGreaterThan(0);
    expect(e.win!.retired).toBeGreaterThan(0);
    const back = Game.fromSave(JSON.parse(JSON.stringify(g.toSave())));
    expect(back.snapshot().jobLog).toEqual(log);
  });

  it("a declined job is logged without a run", () => {
    const g = rig("ssd1", { keys: [{ template: "cli.log" }] });
    const id = g.trayKeyIds()[0]!;
    expect(g.declineKey(id).ok).toBe(true);
    expect(g.snapshot().jobLog).toMatchObject([{ id, outcome: "declined", payout: 0 }]);
    expect(g.snapshot().jobLog![0]!.win).toBeUndefined();
  });

  it("keeps only the last jobs", () => {
    const g = rig("ssd1", { keys: [{ template: "cli.log" }] });
    const save = g.toSave();
    save.jobLog = Array.from({ length: JOB_LOG_CAP + 30 }, (_, i) => entry({ id: i + 1 }));
    expect(Game.fromSave(JSON.parse(JSON.stringify(save))).snapshot().jobLog).toHaveLength(JOB_LOG_CAP);
  });
});

describe("a job that was in the spool when the game was saved", () => {
  it("keeps the tick the machine took it, so the log does not read its run as the whole game", () => {
    const g = netRig("ssd1", { keys: [] });
    (g as unknown as { enqueue(t: string, s: number, c: string | undefined, n: boolean): boolean }).enqueue("cli.log", 1, undefined, true);
    for (let t = 0; t < 3000 && g.toSave().net?.spool.length === 0; t++) g.advanceBaseTick();
    const saved = g.toSave();
    const spooled = saved.net!.spool;
    expect(spooled.length).toBeGreaterThan(0);
    for (const k of spooled) expect(k.pluggedAt ?? 0).toBeGreaterThan(0);
    const back = Game.fromSave(JSON.parse(JSON.stringify(saved)));
    expect(back.toSave().net!.spool.map((k) => k.pluggedAt)).toEqual(spooled.map((k) => k.pluggedAt));
  });
});

describe("the macro view", () => {
  it("averages the phases of the finished jobs, adds up their counters and reads the whole", () => {
    const a = aggregate([entry(), entry({ id: 2, start: 30, finish: 50, end: 50, win: win({ stallCache: 600 }) }), entry({ id: 3, outcome: "declined", win: undefined })]);
    expect(a.n).toBe(2);
    expect(a.wait).toBe(20);
    expect(a.win!.cycles).toBe(2000);
    expect(a.win!.stallCache).toBe(600);
    expect(aggregate([]).verdict.where).toBe("none");
  });

  it("ranks the kinds by the total time they took and counts the ones that were lost", () => {
    const k = byKind([entry({ type: "log" }), entry({ id: 2, type: "scan", start: 5, finish: 200, end: 205 }), entry({ id: 3, type: "calc", outcome: "expired", end: 90, win: undefined })]);
    expect(k.map((x) => x.type)).toEqual(["scan", "log", "calc"]);
    expect(k[2]).toMatchObject({ n: 0, lost: 1 });
  });

  it("orders the stalls largest first", () => {
    expect(stallShares(win({ stallFlush: 300, stallCache: 100 }))[0]).toMatchObject({ key: "flush", share: 0.3 });
  });
});

