// The machine's tuning (machine3d.ts): the door's band, the lens's ring, the build's slice, Low's case shadow and the patch's limit.
import { Mesh } from 'three';
import type { CasePass, Intersection, Raycaster, RectLike, Spin } from './types';

/** The network lead's light blue (a common patch-cable colour). */
export const LAN_LEAD = '#8cc3e0';
/** The zoom (in parts of the board view's zoom, seen at the side) under which the side panel shuts again, and over which it opens. */
export const DOOR_ZOOM = [0.82, 0.92] as const;
/** What a fan's ring of light is multiplied by while the power lens shows: it is a decoration, so it goes low (it would read as the fan's power). */
export const RING_IN_LENS = 0.1;
/** How long `Machine3D.make` builds before the page has its turn (ms): a task is this long plus the longest step (the board's model, 0.1 s). */
export const SLICE_MS = 30;
/** A mesh's own raycast: rays reach the side panel's plate (while it is shut). */
export function HIT(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
  Mesh.prototype.raycast.call(this, raycaster, intersects);
}
export const NO_HIT = (): void => {
  // (a ray meets nothing here)
};
/**
 * Low's case shadow: how far inside the body its box sits, and what each face lets in (the top filter a fifth, steel none). The glass side
 * lets in 0.75, not all: the parts shade each other at High, and 0.75 is that mean (RAM L 0.036, High 0.037; drive cage 0.051, High 0.044).
 */
export const SHADE_IN = 60,
  CASE_PASS: CasePass = { plus: [0, 0.2, 0.75], minus: [0, 0, 0] };
/**
 * Low's contact shade (`footShade`): how far out a skirt reaches and how dark it starts, as High's occlusion pass shades round the cooler on the
 * board (the board beside the pump's base L 0.035 at High, 0.052 at Low without it) and round a cage on its shelf.
 */
export const CAGE_SHADE = { reach: 240, peak: 0.3 };
/** A patch that leaves this many hidden parts in the tree asks for a build instead (their geometry is freed by it). */
export const GRAVE_MAX = 10;

/** A fan or a light the live frame drives, with its speed. */
export type Fan = Spin & { speed: number };
/** An unseen drop box over the rect `r`, from depth `z[0]` to `z[1]`, tagged `id`. */
export type PickBox = (r: RectLike, z: readonly [number, number], id: string) => void;
