import { describe, expect, it } from "vitest";
import { assemble } from "../asm";
import { Machine, Prng } from "../machine";
import {
  applyEngine, applyRates, boardFromJson, boardToJson, createBoard, engineConfigFor, install, installedPsu,
  machineConfigFor, setClock, ThermalModel, uninstall, type Board,
} from "./index";

function ok<T extends { ok: boolean }>(r: T): T {
  expect(r.ok).toBe(true);
  return r;
}

function basicBoard(opts: { cpu?: string; cooler?: string; psu?: string } = {}): Board {
  const b = createBoard(0);
  ok(install(b, opts.cpu ?? "cpu0"));
  ok(install(b, "ram0"));
  ok(install(b, "display0"));
  ok(install(b, opts.cooler ?? "cooler0"));
  ok(install(b, opts.psu ?? "psu0"));
  return b;
}

const cpuId = (b: Board) => b.devices.find((d) => d.spec.startsWith("cpu"))!.id;
const dropCooler = (b: Board) => ok(uninstall(b, b.devices.find((d) => d.spec.startsWith("cooler"))!.id));

describe("slots and PSU validation", () => {
  it("installs into matching free slots", () => {
    const b = createBoard(0);
    expect(ok(install(b, "ram0"))).toMatchObject({ slot: "dimm0" });
    expect(ok(install(b, "ram0"))).toMatchObject({ slot: "dimm1" });
  });

  it("rejects wrong slot, no free slot, no such slot, unknown spec", () => {
    const b = createBoard(0);
    ok(install(b, "ram0", "dimm1"));
    const wrong = install(b, "ram0", "sata0");
    expect(!wrong.ok && wrong.reason).toMatch(/needs a dimm slot/);
    const used = install(b, "ram0", "dimm1");
    expect(!used.ok && used.reason).toMatch(/already used/);
    ok(install(b, "ram0"));
    const full = install(b, "ram0");
    expect(!full.ok && full.reason).toMatch(/no free dimm slot/);
    expect(install(b, "ram0", "nope").ok).toBe(false);
    expect(install(b, "bogus").ok).toBe(false);
    ok(install(b, "cpu0"));
    const second = install(b, "cpu1");
    expect(!second.ok && second.reason).toMatch(/no free cpu slot/);
    const noPcie = install(createBoard(0), "cpu0", "cpu0");
    expect(noPcie.ok).toBe(true);
  });

  it("PSU needs a matching connector", () => {
    const r = install(createBoard(0), "psu2");
    expect(!r.ok && r.reason).toMatch(/no atx-plus slot/);
    expect(install(createBoard(1), "psu2").ok).toBe(true);
    expect(install(createBoard(1), "psu0").ok).toBe(false);
  });

  it("PSU watts are checked both ways", () => {
    const b = createBoard(0);
    ok(install(b, "cpu1"));
    ok(install(b, "ram0"));
    ok(install(b, "display0"));
    ok(install(b, "psu0")); // rated 20 + 2 + 3 = 25 W <= 40
    ok(install(b, "ram2")); // 30 W
    ok(install(b, "cooler2")); // 36 W
    const over = install(createBoard(0), "ram2");
    expect(over.ok).toBe(true);
    const b2 = createBoard(0);
    ok(install(b2, "psu0"));
    ok(install(b2, "cpu2")); // 35 W
    const tooMuch = install(b2, "ram2"); // 40 W exactly: fits
    expect(tooMuch.ok).toBe(true);
    const full = install(b2, "display0"); // 43 W
    expect(!full.ok && full.reason).toMatch(/PSU gives 40 W/);
    const weak = createBoard(0);
    ok(install(weak, "cpu2"));
    ok(install(weak, "ram2"));
    ok(install(weak, "display0"));
    const small = install(weak, "psu0");
    expect(!small.ok && small.reason).toMatch(/gives 40 W but installed parts need 43 W/);
    expect(install(weak, "psu1").ok).toBe(true);
  });

  it("uninstall frees the slot; setClock validates range", () => {
    const b = basicBoard();
    const id = cpuId(b);
    expect(setClock(b, id, 1.25).ok).toBe(true);
    expect(setClock(b, id, 5).ok).toBe(false);
    expect(setClock(b, b.devices.find((d) => d.spec === "psu0")!.id, 1).ok).toBe(false);
    ok(uninstall(b, id));
    expect(install(b, "cpu1").ok).toBe(true);
    expect(uninstall(b, "zzz").ok).toBe(false);
  });
});

