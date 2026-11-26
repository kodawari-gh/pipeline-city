import { assert, describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Texture,
} from 'three';
import type * as threeTypes from 'three';
import { fadeTree } from './artlod';
import { cheapMaterials, probePlan } from './cheapmaterials';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const geo = new BoxGeometry();
/** The distinct Lamberts under `o` (a Lambert shared by two meshes counts once). */
const lamberts = (o: threeTypes.Object3D): threeTypes.Material[] => {
  const out = new Set<threeTypes.Material>();
  o.traverse((x) => {
    const ms = x instanceof Mesh ? materialsOf(x) : [];
    for (const mm of ms) {
      if (mm instanceof MeshLambertMaterial) {
        out.add(mm);
      }
    }
  });
  return [...out];
};
/** The materials of a mesh, as a list. */
function materialsOf(m: { material: threeTypes.Material | threeTypes.Material[] }): threeTypes.Material[] {
  return Array.isArray(m.material) ? m.material : [m.material];
}
/** The mesh's material as the Lambert the pass swapped in, failing the test when it is something else. */
function lambertOf(m: { material: unknown }): MeshLambertMaterial {
  assert.instanceOf(m.material, MeshLambertMaterial);
  return m.material;
}
const isMesh = (o: threeTypes.Object3D | undefined): o is Mesh => o instanceof Mesh;
/** The object as a mesh, failing the test when it is something else. */
const asMesh = (o: threeTypes.Object3D | undefined): Mesh => {
  assert(isMesh(o), 'expected a mesh');
  return o;
};
/** The relative luminance of a colour. */
const lum = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/** The Lambert the pass makes for a mesh of `m`. */
const lambertOfSource = (m: MeshStandardMaterial) => {
  const a = new Mesh(geo, m);
  cheapMaterials(a);
  return lambertOf(a);
};
/** A mesh with a glow, that joins after a pass. */
const late = () => new Mesh(geo, new MeshStandardMaterial({ emissive: new Color(0xff_00_00), emissiveIntensity: 1 }));
/** A patch of its own (a shader change the pass must keep). */
function ownPatch(): void {
  // (the patch itself does nothing here: that there is one is what counts)
}

