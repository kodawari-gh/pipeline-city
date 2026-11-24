import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, type BufferAttribute } from 'three';
import { inlinePool, type AoPool } from './aopool';
import { vertexAo, vertexAoPooled, vertexAoSteps } from './vertexao';

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
  keys.userData.ao = 200;
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
  group.userData.ao = 200;
  group.add(more);
  s.root.add(group);
  return { ...s, more };
}

/** The scene's cast, and the open shares each baked mesh holds, in the scene's order. */
const shares = (root: Group): number[][] => {
  const out: number[][] = [];
  root.traverse((o) => {
    const a = (o as Mesh).geometry?.attributes._ao as BufferAttribute | undefined;
    if (a) out.push(Array.from(a.array));
  });
  return out;
};

/** The open share on the front of the cap's point at (x, y, z) whose normal is `n` (BoxGeometry keeps each face's corners apart). */
function aoAt(m: Mesh, x: number, y: number, z: number, n: [number, number, number]): number {
  const p = m.geometry.attributes.position!,
    nr = m.geometry.attributes.normal!,
    ao = m.geometry.attributes._ao as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (
      Math.hypot(p.getX(i) - x, p.getY(i) - y, p.getZ(i) - z) < 1 &&
      nr.getX(i) === n[0] &&
      nr.getY(i) === n[1] &&
      nr.getZ(i) === n[2]
    )
      return ao.getX(i);
  }
  throw new Error('no such point');
}

describe('vertexAo', () => {
  it('darkens a side where it meets the plate, not its top', () => {
    const { root, cap } = scene();
    expect(vertexAo(root)).toBe(24);
    const foot = aoAt(cap, 50, -50, 50, [1, 0, 0]),
      top = aoAt(cap, 50, 50, 50, [0, 1, 0]),
      head = aoAt(cap, 50, 50, 50, [1, 0, 0]);
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

describe('vertexAoSteps', () => {
  it('yields once for each group, patches the materials at the end, and casts what vertexAo casts', () => {
    const whole = two(),
      steps = two();
    const cast = vertexAo(whole.root),
      run = vertexAoSteps(steps.root);
    let yields = 0,
      step = run.next();
    while (!step.done) {
      yields++;
      // (nothing patched while groups remain: the page may draw between the steps)
      expect(steps.capM.customProgramCacheKey()).not.toContain('|ao');
      step = run.next();
    }
    expect(yields).toBe(2);
    expect(step.value).toBe(cast);
    expect(steps.capM.customProgramCacheKey()).toContain('|ao');
    expect(Array.from((steps.cap.geometry.attributes._ao as BufferAttribute).array)).toEqual(
      Array.from((whole.cap.geometry.attributes._ao as BufferAttribute).array),
    );
  });

  it('ends at once for a root with no group that asks', () => {
    const run = vertexAoSteps(new Group()),
      step = run.next();
    expect(step.done).toBe(true);
    expect(step.value).toBe(0);
  });
});

describe('vertexAoPooled', () => {
  const noSlice = async (): Promise<void> => undefined;
  /** The two groups and a third, the largest (a cap cut into squares: 96 points where a cap has 24), the first in the tree. */
  const three = () => {
    const s = two(),
      big = new Mesh(new BoxGeometry(100, 100, 100, 3, 3, 3), new MeshStandardMaterial()),
      group = new Group();
    big.position.set(300, 50, 0);
    group.userData.ao = 200;
    group.add(big);
    s.root.add(group);
    return { ...s, big };
  };
  /** A pool that keeps the jobs it is asked and answers them all, last asked first, when the test says. */
  const reversed = (): { pool: AoPool; asked: number[]; release: () => void } => {
    const inner = inlinePool(),
      held: (() => void)[] = [],
      asked: number[] = [];
    return {
      asked,
      release: () => {
        for (const go of held.reverse()) go();
      },
      pool: {
        run: (j) => {
          asked.push(j.cast);
          return new Promise((done) => {
            held.push(() => void inner.run(j).then(done));
          });
        },
        dispose: () => undefined,
      },
    };
  };

  it('casts what vertexAoSteps casts, to the bit, and patches the materials', async () => {
    const whole = three(),
      pooled = three();
    const cast = vertexAo(whole.root),
      slices: number[] = [];
    expect(
      await vertexAoPooled(pooled.root, inlinePool(), async () => {
        slices.push(slices.length);
      }),
    ).toBe(cast);
    expect(cast).toBe(24 + 24 + 96);
    expect(shares(pooled.root)).toEqual(shares(whole.root));
    expect(pooled.capM.customProgramCacheKey()).toContain('|ao');
    expect(Array.from((pooled.other.geometry.attributes._ao as BufferAttribute).array).every((v) => v === 1)).toBe(
      true,
    );
    // (the page gets a turn after each group)
    expect(slices).toHaveLength(3);
  });

  it('asks for the largest group first, and puts the answers on the groups in their order whatever order they come in', async () => {
    const whole = three(),
      pooled = three(),
      held = reversed();
    const done = vertexAoPooled(pooled.root, held.pool, noSlice);
    // (the arrays of each group are made one turn at a time; the jobs are all asked before the first answer)
    await new Promise((r) => setTimeout(r, 20));
    expect(held.asked).toEqual([96, 24, 24]);
    held.release();
    await done;
    vertexAo(whole.root);
    expect(shares(pooled.root)).toEqual(shares(whole.root));
  });

  it('casts here what the pool cannot', async () => {
    const whole = three(),
      pooled = three();
    const fail: AoPool = { run: () => Promise.reject(new Error('the worker died')), dispose: () => undefined };
    expect(await vertexAoPooled(pooled.root, fail, noSlice)).toBe(vertexAo(whole.root));
    expect(shares(pooled.root)).toEqual(shares(whole.root));
  });

  it('ends at once for a root with no group that asks, asking the pool for nothing', async () => {
    const held = reversed();
    expect(await vertexAoPooled(new Group(), held.pool, noSlice)).toBe(0);
    expect(held.asked).toEqual([]);
  });
});
