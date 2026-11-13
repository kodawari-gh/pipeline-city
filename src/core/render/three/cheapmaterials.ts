// The Low tier's cheaper material model: a Lambert program (no specular, no PBR maps) for the room's standard materials.
import { Material, MeshLambertMaterial, type Mesh, type MeshStandardMaterial, type Object3D, type Side } from 'three';

type Std = MeshStandardMaterial & { isMeshStandardMaterial: true };
const STRIPPED = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap'] as const;
type Stripped = (typeof STRIPPED)[number];

const isStandard = (m: Material): m is Std => (m as Std).isMeshStandardMaterial === true;
const isPatched = (m: Material): boolean => m.onBeforeCompile !== Material.prototype.onBeforeCompile;

/**
 * The values a Lambert reads live from its source (no copy, no frame work). A write through the Lambert lands on the source, so a fade
 * (`fadeTree`) or a glow cap (`glowOnly`) reaches the material the game owns. `transparent` is among them: `sync` sees its change.
 */
const LIVE = ['emissiveIntensity', 'opacity', 'visible', 'depthWrite', 'map', 'emissiveMap', 'transparent'] as const;

/**
 * A Lambert with the look of `m`. Its colors are the source's own Color objects, and its live values are accessors on the source (see `LIVE`).
 * Only the program-level state (see `sync`) is copied.
 */
function lambertOf(m: Std): MeshLambertMaterial {
  const l = new MeshLambertMaterial({
    color: m.color, emissive: m.emissive, vertexColors: m.vertexColors, transparent: m.transparent, side: m.side, alphaTest: m.alphaTest,
  });
  l.color = m.color;
  l.emissive = m.emissive;
  const src = m as unknown as Record<string, unknown>;
  for (const k of LIVE) Object.defineProperty(l, k, { configurable: true, enumerable: true, get: () => src[k], set(v: unknown) { src[k] = v; } });
  l.userData = m.userData;
  l.name = m.name;
  return l;
}

/** What a Lambert's program depends on, as its source has it: `sync` compares it with the last one it saw. */
type Prog = { transparent: boolean; side: Side; alpha: boolean; map: boolean; emap: boolean };
const progOf = (s: Std): Prog => ({ transparent: s.transparent, side: s.side, alpha: s.alphaTest > 0, map: !!s.map, emap: !!s.emissiveMap });

/** Is `o` `root` or under it? */
const under = (o: Object3D, root: Object3D): boolean => { for (let p: Object3D | null = o; p; p = p.parent) if (p === root) return true; return false; };

/**
 * Swap `root`'s standard materials for cheaper ones, and return the function that undoes it (originals and maps back).
 * - A plain standard material (no `onBeforeCompile`, no light map) becomes a Lambert, one per source material.
 * - A patched one keeps its program, and loses its normal, roughness, metalness, ao and bump maps.
 * - Basic, shader and other materials stay. A mesh with `userData.standIn` is skipped.
 * Call `sync` after a rebuild of the root adds or removes meshes: what is already cheap is not touched twice.
 */
export function cheapMaterials(root: Object3D): { sync(): void; undo(): void } {
  const swaps: { mesh: Mesh; index: number | null; from: Material }[] = [];
  const stripped = new Map<Std, Partial<Record<Stripped, unknown>>>();
  const made = new Map<Std, MeshLambertMaterial>();
  const prog = new Map<Std, Prog>();
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
    if (!l) { made.set(m, l = lambertOf(m)); prog.set(m, progOf(m)); }
    return l;
  };
  // Swap what `root` holds that is still standard. A cheap mesh is a Lambert now, so it comes back as it is and is not swapped twice.
  const swapAll = () => root.traverse((o) => {
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
  swapAll();
  return {
    /**
     * Pick up what a rebuild added under `root` and forget what it removed (their Lamberts go, unless another mesh still uses the source).
     * Then copy the program-level state (transparent, side, alphaTest, map presence) onto the Lambert copies, and ask for a new program when
     * one of them changed. Call it when the tier changes or a rebuild changes the root, not per frame: the live values need no sync (see `lambertOf`).
     */
    sync() {
      for (let i = swaps.length - 1; i >= 0; i--) if (!under(swaps[i]!.mesh, root)) swaps.splice(i, 1);
      const used = new Set(swaps.map((s) => s.from));
      for (const [s, l] of made) if (!used.has(s)) { l.dispose(); made.delete(s); prog.delete(s); }
      swapAll();
      for (const [s, l] of made) {
        const p = prog.get(s)!, now = progOf(s);
        // (these change the program or the sorting: a new compile)
        const dirty = p.transparent !== now.transparent || p.side !== now.side || p.alpha !== now.alpha || p.map !== now.map || p.emap !== now.emap;
        prog.set(s, now);
        l.side = s.side;
        l.alphaTest = s.alphaTest;
        if (dirty) l.needsUpdate = true;
      }
    },
    undo() {
      for (const { mesh, index, from } of swaps) {
        if (index === null) mesh.material = from; else (mesh.material as Material[])[index] = from;
      }
      for (const [m, was] of stripped) { Object.assign(m, was); m.needsUpdate = true; }
      for (const l of made.values()) l.dispose();
      swaps.length = 0; stripped.clear(); made.clear(); prog.clear();
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
