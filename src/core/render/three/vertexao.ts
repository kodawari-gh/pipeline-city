// Baked occlusion on still hard things (`src/features/room/light.md`, T178): the room's props and plants carry `_ao` as the hoodie does
// (`bakedao.ts`, `docs/render/cloth.md`), cast once when the room is built, never in a frame. A group asks for it by `userData.ao` (set by its
// builder): how far its rays reach, in world units. Its meshes and every still opaque mesh near them (the desk under the keyboard, the wall
// behind the clock) block the rays, so the keys' gaps, the lamp's joints and a plant's inner leaves darken. A glow, a screen and a see-through
// mesh take none.
import { Box3, Float32BufferAttribute, FrontSide, Matrix3, Vector3, type BufferGeometry, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { runAoJob, type AoJob } from './aojob';
import type { AoPool } from './aopool';
import { bakedAo } from './bakedao';

/** Is it drawn? Its own flag and all those above it. */
const shown = (o: Object3D): boolean => { for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };

/** A plain shown mesh (not instanced, not skinned). */
function plain(o: Object3D): o is Mesh {
  const m = o as Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
  return !!m.isMesh && !m.isInstancedMesh && !m.isSkinnedMesh && shown(o);
}

/** Can it take the occlusion: one opaque lit material that does not glow. */
function takes(o: Object3D): o is Mesh {
  if (!plain(o) || Array.isArray(o.material)) return false;
  const s = o.material as MeshStandardMaterial;
  return !!s.isMeshStandardMaterial && !s.transparent && !s.emissiveMap && s.emissive.getHex() === 0;
}

/** Does it block the rays: opaque. */
const blocks = (o: Object3D): o is Mesh => plain(o) && (Array.isArray(o.material) ? o.material : [o.material]).every((m) => !m.transparent);

/** A mesh's points and normals in world space, what each is welded by (`weldIds`), and its triangles. */
interface Soup { pos: Float32Array; nrm: Float32Array; keys: Int32Array; tris: Uint32Array }

function soup(m: Mesh): Soup {
  const g = m.geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position!, n = g.attributes.normal!, k = p.count, nm = new Matrix3().getNormalMatrix(m.matrixWorld), v = new Vector3();
  const pos = new Float32Array(3 * k), nrm = new Float32Array(3 * k), keys = new Int32Array(6 * k), tris = g.index ? new Uint32Array(g.index.array) : new Uint32Array(k);
  for (let i = 0; i < k; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); pos[3 * i] = v.x; pos[3 * i + 1] = v.y; pos[3 * i + 2] = v.z;
    v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nrm[3 * i] = v.x; nrm[3 * i + 1] = v.y; nrm[3 * i + 2] = v.z;
    for (let e = 0; e < 3; e++) { keys[6 * i + e] = Math.round(pos[3 * i + e]!); keys[6 * i + 3 + e] = Math.round(nrm[3 * i + e]! * 20); }
    if (!g.index) tris[i] = i;
  }
  return { pos, nrm, keys, tris };
}

/** Each point's first point with the same six `keys` (a hash table in one array: strings for the room's points took a fifth of this file's time). */
function weldIds(keys: Int32Array): Int32Array {
  const n = keys.length / 6, mask = 2 ** Math.ceil(Math.log2(2 * n + 1)) - 1, table = new Int32Array(mask + 1).fill(-1), out = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const a = 6 * i;
    let h = 0;
    for (let e = 0; e < 6; e++) h = Math.imul(h ^ keys[a + e]!, 0x9e3779b1);
    for (h = (h ^ (h >>> 15)) & mask; ; h = (h + 1) & mask) {
      const j = table[h]!;
      if (j < 0) { table[h] = out[i] = i; break; }
      const b = 6 * j;
      if (keys[a] === keys[b] && keys[a + 1] === keys[b + 1] && keys[a + 2] === keys[b + 2] && keys[a + 3] === keys[b + 3] && keys[a + 4] === keys[b + 4] && keys[a + 5] === keys[b + 5]) { out[i] = j; break; }
    }
  }
  return out;
}

const worldBox = (m: Mesh): Box3 => {
  if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
  return m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
};

/**
 * Cast the occlusion of each group under `root` that asks for it (`userData.ao`) and patch its materials (`bakedAo`). Every other mesh with a
 * patched material gets `_ao` fully open. Call it once the root is built, before `mergeStatic` (which keeps `_ao`). Returns the points cast.
 */
export function vertexAo(root: Object3D): number {
  const run = vertexAoSteps(root);
  let step = run.next();
  while (!step.done) step = run.next();
  return step.value;
}

/** One group's cast: the meshes that take its occlusion, and the job that casts it (`aojob.ts`). */
interface Cast { targets: Mesh[]; job: AoJob }

/** What the casts and their answers share: the groups that ask, the meshes that block their rays, and what the answers have patched so far. */
interface Ao { root: Object3D; groups: Object3D[]; blockers: { m: Mesh; box: Box3 }[]; soupOf: (m: Mesh) => Soup; patched: Set<Material>; owned: Set<BufferGeometry>; cast: number }

