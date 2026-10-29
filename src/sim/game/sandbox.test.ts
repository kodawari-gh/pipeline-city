import { describe, expect, it } from "vitest";
import { advance, handleMessage, newHost } from "../host";
import type { FromSim, Snapshot } from "../protocol";
import { SANDBOX_MONEY } from "./economy";
import { Game } from "./game";
import { play } from "./operator";
import { parseSave } from "./save";
import { econ } from "./testkit";

const sb = (o: { preassembled?: boolean; seed?: number } = {}) => new Game({ seed: o.seed ?? 3, sandbox: true, preassembled: o.preassembled, economy: econ() });
const buy = (g: Game, id: string): string => {
  const r = g.purchase(id);
  if (!r.ok) throw new Error(`${id}: ${r.reason}`);
  return r.invId;
};

describe("sandbox start", () => {
  it("is flagged, rich, tutorial-free and powered off", () => {
    const g = sb({ preassembled: true });
    const s = g.snapshot();
    expect(s.sandbox).toBe(true);
    expect(s.money).toBe(SANDBOX_MONEY);
    expect(Object.values(s.progress).every(Boolean)).toBe(true);
    expect(s.powered).toBe(false);
    expect(s.devices.length).toBe(5);
    expect(g.powerButton().ok).toBe(true);
  });
  it("bare keeps the starter crate", () => {
    const s = sb().snapshot();
    expect(s.devices.length).toBe(0);
    expect(s.inventory.map((i) => i.spec)).toEqual(["cpu0", "psu0", "ram0", "display0", "cooler0"]);
  });
  it("campaign is unchanged", () => {
    const g = new Game({ seed: 3, economy: econ() });
    const s = g.snapshot();
    expect(s.sandbox).toBe(false);
    expect(s.money).toBe(0);
    expect(Object.values(s.progress).some(Boolean)).toBe(false);
    expect("sandbox" in g.toSave()).toBe(false);
    expect(g.purchase("cpu1").ok).toBe(false);
    expect(g.purchase("board3").ok).toBe(false);
    expect(s.purchases.every((p) => p.price > 0)).toBe(true);
    expect(new Game({ seed: 3, preassembled: true }).powered).toBe(true);
  });
});

describe("sandbox purchases", () => {
  it("are free and money never changes", () => {
    const g = sb({ preassembled: true });
    for (const id of ["cooler2", "ram2", "vsink2", "hdd0"]) buy(g, id);
    expect(g.snapshot().money).toBe(SANDBOX_MONEY);
    expect(g.snapshot().purchases.every((p) => p.price === 0 && p.affordable)).toBe(true);
  });
  it("offer every spec and any board tier directly, with carry-over", () => {
    const g = sb({ preassembled: true });
    const ids = g.snapshot().purchases.map((p) => p.id);
    for (const id of ["cpu0", "cpu2", "ram0", "psu1", "cooler0", "vsink0", "board1", "board2", "board3", "hdd0", "ssd1", "nvme2", "os1"]) expect(ids).toContain(id);
    expect(ids).toContain("os4");
    const before = g.board.devices.map((d) => d.id);
    g.install(buy(g, "board3"));
    expect(g.board.tier).toBe(3);
    expect(g.board.devices.map((d) => d.id)).toEqual(before);
  });
  it("physics still refuses at the install, not at the till: PSU watts, missing slot, powered-on install", () => {
    const g = sb({ preassembled: true });
    const spare = (id: string) => g.snapshot().inventory.find((i) => i.id === id)!;
    const cpu = buy(g, "cpu2"), nvme = buy(g, "nvme2"), psu = buy(g, "psu2");
    expect(spare(cpu).installable).toBe(false); // the 40 W PSU cannot feed it
    expect(spare(nvme)).toMatchObject({ installable: false, reason: expect.stringMatching(/m2/) }); // the Starter board has no M.2
    expect(spare(psu).installable).toBe(false); // needs the ATX+ connector
    g.install(buy(g, "board3"));
    expect(spare(psu).installable).toBe(true); // the big board has it
    const inv = buy(g, "cooler1");
    g.powerButton();
    expect(g.install(inv)).toMatchObject({ ok: false, reason: "power the machine off first" });
    expect(g.purchase("board2").ok).toBe(true); // a smaller board is a spare, or a downgrade
  });
  it("an OS still needs a drive to install on", () => {
    const g = sb({ preassembled: true });
    const os = g.purchase("os1") as { invId: string };
    expect(os.invId).toBeTruthy();
    expect(g.snapshot().inventory.find((i) => i.id === os.invId)).toMatchObject({ installable: false, reason: expect.stringMatching(/storage drive/) });
  });
});

