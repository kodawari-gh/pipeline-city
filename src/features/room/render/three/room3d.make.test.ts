import { assert, expect, test, vi } from 'vitest';
import { BufferGeometry, Mesh } from 'three';
import type * as threeTypes from 'three';
import { inlinePool } from '@/core/render/three/aopool';
import type * as aopoolTypes from '@/core/render/three/aopool';
import { Room3D } from './room3d';

/** What the room asked `loadModel` for: the file, and the promise its model waits for. */
const asked = vi.hoisted(() => [] as { url: string; until?: Promise<unknown> | undefined }[]);
vi.mock(import('@/core/render/three/gltf'), async (orig) => ({
  ...(await orig()),
  loadModel: async (url: string, until?: Promise<unknown>) => {
    asked.push({ url, until });
    // (a model that never comes: the room builds without it)
    const never: PromiseWithResolvers<never> = Promise.withResolvers();
    return never.promise;
  },
}));

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Whether an object is a mesh. */
const isMesh = (o: unknown): o is Mesh => o instanceof Mesh;

/** A room's picture in numbers: its meshes and their vertices. */
const census = (room: Room3D): { meshes: number; vertices: number } => {
  let meshes = 0,
    vertices = 0;
  room.root.traverse((o) => {
    if (!isMesh(o)) {
      return;
    }
    meshes++;
    vertices += o.geometry.attributes['position']?.count ?? 0;
  });
  return { meshes, vertices };
};

/** A turn of the page: its task queue runs once. */
async function macroTurn(): Promise<void> {
  const turn: PromiseWithResolvers<void> = Promise.withResolvers();
  setTimeout(turn.resolve, 0);
  await turn.promise;
}

/** Calls `then` once `until` is over. */
async function whenOver(until: Promise<unknown>, then: () => void): Promise<void> {
  await until;
  then();
}

/** Calls `then` once the wait of each model asked for so far is over. */
function onOpen(list: readonly { until?: Promise<unknown> | undefined }[], then: () => void): void {
  for (const a of list) {
    if (a.until) {
      void whenOver(a.until, then);
    }
  }
}

/** Whether an object draws a geometry (a mesh, a line, points). */
const hasGeometry = (o: object): o is { geometry: threeTypes.BufferGeometry } =>
  'geometry' in o && o.geometry instanceof BufferGeometry;

/** The `_ao` attributes of every geometry under `root`. */
function aoOf(root: threeTypes.Object3D): (threeTypes.BufferAttribute | threeTypes.InterleavedBufferAttribute)[] {
  const found: (threeTypes.BufferAttribute | threeTypes.InterleavedBufferAttribute)[] = [];
  root.traverse((o) => {
    const a = hasGeometry(o) ? o.geometry.attributes['_ao'] : undefined;
    if (a !== undefined) {
      found.push(a);
    }
  });
  return found;
}

/** Whether every value is from 0 to 1. */
const inUnit = (values: Iterable<number>): boolean => [...values].every((v) => v >= 0 && v <= 1);

/** A slice with nothing to wait for: the build runs straight on. */
async function noTurn(): Promise<void> {
  await Promise.resolve();
}

// BOOT-01: the room holds the page for 1.2 s when built at once; `make` gives the page a turn between its slices
test('Room3D.make builds the same room a step at a time, and the late models join once it is built', async () => {
  const whole = new Room3D();
  await whole.ready; // (the bake's step and the palette merge, which `make`'s room takes too)
  asked.length = 0;
  const steps: [string, number][] = [],
    askedAt = new Map<string, typeof asked>();
  let slices = 0,
    open = false;
  const made = await Room3D.make(
    null,
    async (label, share) => {
      steps.push([label, share]);
      // (the mouse and the hoodie are asked for in the desk's step: they wait for the end of the build)
      await macroTurn();
      askedAt.set(label, [...asked]);
      onOpen(asked, () => {
        open = true;
      });
      await macroTurn();
      expect(open).toBe(false);
    },
    {
      slice: async () => {
        slices++;
        await Promise.resolve();
      },
    },
  );
  expect(steps.map(([label]) => label)).toStrictEqual(['Setting the desk', 'Shading the corners', 'Tidying the room']);
  const shading = must(askedAt.get('Shading the corners'));
  expect(shading.map((a) => must(a.url.split('/').pop())).toSorted((p, q) => p.localeCompare(q))).toStrictEqual([
    'hoodie.glb',
    'mouse.glb',
  ]);
  const [first] = shading;
  assert.exists(first);
  const { until } = first;
  assert.exists(until);
  expect(shading.every((a) => a.until === until)).toBe(true);
  const shares = steps.map(([, share]) => share);
  expect(shares).toStrictEqual([...shares].toSorted((a, b) => a - b));
  expect(Math.min(...shares)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...shares)).toBeLessThanOrEqual(1);
  // (a turn after the bench and after the bed, then one for each group of the occlusion)
  expect(slices).toBeGreaterThanOrEqual(4);
  await macroTurn();
  expect(open).toBe(true);
  await made.ready;
  // (the plants draw their leaves from a seed that runs on from one build to the next: a quad more or less. A section left out, or a merge not
  // made, is far more: 230 meshes in place of 147)
  const a = census(made),
    b = census(whole);
  expect(Math.abs(a.meshes - b.meshes)).toBeLessThanOrEqual(3);
  expect(Math.abs(a.vertices - b.vertices) / b.vertices).toBeLessThan(0.01);
}, 180_000);

// BOOT-05: the baked occlusion is the room's longest step (0.8 s on the page's thread); `make` casts it on a pool of workers when it has one
test('Room3D.make casts the baked occlusion on the pool it is given, the largest group first, and stops the pool', async () => {
  const inner = inlinePool(),
    casts: number[] = [],
    labels: string[] = [];
  let stopped = 0;
  const pool: aopoolTypes.AoPool = {
    run: async (job) => {
      casts.push(job.cast);
      return inner.run(job);
    },
    dispose: () => {
      stopped++;
    },
  };
  const made = await Room3D.make(
    null,
    async (label) => {
      labels.push(label);
      await Promise.resolve();
    },
    { slice: noTurn, pool },
  );
  expect(labels).toStrictEqual(['Setting the desk', 'Shading the corners', 'Tidying the room']);
  expect(casts.length).toBeGreaterThanOrEqual(5);
  expect(casts).toStrictEqual([...casts].toSorted((x, y) => y - x));
  expect(stopped).toBe(1);
  // (the meshes the groups hold carry their open shares, from 0 to 1, through the merge)
  const baked = aoOf(made.root);
  for (const a of baked) {
    expect(inUnit(a.array)).toBe(true);
  }
  expect(baked.length).toBeGreaterThan(10);
}, 180_000);

test('Room3D.make stops its pool when the build throws', async () => {
  let stopped = 0;
  const pool: aopoolTypes.AoPool = {
    run: async () => {
      await Promise.resolve();
      throw new Error('no');
    },
    dispose: () => {
      stopped++;
    },
  };
  await expect(
    Room3D.make(
      null,
      async () => {
        await Promise.resolve();
        throw new Error('the page went away');
      },
      { slice: noTurn, pool },
    ),
  ).rejects.toThrow('the page went away');
  expect(stopped).toBe(1);
}, 180_000);
