// The Spline is three's centripetal curve with the coefficients kept: every number it gives must be the number three gives.
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Spline } from './spline';

/** A reproducible walk of `n` points. */
function walk(n: number, seed: number): Vector3[] {
  let s = seed;
  const r = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5;
  const out: Vector3[] = [];
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < n; i++) {
    x += r() * 2;
    y += r() * 2;
    z += r() * 2;
    out.push(new Vector3(x, y, z));
  }
  return out;
}

/** Three's curve and ours over the same points. */
const pair = (pts: Vector3[]): [CatmullRomCurve3, Spline] => [new CatmullRomCurve3(pts.map((p) => p.clone()), false, 'centripetal'), new Spline(pts.map((p) => p.clone()))];
const bits = (v: Vector3): number[] => [v.x, v.y, v.z];

/** The t values that matter: a fine grid, each point's own t, a hair either side of it, and the ends. */
function ts(n: number): number[] {
  const out = [0, 1, 1 - Number.EPSILON, Number.EPSILON];
  for (let i = 0; i <= 97; i++) out.push(i / 97);
  for (let i = 0; i < n; i++) out.push(i / (n - 1), (i + 0.5) / (n - 1), (i / (n - 1)) * (1 + 1e-12), (i / (n - 1)) * (1 - 1e-12));
  return out.filter((t) => t >= 0 && t <= 1);
}

describe('Spline', () => {
  it.each([2, 3, 4, 5, 9])('gives the numbers of three at every t (%i points)', (n) => {
    const [a, b] = pair(walk(n, 7 + n));
    for (const t of ts(n)) expect(bits(b.getPoint(t))).toEqual(bits(a.getPoint(t)));
  });

  it('keeps three\'s safety for repeated points', () => {
    const p = walk(5, 3);
    const [a, b] = pair([p[0]!, p[0]!, p[1]!, p[2]!, p[2]!, p[2]!, p[4]!]);
    for (const t of ts(7)) expect(bits(b.getPoint(t))).toEqual(bits(a.getPoint(t)));
  });

  it('writes into the target it is given, and returns it', () => {
    const [, b] = pair(walk(4, 1));
    const v = new Vector3();
    expect(b.getPoint(0.4, v)).toBe(v);
    expect(bits(v)).toEqual(bits(b.getPoint(0.4)));
  });

  it('leaves a t outside 0..1 to three, whatever three does with it', () => {
    const [a, b] = pair(walk(4, 2));
    expect(bits(b.getPoint(1.25))).toEqual(bits(a.getPoint(1.25)));
    expect(() => a.getPoint(-0.25)).toThrow();
    expect(() => b.getPoint(-0.25)).toThrow();
  });

  it('gives the same lengths, points by length, tangents and frames, so the same tube', () => {
    const [a, b] = pair(walk(6, 11));
    expect(b.getLength()).toBe(a.getLength());
    for (const u of [0, 0.1, 0.37, 0.5, 0.93, 1]) {
      expect(bits(b.getPointAt(u))).toEqual(bits(a.getPointAt(u)));
      expect(bits(b.getTangentAt(u))).toEqual(bits(a.getTangentAt(u)));
    }
    const fa = a.computeFrenetFrames(24, false), fb = b.computeFrenetFrames(24, false);
    for (const k of ['tangents', 'normals', 'binormals'] as const) expect(fb[k].map(bits)).toEqual(fa[k].map(bits));
    const ga = new TubeGeometry(a, 24, 1, 7, false), gb = new TubeGeometry(b, 24, 1, 7, false);
    for (const k of ['position', 'normal', 'uv']) expect(gb.attributes[k]!.array).toEqual(ga.attributes[k]!.array);
    expect(gb.index!.array).toEqual(ga.index!.array);
  });
});
