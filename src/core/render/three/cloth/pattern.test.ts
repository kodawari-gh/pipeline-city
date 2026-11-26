import { describe, expect, it } from 'vitest';
import { assemble, meshOutline, pointAt, polyLength, resample } from './pattern';
import type * as patternTypes from './pattern';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}
/** Counts one more `k` in `counts`. */
function bump(counts: Map<string, number>, k: string): void {
  counts.set(k, (counts.get(k) ?? 0) + 1);
}

/** A flat square `s` mm wide, its edges counter-clockwise, laid in the z = 0 plane `dx` along x. */
const square = (name: string, s: number, dx: number): patternTypes.Piece => ({
  name,
  edges: [
    {
      name: 'bottom',
      pts: [
        [0, 0],
        [s, 0],
      ],
    },
    {
      name: 'right',
      pts: [
        [s, 0],
        [s, s],
      ],
    },
    {
      name: 'top',
      pts: [
        [s, s],
        [0, s],
      ],
    },
    {
      name: 'left',
      pts: [
        [0, s],
        [0, 0],
      ],
    },
  ],
  place: (x, y) => [x + dx, y, 0],
});

const area = (pts: readonly patternTypes.P2[], tris: readonly number[]) => {
  let s = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = must(pts[must(tris[t])]),
      b = must(pts[must(tris[t + 1])]),
      c = must(pts[must(tris[t + 2])]);
    s += ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }
  return s;
};

describe('cloth pattern', () => {
  it('measures, steps and finds points along a polyline', () => {
    const line: patternTypes.P2[] = [
      [0, 0],
      [30, 0],
      [30, 40],
    ];
    expect(polyLength(line)).toBeCloseTo(70);
    const r = resample(line, 7);
    expect(r).toHaveLength(8);
    for (let i = 1; i < r.length; i++) {
      expect(Math.hypot(must(r[i])[0] - must(r[i - 1])[0], must(r[i])[1] - must(r[i - 1])[1])).toBeCloseTo(10);
    }
    expect(pointAt(line, 0.5)).toStrictEqual([30, 5]);
    expect(pointAt(line, 2)).toStrictEqual([30, 40]);
  });

  it('meshes an outline into triangles that cover it once, all wound one way', () => {
    const outline = resample(
      [
        [0, 0],
        [200, 0],
        [200, 100],
        [0, 100],
        [0, 0],
      ],
      30,
    ).slice(0, -1);
    const { pts, tris } = meshOutline(outline, 10);
    expect(area(pts, tris)).toBeCloseTo(200 * 100, -1);
    for (let t = 0; t < tris.length; t += 3) {
      expect(area(pts, tris.slice(t, t + 3))).toBeGreaterThan(0);
    }
  });

  it('sews two pieces point to point and welds the seam, the faces wound one way over both', () => {
    const g: patternTypes.Garment = {
      pieces: [square('a', 200, 0), square('b', 200, 210)],
      seams: [{ a: ['a', 'right'], b: ['b', 'left'], flip: true }],
      materials: ['cloth'],
    };
    const m = assemble(g, 20);
    const pairs = m.sewn.length / 2;
    expect(pairs).toBe(11);
    for (let e = 0; e < m.sewn.length; e += 2) {
      const a = must(m.sewn[e]),
        b = must(m.sewn[e + 1]);
      expect(m.weld[a]).toBe(m.weld[b]);
      // start to end: a's right edge runs up, b's left edge runs down
      expect(m.flat[2 * a + 1]).toBeCloseTo(must(m.flat[2 * b + 1]));
    }
    // every side two triangles share (welded) runs one way in one and the other way in the other
    const runs = new Map<string, number>();
    for (let t = 0; t < m.tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const k = `${m.weld[must(m.tris[t + e])]},${m.weld[must(m.tris[t + ((e + 1) % 3)])]}`;
        bump(runs, k);
      }
    }
    for (const [k, c] of runs) {
      expect(c, `${k}: runs that way`).toBe(1);
    }
    // the rest lengths are the flat ones
    for (let e = 0, c = 0; e < m.edges.length; e += 2, c++) {
      const i = must(m.edges[e]),
        j = must(m.edges[e + 1]);
      expect(m.rest[c]).toBeCloseTo(
        Math.hypot(must(m.flat[2 * j]) - must(m.flat[2 * i]), must(m.flat[2 * j + 1]) - must(m.flat[2 * i + 1])),
      );
    }
  });

  it('refuses an edge sewn twice and a seam to an edge that is not there', () => {
    const p = [square('a', 100, 0), square('b', 100, 110)];
    expect(() =>
      assemble(
        {
          pieces: p,
          seams: [
            { a: ['a', 'right'], b: ['b', 'left'] },
            { a: ['a', 'right'], b: ['b', 'top'] },
          ],
          materials: ['c'],
        },
        20,
      ),
    ).toThrow(/two seams/u);
    expect(() =>
      assemble({ pieces: p, seams: [{ a: ['a', 'side'], b: ['b', 'left'] }], materials: ['c'] }, 20),
    ).toThrow(/no edge/u);
  });
});
