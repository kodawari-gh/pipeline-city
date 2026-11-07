import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { builtinTheme } from '@/core/render/theme';
import { LAYOUT_CASE, LAYOUT_TIER, setLayoutTier } from '../layout/layout';
import { buildShowcaseModel } from './showcase';

describe('the showcase models', () => {
  it('stands a RAM stick upright on the floor, long side along x, and leaves the live layout as it was', () => {
    setLayoutTier(1, 2);
    const m = buildShowcaseModel('ram0', builtinTheme(true));
    expect(m).not.toBeNull();
    const b = new Box3().setFromObject(m!), s = b.getSize(b.max.clone());
    expect(b.min.y).toBeCloseTo(0, 3);
    expect(s.x).toBeGreaterThan(s.y);
    expect(s.x).toBeGreaterThan(s.z);
    expect([LAYOUT_TIER, LAYOUT_CASE]).toEqual([1, 2]);
  });

  it('gives null for an unknown id', () => {
    expect(buildShowcaseModel('nope')).toBeNull();
  });
});
