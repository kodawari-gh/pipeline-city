import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, type BufferAttribute } from 'three';
import { vertexAo } from './vertexao';

/** A plate 1000 wide with a cap 100 wide on it (the cap's group asks for the occlusion), a second cap elsewhere in the cap's material. */
function scene() {
  const root = new Group(), capM = new MeshStandardMaterial(), keys = new Group();
  const plate = new Mesh(new BoxGeometry(1000, 20, 1000), new MeshStandardMaterial());
  plate.position.y = -10;
  const cap = new Mesh(new BoxGeometry(100, 100, 100), capM), other = new Mesh(new BoxGeometry(100, 100, 100), capM);
  cap.position.y = 50; other.position.set(5000, 50, 0);
  keys.userData.ao = 200;
  keys.add(cap);
  root.add(plate, keys, other);
  return { root, cap, other, capM, plate };
}

/** The open share on the front of the cap's point at (x, y, z) whose normal is `n` (BoxGeometry keeps each face's corners apart). */
function aoAt(m: Mesh, x: number, y: number, z: number, n: [number, number, number]): number {
  const p = m.geometry.attributes.position!, nr = m.geometry.attributes.normal!, ao = m.geometry.attributes._ao as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (Math.hypot(p.getX(i) - x, p.getY(i) - y, p.getZ(i) - z) < 1 && nr.getX(i) === n[0] && nr.getY(i) === n[1] && nr.getZ(i) === n[2]) return ao.getX(i);
  }
  throw new Error('no such point');
}

describe('vertexAo', () => {
  it('darkens a side where it meets the plate, not its top', () => {
    const { root, cap } = scene();
    expect(vertexAo(root)).toBe(24);
    const foot = aoAt(cap, 50, -50, 50, [1, 0, 0]), top = aoAt(cap, 50, 50, 50, [0, 1, 0]), head = aoAt(cap, 50, 50, 50, [1, 0, 0]);
    expect(top).toBeCloseTo(1, 5);
    expect(foot).toBeLessThan(0.75);
    expect(head).toBeGreaterThan(foot);
  });

  it('patches the material and leaves its other meshes open', () => {
    const { root, other, capM, plate } = scene();
    vertexAo(root);
    expect(capM.customProgramCacheKey()).toContain('|ao');
    expect(Array.from((other.geometry.attributes._ao as BufferAttribute).array).every((v) => v === 1)).toBe(true);
    expect(plate.geometry.attributes._ao).toBeUndefined();
  });

  it('leaves a glow alone', () => {
    const { root, cap } = scene();
    (cap.material as MeshStandardMaterial).emissive = new Color(0xffffff);
    expect(vertexAo(root)).toBe(0);
    expect(cap.geometry.attributes._ao).toBeUndefined();
  });
});
