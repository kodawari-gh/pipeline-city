// The bridge from the 2D art to the 3D world: an offscreen Pixi renderer draws the same containers the board draws (`buildBoard`, `cpuArt`,
// `ramArt`, `cardArt`, the die floorplans...) into a canvas that three.js uses as a texture (`ArtSurface`, core/render/three/artlod.ts). Nothing is
// redrawn for 3D. The renderer also feeds the shop's part pictures (`initThumbs`), which the 3D view had no renderer for.
import { autoDetectRenderer, Container, Matrix, Rectangle, type Renderer } from 'pixi.js';
import type { Rect } from '@/core/render/three/artlod';
import { initThumbs } from '../thumbs';

let renderer: Renderer | null = null;
let starting = false;

/** Start the offscreen renderer (once). Bakes return null until it is ready. */
export function startBaker(): void {
  if (renderer || starting) return;
  starting = true;
  void autoDetectRenderer({ preference: 'webgl', width: 64, height: 64, backgroundAlpha: 0, antialias: true }).then((r) => {
    renderer = r;
    initThumbs(r);
  });
}

/** A Text draws at its own resolution: raise it to the bake's, so the names stay sharp when the texture is dense. */
function sharpen(node: Container, res: number): void {
  const n = node as unknown as { text?: unknown; resolution?: number };
  if (typeof n.text === 'string' && n.resolution !== undefined && n.resolution < res) n.resolution = res;
  for (const ch of node.children) sharpen(ch, res);
}

/** A live drawing's canvas sizes go up in steps of this (pixels), so a zoom does not reallocate it every frame. */
export const LIVE_STEP = 256;
const LIVE_AT = new Matrix();

/**
 * Draw a live 2D layer (a die view, chips3d.ts) inside `frame` at `px` pixels per unit into `out`, every frame it moves: on the renderer's own
 * canvas (a WebGL canvas, read back on the GPU), then copied, so each face keeps its picture. The drawing fills the top left `w` x `h` of `out`,
 * whose size is a multiple of `LIVE_STEP`. Null while the renderer is not ready.
 */
export function drawLive(c: Container, frame: Rect, px: number, out: HTMLCanvasElement): { w: number; h: number } | null {
  if (!renderer) return null;
  const w = Math.max(1, Math.ceil(frame.w * px)), h = Math.max(1, Math.ceil(frame.h * px));
  const W = Math.ceil(w / LIVE_STEP) * LIVE_STEP, H = Math.ceil(h / LIVE_STEP) * LIVE_STEP;
  if (renderer.width !== W || renderer.height !== H) renderer.resize(W, H, 1);
  sharpen(c, Math.min(6, Math.max(1, Math.ceil(px))));
  renderer.render({ container: c, transform: LIVE_AT.set(px, 0, 0, px, -frame.x * px, -frame.y * px), clear: true, clearColor: [0, 0, 0, 0] });
  if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
  const g = out.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, W, H);
  g.drawImage(renderer.canvas as HTMLCanvasElement, 0, 0);
  return { w, h };
}

/** One piece of 2D art, built once (with the layout as it is now), baked into any frame at any density. */
export class ArtBaker {
  private art: Container;

  constructor(build: () => Container) {
    // wrapped: the art may carry its own position and scale, which only a parent's frame includes
    this.art = new Container();
    this.art.addChild(build());
  }

  readonly bake = (frame: Rect, px: number): HTMLCanvasElement | null => {
    if (!renderer || this.art.destroyed) return null;
    sharpen(this.art, Math.min(6, Math.max(1, px)));
    return renderer.extract.canvas({ target: this.art, frame: new Rectangle(frame.x, frame.y, frame.w, frame.h), resolution: px, antialias: true, clearColor: [0, 0, 0, 0] }) as HTMLCanvasElement;
  };

  dispose(): void { if (!this.art.destroyed) this.art.destroy({ children: true }); }
}
