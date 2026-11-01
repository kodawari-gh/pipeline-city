import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { builtinTheme } from '@/core/render/theme';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { GEO, setLayoutTier } from '../layout/layout';
import { SLOT_H, SLOT_W, dimmSlot, ramStick, stickLook, stickTop } from './ram3d';

const T = builtinTheme(true);

describe('the 3D memory sticks', () => {
  it('gives each generation its look: bare, a low spreader, fins, a light bar', () => {
    expect(['dimm-basic', 'dimm-fast', 'dimm-ddr3', 'dimm-lowlat', 'dimm-ecc', 'dimm-ddr5', 'dimm-ddr5ecc'].map(stickLook))
      .toEqual(['bare', 'low', 'fins', 'rgb', 'bare', 'rgb', 'bare']);
  });

  it('stands a stick in its socket: thin across, its fingers down in the groove, its top where the look says', () => {
    setLayoutTier(3, 3);
    const r = GEO.dimm[0]!.rect, cx = r.x + r.w / 2;
    for (const visual of ['dimm-basic', 'dimm-fast', 'dimm-ddr3', 'dimm-ddr5']) {
      const s = ramStick(T, visual, false, r), b = new Box3().setFromObject(s.root);
      expect(b.max.x - b.min.x, visual).toBeLessThan(SLOT_W);
      expect(Math.abs((b.min.x + b.max.x) / 2 - cx), visual).toBeLessThan(1);
      expect(b.min.z, visual).toBeLessThan(BOARD_Z + SLOT_H);
      expect(b.min.z, visual).toBeGreaterThan(BOARD_Z);
      expect(b.max.z, visual).toBeCloseTo(stickTop(stickLook(visual)), -1);
      expect(-b.max.y, visual).toBeGreaterThanOrEqual(r.y);
      expect(-b.min.y, visual).toBeLessThanOrEqual(r.y + r.h);
      expect(s.spins.length, visual).toBe(stickLook(visual) === 'rgb' ? 1 : 0);
    }
  });

  it('closes the latches on a stick and opens them on an empty socket', () => {
    setLayoutTier(3, 3);
    const r = GEO.dimm[0]!.rect;
    expect(dimmSlot(r, false).latches.children.map((p) => Math.abs(p.rotation.x))).toEqual([0, 0]);
    expect(dimmSlot(r, true).latches.children.map((p) => Math.abs(p.rotation.x))).toEqual([0.5, 0.5]);
  });
});
