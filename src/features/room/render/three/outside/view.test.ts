import type { Mesh, MeshStandardMaterial, PointLight, ShaderMaterial } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { OutsideView } from './view';

// the `?debug` overlay's layers: each changes what it claims, and turning it on again gives back what the view was
type Peek = {
  scene: { traverse(f: (o: unknown) => void): void }; lamps: PointLight[]; dome: Mesh; clock: number; key: number; mirrorAt: number;
  quad: ShaderMaterial; kit: { night: { mat: MeshStandardMaterial; k: number }[] }; facade: { night: { value: number } };
};

describe('OutsideView.debugLayer', () => {
  let v: OutsideView, p: Peek;
  beforeAll(() => { v = new OutsideView(0, 0, 1, 1, 0); p = v as unknown as Peek; });

  it('has stats of what it draws, and every layer back on leaves them as they were', () => {
    const all = v.debugStats();
    expect(all.tris).toBeGreaterThan(1000);
    expect(all.calls).toBeGreaterThan(5);
    for (const k of ['lights', 'buildings', 'freeze', 'cars', 'sky', 'glow', 'steam', 'mirror', 'flat']) { v.debugLayer(k, true); v.debugLayer(k, false); }
    expect(v.debugStats()).toEqual(all);
  });

  it('buildings, cars, steam and sky take their triangles out, each one its own', () => {
    const all = v.debugStats();
    for (const k of ['buildings', 'cars', 'steam', 'sky']) {
      v.debugLayer(k, true);
      const less = v.debugStats();
      expect(less.tris, k).toBeLessThan(all.tris);
      expect(less.calls, k).toBeLessThan(all.calls);
      v.debugLayer(k, false);
      expect(v.debugStats(), k).toEqual(all);
    }
    v.debugLayer('buildings', true);
    const noBuildings = v.debugStats().tris;
    expect(noBuildings).toBeLessThan(all.tris * 0.9);
    v.debugLayer('buildings', false);
  });

  it('lights puts the lamps and the emissives at 0 at night, and on again gives them back', () => {
    v.frame(23, 1);
    const lit = p.kit.night.map((n) => n.mat.emissiveIntensity);
    expect(lit.every((x) => x > 0)).toBe(true);
    expect(p.lamps.every((l) => l.visible)).toBe(true);
    v.debugLayer('lights', true);
    v.frame(23, 1);
    expect(p.kit.night.every((n) => n.mat.emissiveIntensity === 0)).toBe(true);
    expect(p.lamps.every((l) => !l.visible)).toBe(true);
    expect(p.facade.night.value).toBe(0);
    v.debugLayer('lights', false);
    v.frame(23, 1);
    expect(p.kit.night.map((n) => n.mat.emissiveIntensity)).toEqual(lit);
    expect(p.lamps.every((l) => l.visible)).toBe(true);
    expect(p.facade.night.value).toBeGreaterThan(0);
  });

  it('glow and mirror go to 0 at night, and on again give them back', () => {
    v.frame(23, 1);
    const glow = p.quad.uniforms.glowK!.value as number, mirror = p.mirrorAt;
    expect(glow).toBeGreaterThan(0);
    expect(mirror).toBeGreaterThan(0);
    v.debugLayer('glow', true);
    v.debugLayer('mirror', true);
    v.frame(23, 1);
    expect(p.quad.uniforms.glowK!.value).toBe(0);
    expect(p.mirrorAt).toBe(0);
    v.debugLayer('glow', false);
    v.debugLayer('mirror', false);
    v.frame(23, 1);
    expect(p.quad.uniforms.glowK!.value).toBe(glow);
    expect(p.mirrorAt).toBe(mirror);
  });

  it('freeze keeps the clock where it was, and on again lets it run', () => {
    v.frame(12, 10);
    v.debugLayer('freeze', true);
    v.frame(12, 50);
    expect(p.clock).toBe(10);
    v.debugLayer('freeze', false);
    v.frame(12, 60);
    expect(p.clock).toBe(60);
  });
});
