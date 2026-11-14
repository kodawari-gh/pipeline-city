// Still scenery in few draw calls: the meshes under a root that share a material become one mesh. The room builds each plank, book and
// cushion as its own mesh (easy to place and to read); merged, a frame draws one mesh per material, and the shadow scan walks far fewer.
// Then the palette merge (`mergePalette`): still meshes whose materials differ only in colour, roughness and metalness become one mesh per
// cell of space, each vertex with its mesh's three values, so a frame changes material far less often. `mergeSiblings` does the same inside
// each parent of a built model (the machine): its parts keep their ids, fades, motion and picks. `standIns` merges across parents for a
// distance (`partlod.ts`): the meshes stay in the tree, and a stand-in draws in their place.
import {
  Box3, BufferAttribute, Color, Float32BufferAttribute, Matrix4, Mesh, Object3D, ShaderChunk, Vector3, type BufferGeometry, type Material,
  type MeshStandardMaterial, type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DARK_METAL, NON_METAL, warmMetal } from './cheapmaterials';
import { lowDetail } from './detail';
import { KEEP_SPEC, materialKey, stillMaterial } from './materials';

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
 * Merge the still meshes under `root` by material (and by how they cast and take shadows, and by their layers): each set becomes one mesh on the root, the
 * originals leave the tree. A mesh with an id over it (it answers a click), a see-through, transparent, instanced or moving one stays as it
 * is. Call it once the root is built, before it is drawn. Returns how many meshes were merged.
 */