describe('cheapMaterials', () => {
  it('swaps a plain standard material for a Lambert that keeps its look, one per source', () => {
    const map = new Texture(),
      std = new MeshStandardMaterial({
        color: 0x33_66_99,
        map,
        emissive: new Color(0x11_00_00),
        emissiveIntensity: 2,
        transparent: true,
        opacity: 0.5,
        side: DoubleSide,
        alphaTest: 0.2,
      });
    std.userData['tag'] = 1;
    const a = new Mesh(geo, std),
      b = new Mesh(geo, std),
      root = new Group().add(a, b);
    cheapMaterials(root);
    const l = lambertOf(a);
    expect(l.isMeshLambertMaterial).toBe(true);
    expect(b.material).toBe(l);
    expect(l.color.getHex()).toBe(0x33_66_99);
    expect(l.map).toBe(map);
    expect(l.emissiveIntensity).toBe(2);
    expect(l.transparent).toBe(true);
    expect(l.opacity).toBe(0.5);
    expect(l.side).toBe(DoubleSide);
    expect(l.alphaTest).toBe(0.2);
    expect(l.userData['tag']).toBe(1);
    const phys = new Mesh(geo, new MeshPhysicalMaterial());
    cheapMaterials(phys);
    expect(lambertOf(phys).isMeshLambertMaterial).toBe(true);
  });
  it('a metal source gives a darker Lambert colour (toward dark metal), a non-metal keeps its own hex, and the source colour is not changed', () => {
    const teal = new MeshStandardMaterial({ color: 0x3e_a4_86, metalness: 0.9 });
    const lt = lambertOfSource(teal);
    expect(lum(lt.color)).toBeLessThan(lum(new Color(0x3e_a4_86)));
    expect(lt.color.getHex()).not.toBe(0x3e_a4_86);
    expect(teal.color.getHex()).toBe(0x3e_a4_86); // (High draws with the source colour)
    const alu = new MeshStandardMaterial({ color: 0xb4_bc_cb, metalness: 0.75 });
    expect(lum(lambertOfSource(alu).color)).toBeLessThan(lum(new Color(0xb4_bc_cb)));
    for (const metalness of [0, 0.05, 0.1]) {
      const plain = new MeshStandardMaterial({ color: 0x3e_a4_86, metalness });
      expect(lambertOfSource(plain).color.getHex(), `metalness ${metalness}`).toBe(0x3e_a4_86);
    }
    // copper and gold keep their own colour
    expect(lambertOfSource(new MeshStandardMaterial({ color: 0xc0_79_3a, metalness: 0.9 })).color.getHex()).toBe(
      0xc0_79_3a,
    );
    expect(lambertOfSource(new MeshStandardMaterial({ color: 0xd9_b2_5e, metalness: 1 })).color.getHex()).toBe(
      0xd9_b2_5e,
    );
    // it follows the source's tint live
    teal.color.set(0xff_ff_ff);
    expect(lum(lt.color)).toBeLessThan(1);
    expect(lum(lt.color)).toBeGreaterThan(lum(new Color(0x2a_2d_32)) - 1e-6);
  });
  it("the Lambert reads the source's polygon offset live (a label draws over its decal)", () => {
    const src = new MeshStandardMaterial({ polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const a = new Mesh(geo, src);
    cheapMaterials(a);
    const l = lambertOf(a);
    expect([l.polygonOffset, l.polygonOffsetFactor, l.polygonOffsetUnits]).toStrictEqual([true, -4, -4]);
  });
  it('strips the PBR maps of a patched one and keeps it; a light map counts as patched', () => {
    const n = new Texture(),
      r = new Texture(),
      m = new MeshStandardMaterial({ normalMap: n, roughnessMap: r, metalnessMap: r, aoMap: r, bumpMap: r });
    m.onBeforeCompile = ownPatch;
    const lit = new MeshStandardMaterial({ normalMap: n, lightMap: r });
    const a = new Mesh(geo, m),
      b = new Mesh(geo, lit);
    cheapMaterials(new Group().add(a, b));
    expect(a.material).toBe(m);
    expect([m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.bumpMap]).toStrictEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(b.material).toBe(lit);
    expect(lit.normalMap).toBeNull();
    expect(lit.lightMap).toBe(r);
  });
  it('leaves Basic, Shader and stand-ins alone', () => {
    const basic = new MeshBasicMaterial(),
      sh = new ShaderMaterial(),
      std = new MeshStandardMaterial();
    const a = new Mesh(geo, basic),
      b = new Mesh(geo, sh),
      c = new Mesh(geo, std);
    c.userData['standIn'] = true;
    cheapMaterials(new Group().add(a, b, c));
    expect([a.material, b.material, c.material]).toStrictEqual([basic, sh, std]);
  });
  it("the Lambert follows the game's writes on the source live, with no sync call", () => {
    const src = new MeshStandardMaterial({ color: 0x11_11_11, emissive: new Color(0xff_00_00), emissiveIntensity: 0 });
    const a = new Mesh(geo, src),
      h = cheapMaterials(a),
      l = lambertOf(a);
    src.emissiveIntensity = 3;
    src.color.set(0x00_ff_00);
    src.opacity = 0.25;
    src.visible = false;
    expect(l.emissiveIntensity).toBe(3);
    expect(l.color.getHex()).toBe(0x00_ff_00);
    expect(l.color).toBe(src.color);
    expect(l.opacity).toBe(0.25);
    expect(l.visible).toBe(false);
    expect(l.emissive).toBe(src.emissive);
    h.undo();
  });
  it('sync asks for a new program only when transparent, side, alphaTest or a map changes', () => {
    const src = new MeshStandardMaterial(),
      a = new Mesh(geo, src),
      h = cheapMaterials(a),
      l = lambertOf(a);
    const v = l.version;
    src.emissiveIntensity = 2;
    h.sync();
    expect(l.version).toBe(v);
    src.transparent = true;
    h.sync();
    expect(l.transparent).toBe(true);
    expect(l.version).toBe(v + 1);
    h.sync();
    expect(l.version).toBe(v + 1);
    src.map = new Texture();
    h.sync();
    expect(l.map).toBe(src.map);
    expect(l.version).toBe(v + 2);
  });
  it('undo puts back the originals and their maps', () => {
    const n = new Texture(),
      patched = new MeshStandardMaterial({ normalMap: n });
    patched.onBeforeCompile = ownPatch;
    const plain = new MeshStandardMaterial(),
      multi = new MeshStandardMaterial();
    const a = new Mesh(geo, patched),
      b = new Mesh(geo, plain),
      c = new Mesh(geo, [multi, plain]);
    const h = cheapMaterials(new Group().add(a, b, c));
    expect(b.material).not.toBe(plain);
    expect(c.material[0]).not.toBe(multi);
    h.undo();
    expect(patched.normalMap).toBe(n);
    expect([a.material, b.material]).toStrictEqual([patched, plain]);
    expect(c.material).toStrictEqual([multi, plain]);
  });
  it('a fade through the cheap mesh lands on the source; fading back restores it', () => {
    const src = new MeshStandardMaterial({ opacity: 1, depthWrite: true });
    const a = new Mesh(geo, src),
      root = new Group().add(a),
      h = cheapMaterials(root),
      l = lambertOf(a);
    fadeTree(root, 0.5);
    expect([l.opacity, l.depthWrite, l.transparent]).toStrictEqual([0.5, false, true]);
    expect([src.opacity, src.depthWrite, src.transparent]).toStrictEqual([0.5, false, true]);
    fadeTree(root, 1);
    expect([l.opacity, l.depthWrite, l.transparent]).toStrictEqual([1, true, false]);
    expect([src.opacity, src.depthWrite, src.transparent]).toStrictEqual([1, true, false]);
    h.undo();
  });
  it('sync swaps in the meshes a rebuild added, and drops the ones it removed', () => {
    const a = new Mesh(geo, new MeshStandardMaterial()),
      root = new Group().add(a),
      h = cheapMaterials(root);
    const b = new Mesh(geo, new MeshStandardMaterial());
    root.add(b);
    h.sync();
    expect(lamberts(root)).toHaveLength(2);
    expect(b.material).toBe(lamberts(root)[1]);
    const removed: threeTypes.Material = b.material;
    const dispose = vi.spyOn(removed, 'dispose');
    root.remove(b);
    h.sync();
    expect(lamberts(root)).toHaveLength(1);
    expect(dispose).toHaveBeenCalledOnce();
    h.undo();
    expect(a.material).toBeInstanceOf(MeshStandardMaterial);
  });
  it('a round trip keeps the Lambert count of a fresh pass, disposes every old Lambert, and swaps each source once', () => {
    const shared = new MeshStandardMaterial({ color: 0x12_34_56 });
    const build = () => {
      const mapped = new MeshStandardMaterial({ map: new Texture() });
      return new Group().add(
        new Mesh(geo, shared),
        new Mesh(geo, shared),
        new Mesh(geo, new MeshStandardMaterial()),
        new Mesh(geo, mapped),
      );
    };
    // the fresh pass: the same tree (the late mesh included), cheapened once
    const freshRoot = build().add(late()),
      fresh = cheapMaterials(freshRoot),
      want = lamberts(freshRoot).length;
    fresh.undo();
    // the first pass, then a rebuild adds a mesh that the pass must take in
    const root = build(),
      first = cheapMaterials(root);
    root.add(late());
    first.sync();
    const old = lamberts(root),
      spies = old.map((l) => vi.spyOn(l, 'dispose'));
    expect(old).toHaveLength(want);
    first.undo();
    expect(spies.map((s) => s.mock.calls.length)).toStrictEqual(old.map(() => 1));
    expect(lamberts(root)).toHaveLength(0);
    const again = cheapMaterials(root);
    const now = lamberts(root);
    expect(now).toHaveLength(want);
    const [a, b] = root.children.map((c) => asMesh(c));
    expect(must(a).material).toBe(must(b).material);
    again.undo();
    expect(lamberts(root)).toHaveLength(0);
  });
});

describe('probePlan', () => {
  const o = { low: false, probed: true, busy: false, bounces: 0, keyChanged: true, waited: true };
  it('High keeps probing when the light changes', () => {
    expect(probePlan(o)).toStrictEqual({ request: true, bounces: 0 });
  });
  it('High counts its bounces down, one capture each', () => {
    expect(probePlan({ ...o, bounces: 3 })).toStrictEqual({ request: true, bounces: 2 });
    expect(probePlan({ ...o, bounces: 1, keyChanged: false })).toStrictEqual({ request: true, bounces: 0 });
    expect(probePlan({ ...o, bounces: 0, keyChanged: false })).toStrictEqual({ request: false, bounces: 0 });
  });
  it('Low, once probed, takes no bounce: its bounces go to 0', () => {
    expect(probePlan({ ...o, low: true, keyChanged: false, bounces: 3 })).toStrictEqual({ request: false, bounces: 0 });
    expect(probePlan({ ...o, low: true, busy: true, bounces: 3 })).toStrictEqual({ request: false, bounces: 0 });
  });
  it('Low captures again when the light changed, after the interval', () => {
    expect(probePlan({ ...o, low: true })).toStrictEqual({ request: true, bounces: 0 });
    expect(probePlan({ ...o, low: true, bounces: 3 })).toStrictEqual({ request: true, bounces: 0 });
    expect(probePlan({ ...o, low: true, waited: false })).toStrictEqual({ request: false, bounces: 0 });
  });
  it('Low takes its first probe, and counts its bounces down from it', () => {
    expect(probePlan({ ...o, low: true, probed: false, bounces: 3 })).toStrictEqual({ request: true, bounces: 2 });
  });
  it('waits while busy, and for the key and the interval', () => {
    expect(probePlan({ ...o, busy: true, bounces: 3 })).toStrictEqual({ request: false, bounces: 3 });
    expect(probePlan({ ...o, waited: false })).toStrictEqual({ request: false, bounces: 0 });
    expect(probePlan({ ...o, keyChanged: false })).toStrictEqual({ request: false, bounces: 0 });
  });
});
