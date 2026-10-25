import { describe, expect, it } from "vitest";
import { Prng } from "../machine";
import { Game } from "../game/game";
import { Operator, play } from "../game/operator";
import { parseSave } from "../game/save";
import {
  BOARD_TIERS, boardSlots, createBoard, findDevices, install, setClock, ThermalModel, upgradeBoard, type Board,
} from "./index";
import { ECONOMY } from "../game/economy";

// These tests are about hardware, not player levels: every item is buyable (levels have their own tests in levels.test.ts).
ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

function ok<T extends { ok: boolean }>(r: T): T {
  expect(r.ok).toBe(true);
  return r;
}

/** A board of `tier` with the parts installed and the CPU at `clock` (null = base). */
function rig(tier: number, cpu: string, o: { clock?: number; cooler?: string; sink?: string; psu?: string } = {}): Board {
  const b = createBoard(tier);
  for (const s of [cpu, "ram0", "display0", o.cooler ?? "cooler1", o.psu ?? (tier >= 2 ? "psu2" : "psu1")]) ok(install(b, s));
  if (o.sink) ok(install(b, o.sink));
  if (o.clock) ok(setClock(b, findDevices(b, "cpu")[0]!.id, o.clock));
  return b;
}

interface Trace { th: ThermalModel; maxT: number; maxRatio: number; unstableAt: number; throttleAt: number; burnAt: number; hits: number }

function run(b: Board, ticks: number, load = 1, seed = 1): Trace {
  const th = new ThermalModel(new Prng(seed));
  const t: Trace = { th, maxT: 0, maxRatio: 0, unstableAt: -1, throttleAt: -1, burnAt: -1, hits: 0 };
  for (let k = 0; k < ticks; k++) {
    th.step(b, { cpu: load });
    t.maxT = Math.max(t.maxT, th.vrm.tempC);
    t.maxRatio = Math.max(t.maxRatio, th.vrm.loadRatio);
    if (th.vrm.unstable && t.unstableAt < 0) t.unstableAt = k;
    if (th.vrm.throttle < 1 && t.throttleAt < 0) t.throttleAt = k;
    if (b.burnt && t.burnAt < 0) t.burnAt = k;
    if (th.vrmErrorRoll()) t.hits++;
  }
  return t;
}

describe("board tier ladder", () => {
  it("has four tiers with growing slot counts; slots a tier lacks are absent", () => {
    expect(BOARD_TIERS.map((t) => t.name)).toEqual(["Starter", "Basic", "Mainstream", "Enthusiast"]);
    const count = (tier: number, type: string) => boardSlots(createBoard(tier)).filter((s) => s.type === type).length;
    // Starter: 1 CPU socket, ONE DIMM, 2 SATA, 1 USB, 1 display, one PCIe (a network card), no M.2, ATX power.
    expect(["cpu", "dimm", "sata", "usb", "display", "pcie", "m2", "atx", "atx-plus", "vrm-sink", "ram-sink"].map((s) => count(0, s))).toEqual([1, 1, 2, 1, 1, 1, 0, 1, 0, 1, 1]);
    expect([1, 2, 3].map((t) => count(t, "dimm"))).toEqual([2, 4, 8]);
    expect([0, 1, 2, 3].map((t) => count(t, "pcie"))).toEqual([1, 2, 3, 4]);
    expect([0, 1, 2, 3].map((t) => count(t, "sata"))).toEqual([2, 3, 4, 8]);
    expect([0, 1, 2, 3].map((t) => count(t, "m2"))).toEqual([0, 0, 2, 3]);
    expect([0, 1, 2, 3].map((t) => count(t, "usb"))).toEqual([1, 2, 3, 4]);
    expect([0, 1, 2, 3].map((t) => BOARD_TIERS[t]!.features.ethernetMbps)).toEqual([0, 100, 100, 1000]);
    for (const t of BOARD_TIERS) expect(t.features.usbPorts).toBe(count(t.tier, "usb"));
    const vrmAmps = BOARD_TIERS.map((t) => t.vrm.phases * t.vrm.ampsPerPhase);
    expect([...vrmAmps].sort((a, b) => a - b)).toEqual(vrmAmps); // VRM strength grows with the tier
  });

  it("carries installed devices over on a board purchase", () => {
    const b = rig(0, "cpu0");
    const ids = b.devices.map((d) => d.id);
    ok(upgradeBoard(b, 1));
    expect(b.devices.map((d) => d.id)).toEqual(ids);
    ok(upgradeBoard(b, 3));
    expect(b.devices.map((d) => d.id)).toEqual(ids);
    expect(b.tier).toBe(3);
  });
});