describe("sandbox tools", () => {
  it("spawnKey adds keys of every template, clearQueue empties the tray", () => {
    const g = sb();
    for (const t of ["cli", "cli.log", "cli.calc", "cli.checksum", "cli.scan"]) expect(g.spawnKey(t, 2).ok).toBe(true);
    expect(g.trayKeyIds().length).toBe(6);
    expect(g.spawnKey("nope").ok).toBe(false);
    expect(g.spawnKey("cli", 99).ok).toBe(false);
    expect(g.spawnKey("constructor").ok).toBe(false);
    for (let i = 0; i < 4; i++) g.spawnKey("cli");
    expect(g.spawnKey("cli").ok).toBe(false);
    expect(g.clearQueue()).toMatchObject({ ok: true, removed: 10 });
    expect(g.trayKeyIds().length).toBe(0);
  });
  it("setReputation clamps and shows exactly", () => {
    const g = sb();
    for (let i = 0; i < 200; i++) g.advanceBaseTick();
    expect(g.setReputation(2).ok).toBe(true);
    expect(g.snapshot().reputation).toBeCloseTo(2, 6);
    g.setReputation(100);
    expect(g.snapshot().reputation).toBe(g.cfg.repMax);
    g.setReputation(-1);
    expect(g.snapshot().reputation).toBe(g.cfg.repMin);
    expect(g.setReputation(NaN).ok).toBe(false);
  });
  it("are refused in a campaign game", () => {
    const g = new Game({ seed: 1, economy: econ() });
    for (const r of [g.spawnKey("cli"), g.clearQueue(), g.repairAll(), g.setReputation(2)]) expect(r).toEqual({ ok: false, reason: "sandbox mode only" });
    expect(g.trayKeyIds().length).toBe(1);
  });
  it("repairAll recovers a burnt part, a dead board and a tripped PSU", () => {
    const g = sb({ preassembled: true });
    g.powerButton();
    g.board.burnt = true;
    g.board.devices.find((d) => d.spec === "cpu0")!.burnt = true;
    g.thermal.power = { ...g.thermal.power, tripped: true };
    g.thermal.vrm.tempC = 200;
    expect(g.snapshot().phase).toBe("error");
    expect(g.repairAll()).toMatchObject({ ok: true, repaired: 2, tripCleared: true });
    const s = g.snapshot();
    expect(s.board.burnt).toBe(false);
    expect(s.devices.every((d) => !d.burnt)).toBe(true);
    expect(s.power.tripped).toBe(false);
    expect(s.board.vrm.tempC).toBe(25);
    expect(s.phase).not.toBe("error");
  });
});

describe("sandbox save", () => {
  it("round-trips the flag, and campaign saves are untouched", () => {
    const g = sb({ preassembled: true });
    buy(g, "board2");
    const save = JSON.parse(JSON.stringify(g.toSave()));
    expect(save.sandbox).toBe(true);
    expect(save.version).toBe(4);
    const g2 = Game.fromSave(parseSave(save), { baseDemandPerTick: 0 });
    expect(g2.sandbox).toBe(true);
    expect(g2.snapshot().money).toBe(SANDBOX_MONEY);
    expect(g2.purchase("cpu0").ok).toBe(true);
    expect(() => parseSave({ ...save, sandbox: "yes" })).toThrow(/sandbox/);
    const c = new Game({ seed: 1 });
    expect(Game.fromSave(JSON.parse(JSON.stringify(c.toSave()))).sandbox).toBe(false);
  });
  it("is deterministic", () => {
    const run = () => {
      const g = sb({ preassembled: true, seed: 9 });
      g.spawnKey("cli.scan", 2);
      g.powerButton();
      for (let i = 0; i < 300; i++) g.advanceBaseTick();
      return JSON.stringify(g.snapshot());
    };
    expect(run()).toBe(run());
  });
});

