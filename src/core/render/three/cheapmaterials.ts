// The Low tier's cheaper material model: a Lambert program (no specular, no PBR maps) for the room's standard materials.
import { Color, Material, MeshLambertMaterial, type Mesh, type MeshStandardMaterial, type Object3D, type Side } from 'three';

type Std = MeshStandardMaterial & { isMeshStandardMaterial: true };
const STRIPPED = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap'] as const;
type Stripped = (typeof STRIPPED)[number];

const isStandard = (m: Material): m is Std => (m as Std).isMeshStandardMaterial === true;
const isPatched = (m: Material): boolean => m.onBeforeCompile !== Material.prototype.onBeforeCompile;

/**
 * The values a Lambert reads live from its source (no copy, no frame work). A write through the Lambert lands on the source, so a fade
 * (`fadeTree`) or a glow cap (`glowOnly`) reaches the material the game owns. `transparent` is among them: `sync` sees its change.
 */
const LIVE = [
  'emissiveIntensity', 'opacity', 'visible', 'depthWrite', 'map', 'emissiveMap', 'transparent',
  // (a decal or a label draws over the surface under it by its offset: a Lambert without it tears against that surface)
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
] as const;

/** A source at or under this metalness is paint or plastic: its Lambert keeps the source's own Color object. */
export const NON_METAL = 0.1;
/** The dark metal a metal's Lambert reads toward, from the darkest to the lightest (by the source's own lightness). */
export const DARK_METAL = [new Color(0x2a2d32), new Color(0x4e5360)] as const;
const HSL = { h: 0, s: 0, l: 0 };

/**
 * Is `c` a warm, saturated metal (copper, brass, gold)? Its colour is the metal's own, as seen in its reflections: a Lambert keeps it, where it
 * would turn a grey metal dark.
 */
export const warmMetal = (c: Color): boolean => { c.getHSL(HSL); return HSL.s > 0.35 && (HSL.h < 0.18 || HSL.h > 0.97); };

/**
 * What a Lambert of a metal reads as its colour: `src` mixed toward the dark metal range by `metalness`, as a metal has no diffuse of its own and
 * its look is the reflection that a Lambert cannot draw. The source's colour is not changed (High draws with it). Copper and gold keep theirs.
 */
export function metalColor(src: Color, metalness: number, out: Color = new Color()): Color {
  const k = Math.min(1, Math.max(0, metalness));
  out.copy(src);
  if (k <= 0 || warmMetal(src)) return out;
  const t = Math.min(1, Math.pow(0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b, 1 / 2.2));
  return out.lerp(new Color().copy(DARK_METAL[0]).lerp(DARK_METAL[1], t), k);
}

/**
 * A Color that reads `m`'s colour mixed by its metalness (`metalColor`) on each read, so a writer that tints the source (a part's state look)
 * still reaches the Lambert with no sync. A write to one channel lands on the source.
 */
function metalLive(m: Std): Color {
  const c = new Color(), seen = [NaN, NaN, NaN, NaN], mix = new Color();
  const fresh = (): Color => {
    const s = m.color, k = m.metalness;
    if (s.r !== seen[0] || s.g !== seen[1] || s.b !== seen[2] || k !== seen[3]) { seen[0] = s.r; seen[1] = s.g; seen[2] = s.b; seen[3] = k; metalColor(s, k, mix); }
    return mix;
  };
  for (const ch of ['r', 'g', 'b'] as const) Object.defineProperty(c, ch, { configurable: true, enumerable: true, get: () => fresh()[ch], set(v: number) { m.color[ch] = v; } });
  return c;
}

/**
 * A Lambert with the look of `m`. Its colors are the source's own Color objects (a metal's is read from the source's through `metalLive`), and its
 * live values are accessors on the source (see `LIVE`). Only the program-level state (see `sync`) is copied.
 */
function lambertOf(m: Std): MeshLambertMaterial {
  const color = m.metalness > NON_METAL ? metalLive(m) : m.color;
  const l = new MeshLambertMaterial({
    color, emissive: m.emissive, vertexColors: m.vertexColors, transparent: m.transparent, side: m.side, alphaTest: m.alphaTest,
  });
  l.color = color;
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
