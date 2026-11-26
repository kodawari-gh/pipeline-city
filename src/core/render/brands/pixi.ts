// The brands in Pixi 2D art (the case exteriors, the board silkscreen, the monitor's standby screen): the lockup is drawn on a canvas by
// index.ts, exactly as the 3D labels and the design sheets have it, and shown as a sprite. One texture per look, kept for reuse.
import { Sprite, Texture } from 'pixi.js';
import { drawLockup, lockupWidth } from './index';
import type * as brandsTypes from './index';
import { layer } from './kit';
import type * as kitTypes from './kit';

const cache = new Map<string, Texture>();

/** The texture's mark height in pixels for a lockup `h` units tall: about two pixels a unit, so a close camera still reads it sharp. */
const brandPx = (h: number): number => Math.round(Math.min(512, Math.max(96, h * 2)));

export interface BrandSpriteOpts extends brandsTypes.LockupOpts {
  /** The sprite's opacity (default 1). */
  alpha?: number;
  /** The texture's mark height in pixels (default `brandPx(h)`). */
  px?: number;
}

/**
 * A maker's lockup as a sprite: the mark `h` units tall, its word beside it, both centred on y, and x its left end, centre or right end
 * (`o.align`, default the centre). `o.acc` null prints it in the ink alone (an etching, a deboss, a silkscreen).
 */
/** A canvas Pixi can upload, or null where there is none (the tests run without a DOM, or with a stub of it). */
function canvasFor(w: number, h: number): ReturnType<typeof layer> | null {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') {
    return null;
  }
  const l = layer(w, h);
  const real =
    (typeof HTMLCanvasElement !== 'undefined' && l.cv instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && l.cv instanceof OffscreenCanvas);
  return real ? l : null;
}

export function brandSprite(
  id: kitTypes.BrandId,
  x: number,
  y: number,
  h: number,
  ink: string,
  o: BrandSpriteOpts = {},
): Sprite {
  const px = o.px ?? brandPx(h),
    pad = 4,
    align = o.align ?? 'center',
    w = lockupWidth(id, px, o);
  const key = JSON.stringify([id, ink, o.acc, o.cap, o.mark, o.word, o.text, px]);
  let tex = cache.get(key);
  if (!tex) {
    const l = canvasFor(w + pad * 2, px + pad * 2);
    if (!l) {
      // no canvas to paint on: an empty sprite in its place
      const s = new Sprite(Texture.EMPTY);
      s.position.set(x, y);
      return s;
    }
    drawLockup(l.c, id, pad, pad + px / 2, px, ink, { ...o, align: 'left' });
    tex = Texture.from(l.cv as HTMLCanvasElement);
    cache.set(key, tex);
  }
  const s = new Sprite(tex),
    ax = pad + (align === 'center' ? w / 2 : align === 'right' ? w : 0);
  s.anchor.set(ax / tex.width, 0.5);
  s.scale.set(h / px);
  s.position.set(x, y);
  s.alpha = o.alpha ?? 1;
  return s;
}
