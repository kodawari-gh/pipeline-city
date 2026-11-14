// A merge keeps each source mesh's look: the palette meshes of `mergeSiblings`, `mergeWithin` and `mergePalette`, and the stand-ins, hold every
// source's colour, roughness, metalness and uv on its own vertices, and draw with its map. A copper mesh is never painted grey by a neighbour,
// and a mapped label keeps its uv rect.
import { afterEach, describe, expect, it } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, PlaneGeometry, type BufferAttribute, type Object3D, type Texture } from 'three';
import { warmMetal } from '@/core/render/three/cheapmaterials';
import { setLowDetail } from '@/core/render/three/detail';
import { mergePalette, mergeSiblings, mergeWithin, partsOf, standIns } from '@/core/render/three/merge';
import { tag } from '@/core/render/three/pick';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();
afterEach(() => { setLowDetail(false); });

const COPPER = 0xc0793a, GREY = 0x9aa2ad, BLACK = 0x18181b;
const std = (color: number, o: { metalness?: number; roughness?: number; map?: Texture } = {}) => new MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.6, ...o });
const near = (a: number, b: number, what: string) => expect(Math.abs(a - b), what).toBeLessThan(1e-4);

/** Each source of each merged mesh under `root`: its vertices in the merged mesh hold its colour, roughness, metalness and uv; the merged mesh draws with its map. */
function expectKept(root: Object3D, what: string): number {
  let checked = 0;
  root.traverse((o) => {
    const parts = partsOf(o);
    if (!parts.length) return;
    const out = o as Mesh, g = out.geometry, pc = g.attributes._pc as BufferAttribute, prm = g.attributes._prm as BufferAttribute, uv = g.attributes.uv as BufferAttribute;
    const pal = out.material as MeshStandardMaterial;
    let at = 0;
    for (const { mesh } of parts) {
      const src = mesh.material as MeshStandardMaterial, sg = mesh.geometry, sidx = sg.index, suv = sg.attributes.uv as BufferAttribute | undefined;
      const n = sidx ? sidx.count : sg.attributes.position!.count;
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
          near(uv.getX(v), suv.getX(s), `${what}: u`);
          near(uv.getY(v), suv.getY(s), `${what}: v`);
        }
      }
      at += n;
      checked++;
    }
    expect(at, `${what}: vertices`).toBe(g.attributes.position!.count);
  });
  return checked;
}

describe('a palette merge keeps every source mesh\'s look', () => {
  /** A holder with an id (a part), copper, grey and black meshes in a sub-group and a mapped label of its own. */
  const scene = () => {
    const root = new Group(), part = tag(new Group(), 'part'), sub = new Group(), map = { isTexture: true } as unknown as Texture;
    const cu = new Mesh(new BoxGeometry(10, 10, 10), std(COPPER, { metalness: 0.9, roughness: 0.28 }));
    const grey = new Mesh(new BoxGeometry(10, 10, 10), std(GREY, { metalness: 0.8, roughness: 0.3 }));
    const black = new Mesh(new BoxGeometry(10, 10, 10), std(BLACK, { roughness: 0.55 }));
    const label = new Mesh(new PlaneGeometry(40, 20), std(0xffffff, { map, roughness: 0.46 }));
    const label2 = new Mesh(new PlaneGeometry(30, 10), std(0xffffff, { map, roughness: 0.46 }));
    [cu, grey, black].forEach((m, i) => m.position.set(i * 20, 0, 0));
    sub.add(cu, grey, black, label, label2);
    part.add(sub);
    root.add(part);
    return { root, part, sub, cu, grey, black, label, label2, map };
  };

  it('mergeSiblings: copper stays copper beside grey metal and a black cable, and a mapped label keeps its uv and map', () => {
    const s = scene();
    expect(mergeSiblings(s.root)).toBeGreaterThan(2);
    expect(expectKept(s.root, 'siblings')).toBe(5);
    const merged = s.sub.children.filter((c) => partsOf(c).length) as Mesh[];
    // the copper and the grey are two sources of one palette, each with its own vertex colour
    const parts = merged.flatMap((m) => partsOf(m).map((p) => p.mesh));
    expect(parts).toContain(s.cu);
    expect(parts).toContain(s.grey);
    const labelMesh = merged.find((m) => (m.material as MeshStandardMaterial).map === s.map)!;
    const uv = labelMesh.geometry.attributes.uv as BufferAttribute, us = Array.from({ length: uv.count }, (_, i) => uv.getX(i)), vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect([Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]).toEqual([0, 1, 0, 1]);
  });

  it('byLook (Low): a warm metal merges only with warm metals, never in a palette with grey or black', () => {
    const s = scene();
    s.sub.add(new Mesh(new BoxGeometry(10, 10, 10), std(0xd9b25e, { metalness: 1, roughness: 0.25 }))); // gold
    mergeSiblings(s.root, { byLook: true });
    expect(expectKept(s.root, 'byLook')).toBe(6);
    for (const c of s.sub.children) {
      const parts = partsOf(c).map((p) => p.mesh.material as MeshStandardMaterial);
      if (parts.length) expect(new Set(parts.map((m) => m.metalness > 0.5 && m.color.r > m.color.b)).size, 'one class a palette').toBe(1);
    }
    // (off by default: High merges as it did)
    const h = scene();
    mergeSiblings(h.root);
    expect(h.sub.children.filter((c) => partsOf(c).some((p) => p.mesh === h.cu) && partsOf(c).some((p) => p.mesh === h.grey))).toHaveLength(1);
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
    const s = scene();
    s.root.updateMatrixWorld(true);
    const made = standIns(s.root, [s.cu, s.grey, s.black, s.label, s.label2]);
    expect(made.length).toBeGreaterThan(0);
    for (const { mesh, sources } of made) {
      const pc = mesh.geometry.attributes._pc as BufferAttribute | undefined;
      if (!pc) continue; // (a set that keeps its own material: it draws with it)
      let at = 0;
      for (const src of sources) {
        const m = src.material as MeshStandardMaterial, n = src.geometry.index ? src.geometry.index.count : src.geometry.attributes.position!.count;
        near(pc.getX(at), m.color.r, 'stand-in r'); near(pc.getY(at), m.color.g, 'stand-in g'); near(pc.getZ(at), m.color.b, 'stand-in b');
        at += n;
      }
    }
    expect(new Color(COPPER).r).toBeGreaterThan(new Color(COPPER).b); // (the copper is warm: a grey result would fail the checks above)
  });
});

describe('the Low machine keeps every merged mesh\'s look', () => {
  it('each palette mesh of the maxed machine, merged with stand-ins at Low, holds its sources\' colour, roughness, metalness, uv and map', { timeout: 120_000 }, () => {
    setLowDetail(true);
    const m = buildMachine(maxedSnapshot(), true, true);
    expect(expectKept(m.root, 'Low machine')).toBeGreaterThan(100);
    // no palette of the machine holds a warm metal (copper, gold) with anything else
    let warmSets = 0;
    m.root.traverse((o) => {
      const parts = partsOf(o).map((p) => p.mesh.material as MeshStandardMaterial);
      if (!parts.length) return;
      const warm = parts.map((x) => x.metalness > 0.5 && warmMetal(x.color));
      if (warm.some(Boolean)) { warmSets++; expect(warm.every(Boolean), 'a warm metal shares a palette with another look').toBe(true); }
    });
    expect(warmSets).toBeGreaterThan(0);
  });
});
