import { afterEach, describe, expect, it } from 'vitest';
import { Group, Mesh, PlaneGeometry, TubeGeometry, type MeshStandardMaterial, type Object3D } from 'three';
import { byDetail, lowDetail, setLowDetail } from '@/core/render/three/detail';
import { driveBody } from '@/features/storage/render/drives';
import { setLayoutTier } from '../layout/layout';
import { NON_METAL, cheapMaterials } from '@/core/render/three/cheapmaterials';
import { KEEP_SPEC } from '@/core/render/three/materials';
import { coolerModel } from './cooler3d';
import { machineKey } from './machine3d';
import { nvmeStick } from './nvme3d';
import { sinkBody } from './sink3d';
import { builtinTheme } from '@/core/render/theme';
import type { Snapshot } from '@/worker/protocol';

afterEach(() => { setLowDetail(false); });

const meshes = (o: Object3D) => { const out: Mesh[] = []; o.traverse((c) => { if ((c as Mesh).isMesh) out.push(c as Mesh); }); return out; };
const tubes = (o: Object3D) => meshes(o).flatMap((m) => (m.geometry instanceof TubeGeometry ? [m.geometry.parameters] : []));
/** The tower's tubes as `tubular x radial`, sorted: the four heat pipes and the two thread coils. */
const shapes = () => { setLayoutTier(3, 3); return tubes(coolerModel('cooler-tower').root).map((p) => `${p.tubularSegments}x${p.radialSegments}`).sort(); };
/** The label's mesh: the plane with the label's picture on it (its material draws over the decals with an offset of -4), in the stick's group. */
const labelMesh = (): Mesh => {
  const g = new Group();
  nvmeStick(g, driveBody('ssd-nvme', 'm20'), { name: 'NVMe SSD 128K', capacityBytes: 128 * 1024, heatsink: false });
  const planes = meshes(g).filter((m) => m.geometry instanceof PlaneGeometry && !Array.isArray(m.material) && (m.material as { polygonOffsetFactor?: number }).polygonOffsetFactor === -4);
  expect(planes).toHaveLength(1);
  return planes[0]!;
};
const label = (): PlaneGeometry => labelMesh().geometry as PlaneGeometry;

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
  it('the NVMe label drape is about 7 units a quad at High, and one flat quad of the whole picture at Low', () => {
    const high = label().parameters;
    expect([high.widthSegments, high.heightSegments]).toEqual([Math.round(high.width / 7), Math.round(high.height / 7)]);
    setLowDetail(true);
    const lowMesh = labelMesh(), low = (lowMesh.geometry as PlaneGeometry).parameters;
    expect([low.widthSegments, low.heightSegments, low.width, low.height]).toEqual([1, 1, high.width, high.height]);
    // its picture keeps the whole rect (uv 0 to 1), and the quad lies at one depth, over the packages
    const uv = lowMesh.geometry.attributes.uv!, z = lowMesh.geometry.attributes.position!;
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i)), vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect([Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]).toEqual([0, 1, 0, 1]);
    expect(new Set(Array.from({ length: z.count }, (_, i) => z.getZ(i))).size).toBe(1);
  });
  it('the pump cap reads as a Lambert metal at Low (no dark metal, no PBR without reflections), as it was at High', () => {
    type M = { metalness: number; roughness: number; color: { getHex(): number } };
    const mats = (g: Object3D, keep: (m: M) => boolean) => meshes(g).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])).filter((m) => keep(m as unknown as M)) as unknown as M[];
    const cap = () => { setLayoutTier(3, 3); return mats(coolerModel('cooler-liquid').root, (m) => m.color.getHex() === 0xffffff && m.roughness === 0.3); };
    for (const build of [cap]) {
      setLowDetail(false);
      const high = build();
      expect(high.some((m) => m.metalness > 0.4)).toBe(true);
      setLowDetail(true);
      const low = build();
      expect(low.length).toBe(high.length);
      expect(high.length).toBeGreaterThan(0);
      expect(low.every((m) => m.metalness <= NON_METAL)).toBe(true);
    }
  });
  it('the sink casting and its fins keep High\'s PBR at Low (KEEP_SPEC, metalness 0.5), so cheapMaterials leaves them out of the Lambert swap', () => {
    const sink = (visual: string) => { const g = new Group(); sinkBody(g, builtinTheme(true), 'vrm-sink', visual); return meshes(g).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])).filter((m) => (m as MeshStandardMaterial).roughness === 0.46) as MeshStandardMaterial[]; };
    for (const visual of ['vrm-sink', 'vrm-sink-fan']) {
      setLowDetail(false);
      const high = sink(visual);
      expect(high.length).toBeGreaterThan(0);
      expect(high.every((m) => m.metalness === 0.5 && m.userData[KEEP_SPEC] === undefined)).toBe(true);
      setLowDetail(true);
      const low = sink(visual);
      expect(low.length).toBe(high.length);
      expect(low.every((m) => m.metalness === 0.5 && m.userData[KEEP_SPEC] === true)).toBe(true);
      const g = new Group(); sinkBody(g, builtinTheme(true), 'vrm-sink', visual);
      cheapMaterials(g);
      expect(meshes(g).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])).filter((m) => (m as MeshStandardMaterial).roughness === 0.46 && !(m as MeshStandardMaterial).isMeshStandardMaterial)).toHaveLength(0);
    }
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
