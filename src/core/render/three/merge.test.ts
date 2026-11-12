import { describe, expect, it } from 'vitest';
import { BoxGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, ShaderLib, Vector3, type Material } from 'three';
import { own } from './materials';
import { mergePalette, mergeSiblings, mergeStatic, palettePatch, partsOf } from './merge';
import { idOf, seeThrough, tag } from './pick';

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

describe('mergePalette', () => {
  const merged = (root: Group) => root.children.filter((c) => c.name === 'merged') as Mesh[];

  it('merges meshes whose materials differ only in colour, roughness and metalness, each vertex with its own', () => {
    const root = new Group(), red = new MeshStandardMaterial({ color: 0xff0000, roughness: 0.2, metalness: 0 });
    const blue = new MeshStandardMaterial({ color: 0x0000ff, roughness: 0.9, metalness: 1 });
    const a = new Mesh(new BoxGeometry(10, 10, 10), red), b = new Mesh(new BoxGeometry(10, 10, 10), blue);
    b.position.set(20, 0, 0);
    a.castShadow = b.castShadow = true;
    root.add(a, b);
    const dropped: Material[] = [], twins: Material[] = [];
    expect(mergePalette(root, { drop: (m) => dropped.push(m), twin: (_s, c) => twins.push(c) })).toBe(2);
    const [out] = merged(root);
    expect(root.children).toHaveLength(1);
    expect(out!.castShadow).toBe(true);
    const m = out!.material as MeshStandardMaterial, pc = out!.geometry.attributes._pc!, prm = out!.geometry.attributes._prm!;
    expect(m.color.getHex()).toBe(0xffffff);
    expect(m.customProgramCacheKey()).toMatch(/\|pal$/);
    expect(twins).toEqual([m]);
    expect(dropped).toEqual([red, blue]);
    // a box unindexed: 36 corners each, the red one first
    expect(pc.count).toBe(72);
    expect([pc.getX(0), pc.getY(0), pc.getZ(0), prm.getX(0), prm.getY(0)]).toEqual([1, 0, 0, expect.closeTo(0.2), 0]);
    expect([pc.getX(71), pc.getY(71), pc.getZ(71), prm.getX(71), prm.getY(71)]).toEqual([0, 0, 1, expect.closeTo(0.9), 1]);
    // the parts as they were, for the bake's export
    const parts = partsOf(out!);
    expect(parts.map((p) => p.mesh)).toEqual([a, b]);
    expect(parts[1]!.inMesh.elements[12]).toBe(20);
    expect(partsOf(a)).toEqual([]);
  });

  it('leaves alone what answers a click, glows, has a writer, is see-through or refused, and materials that differ in more', () => {
    const root = new Group(), plain = () => new MeshStandardMaterial({ color: 0x808080 }), box = () => new BoxGeometry(10, 10, 10);
    const picked = tag(new Group(), 'lamp');
    picked.add(new Mesh(box(), plain()), new Mesh(box(), plain()));
    const glow = new MeshStandardMaterial({ emissive: 0x112233 }), mine = own(plain()), glass = new MeshStandardMaterial({ transparent: true });
    const refused = plain(), twoSided = new MeshStandardMaterial({ side: DoubleSide }), lone = plain();
    root.add(picked, new Mesh(box(), glow), new Mesh(box(), mine), new Mesh(box(), glass), seeThrough(new Mesh(box(), plain())),
      new Mesh(box(), refused), new Mesh(box(), twoSided), new Mesh(box(), lone));
    expect(mergePalette(root, { ok: (m) => m !== refused })).toBe(0);
    expect(merged(root)).toHaveLength(0);
    expect(picked.children).toHaveLength(2);
  });

  it('gives the bake its parts as they were: each geometry untouched, in the root frame by its matrix (the export reads them, tools/bake/scene.ts)', () => {
    const root = new Group(), inner = new Group();
    inner.position.set(300, -40, 7); inner.rotation.y = 0.7;
    const a = new Mesh(new BoxGeometry(10, 20, 30), new MeshStandardMaterial({ color: 0x111111 })), b = new Mesh(new CylinderGeometry(5, 5, 10, 8), new MeshStandardMaterial({ color: 0x222222 }));
    a.position.set(1.5, 2.25, -3); b.position.set(-20, 0, 4); b.scale.set(1, 2, 1);
    inner.add(b);
    root.add(a, inner);
    const was = [a, b].map((m) => Float32Array.from(m.geometry.attributes.position!.array));
    expect(mergePalette(root)).toBe(2);
    const out = merged(root)[0]!, pos = out.geometry.attributes.position!, parts = partsOf(out), p = new Vector3();
    let at = 0;
    parts.forEach(({ mesh, inMesh }, i) => {
      expect(Array.from(mesh.geometry.attributes.position!.array)).toEqual(Array.from(was[i]!));
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry, q = g.attributes.position!;
      for (let k = 0; k < q.count; k++, at++) {
        p.fromBufferAttribute(q, k).applyMatrix4(inMesh);
        expect(Math.abs(p.x - pos.getX(at)) + Math.abs(p.y - pos.getY(at)) + Math.abs(p.z - pos.getZ(at))).toBeLessThan(1e-3);
      }
    });
    expect(at).toBe(pos.count);
  });

  it('keeps the cells of space apart, skips the subtrees it is told to, and keeps the light map UVs', () => {
    const root = new Group(), skipped = new Group(), uv1 = (g: BoxGeometry) => g.setAttribute('uv1', g.attributes.uv!.clone());
    const at = (x: number, c: number) => { const m = new Mesh(uv1(new BoxGeometry(10, 10, 10)), new MeshStandardMaterial({ color: c })); m.position.x = x; return m; };
    root.add(at(0, 0x111111), at(20, 0x222222), at(1000, 0x333333), at(1020, 0x444444), skipped);
    skipped.add(at(40, 0x555555), at(60, 0x666666));
    expect(mergePalette(root, { cell: 500, skip: [skipped] })).toBe(4);
    const out = merged(root);
    expect(out).toHaveLength(2);
    for (const m of out) expect(m.geometry.attributes.uv1!.count).toBe(72);
    expect(skipped.children).toHaveLength(2);
  });

  it('patches the standard shader, and fails loudly when three moved a place it patches', () => {
    const sh = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
    palettePatch(sh);
    expect(sh.vertexShader).toContain('vPalC = _pc;');
    expect(sh.fragmentShader).toContain('vec4( vPalC, opacity )');
    expect(sh.fragmentShader).toContain('roughnessFactor = vPalRM.x;');
    expect(sh.fragmentShader).toContain('metalnessFactor = vPalRM.y;');
    expect(sh.fragmentShader).not.toContain('#include <roughnessmap_fragment>');
    expect(() => palettePatch({ vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: 'void main() {}' })).toThrow(/palette patch/);
  });
});