export function mergeStatic(root: Object3D): number {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const sets = new Map<string, { m: Material; cast: boolean; take: boolean; meshes: Mesh[] }>();
  root.traverse((o) => {
    if (!still(o, root)) return;
    const k = `${(o.material as Material).uuid}|${o.castShadow}|${o.receiveShadow}|${o.layers.mask}`;
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
    out.layers.mask = s.meshes[0]!.layers.mask;
    out.name = 'merged';
    root.add(out);
    n += s.meshes.length;
  }
  return n;
}

// ---- the palette merge ----

/**
 * A mesh a palette mesh took in, as it was (its geometry, its material), and its matrix in the palette mesh's own frame: the palette mesh's
 * `matrixWorld` times `inMesh` puts it where it stood (`mergePalette` merges on the root, `mergeSiblings` on each parent). The light bake reads it.
 */
export interface Part { mesh: Mesh; inMesh: Matrix4 }
const partsBy = new WeakMap<Object3D, readonly Part[]>();
/** The meshes a palette mesh was merged from; none for any other object (`tools/bake/scene.ts` exports them in its place). */
export const partsOf = (o: Object3D): readonly Part[] => partsBy.get(o) ?? [];

/** The fields a palette material takes from each vertex in place of its uniforms. */
const ON_VERTEX: ReadonlySet<string> = new Set(['color', 'roughness', 'metalness']);
const PAL_VERT = 'attribute vec3 _pc;\nattribute vec2 _prm;\nflat varying vec3 vPalC;\nflat varying vec2 vPalRM;';
const PAL_FRAG = 'flat varying vec3 vPalC;\nflat varying vec2 vPalRM;';
const DIFFUSE = 'vec4 diffuseColor = vec4( diffuse, opacity );';
/**
 * Low: a palette mesh draws as the Lambert of its source does (cheapmaterials.ts), not as PBR. A PBR program lights a black plug with a
 * specular of the sun and the room (a black cord's plug turned tan, its top edge light grey); a Lambert has none. So no specular, direct or
 * from the environment, and a metal's colour is `metalColor` (mixed toward the dark metals by its metalness, copper and gold kept), then
 * its metalness is 0. The vertices still hold the source's own values; this reads them.
 */
const dark = (c: Color): string => `vec3( ${c.r.toFixed(6)}, ${c.g.toFixed(6)}, ${c.b.toFixed(6)} )`;
export const LOW_FRAG = `
vec3 lowMetal( vec3 c, float k ) {
  if ( k <= ${NON_METAL.toFixed(3)} ) return c;
  float mx = max( c.r, max( c.g, c.b ) ), mn = min( c.r, min( c.g, c.b ) ), d = mx - mn, l = 0.5 * ( mx + mn ), h = 0.0;
  float s = d < 1e-6 ? 0.0 : d / max( 1e-6, 1.0 - abs( 2.0 * l - 1.0 ) );
  if ( d > 1e-6 ) h = ( mx == c.r ? mod( ( c.g - c.b ) / d, 6.0 ) : mx == c.g ? ( c.b - c.r ) / d + 2.0 : ( c.r - c.g ) / d + 4.0 ) / 6.0;
  if ( s > 0.35 && ( h < 0.18 || h > 0.97 ) ) return c;
  float t = min( 1.0, pow( max( 1e-6, dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 1.0 / 2.2 ) );
  return mix( c, mix( ${dark(DARK_METAL[0])}, ${dark(DARK_METAL[1])}, t ), min( 1.0, k ) );
}`;
const LOW_SPEC = 'reflectedLight.directSpecular = vec3( 0.0 );\nreflectedLight.indirectSpecular = vec3( 0.0 );';
const ROUGH = ShaderChunk.roughnessmap_fragment.replace('= roughness;', '= vPalRM.x;');
const METAL = ShaderChunk.metalnessmap_fragment.replace('= metalness;', '= vPalRM.y;');

/**
 * Patches a shader to read the colour, the roughness and the metalness from the mesh's `_pc` and `_prm` (flat: each triangle keeps its
 * mesh's values exactly). Throws when three's shader no longer has a place it patches (the mesh would draw white).
 * `keep` (Low only): the part keeps its PBR look (`KEEP_SPEC`), so it takes the High patch as it is.
 */
export function palettePatch(sh: { vertexShader: string; fragmentShader: string }, low = false, keep = false): void {
  const lowPatch = low && !keep;
  const sub = (s: string, a: string, b: string) => { if (!s.includes(a)) throw new Error(`palette patch: no ${a}`); return s.replace(a, b); };
  sh.vertexShader = sub(sub(sh.vertexShader, '#include <common>', `#include <common>\n${PAL_VERT}`), '#include <begin_vertex>', '#include <begin_vertex>\nvPalC = _pc;\nvPalRM = _prm;');
  let f = sub(sh.fragmentShader, '#include <common>', `#include <common>\n${PAL_FRAG}${lowPatch ? LOW_FRAG : ''}`);
  f = sub(f, DIFFUSE, lowPatch ? 'vec4 diffuseColor = vec4( lowMetal( vPalC, vPalRM.y ), opacity );' : 'vec4 diffuseColor = vec4( vPalC, opacity );');
  f = sub(f, '#include <roughnessmap_fragment>', ROUGH);
  f = sub(f, '#include <metalnessmap_fragment>', lowPatch ? METAL.replace('= vPalRM.y;', '= 0.0;') : METAL);
  sh.fragmentShader = lowPatch ? sub(f, '#include <aomap_fragment>', `${LOW_SPEC}\n#include <aomap_fragment>`) : f;
}

/** What a palette material draws as, less the fields on the vertices (`materialKey` of its source): two with one key draw a mesh alike. */
const palKeys = new WeakMap<Material, string>();

/** A copy of `src` that reads its colour, roughness and metalness from the vertices; it keeps the source's patches. */
function paletteOf(src: MeshStandardMaterial): MeshStandardMaterial {
  const low = lowDetail(), keep = low && src.userData[KEEP_SPEC] === true, m = src.clone(), prev = src.onBeforeCompile;
  const key = `${src.customProgramCacheKey()}|pal${low ? '|low' : ''}${keep ? '|keep' : ''}`;
  m.color.setRGB(1, 1, 1);
  m.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r: WebGLRenderer) => { prev.call(src, sh, r); palettePatch(sh, low, keep); };
  m.customProgramCacheKey = () => key;
  const pk = materialKey(src, ON_VERTEX);
  if (pk !== null) palKeys.set(m, pk);
  return m;
}

