import { describe, expect, it } from "vitest";
import { Game } from "./game";
import { ECONOMY } from "./economy";
import { COUNTER_NAMES } from "../engines/view";
import { aggregate, byKind, JOB_LOG_CAP, livePhases, liveVerdict, phasesOf, stallShares, summarise, verdictOf, windowOf, type JobLogEntry, type JobWindow } from "./joblog";
import { Operator } from "./operator";
import { netRig, rig } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const win = (o: Partial<JobWindow> = {}): JobWindow => ({ cycles: 1000, retired: 800, stallLoad: 0, stallData: 0, stallFlush: 0, stallStruct: 0, stallCache: 0, cacheHits: 0, cacheMisses: 0, tlbMisses: 0, pageFaults: 0, ...o });
const entry = (o: Partial<JobLogEntry> = {}): JobLogEntry => ({
  id: 1, type: "log", scale: 1, outcome: "done", arrival: 0, start: 10, finish: 40, end: 45, deadline: 200, payout: 20, late: false, attempts: 1, os: 1, win: win(), ...o,
});

describe("job log pieces", () => {
  it("splits the time into waiting, running and collecting", () => {
    expect(phasesOf(entry())).toEqual({ wait: 10, queue: 0, run: 30, collect: 5, total: 45 });
    expect(phasesOf(entry({ outcome: "expired", end: 90 }))).toEqual({ wait: 90, queue: 0, run: 0, collect: 0, total: 90 });
  });

  it("cuts the machine's time into queue and run when the job's first run is known", () => {
    expect(phasesOf(entry({ ran: 25 }))).toEqual({ wait: 10, queue: 15, run: 15, collect: 5, total: 45 });
    expect(phasesOf(entry({ ran: 10 }))).toEqual(phasesOf(entry())); // ran at once: the same as no queue
    expect(phasesOf(entry({ ran: 99 }))).toMatchObject({ queue: 30, run: 0 }); // a run stamped past the result is held to it
    expect(phasesOf(entry({ ran: 3 }))).toMatchObject({ wait: 10, queue: 0, run: 30 }); // and one before the start to the start
    // a long queue is held up, not a slow run
    expect(verdictOf(entry({ start: 5, ran: 90, finish: 100, end: 102 }))).toMatchObject({ where: "wait", kind: "queue" });
    expect(verdictOf(entry({ start: 5, ran: 90, finish: 100, end: 102 })).text).toContain("queue");
    expect(summarise([entry({ ran: 25 })])).toMatchObject({ wait: 10, queue: 15, run: 15 });
    expect(aggregate([entry({ ran: 25 })])).toMatchObject({ wait: 10, queue: 15, run: 15, collect: 5 });
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
    expect(mem).toMatchObject({ kind: "memory", tag: "Memory-bound" });
    expect(verdictOf(entry({ start: 80, finish: 100, end: 102 }))).toMatchObject({ kind: "queue", tag: "Queue" });
    expect(verdictOf(entry({ win: win({ pageFaults: 300, tlbMisses: 900 }) })).kind).toBe("paging");
    expect(verdictOf(entry()).kind).toBe("compute");
    expect(verdictOf(entry({ outcome: "declined" })).kind).toBe("lost");
    expect(verdictOf(entry({ win: win({ stallFlush: 400 }) })).text).toContain("mispredicted");
    expect(verdictOf(entry({ win: win({ pageFaults: 300, tlbMisses: 900 }) })).text).toContain("page faults");
    expect(verdictOf(entry()).text).toContain("CPI");
    expect(verdictOf(entry({ win: undefined })).hint).toContain("restarted");
    expect(verdictOf(entry({ outcome: "expired" })).text).toContain("took it back");
  });

  it("reads a card job as waiting on the card, not as CPU stalls, and keeps its spin out of the aggregate", () => {
    const g = entry({ gpu: true, win: win({ stallCache: 900 }) });
    expect(verdictOf(g)).toMatchObject({ where: "run", kind: "card", tag: "On the card" });
    expect(verdictOf(g).text).not.toContain("memory");
    expect(verdictOf(entry({ gpu: true, start: 80, finish: 100, end: 102 })).kind).toBe("queue"); // a long wait is still the queue
    const mixed = aggregate([g, entry({ id: 2, win: win({ stallFlush: 400 }) })]);
    expect(mixed.win).toMatchObject({ cycles: 1000, stallFlush: 400, stallCache: 0 });
    const only = aggregate([g]);
    expect(only.win).toBeUndefined();
    expect(only.verdict.kind).toBe("card");
    const run = { arrivalTick: 0, deadlineTick: 100, startedAt: 0, live: win({ stallCache: 900 }) };
    expect(liveVerdict(run, 50)!.kind).toBe("memory");
    expect(liveVerdict({ ...run, gpu: true }, 50)!.kind).toBe("card");
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

describe("jobs on the machine now", () => {
  const live = { arrivalTick: 100, deadlineTick: 400 };

  it("cuts a job's time so far into waiting, running and collecting", () => {
    expect(livePhases(live, 130)).toEqual({ wait: 30, queue: 0, run: 0, collect: 0, total: 30 });
    expect(livePhases({ ...live, startedAt: 120 }, 150)).toEqual({ wait: 20, queue: 0, run: 30, collect: 0, total: 50 });
    expect(livePhases({ ...live, startedAt: 120, finishedAt: 140 }, 150)).toEqual({ wait: 20, queue: 0, run: 20, collect: 10, total: 50 });
    expect(livePhases({ ...live, startedAt: 0 }, 150).wait).toBe(0); // a start before the arrival reads as no wait
    expect(livePhases({ ...live, startedAt: 120, ranAt: 135 }, 150)).toEqual({ wait: 20, queue: 15, run: 15, collect: 0, total: 50 });
    expect(livePhases({ ...live, startedAt: 120, ranAt: 135, finishedAt: 140 }, 150)).toEqual({ wait: 20, queue: 15, run: 5, collect: 10, total: 50 });
  });

  it("reads a running job from its cycles so far, and says nothing before there are enough", () => {
    const k = { ...live, startedAt: 100 };
    expect(liveVerdict(k, 160)).toBeNull();
    expect(liveVerdict({ ...k, live: win({ cycles: 50 }) }, 160)).toBeNull();
    expect(liveVerdict({ ...k, live: win({ stallCache: 500 }) }, 160)).toMatchObject({ kind: "memory" });
    expect(liveVerdict({ ...k, live: win() }, 160)?.kind).toBe("compute");
  });

  it("a plugged job's snapshot says when it was taken, and a running one carries the cycles counted so far", () => {
    const g = rig("ssd1", { keys: [{ template: "cli.scan" }] });
    const tray = g.snapshot().tray[0]!;
    expect(tray.startedAt).toBeUndefined();
    g.powerButton();
    for (let t = 0; t < 400 && g.currentPhase() !== "idle-os"; t++) g.advanceBaseTick();
    g.plugKey(g.trayKeyIds()[0]!);
    let seen: ReturnType<Game["snapshot"]>["plugged"] = null;
    for (let t = 0; t < 600 && g.completed < 1 && !seen?.live; t++) {
      g.advanceBaseTick();
      const k = g.snapshot().plugged;
      if (k?.stage === "running" && k.live && k.live.cycles > 0) seen = k;
    }
    expect(seen?.startedAt).toBeGreaterThan(0);
    expect(seen!.live!.cycles).toBeGreaterThan(0);
    expect(seen!.finishedAt).toBeUndefined();
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

describe("a job on the machine when the game was saved and loaded", () => {
  const offer = (g: Game, template: string, scale = 1) => (g as unknown as { enqueue(t: string, s: number, c: string | undefined, n: boolean): boolean }).enqueue(template, scale, undefined, true);
  const reload = (g: Game): Game => Game.fromSave(JSON.parse(JSON.stringify(g.toSave())));

  it("words the reading as counters since the reload, or says there are none", () => {
    const e = entry({ reloaded: true, win: win({ stallCache: 500 }) });
    expect(verdictOf(e)).toMatchObject({ kind: "memory" });
    expect(verdictOf(e).text).toContain("since the reload");
    expect(verdictOf(entry({ win: win({ stallCache: 500 }) })).text).not.toContain("reload");
    expect(verdictOf(entry({ reloaded: true, win: undefined })).hint).toContain("reloaded");
    expect(liveVerdict({ arrivalTick: 0, deadlineTick: 100, startedAt: 0, reloaded: true, live: win({ stallCache: 500 }) }, 50)!.text).toContain("since the reload");
  });

  it("the plugged key keeps when it was taken; its run is counted since the reload and the log says so", () => {
    const g = rig("ssd1", { keys: [{ template: "cli.scan", scale: 4 }] });
    g.powerButton();
    for (let t = 0; t < 400 && g.currentPhase() !== "idle-os"; t++) g.advanceBaseTick();
    g.plugKey(g.trayKeyIds()[0]!);
    for (let t = 0; t < 600 && g.snapshot().plugged?.stage !== "running"; t++) g.advanceBaseTick();
    expect(g.snapshot().plugged!.stage).toBe("running");
    const saved = g.toSave();
    const back = reload(g);
    const k = back.snapshot().plugged!;
    expect(k.reloaded).toBe(true);
    expect(back.toSave().plugged!.pluggedAt).toBe(saved.plugged!.pluggedAt);
    expect(k.ranAt).toBeUndefined(); // it starts over: stamped again when the kernel runs it
    back.powerButton();
    for (let t = 0; t < 6000 && back.completed < 1; t++) back.advanceBaseTick();
    const e = back.snapshot().jobLog![0]!;
    expect(e).toMatchObject({ outcome: "done", reloaded: true, start: saved.plugged!.pluggedAt, arrival: saved.plugged!.arrival });
    expect(phasesOf(e).wait).toBe(saved.plugged!.pluggedAt - saved.plugged!.arrival);
    expect(e.ran!).toBeGreaterThan(saved.baseTick); // the run began after the reload
    expect(e.win!.cycles).toBeGreaterThan(0);
    expect(e.win!.retired).toBeGreaterThan(0);
    expect(reload(back).snapshot().jobLog![0]).toEqual(e); // the flag is saved with the entry
  });

  it("without an OS a reloaded key is stamped when the machine first runs it, and its window is since then", () => {
    const g = new Game({ seed: 1, preassembled: true, economy: { baseDemandPerTick: 0, startQueue: [{ template: "cli.scan", scale: 4 }], firmwareBoost: 1 } });
    g.money = 1e6;
    const op = new Operator(g, 0);
    for (let t = 0; t < 5000 && !(g.snapshot().plugged && g.currentPhase() === "running"); t++) { g.advanceBaseTick(); op.step(); }
    expect(g.snapshot().plugged).not.toBeNull();
    const saved = g.toSave();
    const back = reload(g);
    expect(back.snapshot().plugged!.reloaded).toBe(true);
    back.powerButton();
    const op2 = new Operator(back, 0);
    for (let t = 0; t < 8000 && back.completed < 1; t++) { back.advanceBaseTick(); op2.step(); }
    const e = back.snapshot().jobLog![0]!;
    expect(e).toMatchObject({ reloaded: true, start: saved.plugged!.pluggedAt });
    expect(e.ran!).toBeGreaterThanOrEqual(saved.baseTick);
    expect(e.win!.cycles).toBeGreaterThan(0);
  });

  it("a spooled job keeps its taking too, and a job that never reloaded has no flag", () => {
    const g = netRig("ssd1", { keys: [] });
    offer(g, "cli.scan", 4);
    offer(g, "cli.log");
    for (let t = 0; t < 3000 && g.toSave().net!.spool.length < 1; t++) g.advanceBaseTick();
    const saved = g.toSave();
    expect(saved.net!.spool.length).toBeGreaterThan(0);
    const back = reload(g);
    const spooled = back.snapshot().net!.spooled;
    expect(spooled.map((k) => [k.id, k.startedAt])).toEqual(saved.net!.spool.map((k) => [k.id, k.pluggedAt]));
    for (const k of spooled) expect(k.reloaded).toBe(true);
    back.powerButton();
    for (let t = 0; t < 8000 && back.completed < 2; t++) back.advanceBaseTick();
    const ids = saved.net!.spool.map((k) => k.id);
    const log = back.snapshot().jobLog!.filter((e) => ids.includes(e.id));
    expect(log).toHaveLength(ids.length);
    for (const e of log) {
      const was = saved.net!.spool.find((k) => k.id === e.id)!;
      expect(e).toMatchObject({ reloaded: true, start: was.pluggedAt });
      expect(e.win!.cycles).toBeGreaterThan(0);
      expect(e.ran!).toBeGreaterThan(saved.baseTick);
    }
    const fresh = rig("ssd1", { keys: [{ template: "cli.log" }] });
    fresh.powerButton();
    for (let t = 0; t < 400 && fresh.currentPhase() !== "idle-os"; t++) fresh.advanceBaseTick();
    fresh.plugKey(fresh.trayKeyIds()[0]!);
    for (let t = 0; t < 600 && fresh.completed < 1; t++) fresh.advanceBaseTick();
    expect(fresh.snapshot().jobLog![0]!.reloaded).toBeUndefined();
  });
});

describe("a job queued behind another under an OS", () => {
  const offer = (g: Game, template: string, scale = 1) => (g as unknown as { enqueue(t: string, s: number, c: string | undefined, n: boolean): boolean }).enqueue(template, scale, undefined, true);

  it("runs from when the kernel began it: the queue wait is its own phase, and the counter window starts there", () => {
    const g = netRig("ssd1", { keys: [] });
    offer(g, "cli.scan", 4); // a long one first; the next is offered once it runs, so it waits behind it
    for (let t = 0; t < 1500 && !g.snapshot().os!.queue.some((j) => j.state === "running"); t++) g.advanceBaseTick();
    offer(g, "cli.log");
    for (let t = 0; t < 3000 && g.completed < 2; t++) g.advanceBaseTick();
    const log = g.snapshot().jobLog!;
    expect(log).toHaveLength(2);
    const [first, second] = [...log].sort((a, b) => a.ran! - b.ran!) as [JobLogEntry, JobLogEntry]; // in the order the kernel ran them
    for (const e of log) {
      expect(e.ran).toBeDefined();
      expect(e.start).toBeLessThanOrEqual(e.ran!);
      expect(e.ran!).toBeLessThanOrEqual(e.finish);
    }
    // the second was already on the machine while the first ran, and only began once the first was done
    expect(second.start).toBeLessThan(first.finish);
    expect(second.ran!).toBeGreaterThanOrEqual(first.finish);
    const p = phasesOf(second);
    expect(p.queue).toBeGreaterThan(0);
    expect(p.run).toBe(second.finish - second.ran!);
    expect(p.run).toBeLessThan(second.finish - second.start); // the queue wait is not in the run
    expect(p.total).toBe(second.end - second.arrival);
    // its counters cover its own run, not the first job's: the window is far smaller than the scan's
    expect(second.win!.cycles).toBeGreaterThan(0);
    expect(first.type).toBe("scan");
    expect(second.win!.cycles).toBeLessThan(first.win!.cycles);
  });

  it("with no OS the plug is the start of the run, so the log has no queue", () => {
    const g = new Game({ seed: 1, preassembled: true, economy: { baseDemandPerTick: 0, startQueue: [{ template: "cli.log" }], firmwareBoost: 1 } });
    g.money = 1e6;
    const op = new Operator(g, 0);
    for (let t = 0; t < 5000 && g.completed === 0; t++) { g.advanceBaseTick(); op.step(); }
    const e = g.snapshot().jobLog![0]!;
    expect(e.ran).toBe(e.start);
    expect(phasesOf(e).queue).toBe(0);
  });

  it("a key that holds its result keeps when it ran across a save", () => {
    const g = new Game({ seed: 1, preassembled: true, economy: { baseDemandPerTick: 0, startQueue: [{ template: "cli.log" }], firmwareBoost: 1, autoEjectTicks: 0 } });
    g.money = 1e6;
    const op = new Operator(g, 0);
    for (let t = 0; t < 5000 && !g.pluggedKey()?.done; t++) { g.advanceBaseTick(); op.step(); }
    const saved = g.toSave();
    expect(saved.plugged!.done).toBe(true);
    expect(saved.plugged!.ranAt).toBeGreaterThan(0);
    expect(Game.fromSave(JSON.parse(JSON.stringify(saved))).toSave().plugged!.ranAt).toBe(saved.plugged!.ranAt);
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

