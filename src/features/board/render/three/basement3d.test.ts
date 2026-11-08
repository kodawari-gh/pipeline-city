import { describe, expect, it } from 'vitest';
import { CASE, CASE_IN, PC_POWER, setLayoutTier } from '../layout/layout';
import { basementPlan, psuFan, psuOpening } from './basement3d';
import { motionFor } from './buildmotion';

describe('the 3D basement', () => {
  it('gives the power supply the room to leave: its rear clears the wall, its body stops short of the vent span', () => {
    const slide = motionFor('psu').keys.find((k) => k.at[0] > 0)!.at[0];
    for (const t of [0, 1, 2, 3]) {
      setLayoutTier(t, t);
      const p = basementPlan(), u = p.psu, o = psuOpening(u);
      expect(u.x - CASE.x, `tier ${t}`).toBeLessThan(slide);
      expect(u.x + u.w + slide, `tier ${t}`).toBeLessThan(p.vent.x);
      expect(p.vent.x + p.vent.w, `tier ${t}`).toBeLessThan(p.east);
      expect(o.y0, `tier ${t}`).toBeGreaterThan(u.y);
      expect(o.y1, `tier ${t}`).toBeLessThan(u.y + u.h);
    }
  });

  it('keeps the bay\'s fan on its underside, a real 92 or 120 mm fan', () => {
    for (const t of [0, 3]) {
      setLayoutTier(t, t);
      const u = basementPlan().psu, f = psuFan(u);
      expect(f.r, `tier ${t}`).toBe((t === 0 ? 46 : 60) * 23);
      expect(f.x - f.r, `tier ${t}`).toBeGreaterThan(u.x);
      expect(f.x + f.r, `tier ${t}`).toBeLessThan(u.x + u.w);
      expect(2 * f.r, `tier ${t}`).toBeLessThan(u.z1 - u.z0);
    }
  });

  it('puts the power supply in the back corner by its inlet, under the shroud', () => {
    for (const t of [0, 1, 2, 3]) {
      setLayoutTier(t, t);
      const p = basementPlan(), u = p.psu;
      expect(u.x, `tier ${t}`).toBeGreaterThanOrEqual(CASE_IN.x);
      expect(PC_POWER.y, `tier ${t}`).toBeGreaterThan(u.y);
      expect(PC_POWER.y, `tier ${t}`).toBeLessThan(u.y + u.h);
      expect(u.y, `tier ${t}`).toBeGreaterThan(p.top);
      expect(u.y + u.h, `tier ${t}`).toBeLessThanOrEqual(CASE.y + CASE.h - 150);
    }
  });
});
