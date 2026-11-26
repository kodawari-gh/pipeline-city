import { describe, expect, it } from 'vitest';
import * as popupPlace from './place';

const free: popupPlace.Rect = { x: 0, y: 50, w: 1000, h: 600 };
const size = { w: 200, h: 300 };

describe('placePopup', () => {
  it('prefers the right side, centred on the object, with a tail at its centre', () => {
    const a: popupPlace.Rect = { x: 300, y: 300, w: 80, h: 40 };
    const p = popupPlace.placePopup(a, size, free, 10);
    expect(p.side).toBe('right');
    expect(p.x).toBe(390);
    expect(p.y).toBe(320 - 150);
    expect(p.tail).toBe(150);
  });
  it('flips to the left near the right edge', () => {
    const a: popupPlace.Rect = { x: 900, y: 300, w: 60, h: 60 };
    const p = popupPlace.placePopup(a, size, free, 10);
    expect(p.side).toBe('left');
    expect(p.x).toBe(900 - 10 - 200);
  });
  it('falls to below, then above, when the sides do not fit', () => {
    const wide: popupPlace.Rect = { x: 50, y: 60, w: 900, h: 60 };
    expect(popupPlace.placePopup(wide, size, free, 10).side).toBe('below');
    const low: popupPlace.Rect = { x: 50, y: 560, w: 900, h: 60 };
    expect(popupPlace.placePopup(low, size, free, 10).side).toBe('above');
  });
  it('clamps vertically inside the free area and moves the tail', () => {
    const a: popupPlace.Rect = { x: 100, y: 60, w: 40, h: 20 };
    const p = popupPlace.placePopup(a, size, free, 10);
    expect(p.side).toBe('right');
    expect(p.y).toBe(50);
    expect(p.tail).toBe(70 - 50);
  });
  it('never covers the object and never leaves the free area', () => {
    for (let i = 0; i < 200; i++) {
      const a: popupPlace.Rect = { x: (i * 37) % 950, y: 50 + ((i * 91) % 540), w: 20 + (i % 60), h: 20 + (i % 40) };
      const p = popupPlace.placePopup(a, size, free, 8);
      const box: popupPlace.Rect = { x: p.x, y: p.y, ...size };
      expect(box.x).toBeGreaterThanOrEqual(free.x);
      expect(box.y).toBeGreaterThanOrEqual(free.y);
      expect(box.x + box.w).toBeLessThanOrEqual(free.x + free.w);
      expect(box.y + box.h).toBeLessThanOrEqual(free.y + free.h);
      if (p.side !== 'dock') {
        expect(popupPlace.overlaps(box, a)).toBe(false);
      }
    }
  });
  it('docks at the bottom right when nothing fits', () => {
    const huge: popupPlace.Rect = { x: 0, y: 50, w: 1000, h: 600 };
    const p = popupPlace.placePopup(huge, size, free, 10);
    expect(p.side).toBe('dock');
    expect(p.x).toBe(800);
    expect(p.y).toBe(350);
  });
  it('honours a custom order (above first for inventory tiles)', () => {
    const tile: popupPlace.Rect = { x: 400, y: 500, w: 100, h: 100 };
    expect(popupPlace.placePopup(tile, size, free, 10, ['above', 'right']).side).toBe('above');
  });
});

describe('liftAbove', () => {
  const card: popupPlace.Rect = { x: 300, y: 700, w: 400, h: 100 };
  it('does nothing when the target is clear of the card', () => {
    expect(popupPlace.liftAbove(card, { x: 100, y: 100, w: 50, h: 50 }, 10, 60)).toBe(0);
    expect(popupPlace.liftAbove(card, null, 10, 60)).toBe(0);
  });
  it('lifts the card above a target it covers', () => {
    const t: popupPlace.Rect = { x: 450, y: 720, w: 50, h: 40 };
    const dy = popupPlace.liftAbove(card, t, 10, 60);
    expect(dy).toBeLessThan(0);
    expect(popupPlace.overlaps({ ...card, y: card.y + dy }, t)).toBe(false);
  });
  it('leaves the card alone when no position clears a tall target', () => {
    const t: popupPlace.Rect = { x: 450, y: 120, w: 50, h: 700 };
    expect(popupPlace.liftAbove(card, t, 10, 60)).toBe(0);
  });
});

describe('comfortablyVisible', () => {
  it('is true near the middle and false at the edges', () => {
    expect(popupPlace.comfortablyVisible({ x: 480, y: 300, w: 40, h: 40 }, free)).toBe(true);
    expect(popupPlace.comfortablyVisible({ x: 980, y: 300, w: 40, h: 40 }, free)).toBe(false);
    expect(popupPlace.comfortablyVisible({ x: 480, y: 40, w: 40, h: 40 }, free)).toBe(false);
  });
});
