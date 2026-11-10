// Still scenery in few draw calls: the meshes under a root that share a material become one mesh. The room builds each plank, book and
// cushion as its own mesh (easy to place and to read); merged, a frame draws one mesh per material, and the shadow scan walks far fewer.
// Then the palette merge (`mergePalette`): still meshes whose materials differ only in colour, roughness and metalness become one mesh per
// cell of space, each vertex with its mesh's three values, so a frame changes material far less often.
import {
  Box3, BufferAttribute, Float32BufferAttribute, Matrix4, Mesh, Object3D, ShaderChunk, Vector3, type BufferGeometry, type Material,
  type MeshStandardMaterial, type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materialKey, stillMaterial } from './materials';

const KEEP = new Set(['position', 'normal', 'uv']);

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
 * The geometry in the root's frame, unindexed, with only a position, a normal and a uv (so every kind merges with every other), and its baked
 * occlusion when the whole set has one (`vertexao.ts`).
 */
function prepared(m: Mesh, toRoot: Matrix4, ao: boolean): BufferGeometry {
  let g = m.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!KEEP.has(k) && !(ao && k === '_ao')) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
  g.clearGroups();
  return g;
}

/**
 * Merge the still meshes under `root` by material (and by how they cast and take shadows): each set becomes one mesh on the root, the
 * originals leave the tree. A mesh with an id over it (it answers a click), a see-through, transparent, instanced or moving one stays as it
 * is. Call it once the root is built, before it is drawn. Returns how many meshes were merged.
 */
export function mergeStatic(root: Object3D): number {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const sets = new Map<string, { m: Material; cast: boolean; take: boolean; meshes: Mesh[] }>();
  root.traverse((o) => {
    if (!still(o, root)) return;
    const k = `${(o.material as Material).uuid}|${o.castShadow}|${o.receiveShadow}`;
    let s = sets.get(k);
    if (!s) sets.set(k, (s = { m: o.material as Material, cast: o.castShadow, take: o.receiveShadow, meshes: [] }));
    s.meshes.push(o);
  });
  let n = 0;
  for (const s of sets.values()) {
    if (s.meshes.length < 2) continue;
    const ao = s.meshes.every((m) => !!m.geometry.attributes._ao);
    const g = mergeGeometries(s.meshes.map((m) => prepared(m, toRoot, ao)), false);
    if (!g) continue;
    for (const m of s.meshes) m.parent?.remove(m);
    const out = new Mesh(g, s.m);
    out.castShadow = s.cast; out.receiveShadow = s.take;
    out.name = 'merged';
    root.add(out);
    n += s.meshes.length;
  }
  return n;
}

// ---- the palette merge ----

/** A mesh `mergePalette` took in, as it was (its geometry, its material), and its matrix in the root's frame: the light bake reads it. */
export interface Part { mesh: Mesh; inRoot: Matrix4 }
const partsBy = new WeakMap<Object3D, readonly Part[]>();
/** The meshes a palette mesh was merged from; none for any other object (`tools/bake/scene.ts` exports them in its place). */
export const partsOf = (o: Object3D): readonly Part[] => partsBy.get(o) ?? [];

/** The fields a palette material takes from each vertex in place of its uniforms. */
const ON_VERTEX: ReadonlySet<string> = new Set(['color', 'roughness', 'metalness']);
const PAL_VERT = 'attribute vec3 _pc;\nattribute vec2 _prm;\nflat varying vec3 vPalC;\nflat varying vec2 vPalRM;';
const PAL_FRAG = 'flat varying vec3 vPalC;\nflat varying vec2 vPalRM;';
const DIFFUSE = 'vec4 diffuseColor = vec4( diffuse, opacity );';
const ROUGH = ShaderChunk.roughnessmap_fragment.replace('= roughness;', '= vPalRM.x;');
const METAL = ShaderChunk.metalnessmap_fragment.replace('= metalness;', '= vPalRM.y;');

/**
 * Patches a shader to read the colour, the roughness and the metalness from the mesh's `_pc` and `_prm` (flat: each triangle keeps its
 * mesh's values exactly). Throws when three's shader no longer has a place it patches (the mesh would draw white).
 */
export function palettePatch(sh: { vertexShader: string; fragmentShader: string }): void {
  const sub = (s: string, a: string, b: string) => { if (!s.includes(a)) throw new Error(`palette patch: no ${a}`); return s.replace(a, b); };
  sh.vertexShader = sub(sub(sh.vertexShader, '#include <common>', `#include <common>\n${PAL_VERT}`), '#include <begin_vertex>', '#include <begin_vertex>\nvPalC = _pc;\nvPalRM = _prm;');
  let f = sub(sh.fragmentShader, '#include <common>', `#include <common>\n${PAL_FRAG}`);
  f = sub(f, DIFFUSE, 'vec4 diffuseColor = vec4( vPalC, opacity );');
  f = sub(f, '#include <roughnessmap_fragment>', ROUGH);
  sh.fragmentShader = sub(f, '#include <metalnessmap_fragment>', METAL);
}

/** A copy of `src` that reads its colour, roughness and metalness from the vertices; it keeps the source's patches. */
function paletteOf(src: MeshStandardMaterial): MeshStandardMaterial {
  const m = src.clone(), prev = src.onBeforeCompile, key = `${src.customProgramCacheKey()}|pal`;
  m.color.setRGB(1, 1, 1);
  m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r: WebGLRenderer) => { prev.call(src, sh, r); palettePatch(sh); };
  m.customProgramCacheKey = () => key;
  return m;
}

