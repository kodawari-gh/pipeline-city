import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import type * as threeTypes from 'three';
import { inlinePool } from './aopool';
import type * as aopoolTypes from './aopool';
import { vertexAo, vertexAoPooled, vertexAoSteps } from './vertexao';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A plate 1000 wide with a cap 100 wide on it (the cap's group asks for the occlusion), a second cap elsewhere in the cap's material. */
function scene() {
  const root = new Group(),
    capM = new MeshStandardMaterial(),
    keys = new Group();
  const plate = new Mesh(new BoxGeometry(1000, 20, 1000), new MeshStandardMaterial());
  plate.position.y = -10;
  const cap = new Mesh(new BoxGeometry(100, 100, 100), capM),
    other = new Mesh(new BoxGeometry(100, 100, 100), capM);
  cap.position.y = 50;
  other.position.set(5000, 50, 0);
  keys.userData['ao'] = 200;
  keys.add(cap);
  root.add(plate, keys, other);
  return { root, cap, other, capM, plate };
}

/** The scene with a second group (a cap of its own material, further along the plate). */
function two() {
  const s = scene(),
    more = new Mesh(new BoxGeometry(100, 100, 100), new MeshStandardMaterial()),
    group = new Group();
  more.position.set(-300, 50, 0);
  group.userData['ao'] = 200;
  group.add(more);
  s.root.add(group);
  return { ...s, more };
}

const isMesh = (o: threeTypes.Object3D): o is Mesh => o instanceof Mesh;
/** The open shares a mesh holds, if it was baked. */
const meshAo = (m: Mesh) => m.geometry.attributes['_ao'];
/** The scene's cast, and the open shares each baked mesh holds, in the scene's order. */
const shares = (root: Group): number[][] => {
  const out: number[][] = [];
  root.traverse((o) => {
    const a = isMesh(o) ? meshAo(o) : undefined;
    if (a) {
      out.push([...a.array]);
    }
  });
  return out;
};

/** The open share on the front of the cap's point at (x, y, z) whose normal is `n` (BoxGeometry keeps each face's corners apart). */
function aoAt(m: Mesh, [x, y, z]: [number, number, number], n: [number, number, number]): number {
  const p = must(m.geometry.attributes['position']),
    nr = must(m.geometry.attributes['normal']),
    ao = must(m.geometry.attributes['_ao']);
  for (let i = 0; i < p.count; i++) {
    if (
      Math.hypot(p.getX(i) - x, p.getY(i) - y, p.getZ(i) - z) < 1 &&
      nr.getX(i) === n[0] &&
      nr.getY(i) === n[1] &&
      nr.getZ(i) === n[2]
    ) {
      return ao.getX(i);
    }
  }
  throw new Error('no such point');
}

describe('vertexAo', () => {
  it('darkens a side where it meets the plate, not its top', () => {
    const { root, cap } = scene();
    expect(vertexAo(root)).toBe(24);
    const foot = aoAt(cap, [50, -50, 50], [1, 0, 0]),
      top = aoAt(cap, [50, 50, 50], [0, 1, 0]),
      head = aoAt(cap, [50, 50, 50], [1, 0, 0]);
    expect(top).toBeCloseTo(1, 5);
    expect(foot).toBeLessThan(0.75);
    expect(head).toBeGreaterThan(foot);
  });

  it('patches the material and leaves its other meshes open', () => {
    const { root, other, capM, plate } = scene();
    vertexAo(root);
    expect(capM.customProgramCacheKey()).toContain('|ao');
    expect([...must(other.geometry.attributes['_ao']).array].every((v) => v === 1)).toBe(true);
    expect(plate.geometry.attributes['_ao']).toBeUndefined();
  });

  it('leaves a glow alone', () => {
    const { root, cap } = scene();
    cap.material.emissive = new Color(0xff_ff_ff);
    expect(vertexAo(root)).toBe(0);
    expect(cap.geometry.attributes['_ao']).toBeUndefined();
  });
});

describe('vertexAoSteps', () => {
  it('yields once for each group, patches the materials at the end, and casts what vertexAo casts', () => {
    const whole = two(),
      steps = two();
    const cast = vertexAo(whole.root),
      run = vertexAoSteps(steps.root);
    let yields = 0,
      step = run.next();
    while (step.done !== true) {
      yields++;
      // (nothing patched while groups remain: the page may draw between the steps)
      expect(steps.capM.customProgramCacheKey()).not.toContain('|ao');
      step = run.next();
    }
    expect(yields).toBe(2);
    expect(step.value).toBe(cast);
    expect(steps.capM.customProgramCacheKey()).toContain('|ao');
    expect([...must(steps.cap.geometry.attributes['_ao']).array]).toStrictEqual([
      ...must(whole.cap.geometry.attributes['_ao']).array,
    ]);
  });

  it('ends at once for a root with no group that asks', () => {
    const run = vertexAoSteps(new Group()),
      step = run.next();
    expect(step.done).toBe(true);
    expect(step.value).toBe(0);
  });
});

/** A page's turn between the slices of the work, over at once. */
const noSlice = async (): Promise<void> => {
  await Promise.resolve();
};
/** The two groups and a third, the largest (a cap cut into squares: 96 points where a cap has 24), the first in the tree. */
const three = () => {
  const s = two(),
    big = new Mesh(new BoxGeometry(100, 100, 100, 3, 3, 3), new MeshStandardMaterial()),
    group = new Group();
  big.position.set(300, 50, 0);
  group.userData['ao'] = 200;
  group.add(big);
  s.root.add(group);
  return { ...s, big };
};
/** A pool that keeps the jobs it is asked and answers them all, last asked first, when the test says. */
const reversed = (): { pool: aopoolTypes.AoPool; asked: number[]; release: () => void } => {
  const inner = inlinePool(),
    held: (() => Promise<void>)[] = [],
    asked: number[] = [];
  return {
    asked,
    release: () => {
      for (const go of held.toReversed()) {
        void go();
      }
    },
    pool: {
      run: async (j) => {
        asked.push(j.cast);
        const { promise, resolve } = Promise.withResolvers<Float32Array>();
        held.push(async () => {
          resolve(await inner.run(j));
        });
        const cast = await promise;
        return cast;
      },
      dispose: vi.fn<() => void>(),
    },
  };
};

describe('vertexAoPooled', () => {
  it('casts what vertexAoSteps casts, to the bit, and patches the materials', async () => {
    const whole = three(),
      pooled = three();
    const cast = vertexAo(whole.root),
      slices: number[] = [];
    await expect(
      vertexAoPooled(pooled.root, inlinePool(), async () => {
        slices.push(slices.length);
        await Promise.resolve();
      }),
    ).resolves.toBe(cast);
    expect(cast).toBe(24 + 24 + 96);
    expect(shares(pooled.root)).toStrictEqual(shares(whole.root));
    expect(pooled.capM.customProgramCacheKey()).toContain('|ao');
    expect([...must(pooled.other.geometry.attributes['_ao']).array].every((v) => v === 1)).toBe(true);
    // (the page gets a turn after each group)
    expect(slices).toHaveLength(3);
  });

  it('asks for the largest group first, and puts the answers on the groups in their order whatever order they come in', async () => {
    const whole = three(),
      pooled = three(),
      held = reversed();
    const done = vertexAoPooled(pooled.root, held.pool, noSlice);
    // (the arrays of each group are made one turn at a time; the jobs are all asked before the first answer)
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(held.asked).toStrictEqual([96, 24, 24]);
    held.release();
    await done;
    vertexAo(whole.root);
    expect(shares(pooled.root)).toStrictEqual(shares(whole.root));
  });

  it('casts here what the pool cannot', async () => {
    const whole = three(),
      pooled = three();
    const fail: aopoolTypes.AoPool = {
      run: vi.fn<aopoolTypes.AoPool['run']>().mockRejectedValue(new Error('the worker died')),
      dispose: vi.fn<() => void>(),
    };
    await expect(vertexAoPooled(pooled.root, fail, noSlice)).resolves.toBe(vertexAo(whole.root));
    expect(shares(pooled.root)).toStrictEqual(shares(whole.root));
  });

  it('ends at once for a root with no group that asks, asking the pool for nothing', async () => {
    const held = reversed();
    await expect(vertexAoPooled(new Group(), held.pool, noSlice)).resolves.toBe(0);
    expect(held.asked).toStrictEqual([]);
  });
});
