import { describe, expect, it } from 'vitest';
import type { V3 } from './rope';
import { Sleeve } from './sleeve';

const arc = (n: number, R: number, z = 0): V3[] => Array.from({ length: n }, (_, i) => {
  const t = (i / (n - 1)) * Math.PI;
  return [R * Math.cos(t), R * Math.sin(t), z];
});

describe('Sleeve', () => {
  it('keeps its vertex count over updates', () => {
    const sl = new Sleeve(2, 10, 20, 8), count = sl.geometry.getAttribute('position').count;
    expect(count).toBe(2 * 21 * 9);
    sl.update([arc(6, 200), arc(9, 300, 50)]);
    sl.update([arc(12, 150), arc(4, 100)]);
    expect(sl.geometry.getAttribute('position').count).toBe(count);
    expect(sl.geometry.index!.count).toBe(2 * 20 * 8 * 6);
  });

  it('puts every vertex at its radius from the path', () => {
    const r = 12, R = 400, sl = new Sleeve(1, r, 32, 10);
    sl.update([arc(48, R)]);
    const pos = sl.geometry.getAttribute('position');
    for (let v = 0; v < pos.count; v++) {
      // off a circle of radius R in the z = 0 plane: the distance to its nearest point
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v), d = Math.hypot(Math.hypot(x, y) - R, z);
      expect(Math.abs(d - r)).toBeLessThan(0.2);
    }
  });

  it('runs the arc length along u, the same pitch on any strand', () => {
    const r = 10, sl = new Sleeve(1, r, 10, 6);
    sl.update([[[0, 0, 0], [1000, 0, 0]]]);
    const uv = sl.geometry.getAttribute('uv'), ring = 7;
    expect(uv.getX(10 * ring)).toBeCloseTo(1000 / (r * ((2 * Math.PI) / 4)), 3);
    expect(uv.getX(5 * ring) * 2).toBeCloseTo(uv.getX(10 * ring), 3);
  });
});
