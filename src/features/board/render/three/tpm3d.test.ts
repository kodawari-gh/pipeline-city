import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { headerRect, tpmHeader, tpmRect } from '@/core/render/accelart';
import type { RectLike } from '@/core/render/three/geometry';
import { tpmGeo, tpmLed } from '@/features/tpm/render/tpmlayout';
import { setLayoutTier } from '../layout/layout';
import { tpmModel, TPM_Z } from './tpm3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isInstancedMesh = (o: unknown): o is three.InstancedMesh =>
  typeof o === 'object' && o !== null && 'isInstancedMesh' in o && o.isInstancedMesh === true;
function asInstancedMesh(o: unknown): three.InstancedMesh {
  if (!isInstancedMesh(o)) {
    throw new Error('expected a InstancedMesh');
  }
  return o;
}

function assert_is_a_real_18_x_13_mm_board_1_mm_thick_on_its_fem(): void {
  setLayoutTier(3, 3);
  const p = must(tpmRect(3)),
    hr = headerRect(must(tpmHeader(3)));
  for (const visual of ['tpm-1', 'tpm-2']) {
    const g = new three.Group(),
      faces: { r: RectLike; z: number }[] = [];
    expect(
      tpmModel(g, visual, (_, r, z) => {
        faces.push({ r, z });
      }),
    ).not.toBeNull();
    const pcb = new three.Box3().setFromObject(must(g.getObjectByName('tpm-pcb'))),
      all = new three.Box3().setFromObject(g);
    expect((pcb.max.x - pcb.min.x) / 23).toBeCloseTo(18.3, 1);
    expect((pcb.max.y - pcb.min.y) / 23).toBeCloseTo(13, 1);
    expect(pcb.min.z).toBeCloseTo(TPM_Z.pcb, 0);
    expect(pcb.max.z - pcb.min.z).toBeCloseTo(22, 0);
    // nothing reaches past the board's outline; the connector stands down onto the header's base, inside the header
    expect(all.min.x).toBeGreaterThanOrEqual(p.x - 1);
    expect(all.max.x).toBeLessThanOrEqual(p.x + p.w + 1);
    expect(all.min.z).toBeCloseTo(TPM_Z.mate - 1, 0);
    // the parts on top stay low: a bare chip about 1 mm (no can: a TPM sends no radio)
    expect(all.max.z - TPM_Z.top).toBeLessThan(30);
    // the chip is a TSSOP-28: 14 legs on each long side
    expect(asInstancedMesh(g.getObjectByName('tpm-legs')).count).toBe(28);
    // the die's face covers the die over the chip's top, the LED's face its lens
    const geo = tpmGeo(visual, hr),
      [die, led] = faces;
    expect(faces).toHaveLength(2);
    expect(must(die).r.x).toBeLessThanOrEqual(geo.die.x);
    expect(must(die).r.x + must(die).r.w).toBeGreaterThanOrEqual(geo.die.x + geo.die.w);
    expect(must(die).z).toBeGreaterThan(TPM_Z.top + 20);
    const L = tpmLed(geo);
    expect(L.x).toBeGreaterThan(must(led).r.x);
    expect(L.x).toBeLessThan(must(led).r.x + must(led).r.w);
    expect(L.y).toBeGreaterThan(must(led).r.y);
    expect(L.y).toBeLessThan(must(led).r.y + must(led).r.h);
  }
}

describe('the TPM module', () => {
  it('is a real 18 x 13 mm board, 1 mm thick, on its female connector over the header, its die and its LED on their faces', () => {
    expect.hasAssertions();
    assert_is_a_real_18_x_13_mm_board_1_mm_thick_on_its_fem();
  });

  it('has nothing to stand on where the board has no TPM header', () => {
    setLayoutTier(0, 0);
    expect(tpmModel(new three.Group(), 'tpm-1')).toBeNull();
    setLayoutTier(3, 3);
  });
});
