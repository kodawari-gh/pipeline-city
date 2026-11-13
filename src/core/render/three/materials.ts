// Palette and state looks of the 3D parts (docs/3D_STYLE.md). `partLook` is pure: a part's state in, the colour factor and glow out.
// `shareMaterials` lets equal materials of a built tree become one (fewer uniform uploads per frame); `own` keeps a writer's material out of it.
import {
  Color, Material, MeshPhysicalMaterial, MeshStandardMaterial,
  type Mesh, type MeshPhysicalMaterialParameters, type MeshStandardMaterialParameters, type Object3D,
} from 'three';

export const GLOW = { active: 0x3be3ff, throttled: 0xffc247, burnt: 0xff5a78, hot: 0xff5a30 } as const;
/** Above this temperature a part starts to glow (3D_STYLE.md "Overheating"). */
export const HOT_FROM_C = 42, HOT_FULL_C = 82;

export interface PartState { powered: boolean; active: boolean; burnt: boolean; throttled: boolean; tempC: number }
export interface PartLook { /** Multiplies the base colour. */ tint: number; glow: number; glowIntensity: number }

/** Mix two `0xrrggbb` colours, `t` of the way from `a` to `b`. */
export const lerpHex = (a: number, b: number, t: number): number => {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** Cyan, then amber, then red as `t` goes 0 to 1. */
export const heatColor = (t: number): number => (t < 0.5 ? lerpHex(GLOW.active, GLOW.throttled, t * 2) : lerpHex(GLOW.throttled, GLOW.burnt, (t - 0.5) * 2));

export function partLook(s: PartState): PartLook {
  if (s.burnt) return { tint: 0.3, glow: GLOW.burnt, glowIntensity: 0.8 };
  if (!s.powered) return { tint: 0.5, glow: 0, glowIntensity: 0 };
  if (s.tempC > HOT_FROM_C) {
    const t = Math.min(1, (s.tempC - HOT_FROM_C) / (HOT_FULL_C - HOT_FROM_C));
    return { tint: s.throttled ? 0.8 : 1, glow: heatColor(t), glowIntensity: 0.2 + t * 0.4 };
  }
  if (s.throttled) return { tint: 0.8, glow: GLOW.throttled, glowIntensity: 0.2 };
  if (s.active) return { tint: 1, glow: GLOW.active, glowIntensity: 0.4 };
  return { tint: 1, glow: 0, glowIntensity: 0 };
}

export const mat = (color: number, o: MeshStandardMaterialParameters = {}): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.65, ...o });

/** Cloth (linen, wool, velvet): matte, with the soft sheen a weave catches at a grazing look, which roughness alone cannot give. */
export const cloth = (color: number, o: MeshPhysicalMaterialParameters = {}): MeshPhysicalMaterial =>
  new MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.92, sheen: 1, sheenRoughness: 0.6, sheenColor: 0x5a5650, ...o });

/** Varnished wood or lacquer: the base as `mat` under a thin clear coat that mirrors the window and the lamps. */
export const varnish = (color: number, o: MeshPhysicalMaterialParameters = {}): MeshPhysicalMaterial =>
  new MeshPhysicalMaterial({ color, metalness: 0.05, roughness: 0.6, clearcoat: 0.55, clearcoatRoughness: 0.2, ...o });

/**
 * The materials of one part that follow its state, each eased toward the current look. `gain` scales the glow: a part with wide faces (a card's
 * shroud, a stick's spreader) glows softer, or the state's colour would cover its own.
 */
export class PartSkin {
  private base: Color[];
  private tint = 1;
  private glow = new Color(0);
  private level = 0;
  private goal: PartLook = { tint: 1, glow: 0, glowIntensity: 0 };
  private goalGlow = new Color(0);

  constructor(readonly mats: MeshStandardMaterial[], private gain = 1) { this.base = mats.map((m) => own(m).color.clone()); }

  set(state: PartState): void {
    this.goal = partLook(state);
    this.goalGlow.setHex(this.goal.glow);
  }

