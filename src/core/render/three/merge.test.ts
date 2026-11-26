import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShaderLib,
  Vector3,
} from 'three';
import type * as threeTypes from 'three';
import { DARK_METAL } from './cheapmaterials';
import { setLowDetail } from './detail';
import { own } from './materials';
import {
  glows,
  mergePalette,
  mergeSiblings,
  mergeSiblingsSteps,
  mergeStatic,
  mergeWithin,
  palettePatch,
  partsOf,
} from './merge';
import { idOf, seeThrough, tag } from './pick';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: threeTypes.Object3D | undefined): o is Mesh => o instanceof Mesh;

/** The object as a mesh, failing the test when it is something else. */
function asMesh(o: threeTypes.Object3D | undefined): Mesh {
  assert(isMesh(o), 'expected a mesh');
  return o;
}

/** The material as a standard material, failing the test when it is something else. */
function asStandard(m: threeTypes.Material | threeTypes.Material[]): MeshStandardMaterial {
  assert.instanceOf(m, MeshStandardMaterial);
  return m;
}

/** Three's compile parameters, as far as a shader patch reads them: the two shaders and their uniforms. */
const isCompileParams = (x: unknown): x is threeTypes.WebGLProgramParametersWithUniforms =>
  typeof x === 'object' && x !== null && 'vertexShader' in x && 'fragmentShader' in x && 'uniforms' in x;
/** A renderer as far as a shader patch sees one (none of them draws with it). */
const isRenderer = (x: unknown): x is threeTypes.WebGLRenderer => typeof x === 'object' && x !== null && 'render' in x;

/** The fragment shader `m` compiles to, from three's physical shaders, as three gives them to `onBeforeCompile`. */
function compiledBy(m: threeTypes.Material): string {
  const sh = {
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
      uniforms: {},
    },
    renderer = { render: vi.fn<() => void>() };
  assert(isCompileParams(sh));
  assert(isRenderer(renderer));
  m.onBeforeCompile(sh, renderer);
  return sh.fragmentShader;
}

