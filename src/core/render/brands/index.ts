// The makers of the parts (docs/brands/README.md): one fictional brand per kind of hardware, so a part reads by its maker the way a real
// card reads "the green eye one". Each brand is its own module (`axiom.ts`...) with its colour scheme, its wordmark's cut of the brand type
// (`type.ts`) and its mark; each has a design sheet in docs/brands/. This file draws them on a 2D canvas: 3D labels, prints, stickers and,
// through `pixi.ts`, the 2D art.
// Colour (docs/art-style.md §2, §4): the ink is the caller's, set by the print (pale on dark metal, dark on a white sticker, one tone for an
// etching or a deboss). The accent is the brand's one palette neon, on the mark (and its lit letters) only, and only where the print carries
// colour.
import { layer, type Brand, type BrandId, type Ctx } from './kit';
import { hasGlyphs, setType, typeWidth } from './type';
import { axiom } from './axiom';
import { ocula } from './ocula';
import { synapta } from './synapta';
import { sigil } from './sigil';
import { kaiju } from './kaiju';
import { kura } from './kura';
import { raiden } from './raiden';
import { fujin } from './fujin';
import { kitsune } from './kitsune';
import { relay } from './relay';
import { hako } from './hako';
import { hikari } from './hikari';
import { pipeline } from './pipeline';

export type { Brand, BrandColors, BrandId, Ctx } from './kit';
export type { TypeStyle } from './type';

export const BRANDS: Record<BrandId, Brand> = {
  axiom,
  ocula,
  synapta,
  sigil,
  kaiju,
  kura,
  raiden,
  fujin,
  kitsune,
  relay,
  hako,
  hikari,
  pipeline,
};
export const BRAND_IDS = Object.keys(BRANDS) as BrandId[];

/** The maker of each kind of part, by the part's kind (`DeviceSpec.kind` and the case). */
export const MAKER = {
  cpu: 'axiom',
  chipset: 'axiom',
  gpu: 'ocula',
  npu: 'synapta',
  tpm: 'sigil',
  ram: 'kaiju',
  storage: 'kura',
  psu: 'raiden',
  cooler: 'fujin',
  fan: 'fujin',
  board: 'kitsune',
  nic: 'relay',
  router: 'relay',
  case: 'hako',
  display: 'hikari',
} as const satisfies Record<string, BrandId>;

/** The font for small print next to a brand (specs, model numbers) and for a text the brand type has no glyph for. */
export const BRAND_FONT = 'Bahnschrift, "DIN Alternate", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/** The fallback font at `cap` px of cap height, its weight near the brand's. */
export function brandFont(id: BrandId, cap: number): string {
  const s = BRANDS[id].type.s,
    weight = s < 0.08 ? 300 : s < 0.11 ? 400 : s < 0.14 ? 500 : s < 0.18 ? 600 : s < 0.21 ? 700 : 800;
  return `${weight} ${Math.round(cap / 0.7)}px ${BRAND_FONT}`;
}

let measureCtx: Ctx | null = null;
const fallbackWidth = (id: BrandId, cap: number, text: string): number => {
  try {
    const c = (measureCtx ??= layer(1, 1).c);
    c.font = brandFont(id, cap);
    const w = c.measureText(text).width;
    if (typeof w === 'number') return w;
    throw new Error('no text metrics');
  } catch {
    return text.length * cap * 0.62;
  }
};

/** The width of a brand's word (or of `text` in its type) for a cap height `cap`. */
export function wordWidth(id: BrandId, cap: number, text = BRANDS[id].word): number {
  return hasGlyphs(text) ? typeWidth(text, BRANDS[id].type) * cap : fallbackWidth(id, cap, text);
}

