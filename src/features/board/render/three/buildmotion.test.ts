import { describe, expect, it } from 'vitest';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { latchOpen, motionFor, motionKinds, motionSeconds, placed, poseAt, PUMP_TWIST } from './buildmotion';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

describe('build motions', () => {
  it('every part kind and the case parts have a motion', () => {
    const kinds = new Set(Object.values(DEVICE_SPECS).map((s) => s.kind));
    for (const kind of [...kinds, 'cable', 'side', 'board', 'case']) {
      expect(motionKinds()).toContain(kind);
    }
  });

  it('starts seated and ends clear of the machine', () => {
    for (const kind of motionKinds()) {
      const m = motionFor(kind),
        a = poseAt(m, 0),
        b = poseAt(m, 99);
      expect(a.offset).toStrictEqual([0, 0, 0]);
      expect(Math.hypot(...b.offset) + (kind === 'side' ? 1 : 0)).toBeGreaterThan(0);
      expect(motionSeconds(m)).toBeGreaterThan(0.05);
      expect(motionSeconds(m)).toBeLessThan(5);
    }
  });

  it('fitting is the removal backwards', () => {
    for (const kind of motionKinds()) {
      const m = motionFor(kind),
        T = motionSeconds(m);
      for (const f of [0, 0.2, 0.5, 0.8, 1]) {
        const out = poseAt(m, T * f, 'out'),
          back = poseAt(m, T * (1 - f), 'in');
        expect(back.offset[2]).toBeCloseTo(out.offset[2], 6);
        expect(back.offset[0]).toBeCloseTo(out.offset[0], 6);
      }
    }
  });

  it('moves smoothly: the pose never jumps between frames', () => {
    for (const kind of motionKinds()) {
      const m = motionFor(kind);
      let last = poseAt(m, 0);
      for (let t = 0.02; t <= motionSeconds(m); t += 0.02) {
        const p = poseAt(m, t);
        expect(
          Math.hypot(p.offset[0] - last.offset[0], p.offset[1] - last.offset[1], p.offset[2] - last.offset[2]),
          `${kind} at ${t}`,
        ).toBeLessThan(260);
        last = p;
      }
    }
  });

  it('flows through a key that goes on the same way, and stops only where the way turns', () => {
    // the cooler eases off its paste and goes on up: it does not stop between the two
    const m = motionFor('cooler'),
      at = must(m.keys[0]).sec + must(m.keys[1]).sec,
      dz = (t: number) => (poseAt(m, t + 0.005).offset[2] - poseAt(m, t - 0.005).offset[2]) / 0.01;
    expect(dz(at)).toBeGreaterThan(300);
    // the board lifts off its studs, then slides sideways: it stops at the corner
    const b = motionFor('board'),
      corner = must(b.keys[0]).sec + must(b.keys[1]).sec + must(b.keys[2]).sec,
      v = (t: number) => poseAt(b, t + 0.004).offset.map((x, i) => x - must(poseAt(b, t - 0.004).offset[i]));
    expect(Math.hypot(...v(corner)) / 0.008).toBeLessThan(200);
    // nothing overshoots its keys
    for (const kind of motionKinds()) {
      const k = motionFor(kind),
        far = must(k.keys.at(-1)).at;
      for (let t = 0; t <= motionSeconds(k); t += 0.01) {
        for (const i of [0, 1, 2]) {
          const lo = Math.min(0, ...k.keys.map((x) => must(x.at[i]))) - 15,
            hi = Math.max(0, ...k.keys.map((x) => must(x.at[i]))) + 1e-6;
          expect(poseAt(k, t).offset[i], `${kind} ${i} at ${t}`).toBeGreaterThanOrEqual(lo);
          expect(poseAt(k, t).offset[i], `${kind} ${i} at ${t}`).toBeLessThanOrEqual(hi);
        }
      }
      for (const [i, x] of poseAt(k, 99).offset.entries()) {
        expect(x).toBeCloseTo(must(far[i]), 6);
      }
    }
  });

  it("a loop's pump head twists free, and its hoses slide off before they lift", () => {
    const p = motionFor('pump');
    expect(poseAt(p, motionSeconds(p)).turn).toBeCloseTo(PUMP_TWIST, 6);
    expect(poseAt(p, must(p.keys[0]).sec + must(p.keys[1]).sec).label).toMatch(/twist/iu);
    const h = motionFor('hoses'),
      off = must(h.keys[0]).sec + must(h.keys[1]).sec;
    expect(poseAt(h, off).slide).toBeCloseTo(1, 6);
    expect(poseAt(h, off).offset[2]).toBeCloseTo(0, 6);
    expect(poseAt(h, motionSeconds(h), 'in').slide).toBeCloseTo(0, 6);
    expect(poseAt(motionFor('ram'), 0.5).slide).toBe(0);
  });

  it('a part turns about its own middle, not the far origin', () => {
    expect(placed([0, 0, 0], [5000, 3000], 0, [0, 0, 10])).toStrictEqual([0, 0, 10]);
    // the part's middle stays put whatever the turn: the group's origin swings around it
    const base: [number, number, number] = [0, 0, 0],
      mid: [number, number] = [5000, 3000],
      q = placed(base, mid, Math.PI / 2, [0, 0, 0]);
    expect(q[0]).toBeCloseTo(8000, 6);
    expect(q[1]).toBeCloseTo(-2000, 6);
  });

  it('says what the player does, out and in', () => {
    const m = motionFor('ram');
    expect(poseAt(m, 0.1, 'out').label).toMatch(/latch/iu);
    expect(poseAt(m, 1.4, 'out').label).toMatch(/away/iu);
    expect(poseAt(m, 0.05, 'in').label).toMatch(/Bring/u);
  });
});

