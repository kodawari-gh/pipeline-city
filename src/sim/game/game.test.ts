import { describe, expect, it } from "vitest";
import { Game, type GameOptions } from "./game";

function run(g: Game, ticks: number, each?: (g: Game, t: number) => void): void {
  for (let t = 1; t <= ticks; t++) {
    g.advanceBaseTick();
    each?.(g, t);
  }
}

/** One isolated request (no arrivals) on a machine with `items` bought; returns the completion record. */
function oneRequest(items: string[], template: string, scale = 1, seed = 1) {
  const g = new Game({ seed, economy: { baseDemandPerTick: 0, startQueue: [{ template, scale }] } });
  g.money = 1e6;
  for (const i of items) {
    const r = g.purchase(i);
    if (!r.ok) throw new Error(`${i}: ${r.reason}`);
  }
  for (let k = 0; k < 5000 && g.completed === 0; k++) g.advanceBaseTick();
  expect(g.lastCompleted).not.toBeNull();
  return g.lastCompleted!;
}

const cpuOf = (g: Game) => g.snapshot().devices.find((d) => d.kind === "cpu")!;

describe("pacing (starting machine)", () => {
  it("first request 20-40 s, first payout within a minute, first affordable upgrades within a few minutes", () => {
    const g = new Game({ seed: 1 });
    let firstDone = 0;
    let first: Game["lastCompleted"] = null;
    let firstAffordable = 0; // any purchase
    let firstTierAffordable = 0; // a CPU or RAM tier
    run(g, 400, (g, t) => {
      const s = g.snapshot();
      if (!firstDone && s.completed > 0) { firstDone = t; first = s.lastCompleted; }
      const ok = s.purchases.filter((p) => p.affordable && !p.blocked);
      if (!firstAffordable && ok.length) firstAffordable = t;
      if (!firstTierAffordable && ok.some((p) => p.kind === "cpu" || p.kind === "ram")) firstTierAffordable = t;
    });
    expect(firstDone).toBeGreaterThanOrEqual(20);
    expect(firstDone).toBeLessThanOrEqual(40);
    expect(firstDone).toBeLessThanOrEqual(60); // the payout lands at completion
    expect(firstAffordable).toBeLessThanOrEqual(120);
    expect(firstTierAffordable).toBeGreaterThanOrEqual(firstDone);
    expect(firstTierAffordable).toBeLessThanOrEqual(240);
    expect(first!.id).toBe(1);
    expect(first!.execTicks).toBe(firstDone);
    expect(first!.payout).toBeGreaterThan(0);
  });

  it("the first request leaves its text on the display", () => {
    const g = new Game({ seed: 1 });
    while (g.completed === 0) g.advanceBaseTick();
    expect(g.snapshot().display).toMatch(/^#\d\d .+ OK$/);
  });
});

describe("queue, reputation and demand", () => {
  it("the queue is capped and drops are counted", () => {
    const g = new Game({ seed: 3, economy: { baseDemandPerTick: 1, queueCap: 5, repMin: 1 } });
    run(g, 100);
    const s = g.snapshot();
    expect(s.queueLength).toBeLessThanOrEqual(5);
    expect(s.dropped).toBeGreaterThan(0);
  });

  it("slow service shrinks demand, fast service grows it", () => {
    const slow = new Game({ seed: 1 });
    run(slow, 600);
    const fast = new Game({ seed: 1 });
    fast.money = 1e6;
    fast.purchase("cpu1");
    fast.purchase("ram1"); // the starting traffic includes scan jobs, which need both
    run(fast, 600);
    const s = slow.snapshot();
    const f = fast.snapshot();
    expect(s.reputation).toBeLessThan(1);
    expect(f.reputation).toBeGreaterThan(1);
    expect(f.demandRate).toBeGreaterThan(s.demandRate);
    expect(f.completed).toBeGreaterThan(s.completed);
  });
});

describe("purchases", () => {
  it("rejects what you cannot afford and what the board refuses", () => {
    const g = new Game({ seed: 1 });
    const poor = g.purchase("cpu1");
    expect(!poor.ok && poor.reason).toMatch(/needs/);
    g.money = 1e6;
    const noPsu = g.purchase("cpu2"); // 41 W rated load > 40 W PSU
    expect(!noPsu.ok && noPsu.reason).toMatch(/PSU/);
    expect(g.money).toBe(1e6);
    expect(g.purchase("psu1").ok).toBe(true);
    expect(g.purchase("cpu2").ok).toBe(true);
    expect(g.purchase("cpu1").ok).toBe(false); // not an upgrade any more
    expect(g.purchase("nonsense").ok).toBe(false);
  });

  it("a CPU swap waits for the running request, then applies", () => {
    const g = new Game({ seed: 1 });
    run(g, 5);
    g.money = 1e6;
    expect(g.purchase("cpu1")).toEqual({ ok: true, pending: true });
    const s0 = g.snapshot();
    expect(s0.pendingPurchases).toEqual(["cpu1"]);
    expect(cpuOf(g).spec).toBe("cpu0");
    while (g.completed === 0) g.advanceBaseTick();
    const done = g.snapshot().lastCompleted!;
    expect(done.id).toBe(1);
    expect(done.execTicks).toBeGreaterThan(20); // finished on the old CPU
    expect(cpuOf(g).spec).toBe("cpu0"); // the swap lands when the next request starts
    g.advanceBaseTick();
    const s1 = g.snapshot();
    expect(s1.pendingPurchases).toEqual([]);
    expect(cpuOf(g).spec).toBe("cpu1");
  });

  it("the snapshot lists purchases with price, affordability and board refusals", () => {
    const g = new Game({ seed: 1 });
    g.money = 150;
    const p = g.snapshot().purchases;
    const by = (id: string) => p.find((x) => x.id === id)!;
    expect(by("ram1")).toMatchObject({ price: 100, affordable: true });
    expect(by("cpu1")).toMatchObject({ price: 200, affordable: false });
    expect(by("cpu2").blocked).toMatch(/PSU/);
    expect(by("psu2").blocked).toBeDefined();
  });
});

describe("CPU tier vs RAM tier depends on the request profile", () => {
  it("log: CPU pays off, RAM does nothing", () => {
    const base = oneRequest([], "cli.log").execTicks;
    const cpu = oneRequest(["cpu1"], "cli.log").execTicks;
    const ram = oneRequest(["ram1"], "cli.log").execTicks;
    expect(base / cpu).toBeGreaterThan(2.5);
    expect(base / ram).toBeLessThan(1.02);
  });

  it("scan (cache-hostile): CPU helps, RAM helps, and the two together help far more", () => {
    const base = oneRequest([], "cli.scan", 2).execTicks;
    const cpu = oneRequest(["cpu1"], "cli.scan", 2).execTicks;
    const ramOnly = oneRequest(["ram1"], "cli.scan", 2).execTicks;
    const both = oneRequest(["cpu1", "ram1"], "cli.scan", 2).execTicks;
    const logCpu = oneRequest(["cpu1"], "cli.log").execTicks;
    const logBoth = oneRequest(["cpu1", "ram1"], "cli.log").execTicks;
    expect(base / cpu).toBeGreaterThan(1.4); // a faster CPU still waits on slow RAM (misses cost 2x as many cycles)
    expect(base / ramOnly).toBeGreaterThan(1.3); // RAM alone helps even on the slow CPU
    expect(cpu / both).toBeGreaterThan(2); // and the faster CPU needs the faster RAM
    expect(logCpu / logBoth).toBeLessThan(1.02); // while log is untouched by RAM
  });
});

describe("determinism", () => {
  const script: [number, string][] = [[150, "cooler1"], [200, "psu1"], [260, "cpu1"], [400, "ram1"]];
  function play(seed: number): string[] {
    const g = new Game({ seed });
    const out: string[] = [];
    for (let t = 1; t <= 800; t++) {
      g.advanceBaseTick();
      for (const [at, item] of script) if (t === at) g.purchase(item);
      if (t % 25 === 0) out.push(JSON.stringify(g.snapshot()));
    }
    return out;
  }
  it("same seed and purchase script gives identical snapshots", () => {
    expect(play(7)).toEqual(play(7));
  });
  it("different seeds differ", () => {
    expect(play(7)).not.toEqual(play(8));
  });
  it("snapshots are plain JSON", () => {
    const g = new Game({ seed: 2 });
    run(g, 30);
    const s = g.snapshot();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe("overclock, heat and errors", () => {
  /** Keep the machine saturated with work. */
  const busy: GameOptions["economy"] = {
    baseDemandPerTick: 1, repMin: 1, queueCap: 20,
    mix: [{ template: "cli", weight: 1, minRamBytes: 0 }], // thermal tests use plain CLI jobs only
  };

  /** cpu2 (35 W at base) needs the 100 W PSU, and runs hot on the stock cooler. */
  function cpu2Game(clock: number): Game {
    const g = new Game({ seed: 5, economy: busy });
    g.money = 1e6;
    g.purchase("psu1");
    g.purchase("cpu2");
    g.advanceBaseTick(); // the swap is applied between requests
    expect(g.setCpuClock(clock).ok).toBe(true);
    return g;
  }

  it("a modest overclock on the cool starting CPU raises throughput", () => {
    const a = new Game({ seed: 5, economy: busy });
    run(a, 400);
    const b = new Game({ seed: 5, economy: busy });
    expect(b.setCpuClock(1.5).ok).toBe(true);
    run(b, 400);
    expect(b.completed).toBeGreaterThan(a.completed * 1.2);
    expect(cpuOf(b).burnt).toBe(false);
  });

  it("rejects clocks out of range", () => {
    expect(new Game({ seed: 1 }).setCpuClock(9).ok).toBe(false);
  });

  it("an aggressive overclock with the stock cooler runs hot, errors or burns, and underperforms a moderate one", () => {
    const moderate = cpu2Game(3);
    const aggressive = cpu2Game(4);
    let maxT = 0;
    run(moderate, 500);
    run(aggressive, 500, (g) => { maxT = Math.max(maxT, cpuOf(g).tempC); });
    const a = aggressive.snapshot();
    expect(cpuOf(moderate).burnt).toBe(false);
    expect(cpuOf(moderate).tempC).toBeLessThan(85);
    expect(maxT).toBeGreaterThan(85); // reached the unstable range
    expect(cpuOf(aggressive).burnt || a.errors > 0).toBe(true);
    expect(a.completed).toBeLessThan(moderate.completed);
  });

  it("a thermal error restarts the request with no payout and counts", () => {
    const g = cpu2Game(4);
    let restarted = false;
    for (let t = 0; t < 300 && !restarted; t++) {
      g.advanceBaseTick();
      const s = g.snapshot();
      if (s.errors > 0 && s.request && s.request.attempts > 1) restarted = true;
    }
    expect(restarted).toBe(true);
    expect(g.snapshot().errors).toBeGreaterThan(0);
  });

  it("a burnt CPU can be replaced at once", () => {
    const g = cpu2Game(4);
    for (let t = 0; t < 600 && !cpuOf(g).burnt; t++) g.advanceBaseTick();
    expect(cpuOf(g).burnt).toBe(true);
    const before = g.completed;
    expect(g.purchase("cpu2")).toMatchObject({ ok: true, pending: false });
    run(g, 100);
    expect(g.completed).toBeGreaterThan(before);
  });
});