/** The groups under `root` that ask for the occlusion, and the meshes that block their rays. Null: no group asks. */
function startAo(root: Object3D): Ao | null {
  root.updateMatrixWorld(true);
  const groups: Object3D[] = [];
  const find = (o: Object3D): void => { if (typeof o.userData.ao === 'number') groups.push(o); else for (const c of o.children) find(c); };
  find(root);
  if (!groups.length) return null;
  const blockers: { m: Mesh; box: Box3 }[] = [];
  root.traverse((o) => { if (blocks(o)) blockers.push({ m: o, box: worldBox(o) }); });
  const soups = new Map<Mesh, Soup>();
  // (the wall and the desk block for many groups)
  const soupOf = (m: Mesh): Soup => { let s = soups.get(m); if (!s) soups.set(m, (s = soup(m))); return s; };
  return { root, groups, blockers, soupOf, patched: new Set(), owned: new Set(), cast: 0 };
}

/** The groups' casts, one for each group with a mesh to take it, each made when asked for (its arrays take 1 to 10 ms). */
function* casts({ groups, blockers, soupOf }: Ao): Generator<Cast> {
  for (const grp of groups) {
    const reach = grp.userData.ao as number, targets: Mesh[] = [];
    grp.traverse((o) => { if (takes(o)) targets.push(o); });
    if (!targets.length) continue;
    const roi = new Box3();
    for (const t of targets) roi.union(worldBox(t));
    roi.expandByScalar(reach);
    const mine = new Set(targets), parts = [...targets, ...blockers.filter((b) => !mine.has(b.m) && b.box.intersectsBox(roi)).map((b) => b.m)].map(soupOf);
    const points = parts.reduce((s, q) => s + q.pos.length / 3, 0), count = parts.reduce((s, q) => s + q.tris.length, 0);
    const pos = new Float32Array(3 * points), nrm = new Float32Array(3 * points), tris = new Uint32Array(count), keys = new Int32Array(6 * points);
    let at = 0, ti = 0;
    for (const q of parts) {
      pos.set(q.pos, 3 * at); nrm.set(q.nrm, 3 * at); keys.set(q.keys, 6 * at);
      for (let t = 0; t < q.tris.length; t++) tris[ti++] = q.tris[t]! + at;
      at += q.pos.length / 3;
    }
    // points on one another with one normal are one point (a smooth mesh's seam); a hard edge's points stay apart, each with its face's side
    const weld = weldIds(keys);
    // a one-sided material shows only its normal's side: the other is not cast
    const n = targets.reduce((s, t) => s + t.geometry.attributes.position!.count, 0), one = new Uint8Array(n);
    at = 0;
    for (const t of targets) { const k = t.geometry.attributes.position!.count; if ((t.material as Material).side === FrontSide) one.fill(1, at, at + k); at += k; }
    yield { targets, job: { pos, nrm, tris, weld, one, reach, cast: n } };
  }
}

/** Puts a cast's open shares on its meshes. */
function apply(a: Ao, { targets, job }: Cast, ao: Float32Array): void {
  let at = 0;
  for (const t of targets) {
    const k = t.geometry.attributes.position!.count;
    // a geometry another baked mesh already holds gets a copy of its own
    if (a.owned.has(t.geometry)) t.geometry = t.geometry.clone();
    a.owned.add(t.geometry);
    t.geometry.setAttribute('_ao', new Float32BufferAttribute(ao.slice(2 * at, 2 * (at + k)), 2));
    a.patched.add(t.material as Material);
    at += k;
  }
  a.cast += job.cast;
}

/** Patches the materials the answers reached and opens the other meshes that use them. Returns the points cast. */
function finish({ root, patched, cast }: Ao): number {
  for (const m of patched) bakedAo(m);
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || m.geometry.attributes._ao || !(Array.isArray(m.material) ? m.material : [m.material]).some((x) => patched.has(x))) return;
    m.geometry.setAttribute('_ao', new Float32BufferAttribute(new Float32Array(2 * m.geometry.attributes.position!.count).fill(1), 2));
  });
  return cast;
}

/**
 * `vertexAo` a group at a time: it yields after each group (the largest take 0.2 to 0.3 s), so a caller can paint between them (`Room3D.make`).
 * The last step patches the materials. Its return value is the points cast.
 */
export function* vertexAoSteps(root: Object3D): Generator<void, number> {
  const a = startAo(root);
  if (!a) return 0;
  for (const c of casts(a)) { apply(a, c, runAoJob(c.job)); yield; }
  return finish(a);
}

/**
 * `vertexAoSteps` with the casts on a pool of workers (`aopool.ts`): this thread makes the arrays of each group, the largest group first (a few
 * ms each; `slice` after each gives the page a turn), and a worker casts them as soon as they are made. The answers go on the meshes in the
 * groups' order, so the result is `vertexAoSteps`' to the last bit. A cast a worker cannot make is made here. Returns the points cast.
 */
export async function vertexAoPooled(root: Object3D, pool: AoPool, slice: () => Promise<void>): Promise<number> {
  const a = startAo(root);
  if (!a) return 0;
  const size = (g: Object3D): number => { let n = 0; g.traverse((o) => { if (takes(o)) n += o.geometry.attributes.position!.count; }); return n; };
  const largest = a.groups.map((g, at) => ({ g, at, n: size(g) })).sort((p, q) => q.n - p.n);
  const asked: { c: Cast; ao: Promise<Float32Array> }[] = [];
  for (const { g, at } of largest) {
    for (const c of casts({ ...a, groups: [g] })) asked[at] = { c, ao: pool.run(c.job).catch(() => runAoJob(c.job)) };
    await slice();
  }
  for (const x of asked) if (x) apply(a, x.c, await x.ao);
  return finish(a);
}
