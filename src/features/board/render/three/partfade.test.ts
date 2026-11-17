import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { PartFade } from './partfade';
import { motionFor, motionKinds, motionSeconds, solidAt } from './buildmotion';

describe('a part fades as it leaves and as it comes', () => {
  it('fades its own copies: a part that shares a material with another leaves the other solid', () => {
    const shared = new MeshStandardMaterial(), geo = new BoxGeometry();
    const part = new Group(), other = new Mesh(geo, shared), a = new Mesh(geo, shared), b = new Mesh(geo, shared);
    part.add(a, b);
    const f = new PartFade([part]);
    expect(a.material).not.toBe(shared);
    expect(a.material).toBe(b.material); // (one copy per material, shared inside the part)
    f.set(0.4);
    expect((a.material as MeshStandardMaterial).opacity).toBeCloseTo(0.4, 6);
    expect((a.material as MeshStandardMaterial).transparent).toBe(true);
    expect((a.material as MeshStandardMaterial).depthWrite).toBe(true);
    expect(shared.opacity).toBe(1);
    expect(shared.transparent).toBe(false);
    expect(other.material).toBe(shared);
    f.end();
    expect(a.material).toBe(shared);
    expect(b.material).toBe(shared);
  });

  it('keeps the shader patches of the material it copies', () => {
    const m = new MeshStandardMaterial();
    m.onBeforeCompile = () => {};
    m.customProgramCacheKey = () => 'patched';
    const mesh = new Mesh(new BoxGeometry(), m), f = new PartFade([mesh]);
    expect((mesh.material as MeshStandardMaterial).customProgramCacheKey()).toBe('patched');
    expect((mesh.material as MeshStandardMaterial).onBeforeCompile).toBe(m.onBeforeCompile);
    f.end();
  });

  it('is solid at the seat, gone at the far end out, and comes in from nothing', () => {
    for (const kind of motionKinds()) {
      const m = motionFor(kind), T = motionSeconds(m);
      expect(solidAt(m, 0, 'out'), kind).toBe(1);
      expect(solidAt(m, T, 'in'), kind).toBe(1);
      if (kind === 'side') continue; // (a hold alone: nothing travels)
      expect(solidAt(m, T, 'out'), kind).toBeCloseTo(0, 6);
      expect(solidAt(m, 0, 'in'), kind).toBeCloseTo(0, 6);
      expect(solidAt(m, T * 0.5, 'out'), kind).toBe(1); // (only the last stretch fades)
    }
  });
});
