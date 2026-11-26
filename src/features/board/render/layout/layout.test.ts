import { describe, expect, it, afterAll } from 'vitest';
import * as layout from './layout';

const inside = (a: layout.Rect, b: layout.Rect) =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

afterAll(() => {
  layout.setLayoutTier(2);
});

describe('the overview on a phone held upright (9:19)', () => {
  it('holds in every case size', () => {
    for (const t of [0, 1, 2, 3]) {
      layout.setLayoutTier(t);
      const f = layout.overviewFrame(9 / 19);
      expect(inside(layout.CASE, f)).toBe(true);
      expect(f.x).toBeGreaterThan(layout.MONITOR.x + layout.MONITOR.w);
    }
  });
});

describe('the overview on a wide or square screen', () => {
  it('frames the whole scene: the machine, the monitor and the wall plate', () => {
    for (const k of [16 / 9, 4 / 3, 1, layout.PORTRAIT_ASPECT]) {
      const f = layout.overviewFrame(k);
      expect(inside(layout.WORLD, f)).toBe(true);
      expect(inside(layout.MONITOR, f)).toBe(true);
    }
  });
});
