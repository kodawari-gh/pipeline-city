import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { CASE, PSU_FORM, setLayoutTier } from '../layout/layout';
import { basementPlan, psuOpening } from './basement3d';
import { mainsInlet, mainsPlug, PLUG_TAIL, psuBox, psuForm, psuUnit } from './psu3d';

const MM = 23;
// the supplies each case can take: the SFX ones in every case, the ATX one only in the cases with an ATX bay
const fits = (caseTier: number): string[] => (caseTier >= 2 ? ['psu-basic', 'psu-mid', 'psu-big'] : ['psu-basic', 'psu-mid']);

describe('the 3D power supply', () => {
  it('builds the small supplies as SFX units and the big one as an ATX unit, at their real sizes', () => {
    [125, 63.5, 100].forEach((mm, k) => expect([PSU_FORM.sfx.w, PSU_FORM.sfx.h, PSU_FORM.sfx.d][k]! / MM).toBeCloseTo(mm, 1));
    expect([PSU_FORM.atx.w, PSU_FORM.atx.h, PSU_FORM.atx.d].map((v) => v / MM)).toEqual([150, 86, 140]);
    expect(psuForm('psu-basic')).toBe(PSU_FORM.sfx);
    expect(psuForm('psu-mid')).toBe(PSU_FORM.sfx);
    expect(psuForm('psu-big')).toBe(PSU_FORM.atx);
  });

  it('stands each unit in its bay: its rear on the rear wall, its feet on the bay floor, inside the bay', () => {
    for (const t of [0, 1, 2, 3]) {
      setLayoutTier(t, t);
      const p = basementPlan(), u = p.psu;
      for (const v of fits(t)) {
        const b = psuBox(u, v), at = `tier ${t} ${v}`;
        expect(b.x, at).toBe(u.x);
        expect(b.x + b.w, at).toBeLessThanOrEqual(u.x + u.w);
        expect(b.y + b.h, at).toBe(u.y + u.h);
        expect(b.y, at).toBeGreaterThanOrEqual(u.y);
        expect(b.z0, at).toBeGreaterThanOrEqual(u.z0);
        expect(b.z1, at).toBeLessThanOrEqual(u.z1);
        // the whole model stays in the basement: the screw heads on the case's back, the modular sockets 4 mm proud of the east end
        const box = new Box3().setFromObject(psuUnit(p, v, v === 'psu-big', 500).root);
        expect(box.min.x, at).toBeGreaterThan(CASE.x - 5 * MM);
        expect(box.max.x, at).toBeLessThanOrEqual(u.x + u.w + 5 * MM);
        expect(-box.max.y, at).toBeGreaterThan(p.top);
        expect(-box.min.y, at).toBeLessThanOrEqual(p.floor);
      }
    }
  });

  it('puts the C14 inlet in the rear wall\'s opening and seats the C13 plug in it, the cord leaving its tail', () => {
    for (const t of [0, 3]) {
      setLayoutTier(t, t);
      const p = basementPlan(), o = psuOpening(p.psu);
      for (const v of fits(t)) {
        const [x, y, z] = mainsInlet(p, v), at = `tier ${t} ${v}`;
        expect(x, at).toBeLessThan(CASE.x);
        expect(-y, at).toBeGreaterThan(o.y0);
        expect(-y, at).toBeLessThan(o.y1);
        expect(z, at).toBeGreaterThan(o.z0);
        expect(z, at).toBeLessThan(o.z1);
        const box = new Box3().setFromObject(mainsPlug(p, v));
        expect(box.min.x, at).toBeCloseTo(CASE.x - PLUG_TAIL, 0);
        // the nose goes into the mouth, short of its floor
        expect(box.max.x, at).toBeLessThan(CASE.x + 7 * MM);
        expect(box.max.x, at).toBeGreaterThan(CASE.x);
        // the grip: 22 mm tall, 30 mm wide round the inlet's middle
        expect((box.max.y - box.min.y) / MM, at).toBeCloseTo(23, 0);
        expect((box.max.z - box.min.z) / MM, at).toBeCloseTo(31, 0);
      }
    }
  });
});
