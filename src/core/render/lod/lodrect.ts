import type { Container } from 'pixi.js';
import { deviceLod, type LodRect, type Placement } from './lod';

/**
 * The world rectangle of each card or module, found once from the node's bounds (not free to ask) and kept until the node is gone.
 * The node sits in board space at its own position (scale 1), as the card views place them. Unknown while the node is still empty.
 */
export class RectCache {
  private rects = new WeakMap<object, LodRect>();

  of(key: object, node: Container): LodRect | null {
    let r = this.rects.get(key);
    if (!r) {
      const b = node.getLocalBounds();
      if (!(b.width > 0 && b.height > 0)) return null;
      r = { x: node.x + b.x, y: node.y + b.y, w: b.width, h: b.height };
      this.rects.set(key, r);
    }
    return r;
  }

  /** Where the node is against `view`. Without a view, or while its size is unknown, it counts as on screen (nothing is skipped on a guess). */
  place(key: object, node: Container, view?: LodRect): Placement {
    const r = view ? this.of(key, node) : null;
    return r && view ? deviceLod(r, view) : { onScreen: true, focus: 1 };
  }
}
