import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { builtinTheme } from '@/core/render/theme';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { LAYOUT_CASE, LAYOUT_TIER, setLayoutTier } from '../layout/layout';
import { buildShowcaseModel } from './showcase';

const T = builtinTheme(true);
const BUILT = ['cpu', 'ram', 'gpu', 'npu', 'nic', 'cooler', 'fan', 'storage'];

describe('the showcase models', () => {
  it('builds every spec of the modelled kinds: solid, resting on the floor, centred', () => {
    for (const s of Object.values(DEVICE_SPECS).filter((x) => BUILT.includes(x.kind))) {
      const m = buildShowcaseModel(s.id, T);
      expect(m, s.id).not.toBeNull();
      const b = new Box3().setFromObject(m!), z = b.getSize(b.max.clone()), c = b.getCenter(b.max.clone());
      expect(z.x * z.y * z.z, s.id).toBeGreaterThan(0);
      expect(b.min.y, s.id).toBeCloseTo(0, 3);
      expect(Math.abs(c.x) + Math.abs(c.z), s.id).toBeLessThan(1);
    }
  });

  it('builds the cases', () => {
    for (const id of ['case0', 'case1', 'case2', 'case3']) expect(buildShowcaseModel(id, T), id).not.toBeNull();
  });

  it('stands a RAM stick with its long side along x', () => {
    const b = new Box3().setFromObject(buildShowcaseModel('ram0', T)!), s = b.getSize(b.max.clone());
    expect(s.x).toBeGreaterThan(s.y);
    expect(s.x).toBeGreaterThan(s.z);
  });

  it('leaves the live layout as it was, and gives null for an unknown id', () => {
    setLayoutTier(1, 2);
    buildShowcaseModel('case3', T);
    buildShowcaseModel('gpu0', T);
    expect([LAYOUT_TIER, LAYOUT_CASE]).toEqual([1, 2]);
    expect(buildShowcaseModel('nope', T)).toBeNull();
  });
});
