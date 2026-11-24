// Palette and state looks of the 3D parts (docs/3D_STYLE.md). `partLook` is pure: a part's state in, the colour factor and glow out.
// `shareMaterials` lets equal materials of a built tree become one (fewer uniform uploads per frame); `own` keeps a writer's material out of it.
import {
  Color,
  Material,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Mesh,
  type MeshPhysicalMaterialParameters,
  type MeshStandardMaterialParameters,
  type Object3D,
} from 'three';
import { hubHex, POWER_LIFT, powerHex, sourceHex, WARN, type Role } from './powerscale';
import { thermalHex } from './thermal';

export const GLOW = { burnt: 0xff5a78 } as const;

/** What a part's own look follows: whether it has power, and whether it burnt. A part that runs, runs hot or throttles looks as it always does (the lenses show those). */
export interface PartState {
  powered: boolean;
  burnt: boolean;
}
export interface PartLook {
  /** Multiplies the base colour. */ tint: number;
  glow: number;
  glowIntensity: number;
}

/** Mix two `0xrrggbb` colours, `t` of the way from `a` to `b`. */
export const lerpHex = (a: number, b: number, t: number): number => {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

export function partLook(s: PartState): PartLook {
  if (s.burnt) return { tint: 0.3, glow: GLOW.burnt, glowIntensity: 0.8 };
  if (!s.powered) return { tint: 0.5, glow: 0, glowIntensity: 0 };
  return { tint: 1, glow: 0, glowIntensity: 0 };
}

/** The base colours of the asset standard (docs/3D_STYLE.md "Asset standard" §1): darks, satins, PCB masks, gold, copper. */
export const FAMILY: readonly number[] = [
  0x050608, 0x131518, 0x1d1e22, 0x2a2d32, 0x4e5360, 0x959aa3, 0xb9babf, 0x16294d, 0x173d29, 0xd4af5f, 0xc0793a,
];
/**
 * Two real materials outside the families (docs/3D_STYLE.md "Asset standard" §1): natural nylon and PTFE (a standoff, a tie, a label's
 * base, a white plastic shell), and the ceramic of a chip capacitor.
 */
export const NYLON = 0xd6d1c2,
  CERAMIC = 0x9a7a52;
/** The edge of a PCB's laminate: glass-epoxy seen side-on (docs/3D_STYLE.md §1). */
export const LAMINATE = 0x45443a;
/** A colour nearer than this to a family colour (sum of the channel differences) is that family colour: the eye sees no difference. */
export const FAMILY_SNAP = 30;
// the first 7 family colours are the grey ladder; a grey is a colour of at most this chroma, no warmer than neutral, no lighter than this
const GREYS = 7,
  GREY_CHROMA = 28,
  GREY_TOP = 0xd8;
const GOLD = 0xd4af5f,
  GOLD_SNAP = 60;
const snapped = new Map<number, number>();

/** `color`, or the family colour it nearly is (ASR9): near-duplicates of one tone become one tone. */
export function familyHex(color: number): number {
  let out = snapped.get(color);
  if (out !== undefined) return out;
  out = color;
  const r = color >> 16,
    g = (color >> 8) & 255,
    b = color & 255,
    hi = Math.max(r, g, b);
  // a neutral or cool grey below paper white has no tone of its own: it takes the nearest step of the grey ladder, however far
  const grey = hi - Math.min(r, g, b) <= GREY_CHROMA && b >= r - 4 && hi <= GREY_TOP;
  let best = grey ? Infinity : FAMILY_SNAP + 1;
  for (let i = 0; i < (grey ? GREYS : FAMILY.length); i++) {
    const f = FAMILY[i]!,
      far = Math.abs((f >> 16) - r) + Math.abs(((f >> 8) & 255) - g) + Math.abs((f & 255) - b);
    // (a brass or a pale gold is the one gold: it snaps from farther)
    const d = f === GOLD ? far - (GOLD_SNAP - FAMILY_SNAP) : far;
    if (d < best) {
      best = d;
      out = f;
    }
  }
  snapped.set(color, out);
  return out;
}

export const mat = (color: number, o: MeshStandardMaterialParameters = {}): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: familyHex(color), metalness: 0.05, roughness: 0.65, ...o });

