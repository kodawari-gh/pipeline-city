import { describe, expect, it } from 'vitest';
import { Rope, dist, hang, lengthOf, naturalLength } from './rope';
import type * as ropeTypes from './rope';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const A: ropeTypes.V3 = [0, 0, 0],
  B: ropeTypes.V3 = [1000, 0, 0];

/** How far the cable turns at each inner point (radians). */
const turns = (p: ropeTypes.V3[]) =>
  p.slice(1, -1).map((q, i) => {
    const a = must(p[i]),
      c = must(p[i + 2]),
      u = [q[0] - a[0], q[1] - a[1], q[2] - a[2]],
      v = [c[0] - q[0], c[1] - q[1], c[2] - q[2]];
    const cos =
      (must(u[0]) * must(v[0]) + must(u[1]) * must(v[1]) + must(u[2]) * must(v[2])) /
      (Math.hypot(...u) * Math.hypot(...v) || 1);
    return Math.acos(Math.max(-1, Math.min(1, cos)));
  });

/** Whether the point is inside the box, `inset` in from each face (a negative inset reaches out past them). */
const insideBox = (q: ropeTypes.V3, box: { min: ropeTypes.V3; max: ropeTypes.V3 }, inset: number) =>
  [0, 1, 2].every((j) => must(q[j]) > must(box.min[j]) + inset && must(q[j]) < must(box.max[j]) - inset);
/** The most any point moved between two frames. */
const mostMoved = (now: ropeTypes.V3[], last: ropeTypes.V3[]) => Math.max(...now.map((q, i) => dist(q, must(last[i]))));

describe('a hanging cable', () => {
  it('keeps its ends on the plugs, leaves each along its plug and keeps its length', () => {
    const p = hang({ a: { at: A, dir: [0, 0, 1] }, b: { at: B, dir: [0, 0, 1] }, length: 1500 });
    expect(p[0]).toStrictEqual(A);
    expect(p.at(-1)).toStrictEqual(B);
    expect(must(p[1])[2]).toBeGreaterThan(0);
    expect(must(p.at(-2))[2]).toBeGreaterThan(0);
    expect(Math.abs(lengthOf(p) - 1500) / 1500).toBeLessThan(0.03);
  });

  it('sags under gravity between two ends at the same height', () => {
    const p = hang({ a: { at: A, dir: [1, 0, 0] }, b: { at: B, dir: [-1, 0, 0] }, length: 1400 });
    const low = Math.min(...p.map((q) => q[1]));
    expect(low).toBeLessThan(-200);
    // lowest near the middle
    const k = p.findIndex((q) => q[1] === low);
    expect(Math.abs(k / (p.length - 1) - 0.5)).toBeLessThan(0.2);
  });

  it('is pulled taut when it is shorter than the gap', () => {
    // (a cable 1400 long sags 400 here; this one stretches a little under its weight, as the steps leave it)
    const p = hang({ a: { at: A, dir: [1, 0, 0] }, b: { at: B, dir: [-1, 0, 0] }, length: 500 });
    expect(Math.min(...p.map((q) => q[1]))).toBeGreaterThan(-100);
  });

  it('bends in one even arc out of its plug, never a hook, when its length is the natural one', () => {
    // a CPU lead out of a grommet behind the board into a plug in front of it that faces the glass: it must turn back on itself
    const a = { at: [0, 450, 0] as ropeTypes.V3, dir: [0, 0, 1] as ropeTypes.V3 },
      b = { at: [110, 0, 500] as ropeTypes.V3, dir: [0, 0, 1] as ropeTypes.V3 };
    const p = hang({
      a,
      b,
      length: naturalLength(a, b, 1, 110) * 1.03,
      r: 24,
      stiff: 0.75,
      n: 22,
      lead: 110,
      sag: 0.25,
      handle: 1,
    });
    // the turn is spread over the arc (a hook turns more than a radian at one point) and the cable keeps its length
    expect(Math.max(...turns(p))).toBeLessThan(0.75);
    expect(Math.min(...p.map((q) => q[1]))).toBeGreaterThan(-1);
    expect(Math.abs(lengthOf(p) / (naturalLength(a, b, 1, 110) * 1.03) - 1)).toBeLessThan(0.02);
  });

  it('lies on a floor and goes round a box', () => {
    const floor = -300,
      box = { min: [400, -1000, -100] as ropeTypes.V3, max: [600, 100, 100] as ropeTypes.V3 };
    const p = hang({
      a: { at: A, dir: [1, 0, 0] },
      b: { at: B, dir: [-1, 0, 0] },
      length: 2400,
      r: 10,
      planes: [{ n: [0, 1, 0], d: floor }],
      solids: [box],
    });
    for (const q of p) {
      expect(q[1]).toBeGreaterThanOrEqual(floor + 10 - 1);
    }
    for (const q of p.slice(1, -1)) {
      expect(insideBox(q, box, 2)).toBe(false);
    }
  });

  it('hangs from one end when the other is free', () => {
    const p = hang({ a: { at: A, dir: [0, 0, 1] }, b: null, length: 800 });
    const end = must(p.at(-1));
    expect(end[1]).toBeLessThan(-600);
    expect(dist(end, A)).toBeLessThan(820);
  });

  it('bends round in loops instead of folding in zigzags when it has slack and little room', () => {
    // a short lead out of a socket into a hole behind it, with more cable than the gap (the SATA and 24-pin case), lying against a plane
    for (const stiff of [0.4, 0.7]) {
      const p = hang({
        a: { at: [0, 0, 300], dir: [1, 0, 0] },
        b: { at: [250, 0, 0], dir: [0, 0, 1] },
        length: 900,
        r: 15,
        stiff,
        n: 20,
        planes: [{ n: [0, 0, 1], d: 0 }],
      });
      expect(Math.max(...turns(p)), `stiff ${stiff}`).toBeLessThan(1.05);
    }
  });

  it('settles the same way every time', () => {
    const spec = {
      a: { at: A, dir: [0, 1, 0] as ropeTypes.V3 },
      b: { at: B, dir: [0, 1, 0] as ropeTypes.V3 },
      length: 1700,
      stiff: 0.8,
    };
    expect(hang(spec)).toStrictEqual(hang(spec));
    // a stiff hose keeps its length too
    const hose = hang(spec);
    expect(Math.abs(lengthOf(hose) - 1700) / 1700).toBeLessThan(0.05);
  });
});

