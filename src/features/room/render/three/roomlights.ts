// Which of the scene's lights stay real-time under the graphics settings' cap (`lights`, `lightShadows`; light.md "The lamp cap"). Pure: no Three.js.

/** One entry a light, but `sconce` (its two spots) and `strips` (the shelves' strips), which the room drives as one. */
export type LightId =
  | 'key'
  | 'sun'
  | 'arc'
  | 'case'
  | 'spill'
  | 'desk'
  | 'floor'
  | 'bedside'
  | 'sconce'
  | 'screen'
  | 'deskLed'
  | 'picture'
  | 'ledHalo'
  | 'ledUnder'
  | 'bias'
  | 'strips';

/**
 * Every real-time light of the scene by what the look loses without each, the first kept longest. The choice depends on the cap alone, not
 * on the hour or a switch: a lamp that is off keeps its place, so the count of lights (and so every lit program) holds through the evening.
 * A light with no baked direct light loses all of it when capped; a lamp with one (`npm run bake`'s `<id>-direct`) loses only its light on
 * what moves and its gloss. So the unbaked ones come first.
 * - `key`: the window's sky and city. The bake holds its light whole (`STAND_IN_DECAY`): live, it lights only what moves, and nothing else
 *   from outside does.
 * - `arc`: on at every hour; the board reads by it (light.md "How the case reads"). Its direct light is not baked.
 * - `case`, `spill`: the machine's RGB (`machine3d.ts`): its glow on the parts in the case, and its light from in front of the glass on the
 *   parts' faces, the desk and the wall (the case's violet in the board view). Nothing bakes them: they come and go with the power.
 * - `sun`: the moon's shaft at night and the low sun at dusk. Its bounce is baked, its direct light is not; but with no window shadow (Low)
 *   it is a faint wash with no shaft (GFX-04: under 1% of the pixels at 20:00 and 23:00). With shadows it is the shaft.
 * - `desk`: the player's switch; its pool on the desk is baked (GFX-04), so a cap keeps it, without its gloss and its light on the chair.
 * - `floor`, `bedside`: the two lanterns. The largest warm pools, each with shadows: they shape the room's two ends at night.
 * - `sconce`: the two scallops on the west wall (the "wall in a lamp's pool" target). Together, or the fixture reads broken.
 * - `screen`: its glow falls where the arc and the desk lamp already light, and the panel itself glows.
 * - `deskLed`, `picture`, `ledHalo`, `ledUnder`, `bias`, `strips`: accents. Each has a glowing line at its source and a short reach, so
 *   its baked light stands in for it best. The strips are many lights for one soft wash: last.
 */
export const LIGHT_ORDER: readonly LightId[] = [
  'key',
  'arc',
  'case',
  'spill',
  'sun',
  'desk',
  'floor',
  'bedside',
  'sconce',
  'screen',
  'deskLed',
  'picture',
  'ledHalo',
  'ledUnder',
  'bias',
  'strips',
];

/** The machine's lights (`Machine3D.setLights`): in the cap, but not the room's; the board hands the room's choice on to the machine. */
export const MACHINE_LIGHTS: readonly LightId[] = ['case', 'spill'];

/** The window's lights: their shadows follow the `shadows` option alone. */
export const WINDOW_LIGHTS: readonly LightId[] = ['key', 'sun'];
/** The lamps that can cast a shadow (a point or a spot with a map: `SHADOW_LEVELS` in room3d/consts.ts). */
export const LAMP_CASTERS: readonly LightId[] = ['desk', 'bedside', 'floor', 'arc'];
/**
 * The lamps that cast also with the lamps' shadows off, while they are live, at the smallest map (`LightChoice.small`).
 * - `bedside`: its bulb stands just over the drawer it sits on. With no shadow its light passes the drawer's top: the wall and the floor
 *   under the drawer and the bed's side light up (pool +5.4% at Medium), and the top itself must stay lit, so no cone can cut it.
 *   Its map holds until a caster moves (`ShadowCache`), so a still room draws none.
 */
export const ALWAYS_CASTS: readonly LightId[] = ['bedside'];

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
  /** Those of `shadows` that cast only by `ALWAYS_CASTS` (the lamps' shadows are off): each takes the smallest map. */
  small: Set<LightId>;
}

/**
 * The real-time lights at a cap of `cap` lights in all (0: no cap), the window's two and the machine's included, and the ones that may
 * cast a shadow. `count(id)`: how many lights the entry stands for (the sconce, the strips). The walk stops at the first entry that does not
 * fit: none after it comes in, so a higher cap only ever adds lights.
 */
export function chooseLights(cap: number, lampShadows: boolean, count: (id: LightId) => number = () => 1): LightChoice {
  const live = new Set<LightId>(),
    shadows = new Set<LightId>(),
    small = new Set<LightId>();
  let n = 0;
  for (const id of LIGHT_ORDER) {
    const c = count(id);
    if (cap > 0 && n + c > cap) {
      break;
    }
    n += c;
    live.add(id);
    if (WINDOW_LIGHTS.includes(id) || (lampShadows && LAMP_CASTERS.includes(id))) {
      shadows.add(id);
    } else if (ALWAYS_CASTS.includes(id)) {
      shadows.add(id);
      small.add(id);
    }
  }
  return { live, shadows, small };
}

/** How many times over a light group's baked bounce shows with `capped` of its `total` lights out of the scene. */
export const bounceLift = (capped: number, total: number): number =>
  total > 0 ? 1 + (CAPPED_BOUNCE - 1) * (capped / total) : 1;
