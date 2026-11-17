import { Container, Graphics } from 'pixi.js';
import type { BrandId } from '@/core/render/brands';
import { brandSprite } from '@/core/render/brands/pixi';
import { disc } from '@/core/render/ink';
import { BR, CASE_GLASS, type Rect } from '@/features/board/render/layout/layout';

export type CaseKind = 'oem' | 'matte' | 'gamer' | 'show';
/** The look of each case tier, Mini to Full. The outside (exterior.ts) and the inside (desk/props/case.ts) both read it, so they cannot drift. */
export const CASE_KIND: readonly CaseKind[] = ['oem', 'matte', 'gamer', 'show'];

/**
 * The glass window of a case, in world units, the same for the outside (the hole in the body) and the inside (the glass sheen): none on the
 * OEM tower's solid side (the box is its whole side), the upper part on the matte case, the full front on the gaming case and the showcase.
 */
export function caseWindow(kind: CaseKind): Rect {
  const gl = CASE_GLASS, x0 = BR.io.x + BR.io.w + 110, x1 = gl.x + gl.w - 56, inset = 56;
  return { x: x0, y: gl.y + inset, w: x1 - x0, h: (gl.h - 2 * inset) * (kind === 'matte' ? 0.74 : 1) };
}

// Drawing helpers for the PC case exteriors (exterior.ts): the shapes that make one tier look like a real case of its kind. Static art,
// drawn once into the baked exterior texture. Sizes are world units: a case is about 9000 wide and is seen at about 0.06 px per unit, so a
// stroke under 20 units is lost at the overview and shows only when the camera comes close.

/** Corner cuts, clockwise from the top left: top left, top right, bottom right, bottom left (0 = square). */
export type Cuts = [number, number, number, number];

/** The points of a rectangle with its corners cut at 45 degrees. */
export function cutRect(x: number, y: number, w: number, h: number, [tl, tr, br, bl]: Cuts): number[] {
  return [x + tl, y, x + w - tr, y, x + w, y + tr, x + w, y + h - br, x + w - br, y + h, x + bl, y + h, x, y + h - bl, x, y + tl];
}

const SQUARE: Cuts = [0, 0, 0, 0];
/** The corner cuts of each kind's body: none (every case is a box with square or rounded corners; the showcase is a plain box too). */
export const CASE_CUTS: Record<CaseKind, Cuts> = { oem: SQUARE, matte: SQUARE, gamer: SQUARE, show: SQUARE };
/** The corner cuts of each kind's window: the gaming case has one cut corner, the others none. The outside and the glass sheen inside both read them. */
export const WINDOW_CUTS: Record<CaseKind, Cuts> = { oem: SQUARE, matte: SQUARE, gamer: [0, 460, 0, 0], show: SQUARE };

/** The cuts of a box grown by `d` on every side (a cut grows with it so the edges stay parallel); a square corner stays square. */
export const growCuts = (c: Cuts, d: number): Cuts => c.map((v) => (v ? Math.max(0, v + d) : 0)) as Cuts;

/** True if any corner is cut. */
export const isCut = (c: Cuts) => c.some((v) => v > 0);

/** A rounded box, or a box with cut corners when `cuts` is given. Returns the graphics for `.fill()` / `.stroke()`. */
export function outline(g: Graphics, x: number, y: number, w: number, h: number, r: number, cuts?: Cuts): Graphics {
  return cuts ? g.poly(cutRect(x, y, w, h, cuts)) : g.roundRect(x, y, w, h, r);
}

/** A grid of round holes (staggered rows) inside `r`; the caller fills. */
export function holes(g: Graphics, r: Rect, pitch: number, rad: number) {
  for (let y = r.y + pitch / 2, k = 0; y < r.y + r.h; y += pitch * 0.87, k++) for (let x = r.x + pitch / 2 + (k % 2) * (pitch / 2); x < r.x + r.w - pitch / 4; x += pitch) g.circle(x, y, rad);
}

/** A honeycomb (pointy hexagons, `s` the side) inside `r`; the caller fills. */
export function hexes(g: Graphics, r: Rect, s: number, gap: number) {
  const w = Math.sqrt(3) * s, hs = s - gap * 0.6;
  for (let y = r.y + s, k = 0; y < r.y + r.h - s * 0.5; y += s * 1.5, k++) for (let x = r.x + w / 2 + (k % 2) * (w / 2); x < r.x + r.w - w / 2 + 1; x += w) {
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; pts.push(x + Math.cos(a) * hs, y + Math.sin(a) * hs); }
    g.poly(pts);
  }
}

/** Slanted vent slots (parallelograms leaning east), `n` of them side by side in `r`; the caller fills. */
export function slots(g: Graphics, r: Rect, n: number, lean: number) {
  const pitch = r.w / n, w = pitch * 0.5;
  for (let k = 0; k < n; k++) { const x = r.x + k * pitch; g.poly([x + lean, r.y, x + lean + w, r.y, x + w, r.y + r.h, x, r.y + r.h]); }
}

/** A screw head: a disc with a slot, lit from the top left. */
export function screw(g: Graphics, x: number, y: number, r: number, tone: string, edge: string) {
  disc(g, x, y, r, { fill: tone, stroke: edge, lw: Math.max(3, r * 0.14), sa: 0.8 });
  disc(g, x - r * 0.25, y - r * 0.3, r * 0.3, { fill: '#ffffff', fa: 0.25 });
  g.moveTo(x - r * 0.55, y + r * 0.1).lineTo(x + r * 0.55, y - r * 0.1).stroke({ width: Math.max(3, r * 0.2), color: '#000000', alpha: 0.6, cap: 'round' });
}

/**
 * A maker's lockup in 2D (`core/render/brands`): its mark `h` tall and its wordmark, as on the 3D parts, added to `root` with its centre at
 * (x, y). `acc` null prints it in the ink alone.
 */
export function brandLockup(root: Container, id: BrandId, x: number, y: number, h: number, ink: string, acc: string | null = null, a = 0.85) {
  root.addChild(brandSprite(id, x, y, h, ink, { acc, alpha: a }));
}
