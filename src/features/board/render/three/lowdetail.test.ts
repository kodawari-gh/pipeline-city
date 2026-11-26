import { afterEach, describe, expect, it, vi } from 'vitest';
import * as three from 'three';
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

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

const isMeshStandardMaterial = (o: unknown): o is three.MeshStandardMaterial =>
  typeof o === 'object' && o !== null && 'isMeshStandardMaterial' in o && o.isMeshStandardMaterial === true;
function asMeshStandardMaterial(o: unknown): three.MeshStandardMaterial {
  if (!isMeshStandardMaterial(o)) {
    throw new Error('expected a MeshStandardMaterial');
  }
  return o;
}

/** A list of one value, or the value itself when it is already a list. */
function asList<T>(value: T | T[]): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

afterEach(() => {
  setLowDetail(false);
});

const meshes = (o: three.Object3D) => {
  const out: three.Mesh[] = [];
  o.traverse((c) => {
    if (isMesh(c)) {
      out.push(c);
    }
  });
  return out;
};
const tubes = (o: three.Object3D) =>
  meshes(o).flatMap((m) => (m.geometry instanceof three.TubeGeometry ? [m.geometry.parameters] : []));
/** The tower's tubes as `tubular x radial`, sorted: the four heat pipes and the two thread coils. */
const shapes = () => {
  setLayoutTier(3, 3);
  return tubes(coolerModel('cooler-tower').root)
    .map((p) => `${p.tubularSegments}x${p.radialSegments}`)
    .toSorted();
};
/** The label's mesh: the plane with the label's picture on it (its material draws over the decals with an offset of -4), in the stick's group. */
const labelMesh = (): three.Mesh => {
  const g = new three.Group();
  nvmeStick(g, driveBody('ssd-nvme', 'm20'), { name: 'NVMe SSD 128K', capacityBytes: 128 * 1024, heatsink: false });
  const planes = meshes(g).filter(
    (m) =>
      m.geometry instanceof three.PlaneGeometry &&
      !Array.isArray(m.material) &&
      (m.material as { polygonOffsetFactor?: number }).polygonOffsetFactor === -4,
  );
  expect(planes).toHaveLength(1);
  return must(planes[0]);
};
const label = (): three.PlaneGeometry => labelMesh().geometry as three.PlaneGeometry;

function assert_the_pump_cap_keeps_High_s_polished_metal_at_Low_(): void {
  interface M {
    metalness: number;
    roughness: number;
    color: { getHex: () => number };
  }
  const mats = (g: three.Object3D, keep: (m: M) => boolean) =>
    meshes(g)
      .flatMap((m) => asList(m.material))
      .filter((m) => keep(m as unknown as M)) as unknown as M[];
  const cap = () => {
    setLayoutTier(3, 3);
    return mats(coolerModel('cooler-liquid').root, (m) => m.color.getHex() === 0xff_ff_ff && m.roughness === 0.3);
  };
  for (const build of [cap]) {
    setLowDetail(false);
    const high = build();
    expect(high.some((m) => m.metalness > 0.4)).toBe(true);
    setLowDetail(true);
    const low = build();
    expect(low).toHaveLength(high.length);
    expect(high.length).toBeGreaterThan(0);
    expect(low.every((m) => m.metalness > 0.4)).toBe(true);
  }
}

function assert_the_sink_casting_and_its_fins_keep_metalness_0_5(): void {
  const sink = (visual: string) => {
    const g = new three.Group();
    sinkBody(g, builtinTheme(), 'vrm-sink', visual);
    return meshes(g)
      .flatMap((m) => asList(m.material))
      .filter((m) => asMeshStandardMaterial(m).roughness === 0.46) as three.MeshStandardMaterial[];
  };
  for (const visual of ['vrm-sink', 'vrm-sink-fan']) {
    for (const low of [false, true]) {
      setLowDetail(low);
      const list = sink(visual);
      expect(list.length, `${visual} at Low ${low}`).toBeGreaterThan(0);
      expect(
        list.every((m) => m.metalness === 0.5 && Object.keys(m.userData).length === 0),
        `${visual} at Low ${low}`,
      ).toBe(true);
    }
  }
}

