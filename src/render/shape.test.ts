import { describe, expect, it } from 'vitest';
import { discShape, fieldShape, lazyShape, movedShape, pick, pickReach, rectShape, rectsShape, SHAPE_PAD, type Pickable, type Shape } from './shape';

/** RGBA pixels (w by h) with alpha 255 where `on(x, y)` says so. */
const pixels = (w: number, h: number, on: (x: number, y: number) => boolean) => {
  const p = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) p[(y * w + x) * 4 + 3] = 255;
  return p;
};
/** A disc of radius `r` world units centred on (cx, cy), read at `cell` world units a pixel over a frame that starts at the origin. */
const disc = (cx: number, cy: number, r: number, cell = 10, size = 40): Shape => {
  const f = fieldShape(pixels(size, size, (x, y) => Math.hypot((x + 0.5) * cell - cx, (y + 0.5) * cell - cy) <= r), size, size, { x: 0, y: 0, w: size * cell, h: size * cell })!;
  expect(f).not.toBeNull();
  return f;
};

describe('rectangles and discs', () => {
  it('a rectangle is 0 inside and the straight or corner distance outside', () => {
    const s = rectShape({ x: 0, y: 0, w: 100, h: 50 });
    expect(s.dist(50, 25)).toBe(0);
    expect(s.dist(130, 25)).toBe(30);
    expect(s.dist(103, 54)).toBe(5);
    expect(s.outline(10)).toBeNull();
  });
  it('a union of rectangles is the nearest of them', () => {
    const s = rectsShape([{ x: 0, y: 0, w: 10, h: 100 }, { x: 0, y: 90, w: 200, h: 10 }]);
    expect(s.dist(5, 50)).toBe(0);
    expect(s.dist(100, 95)).toBe(0);
    expect(s.dist(100, 50)).toBe(40);
    expect(s.bounds).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });
  it('a disc is a distance from its rim, and its ring is a circle of the grown radius', () => {
    const s = discShape(100, 100, 40);
    expect(s.dist(100, 100)).toBe(0);
    expect(s.dist(160, 100)).toBeCloseTo(20, 9);
    for (const [x, y] of s.outline(10)![0]!) expect(Math.hypot(x - 100, y - 100)).toBeCloseTo(50, 9);
  });
  it('a moved shape answers at the new place', () => {
    const s = movedShape(discShape(0, 0, 40), 500, 200);
    expect(s.dist(500, 200)).toBe(0);
    expect(s.dist(560, 200)).toBeCloseTo(20, 9);
    expect(s.bounds).toEqual({ x: 460, y: 160, w: 80, h: 80 });
    for (const [x, y] of s.outline(0)![0]!) expect(Math.hypot(x - 500, y - 200)).toBeCloseTo(40, 9);
  });
});

describe('a silhouette read from pixels', () => {
  it('is 0 on the thing and about the real distance off it', () => {
    const s = disc(200, 200, 100);
    expect(s.dist(200, 200)).toBe(0);
    expect(s.dist(250, 200)).toBe(0);
    for (const d of [20, 60, 150]) {
      expect(s.dist(300 + d, 200)).toBeGreaterThan(d - 8);
      expect(s.dist(300 + d, 200)).toBeLessThan(d + 8);
      expect(s.dist(200, 300 + d)).toBeGreaterThan(d - 8);
      expect(s.dist(200 - (100 + d) / Math.SQRT2, 200 - (100 + d) / Math.SQRT2)).toBeGreaterThan(d - 12);
    }
  });
  it('knows its box', () => {
    const b = disc(200, 200, 100).bounds;
    expect(b.x).toBeGreaterThanOrEqual(100 - 10);
    expect(b.x + b.w).toBeLessThanOrEqual(300 + 10);
    expect(b.y).toBeGreaterThanOrEqual(100 - 10);
    expect(b.y + b.h).toBeLessThanOrEqual(300 + 10);
  });
  it('traces a closed ring at the asked distance round the edge', () => {
    const s = disc(200, 200, 100);
    for (const e of [0, 12, 40]) {
      const rings = s.outline(e)!;
      expect(rings.length).toBe(1);
      for (const [x, y] of rings[0]!) expect(Math.abs(Math.hypot(x - 200, y - 200) - (100 + e))).toBeLessThan(8);
      expect(rings[0]!.length).toBeGreaterThan(20);
    }
    expect(s.outline(12)).toBe(s.outline(12)); // the same ring again is not worked out again
  });
  it('follows a shape that is not a box: an L leaves its inner corner out', () => {
    const cell = 10, size = 40;
    const s = fieldShape(pixels(size, size, (x, y) => (x >= 5 && x < 10 && y >= 5 && y < 35) || (x >= 5 && x < 30 && y >= 30 && y < 35)), size, size, { x: 0, y: 0, w: 400, h: 400 })!;
    expect(s.dist(70, 150)).toBe(0); // the upright
    expect(s.dist(200, 330)).toBe(0); // the foot
    expect(s.dist(200, 150)).toBeGreaterThan(90); // the empty corner of the box round them: 100 from the upright
    expect(cell).toBe(10);
  });
  it('is null for nothing, and far away it is at least the margin', () => {
    expect(fieldShape(pixels(8, 8, () => false), 8, 8, { x: 0, y: 0, w: 80, h: 80 })).toBeNull();
    const s = disc(200, 200, 100);
    expect(s.dist(5000, 200)).toBeGreaterThan(SHAPE_PAD);
  });
  it('ignores faint pixels: the soft shadow under a thing is not the thing', () => {
    const p = new Uint8Array(20 * 20 * 4);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) p[(y * 20 + x) * 4 + 3] = x < 10 ? 255 : 30;
    const s = fieldShape(p, 20, 20, { x: 0, y: 0, w: 200, h: 200 })!;
    expect(s.dist(50, 100)).toBe(0);
    expect(s.dist(150, 100)).toBeGreaterThan(30);
  });
});

