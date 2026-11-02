import { describe, expect, it } from 'vitest';
import { dist, type V3 } from '@/core/render/three/rope';
import { FAR_PX, POP_PX, SNAP_PX, insertOffset, insertTime, keepClear, pullOffset, snapWeight, springStep, withinReach } from './plughand3d';

describe('the hand that holds a plug', () => {
  it('carries the plug to its goal on a spring that does not overshoot, at any frame rate', () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      let x = 0, v = 0, max = 0;
      for (let t = 0; t < 0.5; t += dt) { [x, v] = springStep(x, v, 100, 25, dt); max = Math.max(max, x); }
      expect(x, `dt ${dt}`).toBeGreaterThan(99);
      expect(max, `dt ${dt}`).toBeLessThanOrEqual(100 + 1e-9);
    }
    // one long step lands where many short ones do
    let a = 0, va = 0;
    for (let i = 0; i < 10; i++) [a, va] = springStep(a, va, 50, 25, 0.01);
    expect(springStep(0, 0, 50, 25, 0.1)[0]).toBeCloseTo(a, 6);
  });

  it('slides a plug in from its full engage to the latch, faster near the end, then clicks just past it and back', () => {
    const dur = insertTime(110);
    expect(insertOffset(0, dur)).toBe(1);
    expect(insertOffset(dur / 2, dur)).toBeCloseTo(0.75);
    expect(insertOffset(dur, dur)).toBeCloseTo(0);
    expect(insertOffset(dur + 0.025, dur)).toBeLessThan(0);
    expect(insertOffset(dur + 1, dur)).toBeCloseTo(0);
    // a long run through the desk takes longer, up to a cap
    expect(insertTime(900)).toBeGreaterThan(insertTime(110));
    expect(insertTime(5000)).toBeLessThanOrEqual(0.4);
  });

  it('pulls a seated plug out slowly against its latch, then pops it free', () => {
    expect(pullOffset(0)).toEqual({ out: 0, popped: false });
    expect(pullOffset(POP_PX / 2).out).toBeLessThan(pullOffset(POP_PX).out / 2);
    expect(pullOffset(POP_PX - 1).popped).toBe(false);
    expect(pullOffset(POP_PX).popped).toBe(true);
    expect(pullOffset(POP_PX * 4).out).toBe(pullOffset(POP_PX).out);
  });

  it('squares the plug to its socket as it comes near on screen', () => {
    expect(snapWeight(FAR_PX + 50)).toBe(0);
    expect(snapWeight(SNAP_PX)).toBe(1);
    expect(snapWeight(0)).toBe(1);
    const mid = snapWeight((FAR_PX + SNAP_PX) / 2);
    expect(mid).toBeCloseTo(0.5);
    expect(snapWeight(FAR_PX - 20)).toBeLessThan(snapWeight(SNAP_PX + 20));
  });

  it('keeps the plug within its cable\'s reach of the grommet', () => {
    const from: V3 = [100, 200, 300];
    expect(withinReach([150, 200, 300], from, 500)).toEqual([150, 200, 300]);
    const p = withinReach([100, 200, 2300], from, 500);
    expect(dist(p, from)).toBeCloseTo(500);
    expect(p[0]).toBeCloseTo(100);
    expect(p[2]).toBeCloseTo(800);
  });

  it('keeps a plug held over the board at its height when its cable pulls it in (never down toward the grommet behind)', () => {
    // the grommet 300 behind the plane the plug moves on, the plug 1000 out along it
    const from: V3 = [0, 0, 0], p = withinReach([1000, 0, 300], from, 500, [0, 0, 1]);
    expect(p[2]).toBeCloseTo(300);
    expect(dist(p, from)).toBeCloseTo(500);
    expect(p[0]).toBeCloseTo(400);
    expect(withinReach([300, 0, 300], from, 500, [0, 0, 1])).toEqual([300, 0, 300]);
  });

  it('keeps a held plug over the parts it passes and inside the walls', () => {
    const walls = [{ n: [0, 0, 1] as V3, d: 0 }, { n: [0, 0, -1] as V3, d: -2000 }];
    const sink = { min: [0, 0, 0] as V3, max: [400, 400, 500] as V3 }, shroud = { min: [-1000, -2000, 0] as V3, max: [1000, -1000, 2000] as V3 };
    const env = { planes: walls, solids: [sink, shroud] };
    // over the heatsink: lifted to its top, toward the glass
    expect(keepClear([200, 200, 300], env, 80)).toEqual([200, 200, 580]);
    // in the shroud, which runs to the glass: out by its top
    expect(keepClear([0, -1100, 300], env, 80)).toEqual([0, -920, 300]);
    // clear of everything: kept off the tray only
    expect(keepClear([2000, 2000, 20], env, 80)).toEqual([2000, 2000, 80]);
  });
});
