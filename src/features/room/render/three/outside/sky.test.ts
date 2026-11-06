import { describe, expect, it } from 'vitest';
import { moonDir } from './sky';

describe('the moon', () => {
  it('moves with the hour: east in the evening, over the town near midnight, low in the west at dawn', () => {
    const dusk = moonDir(20), late = moonDir(23), dawn = moonDir(6.2);
    expect(dusk.x).toBeGreaterThan(late.x);
    expect(late.x).toBeGreaterThan(dawn.x);
    expect(dusk.x).toBeGreaterThan(0);
    expect(dawn.x).toBeLessThan(0);
    expect(Math.abs(late.x)).toBeLessThan(0.1);
    for (const d of [dusk, late, dawn]) {
      expect(d.z).toBeLessThan(0);
      expect(d.y).toBeGreaterThan(0);
      expect(d.length()).toBeCloseTo(1);
    }
    expect(late.y).toBeGreaterThan(dusk.y);
    expect(late.y).toBeGreaterThan(dawn.y);
  });

  it('is under the horizon by day', () => {
    for (const h of [9, 12, 15]) expect(moonDir(h).y).toBeLessThan(0);
  });
});
