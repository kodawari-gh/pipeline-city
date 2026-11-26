import { describe, expect, it } from 'vitest';
import * as ramface3d from './ramface3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// a stick as `ramStick` lays it (units): 8 data chips in two groups, an ECC chip, the power chip and the SPD in the gap
const L = 2384,
  H = 720,
  notchU = 1500;
/** A part `h` long from `y` down the stick, between heights `v0` and `v1` (a chip's band by default). */
const chip = (
  [y, h]: [number, number],
  kind: ramface3d.Foot['kind'],
  [v0, v1]: [number, number] = [480, 660],
): ramface3d.Foot => ({
  u0: L + 8 - y - h,
  u1: L + 8 - y,
  v0,
  v1,
  kind,
});
const foot = (ecc: boolean): ramface3d.Foot[] => {
  const d = Array.from({ length: 8 }, (_, j) =>
    chip([(j < 4 ? 80 : 2400 - 80 - 4 * 262 + 32) + (j % 4) * 262, 230], 'dram'),
  );
  const gy = (80 + 3 * 262 + 230 + 2400 - 80 - 4 * 262 + 32) / 2;
  if (ecc) {
    d.push(chip([gy - 70, 140], 'reg'));
  }
  d.push(chip([gy + (ecc ? 72 : -23), 46], 'pmic', [360, 410]), chip([gy + (ecc ? -97 : 59), 22], 'spd', [310, 340]));
  return d;
};

type Seg = readonly [ramface3d.Pt, ramface3d.Pt];
/** Which side of the line through `p` and `q` the point `r` is on (the sign of the turn). */
const turn = (p: ramface3d.Pt, q: ramface3d.Pt, r: ramface3d.Pt) =>
  (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
/** Whether two segments cross. */
const cross = ([a, b]: Seg, [c, d]: Seg): boolean =>
  turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;

function assert_puts_the_fingers_in_an_even_row_with_a_gap_at_th(): void {
  const f = ramface3d.fingerCentres(L, notchU, 144);
  expect(f).toHaveLength(144);
  const steps = f.slice(1).map((u, i) => u - must(f[i]));
  expect(Math.max(...steps)).toBeGreaterThan(Math.min(...steps) * 2);
  expect(f.every((u) => u > 0 && u < L)).toBe(true);
}

describe("the memory stick's copper", () => {
  it('puts the fingers in an even row with a gap at the key', () => {
    expect.hasAssertions();
    assert_puts_the_fingers_in_an_even_row_with_a_gap_at_th();
  });

  it.each([false, true])(
    'runs every line inside the PCB, up from its finger to under its part, crossing no other (ecc %s)',
    (ecc) => {
      const r = ramface3d.ramRoutes({ L, H, notchU, pins: 144, sink: 70, foot: foot(ecc) });
      expect(r.lines).toHaveLength(144);
      for (const l of r.lines) {
        for (const p of l) {
          expect(p[0]).toBeGreaterThan(0);
          expect(p[0]).toBeLessThan(L);
          expect(p[1]).toBeGreaterThan(60);
          expect(p[1]).toBeLessThan(H);
        }
      }
      for (let i = 0; i < r.lines.length; i++) {
        for (let j = i + 1; j < r.lines.length; j++) {
          for (let a = 1; a < must(r.lines[i]).length; a++) {
            for (let b = 1; b < must(r.lines[j]).length; b++) {
              const lineI = must(r.lines[i]);
              const lineJ = must(r.lines[j]);
              const crosses = cross([must(lineI[a - 1]), must(lineI[a])], [must(lineJ[b - 1]), must(lineJ[b])]);
              expect(crosses, `${i} x ${j}`).toBe(false);
            }
          }
        }
      }
      // the data chips are fed: a pad under each
      expect(r.pads.length).toBeGreaterThan(100);
    },
  );
});
