import { describe, expect, it } from 'vitest';
import * as match from './match';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** n lanes `pitch` apart that run east and turn south: the inner (south) lane is the shortest. */
const bundle = (n: number, pitch: number): match.Pt[][] =>
  Array.from(
    { length: n },
    (_, i) =>
      [
        [0, i * pitch],
        [970 - i * pitch, i * pitch],
        [1000 - i * pitch, i * pitch + 30],
        [1000 - i * pitch, 900],
      ] as match.Pt[],
  );

function assert_makes_every_lane_as_long_as_the_longest_keeps_th(): void {
  const lines = bundle(5, 18),
    out = match.serpentine(lines, { pitch: 18, w: 9, flare: 30 });
  const lens = out.map(match.lengthOf);
  expect(Math.max(...lens) - Math.min(...lens)).toBeLessThan(1.5);
  for (const [i, l] of out.entries()) {
    expect(l[0]).toStrictEqual(must(lines[i])[0]);
    expect(l.at(-1)).toStrictEqual(must(lines[i])[must(lines[i]).length - 1]);
  }
  for (const l of out) {
    for (let i = 2; i < l.length; i++) {
      const a = must(l[i - 2]),
        p = must(l[i - 1]),
        q = must(l[i]),
        u = [p[0] - a[0], p[1] - a[1]],
        v = [q[0] - p[0], q[1] - p[1]];
      const cos =
        (must(u[0]) * must(v[0]) + must(u[1]) * must(v[1])) /
        (Math.hypot(must(u[0]), must(u[1])) * Math.hypot(must(v[0]), must(v[1])));
      expect(cos).toBeGreaterThan(0.05);
    }
  }
}

function assert_keeps_the_lanes_apart_no_two_lanes_closer_than_t(): void {
  const out = match.serpentine(bundle(6, 18), { pitch: 18, w: 9, flare: 30 });
  const sd = (p: match.Pt, a: match.Pt, b: match.Pt) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      l2 = dx * dx + dy * dy || 1,
      t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  for (let a = 0; a < out.length; a++) {
    for (let b = a + 1; b < out.length; b++) {
      let m = 1e9;
      for (let i = 1; i < must(out[a]).length; i++) {
        for (let j = 1; j < must(out[b]).length; j++) {
          const p = must(must(out[a])[i - 1]),
            q = must(must(out[a])[i]),
            r = must(must(out[b])[j - 1]),
            t = must(must(out[b])[j]);
          m = Math.min(m, sd(p, r, t), sd(q, r, t), sd(r, p, q), sd(t, p, q));
        }
      }
      expect(m, `lanes ${a} and ${b}`).toBeGreaterThan(11);
    }
  }
}

describe('serpentine', () => {
  it('makes every lane as long as the longest, keeps the ends, 45 and 90 degrees, and never crosses itself', () => {
    expect.hasAssertions();
    assert_makes_every_lane_as_long_as_the_longest_keeps_th();
  });

  it('leaves matched lanes alone, and a bundle with no room as it was', () => {
    const same: match.Pt[][] = [
      [
        [0, 0],
        [500, 0],
      ],
      [
        [0, 18],
        [500, 18],
      ],
    ];
    expect(match.serpentine(same, { pitch: 18, w: 9 })).toStrictEqual(same);
    const short = bundle(5, 18).map((l) => l.map((p) => [p[0] / 10, p[1] / 10] as match.Pt));
    expect(match.serpentine(short, { pitch: 1.8, w: 0.9, margin: 400 })).toStrictEqual(short);
  });

  it('keeps the lanes apart: no two lanes closer than the stroke and the gap', () => {
    expect.hasAssertions();
    assert_keeps_the_lanes_apart_no_two_lanes_closer_than_t();
  });
});

describe('tuneBump', () => {
  it('steps one strand out and back on a straight stretch: same ends, a little longer', () => {
    const strand: match.Pt[] = [
        [0, 0],
        [400, 0],
      ],
      out = match.tuneBump(strand, 200, 1);
    expect(out[0]).toStrictEqual([0, 0]);
    expect(out.at(-1)).toStrictEqual([400, 0]);
    expect(match.lengthOf(out)).toBeGreaterThan(400);
    expect(Math.max(...out.map((p) => Math.abs(p[1])))).toBeCloseTo(6, 5);
  });
  it('leaves a strand with no straight stretch long enough as it was', () => {
    const strand: match.Pt[] = [
      [0, 0],
      [20, 0],
      [20, 20],
    ];
    expect(match.tuneBump(strand, 15, 1)).toStrictEqual(strand);
  });
});
