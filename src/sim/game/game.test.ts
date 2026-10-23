import { describe, expect, it } from "vitest";
import { Game, type GameOptions } from "./game";
import { Operator, play } from "./operator";

/** One isolated job (no arrivals) on a machine with `items` bought and installed; returns the completion record. */
function oneJob(items: string[], template: string, scale = 1, seed = 1) {
  const g = new Game({ seed, preassembled: true, economy: { baseDemandPerTick: 0, startQueue: [{ template, scale }] } });
  g.money = 1e6;
  for (const i of items) {
    const r = g.purchase(i);
    if (!r.ok) throw new Error(`${i}: ${r.reason}`);
  }
  const op = new Operator(g, 0);
  for (let k = 0; k < 5000 && g.completed === 0; k++) {
    g.advanceBaseTick();
    op.step();
  }
  expect(g.lastCompleted).not.toBeNull();
  return g.lastCompleted!;
}

const cpuOf = (g: Game) => g.snapshot().devices.find((d) => d.kind === "cpu")!;

describe("pacing (real start: bare board, then the bot assembles the crate)", () => {
  it("first job (power on to payout) is about 40-60 s, the first payout buys a part soon after", () => {
    const g = new Game({ seed: 1 });
    const op = new Operator(g, 2); // a human needs a couple of seconds per manual step
    let powerOnAt = 0;
    let payAt = 0;
    let firstPay = 0;
    let firstId = 0;
    let firstAffordable = 0;
    let firstTier = 0;
    for (let t = 1; t <= 600; t++) {
      g.advanceBaseTick();
      op.step();
      if (!powerOnAt && g.powered) powerOnAt = t;
      const s = g.snapshot();
      if (!payAt && s.completed > 0) { payAt = t; firstPay = s.lastCompleted!.payout; firstId = s.lastCompleted!.id; }
      const ok = s.purchases.filter((p) => p.affordable && !p.blocked);
      if (!firstAffordable && ok.length) firstAffordable = t;
      if (!firstTier && ok.some((p) => p.kind === "cpu" || p.kind === "ram")) firstTier = t;
    }
    expect(powerOnAt).toBeLessThanOrEqual(12); // a few manual steps: install, plug a key, press power
    const firstJob = payAt - powerOnAt;
    expect(firstJob).toBeGreaterThanOrEqual(40);
    expect(firstJob).toBeLessThanOrEqual(60);
    expect(firstPay).toBeGreaterThan(30);
    expect(firstId).toBe(1);
    expect(firstAffordable).toBeLessThanOrEqual(payAt + 60); // the cheapest part ($50 cooler) soon after
    expect(firstTier).toBeGreaterThanOrEqual(payAt);
    expect(firstTier).toBeLessThanOrEqual(300);
  });

  it("slow start: across 30 seeds the first $100 lands in a bounded time and the first job is unchanged", () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const g = new Game({ seed });
      const op = new Operator(g, 2);
      let t100 = 0;
      let first = 0;
      for (let t = 1; t <= 600 && !t100; t++) {
        g.advanceBaseTick();
        op.step();
        if (!first && g.completed > 0) {
          first = t;
          expect(first).toBeGreaterThanOrEqual(40);
          expect(first).toBeLessThanOrEqual(60);
          expect(g.lastCompleted!.payout).toBeGreaterThanOrEqual(40);
          expect(g.lastCompleted!.payout).toBeLessThanOrEqual(75);
        }
        if (g.money >= 100) t100 = t;
      }
      times.push(t100);
    }
    expect(Math.min(...times)).toBeGreaterThan(0);
    expect(Math.max(...times)).toBeLessThanOrEqual(360);
  });

  it("the first job leaves its text on the monitor and on the key", () => {
    const g = new Game({ seed: 1 });
    const op = new Operator(g, 6); // the human is slow to pull the key
    while (g.currentPhase() !== "done-remove-key") {
      g.advanceBaseTick();
      op.step();
    }
    for (let i = 0; i < 10; i++) g.advanceBaseTick(); // let the display drain
    const s = g.snapshot();
    expect(s.display).toMatch(/#\d\d .+ OK/);
    expect(s.display).toContain("REMOVE KEY");
    expect(s.plugged!.result).toMatch(/^#\d\d .+ OK$/);
  });
});

