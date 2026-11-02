import { describe, expect, it } from 'vitest';
import type { V3 } from '@/core/render/three/rope';
import { FAR_PX, POP_PX, SNAP_PX, hover, insertOffset, insertTime, keepClear, pullOffset, snapWeight, springStep } from './plughand3d';

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

  it('rides a held plug over what is under the pointer, never behind it, however slanted the view', () => {
    // a case seen through its glass (z 2000), its side wall at x 2000: the tray at 0, the deck (the board's face) at 300, a part on it up to 700
    const up: V3 = [0, 0, 1], walls = [{ n: up, d: 0 }, { n: [0, 0, -1] as V3, d: -2000 }, { n: [-1, 0, 0] as V3, d: -2000 }, { n: up, d: 300 }];
    const part = { min: [0, 0, 300] as V3, max: [400, 400, 700] as V3 }, env = { planes: walls, solids: [part] };
    // straight in: on the part's top, or on the deck beside it (never down on the tray)
    expect(hover([200, 200, 5000], [0, 0, -1], env, 80, up)).toEqual([200, 200, 780]);
    expect(hover([1000, 200, 5000], [0, 0, -1], env, 80, up)).toEqual([1000, 200, 380]);
    // slanted: still 80 off the face it meets, on the pointer's ray
    const d: V3 = [0.8, 0, -0.6], p = hover([-3000, 200, 4000], d, env, 80, up)!;
    expect(p[2]).toBeCloseTo(380);
    // the part's side, met first along a flat ray, keeps the plug off it too
    expect(hover([-3000, 200, 500], [1, 0, 0], env, 80, up)).toEqual([-80, 200, 500]);
    // past the side wall it goes on to the deck, at the deck's depth (never up by the glass where the ray leaves by the wall)
    expect(hover([1800, 200, 2500], d, env, 80, up)![2]).toBeCloseTo(380);
    // a part the ray is already in where it comes through the glass (a shroud that runs to it) does not stop it; a ray away from the case meets nothing
    const shroud = { min: [-5000, -5000, 0] as V3, max: [5000, -1000, 2500] as V3 };
    expect(hover([0, -2000, 5000], [0, 0, -1], { planes: walls, solids: [shroud] }, 80, up)).toEqual([0, -2000, 380]);
    expect(hover([0, 0, 5000], [0, 0, 1], env, 80, up)).toBeNull();
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
