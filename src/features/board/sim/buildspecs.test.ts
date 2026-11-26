import { describe, expect, it } from 'vitest';
import { specSheet } from './buildspecs';
import { BOARD_TIERS, CASE_TIERS, getSpec } from './specs';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

describe('specSheet', () => {
  it('an empty machine costs its case and board and draws nothing', () => {
    const s = specSheet({ boardTier: 0, caseTier: 0, specs: [] });
    expect(s.budget).toBe(must(BOARD_TIERS[0]).price + must(CASE_TIERS[0]).price);
    expect(s.loadW).toBe(0);
    expect(s.headroom).toBeNull();
  });

  it('a bare case costs its case only and counts one part: the board is not there', () => {
    const s = specSheet({ boardTier: 0, caseTier: 1, specs: [], shown: 'case' });
    expect(s.budget).toBe(must(CASE_TIERS[1]).price);
    expect(s.parts).toBe(1);
    expect(s.loadW).toBe(0);
    expect(s.headroom).toBeNull();
  });

  it('an empty stage costs nothing and counts no part: the case is not there either', () => {
    const s = specSheet({ boardTier: 0, caseTier: 0, specs: [], shown: 'nothing' });
    expect(s).toStrictEqual({ parts: 0, budget: 0, idleW: 0, loadW: 0, psuW: 0, headroom: null });
  });

  it('sums the price and the draw, and rates the load against the supply', () => {
    const s = specSheet({ boardTier: 1, caseTier: 1, specs: ['cpu1', 'psu1', 'nope'] });
    const cpu = must(getSpec('cpu1')),
      psu = must(getSpec('psu1'));
    expect(s.parts).toBe(4);
    expect(s.budget).toBe(must(BOARD_TIERS[1]).price + must(CASE_TIERS[1]).price + cpu.price + psu.price);
    expect(s.loadW).toBe(cpu.loadW + psu.loadW);
    expect(s.psuW).toBe(100);
    expect(s.headroom).toBeCloseTo(s.loadW / 100);
  });
});