const size = (t: ReturnType<typeof tex>) => (must(t).image as { width: number }).width;

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
    expect(shapes()).toStrictEqual(['40x8', '40x8', '40x8', '40x8', '48x6', '48x6']);
  });
  it('the tower cooler at High has 96x12 heat pipes (ASR6) and 339x6 thread coils', () => {
    expect(shapes()).toStrictEqual(['339x6', '339x6', '96x12', '96x12', '96x12', '96x12']); // (sorted as text)
  });
  it('the NVMe label drape is about 24 units a quad at High (ASR3), and one flat quad of the whole picture at Low', () => {
    const high = label().parameters;
    expect([high.widthSegments, high.heightSegments]).toStrictEqual([
      Math.round(high.width / 24),
      Math.round(high.height / 24),
    ]);
    setLowDetail(true);
    const lowMesh = labelMesh(),
      low = (lowMesh.geometry as three.PlaneGeometry).parameters;
    expect([low.widthSegments, low.heightSegments, low.width, low.height]).toStrictEqual([
      1,
      1,
      high.width,
      high.height,
    ]);
    // its picture keeps the whole rect (uv 0 to 1), and the quad lies at one depth, over the packages
    const uv = must(lowMesh.geometry.attributes['uv']),
      z = must(lowMesh.geometry.attributes['position']);
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i)),
      vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect([Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]).toStrictEqual([0, 1, 0, 1]);
    expect(new Set(Array.from({ length: z.count }, (_, i) => z.getZ(i))).size).toBe(1);
  });

  it("the pump cap keeps High's polished metal at Low (the machine keeps High's materials, `cheap` in board3d)", () => {
    expect.hasAssertions();
    assert_the_pump_cap_keeps_High_s_polished_metal_at_Low_();
  });

  it("the sink casting and its fins keep metalness 0.5 at High and at Low, with no userData flag (the machine keeps High's materials)", () => {
    expect.hasAssertions();
    assert_the_sink_casting_and_its_fins_keep_metalness_0_5();
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
  interface Fake {
    width: number;
    height: number;
    scale: [number, number] | null;
  }
  /** A document whose canvases only remember their size and the scale the painter's context got. */
  const fakeDocument = (): Fake[] => {
    const made: Fake[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const cv: Fake & { getContext: () => object } = {
          width: 0,
          height: 0,
          scale: null,
          getContext: () => ({
            scale: (x: number, y: number) => {
              cv.scale = [x, y];
            },
          }),
        };
        made.push(cv);
        return cv;
      },
    });
    return made;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
    paintLow(1024, 700, (_c, w, h) => {
      seen = [w, h];
    });
    expect(made[0]).toMatchObject({ width: 1024, height: 700, scale: null });
    setLowDetail(true);
    paintLow(1024, 700, (_c, w, h) => {
      seen = [w, h];
    });
    expect(made[1]).toMatchObject({ width: 512, height: 350, scale: [0.5, 0.5] });
    expect(seen).toStrictEqual([1024, 700]);
    paintLow(128, 128, () => {
      /* no-op */
    });
    expect(made[2]).toMatchObject({ width: 128, height: 128, scale: null });
  });
  it('a cached sheet is painted again for the other detail, and each keeps its entry', () => {
    fakeDocument();
    const high = tex('lowdetail-test-sheet', 1024, 700, () => {
      /* no-op */
    });
    expect(size(high)).toBe(1024);
    setLowDetail(true);
    const low = tex('lowdetail-test-sheet', 1024, 700, () => {
      /* no-op */
    });
    expect(size(low)).toBe(512);
    expect(
      tex('lowdetail-test-sheet', 1024, 700, () => {
        /* no-op */
      }),
    ).toBe(low);
    setLowDetail(false);
    expect(
      tex('lowdetail-test-sheet', 1024, 700, () => {
        /* no-op */
      }),
    ).toBe(high);
  });
});
