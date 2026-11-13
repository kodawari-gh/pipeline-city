import { describe, expect, it } from 'vitest';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { DOOR_SECONDS, SWING, doorPose, stepDoor } from './casedoor';

describe('the side panel opening', () => {
  it('starts shut and ends swung out past square, for every kind', () => {
    for (const k of CASE_KIND) {
      expect(doorPose(k, 0), k).toEqual({ slide: 0, out: 0, swing: 0, screws: 0 });
      const p = doorPose(k, 1);
      expect(p.swing, k).toBeCloseTo(SWING, 5);
      expect(p.swing, k).toBeGreaterThan(Math.PI / 2);
      expect(DOOR_SECONDS[k], k).toBeGreaterThan(0.5);
    }
  });

  it('undoes the Mini\'s thumbscrews and slides its panel back before it swings', () => {
    const early = doorPose('oem', 0.3), mid = doorPose('oem', 0.5);
    expect(early.screws).toBe(1);
    expect(early.swing).toBe(0);
    expect(mid.slide).toBeGreaterThan(200);
    expect(mid.swing).toBe(0);
  });

  it('pops the Micro\'s panel off its latches first, and lets the Mid\'s glass overshoot a little', () => {
    expect(doorPose('matte', 0.1).out).toBeGreaterThan(30);
    expect(doorPose('matte', 0.1).swing).toBe(0);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => doorPose('gamer', i / 100).swing));
    expect(peak).toBeGreaterThan(SWING);
    expect(peak).toBeLessThan(SWING * 1.1);
  });
});

describe('stepDoor', () => {
  it('stays in [0, 1] for a negative dt, a NaN dt and a huge dt', () => {
    for (const want of [0, 1] as const) {
      for (const t of [0, 0.5, 1]) {
        for (const dt of [-5, -1e-3, Number.NaN, 1e9, Infinity]) {
          const r = stepDoor(t, want, dt, 1);
          expect(r, `${want} ${t} ${dt}`).toBeGreaterThanOrEqual(0);
          expect(r, `${want} ${t} ${dt}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });
  it('a negative or NaN dt is no step', () => {
    expect(stepDoor(0.4, 1, -1, 1)).toBe(0.4);
    expect(stepDoor(0.4, 0, Number.NaN, 1)).toBe(0.4);
  });
  it('clamps a t already out of range back into [0, 1]', () => {
    expect(stepDoor(2.16, 1, 0, 1)).toBe(1);
    expect(stepDoor(2.16, 0, -0.5, 1)).toBe(1);
    expect(stepDoor(-3, 0, 0, 1)).toBe(0);
    expect(stepDoor(-3, 1, -0.5, 1)).toBe(0);
  });
  it('steps toward the target at the given pace and reaches it', () => {
    expect(stepDoor(0, 1, 0.25, 1)).toBeCloseTo(0.25, 9);
    expect(stepDoor(0.5, 0, 0.25, 1)).toBeCloseTo(0.25, 9);
    expect(stepDoor(0, 1, 10, 1)).toBe(1);
    expect(stepDoor(1, 0, 10, 1)).toBe(0);
  });
});
