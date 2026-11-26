import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { ECONOMY, SELL_RATE, SPARE_FLOOR, offerPrice, sellValue } from './economy';
import { handleMessage, newHost } from '@/worker/host';
import type { Result } from '@/worker/game/types';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The new item's inventory id, or fails the test with the shop's reason. */
function bought(r: Result<{ invId: string }>): string {
  if (!r.ok) {
    throw new Error(r.reason);
  }
  return r.invId;
}

ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

const rich = () => {
  const g = new Game({ seed: 3, economy: { startMoney: 5000 } });
  return g;
};

describe('selling spares', () => {
  it('returns 80% of the price and removes the item', () => {
    const g = rich();
    const invId = bought(g.purchase('ram1'));
    const price = must(offerPrice('ram1'));
    const before = g.snapshot().money;
    expect(must(g.snapshot().inventory.find((i) => i.id === invId)).sellPrice).toBe(Math.floor(price * SELL_RATE));
    const r = g.sell(invId);
    expect(r.ok).toBe(true);
    expect(g.snapshot().money).toBe(before + sellValue('ram1'));
    expect(g.snapshot().inventory.some((i) => i.id === invId)).toBe(false);
    expect(sellValue('ram1')).toBeLessThan(price); // buying and selling back always loses money
  });

  it('refuses an unknown item and a second sale of the same one', () => {
    const g = rich();
    const invId = bought(g.purchase('ram1'));
    expect(g.sell('nope').ok).toBe(false);
    expect(g.sell(invId).ok).toBe(true);
    const { money } = g.snapshot();
    expect(g.sell(invId).ok).toBe(false);
    expect(g.snapshot().money).toBe(money);
  });

  it('sells the free starter parts at the spare floor, always below what the shop asks', () => {
    const g = new Game({ seed: 3 });
    const inv = g.snapshot().inventory;
    expect(inv.length).toBeGreaterThan(0);
    for (const item of inv) {
      expect(item.sellPrice).toBe(sellValue(item.spec));
    }
    expect(sellValue('ram0')).toBe(Math.floor(SPARE_FLOOR * SELL_RATE));
    expect(sellValue('ram0')).toBeGreaterThan(0);
    expect(sellValue('ram0')).toBeLessThan(SPARE_FLOOR);
  });

  it('is refused in the sandbox', () => {
    const g = new Game({ seed: 3, sandbox: true });
    const invId = bought(g.purchase('ram1'));
    expect(g.sell(invId).ok).toBe(false);
    expect(g.snapshot().inventory.some((i) => i.id === invId)).toBe(true);
  });

  it('works through the host message', () => {
    const g = rich();
    const invId = bought(g.purchase('ram1'));
    const out = handleMessage({ ...newHost(), game: g }, { type: 'sell', invId });
    expect(out.some((m) => m.type === 'error')).toBe(false);
    expect(g.snapshot().inventory.some((i) => i.id === invId)).toBe(false);
  });
});
