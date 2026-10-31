import type { Graphics } from 'pixi.js';
import { mix } from '@/core/render/ink';

// The coffee mug on the desk, seen from a little above: every circle of it (the rim, the coffee, the printed rings, the base, the coaster) is the same ellipse,
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

/** The ink of the print: the same red as the rest of the room's accents. */
const INK = '#d03a4a';

/** A ring of the body between heights `y1` and `y2`, following the curve top and bottom. */
function ring(o: Graphics, mx: number, top: number, foot: number, y1: number, y2: number, color: string, alpha = 1) {
  o.poly([...frontArc(mx, y1, mugRadius(y1, top, foot), true), ...frontArc(mx, y2, mugRadius(y2, top, foot), false)]).fill({ color, alpha });
}

/** A strip of the body from `c0` to `c1` of the radius east of the centre (1 is the right edge), the angle of the lit side's shading. */
function strip(o: Graphics, mx: number, top: number, foot: number, c0: number, c1: number, color: string, alpha: number) {
  const { r: R, rb: Rb, e } = MUG, pts: number[] = [mx + R * c0, top, mx + R * c1, top];
  const a1 = Math.acos(c1), a0 = Math.acos(c0);
  for (let k = 0; k <= 8; k++) { const a = a1 + ((a0 - a1) * k) / 8; pts.push(mx + Rb * Math.cos(a), foot + Rb * e * Math.sin(a)); }
  o.poly(pts).fill({ color, alpha });
}

/** The chip die printed on the front: a square die with pins on every side, a notch at one corner and a core inside. `s` is the die's side. */
function drawDie(o: Graphics, cx: number, cy: number, s: number, k: number) {
  const w = s * k, h = s, pin = 34, n = 4, gap = s / (n + 1);
  for (let i = 1; i <= n; i++) {
    const x = cx - w / 2 + (w * i) / (n + 1), y = cy - h / 2 + gap * i;
    o.rect(x - 9 * k, cy - h / 2 - pin, 18 * k, pin).fill({ color: INK });
    o.rect(x - 9 * k, cy + h / 2, 18 * k, pin).fill({ color: INK });
    o.rect(cx - w / 2 - pin * k, y - 9, pin * k, 18).fill({ color: INK });
    o.rect(cx + w / 2, y - 9, pin * k, 18).fill({ color: INK });
  }
  o.roundRect(cx - w / 2, cy - h / 2, w, h, 26).fill({ color: INK });
  o.roundRect(cx - w * 0.34, cy - h * 0.34, w * 0.68, h * 0.68, 14).stroke({ width: 8, color: '#ffffff', alpha: 0.9 });
  o.roundRect(cx - w * 0.17, cy - h * 0.17, w * 0.34, h * 0.34, 8).fill({ color: '#ffffff', alpha: 0.9 });
  o.circle(cx - w * 0.38, cy - h * 0.38, 15).fill({ color: '#ffffff', alpha: 0.9 });
}

