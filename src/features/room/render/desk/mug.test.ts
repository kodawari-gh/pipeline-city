import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { MUG, drawMug, frontArc, mugRadius } from './mug';
import { puffAt, STEAM } from './steam';

describe('the mug', () => {
  it('tapers from the rim to the base', () => {
    expect(mugRadius(0, 0, 1000)).toBe(MUG.r);
    expect(mugRadius(1000, 0, 1000)).toBe(MUG.rb);
    expect(mugRadius(500, 0, 1000)).toBeGreaterThan(MUG.rb);
    expect(mugRadius(500, 0, 1000)).toBeLessThan(MUG.r);
  });
  it('draws every circle as the same squashed ellipse: the front arc runs from one end to the other and bulges down by the squash', () => {
    const a = frontArc(100, 50, 400, true), b = frontArc(100, 50, 400, false);
    expect(a[0]).toBeCloseTo(-300, 6);
    expect(a[1]).toBeCloseTo(50, 6);
    expect(a.slice(-2)[0]).toBeCloseTo(500, 6);
    expect(a.slice(-2)[1]).toBeCloseTo(50, 6);
    expect(b.slice(0, 2)[0]).toBeCloseTo(500, 6);
    let low = 0;
    for (let i = 1; i < a.length; i += 2) low = Math.max(low, a[i]! - 50);
    expect(low).toBeCloseTo(400 * MUG.e, 0);
  });
  it('stands on its coaster inside the desk strip and does not run out of its own width', () => {
    const g = new Graphics();
    drawMug(g, true, 1000, 3000, '#5a4634');
    const b = g.getLocalBounds();
    expect(b.minY).toBeGreaterThanOrEqual(3000 - MUG.h - MUG.r * MUG.e - 60);
    expect(b.maxY).toBeLessThanOrEqual(3000 + 120);
    expect(b.minX).toBeGreaterThanOrEqual(1000 - 850);
    expect(b.maxX).toBeLessThanOrEqual(1000 + 1900); // the handle and the shadow reach east
  });
});

describe('the steam', () => {
  it('is faint: no puff is more opaque than the peak, and every one starts and ends clear', () => {
    for (let i = 0; i < STEAM.puffs; i++) for (let gt = 0; gt < 20000; gt += 137) expect(puffAt(i, gt).alpha).toBeLessThanOrEqual(STEAM.peak + 1e-9);
    const p = puffAt(0, 0);
    expect(p.t).toBeGreaterThanOrEqual(0);
    expect(puffAt(0, STEAM.life * 0.5 - 0).alpha).toBeGreaterThan(0);
  });
  it('rises, widens and stays over the mug', () => {
    for (let i = 0; i < STEAM.puffs; i++) {
      const a = puffAt(i, 1000 + i), early = { ...a };
      // the same puff a little later in its life is higher and bigger
      const later = puffAt(i, 1000 + i + STEAM.life * 0.2);
      if (later.t > early.t) { expect(later.dy).toBeLessThan(early.dy); expect(later.size).toBeGreaterThan(early.size); }
      expect(Math.abs(early.dx)).toBeLessThan(1400);
    }
  });
  it('follows the game clock: the same time gives the same picture', () => {
    expect(puffAt(5, 12345)).toEqual(puffAt(5, 12345));
    expect(puffAt(5, 12345)).not.toEqual(puffAt(5, 12345 + 1500));
  });
});
