// Mesh soup and occlusion predicates used by `vertexao.ts`: world-space points, weld keys, and which meshes take or block the rays.
import { Matrix3, Vector3 } from 'three';
import type * as threeTypes from 'three';

/** Is it drawn? Its own flag and all those above it. */
const shown = (o: threeTypes.Object3D): boolean => {
  for (let p: threeTypes.Object3D | null = o; p !== null; p = p.parent) {
    if (!p.visible) {
      return false;
    }
  }
  return true;
};

/** A plain shown mesh (not instanced, not skinned). */
function plain(o: threeTypes.Object3D): o is threeTypes.Mesh {
  if (!('isMesh' in o) || o.isMesh !== true) {
    return false;
  }
  if ('isInstancedMesh' in o && o.isInstancedMesh === true) {
    return false;
  }
  if ('isSkinnedMesh' in o && o.isSkinnedMesh === true) {
    return false;
  }
  return shown(o);
}

function isStandard(m: threeTypes.Material): m is threeTypes.MeshStandardMaterial {
  return 'isMeshStandardMaterial' in m && m.isMeshStandardMaterial === true;
}

/** Can it take the occlusion: one opaque lit material that does not glow. */
export function takes(o: threeTypes.Object3D): o is threeTypes.Mesh {
  if (!plain(o) || Array.isArray(o.material) || !isStandard(o.material)) {
    return false;
  }
  return !o.material.transparent && o.material.emissiveMap === null && o.material.emissive.getHex() === 0;
}

/** Does it block the rays: opaque. */
export const blocks = (o: threeTypes.Object3D): o is threeTypes.Mesh =>
  plain(o) && (Array.isArray(o.material) ? o.material : [o.material]).every((m) => !m.transparent);

/** A mesh's points and normals in world space, what each is welded by (`weldIds`), and its triangles. */
export interface Soup {
  pos: Float32Array;
  nrm: Float32Array;
  keys: Int32Array;
  tris: Uint32Array;
}

const at = (a: Float32Array | Int32Array, i: number): number => a[i] ?? 0;

export function soup(m: threeTypes.Mesh): Soup {
  const g = m.geometry;
  if (!g.hasAttribute('normal')) {
    g.computeVertexNormals();
  }
  const p = g.getAttribute('position'),
    n = g.getAttribute('normal');
  if (p === undefined || n === undefined) {
    throw new Error('vertexao soup: mesh has no position or normal');
  }
  const k = p.count,
    nm = new Matrix3().getNormalMatrix(m.matrixWorld),
    v = new Vector3();
  const pos = new Float32Array(3 * k),
    nrm = new Float32Array(3 * k),
    keys = new Int32Array(6 * k),
    tris = g.index === null ? new Uint32Array(k) : new Uint32Array(g.index.array);
  for (let i = 0; i < k; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
    pos[3 * i] = v.x;
    pos[3 * i + 1] = v.y;
    pos[3 * i + 2] = v.z;
    v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
    nrm[3 * i] = v.x;
    nrm[3 * i + 1] = v.y;
    nrm[3 * i + 2] = v.z;
    for (let e = 0; e < 3; e++) {
      keys[6 * i + e] = Math.round(at(pos, 3 * i + e));
      keys[6 * i + 3 + e] = Math.round(at(nrm, 3 * i + e) * 20);
    }
    if (g.index === null) {
      tris[i] = i;
    }
  }
  return { pos, nrm, keys, tris };
}

/** Each point's first point with the same six `keys` (a hash table in one array: strings for the room's points took a fifth of this file's time). */
export function weldIds(keys: Int32Array): Int32Array {
  const n = keys.length / 6,
    mask = 2 ** Math.ceil(Math.log2(2 * n + 1)) - 1,
    table = new Int32Array(mask + 1).fill(-1),
    out = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const a = 6 * i;
    let h = 0;
    for (let e = 0; e < 6; e++) {
      h = Math.imul(h ^ at(keys, a + e), 0x9e_37_79_b1);
    }
    for (h = (h ^ (h >>> 15)) & mask; ; h = (h + 1) & mask) {
      const j = at(table, h);
      if (j < 0) {
        table[h] = i;
        out[i] = i;
        break;
      }
      const b = 6 * j;
      if (
        keys[a] === keys[b] &&
        keys[a + 1] === keys[b + 1] &&
        keys[a + 2] === keys[b + 2] &&
        keys[a + 3] === keys[b + 3] &&
        keys[a + 4] === keys[b + 4] &&
        keys[a + 5] === keys[b + 5]
      ) {
        out[i] = j;
        break;
      }
    }
  }
  return out;
}

export const worldBox = (m: threeTypes.Mesh): threeTypes.Box3 => {
  if (m.geometry.boundingBox === null) {
    m.geometry.computeBoundingBox();
  }
  const box = m.geometry.boundingBox;
  if (box === null) {
    throw new Error('vertexao worldBox: bounding box missing after compute');
  }
  return box.clone().applyMatrix4(m.matrixWorld);
};
