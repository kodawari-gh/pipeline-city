import { describe, expect, it } from 'vitest';
import { SunMap } from './sunmap';

/** One frame of the view: the hour, then a draw with the sun at `intensity`. Returns whether the map was drawn. */
const tick = (m: SunMap, hour: number, intensity: number, casts = true): boolean => {
  m.frame(hour);
  const due = m.due(casts, intensity);
  if (due) m.drawn();
  return due;
};

describe('SunMap', () => {
  it('draws the first map, then one on each step of the sun', () => {
    const m = new SunMap();
    expect(tick(m, 14, 5.6)).toBe(true);
    expect(tick(m, 14.01, 5.6)).toBe(false);
    expect(tick(m, 14.02, 5.6)).toBe(false);
    expect(tick(m, 14.05, 5.6)).toBe(true);
    expect(tick(m, 14.05, 5.6)).toBe(false);
  });

  it('draws no map while the sun is at 0, however far the clock runs', () => {
    const m = new SunMap();
    expect(tick(m, 19, 4)).toBe(true);
    for (let h = 20.6; h < 30; h += 0.01) expect(tick(m, h % 24, 0)).toBe(false);
  });

  it('draws the owed map on the first lit frame, and only once', () => {
    const m = new SunMap();
    tick(m, 23, 0);
    tick(m, 5.9, 0);
    // (the same step: the map is still owed from the night)
    expect(tick(m, 5.91, 0.01)).toBe(true);
    expect(tick(m, 5.92, 0.02)).toBe(false);
  });

  it('draws on a jump in the hour while lit, and waits on one into the night', () => {
    const m = new SunMap();
    tick(m, 14, 5.6);
    expect(tick(m, 7, 5.6)).toBe(true);
    expect(tick(m, 23, 0)).toBe(false);
    expect(tick(m, 14, 5.6)).toBe(true);
  });

  it('draws a new map size on the next lit frame', () => {
    const m = new SunMap();
    tick(m, 14, 5.6);
    m.ask();
    expect(tick(m, 14, 0)).toBe(false);
    expect(tick(m, 14, 5.6)).toBe(true);
  });

  it('draws nothing while the sun casts no shadows, and owes the map when it does again', () => {
    const m = new SunMap();
    expect(tick(m, 14, 5.6, false)).toBe(false);
    expect(tick(m, 14, 5.6, true)).toBe(true);
  });
});