describe('a hold (a latch, a screw) is not a freeze', () => {
  it('presses the part in mid-hold and leaves it at home at both ends', () => {
    const m = motionFor('ram'),
      first = must(m.keys[0]).sec;
    expect(poseAt(m, 0).offset).toStrictEqual([0, 0, 0]);
    expect(poseAt(m, first / 2).offset[2]).toBeLessThan(-1);
    expect(poseAt(m, first / 2).turn).not.toBe(0);
    expect(poseAt(m, first).offset[2]).toBeCloseTo(0, 6);
    expect(poseAt(m, first, 'out').turn).toBeCloseTo(0, 6);
  });
  it('a plain pull has no press', () => {
    const m = motionFor('cable');
    expect(poseAt(m, must(m.keys[0]).sec / 2).offset[2]).toBeGreaterThan(0);
  });
});

describe('the latches of a socket', () => {
  it('open while the stick comes out and stay open, and close as it is seated', () => {
    const m = motionFor('ram'),
      total = motionSeconds(m);
    expect(latchOpen(m, 0, 'out')).toBe(0);
    expect(latchOpen(m, must(m.keys[0]).sec, 'out')).toBe(1);
    expect(latchOpen(m, total, 'out')).toBe(1);
    expect(latchOpen(m, 0, 'in')).toBe(1);
    expect(latchOpen(m, total, 'in')).toBe(0);
  });
});

describe('a card tips out of its slot', () => {
  it('tilts on the way and is flat at the seat and at the far end', () => {
    for (const kind of ['gpu', 'npu', 'nic']) {
      const m = motionFor(kind),
        total = motionSeconds(m);
      expect(poseAt(m, 0).tilt).toBeCloseTo(0, 6);
      expect(poseAt(m, total).tilt).toBeCloseTo(0, 6);
      const mid = Math.max(...Array.from({ length: 40 }, (_, i) => poseAt(m, (total * i) / 39).tilt));
      expect(mid).toBeGreaterThan(0.03);
    }
    expect(poseAt(motionFor('ram'), 0.5).tilt).toBe(0);
  });

  it('a radiator and its fans leave together, along the way the panel opens (never into each other)', () => {
    for (const kind of ['assembly', 'fan-rad']) {
      expect(motionKinds()).toContain(kind);
      const end = poseAt(motionFor(kind), motionSeconds(motionFor(kind)), 'out').offset;
      expect(Math.abs(end[2])).toBeGreaterThan(Math.abs(end[0]) + Math.abs(end[1]));
    }
  });
});
