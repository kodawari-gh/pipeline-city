import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, ShaderMaterial, Texture } from 'three';
import { cheapMaterials, probePlan } from './cheapmaterials';

const geo = new BoxGeometry();

describe('cheapMaterials', () => {
  it('swaps a plain standard material for a Lambert that keeps its look, one per source', () => {
    const map = new Texture(), std = new MeshStandardMaterial({ color: 0x336699, map, emissive: new Color(0x110000), emissiveIntensity: 2, transparent: true, opacity: 0.5, side: DoubleSide, alphaTest: 0.2 });
    std.userData.tag = 1;
    const a = new Mesh(geo, std), b = new Mesh(geo, std), root = new Group().add(a, b);
    cheapMaterials(root);
    const l = a.material as unknown as MeshLambertMaterial;
    expect(l.isMeshLambertMaterial).toBe(true);
    expect(b.material).toBe(l);
    expect(l.color.getHex()).toBe(0x336699);
    expect(l.map).toBe(map);
    expect(l.emissiveIntensity).toBe(2);
    expect(l.transparent).toBe(true);
    expect(l.opacity).toBe(0.5);
    expect(l.side).toBe(DoubleSide);
    expect(l.alphaTest).toBe(0.2);
    expect(l.userData.tag).toBe(1);
    const phys = new Mesh(geo, new MeshPhysicalMaterial());
    cheapMaterials(phys);
    expect((phys.material as unknown as MeshLambertMaterial).isMeshLambertMaterial).toBe(true);
  });
  it('strips the PBR maps of a patched one and keeps it; a light map counts as patched', () => {
    const n = new Texture(), r = new Texture(), m = new MeshStandardMaterial({ normalMap: n, roughnessMap: r, metalnessMap: r, aoMap: r, bumpMap: r });
    m.onBeforeCompile = () => undefined;
    const lit = new MeshStandardMaterial({ normalMap: n, lightMap: r });
    const a = new Mesh(geo, m), b = new Mesh(geo, lit);
    cheapMaterials(new Group().add(a, b));
    expect(a.material).toBe(m);
    expect([m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.bumpMap]).toEqual([null, null, null, null, null]);
    expect(b.material).toBe(lit);
    expect(lit.normalMap).toBeNull();
    expect(lit.lightMap).toBe(r);
  });
  it('leaves Basic, Shader and stand-ins alone', () => {
    const basic = new MeshBasicMaterial(), sh = new ShaderMaterial(), std = new MeshStandardMaterial();
    const a = new Mesh(geo, basic), b = new Mesh(geo, sh), c = new Mesh(geo, std);
    c.userData.standIn = true;
    cheapMaterials(new Group().add(a, b, c));
    expect([a.material, b.material, c.material]).toEqual([basic, sh, std]);
  });
  it('the Lambert follows the game\'s writes on the source live, with no sync call', () => {
    const src = new MeshStandardMaterial({ color: 0x111111, emissive: new Color(0xff0000), emissiveIntensity: 0 });
    const a = new Mesh(geo, src), h = cheapMaterials(a), l = a.material as unknown as MeshLambertMaterial;
    src.emissiveIntensity = 3;
    src.color.set(0x00ff00);
    src.opacity = 0.25;
    src.visible = false;
    expect(l.emissiveIntensity).toBe(3);
    expect(l.color.getHex()).toBe(0x00ff00);
    expect(l.color).toBe(src.color);
    expect(l.opacity).toBe(0.25);
    expect(l.visible).toBe(false);
    expect(l.emissive).toBe(src.emissive);
    h.undo();
  });
  it('sync asks for a new program only when transparent, side, alphaTest or a map changes', () => {
    const src = new MeshStandardMaterial(), a = new Mesh(geo, src), h = cheapMaterials(a), l = a.material as unknown as MeshLambertMaterial;
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
    const n = new Texture(), patched = new MeshStandardMaterial({ normalMap: n });
    patched.onBeforeCompile = () => undefined;
    const plain = new MeshStandardMaterial(), multi = new MeshStandardMaterial();
    const a = new Mesh(geo, patched), b = new Mesh(geo, plain), c = new Mesh(geo, [multi, plain]);
    const { undo } = cheapMaterials(new Group().add(a, b, c));
    expect(b.material).not.toBe(plain);
    expect((c.material as MeshStandardMaterial[])[0]).not.toBe(multi);
    undo();
    expect(patched.normalMap).toBe(n);
    expect([a.material, b.material]).toEqual([patched, plain]);
    expect(c.material).toEqual([multi, plain]);
  });
});

describe('probePlan', () => {
  const o = { low: false, probed: true, busy: false, bounces: 0, keyChanged: true, waited: true };
  it('High keeps probing when the light changes', () => expect(probePlan(o)).toEqual({ request: true, bounces: 0 }));
  it('High counts its bounces down, one capture each', () => {
    expect(probePlan({ ...o, bounces: 3 })).toEqual({ request: true, bounces: 2 });
    expect(probePlan({ ...o, bounces: 1, keyChanged: false })).toEqual({ request: true, bounces: 0 });
    expect(probePlan({ ...o, bounces: 0, keyChanged: false })).toEqual({ request: false, bounces: 0 });
  });
  it('Low, once probed, asks for no more and its bounces go to 0', () => {
    expect(probePlan({ ...o, low: true })).toEqual({ request: false, bounces: 0 });
    expect(probePlan({ ...o, low: true, bounces: 3 })).toEqual({ request: false, bounces: 0 });
    expect(probePlan({ ...o, low: true, busy: true, bounces: 3 })).toEqual({ request: false, bounces: 0 });
  });
  it('Low takes its first probe, and counts its bounces down from it', () => {
    expect(probePlan({ ...o, low: true, probed: false, bounces: 3 })).toEqual({ request: true, bounces: 2 });
  });
  it('waits while busy, and for the key and the interval', () => {
    expect(probePlan({ ...o, busy: true, bounces: 3 })).toEqual({ request: false, bounces: 3 });
    expect(probePlan({ ...o, waited: false })).toEqual({ request: false, bounces: 0 });
    expect(probePlan({ ...o, keyChanged: false })).toEqual({ request: false, bounces: 0 });
  });
});
