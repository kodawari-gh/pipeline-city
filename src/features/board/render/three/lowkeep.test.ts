import { afterEach, describe, expect, it } from 'vitest';
import type * as three from 'three';
import { setLowDetail } from '@/core/render/three/detail';
import { MONITOR, SCREEN, setLayoutTier } from '@/features/board/render/layout/layout';
import { Monitor } from '@/features/room/render/three/props3d';
import { coolerModel } from './cooler3d';

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

const meshes = (o: three.Object3D): three.Mesh[] => {
  const out: three.Mesh[] = [];
  o.traverse((c) => {
    if (isMesh(c)) {
      out.push(c);
    }
  });
  return out;
};
const isMeshStandardMaterial = (o: unknown): o is three.MeshStandardMaterial =>
  typeof o === 'object' && o !== null && 'isMeshStandardMaterial' in o && o.isMeshStandardMaterial === true;
/** The standard materials of the meshes under `o` (only they have a roughness and a metalness). */
const mats = (o: three.Object3D): three.MeshStandardMaterial[] =>
  meshes(o)
    .flatMap((m) => [m.material].flat())
    .filter((x) => isMeshStandardMaterial(x));

function assert_the_liquid_cooler_s_pump_cap_is_polished_metal_m(): void {
  for (const low of [false, true]) {
    setLowDetail(low);
    setLayoutTier(3, 3);
    const caps = mats(coolerModel('cooler-liquid').root).filter(
      (m) => m.color.getHex() === 0xff_ff_ff && m.roughness === 0.3,
    );
    expect(caps.length, `cap at Low ${low}`).toBeGreaterThan(0);
    for (const m of caps) {
      expect(m.metalness, `cap at Low ${low}`).toBeCloseTo(0.8, 5);
    }
  }
}

describe("Low keeps what must read as metal (the pump cap, the monitor's merge)", () => {
  afterEach(() => {
    setLowDetail(false);
  });

  it("the liquid cooler's pump cap is polished metal (metalness 0.8) at High and at Low", () => {
    expect.hasAssertions();
    assert_the_liquid_cooler_s_pump_cap_is_polished_metal_m();
  });

  it("the monitor's housing, bracket and stand are drawn in fewer meshes at Low (one merge per material and parent)", () => {
    setLowDetail(false);
    const high = meshes(new Monitor(MONITOR, SCREEN, 700, 0).root).length;
    setLowDetail(true);
    const low = meshes(new Monitor(MONITOR, SCREEN, 700, 0).root).length;
    expect(low).toBeLessThan(high);
  });
});
