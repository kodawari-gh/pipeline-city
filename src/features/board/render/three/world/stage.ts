// The 3D world's stage (board3d.ts): the renderer and its scene, the picture's passes, the shadow maps, the 2D art's bakes, the draw on demand,
// the studio's light and the room's probe, and the canvas's size.
import type { Texture } from 'three';
import { Post } from '@/core/render/three/post';
import { ShadowCache } from '@/core/render/three/shadows';
import { BakeQueue } from '@/core/render/three/artlod';
import { DrawGate, ViewWatch } from '@/core/render/three/ondemand';
import { shareTex } from '@/core/render/three/geometry';
import { PROBE_CALM, Probe } from '@/core/render/three/probe';
import type { RenderContext } from '@/core/render/three/init';
import { startBaker } from '../bake';

export interface Stage extends RenderContext {
  host: HTMLElement;
  /** The canvas's size (CSS px). */
  W: number;
  H: number;
  post: Post;
  /** The shadow maps: a still picture per light, and only what moves drawn again (shadows.ts). */
  shadows: ShadowCache;
  /** The 2D art baked into textures for the 3D faces (machine3d.ts, bake.ts). */
  bakes: BakeQueue;
  /** The title's room is drawn on demand (docs/render/load.md "Draw on demand"): a frame when its picture changes, none while it stands. */
  demand: DrawGate;
  shift: ViewWatch;
  /** The studio's light: the scene's only until the room's probe is ready (the first frames). */
  studio: Texture;
  /** The room's own light (`Held.roomEnv`). */
  probe: Probe;
}

/** The stage on the renderer of `ctx`, in the page's `host`. */
export function createStage(ctx: RenderContext, host: HTMLElement): Stage {
  const { scene, camera, renderer } = ctx;
  const W = host.clientWidth,
    H = Math.max(1, host.clientHeight);
  const post = new Post(renderer, scene, camera, W, H);
  const shadows = new ShadowCache(renderer);
  const bakes = new BakeQueue();
  startBaker();
  const demand = new DrawGate(),
    shift = new ViewWatch();
  const env = scene.environment;
  if (!env) {
    throw new Error('the render context sets the studio light as the scene environment');
  }
  const studio = shareTex(env);
  const probe = new Probe(200, 400_000, PROBE_CALM);
  return { ...ctx, host, W, H, post, shadows, bakes, demand, shift, studio, probe };
}
