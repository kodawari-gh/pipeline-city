import { describe, expect, it } from 'vitest';
import * as accelcopper from './accelcopper';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const MM = 23;
type Pt = readonly [number, number];
const segs = (pts: readonly Pt[]) => pts.slice(1).map((b, i) => [must(pts[i]), b] as const);
/** The shortest distance between two segments (sampled: the runs are short and straight). */
function gap(a: readonly [Pt, Pt], b: readonly [Pt, Pt]): number {
  let m = Infinity;
  const N = 24,
    at = (s: readonly [Pt, Pt], t: number): Pt => [
      s[0][0] + (s[1][0] - s[0][0]) * t,
      s[0][1] + (s[1][1] - s[0][1]) * t,
    ];
  for (let i = 0; i <= N; i++) {
    const p = at(a, i / N);
    for (let j = 0; j <= N; j++) {
      const q = at(b, j / N);
      m = Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
  }
  return m;
}
/** The three die sizes of a card (mm: the package's width, its height) and where the fingers are, as the cards build them. */
const CARDS: Record<
  string,
  {
    tab: { x: number; w: number };
    core: [number, number, number, number];
    mem: [number, number, number, number];
    y0: number;
  }
> = {
  'gpu-1': { tab: { x: -88.3 * MM, w: 84 * MM }, core: [-73.5, 90, 13.4, 13.4], mem: [-53, 92, 10.3, 8.4], y0: 49.1 },
  'gpu-3': { tab: { x: -88.3 * MM, w: 85 * MM }, core: [-66.8, 88, 21.6, 21.6], mem: [-34, 90, 10.3, 8.4], y0: 49.1 },
  'npu-1': { tab: { x: -88.3 * MM, w: 63 * MM }, core: [-66.9, 94, 14.4, 14.4], mem: [-46, 96, 10.3, 8.4], y0: 49.1 },
};
const input = (k: string): accelcopper.AccelCopperIn => {
  const c = must(CARDS[k]),
    r = (a: number[]) => ({ x: must(a[0]) * MM, y: must(a[1]) * MM, w: must(a[2]) * MM, h: must(a[3]) * MM });
  return {
    tab: c.tab,
    y0: c.y0 * MM,
    core: r(c.core),
    mem: r(c.mem),
    inductors: [{ x: (c.core[0] - 14) * MM, y: (c.core[1] + 4) * MM, w: 5 * MM, h: 5 * MM }],
  };
};

describe("a graphics card's and an AI card's copper", () => {
  for (const k of Object.keys(CARDS)) {
    const assert_x_every_receive_line_goes_from_its_finger_to_the = (): void => {
      const a = input(k),
        cu = accelcopper.accelCopper(a),
        f = accelcopper.hostFingers(a.tab);
      expect(cu.host).toHaveLength(f.length);
      expect(f.length).toBeGreaterThan(8);
      for (const [i, pts] of cu.host.entries()) {
        expect(must(pts[0])[0]).toBeCloseTo(must(f[i]).x, 3);
        const end = must(pts.at(-1));
        expect(end[0]).toBeGreaterThan(a.core.x);
        expect(end[0]).toBeLessThan(a.core.x + a.core.w);
        expect(end[1]).toBeGreaterThan(a.core.y);
      }
    };

    it(`${k}: every receive line goes from its finger to the die's north edge, inside the package`, () => {
      expect.hasAssertions();
      assert_x_every_receive_line_goes_from_its_finger_to_the();
    });
    const assert_x_no_two_runs_of_different_nets_touch_their_clearance = (): void => {
      const cu = accelcopper.accelCopper(input(k)),
        t = cu.traces;
      for (const r of t) {
        for (const [a, b] of segs(r.pts)) {
          const dx = Math.abs(b[0] - a[0]),
            dy = Math.abs(b[1] - a[1]);
          expect(
            dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6,
            `${r.net} bends at ${dx.toFixed(2)},${dy.toFixed(2)}`,
          ).toBe(true);
        }
      }
      for (let i = 0; i < t.length; i++) {
        for (let j = i + 1; j < t.length; j++) {
          if (must(t[i]).net === must(t[j]).net) {
            continue;
          }
          const need = (must(t[i]).w + must(t[j]).w) / 2 + accelcopper.POUR_CLEAR;
          for (const s of segs(must(t[i]).pts)) {
            for (const u of segs(must(t[j]).pts)) {
              expect(gap(s, u), `${must(t[i]).net} / ${must(t[j]).net}`).toBeGreaterThanOrEqual(need);
            }
          }
        }
      }
    };

    it(`${k}: no two runs of different nets touch (their clearance holds), at 0 or 45 degrees`, () => {
      expect.hasAssertions();
      assert_x_no_two_runs_of_different_nets_touch_their_clearance();
    });

    const assert_x_the_lit_lanes_are_the_receive_lines_and_the_me = (): void => {
      const cu = accelcopper.accelCopper(input(k)),
        l = accelcopper.accelLanes(cu, 2, input(k).core.x - 10);
      expect(l.host).toHaveLength(cu.host.length);
      expect(l.media).toHaveLength(cu.mem.length);
      expect(l.rect.w).toBeGreaterThan(0);
      for (const lane of [...l.host, ...l.media]) {
        for (const p of lane.pts) {
          expect(p[0]).toBeGreaterThan(2 * 4000 - 3000);
        }
      }
    };

    it(`${k}: the lit lanes are the receive lines and the memory bus, in the card's band`, () => {
      expect.hasAssertions();
      assert_x_the_lit_lanes_are_the_receive_lines_and_the_me();
    });
  }
});
