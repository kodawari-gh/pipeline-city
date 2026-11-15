import { describe, expect, it } from 'vitest';
import { currentTextResolution, registerLabel, sweepLabels } from './camera';

describe('the label list (PERF12)', () => {
  it('drops destroyed labels on a sweep and keeps the live ones', () => {
    const live = { alpha: 1 };
    registerLabel(live, 1, 10);
    const base = sweepLabels();
    const gone = Array.from({ length: 2000 }, () => ({ alpha: 1, destroyed: false }));
    for (const t of gone) registerLabel(t, 1, 10);
    expect(sweepLabels()).toBe(base + 2000);
    for (const t of gone) t.destroyed = true;
    expect(sweepLabels()).toBe(base);
  });

  it('new labels use the text resolution 2', () => {
    expect(currentTextResolution()).toBe(2);
  });
});