/** The program inputs of a mesh's geometry: its attributes' names and formats (a merge needs them alike). Null: not one to merge. */
function attrsKey(g: BufferGeometry, omit?: ReadonlySet<string>): string | null {
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return null;
  const out: string[] = [];
  for (const k of Object.keys(g.attributes).sort()) {
    if (omit?.has(k)) continue;
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
    const src = meshes[0]!.material as MeshStandardMaterial, pal = paletteOf(src), out = paletteMesh(meshes, toRoot, pal);
    if (!out) { pal.dispose(); continue; }
    o.twin?.(src, out.material as Material);
    for (const m of meshes) { m.parent?.remove(m); gone.push(m); }
    root.add(out);
    n += meshes.length;
  }
  freeGone(root, gone, o.drop);
  return n;
}

/**
 * One mesh of `meshes` in the frame `toFrame` takes them to (unindexed, no groups), each vertex with its mesh's colour, roughness and metalness
 * (`_pc`, `_prm`), drawn with `material` (a palette material). It copies the first mesh's shadow, order, culling and layer flags, and keeps the
 * meshes it took in (`partsOf`). Null: the geometries do not merge.
 */
function paletteMesh(meshes: readonly Mesh[], toFrame: Matrix4, material: MeshStandardMaterial): Mesh | null {
  const parts = meshes.map((m) => ({ mesh: m, inMesh: new Matrix4().multiplyMatrices(toFrame, m.matrixWorld) }));
  const g = mergeGeometries(parts.map(({ mesh, inMesh }) => {
    let x = mesh.geometry.clone().applyMatrix4(inMesh);
    if (x.index) x = x.toNonIndexed();
    x.clearGroups();
    return painted(x, mesh.material as MeshStandardMaterial);
  }), false);
  if (!g) return null;
  const first = meshes[0]!, out = new Mesh(g, material);
  out.castShadow = first.castShadow; out.receiveShadow = first.receiveShadow;
  out.renderOrder = first.renderOrder; out.frustumCulled = first.frustumCulled; out.layers.mask = first.layers.mask;
  out.raycast = first.raycast;
  out.name = 'merged';
  partsBy.set(out, parts);
  return out;
}

/** Gives each vertex of `x` the material's colour, roughness and metalness (`_pc`, `_prm`: what a palette material reads). */
function painted(x: BufferGeometry, m: MeshStandardMaterial): BufferGeometry {
  const c = m.color, { roughness, metalness } = m;
  const count = x.attributes.position!.count, pc = new Float32Array(3 * count), prm = new Float32Array(2 * count);
  for (let i = 0; i < count; i++) { pc[3 * i] = c.r; pc[3 * i + 1] = c.g; pc[3 * i + 2] = c.b; prm[2 * i] = roughness; prm[2 * i + 1] = metalness; }
  x.setAttribute('_pc', new BufferAttribute(pc, 3));
  x.setAttribute('_prm', new BufferAttribute(prm, 2));
  return x;
}

/** What no mesh under `root` draws with any more leaves the GPU (its fields stay for the bake's export); `drop` hears of each material. */
function freeGone(root: Object3D, gone: readonly Mesh[], drop?: (m: Material) => void): void {
  const used = new Set<unknown>();
  root.traverse((x) => { const m = x as Mesh; if (m.isMesh) { used.add(m.geometry); for (const a of [m.material].flat()) used.add(a); } });
  for (const m of gone) {
    const mat = m.material as Material;
    if (!used.has(mat)) { used.add(mat); drop?.(mat); mat.dispose(); }
    if (!used.has(m.geometry)) { used.add(m.geometry); m.geometry.dispose(); }
  }
}

// ---- the palette merge inside each parent ----