/** Draw the mug standing at `mx` on the desk top `ys`. */
export function drawMug(o: Graphics, dark: boolean, mx: number, ys: number, cork: string) {
  const { h, r: R, rb: Rb, e } = MUG, top = ys - h, foot = ys - 20;
  const ceramic = dark ? '#eaeef8' : '#ffffff', ceramicLo = dark ? '#aeb8d4' : '#cdd5e4', rim = dark ? '#7e89aa' : '#9aa6bf';
  // the coaster (a rim line, a lit top, a groove), and the mug's shadow on the desk (thrown east, away from the lamp)
  o.ellipse(mx + 420, ys + 22, 1150, 56).fill({ color: '#000000', alpha: 0.26 });
  o.ellipse(mx, ys - 8, 800, 800 * e).fill({ color: mix(cork, '#000000', 0.25) });
  o.ellipse(mx, ys - 20, 800, 800 * e).fill({ color: cork }).stroke({ width: 6, color: '#000000', alpha: 0.3 });
  o.ellipse(mx, ys - 20, 700, 700 * e).stroke({ width: 4, color: '#000000', alpha: 0.18 });
  o.ellipse(mx, ys - 24, 640, 640 * e).fill({ color: mix(cork, '#ffffff', 0.15), alpha: 0.7 });
  // the handle: a loop that leaves the body's right side at two heights, behind the body (which covers its ends); an outline, the glaze, a lit line
  const ha = top + 330, hb = top + 930, xa = mx + mugRadius(ha, top, foot) - 30, xb = mx + mugRadius(hb, top, foot) - 30;
  const loop = (dx: number, dy: number) => o.moveTo(xa + dx, ha + dy).bezierCurveTo(xa + 540 + dx, ha - 70 + dy, xb + 540 + dx, hb + 70 + dy, xb + dx, hb + dy);
  loop(0, 0).stroke({ width: 140, color: rim, alpha: 0.85, cap: 'round' });
  loop(0, 0).stroke({ width: 124, color: ceramicLo, cap: 'round' });
  loop(-4, -4).stroke({ width: 76, color: ceramic, cap: 'round' });
  loop(-14, -10).stroke({ width: 16, color: '#ffffff', alpha: dark ? 0.5 : 0.85, cap: 'round' });
  // the body: straight sides to the base and the base's front arc, with a rim line
  o.poly([mx - R, top, mx + R, top, ...frontArc(mx, foot, Rb, false)]).fill({ color: ceramic }).stroke({ width: 9, color: rim, alpha: 0.9 });
  // the round shading: darker toward the right (away from the lamp), a cool bounce at the very edge, a lit stripe on the left
  strip(o, mx, top, foot, 0.7, 1, '#1a2238', 0.07);
  strip(o, mx, top, foot, 0.4, 1, '#1a2238', 0.08);
  strip(o, mx, top, foot, 0.1, 1, '#1a2238', 0.08);
  strip(o, mx, top, foot, 0.92, 1, '#8fb4ff', 0.3);
  o.roundRect(mx - R + 90, top + 140, 100, h - 330, 50).fill({ color: '#ffffff', alpha: dark ? 0.5 : 0.8 });
  o.roundRect(mx - R + 210, top + 200, 34, h - 450, 17).fill({ color: '#ffffff', alpha: dark ? 0.25 : 0.45 });
  // the foot: a darker ring above the base
  ring(o, mx, top, foot, foot - 70, foot, '#1a2238', 0.1);
  // the rim, the inside wall (lit on the far side), the coffee with its crema ring and a lamp glint
  o.ellipse(mx, top, R, R * e).fill({ color: ceramic }).stroke({ width: 9, color: rim, alpha: 0.9 });
  o.ellipse(mx, top + 4, R - 48, (R - 48) * e).fill({ color: ceramicLo });
  o.ellipse(mx, top + 14, R - 52, (R - 52) * e - 4).fill({ color: mix(ceramicLo, '#000000', 0.18) });
  o.ellipse(mx, top + 24, R - 82, (R - 82) * e).fill({ color: '#25140c' });
  o.ellipse(mx, top + 24, R - 110, (R - 110) * e).fill({ color: '#4a2a18' });
  o.ellipse(mx - 140, top + 22, 170, 170 * e).fill({ color: '#7a4a2e', alpha: 0.6 });
  o.ellipse(mx - 190, top + 20, 70, 70 * e).fill({ color: '#ffe2b8', alpha: 0.55 });
  // the print: a thin line under the rim and one above the foot, and the chip die on the front (every ring follows the body's curve)
  ring(o, mx, top, foot, top + 170, top + 205, INK, 0.9);
  ring(o, mx, top, foot, foot - 190, foot - 155, INK, 0.9);
  const dy = top + 690, rd = mugRadius(dy, top, foot), dx = -60, k = Math.sqrt(Math.max(0.1, 1 - (dx / rd) ** 2));
  drawDie(o, mx + dx, dy + rd * e * k, 400, k);
}
