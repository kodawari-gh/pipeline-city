import { describe, expect, it } from 'vitest';
import { comfortablyVisible, liftAbove, overlaps, placePopup, type Rect } from './place';

const free: Rect = { x: 0, y: 50, w: 1000, h: 600 };
const size = { w: 200, h: 300 };

describe('placePopup', () => {
  it('prefers the right side, centred on the object, with a tail at its centre', () => {
    const a: Rect = { x: 300, y: 300, w: 80, h: 40 };
    const p = placePopup(a, size, free, 10);
    expect(p.side).toBe('right');
    expect(p.x).toBe(390);
    expect(p.y).toBe(320 - 150);
    expect(p.tail).toBe(150);
  });
  it('flips to the left near the right edge', () => {
    const a: Rect = { x: 900, y: 300, w: 60, h: 60 };
    const p = placePopup(a, size, free, 10);
    expect(p.side).toBe('left');
    expect(p.x).toBe(900 - 10 - 200);
  });
  it('falls to below, then above, when the sides do not fit', () => {
    const wide: Rect = { x: 50, y: 60, w: 900, h: 60 };
    expect(placePopup(wide, size, free, 10).side).toBe('below');
    const low: Rect = { x: 50, y: 560, w: 900, h: 60 };
    expect(placePopup(low, size, free, 10).side).toBe('above');
  });
  it('clamps vertically inside the free area and moves the tail', () => {
    const a: Rect = { x: 100, y: 60, w: 40, h: 20 };
    const p = placePopup(a, size, free, 10);
    expect(p.side).toBe('right');
    expect(p.y).toBe(50);
    expect(p.tail).toBe(70 - 50);
  });
  it('never covers the object and never leaves the free area', () => {
    for (let i = 0; i < 200; i++) {
      const a: Rect = { x: (i * 37) % 950, y: 50 + ((i * 91) % 540), w: 20 + (i % 60), h: 20 + (i % 40) };
      const p = placePopup(a, size, free, 8);
      const box: Rect = { x: p.x, y: p.y, ...size };
      expect(box.x).toBeGreaterThanOrEqual(free.x);
      expect(box.y).toBeGreaterThanOrEqual(free.y);
      expect(box.x + box.w).toBeLessThanOrEqual(free.x + free.w);
      expect(box.y + box.h).toBeLessThanOrEqual(free.y + free.h);
      if (p.side !== 'dock') expect(overlaps(box, a)).toBe(false);
    }
  });
  it('docks at the bottom right when nothing fits', () => {
    const huge: Rect = { x: 0, y: 50, w: 1000, h: 600 };
    const p = placePopup(huge, size, free, 10);
    expect(p.side).toBe('dock');
    expect(p.x).toBe(800);
    expect(p.y).toBe(350);
  });
  it('honours a custom order (above first for inventory tiles)', () => {
    const tile: Rect = { x: 400, y: 500, w: 100, h: 100 };
    expect(placePopup(tile, size, free, 10, ['above', 'right']).side).toBe('above');
  });
});

describe('liftAbove', () => {
  const card: Rect = { x: 300, y: 700, w: 400, h: 100 };
  it('does nothing when the target is clear of the card', () => {
    expect(liftAbove(card, { x: 100, y: 100, w: 50, h: 50 }, 10, 60)).toBe(0);
    expect(liftAbove(card, null, 10, 60)).toBe(0);
  });
  it('lifts the card above a target it covers', () => {
    const t: Rect = { x: 450, y: 720, w: 50, h: 40 };
    const dy = liftAbove(card, t, 10, 60);
    expect(dy).toBeLessThan(0);
    expect(overlaps({ ...card, y: card.y + dy }, t)).toBe(false);
  });
  it('leaves the card alone when no position clears a tall target', () => {
    const t: Rect = { x: 450, y: 120, w: 50, h: 700 };
    expect(liftAbove(card, t, 10, 60)).toBe(0);
  });
});

describe('comfortablyVisible', () => {
  it('is true near the middle and false at the edges', () => {
    expect(comfortablyVisible({ x: 480, y: 300, w: 40, h: 40 }, free)).toBe(true);
    expect(comfortablyVisible({ x: 980, y: 300, w: 40, h: 40 }, free)).toBe(false);
    expect(comfortablyVisible({ x: 480, y: 40, w: 40, h: 40 }, free)).toBe(false);
  });
});