/** The meshes a merge made in `root`. */
const mergedIn = (root: threeTypes.Object3D) => root.children.filter((c) => c.name === 'merged').map((c) => asMesh(c));
/** The meshes among the children of `o`. */
const meshChildren = (o: threeTypes.Object3D) => o.children.filter(isMesh);
/** Every mesh under `o`. */
const meshes = (o: threeTypes.Object3D) => {
  const out: Mesh[] = [];
  o.traverse((x) => {
    if (isMesh(x)) {
      out.push(x);
    }
  });
  return out;
};
/** A box geometry with each corner's baked occlusion at a half. */
const baked = (g: BoxGeometry) => {
  const ao = new Float32Array(2 * must(g.attributes['position']).count).fill(0.5);
  return g.setAttribute('_ao', new Float32BufferAttribute(ao, 2));
};
/** The geometry without its index (as the merge unrolls it). */
const unindexed = (g: threeTypes.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
/** The geometry with its UVs copied to the light map's. */
const uv1 = (g: BoxGeometry) => g.setAttribute('uv1', must(g.attributes['uv']).clone());
const box = () => new BoxGeometry(10, 10, 10),
  grey = (c = 0x80_80_80) => new MeshStandardMaterial({ color: c }),
  blk = () => new MeshStandardMaterial({ color: 0x18_18_1b, roughness: 0.55, metalness: 0.05 });
/** Where the mesh stands in the world. */
const world = (m: Mesh) => {
  m.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(m.matrixWorld);
};
/** A box with light map UVs, of colour `c`, at `x`. */
const mappedBoxAt = (x: number, c: number) => {
  const m = new Mesh(uv1(new BoxGeometry(10, 10, 10)), new MeshStandardMaterial({ color: c }));
  m.position.x = x;
  return m;
};
/** A raycast that hits nothing. */
function noHit(): void {
  // (a see-through mesh answers no ray)
}

describe('mergeStatic', () => {
  it('merges the meshes that share a material into one, in the root frame', () => {
    const root = new Group(),
      m = new MeshStandardMaterial(),
      inner = new Group();
    inner.position.set(1000, 0, 0);
    const a = new Mesh(new BoxGeometry(10, 10, 10), m),
      b = new Mesh(new CylinderGeometry(5, 5, 10, 8), m);
    b.position.set(0, 50, 0);
    inner.add(b);
    root.add(a, inner);
    expect(mergeStatic(root)).toBe(2);
    const merged = mergedIn(root);
    expect(merged).toHaveLength(1);
    expect(a.parent).toBeNull();
    must(merged[0]).geometry.computeBoundingBox();
    const bb = must(must(merged[0]).geometry.boundingBox);
    expect(bb.max.x).toBeCloseTo(1005);
    expect(bb.max.y).toBeCloseTo(55);
  });

  it('does not merge meshes of one material on different layers, and keeps the layers of the merged mesh', () => {
    const root = new Group(),
      m = new MeshStandardMaterial();
    const a = new Mesh(new BoxGeometry(), m),
      b = new Mesh(new BoxGeometry(), m),
      c = new Mesh(new BoxGeometry(), m);
    a.layers.enable(5);
    b.layers.enable(5);
    root.add(a, b, c);
    expect(mergeStatic(root)).toBe(2);
    expect(c.parent).toBe(root); // the lone one on layer 0 stays
    const merged = mergedIn(root);
    expect(merged).toHaveLength(1);
    expect(must(merged[0]).layers.mask).toBe(a.layers.mask);
    expect(must(merged[0]).layers.isEnabled(5)).toBe(true);
  });

  it('keeps the baked occlusion when every mesh of a set has it', () => {
    const root = new Group(),
      m = new MeshStandardMaterial(),
      bare = new MeshStandardMaterial();
    const [g1, g2, g3] = [baked(new BoxGeometry()), baked(new BoxGeometry()), baked(new BoxGeometry())];
    root.add(new Mesh(g1, m), new Mesh(g2, m), new Mesh(g3, bare), new Mesh(new BoxGeometry(), bare));
    expect(mergeStatic(root)).toBe(4);
    const [a, b] = mergedIn(root);
    expect(must(must(a).geometry.attributes['_ao']).count).toBe(72);
    expect(must(b).geometry.attributes['_ao']).toBeUndefined();
  });

  it('leaves picked, see-through, transparent and lone meshes as they are', () => {
    const root = new Group(),
      m = new MeshStandardMaterial(),
      glass = new MeshStandardMaterial({ transparent: true });
    const picked = tag(new Group(), 'lamp');
    picked.add(new Mesh(new BoxGeometry(), m));
    const ghost = seeThrough(new Mesh(new BoxGeometry(), m));
    root.add(
      picked,
      ghost,
      new Mesh(new BoxGeometry(), glass),
      new Mesh(new BoxGeometry(), glass),
      new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
    );
    expect(mergeStatic(root)).toBe(0);
    expect(picked.children).toHaveLength(1);
    expect(root.children).toHaveLength(5);
  });

  it('merges the lights of a prop with an id on the prop, by material, and leaves its other meshes', () => {
    const prop = tag(new Group(), 'router'),
      row = new Group(),
      part = tag(new Group(), 'port');
    const led = new MeshStandardMaterial({ emissive: 0x00_ff_00 }),
      amber = new MeshStandardMaterial({ emissive: 0xff_aa_00 }),
      body = new MeshStandardMaterial();
    row.rotation.y = Math.PI / 2;
    row.position.set(100, 0, 0);
    const far = new Mesh(new BoxGeometry(2, 2, 2), led);
    far.position.set(0, 0, 40);
    row.add(far, new Mesh(new BoxGeometry(), amber));
    part.add(new Mesh(new BoxGeometry(), led));
    prop.add(
      new Mesh(new BoxGeometry(2, 2, 2), led),
      new Mesh(new BoxGeometry(), body),
      new Mesh(new BoxGeometry(), body),
      row,
      part,
    );
    expect(mergeStatic(prop)).toBe(0); // (the prop's id keeps a plain merge out)
    expect(mergeStatic(prop, { own: true, ok: glows })).toBe(2);
    const merged = mergedIn(prop);
    expect(merged).toHaveLength(1);
    expect(must(merged[0]).material).toBe(led);
    expect(idOf(must(merged[0]))).toBe('router');
    // (the light in the turned row stands where it stood: 40 along the row's z is 40 along the prop's x)
    must(merged[0]).geometry.computeBoundingBox();
    expect(must(must(merged[0]).geometry.boundingBox).max.x).toBeCloseTo(141);
    expect(meshChildren(prop).filter((c) => c.material === body)).toHaveLength(2); // the body's meshes stay
    expect(row.children).toHaveLength(1); // the lone amber light stays
    expect(part.children).toHaveLength(1); // a part with its own id keeps its light
  });
});

describe('mergePalette', () => {
  const merged = mergedIn;

  it('merges meshes whose materials differ only in colour, roughness and metalness, each vertex with its own', () => {
    const root = new Group(),
      red = new MeshStandardMaterial({ color: 0xff_00_00, roughness: 0.2, metalness: 0 });
    const blue = new MeshStandardMaterial({ color: 0x00_00_ff, roughness: 0.9, metalness: 1 });
    const a = new Mesh(new BoxGeometry(10, 10, 10), red),
      b = new Mesh(new BoxGeometry(10, 10, 10), blue);
    b.position.set(20, 0, 0);
    a.castShadow = true;
    b.castShadow = true;
    root.add(a, b);
    const dropped: threeTypes.Material[] = [],
      twins: threeTypes.Material[] = [];
    expect(
      mergePalette(root, {
        drop: (m) => {
          dropped.push(m);
        },
        twin: (_s, c) => {
          twins.push(c);
        },
      }),
    ).toBe(2);
    const [out] = merged(root);
    expect(root.children).toHaveLength(1);
    expect(must(out).castShadow).toBe(true);
    const m = asStandard(must(out).material),
      pc = must(must(out).geometry.attributes['_pc']),
      prm = must(must(out).geometry.attributes['_prm']);
    expect(m.color.getHex()).toBe(0xff_ff_ff);
    expect(m.customProgramCacheKey()).toMatch(/\|pal$/u);
    expect(twins).toStrictEqual([m]);
    expect(dropped).toStrictEqual([red, blue]);
    // a box unindexed: 36 corners each, the red one first
    expect(pc.count).toBe(72);
    expect([pc.getX(0), pc.getY(0), pc.getZ(0), prm.getX(0), prm.getY(0)]).toStrictEqual([
      1,
      0,
      0,
      expect.closeTo(0.2),
      0,
    ]);
    expect([pc.getX(71), pc.getY(71), pc.getZ(71), prm.getX(71), prm.getY(71)]).toStrictEqual([
      0,
      0,
      1,
      expect.closeTo(0.9),
      1,
    ]);
    // the parts as they were, for the bake's export
    const parts = partsOf(must(out));
    expect(parts.map((p) => p.mesh)).toStrictEqual([a, b]);
    expect(must(parts[1]).inMesh.elements[12]).toBe(20);
    expect(partsOf(a)).toStrictEqual([]);
  });

  it('leaves alone what answers a click, glows, has a writer, is see-through or refused, and materials that differ in more', () => {
    const root = new Group(),
      plain = grey;
    const picked = tag(new Group(), 'lamp');
    picked.add(new Mesh(box(), plain()), new Mesh(box(), plain()));
    const glow = new MeshStandardMaterial({ emissive: 0x11_22_33 }),
      mine = own(plain()),
      glass = new MeshStandardMaterial({ transparent: true }),
      ghost = seeThrough(new Mesh(box(), plain()));
    const refused = plain(),
      twoSided = new MeshStandardMaterial({ side: DoubleSide }),
      lone = plain();
    root.add(
      picked,
      new Mesh(box(), glow),
      new Mesh(box(), mine),
      new Mesh(box(), glass),
      ghost,
      new Mesh(box(), refused),
      new Mesh(box(), twoSided),
      new Mesh(box(), lone),
    );
    expect(mergePalette(root, { ok: (m) => m !== refused })).toBe(0);
    expect(merged(root)).toHaveLength(0);
    expect(picked.children).toHaveLength(2);
  });

  it('gives the bake its parts as they were: each geometry untouched, in the root frame by its matrix (the export reads them, tools/bake/scene.ts)', () => {
    const root = new Group(),
      inner = new Group();
    inner.position.set(300, -40, 7);
    inner.rotation.y = 0.7;
    const a = new Mesh(new BoxGeometry(10, 20, 30), new MeshStandardMaterial({ color: 0x11_11_11 })),
      b = new Mesh(new CylinderGeometry(5, 5, 10, 8), new MeshStandardMaterial({ color: 0x22_22_22 }));
    a.position.set(1.5, 2.25, -3);
    b.position.set(-20, 0, 4);
    b.scale.set(1, 2, 1);
    inner.add(b);
    root.add(a, inner);
    const was = [a, b].map((m) => Float32Array.from(must(m.geometry.attributes['position']).array));
    expect(mergePalette(root)).toBe(2);
    const out = must(merged(root)[0]),
      pos = must(out.geometry.attributes['position']),
      parts = partsOf(out),
      p = new Vector3();
    let at = 0;
    for (const [i, { mesh, inMesh }] of parts.entries()) {
      expect([...must(mesh.geometry.attributes['position']).array]).toStrictEqual([...must(was[i])]);
      const q = must(unindexed(mesh.geometry).attributes['position']);
      for (let k = 0; k < q.count; k++, at++) {
        p.fromBufferAttribute(q, k).applyMatrix4(inMesh);
        expect(Math.abs(p.x - pos.getX(at)) + Math.abs(p.y - pos.getY(at)) + Math.abs(p.z - pos.getZ(at))).toBeLessThan(
          1e-3,
        );
      }
    }
    expect(at).toBe(pos.count);
  });

  it('keeps the cells of space apart, skips the subtrees it is told to, and keeps the light map UVs', () => {
    const root = new Group(),
      skipped = new Group(),
      at = mappedBoxAt;
    root.add(at(0, 0x11_11_11), at(20, 0x22_22_22), at(1000, 0x33_33_33), at(1020, 0x44_44_44), skipped);
    skipped.add(at(40, 0x55_55_55), at(60, 0x66_66_66));
    expect(mergePalette(root, { cell: 500, skip: [skipped] })).toBe(4);
    const out = merged(root);
    expect(out).toHaveLength(2);
    for (const m of out) {
      expect(must(m.geometry.attributes['uv1']).count).toBe(72);
    }
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
    expect(() => {
      palettePatch({ vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: 'void main() {}' });
    }).toThrow(/palette patch/u);
  });
});

/** What a merged palette mesh of two black plastic parts compiles to, as three gives its fragment shader to `onBeforeCompile`. */
function compiled(): string {
  const root = new Group(),
    par = new Group();
  par.add(new Mesh(new BoxGeometry(), blk()), new Mesh(new BoxGeometry(), blk()));
  root.add(par);
  mergeSiblings(root);
  return compiledBy(asStandard(asMesh(par.children[0]).material));
}

/** The program key of the palette material of a merge of two plain meshes. */
function paletteKey(): string {
  const root = new Group(),
    p = new Group();
  p.add(
    new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
    new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
  );
  root.add(p);
  mergeSiblings(root);
  return asStandard(asMesh(p.children[0]).material).customProgramCacheKey();
}

describe('the Low palette material draws as a Lambert does', () => {
  afterEach(() => {
    setLowDetail(false);
  });

  it('has no specular at Low: a black plug stays black under a bright light (it turned tan with PBR)', () => {
    setLowDetail(true);
    const f = compiled();
    expect(f).toContain('reflectedLight.directSpecular = vec3( 0.0 )');
    expect(f).toContain('reflectedLight.indirectSpecular = vec3( 0.0 )');
    expect(f.indexOf('indirectSpecular = vec3( 0.0 )')).toBeLessThan(f.indexOf('totalDiffuse')); // (before the light is summed)
  });

  it('reads a metal as the dark metal its Lambert shows, and takes its metalness off', () => {
    setLowDetail(true);
    const f = compiled();
    expect(f).toContain('lowMetal( vPalC, vPalRM.y )');
    expect(f).toContain('metalnessFactor = 0.0;');
    expect(f).not.toContain('metalnessFactor = vPalRM.y;');
    for (const c of DARK_METAL) {
      expect(f).toContain(`vec3( ${c.r.toFixed(6)}, ${c.g.toFixed(6)}, ${c.b.toFixed(6)} )`);
    }
  });

  it('keeps the PBR patch on every palette mesh of a merge that asks for it (`pbr`: the machine)', () => {
    setLowDetail(true);
    const root = new Group(),
      par = new Group();
    par.add(new Mesh(new BoxGeometry(), blk()), new Mesh(new BoxGeometry(), blk()));
    root.add(par);
    mergeSiblings(root, { pbr: true });
    const f = compiledBy(asStandard(asMesh(par.children[0]).material));
    expect(f).not.toContain('directSpecular = vec3( 0.0 )');
    expect(f).not.toContain('lowMetal');
    expect(f).toContain('metalnessFactor = vPalRM.y;');
  });

  it('is the PBR patch, as it was, at High', () => {
    const f = compiled();
    expect(f).not.toContain('directSpecular = vec3( 0.0 )');
    expect(f).not.toContain('lowMetal');
    expect(f).toContain('metalnessFactor = vPalRM.y;');
    expect(f).toContain('vec4( vPalC, opacity )');
  });

  it("keeps the two tiers' programs apart", () => {
    const key = paletteKey;
    const high = key();
    setLowDetail(true);
    expect(key()).not.toBe(high);
  });
});

describe('mergeWithin', () => {
  it('merges the loose meshes of one group, keeps the group in its parent, and tells twin of the palette material', () => {
    const root = new Group(),
      prop = tag(new Group(), 'prop'),
      twins: threeTypes.Material[] = [];
    const a = new Mesh(new BoxGeometry(10, 10, 10), new MeshStandardMaterial({ color: 0x11_22_33 })),
      b = new Mesh(new BoxGeometry(5, 5, 5), new MeshStandardMaterial({ color: 0x44_55_66 }));
    b.position.set(0, 20, 0);
    prop.add(a, b);
    root.add(prop);
    expect(
      mergeWithin(prop, {
        twin: (_s, c) => {
          twins.push(c);
        },
      }),
    ).toBe(2);
    expect(prop.parent).toBe(root);
    expect(prop.children).toHaveLength(1);
    expect(twins).toHaveLength(1);
    expect(must(prop.children[0]).parent).toBe(prop);
  });
  it('merges a group that has no parent yet', () => {
    const prop = new Group();
    prop.add(
      new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
      new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
    );
    expect(mergeWithin(prop)).toBe(2);
    expect(prop.parent).toBeNull();
    expect(prop.children).toHaveLength(1);
  });
});

describe('mergeSiblings', () => {
  it('merges the meshes of each parent in that parent: the part keeps its id, its transform and the colour of each mesh', () => {
    const root = new Group(),
      part = tag(new Group(), 'ram0'),
      arm = new Group();
    arm.position.set(100, 0, 0);
    arm.rotation.z = 0.5;
    const a = new Mesh(box(), grey(0xff_00_00)),
      b = new Mesh(box(), grey(0x00_ff_00)),
      c = new Mesh(box(), grey(0x00_00_ff)),
      d = new Mesh(box(), grey(0xff_ff_00));
    b.position.set(20, 0, 0);
    d.position.set(0, 30, 0);
    part.add(a, b, arm);
    arm.add(c, d);
    root.add(part);
    const dAt = world(d);
    expect(mergeSiblings(root)).toBe(4);
    expect(part.children.filter((x) => x.name === 'merged')).toHaveLength(1);
    const inArm = arm.children.map((x) => asMesh(x));
    expect(inArm).toHaveLength(1);
    expect(idOf(must(inArm[0]))).toBe('ram0');
    // the arm still carries its meshes: its corner where d stood
    must(inArm[0]).geometry.computeBoundingBox();
    const top = must(must(inArm[0]).geometry.boundingBox).max.y;
    expect(top).toBeCloseTo(35);
    arm.rotation.z = 0;
    root.updateMatrixWorld(true);
    expect(world(must(inArm[0])).x).toBeCloseTo(100);
    expect(dAt.x).not.toBeCloseTo(100);
    // one palette material for the part's one program
    expect(asMesh(part.children.find((x) => x.name === 'merged')).material).toBe(must(inArm[0]).material);
  });

  it('leaves the children of the root, skipped trees, named meshes, glows, fades, writers and see-through meshes apart', () => {
    const root = new Group(),
      part = tag(new Group(), 'case'),
      skipped = new Group();
    root.add(new Mesh(box(), grey()), new Mesh(box(), grey()), part);
    const named = new Mesh(box(), grey());
    named.name = 'psu-cover';
    const marked = new Mesh(box(), grey());
    marked.userData['plug'] = true;
    const glow = new Mesh(box(), new MeshStandardMaterial({ emissive: 0x22_00_00 })),
      mine = new Mesh(box(), own(grey()));
    const glass = new Mesh(box(), new MeshStandardMaterial({ transparent: true, opacity: 0.5 })),
      lone = new Mesh(box(), grey());
    const ghost = seeThrough(new Mesh(box(), grey()));
    part.add(named, marked, glow, mine, glass, ghost, lone, skipped);
    skipped.add(new Mesh(box(), grey()), new Mesh(box(), grey()));
    // (only the lone mesh and the see-through one join: one program in one scope, each a mesh of its own on one palette material)
    expect(mergeSiblings(root, { skip: [skipped] })).toBe(2);
    expect(meshes(root)).toHaveLength(11);
    for (const m of [named, marked, glow, mine, glass, ...skipped.children, ...root.children.slice(0, 2)]) {
      expect(m.parent).not.toBeNull();
    }
    expect(lone.parent).toBeNull();
  });

  it('merges see-through meshes only with those that share their ray, and keeps a palette material inside each fade', () => {
    const root = new Group(),
      part = tag(new Group(), 'gpu0'),
      lid = new Group(),
      body = new Group(),
      none = noHit;
    const ghost = (c: number) => {
      const m = new Mesh(box(), grey(c));
      m.raycast = none;
      return m;
    };
    part.add(ghost(0x11_11_11), ghost(0x22_22_22), new Mesh(box(), grey(0x33_33_33)), lid, body);
    lid.add(new Mesh(box(), grey(1)), new Mesh(box(), grey(2)));
    body.add(new Mesh(box(), grey(3)), new Mesh(box(), grey(4)));
    root.add(part);
    expect(mergeSiblings(root, { apart: [lid] })).toBe(7);
    const out = meshes(root);
    const inPart = out.filter((m) => m.parent === part);
    expect(inPart.find((m) => m.raycast === none)).toBeDefined();
    const [l, b] = [lid, body].map((g) => asMesh(g.children[0]));
    expect(must(l).material).not.toBe(must(b).material);
    expect(must(b).material).toBe(must(inPart.find((m) => m.raycast !== none)).material);
  });

  it('in steps (`mergeSiblingsSteps`) it yields after each set, with the sets after it still whole, and ends with the count of the one call', () => {
    const root = new Group(),
      part = tag(new Group(), 'ram0');
    const a = new Mesh(box(), grey(1)),
      b = new Mesh(box(), grey(2)),
      c = new Mesh(box(), grey(3)),
      d = new Mesh(box(), grey(4));
    // (two sets: they differ in how they cast)
    a.castShadow = true;
    b.castShadow = true;
    part.add(a, b, c, d);
    root.add(part);
    const run = mergeSiblingsSteps(root),
      merged = () => part.children.filter((x) => x.name === 'merged').length;
    let step = run.next(),
      yields = 0;
    expect(merged()).toBe(1);
    expect(c.parent).toBe(part);
    for (; step.done !== true; step = run.next()) {
      yields++;
    }
    expect(yields).toBe(2);
    expect(step.value).toBe(4);
    expect(merged()).toBe(2);
    expect(part.children).toHaveLength(2);
  });
});
