// The city's big meshes, cut to what the window's camera sees. A mesh holds its pieces (a building, a tree) in the order of their bearing from
// the window, so the pieces a camera sees through it lie in one run, from the first it sees to the last: the mesh draws only that run. A ring
// of the city (its pieces at about the same distance) is one mesh, so a run holds few pieces it does not see, and each ring is one draw call.
// The streets' many small things (their paint, their lamps, the tree pits) are one mesh a material, in bearing order too (`sweptMerge`).
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Matrix3,
  Matrix4,
  Mesh,
  Sphere,
  Vector3,
} from 'three';
import type * as threeTypes from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID } from './plan';

/** The bearing of (x, z) from the window (rad): 0 straight out (north, -z), negative to the west. */
export const bearing = (x: number, z: number): number => Math.atan2(x - GRID.av0, -z);

/** The ball round the vertices `from` to `to` (not included) of a position array. */
export function ballOf(pos: ArrayLike<number>, from: number, to: number): Sphere {
  const lo = new Vector3(Infinity, Infinity, Infinity),
    hi = new Vector3(-Infinity, -Infinity, -Infinity),
    p = new Vector3();
  for (let i = from; i < to; i++) {
    p.set(pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!);
    lo.min(p);
    hi.max(p);
  }
  return to > from
    ? new Sphere(lo.clone().add(hi).multiplyScalar(0.5), lo.distanceTo(hi) / 2)
    : new Sphere(new Vector3(), -1);
}

/** Where a geometry's draw counts: its index, or its vertices when it has none. */
export const drawn = (g: BufferGeometry): number => (g.index ? g.index.count : g.attributes['position']!.count);

/** The pieces of one or more meshes in bearing order: each piece's ball, and for each mesh where each piece starts in it (then its end). */
export class Sweep {
  constructor(
    private balls: readonly Sphere[],
    private runs: readonly { mesh: Mesh; at: readonly number[] }[],
  ) {}

  /**
   * Each mesh draws the run of pieces from the first that `seen` (the camera's frustum) holds to the last; with no `seen`, every piece. `also`: a
   * second frustum whose pieces join the run (the sun's shadow box, on a frame that draws its map: the pieces behind the camera that cast into it).
   */
  cut(seen?: threeTypes.Frustum, also?: threeTypes.Frustum): void {
    let a = 0,
      b = this.balls.length;
    if (seen) {
      a = b = -1;
      for (let k = 0; k < this.balls.length; k++) {
        if (seen.intersectsSphere(this.balls[k]!) || (also && also.intersectsSphere(this.balls[k]!))) {
          if (a < 0) {
            a = k;
          }
          b = k + 1;
        }
      }
      if (a < 0) {
        a = b = 0;
      }
    }
    for (const { mesh, at } of this.runs) {
      const s = at[a]!,
        n = at[b]! - s;
      mesh.geometry.setDrawRange(s, n);
      mesh.visible = n > 0;
    }
  }
}

const KEEP = new Set(['position', 'normal', 'uv']);
/** `sweptMerge` cuts by cells of the ground this size (m), not mesh by mesh: far fewer balls to test a draw. */
const CELL = 24;

/**
 * Merge the meshes under `root` on each of `mats` into one mesh a material on `root` (in its frame, unindexed, with only a position, a normal
 * and a uv), each cell of the ground (`CELL`) a piece, in bearing order; returns the sweeps that cut them. The originals leave the tree. Call
 * it before `mergeStatic`. The plain way, a geometry a mesh (clone, transform, unindex, bound): `sweptMerge` does the same without them, and
 * sends a material it cannot take (a packed or interleaved attribute, a morph target) here. The tests hold the two to the same result.
 */