describe("serialization", () => {
  it("round-trips through JSON, including clocks and burnt", () => {
    const b = basicBoard({ cpu: "cpu1" });
    setClock(b, cpuId(b), 2.5);
    b.devices.find((d) => d.spec === "ram0")!.burnt = true;
    const json = JSON.parse(JSON.stringify(boardToJson(b)));
    const b2 = boardFromJson(json);
    expect(b2).toEqual(b);
    expect(install(b2, "ram0").ok).toBe(true);
  });

  it("rejects invalid saves", () => {
    const b = basicBoard();
    const j = boardToJson(b);
    j.devices[0]!.spec = "nope";
    expect(() => boardFromJson(j)).toThrow(/unknown device/);
    const j2 = boardToJson(b);
    j2.devices[0]!.slot = "dimm0";
    expect(() => boardFromJson(j2)).toThrow(/bad slot/);
  });
});

function run(b: Board, ticks: number, seed = 7, loads = {}) {
  const th = new ThermalModel(new Prng(seed));
  const id = cpuId(b);
  const trace: { temp: number; eff: number; unstable: boolean; burnt: boolean }[] = [];
  for (let t = 0; t < ticks; t++) {
    th.step(b, loads);
    const s = th.state(id)!;
    trace.push({ temp: s.tempC, eff: s.effClock, unstable: s.unstable, burnt: !!b.devices.find((d) => d.id === id)!.burnt });
  }
  return { th, trace };
}

describe("thermal", () => {
  it("idle stays cool; stock load at base clock is fine", () => {
    const idle = run(basicBoard(), 400, 1, { cpu: 0, ram: 0, display: 0 });
    expect(Math.max(...idle.trace.map((x) => x.temp))).toBeLessThan(35);
    const loaded = run(basicBoard(), 400);
    expect(Math.max(...loaded.trace.map((x) => x.temp))).toBeLessThan(70);
    expect(loaded.trace.at(-1)!.eff).toBe(1);
  });

  it("overclock without cooling heats, throttles, errors, then burns", () => {
    const b = basicBoard();
    dropCooler(b);
    setClock(b, cpuId(b), 1.5);
    const { trace } = run(b, 200);
    const throttled = trace.findIndex((x) => x.eff > 0 && x.eff < 1.5);
    const errors = trace.findIndex((x) => x.unstable);
    const burnt = trace.findIndex((x) => x.burnt);
    expect(throttled).toBeGreaterThan(0);
    expect(errors).toBeGreaterThan(throttled);
    expect(burnt).toBeGreaterThan(errors);
    expect(trace[burnt + 1]!.eff).toBe(0);
  });

  it("a better cooler delays or prevents it", () => {
    const burnTime = (cooler: string | null) => {
      const b = basicBoard();
      dropCooler(b);
      if (cooler) ok(install(b, cooler));
      setClock(b, cpuId(b), 1.5);
      return run(b, 600).trace.findIndex((x) => x.burnt);
    };
    expect(burnTime(null)).toBeGreaterThan(0);
    expect(burnTime("cooler0")).toBe(-1);
    expect(burnTime("cooler1")).toBe(-1);
  });

  it("PSU overload throttles; a big overload trips until powerCycle", () => {
    const b = basicBoard({ cpu: "cpu1", cooler: "cooler2" });
    const id = cpuId(b);
    setClock(b, id, 3); // r=1.5 -> ~62 W on a 40 W PSU
    const th = new ThermalModel(new Prng(1));
    th.step(b);
    expect(th.power.tripped).toBe(true);
    expect(th.effectiveClock(id)).toBe(0);
    th.step(b);
    expect(th.power.off).toBe(true);
    setClock(b, id, 2);
    th.powerCycle();
    th.step(b);
    expect(th.power.tripped).toBe(false);
    expect(th.effectiveClock(id)).toBe(2);

    // Moderate overload (~1.2x): forced throttle by budget / draw.
    setClock(b, id, 2.5);
    const t2 = new ThermalModel(new Prng(1));
    t2.step(b);
    expect(t2.power.psuFactor).toBeLessThan(1);
    expect(t2.power.tripped).toBe(false);
    expect(t2.effectiveClock(id)).toBeLessThan(2.5);
    expect(t2.effectiveClock(id)).toBeGreaterThan(0);
  });

  it("no PSU means off", () => {
    const b = basicBoard();
    ok(uninstall(b, installedPsu(b)!.dev.id));
    const { th } = run(b, 3);
    expect(th.power.off).toBe(true);
    expect(th.effectiveClock(cpuId(b))).toBe(0);
  });

  it("is deterministic per seed, including errorRoll", () => {
    const go = (seed: number) => {
      const b = basicBoard();
      dropCooler(b);
      setClock(b, cpuId(b), 1.5);
      const th = new ThermalModel(new Prng(seed));
      const rolls: boolean[] = [];
      for (let t = 0; t < 100; t++) {
        th.step(b);
        rolls.push(th.errorRoll(cpuId(b)));
      }
      return { rolls, temps: [...th.devices.values()].map((s) => s.tempC) };
    };
    const a = go(5);
    expect(go(5)).toEqual(a);
    expect(a.rolls.some(Boolean)).toBe(true);
    expect(go(6).rolls).not.toEqual(a.rolls);
  });

  it("errorRoll does not touch the PRNG while stable", () => {
    const prng = new Prng(3);
    const before = prng.getState();
    const b = basicBoard();
    const th = new ThermalModel(prng);
    for (let t = 0; t < 50; t++) {
      th.step(b);
      th.errorRoll(cpuId(b));
    }
    expect(prng.getState()).toBe(before);
  });
});

