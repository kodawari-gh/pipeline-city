import { afterEach, describe, expect, it } from 'vitest';
import { Group, Mesh, PlaneGeometry, TubeGeometry, type Object3D } from 'three';
import { byDetail, lowDetail, setLowDetail } from '@/core/render/three/detail';
import { driveBody } from '@/features/storage/render/drives';
import { setLayoutTier } from '../layout/layout';
import { coolerModel } from './cooler3d';
import { machineKey } from './machine3d';
import { nvmeStick } from './nvme3d';
import type { Snapshot } from '@/worker/protocol';

afterEach(() => { setLowDetail(false); });

const meshes = (o: Object3D) => { const out: Mesh[] = []; o.traverse((c) => { if ((c as Mesh).isMesh) out.push(c as Mesh); }); return out; };
const tubes = (o: Object3D) => meshes(o).flatMap((m) => (m.geometry instanceof TubeGeometry ? [m.geometry.parameters] : []));
/** The tower's tubes as `tubular x radial`, sorted: the four heat pipes and the two thread coils. */
const shapes = () => { setLayoutTier(3, 3); return tubes(coolerModel('cooler-tower').root).map((p) => `${p.tubularSegments}x${p.radialSegments}`).sort(); };
const label = (): PlaneGeometry => {
  const g = new Group();
  nvmeStick(g, driveBody('ssd-nvme', 'm20'), { name: 'NVMe SSD 128K', capacityBytes: 128 * 1024, heatsink: false });
  const planes = meshes(g).filter((m) => m.geometry instanceof PlaneGeometry).map((m) => m.geometry as PlaneGeometry);
  return planes.sort((a, b) => b.parameters.widthSegments * b.parameters.heightSegments - a.parameters.widthSegments * a.parameters.heightSegments)[0]!;
};

describe('Low builds coarser machine parts', () => {
  it('byDetail picks by the flag, and setLowDetail says when it changed', () => {
    expect(lowDetail()).toBe(false);
    expect(byDetail(1, 2)).toBe(1);
    expect(setLowDetail(true)).toBe(true);
    expect(setLowDetail(true)).toBe(false);
    expect(byDetail(1, 2)).toBe(2);
  });
  it('the tower cooler: four heat pipes 40x8 and two thread coils 48x6 at Low', () => {
    setLowDetail(true);
    expect(shapes()).toEqual(['40x8', '40x8', '40x8', '40x8', '48x6', '48x6']);
  });
  it('the tower cooler at High keeps its 220x16 heat pipes and 339x6 thread coils', () => {
    expect(shapes()).toEqual(['220x16', '220x16', '220x16', '220x16', '339x6', '339x6']);
  });
  it('the NVMe label drape is about 40 units a quad at Low, 7 at High', () => {
    const high = label().parameters;
    expect([high.widthSegments, high.heightSegments]).toEqual([Math.round(high.width / 7), Math.round(high.height / 7)]);
    setLowDetail(true);
    const low = label().parameters;
    expect([low.widthSegments, low.heightSegments]).toEqual([Math.round(low.width / 40), Math.round(low.height / 40)]);
    expect(low.widthSegments * low.heightSegments).toBeLessThan((high.widthSegments * high.heightSegments) / 20);
  });
  it('the machine key changes when the detail does (so the machine is built again) and is unchanged at High', () => {
    const s = { boardTier: 1, caseTier: 1, devices: [] } as unknown as Snapshot;
    const high = machineKey(s);
    expect(high).toBe('1|1|');
    setLowDetail(true);
    expect(machineKey(s)).not.toBe(high);
    expect(machineKey(null)).toBe('none');
  });
});