describe("queue, reputation and demand", () => {
  it("the tray is capped; overflow counts as a drop and costs reputation", () => {
    const g = new Game({ seed: 3, preassembled: true, economy: { baseDemandPerTick: 1, queueCap: 5, repMin: 1 } });
    for (let t = 0; t < 40; t++) g.advanceBaseTick(); // nobody serves the keys
    const s = g.snapshot();
    expect(s.queueLength).toBe(5);
    expect(s.dropped).toBeGreaterThan(0);
    expect(s.avgTurnaround).toBeGreaterThan(g.cfg.targetTurnaround); // the clients that gave up pulled the average up
  });

  it("keys sitting unserved lower reputation and demand", () => {
    const g = new Game({ seed: 2, preassembled: true });
    const fresh = g.snapshot();
    for (let t = 0; t < 300; t++) g.advanceBaseTick(); // nobody touches the machine
    const s = g.snapshot();
    expect(s.tray[0]!.age).toBeGreaterThan(200);
    expect(s.reputation).toBeLessThan(fresh.reputation);
    expect(s.demandRate).toBeLessThan(fresh.demandRate);
  });

  it("slow service shrinks demand, fast service grows it", () => {
    /** Mean reputation over the second half of a 900 s run (a single instant is noisy: a lull freezes the average). */
    const meanRep = (g: Game): number => {
      let sum = 0;
      let n = 0;
      play(g, 900, 2, (gg, t) => { if (t > 450 && t % 10 === 0) { sum += gg.snapshot().reputation; n++; } });
      return sum / n;
    };
    const slow = new Game({ seed: 2 });
    const fast = new Game({ seed: 2 });
    fast.money = 1e6;
    fast.purchase("cpu1");
    fast.purchase("ram1");
    const rs = meanRep(slow);
    const rf = meanRep(fast);
    expect(rs).toBeLessThan(1);
    expect(rf).toBeGreaterThan(1);
    expect(rf).toBeGreaterThan(rs * 1.5);
    expect(fast.completed).toBeGreaterThan(slow.completed);
  });

  it("no clients arrive before the first boot, and the first key's clock starts at the first boot", () => {
    const g = new Game({ seed: 1 });
    for (let t = 0; t < 200; t++) g.advanceBaseTick();
    let s = g.snapshot();
    expect(s.tray).toHaveLength(1); // only the starter key
    expect(s.tray[0]!.age).toBe(0);
    g.install("inv1"); g.install("inv2"); g.install("inv3"); g.install("inv4");
    for (const c of ["atx", "cpu", "video"]) g.connectCable(c);
    expect(g.powerButton()).toEqual({ ok: true, powered: true });
    for (let t = 0; t < 10; t++) g.advanceBaseTick();
    s = g.snapshot();
    expect(s.tray[0]!.age).toBe(10);
    expect(s.tray[0]!.arrivalTick).toBe(200);
  });
});

