// Unit tests for the pure part of tools/scene-coverage.mjs (ticket #47): the package figures, the judgement, the grid and the share. No browser.
import { describe, expect, it } from 'vitest';
// @ts-ignore
import { FIGURES, SCREENS, figureFor, gridPoints, judge, shareOf } from './scene-coverage.mjs';

describe('package figures', () => {
  it('are the ones the acceptance checklist and the spec give', () => {
    expect(SCREENS).toEqual(['hud', 'build', 'gallery']);
    expect(FIGURES.hud).toEqual({ desktop: 88, phone: 80 });
    expect(FIGURES.build).toEqual({ desktop: 75, phone: 75 });
    expect(FIGURES.gallery.desktop).toBe(85);
  });

  it('returns the desktop figure by default and the phone figure with phone=true', () => {
    expect(figureFor('hud')).toBe(88);
    expect(figureFor('hud', true)).toBe(80);
  });

  it('throws for a screen the script does not check', () => {
    expect(() => figureFor('paused')).toThrow(/unknown screen "paused"/);
  });

  it('throws for a phone figure the package does not give', () => {
    expect(() => figureFor('gallery', true)).toThrow(/no phone figure for gallery/);
  });
});

describe('judge', () => {
  it('passes a share at the figure and fails one below it', () => {
    expect(judge('gallery', 85).ok).toBe(true);
    expect(judge('gallery', 84.9).ok).toBe(false);
  });

  it('uses the phone figure for a phone layout', () => {
    expect(judge('hud', 82, true)).toEqual({ gate: 80, ok: true });
    expect(judge('hud', 82).ok).toBe(false);
  });
});

describe('gridPoints', () => {
  it('spreads the points over the viewport, by its aspect ratio', () => {
    const pts = gridPoints(844, 390, 80);
    expect(pts.length).toBe(80 * Math.round((80 * 390) / 844));
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(844);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(390);
    }
  });
});

describe('shareOf', () => {
  it('is 100 % when no point is obstructed, and 0 % when all are', () => {
    expect(shareOf([false, false, false, false])).toBe(100);
    expect(shareOf([true, true, true, true])).toBe(0);
  });

  it('rounds to one decimal', () => {
    expect(shareOf([true, false, false])).toBe(66.7);
  });

  it('throws for no points', () => {
    expect(() => shareOf([])).toThrow(/no points/);
  });
});
