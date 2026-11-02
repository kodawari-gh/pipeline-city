import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { V3 } from './rope';
import { Sleeve } from './sleeve';

const arc = (n: number, R: number, z = 0): V3[] => Array.from({ length: n }, (_, i) => {
  const t = (i / (n - 1)) * Math.PI;
  return [R * Math.cos(t), R * Math.sin(t), z];
});

describe('Sleeve', () => {
  it('keeps its vertex count over updates', () => {
    const sl = new Sleeve(2, 10, 20, 8), count = sl.geometry.getAttribute('position').count;
    // the rings, then two caps a strand (a centre and a ring each)
    expect(count).toBe(2 * 21 * 9 + 2 * 2 * 10);
    sl.update([arc(6, 200), arc(9, 300, 50)]);
    sl.update([arc(12, 150), arc(4, 100)]);
    expect(sl.geometry.getAttribute('position').count).toBe(count);
    expect(sl.geometry.index!.count).toBe(2 * 20 * 8 * 6 + 2 * 2 * 8 * 3);
  });

  it('faces every triangle out, the way its normals point (the far wall never shows through)', () => {
    const sl = new Sleeve(1, 12, 24, 10);
    sl.update([arc(16, 300)]);
    const pos = sl.geometry.getAttribute('position'), nrm = sl.geometry.getAttribute('normal'), idx = sl.geometry.index!;
    const P = (i: number) => new Vector3().fromBufferAttribute(pos, i), N = (i: number) => new Vector3().fromBufferAttribute(nrm, i);
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      const face = P(b).sub(P(a)).cross(P(c).sub(P(a)));
      if (face.lengthSq() < 1e-9) continue;
      expect(face.dot(N(a).add(N(b)).add(N(c))), `triangle ${t / 3}`).toBeGreaterThan(0);
    }
  });

  it('closes both ends: each cap lies across its end, facing out along the strand', () => {
    const sl = new Sleeve(1, 10, 10, 6);
    sl.update([[[0, 0, 0], [500, 0, 0]]]);
    const pos = sl.geometry.getAttribute('position'), nrm = sl.geometry.getAttribute('normal'), caps = 11 * 7;
    for (const [e, x, nx] of [[0, 0, -1], [1, 500, 1]] as const) for (let j = 0; j < 8; j++) {
      const v = caps + e * 8 + j;
      expect(pos.getX(v)).toBeCloseTo(x, 3);
      expect(nrm.getX(v)).toBeCloseTo(nx, 6);
    }
  });

  it('keeps a long straight lead straight into short segments, with no hook past it', () => {
    // a plug's lead 200 long along +z, then short segments turning up and away: a plain Catmull-Rom overshoots to z = 215
    const p: V3[] = [[0, 0, 0], [0, 0, 200], [0, 20, 206], [0, 40, 208], [0, 60, 208], [0, 80, 208]];
    const sl = new Sleeve(1, 1, 80, 4);
    sl.update([p]);
    const pos = sl.geometry.getAttribute('position');
    for (let v = 0; v < 81 * 5; v++) {
      expect(pos.getZ(v)).toBeLessThan(208 + 1.5);
      // (a smooth curve rounds the bend a little to the outside: under 2 units, against a lead 200 long)
      expect(pos.getY(v)).toBeGreaterThan(-3);
    }
  });

  it('puts every vertex at its radius from the path', () => {
    const r = 12, R = 400, sl = new Sleeve(1, r, 32, 10);
    sl.update([arc(48, R)]);
    const pos = sl.geometry.getAttribute('position');
    // (the rings: the caps' centres lie on the path)
    for (let v = 0; v < 33 * 11; v++) {
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
