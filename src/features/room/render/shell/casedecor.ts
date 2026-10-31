import { Graphics } from 'pixi.js';
import { disc, lgrad, mix } from '@/core/render/ink';
import { BR, CASE_GLASS, type Rect } from '@/features/board/render/layout/layout';

export type CaseKind = 'oem' | 'matte' | 'gamer' | 'show';
/** The look of each case tier, Mini to Full. The outside (exterior.ts) and the inside (desk/props/case.ts) both read it, so they cannot drift. */
export const CASE_KIND: readonly CaseKind[] = ['oem', 'matte', 'gamer', 'show'];

/**
 * The glass window of a case, in world units, the same for the outside (the hole in the body) and the inside (the glass sheen): none on the
 * OEM tower's solid side (the box is its whole side), the upper part on the matte case, all of it between the pillars on the showcase.
 */
export function caseWindow(kind: CaseKind): Rect {
  const gl = CASE_GLASS, x0 = BR.io.x + BR.io.w + 110, x1 = gl.x + gl.w - 56 - (kind === 'show' ? 640 : 0), inset = kind === 'show' ? 200 : 56;
  return { x: x0, y: gl.y + inset, w: x1 - x0, h: (gl.h - 2 * inset) * (kind === 'matte' ? 0.74 : 1) };
}

/** The showcase's two silver pillars either side of its window (the west one is slim, over the end of the I/O plate; the east one is the wide front upright). Outside and inside draw the same ones. */
export function showPillars(win: Rect, bezel = 44): [Rect, Rect] {
  const gl = CASE_GLASS, py = gl.y + 12, ph = gl.h - 24;
  return [{ x: win.x - bezel - 200, y: py, w: 190, h: ph }, { x: win.x + win.w + bezel + 20, y: py, w: 520, h: ph }];
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
/** The corner cuts of each kind's body: only the showcase is machined with chamfered corners (the rest are rounded boxes). */
export const CASE_CUTS: Record<CaseKind, Cuts> = { oem: SQUARE, matte: SQUARE, gamer: SQUARE, show: [400, 400, 250, 250] };
/** The corner cuts of each kind's window: the gaming case has one cut corner, the showcase four. The outside and the glass sheen inside both read them. */
export const WINDOW_CUTS: Record<CaseKind, Cuts> = { oem: SQUARE, matte: SQUARE, gamer: [0, 460, 0, 0], show: [420, 420, 420, 420] };

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

/** A vertical anodised bar: lit on its west half, shaded on its east half, a dark seam in the middle and a lit top. */
export function pillar(g: Graphics, r: Rect, hi: string, lo: string, edge: string) {
  g.rect(r.x, r.y, r.w, r.h).fill(lgrad(hi, lo, [1, 0])).stroke({ width: 5, color: edge, alpha: 0.8 });
  g.rect(r.x + r.w * 0.5 - 3, r.y, 6, r.h).fill({ color: '#000000', alpha: 0.28 });
  g.rect(r.x + r.w * 0.16, r.y + 6, r.w * 0.1, r.h - 12).fill({ color: '#ffffff', alpha: 0.3 });
  g.rect(r.x, r.y, r.w, 8).fill({ color: '#ffffff', alpha: 0.4 });
}

/** A black corner bracket (a right triangle in the case's corner, `dx` and `dy` point into the case) with a rivet. */
export function bracket(g: Graphics, x: number, y: number, dx: number, dy: number, s: number, tone: string, rim: string) {
  g.poly([x, y, x + dx * s, y, x, y + dy * s]).fill(tone).stroke({ width: 5, color: rim, alpha: 0.6 });
  g.poly([x + dx * s * 0.12, y + dy * s * 0.12, x + dx * s * 0.62, y + dy * s * 0.12, x + dx * s * 0.12, y + dy * s * 0.62]).fill({ color: '#ffffff', alpha: 0.07 });
  screw(g, x + dx * s * 0.22, y + dy * s * 0.22, s * 0.07, mix(tone, '#ffffff', 0.35), rim);
}

/** The edge of a chamfered box as a bevel: the edges that face up and west are lit, those that face down and east are shaded (the polygon twin of `bevel` in exterior.ts). */
export function chamferFrame(g: Graphics, r: Rect, cuts: Cuts, dark: boolean, a = 1, width = 6) {
  const p = cutRect(r.x, r.y, r.w, r.h, cuts);
  for (const lit of [true, false]) {
    for (let i = 0; i < p.length; i += 2) {
      const x0 = p[i]!, y0 = p[i + 1]!, x1 = p[(i + 2) % p.length]!, y1 = p[(i + 3) % p.length]!, dx = x1 - x0, dy = y1 - y0;
      if (!dx && !dy) continue;
      const face = dx - dy; // > 0 faces up and west (the polygon runs clockwise)
      if (lit ? face <= 0 : face >= 0) continue;
      g.moveTo(x0, y0).lineTo(x1, y1);
    }
    g.stroke(lit ? { width, color: '#ffffff', alpha: (dark ? 0.16 : 0.6) * a, cap: 'round' } : { width, color: '#000000', alpha: (dark ? 0.45 : 0.22) * a, cap: 'round' });
  }
}

/** A glowing line along a closed outline: a wide faint halo, a narrower glow, a bright core. */
export function glowPoly(g: Graphics, pts: number[], col: string, core: number, halo = 1) {
  g.poly(pts).stroke({ width: core * 7, color: col, alpha: 0.07 * halo, join: 'round' });
  g.poly(pts).stroke({ width: core * 3, color: col, alpha: 0.16 * halo, join: 'round' });
  g.poly(pts).stroke({ width: core, color: col, join: 'round' });
}

/** A lit fan window on a rail: a dark slot with the colour pooling in its lower half and a bright ring line (a ring fan under the rail). */
export function fanWindow(g: Graphics, r: Rect, col: string, rim: string) {
  g.roundRect(r.x - 10, r.y - 10, r.w + 20, r.h + 20, r.h / 2 + 10).fill({ color: col, alpha: 0.14 });
  g.roundRect(r.x, r.y, r.w, r.h, r.h / 2).fill(lgrad('#04060a', mix('#04060a', col, 0.35))).stroke({ width: 5, color: rim, alpha: 0.7 });
  g.roundRect(r.x + 24, r.y + r.h * 0.58, r.w - 48, r.h * 0.18, r.h * 0.09).fill({ color: col, alpha: 0.95 });
  g.roundRect(r.x + 24, r.y + r.h * 0.2, r.w - 48, r.h * 0.07, r.h * 0.035).fill({ color: col, alpha: 0.4 });
}

/** The pipeline mark (rising bars, the one on the monitor's splash) with its square foot, `s` units tall. */
export function logoMark(g: Graphics, x: number, y: number, s: number, ink: string, acc: string) {
  const bw = s * 0.17, gap = s * 0.07;
  for (let k = 0; k < 4; k++) {
    const h = s * (0.34 + k * 0.2), bx = x + k * (bw + gap);
    g.roundRect(bx, y + s - h, bw, h, bw * 0.28).fill({ color: k === 3 ? acc : ink, alpha: k === 3 ? 1 : 0.85 });
  }
  g.roundRect(x - gap, y + s + gap, 4 * bw + 4 * gap, s * 0.07, s * 0.03).fill({ color: ink, alpha: 0.85 });
}
