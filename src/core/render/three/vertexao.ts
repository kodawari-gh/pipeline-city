// Baked occlusion on still hard things (`src/features/room/light.md`, T178): the room's props and plants carry `_ao` as the hoodie does
// (`bakedao.ts`, `docs/render/cloth.md`), cast once when the room is built, never in a frame. A group asks for it by `userData.ao` (set by its
// builder): how far its rays reach, in world units. Its meshes and every still opaque mesh near them (the desk under the keyboard, the wall
// behind the clock) block the rays, so the keys' gaps, the lamp's joints and a plant's inner leaves darken. A glow, a screen and a see-through
// mesh take none.
import { Box3, Float32BufferAttribute, FrontSide, Matrix3, Vector3, type BufferGeometry, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { bakedAo } from './bakedao';
import { occlusion } from './cloth/occlusion';

/** The rays cast a side from each point. */
const RAYS = 24;
/** No solid: only triangles block. */
const open = () => Infinity;

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

/** A mesh's points and normals in world space, and its triangles. */
function soup(m: Mesh): { pos: Float32Array; nrm: Float32Array; tris: Uint32Array } {
  const g = m.geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position!, n = g.attributes.normal!, k = p.count, nm = new Matrix3().getNormalMatrix(m.matrixWorld), v = new Vector3();
  const pos = new Float32Array(3 * k), nrm = new Float32Array(3 * k);
  for (let i = 0; i < k; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); pos[3 * i] = v.x; pos[3 * i + 1] = v.y; pos[3 * i + 2] = v.z;
    v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nrm[3 * i] = v.x; nrm[3 * i + 1] = v.y; nrm[3 * i + 2] = v.z;
  }
  return { pos, nrm, tris: g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: k }, (_, i) => i) };
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
  root.updateMatrixWorld(true);
  const groups: Object3D[] = [];
  const find = (o: Object3D): void => { if (typeof o.userData.ao === 'number') groups.push(o); else for (const c of o.children) find(c); };
  find(root);
  if (!groups.length) return 0;
  const blockers: { m: Mesh; box: Box3 }[] = [];
  root.traverse((o) => { if (blocks(o)) blockers.push({ m: o, box: worldBox(o) }); });
  const patched = new Set<Material>(), owned = new Set<BufferGeometry>();
  let cast = 0;
  for (const grp of groups) {
    const reach = grp.userData.ao as number, targets: Mesh[] = [];
    grp.traverse((o) => { if (takes(o)) targets.push(o); });
    if (!targets.length) continue;
    const roi = new Box3();
    for (const t of targets) roi.union(worldBox(t));
    roi.expandByScalar(reach);
    const mine = new Set(targets), parts = [...targets, ...blockers.filter((b) => !mine.has(b.m) && b.box.intersectsBox(roi)).map((b) => b.m)].map(soup);
    const points = parts.reduce((s, q) => s + q.pos.length / 3, 0), count = parts.reduce((s, q) => s + q.tris.length, 0);
    const pos = new Float32Array(3 * points), nrm = new Float32Array(3 * points), tris = new Uint32Array(count), weld = new Int32Array(points);
    // points on one another with one normal are one point (a smooth mesh's seam); a hard edge's points stay apart, each with its face's side
    const ids = new Map<string, number>();
    let at = 0, ti = 0;
    for (const q of parts) {
      pos.set(q.pos, 3 * at); nrm.set(q.nrm, 3 * at);
      for (let t = 0; t < q.tris.length; t++) tris[ti++] = q.tris[t]! + at;
      for (let i = 0; i < q.pos.length / 3; i++) {
        const k = 3 * i, key = `${Math.round(q.pos[k]!)},${Math.round(q.pos[k + 1]!)},${Math.round(q.pos[k + 2]!)},${Math.round(q.nrm[k]! * 20)},${Math.round(q.nrm[k + 1]! * 20)},${Math.round(q.nrm[k + 2]! * 20)}`;
        let id = ids.get(key);
        if (id === undefined) ids.set(key, (id = at + i));
        weld[at + i] = id;
      }
      at += q.pos.length / 3;
    }
    // a one-sided material shows only its normal's side: the other is not cast
    const n = targets.reduce((s, t) => s + t.geometry.attributes.position!.count, 0), one = new Uint8Array(n);
    at = 0;
    for (const t of targets) { const k = t.geometry.attributes.position!.count; if ((t.material as Material).side === FrontSide) one.fill(1, at, at + k); at += k; }
    const ao = occlusion(pos, nrm, tris, weld, open, RAYS, reach, 0, n, one);
    at = 0;
    for (const t of targets) {
      const k = t.geometry.attributes.position!.count;
      // a geometry another baked mesh already holds gets a copy of its own
      if (owned.has(t.geometry)) t.geometry = t.geometry.clone();
      owned.add(t.geometry);
      t.geometry.setAttribute('_ao', new Float32BufferAttribute(ao.slice(2 * at, 2 * (at + k)), 2));
      patched.add(t.material as Material);
      at += k;
    }
    cast += n;
  }
  for (const m of patched) bakedAo(m);
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || m.geometry.attributes._ao || !(Array.isArray(m.material) ? m.material : [m.material]).some((x) => patched.has(x))) return;
    m.geometry.setAttribute('_ao', new Float32BufferAttribute(new Float32Array(2 * m.geometry.attributes.position!.count).fill(1), 2));
  });
  return cast;
}