describe("VRM under normal use", () => {
  it("a stock CPU never throttles, destabilises or burns the VRM on its tier's board or any better one", () => {
    const minTier: Record<string, number> = { cpu0: 0, cpu1: 0, cpu2: 2 };
    for (const cpu of ["cpu0", "cpu1", "cpu2"]) {
      for (let tier = minTier[cpu]!; tier < 4; tier++) {
        const r = run(rig(tier, cpu), 600);
        const label = `${cpu} on tier ${tier}`;
        expect(r.maxRatio, label).toBeLessThan(1);
        expect(r.maxT, label).toBeLessThan(BOARD_TIERS[tier]!.vrm.throttleC);
        expect(r.unstableAt, label).toBe(-1);
        expect(r.burnAt, label).toBe(-1);
      }
    }
  });

  it("idle stays cool, with a small loss", () => {
    const r = run(rig(2, "cpu2"), 600, 0.1);
    expect(r.maxT).toBeLessThan(35);
    expect(r.th.vrm.heatW).toBeLessThan(2);
  });

  it("the VRM loss is drawn from the PSU", () => {
    const b = rig(1, "cpu1");
    const r = run(b, 5);
    const parts = [...r.th.devices.values()].reduce((s, d) => s + d.powerW, 0);
    expect(r.th.power.vrmLossW).toBeGreaterThan(1);
    expect(r.th.power.totalW).toBeCloseTo(parts + r.th.power.vrmLossW, 6);
    // A weaker VRM wastes more: the same CPU costs more watts on the Starter board than on the Enthusiast one.
    const weak = run(rig(0, "cpu1"), 5).th.power.totalW;
    const strong = run(rig(3, "cpu1"), 5).th.power.totalW;
    expect(weak).toBeGreaterThan(strong);
  });

  it("a healthy VRM leaves the PRNG stream untouched", () => {
    const prng = new Prng(9);
    const th = new ThermalModel(prng);
    const b = rig(2, "cpu2");
    for (let k = 0; k < 100; k++) { th.step(b); expect(th.vrmErrorRoll()).toBe(false); }
    expect(prng.getState()).toBe(new Prng(9).getState());
  });
});

describe("VRM trouble", () => {
  it("a high-tier CPU on the Starter board is capped and crashes, the same CPU on a strong board is fine", () => {
    const weak = run(rig(0, "cpu2"), 1000);
    expect(weak.maxRatio).toBeGreaterThan(1.3);
    expect(weak.unstableAt).toBe(0);
    expect(weak.throttleAt).toBeGreaterThan(0); // it heats until the VRM trims the CPU clock
    expect(weak.hits).toBeGreaterThan(5);
    const strong = run(rig(2, "cpu2"), 1000);
    expect(strong.unstableAt).toBe(-1);
    expect(strong.hits).toBe(0);
  });

  it("the VRM throttle multiplies into the CPU clock", () => {
    const b = rig(0, "cpu2", { cooler: "cooler2" });
    const r = run(b, 90); // throttled, not yet burnt
    const cpu = r.th.state(findDevices(b, "cpu")[0]!.id)!;
    expect(r.th.vrm.throttle).toBeLessThan(1);
    expect(r.th.vrm.throttle).toBeGreaterThanOrEqual(0.8);
    expect(cpu.effClock).toBeLessThan(3 * r.th.vrm.throttle + 1e-9); // trimmed by the VRM factor // cpu2 base clock 3, trimmed by the VRM
  });

  it("overclocking a weak board: stable but warm, then throttled, crashing, then burnt", () => {
    const a = run(rig(0, "cpu1", { cooler: "cooler2", clock: 2.1 }), 400);
    expect(a.unstableAt).toBe(-1);
    expect(a.maxT).toBeGreaterThan(55); // heated well beyond stock
    expect(a.maxT).toBeLessThan(BOARD_TIERS[0]!.vrm.throttleC);
    const b = run(rig(0, "cpu1", { cooler: "cooler2", clock: 2.3 }), 400);
    expect(b.throttleAt).toBeGreaterThan(0);
    expect(b.unstableAt).toBe(0);
    expect(b.hits).toBeGreaterThan(0);
    expect(b.burnAt).toBeGreaterThan(b.throttleAt); // sustained overload while hot kills it
    // A cpu2 on the Starter board with a liquid cooler (no airflow over the VRM) cooks it.
    const board = rig(0, "cpu2", { cooler: "cooler2" });
    const c = run(board, 800);
    expect(c.throttleAt).toBeGreaterThan(0);
    expect(c.burnAt).toBeGreaterThan(c.throttleAt);
    expect(board.burnt).toBe(true);
    const th = c.th;
    th.step(board);
    expect(th.power.totalW).toBe(0); // a dead board draws nothing
    expect(th.state(findDevices(board, "cpu")[0]!.id)!.effClock).toBe(0);
  });

  it("an overload past 1.6 burns the board quickly", () => {
    const r = run(rig(0, "cpu1", { cooler: "cooler2", clock: 2.6 }), 100);
    expect(r.maxRatio).toBeGreaterThan(1.5);
    expect(r.unstableAt).toBe(0);
  });
});

