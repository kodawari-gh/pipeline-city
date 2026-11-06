import { describe, expect, it } from 'vitest';
import { BINS, HIGH_C, LocalEye, MAX_DOWN, MAX_UP, MID, SHADOW_C, gridSize, lift } from './localeye';

describe("the eye's local adaptation", () => {
  it('cuts the picture in cells, the last one cut short', () => {
    expect(gridSize(1920, 1080)).toEqual([60, 34]);
    expect(gridSize(1, 1)).toEqual([1, 1]);
  });

  it('keeps middle grey, lifts the dark and holds back the bright, within the caps', () => {
    const mid = Math.log2(MID / 2.2);
    expect(lift(mid, 2.2)).toBeCloseTo(0);
    expect(lift(mid - 4, 2.2)).toBeCloseTo(4 * (1 - SHADOW_C));
    expect(lift(mid + 2, 2.2)).toBeCloseTo(-2 * (1 - HIGH_C));
    expect(lift(mid - 40, 2.2)).toBe(MAX_UP);
    expect(lift(mid + 40, 2.2)).toBe(-MAX_DOWN);
  });

  it('follows the exposure and the key: a brighter exposure or a lower key lowers the grey it adapts to', () => {
    expect(lift(Math.log2(MID / 4), 4)).toBeCloseTo(0);
    expect(lift(Math.log2(MID / 2), 4)).toBeLessThan(0);
    // a night key four times lower: the same dark wall is lifted two stops' worth less
    const wall = Math.log2(MID / 2.2) - 8;
    expect(lift(wall, 2.2) - lift(wall, 2.2, MID / 4)).toBeCloseTo(2 * (1 - SHADOW_C));
  });

  it('keeps more of the bright with a higher share (the night), and the dark as it was', () => {
    const mid = Math.log2(MID / 2.2);
    expect(lift(mid + 3, 2.2, MID, 0.8)).toBeCloseTo(-3 * 0.2);
    expect(lift(mid + 3, 2.2, MID, 0.8)).toBeGreaterThan(lift(mid + 3, 2.2));
    expect(lift(mid - 3, 2.2, MID, 0.8)).toBeCloseTo(lift(mid - 3, 2.2));
  });

  it('sizes its grid to the picture, a bin a stop in each cell', () => {
    const eye = new LocalEye(1920, 1080);
    const grid = (eye as unknown as { grid: { width: number; height: number } }).grid;
    expect([grid.width, grid.height]).toEqual([60 * BINS, 34]);
    eye.setSize(640, 360);
    expect([grid.width, grid.height]).toEqual([20 * BINS, 12]);
    eye.dispose();
  });
});