export function sweptMergeReference(
  root: threeTypes.Object3D,
  mats: readonly threeTypes.Material[],
  cell = CELL,
  keep: readonly string[] = [],
): Sweep[] {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert(),
    out: Sweep[] = [];
  for (const mat of mats) {
    // each mesh in the root's frame, by its cell
    const cells = new Map<string, { ms: Mesh[]; gs: BufferGeometry[]; x: number; z: number; b: number }>();
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || m.material !== mat) {
        return;
      }
      let g = m.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
      if (g.index) {
        g = g.toNonIndexed();
      }
      for (const k of Object.keys(g.attributes)) {
        if (!KEEP.has(k) && !keep.includes(k)) {
          g.deleteAttribute(k);
        }
      }
      if (!g.attributes['normal']) {
        g.computeVertexNormals();
      }
      if (!g.attributes['uv']) {
        g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes['position']!.count * 2), 2));
      }
      g.clearGroups();
      g.computeBoundingSphere();
      const c = g.boundingSphere!.center,
        key = `${Math.floor(c.x / cell)},${Math.floor(c.z / cell)}`;
      const s = cells.get(key) ?? { ms: [], gs: [], x: 0, z: 0, b: 0 };
      cells.set(key, s);
      s.ms.push(m);
      s.gs.push(g);
      s.x += c.x;
      s.z += c.z;
    });
    // the cells in bearing order, each a piece of the one mesh
    const pieces = [...cells.values()];
    for (const p of pieces) {
      p.b = bearing(p.x / p.ms.length, p.z / p.ms.length);
    }
    pieces.sort((p, q) => p.b - q.b);
    const gs = pieces.flatMap((p) => p.gs),
      g = gs.length > 1 ? mergeGeometries(gs, false) : null;
    if (!g) {
      continue;
    }
    const at = [0],
      pos = g.attributes['position']!.array,
      mesh = new Mesh(g, mat),
      first = pieces[0]!.ms[0]!;
    for (const p of pieces) {
      at.push(at.at(-1)! + p.gs.reduce((n, pg) => n + pg.attributes['position']!.count, 0));
    }
    for (const p of pieces) {
      for (const m of p.ms) {
        m.parent?.remove(m);
      }
    }
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    root.add(mesh);
    out.push(
      new Sweep(
        pieces.map((_, k) => ballOf(pos, at[k]!, at[k + 1]!)),
        [{ mesh, at }],
      ),
    );
  }
  return out;
}

/** What a mesh holds once merged: its attributes and their item sizes, as the reference leaves them (the kept ones in their order, then a normal and a uv if it had none). Null: plain floats it is not. */
export function columnsOf(g: BufferGeometry, keep: readonly string[]): Map<string, number> | null {
  if (Object.keys(g.morphAttributes).length > 0) {
    return null;
  }
  const cols = new Map<string, number>();
  for (const k of Object.keys(g.attributes)) {
    if (!KEEP.has(k) && !keep.includes(k)) {
      continue;
    }
    const a = g.attributes[k] as BufferAttribute & { isInterleavedBufferAttribute?: boolean };
    if (a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array) || a.normalized) {
      return null;
    }
    cols.set(k, a.itemSize);
  }
  if (cols.get('position') !== 3 || (cols.has('normal') && cols.get('normal') !== 3)) {
    return null;
  }
  if (!cols.has('normal')) {
    cols.set('normal', 3);
  }
  if (!cols.has('uv')) {
    cols.set('uv', 2);
  }
  return cols;
}

/** One mesh's vertices in the shared arrays (`from` to `to`), the middle of their box in the root's frame, and the attributes it holds. */
interface Part {
  mesh: Mesh;
  from: number;
  to: number;
  x: number;
  z: number;
  cols: Map<string, number>;
}

/**
 * `sweptMergeReference` without a geometry a mesh. The street holds some thousands of small meshes: the reference clones, transforms, unindexes
 * and bounds each (a geometry and four arrays a mesh) and merges the lot again, 0.3 s of the boot. Here each mesh's triangles are written in the
 * root's frame, apart, into one array an attribute; the cells (the middles of the boxes of those vertices, as `computeBoundingSphere`) put the
 * meshes in pieces in bearing order, and the pieces are copied into their places. The same numbers: Three's own `applyMatrix4` and
 * `applyNormalMatrix` on each point.
 */
