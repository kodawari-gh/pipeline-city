import { describe, expect, it } from 'vitest';
import { CASE, CASE_IN, PC_POWER, setLayoutTier } from '../layout/layout';
import { CASE_D, CASE_Z } from '@/features/room/render/three/roomplan';
import { basementPlan, cageBack, driveDepth } from './basement3d';

describe('the 3D basement', () => {
  it('puts the power supply in the back corner by its inlet, and every drive bay in the cage beside it, under the shroud', () => {
    for (const t of [0, 1, 2, 3]) {
      setLayoutTier(t, t);
      const p = basementPlan(), u = p.psu;
      expect(u.x, `tier ${t}`).toBeGreaterThanOrEqual(CASE_IN.x);
      expect(PC_POWER.y, `tier ${t}`).toBeGreaterThan(u.y);
      expect(PC_POWER.y, `tier ${t}`).toBeLessThan(u.y + u.h);
      expect(u.y + u.h, `tier ${t}`).toBeLessThanOrEqual(CASE.y + CASE.h - 150);
      for (const b of p.bays) {
        expect(b.x, `tier ${t} bay ${b.slot}`).toBeGreaterThan(u.x + u.w);
        expect(b.x + b.w, `tier ${t} bay ${b.slot}`).toBeLessThan(p.east);
        expect(b.y, `tier ${t} bay ${b.slot}`).toBeGreaterThan(p.top + 60);
        expect(b.y + b.h, `tier ${t} bay ${b.slot}`).toBeLessThanOrEqual(p.floor);
        expect(b.face, `tier ${t} bay ${b.slot}`).toBeLessThan(CASE_Z + CASE_D - 100);
        expect(b.face - driveDepth('hdd') * b.k, `tier ${t} bay ${b.slot}`).toBeGreaterThan(cageBack(p));
      }
      // no two bays overlap: side by side in a row, the back row raised behind the front one
      for (const a of p.bays) for (const b of p.bays) if (a !== b && a.row === b.row) expect(a.x + a.w <= b.x || b.x + b.w <= a.x, `tier ${t}`).toBe(true);
    }
  });

  it('shows most of each back-row drive over the front row', () => {
    setLayoutTier(3, 3);
    const p = basementPlan(), front = p.bays.find((b) => b.row === 0)!, back = p.bays.find((b) => b.row === 1);
    if (back) expect(front.y - back.y).toBeGreaterThan(back.h * 0.7);
  });
});
