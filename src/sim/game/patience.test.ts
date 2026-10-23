// Client patience schedule (ECONOMY.patience) and the manual no-OS loop versus an OS machine, same seeds.
// The numbers are placeholders; these tests pin the shape: forgiving early, tight late, the OS side survives.
import { describe, expect, it } from "vitest";
import { ECONOMY, patienceMul } from "./economy";
import { Game } from "./game";
import { Operator } from "./operator";
import { migrate, parseSave } from "./save";
import { rig } from "./testkit";

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("the patience schedule", () => {
  const P = ECONOMY.patience;

  it("is flat at the start value, falls linearly, and stays at the floor", () => {
    expect(patienceMul(ECONOMY, 0)).toBe(P.startMul);
    expect(patienceMul(ECONOMY, P.holdTicks)).toBe(P.startMul);
    const mid = patienceMul(ECONOMY, (P.holdTicks + P.floorTicks) / 2);
    expect(mid).toBeCloseTo((P.startMul + P.floorMul) / 2);
    expect(patienceMul(ECONOMY, P.floorTicks)).toBe(P.floorMul);
    expect(patienceMul(ECONOMY, 10 * P.floorTicks)).toBe(P.floorMul);
    expect(P.startMul).toBeGreaterThan(1);
    expect(P.floorMul).toBeLessThan(1);
  });

  it("scales the reputation target and the key deadline with the time since the first boot, and shows it in the snapshot", () => {
    const g = new Game({ seed: 1, preassembled: true, economy: { baseDemandPerTick: 0 } });
    const first = g.snapshot();
    expect(first.patience).toEqual({ mul: P.startMul, targetTurnaround: ECONOMY.targetTurnaround * P.startMul, deadlineTicks: ECONOMY.deadlineTicks * P.startMul, sinceFirstBoot: 0 });
    expect(first.tray[0]!.deadlineTick - first.tray[0]!.arrivalTick).toBe(ECONOMY.deadlineTicks * P.startMul);
    for (let t = 0; t < P.floorTicks; t++) g.advanceBaseTick();
    const late = g.snapshot().patience;
    expect(late.mul).toBe(P.floorMul);
    expect(late.deadlineTicks).toBe(Math.round(ECONOMY.deadlineTicks * P.floorMul));
    expect(late.sinceFirstBoot).toBe(P.floorTicks);
  });

  it("the clock starts at the first power-on, not while the player builds the machine", () => {
    const g = new Game({ seed: 1, economy: { baseDemandPerTick: 0 } });
    for (let t = 0; t < 400; t++) g.advanceBaseTick();
    expect(g.snapshot().patience.sinceFirstBoot).toBe(0);
    expect(g.snapshot().patience.mul).toBe(P.startMul);
  });

  it("is saved with the game (optional field; older v4 saves restart the schedule at the load tick)", () => {
    const g = new Game({ seed: 1, preassembled: true, economy: { baseDemandPerTick: 0 } });
    for (let t = 0; t < 1000; t++) g.advanceBaseTick();
    const save = json(g.toSave());
    expect(save.firstBootTick).toBe(0);
    expect(save.version).toBe(4);
    expect(Game.fromSave(save).snapshot().patience.sinceFirstBoot).toBe(1000);
    const old = json(g.toSave()) as unknown as Record<string, unknown>;
    delete old.firstBootTick;
    expect(Game.fromSave(old).snapshot().patience.sinceFirstBoot).toBe(0);
    expect(() => parseSave({ ...json(g.toSave()), firstBootTick: -3 })).toThrow(/firstBootTick/);
  });

  it("an older save without firstManualCycle gets it from firstKeyEjected", () => {
    const g = new Game({ seed: 1, economy: { baseDemandPerTick: 0 } });
    const s = json(g.toSave()) as unknown as { progress: Record<string, boolean> };
    delete s.progress.firstManualCycle;
    expect(parseSave(migrate(json(s))).progress.firstManualCycle).toBe(false);
    s.progress.firstKeyEjected = true;
    expect(parseSave(migrate(json(s))).progress.firstManualCycle).toBe(true);
  });
});

describe("the manual loop needs an OS to last", () => {
  /** Mean reputation over a window of ticks, sampled every 10. */
  interface Run { early: number; mid: number; late: number; jobs: number; firstPay: number }

  function play(os: boolean, seed: number): Run {
    // A mid-game machine (CPU tier 2, NVMe, 32K RAM), with or without the OS; default economy, the plain starter key.
    const g = rig("nvme2", { os, cpu: "cpu2", seed, economy: { baseDemandPerTick: ECONOMY.baseDemandPerTick, startQueue: [{ template: "cli.log" }] } });
    const op = new Operator(g, 3); // a human takes about 3 s per manual step
    const w: number[][] = [[], [], []];
    let firstPay = 0;
    for (let t = 1; t <= 4500; t++) {
      g.advanceBaseTick();
      op.step();
      if (!firstPay && g.completed > 0) firstPay = t;
      if (t % 10 === 0) {
        const r = g.snapshot().reputation;
        if (t > 100 && t <= 700) w[0]!.push(r);
        else if (t > 1800 && t <= 2400) w[1]!.push(r);
        else if (t > 3600) w[2]!.push(r);
      }
    }
    const m = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    return { early: m(w[0]!), mid: m(w[1]!), late: m(w[2]!), jobs: g.completed, firstPay };
  }

  const SEEDS = [1, 2, 3, 4];
  const mean = (rs: Run[], k: keyof Run) => rs.reduce((n, r) => n + r[k], 0) / rs.length;

  it("a no-OS bot is fine early and its reputation collapses once the patience has tightened; the OS bot stays healthy", { timeout: 120000 }, () => {
    const manual = SEEDS.map((s) => play(false, s));
    const withOs = SEEDS.map((s) => play(true, s));
    const row = (name: string, rs: Run[]) =>
      `${name}: rep early ${mean(rs, "early").toFixed(2)} mid ${mean(rs, "mid").toFixed(2)} late ${mean(rs, "late").toFixed(2)}, jobs ${mean(rs, "jobs").toFixed(0)}, first payout at ${mean(rs, "firstPay").toFixed(0)} s`;
    console.log(`[patience, ${SEEDS.length} seeds]\n  ${row("no OS (manual loop)", manual)}\n  ${row("OS             ", withOs)}`);

    // Early: the manual loop earns its first payout within a few minutes and holds a good reputation.
    for (const r of manual) expect(r.firstPay).toBeLessThanOrEqual(240);
    expect(mean(manual, "early")).toBeGreaterThan(1);
    // Late: the manual loop's reputation falls to near the floor (repMin), seed by seed...
    for (const r of manual) expect(r.late).toBeLessThan(0.6);
    expect(mean(manual, "late")).toBeLessThan(mean(manual, "early") * 0.5);
    // ...while the OS bot on the same seeds is clearly better and stays near a healthy reputation.
    SEEDS.forEach((_, i) => expect(withOs[i]!.late).toBeGreaterThan(manual[i]!.late));
    expect(mean(withOs, "late")).toBeGreaterThan(0.7);
    expect(mean(withOs, "late")).toBeGreaterThan(mean(manual, "late") * 1.4);
    expect(mean(withOs, "jobs")).toBeGreaterThan(mean(manual, "jobs") * 1.15);
  });

  it("is deterministic: the same seed gives the same run", { timeout: 60000 }, () => {
    expect(play(false, 2)).toEqual(play(false, 2));
    expect(play(true, 2)).toEqual(play(true, 2));
  });
});
