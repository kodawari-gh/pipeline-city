// Which of the room's lights stay real-time under the graphics settings' cap (`lights`, `lightShadows`; light.md "The lamp cap"). Pure: no Three.js.

/** One entry a light, but `strips`: the shelves' strips, which the room drives as one. */
export type LightId = 'key' | 'sun' | 'arc' | 'desk' | 'floor' | 'bedside' | 'sconceUp' | 'sconceDown' | 'screen' | 'deskLed' | 'picture' | 'ledHalo' | 'ledUnder' | 'bias' | 'strips';

/**
 * The room's lights by what the look loses without each, the first kept longest. The choice depends on the cap alone, not on the hour or a
 * switch: a lamp that is off keeps its place, so the count of lights (and so every lit program) holds through the evening.
 * - `key`, `sun`: the window. The day, the moon's shaft, and the only light from outside on what moves. They have no baked direct light.
 * - `arc`: on at every hour; the board reads by it (light.md "How the case reads").
 * - `desk`: the player's switch must show; its pool and its shadows are the desk's.
 * - `floor`, `bedside`: the two lanterns. The largest warm pools, each with shadows: they shape the room's two ends at night.
 * - `sconceUp`, `sconceDown`: the scallops on the west wall (the "wall in a lamp's pool" target). Together, or the fixture reads broken.
 * - `screen`: its glow falls where the arc and the desk lamp already light, and the panel itself glows.
 * - `deskLed`, `picture`, `ledHalo`, `ledUnder`, `bias`, `strips`: accents. Each has a glowing line at its source and a short reach, so
 *   its baked bounce stands in for it best. The strips are many lights for one soft wash: last.
 */
export const LIGHT_ORDER: readonly LightId[] = ['key', 'sun', 'arc', 'desk', 'floor', 'bedside', 'sconceUp', 'sconceDown', 'screen', 'deskLed', 'picture', 'ledHalo', 'ledUnder', 'bias', 'strips'];

/** The window's lights: their shadows follow the `shadows` option alone. */
export const WINDOW_LIGHTS: readonly LightId[] = ['key', 'sun'];
/** The lamps that can cast a shadow (a point or a spot with a map: `SHADOW_LEVELS` in room3d.ts). */
export const LAMP_CASTERS: readonly LightId[] = ['desk', 'bedside', 'floor', 'arc'];

/**
 * A capped lamp's baked bounce is shown this many times over: the bake holds only its indirect light, and its pool on the wall or the floor
 * beside it is gone with the light. A share of a group's lights capped takes that share of the lift (`bounceLift`).
 */
export const CAPPED_BOUNCE = 2.5;

export interface LightChoice {
  /** The lights that stay in the scene. */
  live: Set<LightId>;
  /** Those of them that may cast a shadow (the `shadows` level still sizes each map, or turns all off). */
  shadows: Set<LightId>;
}

/**
 * The real-time lights at a cap of `cap` lights in all (0: no cap), the window's two included, and the ones that may cast a shadow.
 * `count(id)`: how many lights the entry stands for (the strips). The walk stops at the first entry that does not fit: none after it comes
 * in, so a higher cap only ever adds lights.
 */
export function chooseLights(cap: number, lampShadows: boolean, count: (id: LightId) => number = () => 1): LightChoice {
  const live = new Set<LightId>(), shadows = new Set<LightId>();
  let n = 0;
  for (const id of LIGHT_ORDER) {
    const c = count(id);
    if (cap > 0 && n + c > cap) break;
    n += c;
    live.add(id);
    if (WINDOW_LIGHTS.includes(id) || (lampShadows && LAMP_CASTERS.includes(id))) shadows.add(id);
  }
  return { live, shadows };
}

/** A cone that stands in for a point light: its half-angle from straight up (rad, it may pass a half sphere) and its soft edge's share of it. */
export interface OpenCone { angle: number; penumbra: number }

/**
 * The lamps that shine through their own furniture with no shadow map, and the cone that cuts that light (light.md "The lamp cap").
 * - `bedside`: the bulb stands 2050 over the drawer's top and 2400 to 4800 in from its edges (`NIGHTSTAND`), so the top shades all below a line 23 to 40
 *   degrees under the level (the drawer's sides, the wall and the floor under it, the bed's side). The cone ends 30 degrees under the level
 *   and is full from 20: the mattress's top (at most 21 under) and all above keep the point light's level.
 * The desk lamp and the arc lamp are spots that aim down at the desk; the floor lantern stands on wire legs, clear of furniture: none here.
 */
export const SHADOWLESS_CONE: Partial<Record<LightId, OpenCone>> = { bedside: { angle: (120 * Math.PI) / 180, penumbra: 1 - 110 / 120 } };

/** The cone that stands in for the light `id`, or null for the light as built: only a live lamp that casts no shadow (`casts`) takes one. */
export const shadowlessCone = (id: LightId, live: boolean, casts: boolean): OpenCone | null => (live && !casts ? SHADOWLESS_CONE[id] ?? null : null);

/** How many times over a light group's baked bounce shows with `capped` of its `total` lights out of the scene. */
export const bounceLift = (capped: number, total: number): number => (total > 0 ? 1 + (CAPPED_BOUNCE - 1) * (capped / total) : 1);