/** The program inputs of a mesh's geometry: its attributes' names and formats (a merge needs them alike). Null: not one to merge. */
function attrsKey(g: BufferGeometry): string | null {
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return null;
  const out: string[] = [];
  for (const k of Object.keys(g.attributes).sort()) {
    const a = g.attributes[k] as BufferAttribute & { isInterleavedBufferAttribute?: boolean };
    if (a.isInterleavedBufferAttribute) return null;
    out.push(`${k}:${a.itemSize}:${a.array.constructor.name}:${a.normalized}`);
  }
  return out.join(',');
}

export interface PaletteOptions {
  /** Subtrees left as they are (built again after the build: the key rack). */
  skip?: readonly Object3D[];
  /** Whether a material may join (the room: one that takes its reflections, `RoomEnv`). */
  ok?: (m: Material) => boolean;
  /** Hears of each palette material, made from its set's first material (the room's reflections take it in). */
  twin?: (src: Material, copy: Material) => void;
  /** Hears of each material no mesh draws with any more, before it is disposed (its fields stay readable for the bake). */
  drop?: (m: Material) => void;
  /** The side of the cells of space (root units) kept apart, so each merged mesh stays small enough to be culled. */
  cell?: number;
}

/**
 * Merges the still meshes under `root` whose materials differ only in colour, roughness and metalness (`materialKey` without them): by that
 * key, by how they cast and take shadows, by their attributes and by the cell of space their middle falls in. Each set of two or more becomes
 * one mesh on the root with a palette material (`paletteOf`): it draws as the meshes did. A mesh that answers a click, moves, fades, glows or
 * has a writer (`own`), or a material of unknown inputs, stays as it is. The merged meshes keep their own attributes (the light map's `uv1`,
 * the baked occlusion). Returns how many meshes were merged.
 */
export function mergePalette(root: Object3D, o: PaletteOptions = {}): number {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert(), skip = new Set(o.skip ?? []), cell = o.cell ?? Infinity;
  const sets = new Map<string, { prog: string; meshes: Mesh[] }>(), box = new Box3(), mid = new Vector3(), k = new Matrix4();
  const cellOf = (v: number) => (Number.isFinite(cell) ? Math.floor(v / cell) : 0);
  const walk = (x: Object3D): void => {
    if (skip.has(x)) return;
    const m = x as Mesh, mat = m.material as MeshStandardMaterial;
    if (m.isMesh && still(m, root) && mat.isMeshStandardMaterial && stillMaterial(mat) && (o.ok?.(mat) ?? true)
      && m.onBeforeRender === Object3D.prototype.onBeforeRender && !m.customDepthMaterial && !m.customDistanceMaterial) {
      const key = materialKey(mat, ON_VERTEX), attrs = attrsKey(m.geometry);
      if (key !== null && attrs !== null) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        box.copy(m.geometry.boundingBox!).applyMatrix4(k.multiplyMatrices(toRoot, m.matrixWorld)).getCenter(mid);
        const prog = `${attrs}|${key}`, at = `${cellOf(mid.x)},${cellOf(mid.y)},${cellOf(mid.z)}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}|${m.frustumCulled}|${m.layers.mask}|${prog}`;
        let s = sets.get(at);
        if (!s) sets.set(at, (s = { prog, meshes: [] }));
        s.meshes.push(m);
      }
    }
    for (const c of x.children) walk(c);
  };
  walk(root);
  let n = 0;
  const gone: Mesh[] = [];
  // (made in the order of their programs: three draws by material, and the palette materials of one program side by side change no program)
  for (const { meshes } of [...sets.values()].sort((a, b) => (a.prog < b.prog ? -1 : a.prog > b.prog ? 1 : 0))) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((m) => ({ mesh: m, inRoot: new Matrix4().multiplyMatrices(toRoot, m.matrixWorld) }));
    const g = mergeGeometries(parts.map(({ mesh, inRoot }) => {
      let x = mesh.geometry.clone().applyMatrix4(inRoot);
      if (x.index) x = x.toNonIndexed();
      x.clearGroups();
      const c = (mesh.material as MeshStandardMaterial).color, { roughness, metalness } = mesh.material as MeshStandardMaterial;
      const count = x.attributes.position!.count, pc = new Float32Array(3 * count), prm = new Float32Array(2 * count);
      for (let i = 0; i < count; i++) { pc[3 * i] = c.r; pc[3 * i + 1] = c.g; pc[3 * i + 2] = c.b; prm[2 * i] = roughness; prm[2 * i + 1] = metalness; }
      x.setAttribute('_pc', new BufferAttribute(pc, 3));
      x.setAttribute('_prm', new BufferAttribute(prm, 2));
      return x;
    }), false);
    if (!g) continue;
    const first = meshes[0]!, src = first.material as MeshStandardMaterial, out = new Mesh(g, paletteOf(src));
    o.twin?.(src, out.material as Material);
    out.castShadow = first.castShadow; out.receiveShadow = first.receiveShadow;
    out.renderOrder = first.renderOrder; out.frustumCulled = first.frustumCulled; out.layers.mask = first.layers.mask;
    out.name = 'merged';
    for (const m of meshes) { m.parent?.remove(m); gone.push(m); }
    root.add(out);
    partsBy.set(out, parts);
    n += meshes.length;
  }
  // what no mesh draws with any more leaves the GPU (its fields stay for the bake's export)
  const used = new Set<unknown>();
  root.traverse((x) => { const m = x as Mesh; if (m.isMesh) { used.add(m.geometry); for (const a of [m.material].flat()) used.add(a); } });
  for (const m of gone) {
    const mat = m.material as Material;
    if (!used.has(mat)) { used.add(mat); o.drop?.(mat); mat.dispose(); }
    if (!used.has(m.geometry)) { used.add(m.geometry); m.geometry.dispose(); }
  }
  return n;
}