describe('mergeSiblings', () => {
  const box = () => new BoxGeometry(10, 10, 10), grey = (c = 0x808080) => new MeshStandardMaterial({ color: c });
  const meshes = (o: Group) => { const out: Mesh[] = []; o.traverse((x) => { if ((x as Mesh).isMesh) out.push(x as Mesh); }); return out; };

  it('merges the meshes of each parent in that parent: the part keeps its id, its transform and the colour of each mesh', () => {
    const root = new Group(), part = tag(new Group(), 'ram0'), arm = new Group();
    arm.position.set(100, 0, 0); arm.rotation.z = 0.5;
    const a = new Mesh(box(), grey(0xff0000)), b = new Mesh(box(), grey(0x00ff00)), c = new Mesh(box(), grey(0x0000ff)), d = new Mesh(box(), grey(0xffff00));
    b.position.set(20, 0, 0); d.position.set(0, 30, 0);
    part.add(a, b, arm);
    arm.add(c, d);
    root.add(part);
    const world = (m: Mesh) => { m.updateWorldMatrix(true, false); return new Vector3().setFromMatrixPosition(m.matrixWorld); };
    const dAt = world(d);
    expect(mergeSiblings(root)).toBe(4);
    expect(part.children.filter((x) => x.name === 'merged')).toHaveLength(1);
    const inArm = arm.children as Mesh[];
    expect(inArm).toHaveLength(1);
    expect(idOf(inArm[0]!)).toBe('ram0');
    // the arm still carries its meshes: its corner where d stood
    inArm[0]!.geometry.computeBoundingBox();
    const top = inArm[0]!.geometry.boundingBox!.max.y;
    expect(top).toBeCloseTo(35);
    arm.rotation.z = 0;
    root.updateMatrixWorld(true);
    expect(world(inArm[0]!).x).toBeCloseTo(100);
    expect(dAt.x).not.toBeCloseTo(100);
    // one palette material for the part's one program
    expect((part.children.find((x) => x.name === 'merged') as Mesh).material).toBe(inArm[0]!.material);
  });

  it('leaves the children of the root, skipped trees, named meshes, glows, fades, writers and see-through meshes apart', () => {
    const root = new Group(), part = tag(new Group(), 'case'), skipped = new Group();
    root.add(new Mesh(box(), grey()), new Mesh(box(), grey()), part);
    const named = new Mesh(box(), grey()); named.name = 'psu-cover';
    const marked = new Mesh(box(), grey()); marked.userData.plug = true;
    const glow = new Mesh(box(), new MeshStandardMaterial({ emissive: 0x220000 })), mine = new Mesh(box(), own(grey()));
    const glass = new Mesh(box(), new MeshStandardMaterial({ transparent: true, opacity: 0.5 })), lone = new Mesh(box(), grey());
    part.add(named, marked, glow, mine, glass, seeThrough(new Mesh(box(), grey())), lone, skipped);
    skipped.add(new Mesh(box(), grey()), new Mesh(box(), grey()));
    // (only the lone mesh and the see-through one join: one program in one scope, each a mesh of its own on one palette material)
    expect(mergeSiblings(root, { skip: [skipped] })).toBe(2);
    expect(meshes(root)).toHaveLength(11);
    for (const m of [named, marked, glow, mine, glass, ...skipped.children, ...root.children.slice(0, 2)]) expect(m.parent).not.toBeNull();
    expect(lone.parent).toBeNull();
  });

  it('merges see-through meshes only with those that share their ray, and keeps a palette material inside each fade', () => {
    const root = new Group(), part = tag(new Group(), 'gpu0'), lid = new Group(), body = new Group(), none = () => {};
    const ghost = (c: number) => { const m = new Mesh(box(), grey(c)); m.raycast = none; return m; };
    part.add(ghost(0x111111), ghost(0x222222), new Mesh(box(), grey(0x333333)), lid, body);
    lid.add(new Mesh(box(), grey(1)), new Mesh(box(), grey(2)));
    body.add(new Mesh(box(), grey(3)), new Mesh(box(), grey(4)));
    root.add(part);
    expect(mergeSiblings(root, { apart: [lid] })).toBe(7);
    const out = meshes(root);
    expect(out.find((m) => m.parent === part && m.raycast === none)).toBeDefined();
    const [l, b] = [lid, body].map((g) => g.children[0] as Mesh);
    expect(l!.material).not.toBe(b!.material);
    expect(b!.material).toBe(out.find((m) => m.parent === part && m.raycast !== none)!.material);
  });
});
