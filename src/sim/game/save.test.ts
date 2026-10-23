import { describe, expect, it } from "vitest";
import { Game } from "./game";
import { migrate, parseSave, SAVE_VERSION } from "./save";

const run = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.advanceBaseTick(); };

/** The fields a save/load boundary preserves when nothing is in flight. */
const core = (g: Game) => {
  const s = g.snapshot();
  return {
    money: s.money, baseTick: s.baseTick, completed: s.completed, errors: s.errors, dropped: s.dropped,
    queueLength: s.queueLength, reputation: s.reputation, prng: g.machine.prng.getState(),
    last: s.lastCompleted, board: g.board,
  };
};

/** Advance a fresh seeded game until it is idle (no request running), after at least `min` ticks. */
function idleGame(seed: number, min: number): Game {
  const g = new Game({ seed });
  run(g, min);
  for (let i = 0; i < 2000 && g.snapshot().request; i++) g.advanceBaseTick();
  expect(g.snapshot().request).toBeNull();
  return g;
}

describe("save/load", () => {
  it("is plain JSON, versioned, with no micro-state", () => {
    const g = new Game({ seed: 3 });
    run(g, 10);
    const save = g.toSave();
    expect(save.version).toBe(SAVE_VERSION);
    const json = JSON.stringify(save);
    expect(JSON.parse(json)).toEqual(save);
    expect(json).not.toMatch(/"(regs|ram|pipeline|program|registers)"/i);
    expect(json.length).toBeLessThan(5000);
  });

  it("round-trips through stringify/parse and preserves config", () => {
    const g = new Game({ seed: 5 });
    g.money = 1000;
    g.purchase("cooler1");
    g.setCpuClock(0.5);
    run(g, 300);
    const l = Game.fromSave(JSON.parse(JSON.stringify(g.toSave())));
    expect(l.toSave()).toEqual({ ...g.toSave(), current: l.toSave().current });
    expect(l.money).toBe(g.money);
    expect(l.baseTick).toBe(g.baseTick);
    expect(l.board).toEqual(g.board);
    expect(l.snapshot().cpuClock).toEqual(g.snapshot().cpuClock);
  });

  it("exactly matches an uninterrupted run when saved while idle", () => {
    // Nothing is in flight, so the only dropped micro-state is thermal temperature (ambient-ish at idle, no throttle)
    // and clock phase (0 at base tick boundaries for integer rates). Everything below must match exactly.
    for (const seed of [1, 2, 7]) {
      const a = idleGame(seed, 150);
      const b = Game.fromSave(JSON.parse(JSON.stringify(a.toSave())));
      expect(core(b)).toEqual(core(a));
      for (let i = 0; i < 400; i++) {
        a.advanceBaseTick();
        b.advanceBaseTick();
      }
      expect(core(b)).toEqual(core(a));
      expect(b.snapshot().display).toBe(a.snapshot().display);
    }
  });

  it("restarts an in-flight request from its first instruction with a cold engine", () => {
    const a = new Game({ seed: 4, economy: { baseDemandPerTick: 0 } });
    run(a, 15);
    const s = a.snapshot();
    expect(s.request).not.toBeNull();
    expect(s.request!.engineCycle).toBeGreaterThan(0);
    const b = Game.fromSave(JSON.parse(JSON.stringify(a.toSave())), { baseDemandPerTick: 0 });
    const t = b.snapshot();
    expect(t.request!.id).toBe(s.request!.id);
    expect(t.request!.engineCycle).toBe(0);
    expect(t.display.trim()).toBe("");
    expect(t.money).toBe(s.money);
    // Same save loaded twice behaves identically (deterministic restart).
    const c = Game.fromSave(JSON.parse(JSON.stringify(a.toSave())), { baseDemandPerTick: 0 });
    run(b, 80);
    run(c, 80);
    expect(core(b)).toEqual(core(c));
    // It restarted from scratch, so it finishes later than the uninterrupted run did.
    run(a, 80);
    expect(b.completed).toBe(1);
    expect(a.completed).toBe(1);
    expect(b.lastCompleted!.completedAt).toBeGreaterThan(a.lastCompleted!.completedAt);
  });

  it("a loaded game keeps earning", () => {
    const a = new Game({ seed: 9 });
    run(a, 100);
    const b = Game.fromSave(JSON.parse(JSON.stringify(a.toSave())));
    const before = b.money;
    run(b, 400); // the starting traffic includes slow scan jobs
    expect(b.money).toBeGreaterThan(before);
    expect(b.completed).toBeGreaterThan(a.completed);
  });

  it("keeps pending purchases and the queue", () => {
    const a = new Game({ seed: 2, economy: { baseDemandPerTick: 0.2 } });
    a.money = 500;
    run(a, 5);
    expect(a.purchase("cpu1")).toEqual({ ok: true, pending: true });
    const b = Game.fromSave(JSON.parse(JSON.stringify(a.toSave())), { baseDemandPerTick: 0.2 });
    expect(b.snapshot().queueLength).toBe(a.snapshot().queueLength);
    expect(b.snapshot().pendingPurchases).toEqual(["cpu1"]);
    run(b, 80);
    expect(b.snapshot().devices.some((d) => d.spec === "cpu1")).toBe(true);
  });
});

describe("validation", () => {
  const good = () => JSON.parse(JSON.stringify(new Game({ seed: 1 }).toSave()));

  it("accepts a good save", () => {
    expect(() => parseSave(good())).not.toThrow();
  });

  it("rejects malformed input with clear messages", () => {
    expect(() => Game.fromSave(null)).toThrow(/not an object/);
    expect(() => Game.fromSave("x")).toThrow(/not an object/);
    expect(() => Game.fromSave({})).toThrow(/version/);
    expect(() => Game.fromSave({ ...good(), version: 99 })).toThrow(/newer/);
    expect(() => Game.fromSave({ ...good(), version: 0 })).toThrow(/unknown version/);
    expect(() => Game.fromSave({ ...good(), money: "lots" })).toThrow(/money/);
    expect(() => Game.fromSave({ ...good(), money: NaN })).toThrow(/money/);
    expect(() => Game.fromSave({ ...good(), board: { tier: 0, nextId: 1, devices: [{ id: "d", spec: "nope", slot: "cpu0" }] } })).toThrow(/board/);
    expect(() => Game.fromSave({ ...good(), pending: ["nope"] })).toThrow(/pending/);
    expect(() => Game.fromSave({ ...good(), queue: [{ id: 1, template: "bogus", seed: 1, scale: 1, arrival: 0, deadline: 1 }] })).toThrow(/template/);
    const noQueue = good();
    delete noQueue.queue;
    expect(() => Game.fromSave(noQueue)).toThrow(/queue/);
  });
});

describe("migrate", () => {
  it("is the identity for the current version", () => {
    const s = new Game({ seed: 1 }).toSave();
    expect(migrate(s)).toBe(s);
  });
});
