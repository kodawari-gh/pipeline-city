import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import { mergeStatic, type BakePart } from './merge';
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

  it('merges only the meshes `only` takes', () => {
    const root = new Group(), m = new MeshStandardMaterial(), keep = new Mesh(new BoxGeometry(), m);
    keep.userData.receiver = true;
    root.add(new Mesh(new BoxGeometry(), m), new Mesh(new BoxGeometry(), m), keep);
    expect(mergeStatic(root, (x) => !x.userData.receiver)).toBe(2);
    expect(keep.parent).toBe(root);
  });

  it('keeps the light map UVs and the hashes of lit meshes, in order', () => {
    const root = new Group(), m = new MeshStandardMaterial();
    const lit = (hash: string, n: number) => {
      const g = new BoxGeometry().toNonIndexed();
      g.setAttribute('uv1', new BufferAttribute(new Uint16Array(2 * g.attributes.position!.count).fill(n), 2, true));
      const o = new Mesh(g, m);
      o.userData.bakeHash = hash;
      return o;
    };
    root.add(lit('36-a', 1), lit('36-b', 2));
    expect(mergeStatic(root)).toBe(2);
    const [out] = root.children as Mesh[];
    expect(out!.geometry.attributes.uv1!.count).toBe(72);
    expect(out!.geometry.attributes.uv1!.getX(36)).toBeCloseTo(2 / 65535);
    expect(out!.userData.bakeParts as BakePart[]).toEqual([{ hash: '36-a', corners: 36 }, { hash: '36-b', corners: 36 }]);
    // merged again, a merged mesh gives its own parts
    root.add(lit('36-c', 3));
    expect(mergeStatic(root)).toBe(2);
    expect((root.children[0] as Mesh).userData.bakeParts.map((p: BakePart) => p.hash)).toEqual(['36-a', '36-b', '36-c']);
  });

  it('does not join a lit mesh to an unlit one', () => {
    const root = new Group(), m = new MeshStandardMaterial(), g = new BoxGeometry().toNonIndexed();
    g.setAttribute('uv1', new BufferAttribute(new Uint16Array(2 * g.attributes.position!.count), 2, true));
    root.add(new Mesh(g, m), new Mesh(new BoxGeometry(), m));
    expect(mergeStatic(root)).toBe(0);
  });
});
