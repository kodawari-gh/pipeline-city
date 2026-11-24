import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Frustum,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  type Material,
  type Object3D,
  type Sphere,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ballOf, bearing, columnsOf, Sweep, sweptMerge, sweptMergeReference } from './sweep';
import { GRID } from './plan';
import { LOW_CELL } from './detail';

/** Three unit boxes of 3 vertices each, at x = -100, 0 and 100, 50 m north of the window. */
function row(): { mesh: Mesh; sweep: Sweep } {
  const xs = [-100, 0, 100],
    pos: number[] = [];
  for (const x of xs) pos.push(x, 0, -50, x + 1, 0, -50, x, 1, -50);
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
    expect(root.children.map((o) => (o as Mesh).material)).toEqual([stone, paint]);
    const merged = root.children[1] as Mesh,
      pos = merged.geometry.attributes['position']!;
    expect(pos.count).toBe(3 * 36);
    // west to east: the pieces at -100, 0 and +100 m
    expect([0, 36, 72].map((v) => Math.round((pos.getX(v) - GRID.av0) / 100) + 0)).toEqual([-1, 0, 1]);
    sw!.cut();
    expect(merged.geometry.drawRange).toMatchObject({ start: 0, count: 108 });
  });

  describe('cell size', () => {
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
    const cells = (s: Sweep): number => (s as unknown as { balls: unknown[] }).balls.length;
    const total = (root: Group): number => (root.children[0] as Mesh).geometry.attributes['position']!.count;
    /** `sweptMerge` as the Low cut will call it (the third parameter does not exist yet). */
    const merge = sweptMerge as (root: Group, mats: MeshBasicMaterial[], cell?: number) => Sweep[];

    it('lock: the default cell is 24 m', () => {
      const a = line(),
        b = line();
      const [d] = sweptMerge(a.root, [a.mat]),
        [e] = merge(b.root, [b.mat], 24);
      expect(cells(e!)).toBe(cells(d!));
      expect(total(b.root)).toBe(total(a.root));
    });

    it('Low: a 96 m cell makes fewer cells and draws the same', () => {
      const a = line(),
        b = line();
      const [d] = sweptMerge(a.root, [a.mat]),
        [e] = merge(b.root, [b.mat], LOW_CELL);
      expect(cells(e!)).toBeLessThan(cells(d!));
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

describe('sweptMerge against the plain way', () => {
  const peek = (s: Sweep): { balls: Sphere[]; runs: { at: number[] }[] } =>
    s as unknown as { balls: Sphere[]; runs: { at: number[] }[] };

  /** A two-number `_ao` a vertex, from the vertex number. */
  const withAo = (g: BufferGeometry): BufferGeometry => {
    const n = g.attributes['position']!.count,
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
    for (let i = 0; i < p.length; i++) p[i] = Math.sin(seed + i * 1.7) * 3;
    return new BufferGeometry().setAttribute('position', new BufferAttribute(p, 3));
  };
  /** A bent quad as two indexed triangles, with a uv and no normal. */
  const quad = (): BufferGeometry =>
    new BufferGeometry()
      .setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 2, 1]), 3))
      .setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2))
      .setIndex([0, 1, 2, 0, 2, 3]);

  /** A street: boxes in a few cells, loose triangles with and without a normal or a uv, a skewed group, and a mesh of another material. */
  function street(ao: boolean): { root: Group; mats: Material[]; paint: Material } {
    const root = new Group(),
      paint = new MeshBasicMaterial({ name: 'paint' }),
      stone = new MeshBasicMaterial({ name: 'stone' }),
      lone = new MeshBasicMaterial({ name: 'lone' });
    root.position.set(3, -2, 5);
    root.rotation.set(0.1, 0.4, -0.2);
    const put = (g: BufferGeometry, x: number, z: number, parent: Object3D = root): Mesh => {
      const m = new Mesh(ao ? withAo(g) : g, paint);
      m.position.set(x, 1, z);
      m.rotation.y = x * 0.01;
      m.castShadow = x === -110;
      m.receiveShadow = x > 0;
      parent.add(m);
      return m;
    };
    for (const x of [-110, -70, -30, -25, 10, 15, 50, 90]) put(new BoxGeometry(1 + (x % 3), 1, 2), x, -50 - x * 0.3);
    put(soup(4, 1), 30, -80);
    put(quad(), -60, -20);
    put(
      soup(2, 5).setAttribute(
        'normal',
        new BufferAttribute(
          Float32Array.from({ length: 18 }, (_, i) => Math.cos(i) + 2),
          3,
        ),
      ),
      70,
      -40,
    );
    const skew = new Group();
    skew.scale.set(1, 2, 0.5);
    skew.rotation.set(0.5, 0.2, 0);
    skew.position.set(20, 0, -60);
    root.add(skew);
    put(new BoxGeometry(2, 2, 2), 3, 4, skew);
    root.add(new Mesh(new BoxGeometry(1, 1, 1), stone), new Mesh(new BoxGeometry(1, 1, 1), lone));
    return { root, mats: [paint, lone], paint };
  }

  /** What a merge leaves: the root's children with their arrays, and the sweeps' balls and runs. */
  function shape(root: Group, sweeps: Sweep[]): unknown {
    return {
      kids: root.children.map((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return { group: o.children.length };
        const g = m.geometry;
        return {
          mat: (m.material as Material).name,
          cast: m.castShadow,
          recv: m.receiveShadow,
          groups: g.groups,
          indexed: g.index !== null,
          attrs: Object.entries(g.attributes).map(([k, a]) => [k, a.itemSize, a.array]),
        };
      }),
      runs: sweeps.map((s) => peek(s).runs.map((r) => r.at)),
      balls: sweeps.map((s) => peek(s).balls.map((b) => [...b.center.toArray(), b.radius])),
    };
  }

  it.each<[number, boolean]>([
    [24, true],
    [96, true],
    [24, false],
  ])('makes the same mesh, order and cuts: cell %d m, `_ao` kept %s', (cell, ao) => {
    const a = street(true),
      b = street(true),
      keep = ao ? ['_ao'] : [];
    const fast = shape(a.root, sweptMerge(a.root, a.mats, cell, keep)),
      plain = shape(b.root, sweptMergeReference(b.root, b.mats, cell, keep));
    expect(fast).toEqual(plain);
    // it merged: the paint is one mesh now, with a run for each cell
    const merged = a.root.children.filter(
      (o) => (o as Mesh).isMesh && ((o as Mesh).material as Material).name === 'paint',
    );
    expect(merged).toHaveLength(1);
    expect(Object.keys((merged[0] as Mesh).geometry.attributes)).toEqual(
      ao ? ['position', 'normal', 'uv', '_ao'] : ['position', 'normal', 'uv'],
    );
  });

  it('takes the meshes of the street the quick way, not the plain one', () => {
    const { root, paint } = street(true);
    const meshes: Mesh[] = [];
    root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.material === paint) meshes.push(m);
    });
    expect(meshes).toHaveLength(12);
    for (const m of meshes) expect(columnsOf(m.geometry, ['_ao'])).not.toBeNull();
  });

  it('makes the same flat normals and zero uvs for a mesh that has none', () => {
    const a = street(false),
      b = street(false);
    sweptMerge(a.root, a.mats);
    sweptMergeReference(b.root, b.mats);
    const first = (r: Group): BufferGeometry => (r.children[r.children.length - 1] as Mesh).geometry;
    const nrm = first(a.root).attributes['normal']!.array as Float32Array;
    expect(nrm).toEqual(first(b.root).attributes['normal']!.array);
    expect(nrm.every((v) => Number.isFinite(v))).toBe(true);
    expect(first(a.root).attributes['uv']!.array).toEqual(first(b.root).attributes['uv']!.array);
  });

  it('leaves the meshes alone when their attributes differ (as the plain way does), and says why', () => {
    const err = vi.spyOn(console, 'error').mockReturnValue(undefined);
    try {
      const a = street(true),
        b = street(true);
      // one mesh with no `_ao`
      const drop = (r: Group): void => {
        const m = r.children[0] as Mesh;
        m.geometry.deleteAttribute('_ao');
      };
      drop(a.root);
      drop(b.root);
      const fast = shape(a.root, sweptMerge(a.root, a.mats, 24, ['_ao'])),
        plain = shape(b.root, sweptMergeReference(b.root, b.mats, 24, ['_ao']));
      expect(fast).toEqual(plain);
      expect(
        a.root.children.filter((o) => (o as Mesh).isMesh && ((o as Mesh).material as Material).name === 'paint').length,
      ).toBeGreaterThan(1);
    } finally {
      err.mockRestore();
    }
  });

  it('sends what it cannot read as plain floats (interleaved, morphed, normalised, not a 3-vector) to the plain way', () => {
    const buffer = new InterleavedBuffer(new Float32Array(9), 3);
    expect(
      columnsOf(new BufferGeometry().setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0)), []),
    ).toBeNull();
    const morphed = soup(1, 1);
    morphed.morphAttributes.position = [new BufferAttribute(new Float32Array(9), 3)];
    expect(columnsOf(morphed, [])).toBeNull();
    expect(
      columnsOf(new BufferGeometry().setAttribute('position', new BufferAttribute(new Uint16Array(9), 3, true)), []),
    ).toBeNull();
    expect(
      columnsOf(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(6), 2)), []),
    ).toBeNull();
    expect(columnsOf(new BufferGeometry(), [])).toBeNull();
    expect([...columnsOf(soup(1, 1), [])!]).toEqual([
      ['position', 3],
      ['normal', 3],
      ['uv', 2],
    ]);
  });
});
