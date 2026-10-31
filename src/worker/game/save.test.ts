import { describe, expect, it } from "vitest";
import { Game } from "./game";
import { Operator, play } from "../../features/economy/sim/operator";
import { migrate, parseSave, SAVE_VERSION } from "./save";
import { ECONOMY } from "../../features/economy/sim/economy";

ECONOMY.caseGating = false;

const run = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.advanceBaseTick(); };
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The fields a save/load boundary preserves when nothing is in flight. */
const core = (g: Game) => {
  const s = g.snapshot();
  return {
    money: s.money, baseTick: s.baseTick, completed: s.completed, errors: s.errors, dropped: s.dropped,
    queueLength: s.queueLength, reputation: s.reputation, prng: g.machine.prng.getState(),
    last: s.lastCompleted, board: g.board, inventory: s.inventory.map((i) => i.spec), cables: s.cables, progress: s.progress,
    tray: s.tray.map((k) => [k.id, k.template, k.arrivalTick]),
  };
};

/** Play with a bot until the machine is halted (job done or no boot media) with no key plugged in, after at least `min` ticks. */
function idleGame(seed: number, min: number): Game {
  const g = new Game({ seed });
  const op = new Operator(g, 1);
  for (let t = 0; t < min; t++) { g.advanceBaseTick(); op.step(); }
  for (let i = 0; i < 2000 && !(g.currentPhase() === "halted" && g.pluggedKey() === null); i++) { g.advanceBaseTick(); op.step(); }
  expect(g.pluggedKey()).toBeNull();
  return g;
}

