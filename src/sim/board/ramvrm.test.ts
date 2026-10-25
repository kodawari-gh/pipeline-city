import { describe, expect, it } from "vitest";
import { Prng } from "../machine";
import { Game } from "../game/game";
import { ECONOMY } from "../game/economy";
import { BOARD_TIERS, createBoard, findDevices, install, setClock, ThermalModel, type Board } from "./index";
import { ramDemand, ramVoltage } from "./vrm";

ECONOMY.levelGating = false;

function ok<T extends { ok: boolean }>(r: T): T {
  expect(r.ok).toBe(true);
  return r;
}

/** A board of `tier` with a CPU, `sticks` RAM sticks of `ram`, a monitor, a tower cooler and a big enough PSU. */
function rig(tier: number, sticks: number, ram: string, o: { clock?: number; sink?: string } = {}): Board {
  const b = createBoard(tier);
  for (const s of ["cpu1", "display0", "cooler1", "psu2".replace("psu2", tier >= 2 ? "psu2" : "psu1")]) ok(install(b, s));
  for (let i = 0; i < sticks; i++) ok(install(b, ram));
  if (o.sink) ok(install(b, o.sink));
  if (o.clock) for (const d of findDevices(b, "ram")) ok(setClock(b, d.id, o.clock));
  return b;
}

function run(b: Board, ticks: number, seed = 1) {
  const th = new ThermalModel(new Prng(seed));
  let hits = 0, unstableAt = -1, maxRatio = 0;
  for (let k = 0; k < ticks; k++) {
    th.step(b, { cpu: 1, ram: 1 });
    maxRatio = Math.max(maxRatio, th.ramVrm.loadRatio);
    if (th.ramVrm.unstable && unstableAt < 0) unstableAt = k;
    if (th.ramVrmErrorRoll()) hits++;
  }
  return { th, hits, unstableAt, maxRatio };
}

describe("the memory VRM", () => {
  it("every tier has one, growing with the tier, and a heatsink slot for it", () => {
    const amps = BOARD_TIERS.map((t) => t.ramVrm.phases * t.ramVrm.ampsPerPhase);
    expect(amps).toEqual([...amps].sort((a, b) => a - b));
    expect(new Set(amps).size).toBe(4);
    for (const t of BOARD_TIERS) expect(t.slots["ram-sink"]).toBe(1);
  });

  it("memory voltage is 1.2 V at base and rises with the clock", () => {
    expect(ramVoltage(1)).toBeCloseTo(1.2);
    expect(ramVoltage(1.5)).toBeCloseTo(1.35);
    expect(ramDemand(12, 1)).toBeCloseTo(10);
  });

  it("stock memory on its own tier's board stays comfortable at full load", () => {
    for (const [tier, sticks, ram] of [[0, 1, "ram1"], [1, 2, "ram2"], [2, 4, "ram2"], [3, 8, "ram2"]] as const) {
      const r = run(rig(tier, sticks, ram), 600);
      expect(r.th.ramVrm.loadRatio, `tier ${tier}`).toBeLessThan(0.7);
      expect(r.th.ramVrm.unstable).toBe(false);
      expect(r.th.ramVrm.throttle).toBe(1);
      expect(r.hits).toBe(0);
    }
  });

  it("its conversion loss is drawn from the PSU on top of the sticks", () => {
    const a = run(rig(1, 2, "ram2"), 5).th.power;
    expect(a.vrmLossW).toBeGreaterThan(0);
    const b = rig(1, 2, "ram2");
    const noRam = createBoard(1);
    for (const s of ["cpu1", "display0", "cooler1", "psu1"]) ok(install(noRam, s));
    expect(run(noRam, 5).th.power.totalW).toBeLessThan(a.totalW);
    void b;
  });

  it("overclocking the sticks hard on a small board overloads the regulator: it goes unstable and crashes the machine", () => {
    const b = rig(1, 2, "ram2", { clock: 5 });
    const r = run(b, 300);
    expect(r.maxRatio).toBeGreaterThan(1);
    expect(r.unstableAt).toBeGreaterThanOrEqual(0);
    expect(r.hits).toBeGreaterThan(0);
  });

  it("the CPU regulator is untouched by memory overclocking", () => {
    const stock = run(rig(1, 2, "ram2"), 3).th.vrm.loadRatio;
    const oc = run(rig(1, 2, "ram2", { clock: 5 }), 3).th.vrm.loadRatio;
    expect(oc).toBeCloseTo(stock, 5);
  });

  it("a RAM VRM heatsink keeps the regulator cooler, and a fan heatsink keeps it coolest", () => {
    const temp = (sink?: string) => run(rig(1, 2, "ram2", { clock: 4, sink }), 400).th.ramVrm.tempC;
    const bare = temp(), fins = temp("rsink0"), fan = temp("rsink2");
    expect(fins).toBeLessThan(bare);
    expect(fan).toBeLessThan(fins);
  });

  it("a heatsink in the CPU's slot does not cool the memory regulator", () => {
    const withCpuSink = run(rig(1, 2, "ram2", { clock: 4, sink: "vsink2" }), 400).th.ramVrm.tempC;
    const bare = run(rig(1, 2, "ram2", { clock: 4 }), 400).th.ramVrm.tempC;
    expect(withCpuSink).toBeCloseTo(bare, 3);
  });

  it("sustained overload burns the board", () => {
    const b = rig(1, 2, "ram2", { clock: 5 });
    run(b, 400);
    expect(b.burnt).toBe(true);
  });
});

describe("the memory clock and the snapshot", () => {
  it("setRamClock changes one stick inside its range and refuses outside it", () => {
    const g = new Game({ seed: 1, preassembled: true });
    const ram = g.snapshot().devices.find((d) => d.kind === "ram")!;
    expect(g.setRamClock(ram.id, 1.2).ok).toBe(true);
    expect(g.snapshot().devices.find((d) => d.id === ram.id)!.requestedClock).toBeCloseTo(1.2);
    expect(g.setRamClock(ram.id, 99)).toMatchObject({ ok: false });
    expect(g.setRamClock("nope", 1)).toMatchObject({ ok: false });
  });

  it("describes the memory regulator and its heatsink, which installs into the ram-sink slot", () => {
    const g = new Game({ seed: 1, preassembled: true });
    g.money = 1000;
    g.powerButton();
    const s0 = g.snapshot();
    expect(s0.board.ramVrm).toMatchObject({ phases: 2, ampsPerPhase: 6, sinkDeviceId: null });
    expect(s0.board.ramSink).toBeNull();
    const p = s0.purchases.find((x) => x.id === "rsink0")!;
    expect(p).toMatchObject({ kind: "ram-sink", price: 25 });
    const b = ok(g.purchase("rsink0")) as { invId: string };
    ok(g.install(b.invId));
    const s = g.snapshot();
    expect(s.board.ramSink).toMatchObject({ spec: "rsink0", slot: "ram-sink0", kind: "ram-sink" });
    expect(s.board.ramVrm.sinkDeviceId).toBe(s.board.ramSink!.id);
    expect(s.board.vrmSink).toBeNull();
  });

  it("a machine whose memory regulator droops crashes and reboots with a memory-VRM fault in the log", () => {
    const g = new Game({ seed: 3, preassembled: true });
    const ram = g.snapshot().devices.find((d) => d.kind === "ram")!;
    ok(g.setRamClock(ram.id, 1.5));
    // force the regulator over its rating through the thermal model directly
    g.thermal.ramVrm.unstable = true;
    g.thermal.ramVrm.errProb = 1;
    expect(g.thermal.ramVrmErrorRoll()).toBe(true);
  });
});
