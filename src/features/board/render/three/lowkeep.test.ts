import { afterEach, describe, expect, it } from 'vitest';
import { Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { setLowDetail } from '@/core/render/three/detail';
import { KEEP_SPEC } from '@/core/render/three/materials';
import { NON_METAL } from '@/core/render/three/cheapmaterials';
import { MONITOR, SCREEN, setLayoutTier } from '@/features/board/render/layout/layout';
import { Monitor } from '@/features/room/render/three/props3d';
import { coolerModel, hose } from './cooler3d';
import { sleeveMat } from './cables3d';



const meshes = (o: Object3D): Mesh[] => { const out: Mesh[] = []; o.traverse((c) => { if ((c as Mesh).isMesh) out.push(c as Mesh); }); return out; };
const mats = (o: Object3D): MeshStandardMaterial[] => meshes(o).flatMap((m) => [m.material].flat() as MeshStandardMaterial[]);

describe('Low keeps what must read as metal or weave (KEEP_SPEC, the pump cap, the merges)', () => {
  afterEach(() => { setLowDetail(false); });
  it('the loop hose\'s crimped ferrules keep their PBR at Low and are unflagged at High', () => {
    const end = { at: [0, 0, 0] as [number, number, number], dir: [0, -1, 0] as [number, number, number] };
    const far = { at: [400, 0, 0] as [number, number, number], dir: [0, -1, 0] as [number, number, number] };
    for (const low of [false, true]) {
      setLowDetail(low);
      const ferrules = mats(hose(end, far, { planes: [], solids: [] })).filter((m) => m.color.getHex() === 0x2a3048);
      expect(ferrules.length, `ferrules at Low ${low}`).toBeGreaterThan(0);
      for (const m of ferrules) expect(m.userData[KEEP_SPEC] === true, `ferrule at Low ${low}`).toBe(low);
    }
  });

  it('a sleeve woven with a tint keeps its PBR (the weave shows the key\'s light), a plain jacket does not', () => {
    expect(sleeveMat('#0c1226', '#464078').userData[KEEP_SPEC]).toBe(true);
    expect(sleeveMat('#0c1226', null).userData[KEEP_SPEC]).toBeUndefined();
  });

  it('the liquid cooler\'s pump cap is polished metal (metalness 0.8) at High, a Lambert\'s metalness at Low', () => {
    for (const low of [false, true]) {
      setLowDetail(low);
      setLayoutTier(3, 3);
      const caps = mats(coolerModel('cooler-liquid').root).filter((m) => m.color.getHex() === 0xffffff && m.roughness === 0.3);
      expect(caps.length, `cap at Low ${low}`).toBeGreaterThan(0);
      for (const m of caps) expect(m.metalness, `cap at Low ${low}`).toBeCloseTo(low ? NON_METAL : 0.8, 5);
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