export interface SiblingOptions {
  /** Subtrees left as they are: built again after the build (the cables), or with meshes a writer moves one by one (the side panel's screws). */
  skip?: readonly Object3D[];
  /** Subtrees that fade alone (`fadeTree`: a lid, a cooler, a spreader): a palette material is shared only inside one of them. */
  apart?: readonly Object3D[];
  /** Hears of each palette material made from a source material (the room keeps the reflections' register, as `mergePalette`'s `twin`). */
  twin?: (src: Material, copy: Material) => void;
  /** Low: a warm metal (copper, gold) merges only with warm metals, so its palette never mixes it with the grey metals and the blacks. Off at High. */
  byLook?: boolean;
}

/** The look class a Low merge keeps apart (`SiblingOptions.byLook`): a warm metal, or none. */
const lookOf = (m: Material): string => {
  const s = m as MeshStandardMaterial;
  return s.metalness > 0.5 && warmMetal(s.color) ? '|warm' : '';
};

/** May this mesh join a merge with its siblings: a plain shown mesh, one opaque material that no writer changes, nothing that code finds it by. */
function loose(m: Mesh): boolean {
  const mat = m.material as MeshStandardMaterial;
  return m.isMesh && !(m as { isInstancedMesh?: boolean }).isInstancedMesh && !(m as { isSkinnedMesh?: boolean }).isSkinnedMesh
    && !(m as { isBatchedMesh?: boolean }).isBatchedMesh && m.visible && m.name === '' && Object.keys(m.userData).length === 0
    && !Array.isArray(mat) && !!mat.isMeshStandardMaterial && stillMaterial(mat)
    && !Object.keys(m.geometry.morphAttributes).length && m.matrixWorld.determinant() > 0
    && m.onBeforeRender === Object3D.prototype.onBeforeRender && !m.customDepthMaterial && !m.customDistanceMaterial;
}

/**
 * The palette merge (`mergePalette`) inside each parent under `root`: the loose meshes (`loose`) of one parent whose materials differ only in
 * colour, roughness and metalness, with the same attributes, shadow, order, culling, layer and ray flags, become one mesh in that parent (a
 * lone one too, when its scope has others of its program). So the parent's id (a pick and its outline), its fade, its visibility and its
 * motion hold for the merged mesh as they did for each mesh. The merged meshes of one program in one scope (the nearest `userData.id`
 * ancestor, or an `apart` subtree) share one palette material. Left as they are: the root's own children (a holder lifts them one by one),
 * what is under `skip`, a mesh with a name or userData (a fan's rotor: the meshes under it still merge, as they turn with it), and a
 * material that glows, fades, has a writer (`own`) or a patch of unknown inputs. Returns how many meshes were merged.
 */