describe("purchases go to the inventory", () => {
  it("rejects what you cannot afford and what the plan refuses", () => {
    const g = new Game({ seed: 1, preassembled: true });
    const poor = g.purchase("cpu1");
    expect(!poor.ok && poor.reason).toMatch(/needs/);
    g.money = 1e6;
    const noPsu = g.purchase("cpu2"); // 41 W of rated load > the 40 W PSU
    expect(!noPsu.ok && noPsu.reason).toMatch(/PSU/);
    expect(g.money).toBe(1e6);
    expect(g.purchase("psu1").ok).toBe(true);
    expect(g.purchase("cpu2").ok).toBe(true); // the plan now has the big PSU
    expect(g.purchase("cpu1").ok).toBe(false); // not an upgrade over what you own
    expect(g.purchase("nonsense").ok).toBe(false);
  });

  it("a purchase is owned but not installed; installing needs the machine off", () => {
    const g = new Game({ seed: 1, preassembled: true });
    g.money = 1e6;
    const r = g.purchase("cpu1");
    expect(r.ok).toBe(true);
    expect(g.snapshot().progress.firstPurchase).toBe(true);
    expect(cpuOf(g).spec).toBe("cpu0");
    const inv = g.snapshot().inventory;
    expect(inv.map((i) => i.spec)).toEqual(["cpu1"]);
    expect(inv[0]).toMatchObject({ installable: false, reason: "power the machine off first", swapSlots: ["cpu0"], freeSlots: [] });
    const id = (r as { invId: string }).invId;
    expect(g.install(id)).toMatchObject({ ok: false, reason: "power the machine off first" });
    g.powerButton();
    expect(g.install(id).ok).toBe(true);
    expect(cpuOf(g).spec).toBe("cpu1");
    expect(g.snapshot().inventory.map((i) => i.spec)).toEqual(["cpu0"]); // the old CPU came back
  });

  it("the snapshot lists purchases with price, affordability and board refusals", () => {
    const g = new Game({ seed: 1, preassembled: true });
    g.money = 150;
    const p = g.snapshot().purchases;
    const by = (id: string) => p.find((x) => x.id === id)!;
    expect(by("ram1")).toMatchObject({ price: 100, affordable: true });
    expect(by("cpu1")).toMatchObject({ price: 200, affordable: false });
    expect(by("cpu2").blocked).toMatch(/PSU/);
    expect(by("psu2").blocked).toBeDefined();
  });
});

describe("board upgrade purchase", () => {
  it("psu2 is blocked until the bigger board is owned, then everything works on it", () => {
    const g = new Game({ seed: 1, preassembled: true, economy: { baseDemandPerTick: 0, startQueue: [] } });
    g.money = 1e6;
    const by = (id: string) => g.snapshot().purchases.find((p) => p.id === id);
    g.powerButton(); // a board can only be bought while powered off
    expect(by("board1")).toMatchObject({ kind: "board", price: 150, affordable: true });
    expect(by("board2")).toBeUndefined(); // only the next tier is offered
    expect(by("psu2")!.blocked).toMatch(/atx-plus/);
    const b1 = g.purchase("board1") as { ok: true; invId: string };
    expect(b1.ok).toBe(true);
    expect(by("board2")).toMatchObject({ kind: "board", price: 300, affordable: true });
    const b = g.purchase("board2") as { ok: true; invId: string };
    expect(b.ok).toBe(true);
    expect(g.money).toBe(1e6 - 450);
    expect(g.snapshot().boardTier).toBe(0); // owned, not installed
    expect(by("board2")).toBeUndefined(); // not offered twice
    expect(by("psu2")!.blocked).toBeUndefined();
    const p = g.purchase("psu2") as { ok: true; invId: string };
    expect(p.ok).toBe(true);
    expect(g.snapshot().inventory.find((i) => i.id === b.invId)).toMatchObject({ kind: "board", freeSlots: ["board"], installable: true });
    expect(g.install(b1.invId).ok).toBe(true);
    expect(g.install(b.invId).ok).toBe(true);
    expect(g.snapshot().boardTier).toBe(2);
    expect(g.snapshot().cables.every((c) => c.connected)).toBe(true); // parts and cables carried over
    expect(g.install(p.invId).ok).toBe(true); // swaps over the 40 W PSU, which goes back to the inventory
    expect(g.snapshot().cables.find((c) => c.id === "atx")!.connected).toBe(true); // swapping keeps the cables on the board
    g.powerButton();
    g.advanceBaseTick();
    const s = g.snapshot();
    expect(s.devices.map((d) => d.spec).sort()).toEqual(["cooler0", "cpu0", "display0", "psu2", "ram0"]);
    expect(s.power.budgetW).toBe(250);
    expect(g.purchase("cpu2").ok).toBe(true);
  });

  it("is refused without the money", () => {
    const g = new Game({ seed: 1 });
    const r = g.purchase("board1");
    expect(!r.ok && r.reason).toMatch(/needs [$]150/);
  });

  it("keeps earning after the upgrade", () => {
    const g = new Game({ seed: 1, preassembled: true });
    g.money = 400;
    g.powerButton(); // board purchases need the machine off
    expect(g.purchase("board1").ok).toBe(true);
    play(g, 300, 1);
    expect(g.snapshot().boardTier).toBe(1);
    expect(g.completed).toBeGreaterThan(2);
  });
});

