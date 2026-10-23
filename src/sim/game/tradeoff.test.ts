// The first purchase (CPU tier 1 vs RAM tier 1) is a real decision that depends on the traffic mix.
// Same seeds, same horizon, same purchase rule (buy as soon as affordable); only the order differs.
// Income = money earned over the horizon (money in hand plus money spent on the two parts).
import { describe, expect, it } from "vitest";
import { getSpec } from "../board";
import { ECONOMY, type EconomyConfig } from "./economy";
import { Game } from "./game";
import { Operator } from "./operator";

const HORIZON = 800;
const SEEDS = [1, 2, 3, 4, 5, 6];

const LOG_ONLY: EconomyConfig["mix"] = [{ template: "cli", weight: 1, minRamBytes: 0 }];
const SCAN_HEAVY: EconomyConfig["mix"] = [
  ...LOG_ONLY,
  { template: "cli.scan", scale: 4, weight: 4, minRamBytes: 0, payMul: 2 }, // ~80% scan jobs
];

interface Outcome { income: number; completed: number }

function play(mix: EconomyConfig["mix"], order: string[], seed: number): Outcome {
  // A bot player with a couple of seconds of reaction per manual step; it installs what is bought (power off, swap, power on).
  const g = new Game({ seed, preassembled: true, economy: { mix } });
  const op = new Operator(g, 2);
  let spent = 0;
  let next = 0;
  for (let t = 0; t < HORIZON; t++) {
    g.advanceBaseTick();
    op.step();
    while (next < order.length && g.money >= getSpec(order[next]!)!.price && g.purchase(order[next]!).ok) {
      spent += getSpec(order[next]!)!.price;
      next++;
    }
  }
  return { income: g.money + spent, completed: g.completed };
}

/** Mean over the seeds. */
function mean(mix: EconomyConfig["mix"], order: string[]): Outcome {
  const rs = SEEDS.map((s) => play(mix, order, s));
  return {
    income: rs.reduce((n, r) => n + r.income, 0) / rs.length,
    completed: rs.reduce((n, r) => n + r.completed, 0) / rs.length,
  };
}

function compare(mix: EconomyConfig["mix"]) {
  return {
    none: mean(mix, []),
    cpuOnly: mean(mix, ["cpu1"]),
    ramOnly: mean(mix, ["ram1"]),
    cpuFirst: mean(mix, ["cpu1", "ram1"]),
    ramFirst: mean(mix, ["ram1", "cpu1"]),
  };
}

function report(name: string, c: ReturnType<typeof compare>): void {
  const f = (o: Outcome) => `$${Math.round(o.income)} / ${o.completed.toFixed(1)} jobs`;
  console.log(
    `[${name}, ${HORIZON} ticks] nothing ${f(c.none)} | cpu1 only ${f(c.cpuOnly)} | ram1 only ${f(c.ramOnly)} | ` +
    `cpu1 then ram1 ${f(c.cpuFirst)} | ram1 then cpu1 ${f(c.ramFirst)}`,
  );
}

describe("CPU-first vs RAM-first depends on the traffic mix", () => {
  it("log-heavy traffic: the CPU is clearly the better first purchase", { timeout: 120000 }, () => {
    const c = compare(LOG_ONLY);
    report("log only", c);
    expect(c.cpuOnly.income).toBeGreaterThan(c.ramOnly.income * 1.3);
    expect(c.cpuFirst.income).toBeGreaterThan(c.ramFirst.income * 1.3);
  });

  it("scan-heavy traffic: RAM first is better", { timeout: 120000 }, () => {
    const c = compare(SCAN_HEAVY);
    report("scan heavy", c);
    expect(c.ramFirst.income).toBeGreaterThan(c.cpuFirst.income * 1.1);
    expect(c.ramOnly.income).toBeGreaterThan(c.cpuOnly.income * 0.97); // at least as good alone, and cheaper
  });

  it("the starting traffic mix is a close call: neither choice dominates", { timeout: 120000 }, () => {
    const c = compare(ECONOMY.mix);
    report("starting mix", c);
    for (const [a, b] of [[c.cpuOnly, c.ramOnly], [c.cpuFirst, c.ramFirst]] as const) {
      // Band, not a tie: the scan ramp makes the first minutes log-only, which favours buying the CPU late-ish.
      expect(a.income / b.income).toBeGreaterThan(0.65);
      expect(a.income / b.income).toBeLessThan(1.5);
    }
    // And the share of scan jobs in the starting mix is a quarter to a third.
    const total = ECONOMY.mix.reduce((n, m) => n + m.weight, 0);
    const scan = ECONOMY.mix.filter((m) => m.template === "cli.scan").reduce((n, m) => n + m.weight, 0);
    expect(scan / total).toBeGreaterThan(0.25);
    expect(scan / total).toBeLessThan(0.34);
  });
});