describe("VRM cooling", () => {
  it("heatsink tiers delay the throttle", () => {
    const at = (sink?: string) => run(rig(0, "cpu1", { cooler: "cooler2", clock: 2.3, sink }), 600).throttleAt;
    const none = at();
    const t0 = at("vsink0");
    const t1 = at("vsink1");
    const t2 = at("vsink2");
    expect(none).toBeGreaterThan(0);
    const later = (x: number, y: number) => x === -1 || x > y; // -1 = never
    expect(later(t0, none)).toBe(true);
    expect(later(t1, t0)).toBe(true);
    expect(later(t2, t1)).toBe(true);
    expect(t2).toBe(-1);
  });

  it("a heatsink keeps a cooked board alive; the fan version draws power", () => {
    const burn = (sink?: string) => run(rig(0, "cpu2", { cooler: "cooler2", sink }), 800).burnAt;
    expect(burn()).toBeGreaterThan(0);
    expect(burn("vsink2")).toBe(-1);
    const withFan = run(rig(1, "cpu1", { sink: "vsink2" }), 5).th;
    const without = run(rig(1, "cpu1"), 5).th;
    expect(withFan.power.totalW).toBeGreaterThan(without.power.totalW);
  });

  it("an air cooler also cools the VRM, a liquid cooler does not", () => {
    const peak = (cooler: string) => run(rig(0, "cpu1", { cooler, clock: 2.1 }), 600).maxT;
    const stock = peak("cooler0");
    const tower = peak("cooler1");
    const liquid = peak("cooler2");
    expect(tower).toBeLessThan(stock);
    expect(liquid).toBeGreaterThan(stock);
    // The liquid loop is the better CPU cooler, yet the VRM runs hotter: VRM cooling matters more with it.
    const cpuT = (cooler: string) => {
      const b = rig(0, "cpu1", { cooler, clock: 2.1 });
      const r = run(b, 600);
      return r.th.state(findDevices(b, "cpu")[0]!.id)!.tempC;
    };
    expect(cpuT("cooler2")).toBeLessThan(cpuT("cooler1"));
  });
});