export function mergeSiblings(root: Object3D, o: SiblingOptions = {}): number {
  root.updateMatrixWorld(true);
  const skip = new Set(o.skip ?? []), apart = new Set(o.apart ?? []), ids = new Map<unknown, number>();
  const idOf = (x: unknown): number => { let n = ids.get(x); if (n === undefined) ids.set(x, (n = ids.size)); return n; };
  const sets = new Map<string, { scope: Object3D; prog: string; meshes: Mesh[] }>();
  const walk = (x: Object3D, scope: Object3D): void => {
    if (skip.has(x)) return;
    const s = typeof x.userData.id === 'string' || apart.has(x) ? x : scope, m = x as Mesh;
    if (x.parent && x.parent !== root && loose(m)) {
      const key = materialKey(m.material as Material, ON_VERTEX), attrs = attrsKey(m.geometry);
      if (key !== null && attrs !== null) {
        const prog = `${attrs}|${key}${o.byLook ? lookOf(m.material as Material) : ''}`;
        const at = `${idOf(x.parent)}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}|${m.frustumCulled}|${m.layers.mask}|${idOf(m.raycast)}|${prog}`;
        let set = sets.get(at);
        if (!set) sets.set(at, (set = { scope: s, prog, meshes: [] }));
        set.meshes.push(m);
      }
    }
    for (const c of x.children) walk(c, s);
  };
  walk(root, root);
  // (a lone mesh joins too when its scope has others of its program: it takes their palette material, one material less)
  const per = new Map<string, number>(), pals = new Map<string, MeshStandardMaterial>(), gone: Mesh[] = [], inv = new Matrix4();
  for (const { scope, prog, meshes } of sets.values()) { const k = `${idOf(scope)}|${prog}`; per.set(k, (per.get(k) ?? 0) + meshes.length); }
  let n = 0;
  for (const { scope, prog, meshes } of sets.values()) {
    const k = `${idOf(scope)}|${prog}`;
    if (per.get(k)! < 2) continue;
    const parent = meshes[0]!.parent!, pal = pals.get(k) ?? paletteOf(meshes[0]!.material as MeshStandardMaterial);
    const out = paletteMesh(meshes, inv.copy(parent.matrixWorld).invert(), pal);
    if (!out) { if (!pals.has(k)) pal.dispose(); continue; }
    if (!pals.has(k)) o.twin?.(meshes[0]!.material as Material, pal);
    pals.set(k, pal);
    for (const m of meshes) { parent.remove(m); gone.push(m); }
    parent.add(out);
    out.updateMatrixWorld(); // (it stands where its meshes stood before the next frame: a box or a ray taken now finds it there)
    n += meshes.length;
  }
  freeGone(root, gone);
  return n;
}

/**
 * `mergeSiblings` inside one group: the loose meshes of `group` and of each group under it merge by parent, as in a built model. For a prop or a
 * plug built on its own (callers use it in the Low build only). The group keeps its place under its parent.
 */
export function mergeWithin(group: Object3D, o: SiblingOptions = {}): number {
  const parent = group.parent, holder = new Object3D();
  holder.add(group);
  const n = mergeSiblings(holder, o);
  if (parent) parent.add(group); else holder.remove(group);
  return n;
}

// ---- the stand-ins for a distance (partlod.ts, docs/render/lod.md "The machine's stand-ins") ----

type Copies = Mesh & { isInstancedMesh?: boolean; count: number; instanceColor?: unknown; getMatrixAt(i: number, m: Matrix4): void };
const ON_PALETTE: ReadonlySet<string> = new Set(['_pc', '_prm']), COPY = new Matrix4();

/** Is this mesh mirrored, or a copy of this instanced mesh (its triangles would turn their backs in a merge)? The world matrices must be set. */
function mirrored(m: Copies): boolean {
  const d = m.matrixWorld.determinant();
  if (!m.isInstancedMesh) return d <= 0;
  for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, COPY); if (d * COPY.determinant() <= 0) return true; }
  return false;
}

/** How `m` joins a stand-in: the key of its set and, for a palette set, the key of its program (one palette material draws it). */
function joinOf(m: Mesh): { key: string; prog: string | null } | null {
  const x = m as Copies & { isSkinnedMesh?: boolean; isBatchedMesh?: boolean }, mat = m.material as MeshStandardMaterial;
  if (!m.isMesh || x.isSkinnedMesh || x.isBatchedMesh || Array.isArray(mat) || mat.transparent || mat.opacity !== 1 || !mat.visible) return null;
  if (x.isInstancedMesh && (x.count < 1 || x.instanceColor)) return null;
  if (Object.keys(m.geometry.morphAttributes).length || m.onBeforeRender !== Object3D.prototype.onBeforeRender || m.customDepthMaterial || m.customDistanceMaterial || mirrored(x)) return null;
  const pal = palKeys.get(mat) ?? (mat.isMeshStandardMaterial && stillMaterial(mat) ? materialKey(mat, ON_VERTEX) : null);
  const attrs = attrsKey(m.geometry, pal === null ? undefined : ON_PALETTE), flags = `${m.castShadow}|${m.receiveShadow}|${m.renderOrder}|${m.layers.mask}`;
  if (attrs === null) return null;
  return pal === null ? { key: `mat:${mat.uuid}|${attrs}|${flags}`, prog: null } : { key: `pal:${attrs}|${pal}|${flags}`, prog: `${attrs}|${pal}` };
}

