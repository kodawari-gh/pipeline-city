import { describe, expect, it } from 'vitest';
import { specSheet } from './buildspecs';
import { BOARD_TIERS, CASE_TIERS, getSpec } from './specs';

describe('specSheet', () => {
  it('an empty machine costs its case and board and draws nothing', () => {
    const s = specSheet({ boardTier: 0, caseTier: 0, specs: [] });
    expect(s.budget).toBe(BOARD_TIERS[0]!.price + CASE_TIERS[0]!.price);
    expect(s.loadW).toBe(0);
    expect(s.headroom).toBeNull();
  });

  it('sums the price and the draw, and rates the load against the supply', () => {
    const s = specSheet({ boardTier: 1, caseTier: 1, specs: ['cpu1', 'psu1', 'nope'] });
    const cpu = getSpec('cpu1')!, psu = getSpec('psu1')!;
    expect(s.parts).toBe(4);
    expect(s.budget).toBe(BOARD_TIERS[1]!.price + CASE_TIERS[1]!.price + cpu.price + psu.price);
    expect(s.loadW).toBe(cpu.loadW + psu.loadW);
    expect(s.psuW).toBe(100);
    expect(s.headroom).toBeCloseTo(s.loadW / 100);
  });
});