/** Cloth (linen, wool, velvet): matte, with the soft sheen a weave catches at a grazing look, which roughness alone cannot give. */
export const cloth = (color: number, o: MeshPhysicalMaterialParameters = {}): MeshPhysicalMaterial =>
  new MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: 0.92,
    sheen: 1,
    sheenRoughness: 0.6,
    sheenColor: 0x5a5650,
    ...o,
  });

/** Varnished wood or lacquer: the base as `mat` under a thin clear coat that mirrors the window and the lamps. */
export const varnish = (color: number, o: MeshPhysicalMaterialParameters = {}): MeshPhysicalMaterial =>
  new MeshPhysicalMaterial({ color, metalness: 0.05, roughness: 0.6, clearcoat: 0.55, clearcoatRoughness: 0.2, ...o });

/**
 * The materials of one part that follow its state, each eased toward the current look. `gain` scales the glow: a part with wide faces (a card's
 * shroud, a stick's spreader) glows softer, or the state's colour would cover its own. `follows` false: a skin of the thermal view alone (a radiator, a
 * heatsink, a hose); power and a burn do not touch it, so out of the airflow lens the part looks as it always did.
 */
export class PartSkin {
  private base: Color[];
  private tint = 1;
  private glow = new Color(0);
  private level = 0;
  private goal: PartLook = { tint: 1, glow: 0, glowIntensity: 0 };
  private goalGlow = new Color(0);
  /** A lens's view (the airflow lens's, the power lens's): the place on its scale it is eased to (null: not shown), the place it is at, how far the look has gone over, and which view. */
  private goalHeat: number | null = null;
  private heat = 0;
  private over = 0;
  private lens: LensView = THERMAL_VIEW;
  private shown = new Color(0);
  private hot = new Color(0);

  constructor(
    readonly mats: MeshStandardMaterial[],
    private gain = 1,
    private follows = true,
  ) {
    this.base = mats.map((m) => own(m).color.clone());
  }

  set(state: PartState): void {
    if (!this.follows) return;
    this.goal = partLook(state);
    this.goalGlow.setHex(this.goal.glow);
  }

  /**
   * The thermal view: the part shows its temperature at place `heat` (0 to 1) on the thermal scale (`thermal.ts`) as a glow of the scale's colour on a darkened
   * body, and eases there. Null brings its own look back.
   */
  thermal(heat: number | null): void {
    this.goalHeat = heat;
    this.lens = THERMAL_VIEW;
  }

  /**
   * The power view: the part shows what it draws at place `level` (0 to 1) on the power scale (`powerscale.ts`): a part that draws nothing keeps a dim glow (it is a
   * power part), one that draws glows brighter with its draw, in its role's colour (`role`: a use is amber, a hub, a supply that hands the power on, cyan, a source
   * white). `warn`: the glow is the warning's red (a supply over its budget). Null brings its own look back.
   */
  electric(level: number | null, warn = false, role: Role = 'use'): void {
    this.goalHeat = level;
    this.lens = warn ? WARN_VIEW : ROLE_VIEW[role];
  }

  /** Still on its way to the state's look (a frame drawn on demand, docs/render/load.md, keeps drawing meanwhile). */
  get easing(): boolean {
    const g = this.glow,
      w = this.goalGlow;
    return (
      Math.abs(this.goal.tint - this.tint) > 1e-3 ||
      Math.abs(this.goal.glowIntensity - this.level) > 1e-3 ||
      (this.goal.glowIntensity > 0 && Math.abs(g.r - w.r) + Math.abs(g.g - w.g) + Math.abs(g.b - w.b) > 1e-3) ||
      Math.abs((this.goalHeat === null ? 0 : 1) - this.over) > 1e-3 ||
      (this.goalHeat !== null && Math.abs(this.goalHeat - this.heat) > 1e-3)
    );
  }

