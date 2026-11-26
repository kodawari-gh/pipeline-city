// Baked occlusion on still hard things (`src/features/room/light.md`, T178): the room's props and plants carry `_ao` as the hoodie does
// (`bakedao.ts`, `docs/render/cloth.md`), cast once when the room is built, never in a frame. A group asks for it by `userData.ao` (set by its
// builder): how far its rays reach, in world units. Its meshes and every still opaque mesh near them (the desk under the keyboard, the wall
// behind the clock) block the rays, so the keys' gaps, the lamp's joints and a plant's inner leaves darken. A glow, a screen and a see-through
// mesh take none.
import { Box3, Float32BufferAttribute, FrontSide } from 'three';
import type * as threeTypes from 'three';
import { runAoJob } from './aojob';
import type * as aojobTypes from './aojob';
import type { AoPool } from './aopool';
import { bakedAo } from './bakedao';
import { blocks, soup, takes, weldIds, worldBox } from './soup';
import type * as soupTypes from './soup';

/**
 * Cast the occlusion of each group under `root` that asks for it (`userData.ao`) and patch its materials (`bakedAo`). Every other mesh with a
 * patched material gets `_ao` fully open. Call it once the root is built, before `mergeStatic` (which keeps `_ao`). Returns the points cast.
 */
export function vertexAo(root: threeTypes.Object3D): number {
  const run = vertexAoSteps(root);
  let step = run.next();
  while (!step.done) {
    step = run.next();
  }
  return step.value;
}

/** One group's cast: the meshes that take its occlusion, and the job that casts it (`aojob.ts`). */
interface Cast {
  targets: threeTypes.Mesh[];
  job: aojobTypes.AoJob;
}

/** What the casts and their answers share: the groups that ask, the meshes that block their rays, and what the answers have patched so far. */
interface Ao {
  root: threeTypes.Object3D;
  groups: threeTypes.Object3D[];
  blockers: { m: threeTypes.Mesh; box: Box3 }[];
  soupOf: (m: threeTypes.Mesh) => soupTypes.Soup;
  patched: Set<threeTypes.Material>;
  owned: Set<threeTypes.BufferGeometry>;
  cast: number;
}

/** The groups under `root` that ask for the occlusion, and the meshes that block their rays. Null: no group asks. */
function startAo(root: threeTypes.Object3D): Ao | null {
  root.updateMatrixWorld(true);
  const groups: threeTypes.Object3D[] = [];
  const find = (o: threeTypes.Object3D): void => {
    if (typeof o.userData['ao'] === 'number') {
      groups.push(o);
    } else {
      for (const c of o.children) {
        find(c);
      }
    }
  };
  find(root);
  if (groups.length === 0) {
    return null;
  }
  const blockers: { m: threeTypes.Mesh; box: Box3 }[] = [];
  root.traverse((o) => {
    if (blocks(o)) {
      blockers.push({ m: o, box: worldBox(o) });
    }
  });
  const soups = new Map<threeTypes.Mesh, soupTypes.Soup>();
  // (the wall and the desk block for many groups)
  const soupOf = (m: threeTypes.Mesh): soupTypes.Soup => {
    let s = soups.get(m);
    if (!s) {
      soups.set(m, (s = soup(m)));
    }
    return s;
  };
  return { root, groups, blockers, soupOf, patched: new Set(), owned: new Set(), cast: 0 };
}

/** The groups' casts, one for each group with a mesh to take it, each made when asked for (its arrays take 1 to 10 ms). */
function* casts({ groups, blockers, soupOf }: Ao): Generator<Cast> {
  for (const grp of groups) {
    const c = castOf(grp, blockers, soupOf);
    if (c) {
      yield c;
    }
  }
}

function packSoups(parts: soupTypes.Soup[]): {
  pos: Float32Array;
  nrm: Float32Array;
  tris: Uint32Array;
  keys: Int32Array;
} {
  const points = parts.reduce((s, q) => s + q.pos.length / 3, 0),
    count = parts.reduce((s, q) => s + q.tris.length, 0);
  const pos = new Float32Array(3 * points),
    nrm = new Float32Array(3 * points),
    tris = new Uint32Array(count),
    keys = new Int32Array(6 * points);
  let at = 0,
    ti = 0;
  for (const q of parts) {
    pos.set(q.pos, 3 * at);
    nrm.set(q.nrm, 3 * at);
    keys.set(q.keys, 6 * at);
    for (let t = 0; t < q.tris.length; t++) {
      tris[ti++] = q.tris[t]! + at;
    }
    at += q.pos.length / 3;
  }
  return { pos, nrm, tris, keys };
}

