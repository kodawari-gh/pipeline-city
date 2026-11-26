import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Frustum,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Sphere,
} from 'three';
import type * as threeTypes from 'three';
import { assert, describe, expect, it, vi } from 'vitest';
import { ballOf, bearing, columnsOf, Sweep, sweptMerge, sweptMergeReference } from './sweep';
import { GRID } from './plan';
import { LOW_CELL } from './detail';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Three unit boxes of 3 vertices each, at x = -100, 0 and 100, 50 m north of the window. */
function row(): { mesh: Mesh; sweep: Sweep } {
  const xs = [-100, 0, 100],
    pos: number[] = [];
  for (const x of xs) {
    pos.push(x, 0, -50, x + 1, 0, -50, x, 1, -50);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  const mesh = new Mesh(g);
  return {
    mesh,
    sweep: new Sweep(
      xs.map((_, i) => ballOf(pos, 3 * i, 3 * i + 3)),
      [{ mesh, at: [0, 3, 6, 9] }],
    ),
  };
}

/** A narrow camera at the origin, looking north (`dz` -1) or south (1). */
function frustum(dz = -1): Frustum {
  const c = new PerspectiveCamera(30, 1, 0.1, 1000);
  c.lookAt(0, 0, dz);
  c.updateMatrixWorld();
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse),
  );
}

/** Whether an object is a mesh. */
const isMesh = (o: unknown): o is Mesh => o instanceof Mesh;

/** The object as a mesh, or a failed test. */
function meshAt(o: unknown): Mesh {
  assert(isMesh(o), 'not a mesh');
  return o;
}

/** The name of a mesh's one material. */
function matName(m: Mesh): string {
  assert.instanceOf(m.material, Material);
  return m.material.name;
}

/** Whether an object is a mesh on the material named `name`. */
const isOn = (o: unknown, name: string): boolean => isMesh(o) && matName(o) === name;

/** The value down a path of fields under `o`, each read as it stands (unknown until checked): a sweep keeps these to itself. */
function dig(o: unknown, ...path: string[]): unknown {
  let at = o;
  for (const k of path) {
    assert(typeof at === 'object' && at !== null, `no ${path.join('.')}`);
    const fields = new Map<string, unknown>(Object.entries(at));
    assert(fields.has(k), `no ${path.join('.')}`);
    at = fields.get(k);
  }
  return at;
}

/** A list read with `dig`, checked. */
function listAt(x: unknown): unknown[] {
  assert(Array.isArray(x), 'not a list');
  const list: unknown[] = x;
  return list;
}

/** A sweep's balls, a piece each. */
const ballsOf = (s: Sweep): threeTypes.Sphere[] =>
  listAt(dig(s, 'balls')).map((b) => {
    assert.instanceOf(b, Sphere);
    return b;
  });

/** A sweep's runs: where each mesh's pieces start. */
const runsOf = (s: Sweep): unknown[][] => listAt(dig(s, 'runs')).map((r) => listAt(dig(r, 'at')));

/** Boxes in a line 20 m apart, 300 m long, on one material. */
const line = (): { root: Group; mat: MeshBasicMaterial } => {
  const root = new Group(),
    mat = new MeshBasicMaterial();
  for (let x = 0; x < 300; x += 20) {
    const m = new Mesh(new BoxGeometry(1, 1, 1), mat);
    m.position.set(GRID.av0 + x, 0, -50);
    root.add(m);
  }
  return { root, mat };
};
const cells = (s: Sweep): number => ballsOf(s).length;
const total = (root: Group): number => {
  const attribute = meshAt(root.children[0]).geometry.attributes['position'];
  assert.exists(attribute);
  return attribute.count;
};

