// Palette and state looks of the 3D parts (docs/LOWPOLY_STYLE.md). `partLook` is pure: a part's state in, the colour factor and glow out.
import { Color, MeshPhysicalMaterial, MeshStandardMaterial, type Material, type Mesh, type MeshPhysicalMaterialParameters, type MeshStandardMaterialParameters, type Object3D } from 'three';

export const PALETTE = {
  cpu: 0x2a2f4d, gpu: 0x17263f, ram: 0x1f6d45, ssd: 0x2d3035, psu: 0x22242a, pcb: 0x123f3c, alu: 0xc4c8cc, cable: 0x2c2d31,
  chassis: 0x24262b, gold: 0xc9a24a, slot: 0x15171b, rgb: 0x7a5cff,
  oak: 0xb98655, walnut: 0x7a4f2e, slat: 0xa87446, plaster: 0xe9dcc8, rug: 0x8c4f3f, ceramic: 0xf1ede5, lamp: 0xf4f0e6, plastic: 0x26272b,
} as const;

export const GLOW = { active: 0x3be3ff, throttled: 0xffc247, burnt: 0xff5a78, hot: 0xff5a30 } as const;
/** Above this temperature a part starts to glow (LOWPOLY_STYLE.md "Overheating"). */
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

  constructor(readonly mats: MeshStandardMaterial[], private gain = 1) { this.base = mats.map((m) => m.color.clone()); }

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

  /** Ease over about half a second (LOWPOLY_STYLE.md "State Transitions"). */
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

/** What `materialKey` leaves out: the names and ids, the user data and the shader hooks (it reads those apart). */
const UNKEYED = new Set(['id', 'uuid', 'name', 'version', 'userData', 'onBeforeCompile', 'customProgramCacheKey', '_listeners']);

/** A setting as text: a colour, a vector or an angle by its numbers, a texture by its id, a plain value or object as JSON. */
function keyOf(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? String(v);
  const o = v as { isTexture?: boolean; uuid?: string; toArray?: () => unknown[] };
  if (o.isTexture) return `tex:${o.uuid}`;
  if (typeof o.toArray === 'function') return o.toArray().join(',');
  return JSON.stringify(v);
}

/**
 * A material's look as text: its type, its program key (the shader patches it has: `boxenv`, `bakedao`, `lightmapmix`), its user data and
 * each setting in name order. Two materials with one key draw the same picture.
 */
export function materialKey(m: Material): string {
  const set = Object.entries(m).filter(([k, v]) => !UNKEYED.has(k) && typeof v !== 'function').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [m.type, m.customProgramCacheKey(), JSON.stringify(m.userData), ...set.map(([k, v]) => `${k}=${keyOf(v)}`)].join('|');
}

/**
 * Can `shareMaterials` give this material to other meshes: a standard material, opaque, with no glow. The room changes a glow's strength
 * by itself (the ISP's five lights are five equal materials, each lit on its own), so a glow keeps its own material.
 */
export function shareable(m: Material): m is MeshStandardMaterial {
  const s = m as MeshStandardMaterial;
  return !!s.isMeshStandardMaterial && !s.transparent && s.opacity >= 1 && s.alphaTest === 0 && s.emissive.getHex() === 0 && !s.emissiveMap;
}

/**
 * One material for each look (`materialKey`) under `root`: each mesh with a `shareable` material takes the first equal one. Three then
 * uploads that material's uniforms once, and `mergeStatic` can join more meshes. Call it once the root is built. A material that code
 * changes later must not be shareable (the room's reflections, `RoomEnv`, change all its materials alike: they can share). Returns how
 * many materials no mesh uses now.
 */
export function shareMaterials(root: Object3D): number {
  const first = new Map<string, Material>(), dropped = new Set<Material>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || Array.isArray(m.material) || !shareable(m.material)) return;
    const k = materialKey(m.material), had = first.get(k);
    if (!had) first.set(k, m.material);
    else if (had !== m.material) { dropped.add(m.material); m.material = had; }
  });
  return dropped.size;
}