  /** Still on its way to the state's look (a frame drawn on demand, docs/render/load.md, keeps drawing meanwhile). */
  get easing(): boolean {
    const g = this.glow, w = this.goalGlow;
    return Math.abs(this.goal.tint - this.tint) > 1e-3 || Math.abs(this.goal.glowIntensity - this.level) > 1e-3
      || (this.goal.glowIntensity > 0 && Math.abs(g.r - w.r) + Math.abs(g.g - w.g) + Math.abs(g.b - w.b) > 1e-3);
  }

  /** Ease over about half a second (3D_STYLE.md "State Transitions"). */
  frame(dt: number): void {
    const t = 1 - Math.pow(0.002, dt);
    this.tint += (this.goal.tint - this.tint) * t;
    this.level += (this.goal.glowIntensity - this.level) * t;
    if (this.goal.glowIntensity > 0) this.glow.lerp(this.goalGlow, t);
    this.mats.forEach((m, i) => {
      m.color.copy(this.base[i]!).multiplyScalar(this.tint);
      m.emissive.copy(this.glow);
      m.emissiveIntensity = this.level * this.gain;
    });
  }
}

// ---- shared materials (docs/GRAPHICS_3D_OVERHAUL.md "Shared materials") ----

/** Materials a writer changes for its own meshes after the build: never shared, never replaced. */
const owned = new WeakSet<Material>();

/** Marks `m` as one a writer changes for its own meshes (a part's state look): `shareMaterials` leaves it as it is. */
export function own<T extends Material>(m: T): T {
  owned.add(m);
  return m;
}

// the program key of a material with no patch; the patches a shared material may carry (`boxenv`, `bakedao`, `lightmapmix`): each reads only
// uniforms the whole room shares or its mesh's own attributes. Another patch may hold uniforms of its own (`artlod`): no share.
const plain = (): string => Material.prototype.onBeforeCompile.toString();
const PURE = /^(\|box|\|lm|\|ao[\d.e-]+)*$/;
// the fields that do not change the picture or the program (`userData` is keyed whole, the two hooks by the program key)
const SKIP = new Set(['uuid', 'id', 'name', 'version', 'userData', '_listeners', 'onBeforeCompile', 'customProgramCacheKey']);
const ids = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object): number => { let n = ids.get(o); if (n === undefined) ids.set(o, (n = ++nextId)); return n; };

// (no JSON.stringify: a texture's `toJSON` would read its whole picture)
function ser(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v !== 'object') return String(v);
  const x = v as { isColor?: boolean; isVector2?: boolean; isVector3?: boolean; isVector4?: boolean; isEuler?: boolean };
  if (x.isColor) { const c = v as Color; return `c${c.r},${c.g},${c.b}`; }
  if (x.isVector2 || x.isVector3 || x.isVector4 || x.isEuler) return `v${(v as { toArray(): unknown[] }).toArray().join(',')}`;
  if (depth < 8 && Array.isArray(v)) return `[${v.map((e) => ser(e, depth + 1)).join(',')}]`;
  const proto = Object.getPrototypeOf(v) as unknown;
  if (depth < 8 && (proto === Object.prototype || proto === null)) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${ser(o[k], depth + 1)}`).join(',')}}`;
  }
  // a texture, a clipping plane: the same object or none
  return `#${idOf(v)}`;
}

/**
 * What a standard (or physical) material draws as: its type, every field that changes the picture or the program (colours, roughness, maps by
 * identity, defines, sides, blending, polygon offset, clipping...), its `userData` and its program key. Two materials with the same key draw the
 * same. Null: not one to share (not standard, a patch of unknown inputs, a hook of its own). `omit`: fields left out of the key (a palette
 * merge keeps each mesh's colour, roughness and metalness on its vertices, `merge.ts`).
 */
export function materialKey(m: Material, omit?: ReadonlySet<string>): string | null {
  if (!(m as MeshStandardMaterial).isMeshStandardMaterial) return null;
  const pk = m.customProgramCacheKey(), base = plain();
  if (!pk.startsWith(base) || !PURE.test(pk.slice(base.length))) return null;
  const out = [m.type, `pk=${pk.slice(base.length)}`, `ud=${ser(m.userData)}`];
  for (const k of Object.keys(m).sort()) {
    if (SKIP.has(k) || omit?.has(k)) continue;
    const v = (m as unknown as Record<string, unknown>)[k];
    if (typeof v === 'function') return null;
    out.push(`${k}=${ser(v)}`);
  }
  return out.join(';');
}