export function sweptMerge(
  root: threeTypes.Object3D,
  mats: readonly threeTypes.Material[],
  cell = CELL,
  keep: readonly string[] = [],
): Sweep[] {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert(),
    out: Sweep[] = [],
    m4 = new Matrix4(),
    n3 = new Matrix3(),
    v = new Vector3();
  for (const mat of mats) {
    const meshes: Mesh[] = [];
    root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.material === mat) {
        meshes.push(m);
      }
    });
    // (one mesh is not a merge)
    if (meshes.length < 2) {
      continue;
    }
    const all = meshes.map((m) => columnsOf(m.geometry, keep)),
      [first] = all;
    const sizes =
      first && all.every((c) => c && c.size === first.size && [...first].every(([k, s]) => c.get(k) === s))
        ? first
        : null;
    if (!sizes) {
      out.push(...sweptMergeReference(root, [mat], cell, keep));
      continue;
    }
    const counts = meshes.map((m) =>
      m.geometry.index ? m.geometry.index.count : m.geometry.attributes['position']!.count,
    );
    const total = counts.reduce((a, b) => a + b, 0),
      apart = new Map<string, Float32Array>([...sizes].map(([k, s]) => [k, new Float32Array(total * s)] as const));
    const pos = apart.get('position')!,
      nrm = apart.get('normal')!,
      parts: Part[] = [];
    let at = 0;
    meshes.forEach((m, i) => {
      const g = m.geometry,
        idx = g.index?.array,
        n = counts[i]!,
        own = g.attributes['normal']?.array as Float32Array | undefined,
        src = g.attributes['position']!.array as Float32Array;
      n3.getNormalMatrix(m4.multiplyMatrices(toRoot, m.matrixWorld));
      for (let j = 0; j < n; j++) {
        const s = 3 * (idx ? idx[j]! : j),
          d = 3 * (at + j);
        v.set(src[s]!, src[s + 1]!, src[s + 2]!).applyMatrix4(m4);
        pos[d] = v.x;
        pos[d + 1] = v.y;
        pos[d + 2] = v.z;
        if (own) {
          v.set(own[s]!, own[s + 1]!, own[s + 2]!).applyNormalMatrix(n3);
          nrm[d] = v.x;
          nrm[d + 1] = v.y;
          nrm[d + 2] = v.z;
        }
      }
      if (!own) {
        // (no normals: flat ones from the triangles, as the reference's `computeVertexNormals` on the unindexed mesh)
        const flat = new BufferGeometry().setAttribute(
          'position',
          new BufferAttribute(pos.subarray(3 * at, 3 * (at + n)), 3),
        );
        flat.computeVertexNormals();
        nrm.set(flat.attributes['normal']!.array as Float32Array, 3 * at);
      }
      // (a mesh with no uv leaves its place in the array at 0, as the reference's zeros)
      for (const [k, size] of sizes) {
        const a = g.attributes[k],
          col = apart.get(k)!;
        if (k === 'position' || k === 'normal' || !a) {
          continue;
        }
        const from = a.array as Float32Array;
        for (let j = 0; j < n; j++) {
          const s = size * (idx ? idx[j]! : j),
            d = size * (at + j);
          for (let c = 0; c < size; c++) {
            col[d + c] = from[s + c]!;
          }
        }
      }
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (let j = at; j < at + n; j++) {
        const x = pos[3 * j]!,
          z = pos[3 * j + 2]!;
        if (x < x0) {
          x0 = x;
        }
        if (x > x1) {
          x1 = x;
        }
        if (z < z0) {
          z0 = z;
        }
        if (z > z1) {
          z1 = z;
        }
      }
      parts.push({
        mesh: m,
        from: at,
        to: at + n,
        x: n ? (x0 + x1) * 0.5 : 0,
        z: n ? (z0 + z1) * 0.5 : 0,
        cols: all[i]!,
      });
      at += n;
    });
    // the cells in bearing order, each a piece of the one mesh
    const cells = new Map<string, { ps: Part[]; x: number; z: number; b: number }>();
    for (const p of parts) {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`,
        c = cells.get(key) ?? { ps: [], x: 0, z: 0, b: 0 };
      cells.set(key, c);
      c.ps.push(p);
      c.x += p.x;
      c.z += p.z;
    }
    const pieces = [...cells.values()];
    for (const p of pieces) {
      p.b = bearing(p.x / p.ps.length, p.z / p.ps.length);
    }
    pieces.sort((p, q) => p.b - q.b);
    // the pieces' vertices in their order, the attributes in the order of the first piece's first mesh (as `mergeGeometries`)
    const g = new BufferGeometry(),
      at2 = [0],
      first0 = pieces[0]!.ps[0]!;
    for (const [k, size] of first0.cols) {
      const col = new Float32Array(total * size),
        from = apart.get(k)!;
      let o = 0;
      for (const p of pieces) {
        for (const q of p.ps) {
          col.set(from.subarray(size * q.from, size * q.to), size * o);
          o += q.to - q.from;
        }
      }
      g.setAttribute(k, new BufferAttribute(col, size));
    }
    for (const p of pieces) {
      at2.push(at2.at(-1)! + p.ps.reduce((n, q) => n + q.to - q.from, 0));
    }
    for (const p of pieces) {
      for (const q of p.ps) {
        q.mesh.parent?.remove(q.mesh);
      }
    }
    const mesh = new Mesh(g, mat),
      merged = g.attributes['position']!.array;
    mesh.castShadow = first0.mesh.castShadow;
    mesh.receiveShadow = first0.mesh.receiveShadow;
    root.add(mesh);
    out.push(
      new Sweep(
        pieces.map((_, k) => ballOf(merged, at2[k]!, at2[k + 1]!)),
        [{ mesh, at: at2 }],
      ),
    );
  }
  return out;
}
