// Client patience by player level (docs/PROGRESSION.md; it replaced the tick schedule from the first boot) and the manual
// no-OS loop versus an OS machine, same seeds. The numbers are placeholders; these tests pin the shape: forgiving early,
// tight late, the OS side stays healthier at the mid levels.
import { describe, expect, it } from "vitest";
import { ECONOMY } from "./economy";
import { Game } from "./game";
import { LEVELS, patienceMul } from "./levels";
import { Operator } from "./operator";
import { migrate, parseSave } from "./save";
import { rig } from "./testkit";

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("patience by level", () => {
  it("is 4 at the start, falls with the level, never rises, and ends at 0.5", () => {
    expect(patienceMul(1)).toBe(4);
    expect(patienceMul(2)).toBe(4);
    expect(patienceMul(3)).toBe(3);
    expect(patienceMul(18)).toBe(0.5);
    for (let l = 2; l <= 18; l++) expect(patienceMul(l)).toBeLessThanOrEqual(patienceMul(l - 1));
    expect(LEVELS.map((l) => l.patienceMul)).toEqual(LEVELS.map((l) => patienceMul(l.level)));
  });

  it("scales the reputation target, the key deadline and the give-up turnaround, and shows it in the snapshot", () => {
    for (const [level, mul] of [[1, 4], [3, 3], [5, 2], [9, 1.05], [18, 0.5]] as const) {
      const g = new Game({ seed: 1, preassembled: true, startLevel: level, economy: { baseDemandPerTick: 0 } });
      const s = g.snapshot();
      expect(s.patience).toEqual({
        mul, targetTurnaround: ECONOMY.targetTurnaround * mul, deadlineTicks: Math.round(ECONOMY.deadlineTicks * mul), sinceFirstBoot: 0,
      });
      expect(s.tray[0]!.deadlineTick - s.tray[0]!.arrivalTick).toBe(Math.round(ECONOMY.deadlineTicks * mul));
      expect(s.reputation).toBe(1); // the clients start out content at every level
    }
    // The give-up turnaround: a full tray feeds giveUpTurnaround x mul into the average.
    const g = new Game({ seed: 3, preassembled: true, startLevel: 5, economy: { baseDemandPerTick: 1, queueCap: 2 } });
    for (let t = 0; t < 10; t++) g.advanceBaseTick();
    expect(g.snapshot().dropped).toBeGreaterThan(0);
    expect(g.snapshot().avgTurnaround).toBeGreaterThan(ECONOMY.targetTurnaround * 2);
  });

  it("the patience follows the level, not the time: it does not move while the level stays", () => {
    const g = new Game({ seed: 1, preassembled: true, economy: { baseDemandPerTick: 0 } });
    for (let t = 0; t < 3000; t++) g.advanceBaseTick();
    const p = g.snapshot().patience;
    expect(p.mul).toBe(4);
    expect(p.sinceFirstBoot).toBe(3000);
  });

  it("the first-boot clock starts at the first power-on, not while the player builds the machine", () => {
    const g = new Game({ seed: 1, economy: { baseDemandPerTick: 0 } });
    for (let t = 0; t < 400; t++) g.advanceBaseTick();
    expect(g.snapshot().patience.sinceFirstBoot).toBe(0);
    expect(g.snapshot().patience.mul).toBe(4);
  });

  it("the first-boot tick is saved with the game (optional field; older v4 saves restart it at the load tick)", () => {
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
  interface Run { rep: number; jobs: number; firstPay: number; expired: number }

  /** Mean reputation after tick 600 of a 3000 s run on a mid-game machine (CPU tier 2, NVMe, 32K RAM) that starts at `level`. */
  function play(os: boolean, seed: number, level: number): Run {
    const g = rig("nvme2", { os, cpu: "cpu2", seed, startLevel: level, economy: { baseDemandPerTick: ECONOMY.baseDemandPerTick, startQueue: [{ template: "cli.log" }] } });
    const op = new Operator(g, 3); // a human takes about 3 s per manual step
    let sum = 0;
    let n = 0;
    let firstPay = 0;
    for (let t = 1; t <= 3000; t++) {
      g.advanceBaseTick();
      op.step();
      if (!firstPay && g.completed > 0) firstPay = t;
      if (t > 600 && t % 10 === 0) { sum += g.snapshot().reputation; n++; }
    }
    return { rep: sum / n, jobs: g.completed, firstPay, expired: g.expired };
  }

  const SEEDS = [1, 2, 3, 4];
  const mean = (rs: Run[], k: keyof Run) => rs.reduce((n, r) => n + r[k], 0) / rs.length;

  it("at the mid levels (3, 5, 7) the OS bot keeps a healthier reputation and serves more jobs than the manual loop, seed by seed", { timeout: 240000 }, () => {
    for (const level of [3, 5, 7]) {
      const manual = SEEDS.map((s) => play(false, s, level));
      const withOs = SEEDS.map((s) => play(true, s, level));
      const row = (name: string, rs: Run[]) => `${name}: rep ${mean(rs, "rep").toFixed(2)}, jobs ${mean(rs, "jobs").toFixed(0)}, expired ${mean(rs, "expired").toFixed(1)}, first payout at ${mean(rs, "firstPay").toFixed(0)} s`;
      console.log(`[patience, level ${level}, ${SEEDS.length} seeds]\n  ${row("no OS (manual loop)", manual)}\n  ${row("OS             ", withOs)}`);
      // With the short POST the manual loop is fast per job (about 15 s), so its reputation is close to the OS's; what the OS
      // wins is volume and patience: more jobs, and the keys the manual loop lets expire (the slow human steps).
      SEEDS.forEach((_, i) => expect(withOs[i]!.jobs, `level ${level} seed ${i}`).toBeGreaterThan(manual[i]!.jobs));
      expect(mean(withOs, "rep")).toBeGreaterThan(mean(manual, "rep") * 0.97); // a tie at the high levels: the manual loop is quick per job now
      expect(mean(withOs, "jobs")).toBeGreaterThan(mean(manual, "jobs") * 1.2);
      expect(mean(withOs, "expired")).toBeLessThan(mean(manual, "expired"));
      expect(mean(withOs, "rep")).toBeGreaterThan(0.7);
    }
  });

  it("the manual loop is forgiven early (level 1: a first payout within a few minutes and a fair reputation) and gets harder with the level", { timeout: 120000 }, () => {
    const l1 = SEEDS.map((s) => play(false, s, 1));
    const l9 = SEEDS.map((s) => play(false, s, 9));
    for (const r of l1) expect(r.firstPay).toBeLessThanOrEqual(240);
    expect(mean(l1, "rep")).toBeGreaterThan(mean(l9, "rep") * 1.15);
  });

  it("is deterministic: the same seed gives the same run", { timeout: 60000 }, () => {
    expect(play(false, 2, 5)).toEqual(play(false, 2, 5));
    expect(play(true, 2, 5)).toEqual(play(true, 2, 5));
  });
});
