// Unit tests for the box rules of the layout browser script (ticket #47). Pure: no browser.
import { describe, expect, it } from 'vitest';
import {
  type Box,
  type Control,
  containedIn,
  controlProblems,
  freeWidth,
  missingNames,
  outsideClip,
  outsideViewport,
  overlappingControls,
  overlaps,
  pageOverflows,
} from './layoutRects';

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, r: x + w, b: y + h });
const ctl = (id: number, label: string, b: Box, ancestors: number[] = [], clips: Control['clips'] = []): Control => ({
  id,
  label,
  box: b,
  ancestors,
  clips,
});

describe('overlaps', () => {
  it('is true for boxes that share area', () => {
    expect(overlaps(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(true);
  });

  it('is false for boxes that only touch an edge', () => {
    expect(overlaps(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(false);
    expect(overlaps(box(0, 0, 10, 10), box(0, 10, 10, 10))).toBe(false);
  });

  it('ignores a sub-pixel overlap inside the slack', () => {
    expect(overlaps(box(0, 0, 10.3, 10), box(10, 0, 10, 10))).toBe(false);
  });

  it('is false for boxes apart', () => {
    expect(overlaps(box(0, 0, 10, 10), box(40, 40, 10, 10))).toBe(false);
  });
});

describe('outsideViewport', () => {
  it('passes a box inside the window, and the window edge itself', () => {
    expect(outsideViewport(box(0, 0, 390, 844), 390, 844)).toBe(false);
  });

  it('flags a box that reaches past the right or bottom edge', () => {
    expect(outsideViewport(box(300, 0, 120, 40), 390, 844)).toBe(true);
    expect(outsideViewport(box(0, 800, 40, 80), 390, 844)).toBe(true);
  });

  it('flags a box that starts left of or above the window', () => {
    expect(outsideViewport(box(-20, 0, 40, 40), 390, 844)).toBe(true);
    expect(outsideViewport(box(0, -20, 40, 40), 390, 844)).toBe(true);
  });
});

describe('outsideClip', () => {
  it('is false for a box inside its clipping ancestor', () => {
    expect(outsideClip(box(10, 10, 50, 20), box(0, 0, 100, 100))).toBe(false);
  });

  it('is true when the box is cut by the ancestor edge', () => {
    expect(outsideClip(box(90, 10, 50, 20), box(0, 0, 100, 100))).toBe(true);
  });
});

describe('pageOverflows', () => {
  it('is false when the page fits the window', () => {
    expect(pageOverflows(844, 390, 844, 390)).toBe(false);
  });

  it('is true when the page is wider or taller than the window', () => {
    expect(pageOverflows(900, 390, 844, 390)).toBe(true);
    expect(pageOverflows(844, 480, 844, 390)).toBe(true);
  });
});

describe('overlappingControls', () => {
  it('reports two sibling controls that share area', () => {
    const pairs = overlappingControls([
      ctl(1, 'Continue', box(0, 0, 100, 40)),
      ctl(2, 'New game', box(0, 30, 100, 40)),
    ]);
    expect(pairs).toEqual([['Continue', 'New game']]);
  });

  it('does not report a control inside another control', () => {
    const pairs = overlappingControls([ctl(1, 'Row', box(0, 0, 200, 60)), ctl(2, 'Chip', box(10, 10, 40, 20), [1])]);
    expect(pairs).toEqual([]);
  });

  it('reports nothing for controls apart', () => {
    expect(overlappingControls([ctl(1, 'A', box(0, 0, 10, 10)), ctl(2, 'B', box(0, 20, 10, 10))])).toEqual([]);
  });
});

describe('controlProblems', () => {
  it('is empty for a control inside the window and not clipped', () => {
    expect(controlProblems(ctl(1, 'Build my PC', box(10, 10, 100, 40)), 390, 844)).toEqual([]);
  });

  it('names a control outside the window', () => {
    expect(controlProblems(ctl(1, 'Settings', box(300, 10, 120, 40)), 390, 844)).toEqual([
      'Settings is outside the viewport',
    ]);
  });

  it('names a control clipped by a non-scrolling ancestor', () => {
    const c = ctl(1, 'Peek', box(80, 10, 60, 40), [], [{ box: box(0, 0, 100, 100), scrolls: false }]);
    expect(controlProblems(c, 390, 844)).toEqual(['Peek is clipped']);
  });

  it('does not name a control that is cut only by a scrolling list (it scrolls inside its tab)', () => {
    const c = ctl(1, 'Row 9', box(10, 90, 60, 40), [], [{ box: box(0, 0, 100, 100), scrolls: true }]);
    expect(controlProblems(c, 390, 844)).toEqual([]);
  });

  it('does not check a row of a scrolling list against the window, even when it is below the window', () => {
    const c = ctl(1, 'Row 12', box(10, 900, 60, 40), [], [{ box: box(0, 0, 390, 1000), scrolls: true }]);
    expect(controlProblems(c, 390, 844)).toEqual([]);
  });
});

describe('toast against Paused rows (SPEC 4.10, 9 step 9)', () => {
  const rows = [box(16, 200, 328, 56), box(16, 262, 328, 56)];
  it('a toast at the phone menu position (x 16, y 140) clears the rows', () => {
    expect(rows.some((r) => overlaps(box(16, 140, 328, 40), r))).toBe(false);
  });
  it('a toast over the first row is found', () => {
    expect(rows.some((r) => overlaps(box(16, 190, 328, 40), r))).toBe(true);
  });
});

describe('pinned controls on screen (SPEC 6.5)', () => {
  it('a bottom dock inside 844 x 390 is on screen, one that sinks below it is not', () => {
    expect(outsideViewport(box(300, 340, 244, 44), 844, 390)).toBe(false);
    expect(outsideViewport(box(300, 360, 244, 44), 844, 390)).toBe(true);
  });
});

describe('freeWidth', () => {
  it('is the whole window with no tab', () => {
    expect(freeWidth(844, [])).toBe(844);
  });
  it('subtracts a tab, counts overlapping tabs once, and clips to the window', () => {
    expect(freeWidth(844, [box(0, 0, 100, 390), box(50, 0, 100, 390)])).toBe(694);
    expect(freeWidth(844, [box(800, 0, 200, 390)])).toBe(800);
  });
  it('keeps at least 40 % of 844 with a rail column (96) and a parts tab of 45 % open', () => {
    expect(freeWidth(844, [box(0, 0, 96, 390), box(96, 0, 0.45 * 844, 390)]) / 844).toBeGreaterThanOrEqual(0.4);
  });
  it('fails 40 % when the parts row takes 60 %', () => {
    expect(freeWidth(844, [box(0, 0, 96, 390), box(96, 0, 0.6 * 844, 390)]) / 844).toBeLessThan(0.4);
  });
});

describe('missingNames', () => {
  it('lists the categories a rail does not show', () => {
    expect(missingNames(['CS', 'RTR', 'ISP'], ['cs', 'ISP'])).toEqual(['RTR']);
    expect(missingNames(['CS'], ['CS'])).toEqual([]);
  });
});

describe('containedIn', () => {
  it('a tag inside the rail is in view, one below it is not', () => {
    expect(containedIn(box(26, 700, 40, 34), box(0, 150, 96, 600))).toBe(true);
    expect(containedIn(box(26, 740, 40, 34), box(0, 150, 96, 600))).toBe(false);
  });
});