  /** Ease over about half a second (3D_STYLE.md "State Transitions"). */
  frame(dt: number): void {
    const t = 1 - Math.pow(0.002, dt);
    this.tint += (this.goal.tint - this.tint) * t;
    this.level += (this.goal.glowIntensity - this.level) * t;
    if (this.goal.glowIntensity > 0) this.glow.lerp(this.goalGlow, t);
    const on = this.goalHeat !== null;
    this.over += ((on ? 1 : 0) - this.over) * t;
    if (on) this.heat += (this.goalHeat! - this.heat) * t;
    const k = this.over < 1e-3 ? 0 : this.over,
      v = this.lens,
      tint = this.tint + (v.body - this.tint) * k;
    this.shown.copy(this.glow);
    if (k > 0) this.shown.lerp(this.hot.setHex(v.hex(this.heat)), k);
    // (a part with wide faces glows softer in a lens that asks for it: `soft` is how far its `gain` counts there)
    const wide = 1 + (this.gain - 1) * v.soft;
    const level = this.level * this.gain * (1 - k) + (v.floor + v.gain * wide * Math.pow(this.heat, v.bend)) * k;
    this.mats.forEach((m, i) => {
      m.color.copy(this.base[i]!).multiplyScalar(tint);
      m.emissive.copy(this.shown);
      m.emissiveIntensity = level;
    });
  }
}

/** The thermal view: how dark a part's own colour goes (it is the glow that shows), and the glow's strength at the cold end and the extra at the hot end. */
const THERMAL_BODY = 0.35,
  THERMAL_GLOW_MIN = 0.1,
  THERMAL_GLOW = 1.5;

/**
 * How a lens shows a part: the colour at a place on its scale, how dark the body goes, the glow's floor and the extra at the top (its place raised to `bend`),
 * and how far a skin's own `gain` (a card's wide shroud glows softer) counts, 0 (not at all) to 1.
 */
interface LensView {
  hex: (h: number) => number;
  body: number;
  floor: number;
  gain: number;
  bend: number;
  soft: number;
}
const THERMAL_VIEW: LensView = {
  hex: thermalHex,
  body: THERMAL_BODY,
  floor: THERMAL_GLOW_MIN,
  gain: THERMAL_GLOW,
  bend: 1.2,
  soft: 0,
};
/**
 * The power view. The veil does the dimming (it is very dark, `POWER_VEIL`), so the body goes less dark than in the thermal view and the glow is strong: both are lifted
 * by what the veil takes (`POWER_LIFT`), so a power part reads as it would under a plain veil while everything else goes nearly black. A part that draws nothing keeps a
 * dim glow (`floor`): it is a power part, and it is off.
 */
const POWER_GLOW = 2.5 * POWER_LIFT,
  POWER_BODY = 0.6 * POWER_LIFT,
  POWER_FLOOR = 0.45 * POWER_LIFT;
const POWER_VIEW: LensView = {
  hex: powerHex,
  body: POWER_BODY,
  floor: POWER_FLOOR,
  gain: POWER_GLOW,
  bend: 0.9,
  soft: 0.6,
};
const WARN_VIEW: LensView = {
  hex: () => WARN,
  body: POWER_BODY,
  floor: POWER_FLOOR,
  gain: POWER_GLOW,
  bend: 0.9,
  soft: 0.6,
};
/** A hub shows what flows through it in cyan, a source in white: the same glow as a use. */
const ROLE_VIEW: Readonly<Record<Role, LensView>> = {
  use: POWER_VIEW,
  hub: { ...POWER_VIEW, hex: hubHex },
  source: { ...POWER_VIEW, hex: sourceHex },
};

// ---- shared materials (docs/render/three.md "Merges") ----

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
const SKIP = new Set([
  'uuid',
  'id',
  'name',
  'version',
  'userData',
  '_listeners',
  'onBeforeCompile',
  'customProgramCacheKey',
]);
const ids = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object): number => {
  let n = ids.get(o);
  if (n === undefined) ids.set(o, (n = ++nextId));
  return n;
};

// (no JSON.stringify: a texture's `toJSON` would read its whole picture)
function ser(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v !== 'object') return String(v);
  const x = v as {
    isColor?: boolean;
    isVector2?: boolean;
    isVector3?: boolean;
    isVector4?: boolean;
    isEuler?: boolean;
  };
  if (x.isColor) {
    const c = v as Color;
    return `c${c.r},${c.g},${c.b}`;
  }
  if (x.isVector2 || x.isVector3 || x.isVector4 || x.isEuler)
    return `v${(v as { toArray(): unknown[] }).toArray().join(',')}`;
  if (depth < 8 && Array.isArray(v)) return `[${v.map((e) => ser(e, depth + 1)).join(',')}]`;
  const proto = Object.getPrototypeOf(v) as unknown;
  if (depth < 8 && (proto === Object.prototype || proto === null)) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${ser(o[k], depth + 1)}`)
      .join(',')}}`;
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
  const pk = m.customProgramCacheKey(),
    base = plain();
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
  const g = o.geometry,
    i = o as Mesh & { instanceColor?: unknown; morphTexture?: unknown };
  return `${o.type}|${Object.keys(g.attributes).sort().join(',')}|${Object.keys(g.morphAttributes).sort().join(',')}|${!!i.instanceColor}|${!!i.morphTexture}`;
};

