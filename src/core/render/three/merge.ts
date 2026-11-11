// Still scenery in few draw calls: the meshes under a root that share a material become one mesh. The room builds each plank, book and
// cushion as its own mesh (easy to place and to read); merged, a frame draws one mesh per material, and the shadow scan walks far fewer.
import { Float32BufferAttribute, Matrix4, Mesh, type BufferGeometry, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = new Set(['position', 'normal', 'uv']);
/** A set keeps these only when each of its meshes has them: the baked occlusion (`vertexao.ts`), the lightmap's UVs (`lightmapmix.ts`). */
const SHARED = ['_ao', 'uv1'] as const;

/** What a merged mesh of lit meshes keeps: the hash the bake knows each part by and its corners, in order (`tools/bake/scene.ts` splits it). */
export interface BakePart { hash: string; corners: number }

/** Can this mesh join a merge: a plain shown mesh with one opaque material, not picked (no id on it or over it), not see-through, not moving. */
function still(o: Object3D, root: Object3D): o is Mesh {
  const m = o as Mesh;
  if (!m.isMesh || (m as { isInstancedMesh?: boolean }).isInstancedMesh || (m as { isSkinnedMesh?: boolean }).isSkinnedMesh) return false;
  if (Array.isArray(m.material) || (m.material as Material).transparent || m.raycast !== Mesh.prototype.raycast) return false;
  if (Object.keys(m.geometry.morphAttributes).length || m.matrixWorld.determinant() < 0) return false;
  for (let p: Object3D | null = o; p; p = p === root ? null : p.parent) {
    if (!p.visible || typeof p.userData.id === 'string' || p.userData.spin || p.userData.live) return false;
  }
  return true;
}

/**
 * The geometry in the root's frame, unindexed, with only a position, a normal and a uv (so every kind merges with every other), and the
 * `SHARED` attributes the whole set has (`extra`).
 */
function prepared(m: Mesh, toRoot: Matrix4, extra: ReadonlySet<string>): BufferGeometry {
  let g = m.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!KEEP.has(k) && !extra.has(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
  g.clearGroups();
  return g;
}

/** A lit mesh's parts as the bake knows them: its own hash, or the parts of a mesh merged before; null for a mesh the bake does not light. */
function bakePartsOf(m: Mesh): BakePart[] | null {
  if (Array.isArray(m.userData.bakeParts)) return m.userData.bakeParts as BakePart[];
  if (typeof m.userData.bakeHash !== 'string') return null;
  return [{ hash: m.userData.bakeHash, corners: m.geometry.index?.count ?? m.geometry.attributes.position!.count }];
}

/**
 * Merge the still meshes under `root` by material (and by how they cast and take shadows): each set becomes one mesh on the root, the
 * originals leave the tree. A mesh with an id over it (it answers a click), a see-through, transparent, instanced or moving one stays as it
 * is, and so does one that `only` refuses. A set of lit meshes (each with `userData.bakeHash`) keeps their UVs and hashes (`bakeParts`).
 * Call it once the root is built, before it is drawn. Returns how many meshes were merged.
 */
export function mergeStatic(root: Object3D, only?: (m: Mesh) => boolean): number {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const sets = new Map<string, { m: Material; cast: boolean; take: boolean; meshes: Mesh[] }>();
  root.traverse((o) => {
    if (!still(o, root) || (only && !only(o))) return;
    const k = `${(o.material as Material).uuid}|${o.castShadow}|${o.receiveShadow}`;
    let s = sets.get(k);
    if (!s) sets.set(k, (s = { m: o.material as Material, cast: o.castShadow, take: o.receiveShadow, meshes: [] }));
    s.meshes.push(o);
  });
  let n = 0;
  for (const s of sets.values()) {
    if (s.meshes.length < 2) continue;
    // (a lit mesh and an unlit one never join: the unlit one has no UVs for the light map)
    if (s.meshes.some((m) => !!m.geometry.attributes.uv1) && !s.meshes.every((m) => !!m.geometry.attributes.uv1)) continue;
    const extra = new Set<string>(SHARED.filter((a) => s.meshes.every((m) => !!m.geometry.attributes[a])));
    const g = mergeGeometries(s.meshes.map((m) => prepared(m, toRoot, extra)), false);
    if (!g) continue;
    for (const m of s.meshes) m.parent?.remove(m);
    const out = new Mesh(g, s.m);
    out.castShadow = s.cast; out.receiveShadow = s.take;
    out.name = 'merged';
    const parts = s.meshes.map(bakePartsOf);
    if (parts.every((p) => p !== null)) out.userData.bakeParts = parts.flat();
    root.add(out);
    n += s.meshes.length;
  }
  return n;
}