describe("save/load v2", () => {
  it("is plain JSON, versioned, with no micro-state", () => {
    const g = new Game({ seed: 3 });
    run(g, 10);
    const save = g.toSave();
    expect(save.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(4);
    const text = JSON.stringify(save);
    expect(JSON.parse(text)).toEqual(save);
    expect(text).not.toMatch(/"(regs|ram|pipeline|program|registers)"/i);
    expect(text.length).toBeLessThan(5000);
  });

  it("round-trips a bare machine (nothing installed yet): inventory, cables, tray, progress", () => {
    const g = new Game({ seed: 4 });
    g.install("inv1");
    g.install("inv2");
    g.connectCable("atx");
    const l = Game.fromSave(json(g.toSave()));
    expect(l.toSave()).toEqual(g.toSave());
    const s = l.snapshot();
    expect(s.inventory.map((i) => i.spec)).toEqual(["ram0", "display0", "cooler0"]);
    expect(s.cables.find((c) => c.id === "atx")!.connected).toBe(true);
    expect(s.progress).toMatchObject({ cpuInstalled: true, psuInstalled: true, atxConnected: true, poweredOn: false });
    expect(s.tray).toHaveLength(1);
    expect(s.phase).toBe("off");
  });

  it("round-trips an assembled, played game and keeps its config", () => {
    const g = new Game({ seed: 5 });
    g.money = 1000;
    g.purchase("cooler1");
    play(g, 300, 1);
    g.setCpuClock(0.5);
    const l = Game.fromSave(json(g.toSave()));
    const a = g.toSave();
    expect(l.toSave()).toEqual({ ...a, plugged: l.toSave().plugged });
    expect(l.money).toBe(g.money);
    expect(l.baseTick).toBe(g.baseTick);
    expect(l.board).toEqual(g.board);
    expect(l.snapshot().cpuClock).toEqual(g.snapshot().cpuClock);
  });

  it("loads powered off whatever it was doing, with the tray, the inventory and the plugged key kept", () => {
    const g = new Game({ seed: 6, economy: { baseDemandPerTick: 0.3 } });
    const op = new Operator(g, 0);
    for (let t = 0; t < 120; t++) { g.advanceBaseTick(); op.step(); }
    g.money = 500;
    g.purchase("ram1");
    for (let i = 0; i < 600; i++) {
      g.advanceBaseTick();
      if (g.pluggedKey() && g.currentPhase() === "running") break;
      op.step();
    }
    expect(g.currentPhase()).toBe("running");
    const was = g.snapshot();
    const l = Game.fromSave(json(g.toSave()), { baseDemandPerTick: 0.3 });
    const s = l.snapshot();
    expect(s).toMatchObject({ powered: false, phase: "off", display: "", money: was.money, queueLength: was.queueLength });
    expect(s.plugged!.id).toBe(was.plugged!.id);
    expect(s.plugged!.done).toBe(false);
    expect(s.inventory.map((i) => i.spec)).toEqual(was.inventory.map((i) => i.spec));
    expect(s.tray.map((k) => k.id)).toEqual(was.tray.map((k) => k.id));
    // The job restarts from boot: power on and it completes, the key still plugged.
    l.powerButton();
    const seen = new Set<string>();
    for (let i = 0; i < 400 && l.currentPhase() !== "halted"; i++) { l.advanceBaseTick(); seen.add(l.currentPhase()); }
    expect([...seen]).toEqual(expect.arrayContaining(["posting", "loading", "running"]));
    expect(l.ejectKey()).toMatchObject({ ok: true, done: true });
  });

  it("a finished key waiting to be removed stays finished across a save", () => {
    const g = new Game({ seed: 2, preassembled: true, economy: { baseDemandPerTick: 0 } });
    g.powerButton();
    g.plugKey(g.trayKeyIds()[0]!);
    g.powerButton();
    while (g.currentPhase() !== "halted") g.advanceBaseTick();
    const l = Game.fromSave(json(g.toSave()), { baseDemandPerTick: 0 });
    expect(l.snapshot().plugged).toMatchObject({ done: true, result: g.snapshot().plugged!.result });
    expect(l.ejectKey()).toMatchObject({ ok: true, done: true });
    expect(l.money).toBeGreaterThan(0);
  });

  it("exactly matches an uninterrupted run when saved while idle (and powered off first is not needed: load powers off)", () => {
    // Saved between jobs, powered on and waiting for a key. A load boots the machine again, so both sides power-cycle
    // here; everything below must then match exactly: money, tick, counters, reputation, tray, PRNG, parts.
    for (const seed of [1, 2, 7]) {
      const a = idleGame(seed, 150);
      const b = Game.fromSave(json(a.toSave()));
      a.powerButton(); a.powerButton(); // the same power cycle the loaded game goes through
      b.powerButton();
      expect(core(b)).toEqual(core(a));
      const oa = new Operator(a, 1);
      const ob = new Operator(b, 1);
      for (let i = 0; i < 500; i++) {
        a.advanceBaseTick(); oa.step();
        b.advanceBaseTick(); ob.step();
      }
      expect(core(b)).toEqual(core(a));
      expect(b.snapshot().display).toBe(a.snapshot().display);
    }
  });

  it("loading the same save twice gives identical runs (deterministic restart)", () => {
    const a = new Game({ seed: 4, economy: { baseDemandPerTick: 0 } });
    play(a, 70, 1);
    const save = json(a.toSave());
    const runIt = () => {
      const g = Game.fromSave(save, { baseDemandPerTick: 0 });
      g.powerButton();
      play(g, 150, 1);
      return core(g);
    };
    expect(runIt()).toEqual(runIt());
  });

  it("a loaded game keeps earning", () => {
    const a = new Game({ seed: 9 });
    play(a, 150, 1);
    const b = Game.fromSave(json(a.toSave()));
    const before = b.money;
    b.powerButton();
    play(b, 500, 1);
    expect(b.money).toBeGreaterThan(before);
    expect(b.completed).toBeGreaterThan(a.completed);
  });

  it("keeps a bought-but-uninstalled board and the installed one", () => {
    const a = new Game({ seed: 2, preassembled: true, economy: { baseDemandPerTick: 0.2, levelGating: false } });
    a.money = 500;
    a.powerButton(); // boards are installed while powered off
    expect(a.purchase("board1").ok).toBe(true);
    const b = Game.fromSave(json(a.toSave()), { baseDemandPerTick: 0.2 });
    expect(b.snapshot().inventory.map((i) => i.spec)).toEqual(["board1"]);
    expect(b.snapshot().boardTier).toBe(0);
    expect(b.install(b.snapshot().inventory[0]!.id).ok).toBe(true);
    const c = Game.fromSave(json(b.toSave()), { baseDemandPerTick: 0.2 });
    expect(c.snapshot().boardTier).toBe(1);
    expect(c.snapshot().devices.some((d) => d.spec === "psu0" && d.slot === "atx0")).toBe(true);
    expect(c.snapshot().inventory.map((i) => i.spec)).toEqual(["board0"]); // the Starter board it replaced is a spare
  });
});

describe("validation", () => {
  const good = () => json(new Game({ seed: 1 }).toSave()) as unknown as Record<string, unknown>;

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
    expect(() => Game.fromSave({ ...good(), inventory: [{ id: "inv1", spec: "nope" }] })).toThrow(/inventory/);
    expect(() => Game.fromSave({ ...good(), inventory: [{ id: "inv1", spec: "board9" }] })).toThrow(/inventory/);
    expect(() => Game.fromSave({ ...good(), cables: { atx: true } })).toThrow(/cables/);
    expect(() => Game.fromSave({ ...good(), progress: {} })).toThrow(/progress/);
    expect(() => Game.fromSave({ ...good(), tray: [{ id: 1, template: "bogus", seed: 1, scale: 1, arrival: 0, deadline: 1 }] })).toThrow(/template/);
    const noTray = good();
    delete noTray.tray;
    expect(() => Game.fromSave(noTray)).toThrow(/tray/);
  });
});

