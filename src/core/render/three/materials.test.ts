import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Texture } from 'three';
import { GLOW, HOT_FROM_C, HOT_FULL_C, PartSkin, heatColor, mat, materialKey, partLook, shareMaterials, type PartState } from './materials';
import { boxEnv, boxProjected } from './boxenv';

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

describe('shareMaterials', () => {
  const box = () => new BoxGeometry();
  it('gives the meshes one material for each look', () => {
    const root = new Group(), a = new Mesh(box(), mat(0x223344, { roughness: 0.4 })), b = new Mesh(box(), mat(0x223344, { roughness: 0.4 }));
    const inner = new Group();
    inner.add(b);
    root.add(a, inner);
    expect(shareMaterials(root)).toBe(1);
    expect(b.material).toBe(a.material);
  });

  it('keeps apart materials that differ in a setting, a map or a shader patch', () => {
    const t = new Texture(), env = boxEnv([0, 0, 0], [1, 1, 1], [0, 0, 0]);
    const patched = mat(0x223344);
    boxProjected(patched, env);
    const ms = [mat(0x223344), mat(0x223345), mat(0x223344, { roughness: 0.3 }), mat(0x223344, { map: t }), patched];
    const root = new Group();
    for (const m of ms) root.add(new Mesh(box(), m));
    expect(shareMaterials(root)).toBe(0);
    expect(new Set(ms.map(materialKey)).size).toBe(ms.length);
  });

  it('leaves glows, see-through and other kinds of material their own', () => {
    // (the ISP's five lights: equal materials, each lit on its own)
    const glow = () => new MeshStandardMaterial({ color: 0x111111, emissive: new Color(0x3be3ff), emissiveIntensity: 0 });
    const glass = () => mat(0xffffff, { transparent: true, opacity: 0.2 });
    const ms = [glow(), glow(), glass(), glass(), new MeshBasicMaterial(), new MeshBasicMaterial()];
    const root = new Group(), meshes = ms.map((m) => new Mesh(box(), m));
    root.add(...meshes);
    expect(shareMaterials(root)).toBe(0);
    expect(meshes.map((m) => m.material)).toEqual(ms);
  });
});