/** The wordmark (or `text` in the brand's type), its left end at x and its cap height `cap` centred on y. `acc` null: no lit letters. */
export function drawWord(
  c: Ctx,
  id: BrandId,
  x: number,
  y: number,
  cap: number,
  ink: string,
  o: { acc?: string | null; text?: string | undefined } = {},
): number {
  const b = BRANDS[id],
    text = o.text ?? b.word,
    acc = o.acc === undefined ? b.colors.accent : o.acc;
  if (!hasGlyphs(text)) {
    c.save();
    c.font = brandFont(id, cap);
    c.fillStyle = ink;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.translate(x, y + cap / 2);
    if (b.type.slant) c.transform(1, 0, -b.type.slant, 1, 0, 0);
    c.fillText(text, 0, 0);
    c.restore();
    return fallbackWidth(id, cap, text);
  }
  const own = text === b.word;
  return setType(c, text, b.type, x, y, cap, ink, {
    acc,
    lit: own ? b.type.lit : undefined,
    litDots: own && b.type.litDots,
  });
}

/** The size of a device pixel in the context's units (the layer a mark is drawn in matches it); 1 for a test's stub context. */
function pxScale(c: Ctx): number {
  const t = c.getTransform();
  if (typeof t?.a !== 'number') return 1;
  return Math.max(1e-3, Math.hypot(t.a, t.b), Math.hypot(t.c, t.d));
}

/** The mark alone, `h` tall, its box's top left at (x, y). `acc` null prints it in the ink alone. Returns its width. */
export function drawMark(
  c: Ctx,
  id: BrandId,
  x: number,
  y: number,
  h: number,
  ink: string,
  acc: string | null = BRANDS[id].colors.accent,
): number {
  const b = BRANDS[id],
    w = h * b.aspect;
  // (the mark is drawn in its own layer: its gaps are cut out of it, not out of what is under it)
  const k = Math.min(pxScale(c), 4096 / Math.max(w, h)),
    pad = 2;
  const { cv, c: m } = layer(w * k + pad * 2, h * k + pad * 2);
  m.translate(pad, pad);
  m.scale(h * k, h * k);
  m.beginPath();
  b.mark(m, ink, acc ?? ink);
  c.drawImage(cv, x - pad / k, y - pad / k, cv.width / k, cv.height / k);
  return w;
}

export interface LockupOpts {
  /** The accent, or null for a one-tone print (an etching, a deboss). Default: the brand's. */
  acc?: string | null;
  /** Where x is: the lockup's left end, its centre or its right end. */
  align?: 'left' | 'center' | 'right';
  /** The word's cap height for a mark 1 tall (default: the brand's). */
  cap?: number;
  /** Print the mark, the word (both by default). */
  mark?: boolean;
  word?: boolean;
  /** Another text in place of the brand's word (a model name set in the brand's type). */
  text?: string;
}

/** The width a lockup takes for a mark `h` tall. */
export function lockupWidth(id: BrandId, h: number, o: LockupOpts = {}): number {
  const b = BRANDS[id],
    mark = o.mark !== false,
    word = o.word !== false,
    cap = h * (o.cap ?? b.lockup.cap);
  return (mark ? h * b.aspect : 0) + (mark && word ? h * b.lockup.gap : 0) + (word ? wordWidth(id, cap, o.text) : 0);
}

/** The mark and the word side by side, the mark `h` tall, both centred on y. Returns the width. */
export function drawLockup(
  c: Ctx,
  id: BrandId,
  x: number,
  y: number,
  h: number,
  ink: string,
  o: LockupOpts = {},
): number {
  const b = BRANDS[id],
    mark = o.mark !== false,
    word = o.word !== false,
    cap = h * (o.cap ?? b.lockup.cap);
  const acc = o.acc === undefined ? b.colors.accent : o.acc,
    w = lockupWidth(id, h, o);
  let x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
  if (mark) {
    drawMark(c, id, x0, y - h / 2, h, ink, acc);
    x0 += h * b.aspect + (word ? h * b.lockup.gap : 0);
  }
  if (word) drawWord(c, id, x0, y, cap, ink, { acc, text: o.text });
  return w;
}