/** A version 1 save as the previous build wrote it: assembled machine, a request in flight, two queued, a purchase pending. */
const V1 = {
  version: 1,
  seed: 11,
  prngState: 123456789,
  money: 321,
  baseTick: 500,
  nextReqId: 9,
  completed: 7,
  errors: 1,
  dropped: 2,
  avgTurnaround: 80,
  lastCompleted: { id: 6, template: "cli.calc", payout: 61, turnaround: 70, execTicks: 40, late: false, attempts: 1, completedAt: 480 },
  board: {
    tier: 0,
    nextId: 7,
    devices: [
      { id: "dev1", spec: "cpu1", slot: "cpu0", clock: 2 },
      { id: "dev2", spec: "ram0", slot: "dimm0", clock: 1 },
      { id: "dev3", spec: "display0", slot: "display0", clock: 1 },
      { id: "dev4", spec: "cooler1", slot: "cooler0" },
      { id: "dev6", spec: "psu1", slot: "atx0" },
    ],
  },
  pending: ["ram1"],
  queue: [
    { id: 8, template: "cli", seed: 777, scale: 1, arrival: 480, deadline: 600 },
    { id: 9, template: "cli.scan", seed: 4242, scale: 1, arrival: 490, deadline: 610 },
  ],
  current: { id: 7, template: "cli.log", seed: 99, scale: 1, arrival: 470, deadline: 590, startTick: 495, attempts: 2 },
  tripped: false,
};

