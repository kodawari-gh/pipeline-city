// A merge keeps each source mesh's look: the palette meshes of `mergeSiblings`, `mergeWithin` and `mergePalette`, and the stand-ins, hold every
// source's colour, roughness, metalness and uv on its own vertices, and draw with its map. A copper mesh is never painted grey by a neighbour,
// and a mapped label keeps its uv rect.
import { afterEach, describe, expect, it } from 'vitest';
import * as three from 'three';
import { setLowDetail } from '@/core/render/three/detail';
import { mergePalette, mergeSiblings, mergeWithin, partsOf, standIns } from '@/core/render/three/merge';
import { tag } from '@/core/render/three/pick';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

const isMeshStandardMaterial = (o: unknown): o is three.MeshStandardMaterial =>
  typeof o === 'object' && o !== null && 'isMeshStandardMaterial' in o && o.isMeshStandardMaterial === true;
function asMeshStandardMaterial(o: unknown): three.MeshStandardMaterial {
  if (!isMeshStandardMaterial(o)) {
    throw new Error('expected a MeshStandardMaterial');
  }
  return o;
}

const isTexture = (o: unknown): o is three.Texture =>
  typeof o === 'object' && o !== null && 'isTexture' in o && o.isTexture === true;
function asTexture(o: unknown): three.Texture {
  if (!isTexture(o)) {
    throw new Error('expected a Texture');
  }
  return o;
}

quietCanvas();
afterEach(() => {
  setLowDetail(false);
});

const COPPER = 0xc0_79_3a,
  GREY = 0x9a_a2_ad,
  BLACK = 0x18_18_1b;
const std = (color: number, o: { metalness?: number; roughness?: number; map?: three.Texture } = {}) =>
  new three.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.6, ...o });
const near = (a: number, b: number, _what: string) => {
  expect(Math.abs(a - b)).toBeLessThan(1e-4);
};

/** Each source of each merged mesh under `root`: its vertices in the merged mesh hold its colour, roughness, metalness and uv; the merged mesh draws with its map. */
function expectKept(root: three.Object3D, what: string): number {
  let checked = 0;
  root.traverse((o) => {
    const parts = partsOf(o);
    if (parts.length === 0) {
      return;
    }
    if (!isMesh(o)) {
      return;
    }
    const out = asMesh(o),
      g = out.geometry,
      pc = must(g.attributes['_pc']),
      prm = must(g.attributes['_prm']),
      // (a merge of sources with no uv has none)
      { uv } = g.attributes;
    const pal = asMeshStandardMaterial(out.material);
    let at = 0;
    for (const { mesh } of parts) {
      const src = asMeshStandardMaterial(mesh.material),
        sg = mesh.geometry,
        sidx = sg.index,
        suv = sg.attributes['uv'];
      const n = sidx ? sidx.count : must(sg.attributes['position']).count;
      expect(pal.map, `${what}: map of ${src.color.getHexString()}`).toBe(src.map);
      expect(pal.side, `${what}: side`).toBe(src.side);
      expect(pal.alphaTest, `${what}: alphaTest`).toBe(src.alphaTest);
      expect(pal.emissive.getHex(), `${what}: emissive`).toBe(src.emissive.getHex());
      for (const i of new Set([0, 1, Math.floor(n / 2), n - 1])) {
        const v = at + i;
        near(pc.getX(v), src.color.r, `${what}: r ${src.color.getHexString()}`);
        near(pc.getY(v), src.color.g, `${what}: g ${src.color.getHexString()}`);
        near(pc.getZ(v), src.color.b, `${what}: b ${src.color.getHexString()}`);
        near(prm.getX(v), src.roughness, `${what}: roughness`);
        near(prm.getY(v), src.metalness, `${what}: metalness`);
        if (suv) {
          const s = sidx ? sidx.getX(i) : i;
          near(must(uv).getX(v), suv.getX(s), `${what}: u`);
          near(must(uv).getY(v), suv.getY(s), `${what}: v`);
        }
      }
      at += n;
      checked++;
    }
    expect(at, `${what}: vertices`).toBe(must(g.attributes['position']).count);
  });
  return checked;
}

/** A holder with an id (a part), copper, grey and black meshes in a sub-group and a mapped label of its own. */
const scene = () => {
  const root = new three.Group(),
    part = tag(new three.Group(), 'part'),
    sub = new three.Group(),
    map = asTexture({ isTexture: true });
  const cu = new three.Mesh(new three.BoxGeometry(10, 10, 10), std(COPPER, { metalness: 0.9, roughness: 0.28 }));
  const grey = new three.Mesh(new three.BoxGeometry(10, 10, 10), std(GREY, { metalness: 0.8, roughness: 0.3 }));
  const black = new three.Mesh(new three.BoxGeometry(10, 10, 10), std(BLACK, { roughness: 0.55 }));
  const label = new three.Mesh(new three.PlaneGeometry(40, 20), std(0xff_ff_ff, { map, roughness: 0.46 }));
  const label2 = new three.Mesh(new three.PlaneGeometry(30, 10), std(0xff_ff_ff, { map, roughness: 0.46 }));
  for (const [i, m] of [cu, grey, black].entries()) {
    m.position.set(i * 20, 0, 0);
  }
  sub.add(cu, grey, black, label, label2);
  part.add(sub);
  root.add(part);
  return { root, part, sub, cu, grey, black, label, label2, map };
};