/** A material no writer is known to change: not `own`, not see-through (fades), not glowing (each lamp and light sets its own glow). */
export function stillMaterial(m: Material): boolean {
  const s = m as MeshStandardMaterial;
  return !owned.has(m) && !m.transparent && m.opacity === 1 && s.emissive.r + s.emissive.g + s.emissive.b === 0;
}

// a mesh's inputs to the program that three does not check on each draw (its attributes, its kind): a shared material keeps one program
const kind = (o: Mesh): string => {
  const g = o.geometry, i = o as Mesh & { instanceColor?: unknown; morphTexture?: unknown };
  return `${o.type}|${Object.keys(g.attributes).sort().join(',')}|${Object.keys(g.morphAttributes).sort().join(',')}|${!!i.instanceColor}|${!!i.morphTexture}`;
};

export interface ShareOptions {
  /** Subtrees left as they are: built again or written after the build (the key rack). Their materials are not shared outside them either. */
  skip?: readonly Object3D[];
  /** Subtrees that fade alone (`fadeTree`: a lid, a cooler, a spreader): each is a scope of its own, so a fade changes nothing outside it. */
  apart?: readonly Object3D[];
  /** Hears of each material replaced by an equal one before it is disposed (the room's reflections drop it). */
  onReplace?: (old: Material, canon: Material) => void;
}

/** The standard materials under the root before and after a share. */
export interface Shared { before: number; after: number }

/**
 * Shares equal materials under `root`: of the materials with the same `materialKey`, used in the same scope (the nearest ancestor tagged with
 * a `userData.id`, which a rebuild disposes and a hover outlines as a whole, or an `apart` subtree) by the same kind of mesh, every mesh takes
 * the first and the others are disposed. Fewer materials draw with fewer uniform uploads (each change of material uploads its uniforms and its
 * lights' state). Left as they are: a material a writer changes (`own`, `PartSkin`, a glow, a fade), one of unknown inputs, one used across
 * scopes or kinds of mesh or by more than a plain mesh, and everything under `skip`. A writer that must change a mesh's material marks it `own`
 * before the share.
 */
export function shareMaterials(root: Object3D, o: ShareOptions = {}): Shared {
  interface Use { scope: Object3D | null; kind: string | null; meshes: Mesh[]; fixed: boolean }
  const uses = new Map<Material, Use>(), skip = new Set(o.skip ?? []), apart = new Set(o.apart ?? []);
  const use = (m: Material): Use => { let u = uses.get(m); if (!u) uses.set(m, (u = { scope: null, kind: null, meshes: [], fixed: false })); return u; };
  const walk = (x: Object3D, scope: Object3D, fixed: boolean): void => {
    const f = fixed || skip.has(x), s = typeof x.userData.id === 'string' || apart.has(x) ? x : scope, mesh = x as Mesh;
    const m = (x as { material?: Material | Material[] }).material;
    if (m) {
      for (const a of Array.isArray(m) ? m : [m]) {
        const u = use(a);
        if (f || Array.isArray(m) || !mesh.isMesh) { u.fixed = true; continue; }
        const k = kind(mesh);
        if (u.meshes.length && (u.scope !== s || u.kind !== k)) u.fixed = true;
        u.scope = s; u.kind = k;
        u.meshes.push(mesh);
      }
    }
    for (const c of x.children) walk(c, s, f);
  };
  walk(root, root, false);
  const canon = new Map<string, Material>();
  let before = 0, after = 0;
  for (const [m, u] of uses) {
    if (!(m as MeshStandardMaterial).isMeshStandardMaterial) continue;
    before++;
    const key = u.fixed || !stillMaterial(m) ? null : materialKey(m);
    if (key === null) { after++; continue; }
    const at = `${idOf(u.scope!)}|${u.kind}|${key}`, c = canon.get(at);
    if (!c) { canon.set(at, m); after++; continue; }
    for (const mesh of u.meshes) mesh.material = c;
    o.onReplace?.(m, c);
    m.dispose();
  }
  return { before, after };
}
