import { describe, expect, it } from 'vitest';
import { BOARD_TIERS } from '../sim/specs';
import { SKINS, skinOf, slotArmour } from './skins';

describe('board skins', () => {
  it('gives every board tier a skin of its own: no two tiers share a mask', () => {
    expect(SKINS.length).toBe(BOARD_TIERS.length);
    expect(new Set(SKINS.map((s) => s.mask[0])).size).toBe(SKINS.length);
    expect(new Set(SKINS.map((s) => s.mask[1])).size).toBe(SKINS.length);
  });

  it('climbs the market ladder: the armour, the trim and the cover only grow with the tier', () => {
    const cover = { bare: 0, plain: 1, armour: 2 } as const;
    for (let t = 1; t < SKINS.length; t++) {
      expect(skinOf(t).armor).toBeGreaterThanOrEqual(skinOf(t - 1).armor);
      expect(skinOf(t).trim).toBeGreaterThanOrEqual(skinOf(t - 1).trim);
      expect(cover[skinOf(t).ioCover]).toBeGreaterThanOrEqual(cover[skinOf(t - 1).ioCover]);
    }
  });

  it('armours the x16 from Mainstream up and every slot on the Enthusiast', () => {
    expect([0, 1, 2].map((i) => slotArmour(0, i))).toEqual([false, false, false]);
    expect([0, 1, 2].map((i) => slotArmour(2, i))).toEqual([true, false, false]);
    expect([0, 1, 2].map((i) => slotArmour(3, i))).toEqual([true, true, true]);
  });
});
