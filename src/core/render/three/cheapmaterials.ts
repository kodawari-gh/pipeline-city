// The Low tier's cheaper material model: a Lambert program (no specular, no PBR maps) for the room's standard materials.
import { Material, MeshLambertMaterial, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';

type Std = MeshStandardMaterial & { isMeshStandardMaterial: true };
const STRIPPED = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap'] as const;
type Stripped = (typeof STRIPPED)[number];

const isStandard = (m: Material): m is Std => (m as Std).isMeshStandardMaterial === true;
const isPatched = (m: Material): boolean => m.onBeforeCompile !== Material.prototype.onBeforeCompile;

/** The values a Lambert reads live from its source (no copy, no frame work). */
const LIVE = ['emissiveIntensity', 'opacity', 'visible', 'depthWrite', 'map', 'emissiveMap'] as const;

/**
 * A Lambert with the look of `m`. Its colors are the source's own Color objects, and its live values are getters on the source: a write to `m`
 * shows on the Lambert at once. Only the program-level state (see `sync`) is copied.
 */
function lambertOf(m: Std): MeshLambertMaterial {
  const l = new MeshLambertMaterial({
    color: m.color, emissive: m.emissive, vertexColors: m.vertexColors, transparent: m.transparent, side: m.side, alphaTest: m.alphaTest,
  });
  l.color = m.color;
  l.emissive = m.emissive;
  for (const k of LIVE) Object.defineProperty(l, k, { configurable: true, enumerable: true, get: () => m[k], set() { /* the source owns it */ } });
  l.userData = m.userData;
  l.name = m.name;
  return l;
}

/**
 * Swap `root`'s standard materials for cheaper ones, and return the function that undoes it (originals and maps back).
 * - A plain standard material (no `onBeforeCompile`, no light map) becomes a Lambert, one per source material.
 * - A patched one keeps its program, and loses its normal, roughness, metalness, ao and bump maps.
 * - Basic, shader and other materials stay. A mesh with `userData.standIn` is skipped.
 * Call it again after a rebuild adds meshes: what is already cheap is not touched twice.
 */
export function cheapMaterials(root: Object3D): { sync(): void; undo(): void } {
  const swaps: { mesh: Mesh; index: number | null; from: Material }[] = [];
  const stripped = new Map<Std, Partial<Record<Stripped, unknown>>>();
  const made = new Map<Material, MeshLambertMaterial>();
  const cheap = (m: Material): Material => {
    if (!isStandard(m)) return m;
    if (isPatched(m) || m.lightMap) {
      if (!stripped.has(m)) {
        const was: Partial<Record<Stripped, unknown>> = {};
        let any = false;
        for (const k of STRIPPED) if (m[k]) { was[k] = m[k]; (m as unknown as Record<string, unknown>)[k] = null; any = true; }
        if (any) { stripped.set(m, was); m.needsUpdate = true; }
      }
      return m;
    }
    let l = made.get(m);
    if (!l) made.set(m, l = lambertOf(m));
    return l;
  };
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.userData.standIn) return;
    if (Array.isArray(mesh.material)) {
      const list = mesh.material;
      list.forEach((m, i) => { const c = cheap(m); if (c !== m) { swaps.push({ mesh, index: i, from: m }); list[i] = c; } });
    } else {
      const c = cheap(mesh.material);
      if (c !== mesh.material) { swaps.push({ mesh, index: null, from: mesh.material }); mesh.material = c; }
    }
  });
  const from: Std[] = [], to: MeshLambertMaterial[] = [], prog: { map: boolean; emap: boolean }[] = [];
  for (const [m, l] of made) { const s = m as Std; from.push(s); to.push(l); prog.push({ map: !!s.map, emap: !!s.emissiveMap }); }
  return {
    /**
     * Copy the program-level state (transparent, side, alphaTest, map presence) onto the Lambert copies, and ask for a new program when one of
     * them changed. Call it when the tier changes or a root is cheapened, not per frame: the live values need no sync (see `lambertOf`).
     */
    sync() {
      for (let i = 0; i < from.length; i++) {
        const s = from[i]!, l = to[i]!, p = prog[i]!;
        const map = !!s.map, emap = !!s.emissiveMap;
        // (these change the program or the sorting: a new compile)
        const dirty = l.transparent !== s.transparent || l.side !== s.side || (l.alphaTest > 0) !== (s.alphaTest > 0) || p.map !== map || p.emap !== emap;
        l.transparent = s.transparent;
        l.side = s.side;
        l.alphaTest = s.alphaTest;
        p.map = map;
        p.emap = emap;
        if (dirty) l.needsUpdate = true;
      }
    },
    undo() {
      for (const { mesh, index, from } of swaps) {
        if (index === null) mesh.material = from; else (mesh.material as Material[])[index] = from;
      }
      for (const [m, was] of stripped) { Object.assign(m, was); m.needsUpdate = true; }
      for (const l of made.values()) l.dispose();
      swaps.length = 0; stripped.clear(); made.clear(); from.length = to.length = prog.length = 0;
    },
  };
}

export type Cheap = ReturnType<typeof cheapMaterials>;

/**
 * What the probe does this frame: whether it takes a capture, and the bounces left. Low takes its first capture (an env to light with) and asks
 * for no more: once `probed`, its bounces are 0 whatever the frame is. Else a capture is wanted while bounces are left, or the light changed.
 */
export function probePlan(o: { low: boolean; probed: boolean; busy: boolean; bounces: number; keyChanged: boolean; waited: boolean }): { request: boolean; bounces: number } {
  if (o.low && o.probed) return { request: false, bounces: 0 };
  if (o.busy) return { request: false, bounces: o.bounces };
  const request = o.bounces > 0 || (o.keyChanged && o.waited);
  return { request, bounces: request ? Math.max(0, o.bounces - 1) : o.bounces };
}