function assert_a_stand_in_keeps_them_a_copper_mesh_with_the_sam(): void {
  const s = scene();
  s.root.updateMatrixWorld(true);
  const made = standIns(s.root, [s.cu, s.grey, s.black, s.label, s.label2]);
  expect(made.length).toBeGreaterThan(0);
  for (const { mesh, sources } of made) {
    const pc = mesh.geometry.attributes['_pc'];
    if (pc === undefined) {
      continue;
    } // (a set that keeps its own material: it draws with it)
    let at = 0;
    for (const src of sources) {
      const m = asMeshStandardMaterial(src.material),
        n = src.geometry.index ? src.geometry.index.count : must(src.geometry.attributes['position']).count;
      near(pc.getX(at), m.color.r, 'stand-in r');
      near(pc.getY(at), m.color.g, 'stand-in g');
      near(pc.getZ(at), m.color.b, 'stand-in b');
      at += n;
    }
  }
  expect(new three.Color(COPPER).r).toBeGreaterThan(new three.Color(COPPER).b); // (the copper is warm: a grey result would fail the checks above)
}

function assert_a_stand_in_of_plain_meshes_draws_with_a_PBR_pale(): void {
  for (const low of [true, false]) {
    setLowDetail(low);
    const s = scene();
    s.root.updateMatrixWorld(true);
    const pals = standIns(s.root, [s.cu, s.grey, s.black, s.label, s.label2])
      .filter((x) => x.mesh.geometry.attributes['_pc'])
      .map((x) => asMeshStandardMaterial(x.mesh.material));
    expect(pals.length, `Low ${low}`).toBeGreaterThan(0);
    for (const m of pals) {
      expect(m.customProgramCacheKey().endsWith('|keep'), `Low ${low}`).toBe(low);
    }
  }
}

describe("a palette merge keeps every source mesh's look", () => {
  it('mergeSiblings: copper stays copper beside grey metal and a black cable, and a mapped label keeps its uv and map', () => {
    const s = scene();
    expect(mergeSiblings(s.root)).toBeGreaterThan(2);
    expect(expectKept(s.root, 'siblings')).toBe(5);
    const merged = s.sub.children.filter((c) => partsOf(c).length > 0).map((c) => asMesh(c));
    // the copper and the grey are two sources of one palette, each with its own vertex colour
    const parts = merged.flatMap((m) => partsOf(m).map((p) => p.mesh));
    expect(parts).toContain(s.cu);
    expect(parts).toContain(s.grey);
    const labelMesh = must(merged.find((m) => asMeshStandardMaterial(m.material).map === s.map));
    const uv = must(labelMesh.geometry.attributes['uv']),
      us = Array.from({ length: uv.count }, (_, i) => uv.getX(i)),
      vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect([Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]).toStrictEqual([0, 1, 0, 1]);
  });

  it('mergeWithin (a plug on its own) and mergePalette keep every source too', () => {
    const a = scene();
    expect(mergeWithin(a.part)).toBeGreaterThan(2);
    expect(expectKept(a.root, 'within')).toBe(5);
    const b = scene();
    b.part.userData = {}; // (mergePalette leaves a picked mesh as it is: no id)
    expect(mergePalette(b.root)).toBeGreaterThan(2);
    expect(expectKept(b.root, 'palette')).toBe(5);
  });

  it('a stand-in keeps them, a copper mesh with the same attributes as a grey one included', () => {
    expect.hasAssertions();
    assert_a_stand_in_keeps_them_a_copper_mesh_with_the_sam();
  });

  it("a stand-in of plain meshes draws with a PBR palette at Low, as the machine's palette meshes do (PHONE-01: the RAM chips went darker), and as before at High", () => {
    expect.hasAssertions();
    assert_a_stand_in_of_plain_meshes_draws_with_a_PBR_pale();
  });
});

describe("the Low machine keeps every merged mesh's look", () => {
  it(
    "each palette mesh of the maxed machine, merged with stand-ins at Low, holds its sources' colour, roughness, metalness, uv and map",
    { timeout: 120_000 },
    () => {
      setLowDetail(true);
      const m = buildMachine(maxedSnapshot(), true, true);
      expect(expectKept(m.root, 'Low machine')).toBeGreaterThan(100);
    },
  );
});