/** A two-number `_ao` a vertex, from the vertex number. */
const withAo = (g: BufferGeometry): BufferGeometry => {
  const n = must(g.attributes['position']).count,
    ao = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    ao[2 * i] = (i % 7) / 7;
    ao[2 * i + 1] = (i % 5) / 5;
  }
  return g.setAttribute('_ao', new BufferAttribute(ao, 2));
};
/** `n` loose triangles, a position only. */
const soup = (n: number, seed: number): BufferGeometry => {
  const p = new Float32Array(9 * n);
  for (let i = 0; i < p.length; i++) {
    p[i] = Math.sin(seed + i * 1.7) * 3;
  }
  return new BufferGeometry().setAttribute('position', new BufferAttribute(p, 3));
};
/** A bent quad as two indexed triangles, with a uv and no normal. */
const quad = (): BufferGeometry =>
  new BufferGeometry()
    .setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 1]), 3))
    .setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
    .setIndex([0, 1, 2, 0, 2, 3]);

/** The attributes a merge keeps beyond its own: `_ao` or none. */
const keptOf = (ao: boolean): string[] => (ao ? ['_ao'] : []);

/** The attributes of a merged mesh, with or without `_ao`. */
const attrsOf = (ao: boolean): string[] => (ao ? ['position', 'normal', 'uv', '_ao'] : ['position', 'normal', 'uv']);

/** The meshes under `root` on the material. */
function meshesOn(root: threeTypes.Object3D, mat: threeTypes.Material): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if (isMesh(o) && o.material === mat) {
      meshes.push(o);
    }
  });
  return meshes;
}

/** The geometry of the last child. */
const first = (r: Group): BufferGeometry => meshAt(r.children.at(-1)).geometry;

/** Takes the `_ao` off the first child. */
const drop = (r: Group): void => {
  meshAt(r.children[0]).geometry.deleteAttribute('_ao');
};

/** Lets a console line go unsaid (the test expects it). */
function hush(): void {
  // nothing to say
}

/** A position attribute on an empty geometry. */
const positioned = (a: threeTypes.BufferAttribute | threeTypes.InterleavedBufferAttribute): BufferGeometry =>
  new BufferGeometry().setAttribute('position', a);

describe('sweep', () => {
  it('measures the bearing from the window: 0 north, negative west', () => {
    expect(bearing(GRID.av0, -10)).toBeCloseTo(0);
    expect(bearing(GRID.av0 - 10, -10)).toBeLessThan(0);
    expect(bearing(GRID.av0 + 10, -10)).toBeGreaterThan(0);
  });

  it('balls the vertices it is given, and none as empty', () => {
    const b = ballOf([0, 0, 0, 2, 0, 0], 0, 2);
    expect(b.center.x).toBeCloseTo(1);
    expect(b.radius).toBeCloseTo(1);
    expect(ballOf([], 0, 0).radius).toBeLessThan(0);
  });

  it('draws only the run the camera sees, and all of it with no frustum', () => {
    const { mesh, sweep } = row();
    sweep.cut(frustum());
    expect(mesh.geometry.drawRange).toMatchObject({ start: 3, count: 3 });
    expect(mesh.visible).toBe(true);
    sweep.cut();
    expect(mesh.geometry.drawRange).toMatchObject({ start: 0, count: 9 });
  });

  it("draws the run of the camera and of a second frustum together (the sun's box), and nothing outside both", () => {
    const { mesh, sweep } = row();
    sweep.cut(frustum(1)); // looking south: none of the three pieces
    expect(mesh.visible).toBe(false);
    sweep.cut(frustum(1), frustum(-1)); // the box looks north: the middle piece
    expect(mesh.geometry.drawRange).toMatchObject({ start: 3, count: 3 });
    expect(mesh.visible).toBe(true);
    sweep.cut(frustum(-1), frustum(1)); // the eye looks north, the box south: the eye's run alone
    expect(mesh.geometry.drawRange).toMatchObject({ start: 3, count: 3 });
  });

  it('merges the meshes on each material in bearing order, and leaves the rest', () => {
    const root = new Group(),
      paint = new MeshBasicMaterial(),
      stone = new MeshBasicMaterial();
    for (const x of [100, -100, 0]) {
      const m = new Mesh(new BoxGeometry(1, 1, 1), paint);
      m.position.set(GRID.av0 + x, 0, -50);
      root.add(m);
    }
    root.add(new Mesh(new BoxGeometry(1, 1, 1), stone));
    const [sw] = sweptMerge(root, [paint]);
    expect(root.children.map((o) => meshAt(o).material)).toStrictEqual([stone, paint]);
    const merged = meshAt(root.children[1]),
      pos = must(merged.geometry.attributes['position']);
    expect(pos.count).toBe(3 * 36);
    // west to east: the pieces at -100, 0 and +100 m
    expect([0, 36, 72].map((v) => Math.round((pos.getX(v) - GRID.av0) / 100) + 0)).toStrictEqual([-1, 0, 1]);
    assert.exists(sw);
    sw.cut();
    expect(merged.geometry.drawRange).toMatchObject({ start: 0, count: 108 });
  });

  describe('cell size', () => {
    it('lock: the default cell is 24 m', () => {
      const a = line(),
        b = line();
      const [d] = sweptMerge(a.root, [a.mat]),
        [e] = sweptMerge(b.root, [b.mat], 24);
      assert.exists(e);
      assert.exists(d);
      expect(cells(e)).toBe(cells(d));
      expect(total(b.root)).toBe(total(a.root));
    });

    it('Low: a 96 m cell makes fewer cells and draws the same', () => {
      const a = line(),
        b = line();
      const [d] = sweptMerge(a.root, [a.mat]),
        [e] = sweptMerge(b.root, [b.mat], LOW_CELL);
      assert.exists(e);
      assert.exists(d);
      expect(cells(e)).toBeLessThan(cells(d));
      expect(total(b.root)).toBe(total(a.root));
    });
  });

  it('hides the mesh when the camera sees none of it', () => {
    const { mesh, sweep } = row();
    sweep.cut(frustum(1));
    expect(mesh.geometry.drawRange.count).toBe(0);
    expect(mesh.visible).toBe(false);
  });
});

