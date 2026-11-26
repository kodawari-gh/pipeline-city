// The recipe of a cloth bake (docs/render/cloth.md): the garment, how it is dropped and how the cloth as it lies is finished, and the
// per-material part of the model a bake (`bake.ts`) builds. Pure: no DOM.
import type { Garment } from './pattern';
import type { ClothParams, Phase } from './solver';

export interface ClothBake {
  /** The model's name, and its file under `public/` (`models/<name>.glb`). */
  name: string;
  garment: Garment;
  /** Point spacing on the flat pieces (mm). */
  h: number;
  params: ClothParams;
  phases: readonly (Phase & { label: string })[];
  /** Millimetres of flat cloth to one texture tile (the uvs are the flat positions over it). */
  tile: number;
  /** The rolled rim's radius along the free edges (mm; 0: none). */
  rim: number;
  /** Smoothing passes over the cloth as it lies (0: none): they take off the spikes a seam or a pinch leaves, not its folds. */
  smooth: number;
  /** How far the baked occlusion looks (mm; 0: none): a fold or the solid nearer than that darkens the cloth, the more the nearer. */
  ao: number;
}

/** One material's primitive as a bake builds it: the vertex attributes, the triangles, and each cloth point's vertex in it. */
export interface Part {
  position: number[];
  normal: number[];
  uv: number[];
  ao: number[];
  index: number[];
  map: Map<number, number>;
}

/** A part with nothing in it yet. */
export const emptyPart = (): Part => ({
  position: [],
  normal: [],
  uv: [],
  ao: [],
  index: [],
  map: new Map<number, number>(),
});
