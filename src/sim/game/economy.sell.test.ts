import { describe, expect, it } from "vitest";
import { Game } from "./game";
import { ECONOMY, SELL_RATE, SPARE_FLOOR, offerPrice, sellValue } from "./economy";
import { handleMessage } from "../host";

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const rich = () => { const g = new Game({ seed: 3, economy: { startMoney: 5000 } }); return g; };

describe("selling spares", () => {
  it("returns 80% of the price and removes the item", () => {
    const g = rich();
    const { invId } = g.purchase("ram1") as { ok: true; invId: string };
    const price = offerPrice("ram1")!;
    const before = g.snapshot().money;
    expect(g.snapshot().inventory.find((i) => i.id === invId)!.sellPrice).toBe(Math.floor(price * SELL_RATE));
    const r = g.sell(invId);
    expect(r.ok).toBe(true);
    expect(g.snapshot().money).toBe(before + sellValue("ram1"));
    expect(g.snapshot().inventory.some((i) => i.id === invId)).toBe(false);
    expect(sellValue("ram1")).toBeLessThan(price); // buying and selling back always loses money
  });

  it("refuses an unknown item and a second sale of the same one", () => {
    const g = rich();
    const { invId } = g.purchase("ram1") as { ok: true; invId: string };
    expect(g.sell("nope").ok).toBe(false);
    expect(g.sell(invId).ok).toBe(true);
    const money = g.snapshot().money;
    expect(g.sell(invId).ok).toBe(false);
    expect(g.snapshot().money).toBe(money);
  });

  it("sells the free starter parts at the spare floor, always below what the shop asks", () => {
    const g = new Game({ seed: 3 });
    const inv = g.snapshot().inventory;
    expect(inv.length).toBeGreaterThan(0);
    for (const it of inv) expect(it.sellPrice).toBe(sellValue(it.spec));
    expect(sellValue("ram0")).toBe(Math.floor(SPARE_FLOOR * SELL_RATE));
    expect(sellValue("ram0")).toBeGreaterThan(0);
    expect(sellValue("ram0")).toBeLessThan(SPARE_FLOOR);
  });

  it("is refused in the sandbox", () => {
    const g = new Game({ seed: 3, sandbox: true });
    const { invId } = g.purchase("ram1") as { ok: true; invId: string };
    expect(g.sell(invId).ok).toBe(false);
    expect(g.snapshot().inventory.some((i) => i.id === invId)).toBe(true);
  });

  it("works through the host message", () => {
    const g = rich();
    const { invId } = g.purchase("ram1") as { ok: true; invId: string };
    const out = handleMessage({ game: g, owed: 0, speed: 1 } as never, { type: "sell", invId });
    expect(out.some((m) => m.type === "error")).toBe(false);
    expect(g.snapshot().inventory.some((i) => i.id === invId)).toBe(false);
  });
});