describe("migration v1 -> v2", () => {
  it("turns an old save into a fully assembled, powered-off machine with its keys in the tray", () => {
    const l = Game.fromSave(json(V1));
    const s = l.snapshot();
    expect(s).toMatchObject({ powered: false, phase: "off", money: 321, baseTick: 500, completed: 7, dropped: 2, errors: 1, avgTurnaround: 80 });
    expect(s.devices.map((d) => d.spec).sort()).toEqual(["cooler1", "cpu1", "display0", "psu1", "ram0"]);
    expect(s.cables.filter((c) => c.id !== "lan").every((c) => c.connected)).toBe(true);
    expect(s.tray.map((k) => k.id)).toEqual([7, 8, 9]); // the in-flight request first, then the queue
    expect(s.plugged).toBeNull();
    expect(s.inventory.map((i) => i.spec)).toEqual(["ram1"]); // the purchase that was waiting for the next request
    expect(s.progress.poweredOn).toBe(true);
    // An existing player skips the tutorial: every milestone that existed in v1 is reached (the v3 storage/OS ones are not).
    const { storageInstalled, osInstalled, firstOsJob, ispBought, routerInstalled, lanConnected, linkUp, firstNetJob, ...legacy } = s.progress;
    expect([storageInstalled, osInstalled, firstOsJob]).toEqual([false, false, false]);
    expect(Object.values(legacy).every((v) => v)).toBe(true);
    expect(s.lastCompleted).toMatchObject({ id: 6, payout: 61 });
    expect(l.machine.prng.getState()).toBe(123456789);
    expect(s.cpuClock!.value).toBe(2);
  });

  it("produces a valid current save that round-trips, and the migrated game plays", () => {
    const m = migrate(json(V1)) as { version: number };
    expect(m.version).toBe(4);
    const l = Game.fromSave(json(V1));
    expect(Game.fromSave(json(l.toSave())).toSave()).toEqual(l.toSave());
    const op = new Operator(l, 1);
    for (let t = 0; t < 200; t++) { l.advanceBaseTick(); op.step(); }
    expect(l.completed).toBeGreaterThan(7);
    expect(l.snapshot().devices.some((d) => d.spec === "ram1")).toBe(true); // the bot installed the inventory part
  });

  it("rejects a damaged v1 save", () => {
    expect(() => Game.fromSave({ ...json(V1), queue: undefined })).toThrow(/version 1/);
    expect(() => Game.fromSave({ ...json(V1), pending: ["nope"] })).toThrow(/inventory/);
  });
});

describe("migrate", () => {
  it("is the identity for the current version", () => {
    const s = new Game({ seed: 1 }).toSave();
    expect(migrate(s)).toBe(s);
  });
});

/** A version 2 save as the previous build wrote it: an assembled machine mid-game, no storage, no OS, 12 milestones. */
function v2Save(): Record<string, unknown> {
  const g = new Game({ seed: 21, preassembled: true });
  play(g, 300, 1);
  const s = json(g.toSave()) as unknown as Record<string, unknown>;
  const { storageInstalled, osInstalled, firstOsJob, ...old } = s.progress as Record<string, boolean>;
  void storageInstalled; void osInstalled; void firstOsJob;
  delete s.os;
  return { ...s, version: 2, progress: old };
}

describe("migration v2 -> v3", () => {
  it("adds no OS and three false milestones; the machine keeps the reboot-per-job flow", () => {
    const v2 = v2Save();
    expect(v2.version).toBe(2);
    const m = migrate(json(v2)) as { version: number; os: unknown; progress: Record<string, boolean> };
    expect(m.version).toBe(4);
    expect(m.os).toBeNull();
    expect(m.progress).toMatchObject({ storageInstalled: false, osInstalled: false, firstOsJob: false, poweredOn: true });
    const l = Game.fromSave(json(v2));
    const s = l.snapshot();
    expect(s).toMatchObject({ powered: false, phase: "off", os: null, storage: [] });
    expect(s.money).toBe(v2.money);
    expect(s.devices.map((d) => d.spec).sort()).toEqual(g2specs(v2));
    expect(l.toSave().version).toBe(4);
  });

  it("loads, boots and earns money exactly as a fresh v3 save of the same game would", () => {
    const v2 = v2Save();
    const a = Game.fromSave(json(v2));
    const b = Game.fromSave(json(migrate(json(v2))));
    for (const g of [a, b]) { g.powerButton(); play(g, 400, 1); }
    expect(a.money).toBe(b.money);
    expect(a.completed).toBeGreaterThan((v2.completed as number));
    expect(JSON.stringify(a.toSave())).toBe(JSON.stringify(b.toSave()));
  });

  it("rejects a damaged v2 save", () => {
    expect(() => Game.fromSave({ ...json(v2Save()), progress: undefined })).toThrow(/version 2/);
  });
});

function g2specs(v2: Record<string, unknown>): string[] {
  return ((v2.board as { devices: { spec: string }[] }).devices).map((d) => d.spec).sort();
}

