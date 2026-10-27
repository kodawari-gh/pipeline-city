import { describe, expect, it } from "vitest";
import { Game } from "./game";
import { ECONOMY } from "./economy";
import { JOB_CLASSES } from "./levels";
import { dexEntry, dexNeeds, dexState, JOB_DEX } from "./jobdex";
import { rig } from "./testkit";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

describe("the job almanac data", () => {
  it("has an entry for every kind of job the monitor names, each tied to a real class", () => {
    expect(new Set(JOB_DEX.map((e) => e.id)).size).toBe(JOB_DEX.length);
    for (const e of JOB_DEX) {
      expect(JOB_CLASSES.some((c) => c.id === e.cls), e.id).toBe(true);
      expect(e.blurb.length, e.id).toBeGreaterThan(10);
      if (!e.planned) { expect(e.tips.length, e.id).toBeGreaterThanOrEqual(2); expect(e.stresses.length, e.id).toBeGreaterThan(0); }
    }
    for (const c of JOB_CLASSES.filter((x) => !x.placeholder)) expect(JOB_DEX.some((e) => e.cls === c.id && !e.planned), c.id).toBe(true);
    expect(JOB_DEX.filter((e) => e.planned).map((e) => e.id)).toEqual(["web", "hpc"]);
  });

  it("says what a class needs and when it arrives", () => {
    expect(dexNeeds(dexEntry("db")!)).toEqual({ needs: ["an OS", "a SATA SSD or better", "96K of RAM"], firstLevel: 5 });
    expect(dexNeeds(dexEntry("log")!).needs).toEqual([]);
  });

  it("goes unseen, seen, done", () => {
    const e = dexEntry("scan")!;
    expect(dexState(e, undefined)).toBe("unseen");
    expect(dexState(e, { seen: 3, runs: 0, best: 0 })).toBe("seen");
    expect(dexState(e, { seen: 3, runs: 2, best: 9 })).toBe("done");
    expect(dexState(dexEntry("web")!, undefined)).toBe("planned");
  });
});

describe("the almanac in a game", () => {
  it("a kind of job is seen when it arrives, done when one is finished, keeps its best time, and survives a save", () => {
    const g = rig("ssd1", { keys: [{ template: "cli.scan", scale: 2 }, { template: "cli.log" }] });
    const dex = (id: string) => g.snapshot().dex!.find((d) => d.id === id)!;
    expect(dex("scan")).toMatchObject({ state: "seen", runs: 0 });
    expect(dex("log")).toMatchObject({ state: "seen" });
    expect(dex("calc").state).toBe("unseen");
    g.powerButton();
    for (let t = 0; t < 400 && g.currentPhase() !== "idle-os"; t++) g.advanceBaseTick();
    g.plugKey(g.trayKeyIds()[0]!);
    for (let t = 0; t < 600 && g.completed < 1; t++) g.advanceBaseTick();
    expect(g.completed).toBeGreaterThanOrEqual(1);
    const done = g.snapshot().dex!.filter((d) => d.state === "done");
    expect(done).toHaveLength(1);
    expect(done[0]!.runs).toBe(1);
    expect(done[0]!.best).toBeGreaterThan(0);
    const back = Game.fromSave(JSON.parse(JSON.stringify(g.toSave())));
    expect(back.snapshot().dex!.find((d) => d.id === done[0]!.id)).toMatchObject({ state: "done", runs: 1, best: done[0]!.best });
  });
});
