// The room's numbers: its shadow maps and their levels, the window's light, the lamps' lumens and where the print hangs.

import { STRIP_W } from '../furniture/strips';
import { M } from '../outside/plan';
import { BED } from '../roomplan';
import type { LightId } from './types';

export const KEY_W = 230;

/**
 * The shadow map sizes at each level of the graphics settings (the window's sky light, the sun, the lamp, the bedside lantern, the floor
 * lantern: a lantern's is a cube of six faces this size; the arc lamp, whose shadows are the board's parts); 0 has no shadows, 3 is the tuned look.
 */
export const SHADOW_LEVELS: readonly (readonly number[] | null)[] = [
  null,
  [1024, 1024, 512, 256, 256, 512],
  [2048, 1024, 1024, 512, 512, 1024],
  [4096, 2048, 1024, 1024, 1024, 2048],
  [8192, 4096, 2048, 2048, 2048, 4096],
];
/** Each light's softness at level 3. It is in map texels, so a map of another size takes its share and the shadow's edge stays as wide. */
export const SHADOW_SOFT = [14, 5, 6, 5, 5, 4];
/** A lantern's shadow range (it has no cut-off distance): across the room. */
export const LANTERN_FAR = 130_000;
/** The bedside lantern's shadow range with the lamps' shadows off: the drawer's whole shadow on the wall, the floor and the bed's side. */
export const BEDSIDE_FAR = 21_000;
/**
 * The layer of the casters in the bedside lantern's map with the lamps' shadows off: the drawer and the bed, with what stands on them (they
 * stay on layer 0 too). The drawer stops the light that lit the wall, the floor and the bed's side under it; the rest keeps the small shadows
 * that High shows there (the lantern's stand, the book, the mattress's edge). They do not move, so nothing else in the room redraws that map.
 */
export const BEDSIDE_LAYER = 5;
/** The casters' names in `LIGHT_ORDER`, in `SHADOW_LEVELS`' order. */
export const CASTER_IDS: readonly LightId[] = ['key', 'sun', 'desk', 'bedside', 'floor', 'arc'];
/**
 * The window's sky light falls off as its distance to this power: a window is a wide source, gentler than a bulb's square. It marks the key as
 * the window's stand-in: a mesh with the baked light skips it (`STAND_IN_DECAY`).
 */
export { STAND_IN_DECAY as KEY_DECAY } from '@/core/render/three/lightmapmix';
/** The sky light's level is as set at this distance from its source (about the desk's middle). */
export const KEY_REF = 24_000;
/**
 * The share of the room's own light (the probe, `setProbe`) its materials take as ambient light and reflections. Under 1: one point stands for
 * the whole room, and a bounce loses some.
 */
export const PROBE_K = 1;
/**
 * While nothing large moves, one light at this pace (ms) redraws its shadow map if a fan's rotor turned since its last draw (`catchUp`): a whole
 * round costs one frame's worth, spread out. A still room redraws none.
 */
export const SHADOW_TURN_MS = 400;
/** The window's frame sits this far back in its reveal (z of its room face), and the glass a little behind that. */
export const FRAME_Z = -1000,
  GLASS_Z = -1500;
/** The sun is a spot this far out along its direction from the window: its cone covers the opening, its shadow the reveal and the frame. */
export const SUN_D = 90_000;
/** The plaster texture's size on the walls (units; about 43 cm). */
export const PLASTER_TILE = 8000;
/** The sun's key frames for the bake (hours, `tools/bake/`): the baked bounce blends the two round the hour (the owner, 2026-11-06). */
export const SUN_HOURS = [6, 8, 10, 12, 14, 16, 18, 20];
/**
 * The bake's sky and city (a radiance of 1 over their half of the window) against the window's light (`key`): its level at the desk stands
 * for a window's worth of sky, so the radiance is about that level times this.
 */
export const SKY_K = 1;
/** By day the city below the horizon is sunlit (its walls, roofs and streets): its light against the sky's, about what a city's ground throws back. */
export const CITY_DAY = 0.3;
/**
 * The lamps are real lamps: their light falls off as the square of the distance in metres (decay 2, `M` units a metre), a lamp's level is its
 * lumens over the cone it lights, and a lux on a face is `LUX_K` of the scene's light (the camera's exposure for the room: a task lamp's
 * 2000 lux pool shows bright, a lantern's 60 lux a metre off dim). `lumens(lm, cone)` is a point or spot light's intensity (`cone` its
 * half-angle, a whole sphere by default); `nits(cd)` an area light's, for a face that shows `cd` candela a square metre.
 */
const LUX_K = 1.4e-3;
export const lumens = (lm: number, cone = Math.PI): number =>
  (lm / (2 * Math.PI * (1 - Math.cos(cone)))) * M * M * LUX_K;
export const nits = (cd: number): number => cd * LUX_K;
/** The desk lamp's bulb, the bedside lantern's (a 60 W-equivalent bulb in paper), the screen's mean glow (a dark interface, half its white). */
export const DESK_LM = 500,
  LANTERN_LM = 800,
  SCREEN_NITS = 120;
/** A shelf's LED strip, lumens a metre (a soft strip behind a diffuser); its face's level spreads them over its width, out of one side. */
const STRIP_LM_M = 450;
export const STRIP_NITS = STRIP_LM_M / ((Math.PI * STRIP_W) / M);

/** The picture light's slot (spread over its face as the strips are), and each of the door sconce's two spots (up, down). */
export const PICTURE_LM = 220,
  SCONCE_LM = 450;
/** The monitor's cyan bias strip round its back: about 2 m of RGB strip at cyan (its green and blue: about half its white's lumens). */
export const BIAS_LM = 400;
/**
 * The arc lamp's bulb (a 100 W-equivalent behind the washi): an overhead cozy light, not a work lamp. Its wide pool's edge reaches the board
 * through the case's glass, by day too (the glass looks north and the case faces away from it: by day the board has only the room's bounce).
 */
export const ARC_LM = 1600;
/** The print over the bed: its frame (2D y down) on the back wall. */
export const PRINT = { x: BED.x + BED.w / 2 - 7600, y: -15_800, w: 15_200, h: 10_800 };

/** The cells of space the palette merge keeps apart (`mergeByPalette`): 2 m, so a view of one corner still culls the rest. */
export const PALETTE_CELL = 2 * M;

export const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