describe('a held cable (a live rope)', () => {
  const spec = {
    a: { at: A, dir: [0, 0, 1] as ropeTypes.V3 },
    b: { at: B, dir: [-1, 0, 0] as ropeTypes.V3 },
    length: 1500,
    r: 10,
    stiff: 0.5,
    n: 20,
  };

  it('comes to the same curve as `hang` over the same steps', () => {
    const rope = new Rope(spec);
    rope.step(420);
    expect(rope.points()).toStrictEqual(hang(spec));
  });

  it('keeps its pins on its ends as they move, and its length', () => {
    const rope = new Rope(spec, { live: true });
    for (let f = 1; f <= 60; f++) {
      const b: ropeTypes.V3 = [1000 - f * 8, f * 5, f * 3];
      rope.setEnds(spec.a, { at: b, dir: [-1, 0, 0] });
      rope.step(4);
      const p = rope.points();
      expect(p[0]).toStrictEqual(A);
      expect(p.at(-1)).toStrictEqual(b);
    }
    rope.step(600);
    const now = lengthOf(rope.points());
    expect(Math.abs(now - rope.length) / rope.length).toBeLessThan(0.05);
  });

  it('lets its free end fall below the fixed one, its tip running along the cable', () => {
    const rope = new Rope(spec, { live: true, start: hang(spec) });
    rope.setEnds(spec.a, null);
    expect(rope.resting).toBe(false);
    rope.step(1000);
    const tip = rope.tip();
    expect(tip.at[1]).toBeLessThan(-1000);
    expect(tip.dir[1]).toBeLessThan(-0.8);
    expect(dist(tip.at, A)).toBeLessThan(rope.length * 1.02);
  });

  it('comes to rest with slack, a stiff bundle held still (it does not shake)', () => {
    // a 24-pin bundle held off to the side of its grommet (taken from the game): 28% slack it has to bend
    const rope = new Rope(
      {
        a: { at: [4850, 1222, 2294], dir: [0, 0, 1] },
        b: { at: [5566, 569, 2545], dir: [-0.227, 0.974, 0] },
        length: 1281,
        r: 24,
        stiff: 0.7,
        n: 20,
        lead: 90,
        planes: [{ n: [0, 0, 1], d: 2270 }],
      },
      { live: true },
    );
    let last = rope.points(),
      most = 0;
    // 90 frames to settle, then 30 measured
    for (let f = 0; f < 90; f++) {
      rope.step(4);
      last = rope.points();
    }
    for (let f = 90; f < 120; f++) {
      rope.step(4);
      const now = rope.points();
      most = Math.max(most, mostMoved(now, last));
      last = now;
    }
    expect(most).toBeLessThan(1);
  });

  it('meets the boxes its free end swings to', () => {
    // a cord held up by both ends, its far end let go: it falls onto a shelf beside and under it (what it has left slides off), never more than
    // half its thickness into it
    const shelf = { min: [-1000, -2000, -500] as ropeTypes.V3, max: [1000, -1500, 500] as ropeTypes.V3 };
    const rope = new Rope(
      {
        a: { at: [0, 0, 0], dir: [1, 0, 0] },
        b: { at: [400, 0, 0], dir: [-1, 0, 0] },
        length: 3000,
        r: 10,
        solids: [shelf],
      },
      { live: true },
    );
    rope.setEnds({ at: [0, 0, 0], dir: [1, 0, 0] }, null);
    rope.step(1500);
    const p = rope.points();
    expect(Math.min(...p.map((q) => q[1]))).toBeLessThan(-1000);
    for (const q of p) {
      expect(insideBox(q, shelf, -5), `${q.join(',')} in the shelf`).toBe(false);
    }
  });

  it('starts from the points it is given', () => {
    const start = hang(spec),
      rope = new Rope(spec, { start });
    expect(rope.points()).toStrictEqual(start);
    // ends that do not move leave it at rest once it has settled
    const cord = new Rope({ a: spec.a, b: null, length: 800 });
    expect(cord.step(2000)).toBe(true);
    cord.setEnds(spec.a, null);
    expect(cord.resting).toBe(true);
  });
});
