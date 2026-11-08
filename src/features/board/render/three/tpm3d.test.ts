import { describe, expect, it } from 'vitest';
import { Box3, Group } from 'three';
import { headerRect, tpmHeader, tpmRect } from '@/core/render/accelart';
import type { RectLike } from '@/core/render/three/geometry';
import { tpmGeo, tpmLed } from '@/features/tpm/render/tpmlayout';
import { setLayoutTier } from '../layout/layout';
import { tpmModel, TPM_Z } from './tpm3d';

describe('the TPM module', () => {
  it('is a real 18 x 13 mm board, 1 mm thick, on its female connector over the header, its die and its LED on their faces', () => {
    setLayoutTier(3, 3);
    const p = tpmRect(3)!, hr = headerRect(tpmHeader(3)!);
    for (const visual of ['tpm-1', 'tpm-2']) {
      const g = new Group(), faces: { r: RectLike; z: number }[] = [];
      expect(tpmModel(g, visual, (_, r, z) => faces.push({ r, z }))).not.toBeNull();
      const pcb = new Box3().setFromObject(g.getObjectByName('tpm-pcb')!), all = new Box3().setFromObject(g);
      expect((pcb.max.x - pcb.min.x) / 23, visual).toBeCloseTo(18.3, 1);
      expect((pcb.max.y - pcb.min.y) / 23, visual).toBeCloseTo(13, 1);
      expect(pcb.min.z).toBeCloseTo(TPM_Z.pcb, 0);
      expect(pcb.max.z - pcb.min.z).toBeCloseTo(22, 0);
      // nothing reaches past the board's outline; the connector stands down onto the header's base, inside the header
      expect(all.min.x).toBeGreaterThanOrEqual(p.x - 1);
      expect(all.max.x).toBeLessThanOrEqual(p.x + p.w + 1);
      expect(all.min.z).toBeCloseTo(TPM_Z.mate - 1, 0);
      // the parts on top stay low: a bare chip about 1 mm, the TPM 2's can under 2 mm
      expect(all.max.z - TPM_Z.top, visual).toBeLessThan(visual === 'tpm-2' ? 46 : 30);
      // the die's face covers the die over the chip's top, the LED's face its lens
      const geo = tpmGeo(visual, hr), [die, led] = faces;
      expect(faces.length).toBe(2);
      expect(die!.r.x).toBeLessThanOrEqual(geo.die.x);
      expect(die!.r.x + die!.r.w).toBeGreaterThanOrEqual(geo.die.x + geo.die.w);
      expect(die!.z).toBeGreaterThan(TPM_Z.top + 20);
      const L = tpmLed(geo);
      expect(L.x).toBeGreaterThan(led!.r.x);
      expect(L.x).toBeLessThan(led!.r.x + led!.r.w);
      expect(L.y).toBeGreaterThan(led!.r.y);
      expect(L.y).toBeLessThan(led!.r.y + led!.r.h);
    }
  });

  it('has nothing to stand on where the board has no TPM header', () => {
    setLayoutTier(0, 0);
    expect(tpmModel(new Group(), 'tpm-1')).toBeNull();
    setLayoutTier(3, 3);
  });
});
