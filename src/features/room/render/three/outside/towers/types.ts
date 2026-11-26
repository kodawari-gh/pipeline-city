// The types the towers' modules share, in one place so each module takes its types in one import: the plan's, the detail's, the signs'
// and three's that they use, and their own (a point, a uv, a vertex's look and paint, a box's sides, a roof's places, a tower's top).
import type { Rect, Tier } from '../plan';

export type { Building, Rect, Tier } from '../plan';
export type { CityDetail } from '../detail';
export type { SignWash } from '../signlight';
export type { WebGLProgramParametersWithUniforms } from 'three';

/** A point or a direction (m). */
export type V3 = readonly [number, number, number];
/** A facade uv (m). */
export type UV = readonly [number, number];
/** A vertex's look: bay, storey, window share across and up (or what its kind reads there). */
export type Look = [number, number, number, number];

/** What the next vertices are besides their frame colour and kind: their glass tint, look, seed and reflection. */
export interface Paint {
  tint?: number;
  seed?: number;
  look?: Look;
  refl?: number;
}

/** A box's top (`top`), its walls turned inward (a parapet's inner face), and a call per wall with its length before it is made (`fit`). */
export interface BoxSides {
  top?: boolean;
  inward?: boolean;
  fit?: (len: number) => void;
}

/** A free place on the roof for pw by pd, away from the parapet and what stands there already (placed by `pick`, by default the roof's own stream). */
export type Place = (pw: number, pd: number, pick?: () => number) => Rect | null;

/** A tower's top: its top tier, its height, and the tier's middle. */
export interface Top {
  t: Tier;
  h: number;
  cx: number;
  cz: number;
}

/** A roof to fill: its rect r at height y, its building's stream, and `fine`: near enough for the small things. */
export interface RoofAt {
  r: Rect;
  y: number;
  rand: () => number;
  fine: boolean;
}
