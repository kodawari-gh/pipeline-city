import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { boxEnv, boxProjected } from './boxenv';
import { GLOW, HOT_FROM_C, HOT_FULL_C, PartSkin, cloth, heatColor, mat, materialKey, own, partLook, shareMaterials, writable, type PartState } from './materials';

const ON: PartState = { powered: true, active: false, burnt: false, throttled: false, tempC: 30 };

describe('part looks', () => {
  it('leaves a powered idle part as it is', () => {
    expect(partLook(ON)).toEqual({ tint: 1, glow: 0, glowIntensity: 0 });
  });

  it('darkens a part with no power', () => {
    expect(partLook({ ...ON, powered: false })).toEqual({ tint: 0.5, glow: 0, glowIntensity: 0 });
  });

  it('lights an active part', () => {
    expect(partLook({ ...ON, active: true })).toEqual({ tint: 1, glow: GLOW.active, glowIntensity: 0.4 });
  });

  it('tints a throttled part amber', () => {
    expect(partLook({ ...ON, throttled: true })).toEqual({ tint: 0.8, glow: GLOW.throttled, glowIntensity: 0.2 });
  });

  it('brightens with the temperature, cyan to red', () => {
    const warm = partLook({ ...ON, tempC: HOT_FROM_C + 1 }), hot = partLook({ ...ON, tempC: HOT_FULL_C + 50 });
    expect(warm.glowIntensity).toBeLessThan(hot.glowIntensity);
    expect(hot.glowIntensity).toBeCloseTo(0.6);
    expect(heatColor(0)).toBe(GLOW.active);
    expect(heatColor(0.5)).toBe(GLOW.throttled);
    expect(heatColor(1)).toBe(GLOW.burnt);
  });

  it('a burnt part wins over everything', () => {
    expect(partLook({ ...ON, burnt: true, tempC: 200, active: true, powered: false })).toEqual({ tint: 0.3, glow: GLOW.burnt, glowIntensity: 0.8 });
  });

  it('a skin eases its material to the look, from the base colour every time', () => {
    const m = mat(0x808080), skin = new PartSkin([m]), base = m.color.r;
    skin.set({ ...ON, powered: false });
    for (let i = 0; i < 300; i++) skin.frame(1 / 60);
    expect(m.color.r).toBeCloseTo(base * 0.5, 3);
    skin.set(ON);
    for (let i = 0; i < 300; i++) skin.frame(1 / 60);
    expect(m.color.r).toBeCloseTo(base, 3);
    expect(m.emissiveIntensity).toBeCloseTo(0, 3);
  });

  it('a skin says it eases until it has reached the look', () => {
    const skin = new PartSkin([mat(0x808080)]);
    expect(skin.easing).toBe(false);
    skin.set({ ...ON, active: true });
    expect(skin.easing).toBe(true);
    for (let i = 0; i < 600; i++) skin.frame(1 / 60);
    expect(skin.easing).toBe(false);
  });
});

const box = () => new BoxGeometry(1, 1, 1);
const tagged = (id: string) => Object.assign(new Group(), { userData: { id } });
const matsOf = (root: Group) => { const s = new Set<Material>(); root.traverse((o) => { if ((o as Mesh).isMesh) s.add((o as Mesh).material as Material); }); return s; };

describe('material key', () => {
  it('is the same for equal materials and differs on any field that changes the picture', () => {
    const t = new Texture();
    expect(materialKey(mat(0x334455, { roughness: 0.4, map: t }))).toBe(materialKey(mat(0x334455, { roughness: 0.4, map: t })));
    const k = materialKey(mat(0x334455))!;
    for (const m of [mat(0x334456), mat(0x334455, { roughness: 0.5 }), mat(0x334455, { metalness: 0.5 }), mat(0x334455, { map: new Texture() }),
      mat(0x334455, { side: 2 }), mat(0x334455, { polygonOffset: true }), mat(0x334455, { envMapIntensity: 0.5 }), cloth(0x334455)]) {
      expect(materialKey(m)).not.toBe(k);
    }
    const d = mat(0x334455);
    d.defines = { A: '' };
    expect(materialKey(d)).not.toBe(k);
    const u = mat(0x334455);
    u.userData.x = 1;
    expect(materialKey(u)).not.toBe(k);
  });

  it('keys a known patch by its program key and refuses an unknown one', () => {
    const b = boxEnv([0, 0, 0], [1, 1, 1], [0, 0, 0]), p = mat(0x334455);
    boxProjected(p, b);
    expect(materialKey(p)).not.toBeNull();
    expect(materialKey(p)).not.toBe(materialKey(mat(0x334455)));
    const q = mat(0x334455);
    q.onBeforeCompile = () => {};
    expect(materialKey(q)).toBeNull();
    expect(materialKey(new MeshBasicMaterial())).toBeNull();
  });

  it('leaves out the fields it is told to (the palette merge: colour, roughness, metalness)', () => {
    const omit = new Set(['color', 'roughness', 'metalness']), k = materialKey(mat(0x334455), omit);
    expect(materialKey(mat(0x998877, { roughness: 0.1, metalness: 0.9 }), omit)).toBe(k);
    expect(materialKey(mat(0x334455, { side: 2 }), omit)).not.toBe(k);
  });
});

