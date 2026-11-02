import { describe, expect, it } from 'vitest';
import { Rope, dist, hang, lengthOf, type V3 } from './rope';

const A: V3 = [0, 0, 0], B: V3 = [1000, 0, 0];

describe('a hanging cable', () => {
  it('keeps its ends on the plugs, leaves each along its plug and keeps its length', () => {
    const p = hang({ a: { at: A, dir: [0, 0, 1] }, b: { at: B, dir: [0, 0, 1] }, length: 1500 });
    expect(p[0]).toEqual(A);
    expect(p[p.length - 1]).toEqual(B);
    expect(p[1]![2]).toBeGreaterThan(0);
    expect(p[p.length - 2]![2]).toBeGreaterThan(0);
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
    const p = hang({ a: { at: A, dir: [1, 0, 0] }, b: { at: B, dir: [-1, 0, 0] }, length: 500 });
    expect(Math.min(...p.map((q) => q[1]))).toBeGreaterThan(-80);
  });

  it('lies on a floor and goes round a box', () => {
    const floor = -300, box = { min: [400, -1000, -100] as V3, max: [600, 100, 100] as V3 };
    const p = hang({ a: { at: A, dir: [1, 0, 0] }, b: { at: B, dir: [-1, 0, 0] }, length: 2400, r: 10, planes: [{ n: [0, 1, 0], d: floor }], solids: [box] });
    for (const q of p) expect(q[1]).toBeGreaterThanOrEqual(floor + 10 - 1);
    for (const q of p.slice(1, -1)) {
      const inside = [0, 1, 2].every((j) => q[j]! > box.min[j]! + 2 && q[j]! < box.max[j]! - 2);
      expect(inside).toBe(false);
    }
  });

  it('hangs from one end when the other is free', () => {
    const p = hang({ a: { at: A, dir: [0, 0, 1] }, b: null, length: 800 });
    const end = p[p.length - 1]!;
    expect(end[1]).toBeLessThan(-600);
    expect(dist(end, A)).toBeLessThan(820);
  });

  it('bends round in loops instead of folding in zigzags when it has slack and little room', () => {
    // a short lead out of a socket into a hole behind it, with more cable than the gap (the SATA and 24-pin case), lying against a plane
    const turn = (p: V3[]) => Math.max(...p.slice(1, -1).map((q, i) => {
      const a = p[i]!, c = p[i + 2]!, u = [q[0] - a[0], q[1] - a[1], q[2] - a[2]], v = [c[0] - q[0], c[1] - q[1], c[2] - q[2]];
      const cos = (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (Math.hypot(...u) * Math.hypot(...v) || 1);
      return Math.acos(Math.max(-1, Math.min(1, cos)));
    }));
    for (const stiff of [0.4, 0.7]) {
      const p = hang({ a: { at: [0, 0, 300], dir: [1, 0, 0] }, b: { at: [250, 0, 0], dir: [0, 0, 1] }, length: 900, r: 15, stiff, n: 20, planes: [{ n: [0, 0, 1], d: 0 }] });
      expect(turn(p), `stiff ${stiff}`).toBeLessThan(1.05);
    }
  });

  it('settles the same way every time', () => {
    const spec = { a: { at: A, dir: [0, 1, 0] as V3 }, b: { at: B, dir: [0, 1, 0] as V3 }, length: 1700, stiff: 0.8 };
    expect(hang(spec)).toEqual(hang(spec));
    // a stiff hose keeps its length too
    expect(Math.abs(lengthOf(hang(spec)) - 1700) / 1700).toBeLessThan(0.05);
  });
});

describe('a held cable (a live rope)', () => {
  const spec = { a: { at: A, dir: [0, 0, 1] as V3 }, b: { at: B, dir: [-1, 0, 0] as V3 }, length: 1500, r: 10, stiff: 0.5, n: 20 };

  it('comes to the same curve as `hang` over the same steps', () => {
    const rope = new Rope(spec);
    rope.step(420);
    expect(rope.points()).toEqual(hang(spec));
  });

  it('keeps its pins on its ends as they move, and its length', () => {
    const rope = new Rope(spec, { live: true });
    for (let f = 1; f <= 60; f++) {
      const b: V3 = [1000 - f * 8, f * 5, f * 3];
      rope.setEnds(spec.a, { at: b, dir: [-1, 0, 0] });
      rope.step(4);
      const p = rope.points();
      expect(p[0]).toEqual(A);
      expect(p[p.length - 1]).toEqual(b);
    }
    rope.step(600);
    expect(Math.abs(lengthOf(rope.points()) - rope.length) / rope.length).toBeLessThan(0.05);
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

  it('feeds out to a new length', () => {
    const rope = new Rope(spec, { live: true });
    rope.step(420);
    rope.setLength(2400);
    expect(rope.resting).toBe(false);
    rope.step(800);
    // (the straight leads out of the plugs keep their length: the rest takes the new length)
    expect(Math.abs(lengthOf(rope.points()) - 2400) / 2400).toBeLessThan(0.1);
  });

  it('starts from the points it is given', () => {
    const start = hang(spec), rope = new Rope(spec, { start });
    expect(rope.points()).toEqual(start);
    // ends that do not move leave it at rest once it has settled
    const cord = new Rope({ a: spec.a, b: null, length: 800 });
    expect(cord.step(2000)).toBe(true);
    cord.setEnds(spec.a, null);
    expect(cord.resting).toBe(true);
  });
});
