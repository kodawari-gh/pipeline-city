import { describe, expect, it } from 'vitest';
import { lengthOf, serpentine, tuneBump, type Pt } from './match';

/** n lanes `pitch` apart that run east and turn south: the inner (south) lane is the shortest. */
const bundle = (n: number, pitch: number): Pt[][] => Array.from({ length: n }, (_, i) => [[0, i * pitch], [970 - i * pitch, i * pitch], [1000 - i * pitch, i * pitch + 30], [1000 - i * pitch, 900]] as Pt[]);

describe('serpentine', () => {
  it('makes every lane as long as the longest, keeps the ends, 45 and 90 degrees, and never crosses itself', () => {
    const lines = bundle(5, 18), out = serpentine(lines, { pitch: 18, w: 9, flare: 30 });
    const lens = out.map(lengthOf);
    expect(Math.max(...lens) - Math.min(...lens)).toBeLessThan(1.5);
    out.forEach((l, i) => { expect(l[0]).toEqual(lines[i]![0]); expect(l[l.length - 1]).toEqual(lines[i]![lines[i]!.length - 1]); });
    for (const l of out) for (let i = 2; i < l.length; i++) {
      const a = l[i - 2]!, p = l[i - 1]!, q = l[i]!, u = [p[0] - a[0], p[1] - a[1]], v = [q[0] - p[0], q[1] - p[1]];
      const cos = (u[0]! * v[0]! + u[1]! * v[1]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(v[0]!, v[1]!));
      expect(cos).toBeGreaterThan(0.05);
    }
  });

  it('leaves matched lanes alone, and a bundle with no room as it was', () => {
    const same: Pt[][] = [[[0, 0], [500, 0]], [[0, 18], [500, 18]]];
    expect(serpentine(same, { pitch: 18, w: 9 })).toEqual(same);
    const short = bundle(5, 18).map((l) => l.map((p) => [p[0] / 10, p[1] / 10] as Pt));
    expect(serpentine(short, { pitch: 1.8, w: 0.9, margin: 400 })).toEqual(short);
  });

  it('keeps the lanes apart: no two lanes closer than the stroke and the gap', () => {
    const out = serpentine(bundle(6, 18), { pitch: 18, w: 9, flare: 30 });
    const sd = (p: Pt, a: Pt, b: Pt) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    for (let a = 0; a < out.length; a++) for (let b = a + 1; b < out.length; b++) {
      let m = 1e9;
      for (let i = 1; i < out[a]!.length; i++) for (let j = 1; j < out[b]!.length; j++) {
        const p = out[a]![i - 1]!, q = out[a]![i]!, r = out[b]![j - 1]!, t = out[b]![j]!;
        m = Math.min(m, sd(p, r, t), sd(q, r, t), sd(r, p, q), sd(t, p, q));
      }
      expect(m, `lanes ${a} and ${b}`).toBeGreaterThan(11);
    }
  });
});

describe('tuneBump', () => {
  it('steps one strand out and back on a straight stretch: same ends, a little longer', () => {
    const strand: Pt[] = [[0, 0], [400, 0]], out = tuneBump(strand, 200, 1);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([400, 0]);
    expect(lengthOf(out)).toBeGreaterThan(400);
    expect(Math.max(...out.map((p) => Math.abs(p[1])))).toBeCloseTo(6, 5);
  });
  it('leaves a strand with no straight stretch long enough as it was', () => {
    const strand: Pt[] = [[0, 0], [20, 0], [20, 20]];
    expect(tuneBump(strand, 15, 1)).toEqual(strand);
  });
});