describe("the game around the VRM", () => {
  const busy = { baseDemandPerTick: 1, queueCap: 10, coldBootTicks: 0, startQueue: [{ template: "cli.log" }] };

  /** Preassembled Starter game with a cpu2 and a 100 W PSU (and optionally a liquid cooler), bot-assembled. */
  function weakGame(liquid: boolean, seed = 5): { g: Game; op: Operator } {
    const g = new Game({ seed, preassembled: true, economy: busy });
    g.money = 1e6;
    g.powerButton();
    for (const id of ["psu1", "cpu2", ...(liquid ? ["cooler2"] : [])]) ok(g.purchase(id));
    const op = new Operator(g, 0);
    op.assemble();
    return { g, op };
  }

  it("a CPU too big for the Starter VRM crashes the machine with a VRM reason in the log", () => {
    const { g, op } = weakGame(false);
    for (let t = 0; t < 500 && g.errors === 0; t++) { g.advanceBaseTick(); op.step(); }
    expect(g.errors).toBeGreaterThan(0);
    const s = g.snapshot();
    expect(s.log.some((e) => e.kind === "fault" && /VRM voltage droop/.test(e.text))).toBe(true);
    expect(s.board.vrm.unstable).toBe(true);
    expect(s.board.vrm.loadRatio).toBeGreaterThan(1);
  });

  it("a burnt board is dead until replaced: no power, parts stay, the flag is saved, a board purchase carries the parts over", () => {
    const { g, op } = weakGame(true);
    for (let t = 0; t < 1500 && !g.board.burnt; t++) { g.advanceBaseTick(); op.step(); }
    expect(g.board.burnt).toBe(true);
    const s = g.snapshot();
    expect(s).toMatchObject({ phase: "error", phaseReason: "board dead: replace the board" });
    expect(s.board).toMatchObject({ burnt: true, name: "Starter" });
    expect(s.board.vrm.burnt).toBe(true);
    expect(s.log.some((e) => /board dead/.test(e.text))).toBe(true);
    // Replacement: the same tier is offered while the board is burnt; purchase needs the power off.
    expect(g.purchase("board0")).toMatchObject({ ok: false, reason: expect.stringMatching(/powered off required/) });
    expect(s.purchases.find((p) => p.id === "board0")!.blocked).toMatch(/powered off required/);
    g.powerButton();
    expect(g.powerButton()).toMatchObject({ ok: false, reason: expect.stringMatching(/board dead/) });
    // The flag survives a save; temperatures do not.
    const saved = JSON.parse(JSON.stringify(g.toSave()));
    expect(saved.board.burnt).toBe(true);
    const l = Game.fromSave(saved, busy);
    expect(l.snapshot().board.burnt).toBe(true);
    expect(l.powerButton().ok).toBe(false);
    // Buy a board of the same tier: devices carry over, the dead board is gone.
    g.money = 1000;
    const specs = g.snapshot().devices.map((d) => d.spec).sort();
    const buy = ok(g.purchase("board0")) as { invId: string };
    expect(ok(g.install(buy.invId)).ok).toBe(true);
    const after = g.snapshot();
    expect(after.board.burnt).toBe(false);
    expect(after.devices.map((d) => d.spec).sort()).toEqual(specs);
    expect(g.powerButton().ok).toBe(true);
  });

  it("a board can be bought only while powered off", () => {
    const g = new Game({ seed: 1, preassembled: true });
    g.money = 1000;
    expect(g.snapshot().purchases.find((p) => p.id === "board1")!.blocked).toMatch(/powered off required/);
    expect(g.purchase("board1")).toMatchObject({ ok: false, reason: expect.stringMatching(/powered off required/) });
    g.powerButton();
    expect(g.snapshot().purchases.find((p) => p.id === "board1")!.blocked).toBeUndefined();
    expect(g.purchase("board1").ok).toBe(true);
  });

  it("the snapshot describes the board, its features, only the slots it has, the VRM and the heatsink", () => {
    const g = new Game({ seed: 1 });
    const s = g.snapshot();
    expect(s.board).toMatchObject({ tier: 0, name: "Starter", burnt: false, features: { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 } });
    expect(s.board.slots.map((x) => x.type).sort()).toEqual(["atx", "cooler", "cpu", "dimm", "display", "pcie", "ram-sink", "sata", "sata", "usb", "vrm-sink"]);
    expect(s.board.slots).toEqual(s.slots);
    expect(s.board.vrm).toMatchObject({ phases: 2, ampsPerPhase: 12, burnt: false, sinkDeviceId: null });
    expect(s.board.vrmSink).toBeNull();
    const p = s.purchases.find((x) => x.id === "vsink0")!;
    expect(p).toMatchObject({ kind: "vrm-sink", price: 30 });
  });

  it("a bought VRM heatsink installs into the vrm-sink slot and shows in the snapshot", () => {
    const g = new Game({ seed: 1, preassembled: true });
    g.money = 1000;
    g.powerButton();
    const b = ok(g.purchase("vsink1")) as { invId: string };
    ok(g.install(b.invId));
    const s = g.snapshot();
    expect(s.board.vrmSink).toMatchObject({ spec: "vsink1", slot: "vrm-sink0", kind: "vrm-sink" });
    expect(s.board.vrm.sinkDeviceId).toBe(s.board.vrmSink!.id);
    expect(s.purchases.find((x) => x.id === "vsink0")).toBeUndefined(); // only better tiers are offered
    expect(s.purchases.find((x) => x.id === "vsink2")).toBeDefined();
  });

  it("is deterministic under VRM trouble, and the burnt flag survives parseSave", () => {
    const snap = () => {
      const { g, op } = weakGame(false, 11);
      for (let t = 0; t < 300; t++) { g.advanceBaseTick(); op.step(); }
      return JSON.stringify([g.snapshot().board, g.errors, g.money, g.machine.prng.getState()]);
    };
    expect(snap()).toBe(snap());
    const g = new Game({ seed: 3, preassembled: true });
    g.board.burnt = true;
    expect(parseSave(JSON.parse(JSON.stringify(g.toSave()))).board.burnt).toBe(true);
  });

  it("play() still earns money on the Starter board with the starter parts (VRM never interferes)", () => {
    const g = new Game({ seed: 2, preassembled: true });
    play(g, 600, 1);
    expect(g.completed).toBeGreaterThan(2);
    expect(g.errors).toBe(0);
    expect(g.snapshot().board.vrm.unstable).toBe(false);
  });
});

void findDevices;