/** A street: boxes in a few cells, loose triangles with and without a normal or a uv, a skewed group, and a mesh of another material. */
function street(ao: boolean): { root: Group; mats: threeTypes.Material[]; paint: threeTypes.Material } {
  const root = new Group(),
    paint = new MeshBasicMaterial({ name: 'paint' }),
    stone = new MeshBasicMaterial({ name: 'stone' }),
    lone = new MeshBasicMaterial({ name: 'lone' });
  root.position.set(3, -2, 5);
  root.rotation.set(0.1, 0.4, -0.2);
  const put = (g: BufferGeometry, [x, z]: [number, number], parent: threeTypes.Object3D = root): Mesh => {
    const m = new Mesh(ao ? withAo(g) : g, paint);
    m.position.set(x, 1, z);
    m.rotation.y = x * 0.01;
    m.castShadow = x === -110;
    m.receiveShadow = x > 0;
    parent.add(m);
    return m;
  };
  for (const x of [-110, -70, -30, -25, 10, 15, 50, 90]) {
    put(new BoxGeometry(1 + (x % 3), 1, 2), [x, -50 - x * 0.3]);
  }
  put(soup(4, 1), [30, -80]);
  put(quad(), [-60, -20]);
  const normals = Float32Array.from({ length: 18 }, (_, i) => Math.cos(i) + 2);
  put(soup(2, 5).setAttribute('normal', new BufferAttribute(normals, 3)), [70, -40]);
  const skew = new Group();
  skew.scale.set(1, 2, 0.5);
  skew.rotation.set(0.5, 0.2, 0);
  skew.position.set(20, 0, -60);
  root.add(skew);
  put(new BoxGeometry(2, 2, 2), [3, 4], skew);
  root.add(new Mesh(new BoxGeometry(1, 1, 1), stone), new Mesh(new BoxGeometry(1, 1, 1), lone));
  return { root, mats: [paint, lone], paint };
}

/** What a merge leaves: the root's children with their arrays, and the sweeps' balls and runs. */
function shape(root: Group, sweeps: Sweep[]): unknown {
  return {
    kids: root.children.map((o) => {
      if (!isMesh(o)) {
        return { group: o.children.length };
      }
      const g = o.geometry;
      return {
        mat: matName(o),
        cast: o.castShadow,
        recv: o.receiveShadow,
        groups: g.groups,
        indexed: g.index !== null,
        attrs: Object.entries(g.attributes).map(([k, a]) => [k, a.itemSize, a.array]),
      };
    }),
    runs: sweeps.map((s) => runsOf(s)),
    balls: sweeps.map((s) => ballsOf(s).map((b) => [b.center.x, b.center.y, b.center.z, b.radius])),
  };
}