describe("apply", () => {
  it("sets clock rates, including throttled effective ones", () => {
    const b = basicBoard();
    const id = cpuId(b);
    setClock(b, id, 1.25);
    const m = new Machine(machineConfigFor(b, 1));
    expect(m.clock.getRate("cpu")).toEqual({ mul: 125, div: 100 });
    expect(m.ram.length).toBe(16 * 1024);
    const th = new ThermalModel(m.prng);
    th.step(b);
    applyRates(b, m, th);
    expect(m.clock.getRate("cpu")).toEqual({ mul: 125, div: 100 });
    expect(m.clock.getRate("display")).toEqual({ mul: 100, div: 100 });
    // Heat it up until it throttles: the applied rate drops below the requested one.
    dropCooler(b);
    setClock(b, id, 1.5);
    for (let i = 0; i < 40; i++) th.step(b);
    applyRates(b, m, th);
    const r = m.clock.getRate("cpu");
    expect(r.mul).toBeGreaterThan(0);
    expect(r.mul).toBeLessThan(150);
    // Burn it: rate 0.
    b.devices.find((d) => d.id === id)!.burnt = true;
    th.step(b);
    applyRates(b, m, th);
    expect(m.clock.getRate("cpu").mul).toBe(0);
  });

  it("selects the engine from the CPU tier and miss penalty from RAM", () => {
    expect(engineConfigFor(basicBoard())).toEqual({ kind: "unpipelined", missPenalty: 100 });
    expect(engineConfigFor(basicBoard({ cpu: "cpu2", psu: "psu1" }))).toMatchObject({ kind: "inorder", forwarding: true, cacheLines: 16 });
    expect(engineConfigFor(basicBoard({ cpu: "cpu1", psu: "psu1" }))).toMatchObject({ kind: "inorder", forwarding: false, missPenalty: 200 });
  });

  it("applyEngine attaches a runnable engine", () => {
    const b = basicBoard();
    const m = new Machine(machineConfigFor(b, 1));
    const prog = assemble("addi a0, zero, 5\necall\n").program;
    expect(applyEngine(b, m, prog)).toBe(true);
    for (let i = 0; i < 20 && !m.engine!.halted; i++) m.engine!.step();
    expect(m.engine!.halted).toBe(true);
    expect(applyEngine(createBoard(0), m, prog)).toBe(false);
  });
});
