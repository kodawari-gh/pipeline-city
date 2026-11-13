// The Low tier's cheaper material model: a Lambert program (no specular, no PBR maps) for the room's standard materials.
import { Material, MeshLambertMaterial, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';

type Std = MeshStandardMaterial & { isMeshStandardMaterial: true };
const STRIPPED = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap'] as const;
type Stripped = (typeof STRIPPED)[number];

const isStandard = (m: Material): m is Std => (m as Std).isMeshStandardMaterial === true;
const isPatched = (m: Material): boolean => m.onBeforeCompile !== Material.prototype.onBeforeCompile;

/** A Lambert with the look of `m`: its color, maps, emissive, and the state that shows (side, blending flags, alpha). */
function lambertOf(m: Std): MeshLambertMaterial {
  const l = new MeshLambertMaterial({
    color: m.color, map: m.map, emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity,
    vertexColors: m.vertexColors, transparent: m.transparent, opacity: m.opacity, side: m.side, depthWrite: m.depthWrite,
    alphaTest: m.alphaTest,
  });
  l.visible = m.visible;
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
  const from: Std[] = [], to: MeshLambertMaterial[] = [];
  for (const [m, l] of made) { from.push(m as Std); to.push(l); }
  return {
    /** Copy the source materials' live values (the game writes to those) onto the Lambert copies. Plain loops, no allocation. */
    sync() {
      for (let i = 0; i < from.length; i++) {
        const s = from[i]!, l = to[i]!;
        l.color.copy(s.color);
        l.emissive.copy(s.emissive);
        l.emissiveIntensity = s.emissiveIntensity;
        l.opacity = s.opacity;
        l.visible = s.visible;
        l.depthWrite = s.depthWrite;
        // (these change the program or the sorting: a new compile)
        const dirty = l.transparent !== s.transparent || l.side !== s.side || (l.alphaTest > 0) !== (s.alphaTest > 0)
          || !l.map !== !s.map || !l.emissiveMap !== !s.emissiveMap;
        l.transparent = s.transparent;
        l.side = s.side;
        l.alphaTest = s.alphaTest;
        l.map = s.map;
        l.emissiveMap = s.emissiveMap;
        if (dirty) l.needsUpdate = true;
      }
    },
    undo() {
      for (const { mesh, index, from } of swaps) {
        if (index === null) mesh.material = from; else (mesh.material as Material[])[index] = from;
      }
      for (const [m, was] of stripped) { Object.assign(m, was); m.needsUpdate = true; }
      for (const l of made.values()) l.dispose();
      swaps.length = 0; stripped.clear(); made.clear(); from.length = to.length = 0;
    },
  };
}

export type Cheap = ReturnType<typeof cheapMaterials>;

/** Does the probe want a capture this frame? Low takes the first one (an env to light with) and asks for no more; the env it has stays. */
export function probeWanted(o: { low: boolean; probed: boolean; busy: boolean; bounces: number; keyChanged: boolean; waited: boolean }): boolean {
  if (o.busy) return false;
  if (o.low && o.probed) return false;
  return o.bounces > 0 || (o.keyChanged && o.waited);
}
