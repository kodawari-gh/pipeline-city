import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, Mesh, PlaneGeometry, TubeGeometry, type MeshStandardMaterial, type Object3D } from 'three';
import { byDetail, LOW_SHEET_PX, lowDetail, setLowDetail, sheetCut } from '@/core/render/three/detail';
import { paintLow } from '@/core/render/three/geometry';
import { tex } from './casekit3d';
import { driveBody } from '@/features/storage/render/drives';
import { setLayoutTier } from '../layout/layout';
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
  it('the tower cooler at High has 96x12 heat pipes (ASR6) and 339x6 thread coils', () => {
    expect(shapes()).toEqual(['339x6', '339x6', '96x12', '96x12', '96x12', '96x12']); // (sorted as text)
  });
  it('the NVMe label drape is about 24 units a quad at High (ASR3), and one flat quad of the whole picture at Low', () => {
    const high = label().parameters;
    expect([high.widthSegments, high.heightSegments]).toEqual([Math.round(high.width / 24), Math.round(high.height / 24)]);
    setLowDetail(true);
    const lowMesh = labelMesh(), low = (lowMesh.geometry as PlaneGeometry).parameters;
    expect([low.widthSegments, low.heightSegments, low.width, low.height]).toEqual([1, 1, high.width, high.height]);
    // its picture keeps the whole rect (uv 0 to 1), and the quad lies at one depth, over the packages
    const uv = lowMesh.geometry.attributes.uv!, z = lowMesh.geometry.attributes.position!;
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i)), vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect([Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]).toEqual([0, 1, 0, 1]);
    expect(new Set(Array.from({ length: z.count }, (_, i) => z.getZ(i))).size).toBe(1);
  });
  it('the pump cap keeps High\'s polished metal at Low (the machine keeps High\'s materials, `cheap` in board3d)', () => {
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
      expect(low.every((m) => m.metalness > 0.4)).toBe(true);
    }
  });
  it('the sink casting and its fins keep metalness 0.5 at High and at Low, with no userData flag (the machine keeps High\'s materials)', () => {
    const sink = (visual: string) => { const g = new Group(); sinkBody(g, builtinTheme(),'vrm-sink', visual); return meshes(g).flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])).filter((m) => (m as MeshStandardMaterial).roughness === 0.46) as MeshStandardMaterial[]; };
    for (const visual of ['vrm-sink', 'vrm-sink-fan']) {
      for (const low of [false, true]) {
        setLowDetail(low);
        const list = sink(visual);
        expect(list.length, `${visual} at Low ${low}`).toBeGreaterThan(0);
        expect(list.every((m) => m.metalness === 0.5 && Object.keys(m.userData).length === 0), `${visual} at Low ${low}`).toBe(true);
      }
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

describe('Low keeps a big painted sheet at half its size (PHONE-05)', () => {
  type Fake = { width: number; height: number; scale: [number, number] | null };
  /** A document whose canvases only remember their size and the scale the painter's context got. */
  const fakeDocument = (): Fake[] => {
    const made: Fake[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const cv: Fake & { getContext: () => object } = { width: 0, height: 0, scale: null, getContext: () => ({ scale: (x: number, y: number) => { cv.scale = [x, y]; } }) };
        made.push(cv);
        return cv;
      },
    });
    return made;
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sheetCut is 1 at High, and at Low 0.5 over the pixel limit only', () => {
    expect(sheetCut(1024, 700)).toBe(1);
    setLowDetail(true);
    expect(sheetCut(1024, 700)).toBe(0.5);
    expect(sheetCut(256, 256)).toBe(1);
    expect(sheetCut(600, LOW_SHEET_PX / 600)).toBe(1);
  });
  it('paintLow draws a big sheet on a half-size canvas, and the painter still works in w by h', () => {
    const made = fakeDocument();
    let seen: number[] = [];
    paintLow(1024, 700, (_c, w, h) => { seen = [w, h]; });
    expect(made[0]).toMatchObject({ width: 1024, height: 700, scale: null });
    setLowDetail(true);
    paintLow(1024, 700, (_c, w, h) => { seen = [w, h]; });
    expect(made[1]).toMatchObject({ width: 512, height: 350, scale: [0.5, 0.5] });
    expect(seen).toEqual([1024, 700]);
    paintLow(128, 128, () => {});
    expect(made[2]).toMatchObject({ width: 128, height: 128, scale: null });
  });
  it('a cached sheet is painted again for the other detail, and each keeps its entry', () => {
    fakeDocument();
    const size = (t: ReturnType<typeof tex>) => (t!.image as { width: number }).width;
    const high = tex('lowdetail-test-sheet', 1024, 700, () => {});
    expect(size(high)).toBe(1024);
    setLowDetail(true);
    const low = tex('lowdetail-test-sheet', 1024, 700, () => {});
    expect(size(low)).toBe(512);
    expect(tex('lowdetail-test-sheet', 1024, 700, () => {})).toBe(low);
    setLowDetail(false);
    expect(tex('lowdetail-test-sheet', 1024, 700, () => {})).toBe(high);
  });
});