export interface ShareOptions {
  /** Subtrees left as they are: built again or written after the build (the key rack). Their materials are not shared outside them either. */
  skip?: readonly Object3D[];
  /** Subtrees that fade alone (`fadeTree`: a lid, a cooler, a spreader): each is a scope of its own, so a fade changes nothing outside it. */
  apart?: readonly Object3D[];
  /** Hears of each material replaced by an equal one before it is disposed (the room's reflections drop it). */
  onReplace?: (old: Material, canon: Material) => void;
  /**
   * Share equal materials across parts, not only inside one (PHONE-01: the Low machine has 424 materials of 217 different looks, and each change of
   * material costs a draw its uniform upload). A fade subtree (`apart`) still shares only inside itself. A part that goes away disposes a material
   * the other parts use: three sets it up again at its next draw, so this costs one setup, not a wrong picture.
   */
  across?: boolean;
}

/** The standard materials under the root before and after a share. */
export interface Shared {
  before: number;
  after: number;
}

/**
 * Shares equal materials under `root`: of the materials with the same `materialKey`, used in the same scope (the nearest ancestor tagged with
 * a `userData.id`, which a rebuild disposes and a hover outlines as a whole, or an `apart` subtree) by the same kind of mesh, every mesh takes
 * the first and the others are disposed. Fewer materials draw with fewer uniform uploads (each change of material uploads its uniforms and its
 * lights' state). Left as they are: a material a writer changes (`own`, `PartSkin`, a glow, a fade), one of unknown inputs, one used across
 * scopes or kinds of mesh or by more than a plain mesh, and everything under `skip`. A writer that must change a mesh's material marks it `own`
 * before the share.
 */
export function shareMaterials(root: Object3D, o: ShareOptions = {}): Shared {
  interface Use {
    scope: Object3D | null;
    kind: string | null;
    meshes: Mesh[];
    fixed: boolean;
    fade: boolean;
  }
  const uses = new Map<Material, Use>(),
    skip = new Set(o.skip ?? []),
    apart = new Set(o.apart ?? []);
  const use = (m: Material): Use => {
    let u = uses.get(m);
    if (!u) uses.set(m, (u = { scope: null, kind: null, meshes: [], fixed: false, fade: false }));
    return u;
  };
  // `fade`: under a subtree that fades alone, at any depth (an id'd part inside a fading lid is still faded with it)
  const walk = (x: Object3D, scope: Object3D, fixed: boolean, fade: boolean): void => {
    const f = fixed || skip.has(x),
      fd = fade || apart.has(x),
      s = typeof x.userData.id === 'string' || apart.has(x) ? x : scope,
      mesh = x as Mesh;
    const m = (x as { material?: Material | Material[] }).material;
    if (m) {
      for (const a of Array.isArray(m) ? m : [m]) {
        const u = use(a);
        if (f || Array.isArray(m) || !mesh.isMesh) {
          u.fixed = true;
          continue;
        }
        const k = kind(mesh);
        if (u.meshes.length && (u.scope !== s || u.kind !== k)) u.fixed = true;
        u.scope = s;
        u.kind = k;
        u.fade ||= fd;
        u.meshes.push(mesh);
      }
    }
    for (const c of x.children) walk(c, s, f, fd);
  };
  walk(root, root, false, false);
  const canon = new Map<string, Material>();
  let before = 0,
    after = 0;
  for (const [m, u] of uses) {
    if (!(m as MeshStandardMaterial).isMeshStandardMaterial) continue;
    before++;
    const key = u.fixed || !stillMaterial(m) ? null : materialKey(m);
    if (key === null) {
      after++;
      continue;
    }
    const at = `${o.across && !u.fade ? 'all' : idOf(u.scope!)}|${u.kind}|${key}`,
      c = canon.get(at);
    if (!c) {
      canon.set(at, m);
      after++;
      continue;
    }
    for (const mesh of u.meshes) mesh.material = c;
    o.onReplace?.(m, c);
    m.dispose();
  }
  return { before, after };
}