describe("CPU tier vs RAM tier depends on the job profile", () => {
  it("log: CPU pays off, RAM does nothing", () => {
    const base = oneJob([], "cli.log").execTicks;
    const cpu = oneJob(["cpu1"], "cli.log").execTicks;
    const ram = oneJob(["ram1"], "cli.log").execTicks;
    expect(base / cpu).toBeGreaterThan(2.5);
    expect(Math.abs(base - ram)).toBeLessThanOrEqual(6); // only the one-off reboot for the swap
  });

  it("scan (cache-hostile): CPU helps, RAM helps, and the two together help far more", () => {
    const base = oneJob([], "cli.scan", 4).execTicks;
    const cpu = oneJob(["cpu1"], "cli.scan", 4).execTicks;
    const ramOnly = oneJob(["ram1"], "cli.scan", 4).execTicks;
    const both = oneJob(["cpu1", "ram1"], "cli.scan", 4).execTicks;
    const logCpu = oneJob(["cpu1"], "cli.log").execTicks;
    const logBoth = oneJob(["cpu1", "ram1"], "cli.log").execTicks;
    expect(base / cpu).toBeGreaterThan(1.5); // a faster CPU still waits on slow RAM (misses cost 2x as many cycles)
    expect(base / ramOnly).toBeGreaterThan(1.25); // RAM alone helps even on the slow CPU
    expect(cpu / both).toBeGreaterThan(2); // and the faster CPU needs the faster RAM
    expect(Math.abs(logCpu - logBoth)).toBeLessThanOrEqual(2); // while log is untouched by RAM
  });

  it("boot time depends on the CPU: each tier reaches the key prompt sooner", () => {
    const bootTicks = (items: string[]): number => {
      const g = new Game({ seed: 1, preassembled: true, economy: { baseDemandPerTick: 0 } });
      g.money = 1e6;
      for (const i of items) g.purchase(i);
      new Operator(g).assemble();
      let t = 0;
      while (g.currentPhase() !== "waiting-for-key" && t < 500) { g.advanceBaseTick(); t++; }
      return t;
    };
    const t0 = bootTicks([]);
    const t1 = bootTicks(["cpu1"]);
    const t2 = bootTicks(["psu1", "cpu2"]);
    expect(t0).toBeGreaterThan(t1);
    expect(t1).toBeGreaterThan(t2);
  });
});

