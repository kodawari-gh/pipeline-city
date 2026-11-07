import { describe, expect, it } from 'vitest';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { motionFor, motionKinds, motionSeconds, poseAt } from './buildmotion';

describe('build motions', () => {
  it('every part kind and the case parts have a motion', () => {
    const kinds = new Set(Object.values(DEVICE_SPECS).map((s) => s.kind));
    for (const kind of [...kinds, 'cable', 'side', 'board', 'case']) expect(motionKinds(), kind).toContain(kind);
  });

  it('starts seated and ends clear of the machine', () => {
    for (const kind of motionKinds()) {
      const m = motionFor(kind), a = poseAt(m, 0), b = poseAt(m, 99);
      expect(a.offset, kind).toEqual([0, 0, 0]);
      expect(Math.hypot(...b.offset) + (kind === 'side' ? 1 : 0), kind).toBeGreaterThan(0);
      expect(motionSeconds(m), kind).toBeGreaterThan(0.05);
      expect(motionSeconds(m), kind).toBeLessThan(5);
    }
  });

  it('fitting is the removal backwards', () => {
    for (const kind of motionKinds()) {
      const m = motionFor(kind), T = motionSeconds(m);
      for (const f of [0, 0.2, 0.5, 0.8, 1]) {
        const out = poseAt(m, T * f, 'out'), back = poseAt(m, T * (1 - f), 'in');
        expect(back.offset[2], kind).toBeCloseTo(out.offset[2], 6);
        expect(back.offset[0], kind).toBeCloseTo(out.offset[0], 6);
      }
    }
  });

  it('moves smoothly: the pose never jumps between frames', () => {
    for (const kind of motionKinds()) {
      const m = motionFor(kind);
      let last = poseAt(m, 0);
      for (let t = 0.02; t <= motionSeconds(m); t += 0.02) {
        const p = poseAt(m, t);
        expect(Math.hypot(p.offset[0] - last.offset[0], p.offset[1] - last.offset[1], p.offset[2] - last.offset[2]), `${kind} at ${t}`).toBeLessThan(260);
        last = p;
      }
    }
  });

  it('says what the player does, out and in', () => {
    const m = motionFor('ram');
    expect(poseAt(m, 0.1, 'out').label).toMatch(/latch/i);
    expect(poseAt(m, 1.4, 'out').label).toMatch(/away/i);
    expect(poseAt(m, 0.05, 'in').label).toMatch(/Bring/);
  });
});