function castOf(
  grp: threeTypes.Object3D,
  blockers: { m: threeTypes.Mesh; box: Box3 }[],
  soupOf: (m: threeTypes.Mesh) => soupTypes.Soup,
): Cast | null {
  const reach = grp.userData['ao'] as number,
    targets: threeTypes.Mesh[] = [];
  grp.traverse((o) => {
    if (takes(o)) {
      targets.push(o);
    }
  });
  if (targets.length === 0) {
    return null;
  }
  const roi = new Box3();
  for (const t of targets) {
    roi.union(worldBox(t));
  }
  roi.expandByScalar(reach);
  const mine = new Set(targets),
    parts = [...targets, ...blockers.filter((b) => !mine.has(b.m) && b.box.intersectsBox(roi)).map((b) => b.m)].map(
      soupOf,
    );
  const { pos, nrm, tris, keys } = packSoups(parts);
  // points on one another with one normal are one point (a smooth mesh's seam); a hard edge's points stay apart, each with its face's side
  const weld = weldIds(keys);
  // a one-sided material shows only its normal's side: the other is not cast
  const n = targets.reduce((s, t) => s + t.geometry.attributes['position']!.count, 0),
    one = new Uint8Array(n);
  let at = 0;
  for (const t of targets) {
    const k = t.geometry.attributes['position']!.count;
    if ((t.material as threeTypes.Material).side === FrontSide) {
      one.fill(1, at, at + k);
    }
    at += k;
  }
  return { targets, job: { pos, nrm, tris, weld, one, reach, cast: n } };
}

/** Puts a cast's open shares on its meshes. */
function apply(a: Ao, { targets, job }: Cast, ao: Float32Array): void {
  let at = 0;
  for (const t of targets) {
    const k = t.geometry.attributes['position']!.count;
    // a geometry another baked mesh already holds gets a copy of its own
    if (a.owned.has(t.geometry)) {
      t.geometry = t.geometry.clone();
    }
    a.owned.add(t.geometry);
    t.geometry.setAttribute('_ao', new Float32BufferAttribute(ao.slice(2 * at, 2 * (at + k)), 2));
    a.patched.add(t.material as threeTypes.Material);
    at += k;
  }
  a.cast += job.cast;
}

/** Patches the materials the answers reached and opens the other meshes that use them. Returns the points cast. */
function finish({ root, patched, cast }: Ao): number {
  for (const m of patched) {
    bakedAo(m);
  }
  root.traverse((o) => {
    const m = o as threeTypes.Mesh;
    if (
      !m.isMesh ||
      m.geometry.attributes['_ao'] ||
      !(Array.isArray(m.material) ? m.material : [m.material]).some((x) => patched.has(x))
    ) {
      return;
    }
    m.geometry.setAttribute(
      '_ao',
      new Float32BufferAttribute(new Float32Array(2 * m.geometry.attributes['position']!.count).fill(1), 2),
    );
  });
  return cast;
}

/**
 * `vertexAo` a group at a time: it yields after each group (the largest take 0.2 to 0.3 s), so a caller can paint between them (`Room3D.make`).
 * The last step patches the materials. Its return value is the points cast.
 */
export function* vertexAoSteps(root: threeTypes.Object3D): Generator<void, number> {
  const a = startAo(root);
  if (!a) {
    return 0;
  }
  for (const c of casts(a)) {
    apply(a, c, runAoJob(c.job));
    yield;
  }
  return finish(a);
}

/**
 * `vertexAoSteps` with the casts on a pool of workers (`aopool.ts`): this thread makes the arrays of each group, the largest group first (a few
 * ms each; `slice` after each gives the page a turn), and a worker casts them as soon as they are made. The answers go on the meshes in the
 * groups' order, so the result is `vertexAoSteps`' to the last bit. A cast a worker cannot make is made here. Returns the points cast.
 */
export async function vertexAoPooled(
  root: threeTypes.Object3D,
  pool: AoPool,
  slice: () => Promise<void>,
): Promise<number> {
  const a = startAo(root);
  if (!a) {
    return 0;
  }
  const size = (g: threeTypes.Object3D): number => {
    let n = 0;
    g.traverse((o) => {
      if (takes(o)) {
        n += o.geometry.attributes['position']!.count;
      }
    });
    return n;
  };
  const largest = a.groups.map((g, at) => ({ g, at, n: size(g) })).sort((p, q) => q.n - p.n);
  const asked: { c: Cast; ao: Promise<Float32Array> }[] = [];
  for (const { g, at } of largest) {
    for (const c of casts({ ...a, groups: [g] })) {
      asked[at] = { c, ao: pool.run(c.job).catch(() => runAoJob(c.job)) };
    }
    await slice();
  }
  const pending = asked.filter((x): x is { c: Cast; ao: Promise<Float32Array> } => Boolean(x));
  const promises: Promise<Float32Array>[] = [];
  for (const x of pending) {
    promises.push(x.ao);
  }
  const aos = await Promise.all(promises);
  for (let i = 0; i < pending.length; i++) {
    const x = pending[i],
      ao = aos[i];
    if (x && ao) {
      apply(a, x.c, ao);
    }
  }
  return finish(a);
}
