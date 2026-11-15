import { describe, expect, it, afterAll } from 'vitest';
import { CASE, MONITOR, PORTRAIT_ASPECT, WORLD, overviewFrame, setLayoutTier, type Rect } from './layout';

const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

afterAll(() => setLayoutTier(2));

describe('the overview on a phone held upright (9:19)', () => {
  it('holds in every case size', () => {
    for (const t of [0, 1, 2, 3]) {
      setLayoutTier(t);
      const f = overviewFrame(9 / 19);
      expect(inside(CASE, f)).toBe(true);
      expect(f.x).toBeGreaterThan(MONITOR.x + MONITOR.w);
    }
  });
});

describe('the overview on a wide or square screen', () => {
  it('frames the whole scene: the machine, the monitor and the wall plate', () => {
    for (const k of [16 / 9, 4 / 3, 1, PORTRAIT_ASPECT]) {
      const f = overviewFrame(k);
      expect(inside(WORLD, f)).toBe(true);
      expect(inside(MONITOR, f)).toBe(true);
    }
  });
});
