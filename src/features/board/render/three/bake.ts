// The bridge from the 2D art to the 3D world: an offscreen Pixi renderer draws the same containers the board draws (`buildBoard`, `cpuArt`,
// `ramArt`, `cardArt`, the die floorplans...) into a canvas that three.js uses as a texture (`ArtSurface`, core/render/three/artlod.ts). Nothing is
// redrawn for 3D. The renderer also feeds the shop's part pictures (`initThumbs`), which the 3D view had no renderer for.
import { autoDetectRenderer, Container, Rectangle, type Renderer } from 'pixi.js';
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
