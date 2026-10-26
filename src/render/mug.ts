import type { Graphics } from 'pixi.js';
import { mix } from './ink';

// The coffee mug on the desk, seen from a little above: every circle of it (the rim, the coffee, the printed band, the base, the coaster) is the same ellipse,
// squashed by `MUG.e`, so the top and the bottom agree; the body tapers a little toward its base.

/** Height, radius at the rim and at the base, and the squash of a circle (the ratio of an ellipse's height to its width). */
export const MUG = { h: 1300, r: 560, rb: 450, e: 0.12 };

/** The body's radius at height `y` (the rim at `top`, the base at `foot`). */
export const mugRadius = (y: number, top: number, foot: number) => MUG.r + (MUG.rb - MUG.r) * ((y - top) / (foot - top));

/** The lower (front) half of the circle of radius `r` at height `y`, as flat points from the left end to the right end (or back). */
export function frontArc(mx: number, y: number, r: number, leftToRight = true, n = 18): number[] {
  const out: number[] = [];
  for (let k = 0; k <= n; k++) { const a = leftToRight ? Math.PI - (k * Math.PI) / n : (k * Math.PI) / n; out.push(mx + r * Math.cos(a), y + r * MUG.e * Math.sin(a)); }
  return out;
}

/** The little towers of the band: offsets from the mug's centre, heights, widths. */
const TOWERS: [number, number, number][] = [[-410, 100, 76], [-318, 160, 68], [-232, 120, 84], [-120, 196, 76], [-26, 136, 94], [94, 178, 68], [178, 110, 84], [282, 152, 76], [366, 94, 68]];

/** Draw the mug standing at `mx` on the desk top `ys`. */
export function drawMug(o: Graphics, dark: boolean, mx: number, ys: number, cork: string) {
  const { h, r: R, rb: Rb, e } = MUG, top = ys - h, foot = ys - 20;
  const ceramic = dark ? '#eaeef8' : '#ffffff', ceramicLo = dark ? '#aeb8d4' : '#cdd5e4';
  // the coaster, and the mug's shadow on the desk (thrown east, away from the lamp)
  o.ellipse(mx, ys - 8, 800, 800 * e).fill({ color: cork }).stroke({ width: 5, color: '#000000', alpha: 0.25 });
  o.ellipse(mx, ys - 18, 750, 750 * e - 6).fill({ color: mix(cork, '#ffffff', 0.15) });
  o.ellipse(mx + 420, ys + 22, 1150, 56).fill({ color: '#000000', alpha: 0.26 });
  // the handle: a loop that leaves the body's right side at two heights, behind the body (which covers its ends)
  const ha = top + 330, hb = top + 930, xa = mx + mugRadius(ha, top, foot) - 30, xb = mx + mugRadius(hb, top, foot) - 30;
  for (const [w, c] of [[124, ceramicLo], [66, ceramic]] as const) o.moveTo(xa, ha).bezierCurveTo(xa + 540, ha - 70, xb + 540, hb + 70, xb, hb).stroke({ width: w, color: c, cap: 'round' });
  // the body: straight sides to the base and the base's front arc
  o.poly([mx - R, top, mx + R, top, ...frontArc(mx, foot, Rb, false)]).fill({ color: ceramic }).stroke({ width: 8, color: ceramicLo });
  // the shaded side (the right, away from the lamp) and the lit stripe (the left)
  const a0 = Math.acos(0.45), shade: number[] = [mx + R * 0.45, top, mx + R, top];
  for (let k = 0; k <= 8; k++) { const a = (k * a0) / 8; shade.push(mx + Rb * Math.cos(a), foot + Rb * e * Math.sin(a)); }
  o.poly(shade).fill({ color: '#000000', alpha: 0.1 });
  o.roundRect(mx - R + 90, top + 140, 100, h - 330, 50).fill({ color: '#ffffff', alpha: dark ? 0.5 : 0.8 });
  // the rim, the inside wall, the coffee
  o.ellipse(mx, top, R, R * e).fill({ color: ceramic }).stroke({ width: 8, color: ceramicLo });
  o.ellipse(mx, top + 4, R - 52, (R - 52) * e).fill({ color: ceramicLo });
  o.ellipse(mx, top + 22, R - 82, (R - 82) * e).fill({ color: '#25140c' });
  o.ellipse(mx - 140, top + 22, 170, 170 * e).fill({ color: '#7a4a2e', alpha: 0.6 });
  // the printed band, following the body's curve top and bottom, with a skyline on it whose towers sit on the curve and narrow toward the sides
  const y1 = top + 450, y2 = top + 730, r1 = mugRadius(y1, top, foot), r2 = mugRadius(y2, top, foot);
  o.poly([...frontArc(mx, y1, r1, true), ...frontArc(mx, y2, r2, false)]).fill({ color: '#d03a4a', alpha: 0.96 });
  for (const [dx, hh, ww] of TOWERS) {
    const k = Math.sqrt(Math.max(0.1, 1 - (dx / r2) ** 2)), base = y2 + r2 * e * k - 44;
    o.rect(mx + dx, base - hh, ww * Math.max(0.5, k), hh).fill({ color: '#ffffff', alpha: 0.9 });
  }
  const top1 = frontArc(mx, y1, r1, true);
  o.moveTo(top1[0]!, top1[1]!);
  for (let i = 2; i < top1.length; i += 2) o.lineTo(top1[i]!, top1[i + 1]!);
  o.stroke({ width: 12, color: '#ffffff', alpha: 0.18 });
}