describe('sweptMerge against the plain way', () => {
  it.each<[number, boolean]>([
    [24, true],
    [96, true],
    [24, false],
  ])('makes the same mesh, order and cuts: cell %d m, `_ao` kept %s', (cell, ao) => {
    const a = street(true),
      b = street(true),
      keep = keptOf(ao);
    const fast = shape(a.root, sweptMerge(a.root, a.mats, cell, keep)),
      plain = shape(b.root, sweptMergeReference(b.root, b.mats, cell, keep));
    expect(fast).toStrictEqual(plain);
    // it merged: the paint is one mesh now, with a run for each cell
    const merged = a.root.children.filter((o) => isOn(o, 'paint'));
    expect(merged).toHaveLength(1);
    expect(Object.keys(meshAt(merged[0]).geometry.attributes)).toStrictEqual(attrsOf(ao));
  });

  it('takes the meshes of the street the quick way, not the plain one', () => {
    const { root, paint } = street(true);
    const meshes = meshesOn(root, paint);
    expect(meshes).toHaveLength(12);
    for (const m of meshes) {
      expect(columnsOf(m.geometry, ['_ao'])).not.toBeNull();
    }
  });

  it('makes the same flat normals and zero uvs for a mesh that has none', () => {
    const a = street(false),
      b = street(false);
    sweptMerge(a.root, a.mats);
    sweptMergeReference(b.root, b.mats);
    const attribute2 = first(a.root).attributes['normal'];
    assert.exists(attribute2);
    assert.instanceOf(attribute2.array, Float32Array);
    const nrm = attribute2.array;
    expect(nrm).toStrictEqual(must(first(b.root).attributes['normal']).array);
    expect(nrm.every((v) => Number.isFinite(v))).toBe(true);
    const attribute3 = first(a.root).attributes['uv'];
    assert.exists(attribute3);
    expect(attribute3.array).toStrictEqual(must(first(b.root).attributes['uv']).array);
  });

  it('leaves the meshes alone when their attributes differ (as the plain way does), and says why', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(hush);
    try {
      const a = street(true),
        b = street(true);
      // one mesh with no `_ao`
      drop(a.root);
      drop(b.root);
      const fast = shape(a.root, sweptMerge(a.root, a.mats, 24, ['_ao'])),
        plain = shape(b.root, sweptMergeReference(b.root, b.mats, 24, ['_ao']));
      expect(fast).toStrictEqual(plain);
      expect(a.root.children.filter((o) => isOn(o, 'paint')).length).toBeGreaterThan(1);
    } finally {
      err.mockRestore();
    }
  });

  it('sends what it cannot read as plain floats (interleaved, morphed, normalised, not a 3-vector) to the plain way', () => {
    const buffer = new InterleavedBuffer(new Float32Array(9), 3);
    const interleaved = positioned(new InterleavedBufferAttribute(buffer, 3, 0)),
      normalised = positioned(new BufferAttribute(new Uint16Array(9), 3, true)),
      flat = positioned(new BufferAttribute(new Float32Array(6), 2));
    expect(columnsOf(interleaved, [])).toBeNull();
    const morphed = soup(1, 1);
    morphed.morphAttributes.position = [new BufferAttribute(new Float32Array(9), 3)];
    expect(columnsOf(morphed, [])).toBeNull();
    expect(columnsOf(normalised, [])).toBeNull();
    expect(columnsOf(flat, [])).toBeNull();
    expect(columnsOf(new BufferGeometry(), [])).toBeNull();
    const columnsOfResult = columnsOf(soup(1, 1), []);
    assert.exists(columnsOfResult);
    expect([...columnsOfResult]).toStrictEqual([
      ['position', 3],
      ['normal', 3],
      ['uv', 2],
    ]);
  });
});