describe('shared materials', () => {
  it('gives equal materials in one scope one material and disposes the others', () => {
    const root = new Group(), a = new Mesh(box(), mat(0x223344)), b = new Mesh(box(), mat(0x223344)), c = new Mesh(box(), mat(0x556677));
    root.add(a, b, c);
    const gone: Material[] = [], replaced: Material[] = [];
    b.material.addEventListener('dispose', () => gone.push(b.material));
    const old = b.material;
    expect(shareMaterials(root, { onReplace: (m) => replaced.push(m) })).toEqual({ before: 3, after: 2 });
    expect(b.material).toBe(a.material);
    expect(c.material).not.toBe(a.material);
    expect(replaced).toEqual([old]);
    expect(gone.length).toBe(1);
  });

  it('leaves glowing, see-through, owned and skipped materials, and keeps scopes and kinds of mesh apart', () => {
    const root = new Group(), lamp = tagged('lamp'), rack = new Group();
    const glow = [0, 1].map(() => new Mesh(box(), mat(0x111111, { emissive: 0xffaa00 })));
    const fade = [0, 1].map(() => new Mesh(box(), mat(0x111111, { transparent: true, opacity: 0.5 })));
    const mine = [0, 1].map(() => new Mesh(box(), own(mat(0x111111))));
    const scoped = [new Mesh(box(), mat(0x222222)), new Mesh(box(), mat(0x222222))];
    const skipped = [new Mesh(box(), mat(0x333333)), new Mesh(box(), mat(0x333333))];
    const plain = new Mesh(box(), mat(0x444444)), other = new Mesh(box(), mat(0x444444));
    other.geometry.deleteAttribute('uv');
    lamp.add(scoped[1]!);
    rack.add(skipped[0]!);
    root.add(...glow, ...fade, ...mine, scoped[0]!, lamp, rack, skipped[1]!, plain, other);
    const n = matsOf(root).size;
    expect(shareMaterials(root, { skip: [rack] })).toEqual({ before: n, after: n });
    expect(matsOf(root).size).toBe(n);
  });

  it('skin materials are never shared (a part state look stays on its own part)', () => {
    const root = new Group(), a = new Mesh(box(), mat(0x223344)), b = new Mesh(box(), mat(0x223344));
    root.add(a, b);
    const skin = new PartSkin([a.material]);
    shareMaterials(root);
    expect(b.material).not.toBe(a.material);
    skin.set({ ...ON, burnt: true });
    skin.frame(1);
    expect(b.material.emissive.getHex()).toBe(0);
  });

  it('copies a shared material on write: only that mesh changes', () => {
    const root = new Group(), b = boxEnv([0, 0, 0], [1, 1, 1], [0, 0, 0]);
    const meshes = [0, 1, 2].map(() => { const m = mat(0x223344); boxProjected(m, b); return new Mesh(box(), m); });
    root.add(...meshes);
    shareMaterials(root);
    const [a, x, y] = meshes as [Mesh<BoxGeometry, ReturnType<typeof mat>>, Mesh<BoxGeometry, ReturnType<typeof mat>>, Mesh<BoxGeometry, ReturnType<typeof mat>>];
    expect(x.material).toBe(a.material);
    const twins: Material[] = [];
    const w = writable(x, (_src, c) => twins.push(c));
    expect(w).not.toBe(a.material);
    expect(twins).toEqual([w]);
    expect(w.customProgramCacheKey()).toBe(a.material.customProgramCacheKey());
    w.emissive.setHex(0xff0000);
    w.color.setHex(0x00ff00);
    expect(a.material.emissive.getHex()).toBe(0);
    expect(y.material.color.getHex()).toBe(0x223344);
    // its own now: a second write takes no copy, and a later share leaves it
    expect(writable(x)).toBe(w);
    w.emissive.setHex(0);
    shareMaterials(root);
    expect(x.material).toBe(w);
    expect(y.material).toBe(a.material);
  });
});
