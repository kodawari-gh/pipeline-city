import { Rectangle, type Container, type Renderer } from 'pixi.js';
import type { Rect } from './board/layout';
import { fieldShape, type Shape } from './shape';

/**
 * The silhouette of what `target` draws over `frame` (in the target's own space; its own position and scale are not applied, its children's are), read back
 * once from the GPU as alpha and turned into a `Shape`. A pixel is a few world units to a dozen (the grid is up to 600 across), and the edge is placed from the anti-aliased alpha to a fraction of a pixel, so the
 * outline is the art's own at any zoom the game allows; it costs a few milliseconds, once. Null when nothing opaque is there.
 */
export function captureShape(renderer: Renderer, target: Container, frame: Rect, opts: { threshold?: number; maxCells?: number } = {}): Shape | null {
  const cell = Math.max(4, Math.max(frame.w, frame.h) / (opts.maxCells ?? 600));
  const w = Math.max(1, Math.ceil(frame.w / cell)), h = Math.max(1, Math.ceil(frame.h / cell));
  const snapped: Rect = { x: frame.x, y: frame.y, w: w * cell, h: h * cell };
  const out = renderer.extract.pixels({ target, frame: new Rectangle(snapped.x, snapped.y, snapped.w, snapped.h), resolution: 1 / cell });
  return fieldShape(out.pixels, out.width, out.height, { ...snapped, w: out.width * cell, h: out.height * cell }, opts);
}
