import { describe, expect, it } from 'vitest';
import { BoxGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import { mergeStatic } from './merge';
import { seeThrough, tag } from './pick';

describe('mergeStatic', () => {
  it('merges the meshes that share a material into one, in the root frame', () => {
    const root = new Group(), m = new MeshStandardMaterial(), inner = new Group();
    inner.position.set(1000, 0, 0);
    const a = new Mesh(new BoxGeometry(10, 10, 10), m), b = new Mesh(new CylinderGeometry(5, 5, 10, 8), m);
    b.position.set(0, 50, 0);
    inner.add(b);
    root.add(a, inner);
    expect(mergeStatic(root)).toBe(2);
    const merged = root.children.filter((c) => c.name === 'merged') as Mesh[];
    expect(merged).toHaveLength(1);
    expect(a.parent).toBeNull();
    merged[0]!.geometry.computeBoundingBox();
    const bb = merged[0]!.geometry.boundingBox!;
    expect(bb.max.x).toBeCloseTo(1005);
    expect(bb.max.y).toBeCloseTo(55);
  });

  it('keeps the baked occlusion when every mesh of a set has it', () => {
    const root = new Group(), m = new MeshStandardMaterial(), bare = new MeshStandardMaterial();
    const baked = (g: BoxGeometry) => g.setAttribute('_ao', new Float32BufferAttribute(new Float32Array(2 * g.attributes.position!.count).fill(0.5), 2));
    root.add(new Mesh(baked(new BoxGeometry()), m), new Mesh(baked(new BoxGeometry()), m), new Mesh(baked(new BoxGeometry()), bare), new Mesh(new BoxGeometry(), bare));
    expect(mergeStatic(root)).toBe(4);
    const [a, b] = root.children.filter((c) => c.name === 'merged') as Mesh[];
    expect(a!.geometry.attributes._ao!.count).toBe(72);
    expect(b!.geometry.attributes._ao).toBeUndefined();
  });

  it('leaves picked, see-through, transparent and lone meshes as they are', () => {
    const root = new Group(), m = new MeshStandardMaterial(), glass = new MeshStandardMaterial({ transparent: true });
    const picked = tag(new Group(), 'lamp');
    picked.add(new Mesh(new BoxGeometry(), m));
    const ghost = seeThrough(new Mesh(new BoxGeometry(), m));
    root.add(picked, ghost, new Mesh(new BoxGeometry(), glass), new Mesh(new BoxGeometry(), glass), new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
    expect(mergeStatic(root)).toBe(0);
    expect(picked.children).toHaveLength(1);
    expect(root.children).toHaveLength(5);
  });
});
