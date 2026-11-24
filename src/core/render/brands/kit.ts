// The shared parts of a brand (docs/brands/README.md): its record, its colour scheme and the canvas helpers its mark is drawn with.
import type { TypeStyle } from './type';

export type BrandId =
  | 'axiom'
  | 'ocula'
  | 'synapta'
  | 'sigil'
  | 'kaiju'
  | 'kura'
  | 'raiden'
  | 'fujin'
  | 'kitsune'
  | 'relay'
  | 'hako'
  | 'hikari'
  | 'pipeline';

/**
 * A brand's colour scheme. The accent is one palette neon (docs/art-style.md §2); the rest are the real materials and inks its parts wear, for
 * per-brand parts and UI. Rule C1 (art-style §4): the accent goes on the mark and on lit details only, never on a part's base paint.
 */
export interface BrandColors {
  /** Its one neon: the lit part of the mark, its LEDs and RGB. */
  accent: string;
  /** Ink on dark: prints on metal and on its plate. */
  light: string;
  /** Ink on light: prints on a white sticker. */
  dark: string;
  /** The near-black its badges and stickers sit on (a tinted charcoal, saturation ≤ 0.35). */
  plate: string;
  /** The base finish of its parts (shroud, lid, spreader, frame). */
  body: string;
  /** The real metal it trims with (palette metals: satin, bright, graphite, gold, copper). */
  trim: string;
}

export interface Brand {
  id: BrandId;
  /** The name as printed. */
  word: string;
  /** What it makes. */
  makes: string;
  /** What the mark shows, in a few words. */
  idea: string;
  colors: BrandColors;
  /** Its wordmark (`type.ts`). */
  type: TypeStyle;
  /** The mark's width for a height of 1. */
  aspect: number;
  /** The lockup (mark and word side by side), for a mark 1 tall: the word's cap height, the gap between them. */
  lockup: { cap: number; gap: number };
  /**
   * Draws the mark into a layer already scaled to its box (`aspect` wide, 1 tall, y down): `ink` the main tone, `acc` the accent (the ink again
   * for a one-tone print). The layer is the mark's own, so `knock` may clear gaps in it.
   */
  mark: (c: Ctx, ink: string, acc: string) => void;
}

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const TAU = Math.PI * 2;

/** A point at radius `r`, angle `a`, round (cx, cy). */
export const at = (cx: number, cy: number, r: number, a: number): [number, number] => [
  cx + Math.cos(a) * r,
  cy + Math.sin(a) * r,
];

/** A closed polygon as a sub-path of the current path: x0, y0, x1, y1... */
export function poly(c: Ctx, pts: readonly number[]) {
  c.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  c.closePath();
}

/** A circle as a sub-path. */
export function circle(c: Ctx, x: number, y: number, r: number) {
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU);
  c.closePath();
}

/** Fills the current path (even-odd: a sub-path inside another is a hole) and starts a new one. */
export function fill(c: Ctx, color: string) {
  c.fillStyle = color;
  c.fill('evenodd');
  c.beginPath();
}

/** Strokes the current path, `w` wide, and starts a new one. */
export function stroke(c: Ctx, color: string, w: number, cap: CanvasLineCap = 'butt', join: CanvasLineJoin = 'miter') {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineCap = cap;
  c.lineJoin = join;
  c.miterLimit = 10;
  c.stroke();
  c.beginPath();
}

/** Runs `draw` as an eraser: what it fills or strokes is cleared from the layer (the gaps between a mark's shapes). */
export function knock(c: Ctx, draw: () => void) {
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  draw();
  c.restore();
  c.beginPath();
}

/** A clear canvas `w` by `h` px (a DOM canvas on the main thread, an offscreen one elsewhere). */
export function layer(w: number, h: number): { cv: HTMLCanvasElement | OffscreenCanvas; c: Ctx } {
  const W = Math.max(1, Math.ceil(w)),
    H = Math.max(1, Math.ceil(h));
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    return { cv, c: cv.getContext('2d')! };
  }
  const cv = new OffscreenCanvas(W, H);
  return { cv, c: cv.getContext('2d')! };
}