describe("sandbox host", () => {
  const snap = (r: FromSim[]): Snapshot => (r.find((m) => m.type === "snapshot") as Extract<FromSim, { type: "snapshot" }>).snapshot;
  it("starts a sandbox, runs the tools, allows 64x only there", () => {
    const h = newHost();
    handleMessage(h, { type: "init", seed: 1, sandbox: true, preassembled: true });
    expect(h.game!.sandbox).toBe(true);
    expect(snap(handleMessage(h, { type: "spawnKey", template: "cli.calc", scale: 3 })).tray.length).toBe(2);
    expect(snap(handleMessage(h, { type: "clearQueue" })).tray.length).toBe(0);
    expect(handleMessage(h, { type: "repairAll" }).map((m) => m.type)).toEqual(["snapshot"]);
    expect(snap(handleMessage(h, { type: "setReputation", value: 3 })).reputation).toBeCloseTo(3, 6);
    handleMessage(h, { type: "setSpeed", speed: 64 });
    expect(advance(h, 1000)).toBe(64);
    const c = newHost();
    handleMessage(c, { type: "init", seed: 1 });
    expect(handleMessage(c, { type: "setSpeed", speed: 64 })[0]!.type).toBe("error");
    expect(c.speed).toBe(1);
    expect(handleMessage(c, { type: "spawnKey", template: "cli" }).map((m) => m.type)).toEqual(["error", "snapshot"]);
  });
});

describe("sandbox high-end build", () => {
  it("builds the best machine in a few actions and runs jobs", () => {
    const g = new Game({ seed: 5, sandbox: true });
    for (const id of ["board3", "psu2", "cpu2", "ram2", "cooler2", "vsink2", "nvme2", "os1"]) buy(g, id);
    const op = play(g, 1, 0);
    op.assemble(false);
    expect(g.hasOs()).toBe(true);
    expect(g.board.tier).toBe(3);
    expect(g.missingCables()).toEqual([]);
    g.powerButton();
    for (let i = 0; i < 4; i++) g.spawnKey("cli");
    play(g, 4000, 0);
    expect(g.completed).toBeGreaterThan(5);
    expect(g.snapshot().board.burnt).toBe(false);
  }, 20_000); // a long run: the default 5 s timed out when the whole suite ran in parallel
});

describe("sandbox maxed machine", () => {
  const maxed = () => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true, economy: econ() });
  it("is the biggest case and board with the best part of every kind, every DIMM and M.2 slot filled, a router, a plan and the ethernet cable", () => {
    const g = maxed(), s = g.snapshot();
    expect(g.board.tier).toBe(3);
    expect(g.board.caseTier).toBe(3);
    const specs = s.devices.map((d) => d.spec).sort();
    expect(specs.filter((x) => x === "cpu4w")).toHaveLength(1);
    expect(specs.filter((x) => x === "ram5")).toHaveLength(8);
    expect(specs.filter((x) => x === "nvme2")).toHaveLength(3);
    for (const id of ["psu4", "cooler2", "vsink2", "rsink2", "nic3", "display0"]) expect(specs).toContain(id);
    expect(specs).not.toContain("cpu0");
    expect(specs).not.toContain("psu0");
    expect(specs).not.toContain("cooler0");
    expect(specs).not.toContain("ram0");
    expect(s.os?.spec ?? s.os).toBeTruthy();
    expect(s.net.router).toBeTruthy();
    expect(s.cables.every((c) => c.connected)).toBe(true);
    expect(s.powered).toBe(false);
    expect(s.log.length).toBe(0); // the build is not in the log
  });
  it("powers on, boots, and the link comes up", () => {
    const g = maxed();
    expect(g.powerButton().ok).toBe(true);
    for (let i = 0; i < 4000 && g.snapshot().net.state !== "link-up" && g.snapshot().net.state !== "saturated"; i++) g.advanceBaseTick();
    const s = g.snapshot();
    expect(["link-up", "saturated"]).toContain(s.net.state);
    expect(s.power.tripped).toBeFalsy();
    expect(s.phase).not.toBe("error");
    for (let i = 0; i < 1500; i++) g.advanceBaseTick(); // and it stays up: the 250 W supply and the liquid loop carry it
    expect(g.snapshot().power.tripped).toBeFalsy();
    expect(g.snapshot().phase).not.toBe("error");
  }, 30000);
  it("does not change the plain assembled sandbox machine", () => {
    expect(sb({ preassembled: true }).snapshot().devices.length).toBe(5);
  });
});
