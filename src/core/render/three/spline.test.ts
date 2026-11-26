// The Spline is three's centripetal curve with the coefficients kept: every number it gives must be the number three gives.
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Spline } from './spline';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A reproducible walk of `n` points. */
function walk(n: number, seed: number): Vector3[] {
  let s = seed;
  const r = (): number => (s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 4_294_967_296 - 0.5;
  const out: Vector3[] = [];
  let x = 0,
    y = 0,
    z = 0;
  for (let i = 0; i < n; i++) {
    x += r() * 2;
    y += r() * 2;
    z += r() * 2;
    out.push(new Vector3(x, y, z));
  }
  return out;
}

/** Three's curve and ours over the same points. */
const pair = (pts: Vector3[]): [CatmullRomCurve3, Spline] => [
  new CatmullRomCurve3(
    pts.map((p) => p.clone()),
    false,
    'centripetal',
  ),
  new Spline(pts.map((p) => p.clone())),
];
const bits = (v: Vector3): number[] => [v.x, v.y, v.z];

/** The t values that matter: a fine grid, each point's own t, a hair either side of it, and the ends. */
function ts(n: number): number[] {
  const out = [0, 1, 1 - Number.EPSILON, Number.EPSILON];
  for (let i = 0; i <= 97; i++) {
    out.push(i / 97);
  }
  for (let i = 0; i < n; i++) {
    out.push(i / (n - 1), (i + 0.5) / (n - 1), (i / (n - 1)) * (1 + 1e-12), (i / (n - 1)) * (1 - 1e-12));
  }
  return out.filter((t) => t >= 0 && t <= 1);
}

describe('Spline', () => {
  it.each([2, 3, 4, 5, 9])('gives the numbers of three at every t (%i points)', (n) => {
    const [a, b] = pair(walk(n, 7 + n));
    for (const t of ts(n)) {
      expect(bits(b.getPoint(t))).toStrictEqual(bits(a.getPoint(t)));
    }
  });

  it("keeps three's safety for repeated points", () => {
    const p = walk(5, 3);
    const [a, b] = pair([must(p[0]), must(p[0]), must(p[1]), must(p[2]), must(p[2]), must(p[2]), must(p[4])]);
    for (const t of ts(7)) {
      expect(bits(b.getPoint(t))).toStrictEqual(bits(a.getPoint(t)));
    }
  });

  it('writes into the target it is given, and returns it', () => {
    const [, b] = pair(walk(4, 1));
    const v = new Vector3();
    expect(b.getPoint(0.4, v)).toBe(v);
    expect(bits(v)).toStrictEqual(bits(b.getPoint(0.4)));
  });

  it('leaves a t outside 0..1 to three, whatever three does with it', () => {
    const [a, b] = pair(walk(4, 2));
    expect(bits(b.getPoint(1.25))).toStrictEqual(bits(a.getPoint(1.25)));
    expect(() => a.getPoint(-0.25)).toThrow(TypeError);
    expect(() => b.getPoint(-0.25)).toThrow(TypeError);
  });

  it('gives the same lengths, points by length, tangents and frames, so the same tube', () => {
    const [a, b] = pair(walk(6, 11));
    expect(b.getLength()).toBe(a.getLength());
    for (const u of [0, 0.1, 0.37, 0.5, 0.93, 1]) {
      expect(bits(b.getPointAt(u))).toStrictEqual(bits(a.getPointAt(u)));
      expect(bits(b.getTangentAt(u))).toStrictEqual(bits(a.getTangentAt(u)));
    }
    const fa = a.computeFrenetFrames(24, false),
      fb = b.computeFrenetFrames(24, false);
    for (const k of ['tangents', 'normals', 'binormals'] as const) {
      expect(fb[k].map(bits)).toStrictEqual(fa[k].map(bits));
    }
    const ga = new TubeGeometry(a, 24, 1, 7, false),
      gb = new TubeGeometry(b, 24, 1, 7, false);
    for (const k of ['position', 'normal', 'uv']) {
      expect(must(gb.attributes[k]).array).toStrictEqual(must(ga.attributes[k]).array);
    }
    expect(must(gb.index).array).toStrictEqual(must(ga.index).array);
  });
});
