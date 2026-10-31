import { describe, expect, it } from 'vitest';
import { CASE_CUTS, CASE_KIND, WINDOW_CUTS, caseWindow, cutRect, growCuts, isCut, showPillars } from './casedecor';

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

describe('the showcase shapes', () => {
  it('only the showcase body has chamfered corners', () => {
    expect(CASE_KIND.filter((k) => isCut(CASE_CUTS[k]))).toEqual(['show']);
  });

  it('the showcase window cuts fit inside the window, and its pillars flank the window without touching it', () => {
    const win = caseWindow('show');
    for (const c of WINDOW_CUTS.show) expect(c * 2).toBeLessThan(Math.min(win.w, win.h));
    const [west, east] = showPillars(win);
    expect(west.x + west.w).toBeLessThanOrEqual(win.x);
    expect(east.x).toBeGreaterThanOrEqual(win.x + win.w);
  });

  it('growing a cut keeps a square corner square', () => {
    expect(growCuts([0, 100, 0, 50], 10)).toEqual([0, 110, 0, 60]);
    expect(growCuts([0, 5, 0, 0], -20)).toEqual([0, 0, 0, 0]);
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
