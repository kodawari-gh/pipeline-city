import { describe, expect, it } from 'vitest';
import { BakeQueue, levelFor, screenPx, tilesOf, TILE_PX } from './artlod';

describe('tilesOf', () => {
  it('keeps a small rect in one tile', () => {
    expect(tilesOf({ x: 0, y: 0, w: 1000, h: 500 }, 1)).toEqual([{ x: 0, y: 0, w: 1000, h: 500 }]);
  });
  it('splits so no tile is wider than the limit, and covers the rect', () => {
    const r = { x: -3400, y: -2500, w: 6800, h: 6700 }, ts = tilesOf(r, 2.5);
    for (const t of ts) { expect(t.w * 2.5).toBeLessThanOrEqual(TILE_PX); expect(t.h * 2.5).toBeLessThanOrEqual(TILE_PX); }
    expect(ts.reduce((a, t) => a + t.w * t.h, 0)).toBeCloseTo(r.w * r.h);
  });
});

describe('levelFor', () => {
  const L = [0.25, 1, 2.5];
  it('picks the first level dense enough', () => {
    expect(levelFor(L, 0.1)).toBe(0);
    expect(levelFor(L, 0.5)).toBe(1);
    expect(levelFor(L, 1.2)).toBe(1); // a little under is fine
    expect(levelFor(L, 2)).toBe(2);
  });
  it('stops at the top level', () => { expect(levelFor(L, 50)).toBe(2); });
});

describe('screenPx', () => {
  it('halves when the distance doubles', () => {
    expect(screenPx(2000, 30, 900)).toBeCloseTo(screenPx(1000, 30, 900) / 2);
  });
});

describe('BakeQueue', () => {
  it('runs the most wanted first and retries a job that is not ready', () => {
    const q = new BakeQueue(), seen: string[] = [];
    let ready = false;
    q.add('b', 2, () => { seen.push('b'); return true; });
    q.add('a', 1, () => { if (!ready) return false; seen.push('a'); return true; });
    q.run();
    expect(seen).toEqual([]);
    ready = true;
    q.run();
    expect(seen).toEqual(['a', 'b']);
    expect(q.size).toBe(0);
  });
  it('drops the jobs of a surface', () => {
    const q = new BakeQueue();
    q.add('art1:0:0', 0, () => true); q.add('art2:0:0', 0, () => true);
    q.drop('art1:');
    expect(q.size).toBe(1);
  });
});
