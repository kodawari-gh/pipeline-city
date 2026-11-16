import { afterEach, describe, expect, it } from 'vitest';
import { Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { setLowDetail } from '@/core/render/three/detail';
import { MONITOR, SCREEN, setLayoutTier } from '@/features/board/render/layout/layout';
import { Monitor } from '@/features/room/render/three/props3d';
import { coolerModel } from './cooler3d';



const meshes = (o: Object3D): Mesh[] => { const out: Mesh[] = []; o.traverse((c) => { if ((c as Mesh).isMesh) out.push(c as Mesh); }); return out; };
const mats = (o: Object3D): MeshStandardMaterial[] => meshes(o).flatMap((m) => [m.material].flat() as MeshStandardMaterial[]);

describe('Low keeps what must read as metal (the pump cap, the monitor\'s merge)', () => {
  afterEach(() => { setLowDetail(false); });

  it('the liquid cooler\'s pump cap is polished metal (metalness 0.8) at High and at Low', () => {
    for (const low of [false, true]) {
      setLowDetail(low);
      setLayoutTier(3, 3);
      const caps = mats(coolerModel('cooler-liquid').root).filter((m) => m.color.getHex() === 0xffffff && m.roughness === 0.3);
      expect(caps.length, `cap at Low ${low}`).toBeGreaterThan(0);
      for (const m of caps) expect(m.metalness, `cap at Low ${low}`).toBeCloseTo(0.8, 5);
    }
  });

  it('the monitor\'s housing, bracket and stand are drawn in fewer meshes at Low (one merge per material and parent)', () => {
    setLowDetail(false);
    const high = meshes(new Monitor(MONITOR, SCREEN, 700, 0).root).length;
    setLowDetail(true);
    const low = meshes(new Monitor(MONITOR, SCREEN, 700, 0).root).length;
    expect(low).toBeLessThan(high);
  });
});
