import { describe, expect, it } from "vitest";
import { Game } from "./game";

const ECO = { powerRatePerWh: 1, billPeriodTicks: 100, billGraceTicks: 20, startQueue: [] };
const run = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.advanceBaseTick(); };
const game = (money: number) => new Game({ seed: 1, preassembled: true, economy: { ...ECO, startMoney: money } });

describe("the power bill", () => {
  it("is off with no rate and in the sandbox", () => {
    expect(new Game({ seed: 1, preassembled: true }).snapshot().bill).toBeNull();
    expect(new Game({ seed: 1, sandbox: true, economy: ECO }).snapshot().bill).toBeNull();
  });

  it("accrues, is issued each period and is paid from the money by itself", () => {
    const g = game(1000);
    run(g, 60);
    const mid = g.snapshot();
    expect(mid.bill!.accruedWh).toBeCloseTo(mid.energy.wh, 9);
    expect(mid.bill!.accruedCost).toBeGreaterThan(0);
    expect(mid.money).toBe(1000);
    run(g, 60);
    const s = g.snapshot();
    expect(s.bill!.last).not.toBeNull();
    const amount = s.bill!.last!.amount;
    expect(amount).toBe(Math.ceil(s.bill!.last!.wh * 1 - 1e-9));
    expect(s.money).toBe(1000 - amount);
    expect(s.bill!.unpaid).toBe(0);
    expect(s.bill!.paidTotal).toBe(amount);
    expect(s.powered).toBe(true);
  });

  it("cuts the wall after the grace for an unpaid bill, and restores it once the money is there", () => {
    const g = game(0);
    run(g, 101);
    expect(g.snapshot().bill!.unpaid).toBeGreaterThan(0);
    expect(g.snapshot().bill!.cut).toBe(false);
    expect(g.snapshot().powered).toBe(true);
    run(g, 20);
    const cut = g.snapshot();
    expect(cut.bill!.cut).toBe(true);
    expect(cut.powered).toBe(false);
    expect(cut.noPowerReason).toMatch(/power company/);
    expect(g.powerButton()).toMatchObject({ ok: false });
    g.money = 1000;
    run(g, 1);
    const back = g.snapshot();
    expect(back.bill!.cut).toBe(false);
    expect(back.bill!.unpaid).toBe(0);
    expect(back.money).toBeLessThan(1000);
    expect(g.powerButton()).toMatchObject({ ok: true, powered: true });
  });

  it("a payment inside the grace period avoids the cut", () => {
    const g = game(0);
    run(g, 101);
    g.money = 1000;
    run(g, 1);
    expect(g.snapshot().bill!.unpaid).toBe(0);
    run(g, 40);
    expect(g.snapshot().powered).toBe(true);
  });

  it("survives a save", () => {
    const g = game(0);
    run(g, 130);
    const before = g.snapshot().bill!;
    expect(before.unpaid).toBeGreaterThan(0);
    const g2 = Game.fromSave(JSON.parse(JSON.stringify(g.toSave())), ECO);
    const after = g2.snapshot().bill!;
    expect(after).toEqual({ ...before, accruedWh: before.accruedWh, accruedCost: before.accruedCost });
    expect(g2.snapshot().energy.wh).toBeCloseTo(g.snapshot().energy.wh, 9);
  });
});