describe("determinism", () => {
  const script: [number, string][] = [[150, "cooler1"], [200, "psu1"], [260, "cpu1"], [400, "ram1"]];
  function play2(seed: number): string[] {
    const g = new Game({ seed });
    const op = new Operator(g, 2);
    const out: string[] = [];
    for (let t = 1; t <= 800; t++) {
      g.advanceBaseTick();
      for (const [at, item] of script) if (t === at) g.purchase(item);
      op.step();
      if (t % 25 === 0) out.push(JSON.stringify(g.snapshot()));
    }
    return out;
  }
  it("same seed and player script gives identical snapshots", () => {
    expect(play2(7)).toEqual(play2(7));
  });
  it("different seeds differ", () => {
    expect(play2(7)).not.toEqual(play2(8));
  });
  it("snapshots are plain JSON", () => {
    const g = new Game({ seed: 2, preassembled: true });
    play(g, 30);
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
  function cpu2Game(clock: number): { g: Game; op: Operator } {
    const g = new Game({ seed: 5, preassembled: true, economy: busy });
    g.money = 1e6;
    // cpu2 would crash the Starter board's VRM at once; these tests are about the CPU's own heat, so give it the strongest board.
    g.powerButton();
    for (const b of ["board1", "board2", "board3"]) g.purchase(b);
    g.purchase("psu1");
    g.purchase("cpu2");
    const op = new Operator(g, 0);
    for (let k = 0; k < 20 && g.pluggedKey() === null; k++) { g.advanceBaseTick(); op.step(); } // maintenance, then busy
    expect(cpuOf(g).spec).toBe("cpu2");
    expect(g.setCpuClock(clock).ok).toBe(true);
    return { g, op };
  }
  const run = (x: { g: Game; op: Operator }, n: number, each?: (g: Game) => void) => {
    for (let t = 0; t < n; t++) { x.g.advanceBaseTick(); x.op.step(); each?.(x.g); }
  };

  it("a modest overclock on the cool starting CPU raises throughput", () => {
    const a = new Game({ seed: 5, preassembled: true, economy: busy });
    play(a, 500);
    const b = new Game({ seed: 5, preassembled: true, economy: busy });
    expect(b.setCpuClock(1.5).ok).toBe(true);
    play(b, 500);
    expect(b.completed).toBeGreaterThan(a.completed * 1.2);
    expect(cpuOf(b).burnt).toBe(false);
  });

  it("rejects clocks out of range", () => {
    expect(new Game({ seed: 1, preassembled: true }).setCpuClock(9).ok).toBe(false);
    expect(new Game({ seed: 1 }).setCpuClock(1).ok).toBe(false); // no CPU installed yet
  });

  it("an aggressive overclock with the stock cooler runs hot, errors or burns, and underperforms a moderate one", () => {
    const moderate = cpu2Game(3);
    const aggressive = cpu2Game(4.5);
    let maxT = 0;
    run(moderate, 500);
    run(aggressive, 500, (g) => { maxT = Math.max(maxT, cpuOf(g).tempC); });
    const a = aggressive.g.snapshot();
    expect(cpuOf(moderate.g).burnt).toBe(false);
    expect(cpuOf(moderate.g).tempC).toBeLessThan(85);
    expect(maxT).toBeGreaterThan(85); // reached the unstable range
    expect(cpuOf(aggressive.g).burnt || a.errors > 0).toBe(true);
    expect(a.completed).toBeLessThan(moderate.g.completed);
  });

  it("a thermal error crashes the machine: it reboots and the job restarts with no payout", () => {
    const x = cpu2Game(4.5);
    let crashed = false;
    for (let t = 0; t < 400 && !crashed; t++) {
      run(x, 1);
      const s = x.g.snapshot();
      if (s.errors > 0 && s.plugged && s.plugged.attempts > 1) crashed = true;
    }
    expect(crashed).toBe(true);
    expect(x.g.snapshot().log.some((e) => e.kind === "fault")).toBe(true);
  });

  it("a burnt CPU stops the machine (phase error); power off, swap it, power on", () => {
    const x = cpu2Game(4.5);
    for (let t = 0; t < 600 && !cpuOf(x.g).burnt; t++) {
      x.g.advanceBaseTick();
      if (!cpuOf(x.g).burnt) x.op.step(); // stop the bot the moment it burns: it would swap the part at once
    }
    expect(cpuOf(x.g).burnt).toBe(true);
    expect(x.g.snapshot()).toMatchObject({ phase: "error", phaseReason: expect.stringMatching(/burnt/) });
    x.g.money = 1e6;
    expect(x.g.purchase("cpu2").ok).toBe(true); // same-tier replacement of a burnt part is offered
    const before = x.g.completed;
    run(x, 150); // the bot powers off, installs the replacement (the burnt one is scrapped) and goes on
    expect(cpuOf(x.g).burnt).toBe(false);
    expect(x.g.snapshot().inventory.some((i) => i.spec === "cpu2")).toBe(false);
    expect(x.g.completed).toBeGreaterThan(before);
  });
});