/** A version 3 save as the previous build wrote it: the old tier numbering (0 = 2 DIMM board, 1 = ATX+ board). */
function v3Save(oldTier: number, inventory: { id: string; spec: string }[] = []): Record<string, unknown> {
  const g = new Game({ seed: 31, preassembled: true });
  play(g, 100, 1);
  const s = json(g.toSave()) as unknown as Record<string, unknown>;
  return { ...s, version: 3, board: { ...(s.board as object), tier: oldTier }, inventory };
}

describe("migration v3 -> v4", () => {
  it("maps old tier 0 to Basic, old tier 1 to Mainstream, and shifts board ids in the inventory", () => {
    const a = migrate(json(v3Save(0, [{ id: "inv1", spec: "board1" }]))) as { version: number; board: { tier: number }; inventory: { spec: string }[] };
    expect(a.version).toBe(4);
    expect(a.board.tier).toBe(1);
    expect(a.inventory.map((i) => i.spec)).toEqual(["board2"]);
    const b = migrate(json(v3Save(1))) as { board: { tier: number } };
    expect(b.board.tier).toBe(2);
  });

  it("loads with the installed parts valid, powered off, on the new tier", () => {
    const l = Game.fromSave(json(v3Save(0, [{ id: "inv1", spec: "board1" }])));
    const s = l.snapshot();
    expect(s).toMatchObject({ boardTier: 1, powered: false });
    expect(s.board.name).toBe("Basic");
    expect(s.board.burnt).toBe(false);
    expect(s.inventory.map((i) => i.spec)).toEqual(["board2"]);
    expect(l.toSave().version).toBe(4);
  });
});

describe("coolerInstalled in older saves", () => {
  it("is derived from the board: a current-shape save without the flag loads with it true when a cooler is mounted", () => {
    const save = json(new Game({ seed: 2, preassembled: true }).toSave()) as unknown as { progress: Record<string, unknown> };
    delete save.progress.coolerInstalled;
    const l = Game.fromSave(save);
    expect(l.snapshot().progress.coolerInstalled).toBe(true);
    expect(l.snapshot().devices.some((d) => d.kind === "cooler")).toBe(true);
  });

  it("is false when the loaded board has no cooler, and v1 saves have it", () => {
    const g = new Game({ seed: 2 });
    g.install("inv1");
    const save = json(g.toSave()) as unknown as { progress: Record<string, unknown> };
    delete save.progress.coolerInstalled;
    expect(Game.fromSave(save).snapshot().progress.coolerInstalled).toBe(false);
    expect(Game.fromSave(json(V1)).snapshot().progress.coolerInstalled).toBe(true);
  });
});

describe("pcie power lead in saves (additive, no version bump)", () => {
  it("a save from before the accelerators loads with the lead unplugged; a plugged lead survives", () => {
    const save = JSON.parse(JSON.stringify(new Game({ seed: 9 }).toSave()));
    expect(save.cables.pcie).toBe(false);
    delete save.cables.pcie;
    expect(parseSave(save).cables.pcie).toBe(false);
    save.cables.pcie = true;
    expect(parseSave(save).cables.pcie).toBe(true);
  });
});

describe("fan cables in saves", () => {
  it("a new machine has them unplugged and a save keeps that; a save from before them reads them plugged", () => {
    const g = new Game({ seed: 3 });
    const save = json(g.toSave());
    expect(save.cables["fan:front0"]).toBe(false);
    expect(Game.fromSave(save).snapshot().cables.find((c) => c.id === "fan:front0")!.connected).toBe(false);
    const old = json(g.toSave()) as { cables: Record<string, boolean> };
    for (const k of Object.keys(old.cables)) if (k === "sysfan" || k === "cpufan" || k.startsWith("fan:")) delete old.cables[k];
    const l = Game.fromSave(parseSave(old));
    expect(l.snapshot().cables.find((c) => c.id === "sysfan")!.connected).toBe(true);
    expect(l.snapshot().cables.find((c) => c.id === "fan:front1")!.connected).toBe(true);
  });
});