describe('a shape built on first use', () => {
  it('is not built for a point far from it, and is once the point is near', () => {
    let built = 0;
    const s = lazyShape({ x: 0, y: 0, w: 100, h: 100 }, () => { built++; return rectShape({ x: 0, y: 0, w: 100, h: 100 }); });
    expect(s.dist(10000, 10000)).toBeGreaterThan(SHAPE_PAD);
    expect(built).toBe(0);
    expect(s.dist(50, 50)).toBe(0);
    expect(s.dist(150, 50)).toBe(50);
    expect(built).toBe(1);
  });
});

describe('picking', () => {
  const big: Pickable = { id: 'big', rect: { x: 0, y: 0, w: 4000, h: 4000 } };
  const tiny: Pickable = { id: 'tiny', rect: { x: 1000, y: 1000, w: 100, h: 100 } };
  const back: Pickable = { id: 'back', rect: { x: -5000, y: -5000, w: 20000, h: 20000 }, base: true };

  it('a hit on a target wins, the front one first', () => {
    expect(pick([tiny, big, back], 3000, 3000, 0.1)).toBe('big');
    expect(pick([tiny, big, back], 1050, 1050, 0.1)).toBe('tiny');
    expect(pick([big, tiny, back], 1050, 1050, 0.1)).toBe('big');
    const a: Pickable = { id: 'a', rect: { x: 0, y: 0, w: 4000, h: 4000 } }, c: Pickable = { id: 'c', rect: { x: 100, y: 100, w: 3000, h: 3000 } };
    expect(pick([a, c, back], 500, 500, 0.1)).toBe('a');
    expect(pick([c, a, back], 500, 500, 0.1)).toBe('c');
  });
  it('a small target found from a little way off beats the target under the pointer that it sits on and in front of (a key beside the rack it hangs on)', () => {
    expect(pick([tiny, big], 1170, 1050, 0.1)).toBe('tiny'); // 70 units off: inside its reach (10 px wide, grown to 30: 100 units each side)
    expect(pick([tiny, big], 1300, 1050, 0.1)).toBe('big'); // 200 off: out of reach
    expect(pick([big, tiny], 1170, 1050, 0.1)).toBe('big'); // behind the large one: it does not come through
    const beside: Pickable = { id: 'beside', rect: { x: 5000, y: 1000, w: 100, h: 100 } };
    expect(pick([beside, big, back], 3500, 1050, 0.1)).toBe('big'); // not on the large one: the large one answers
  });
  it('a small target the pointer is on beats a nearer-looking miss on another small one', () => {
    const a: Pickable = { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } }, b: Pickable = { id: 'b', rect: { x: 130, y: 0, w: 100, h: 100 } };
    expect(pick([a, b], 140, 50, 0.1)).toBe('b');
    expect(pick([a, b], 90, 50, 0.1)).toBe('a');
  });
  it('a small target is found from a little way off, and the more it shrinks on screen the more it is grown', () => {
    // 100 units wide is 10 px at this zoom: grown to 30 px, so 100 units on each side
    expect(pickReach(tiny, 0.1)).toBeCloseTo(100, 9);
    expect(pick([tiny, back], 1170, 1050, 0.1)).toBe('tiny'); // 70 units off
    expect(pick([tiny, back], 1250, 1050, 0.1)).toBe('back'); // 150 units off
    expect(pickReach(tiny, 0.1)).toBeGreaterThan(pickReach(tiny, 0.2));
    expect(pickReach(big, 0.1)).toBe(0);
  });
  it('is not found from beyond its reach', () => {
    expect(pick([tiny, back], 1300, 1050, 0.1)).toBe('back');
    expect(pick([tiny], 1300, 1050, 0.1)).toBeNull();
  });
  it('the nearest of two small targets within reach wins', () => {
    const a: Pickable = { id: 'a', rect: { x: 0, y: 0, w: 100, h: 100 } }, b: Pickable = { id: 'b', rect: { x: 300, y: 0, w: 100, h: 100 } };
    expect(pick([a, b], 160, 50, 0.1)).toBe('a'); // 60 from a, 140 from b (out of its reach)
    expect(pick([a, b], 240, 50, 0.1)).toBe('b'); // 60 from b
    expect(pick([a, b], 200, 50, 0.1)).toBe('a'); // 100 from both: the front one
    expect(pick([b, a], 200, 50, 0.1)).toBe('b');

  });
  it('a near miss on a small target beats the backdrop it sits on, but being on the backdrop beats nothing', () => {
    expect(pick([tiny, back], 1150, 1050, 0.1)).toBe('tiny');
    expect(pick([tiny, back], 900, -3000, 0.1)).toBe('back');
  });
  it('skips what does not count now', () => {
    expect(pick([tiny, back], 1050, 1050, 0.1, (h) => h.id === 'tiny')).toBe('back');
  });
  it('picks by silhouette: the empty corner of a lamp-shaped box is not the lamp', () => {
    const L = fieldShape(pixels(40, 40, (x, y) => (x >= 5 && x < 10 && y >= 5 && y < 35) || (x >= 5 && x < 30 && y >= 30 && y < 35)), 40, 40, { x: 0, y: 0, w: 4000, h: 4000 })!;
    const lamp: Pickable = { id: 'lamp', rect: { x: 0, y: 0, w: 4000, h: 4000 }, shape: L };
    expect(pick([lamp, back], 750, 1500, 0.1)).toBe('lamp');
    expect(pick([lamp, back], 2500, 1500, 0.1)).toBe('back');
  });
});
