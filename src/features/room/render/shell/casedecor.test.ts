import { describe, expect, it } from 'vitest';
import { CASE_KIND, caseWindow, cutRect } from './casedecor';

describe('case decoration shapes', () => {
  it('a square corner list gives the four corners', () => {
    const p = cutRect(0, 0, 100, 50, [0, 0, 0, 0]);
    expect(p).toEqual([0, 0, 100, 0, 100, 0, 100, 50, 100, 50, 0, 50, 0, 50, 0, 0]);
  });

  it('a cut corner stays inside the box and trims only its own corner', () => {
    const p = cutRect(10, 20, 100, 60, [0, 30, 0, 0]);
    for (let i = 0; i < p.length; i += 2) {
      expect(p[i]).toBeGreaterThanOrEqual(10); expect(p[i]).toBeLessThanOrEqual(110);
      expect(p[i + 1]).toBeGreaterThanOrEqual(20); expect(p[i + 1]).toBeLessThanOrEqual(80);
    }
    expect(p.slice(2, 6)).toEqual([80, 20, 110, 50]);
  });
});

describe('case kinds and windows', () => {
  it('has a kind for each of the four case tiers', () => {
    expect(CASE_KIND).toEqual(['oem', 'matte', 'gamer', 'show']);
  });

  it('the matte window is shorter than the gaming one and the showcase one is narrower, so they match their exteriors', () => {
    const matte = caseWindow('matte'), gamer = caseWindow('gamer'), show = caseWindow('show');
    expect(matte.h).toBeLessThan(gamer.h);
    expect(show.w).toBeLessThan(gamer.w);
    expect(show.x).toBe(gamer.x);
  });
});