/**
 * The set a mesh joins in a stand-in (`standIns`), or null: it stays out. A still material (and a palette mesh) joins the meshes of its
 * program (`pal:`): their colours, roughness and metalness go on the vertices. A material that carries state (a skin, a ring, an LED: `own`,
 * or it glows) joins only the meshes of that same material object (`mat:`), so the stand-in shows the state as they do. Each set has one
 * attribute layout, one pair of shadow flags, one order and one layer mask. Out: a see-through or multi-material mesh, a skinned, batched,
 * morphed or mirrored one, one with a draw hook or instance colours. The world matrices must be set.
 */
export const standInKey = (m: Mesh): string | null => joinOf(m)?.key ?? null;

/** The triangles of `m` in the frame `toFrame` takes the world to (unindexed, no groups): one geometry, or one per copy of an instanced mesh. */
function copiesOf(m: Mesh, toFrame: Matrix4, palette: boolean): BufferGeometry[] {
  const base = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(), x = m as Copies;
  base.clearGroups();
  if (palette && !base.attributes._pc) painted(base, m.material as MeshStandardMaterial);
  const inFrame = new Matrix4().multiplyMatrices(toFrame, m.matrixWorld);
  if (!x.isInstancedMesh) return [base.applyMatrix4(inFrame)];
  const out: BufferGeometry[] = [];
  for (let i = 0; i < x.count; i++) { x.getMatrixAt(i, COPY); out.push(base.clone().applyMatrix4(COPY.premultiply(inFrame))); }
  return out;
}

/** A stand-in: one mesh that draws in the place of its meshes. */
export interface StandIn { mesh: Mesh; sources: Mesh[] }

/**
 * The stand-ins of `meshes` for a distance: each set of two or more (`standInKey`) as one mesh under `frame`, in its space, with the same
 * triangles, so it draws, casts and takes shadows as they do. The meshes stay in the tree as they are: the caller stops their draw
 * (`PartLod`), and they still answer the rays and the outline. A stand-in answers no ray. A stand-in of a material with state draws with
 * that same material object. A palette set draws with the palette material of its first palette mesh, else with one of `pals` (by program;
 * made here when missing: the caller keeps the map over the rebuilds and disposes its materials). An instanced mesh joins copy by copy.
 */
export function standIns(frame: Object3D, meshes: readonly Mesh[], pals: Map<string, MeshStandardMaterial> = new Map()): StandIn[] {
  frame.updateWorldMatrix(true, true);
  const toFrame = frame.matrixWorld.clone().invert(), sets = new Map<string, { prog: string | null; sources: Mesh[] }>();
  for (const m of meshes) {
    const j = joinOf(m);
    if (!j) continue;
    let set = sets.get(j.key);
    if (!set) sets.set(j.key, (set = { prog: j.prog, sources: [] }));
    set.sources.push(m);
  }
  const out: StandIn[] = [];
  for (const { prog, sources } of sets.values()) {
    if (sources.length < 2) continue;
    const g = mergeGeometries(sources.flatMap((m) => copiesOf(m, toFrame, prog !== null)), false);
    if (!g) continue;
    const first = sources[0]!;
    let material = first.material as MeshStandardMaterial;
    if (prog !== null) {
      const has = sources.find((m) => palKeys.has(m.material as Material));
      if (has) material = has.material as MeshStandardMaterial;
      else { material = pals.get(prog) ?? paletteOf(material); pals.set(prog, material); }
    }
    const mesh = new Mesh(g, material);
    mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.renderOrder = first.renderOrder;
    mesh.layers.mask = first.layers.mask;
    mesh.raycast = () => {};
    mesh.name = 'standin';
    mesh.userData.standIn = true;
    frame.add(mesh);
    mesh.updateMatrixWorld();
    out.push({ mesh, sources });
  }
  return out;
}
