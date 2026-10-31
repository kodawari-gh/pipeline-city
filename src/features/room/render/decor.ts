import type { Graphics } from 'pixi.js';
import { mix } from '@/core/render/ink';
import { spreadX, spreadY, type Persp } from './persp';
import type { Theme } from '@/core/render/theme';

// The small things that make the room lived in: a plant on the desk and a rug on the floor under it. Drawn into the room's front art, so the light layer lights
// them like everything else.

export const PLANT = { w: 760, h: 1500, pot: 520 };

/** A little potted plant standing on the desk top at `x` (its centre), whose top is at `ys`. */
export function drawPlant(g: Graphics, T: Theme, x: number, ys: number) {
  const d = T.dark, pot = d ? '#7a4a3a' : '#c8744f', potHi = d ? '#965c49' : '#dd8c66', potLo = d ? '#4a2c25' : '#a05a3a', soil = d ? '#1a1210' : '#4a3626';
  const leaf = d ? '#2f7a5a' : '#4fa876', leafHi = d ? '#3f9a72' : '#6fc794', leafLo = d ? '#1d5240' : '#2f7c56';
  g.ellipse(x, ys + 12, PLANT.w * 0.5, 36).fill({ color: '#000000', alpha: d ? 0.35 : 0.2 });
  // the leaves: curved blades fanning out of the pot, each a lit side and a shaded side
  const top = ys - PLANT.pot, blades: [number, number, number][] = [[-0.62, 1.0, 0], [-0.34, 1.35, 1], [-0.1, 1.55, 0], [0.18, 1.45, 1], [0.44, 1.2, 0], [0.7, 0.9, 1], [-0.85, 0.7, 1]];
  for (const [ang, len, alt] of blades) {
    const L = PLANT.h * 0.6 * len, tx = x + Math.sin(ang) * L * 0.62, ty = top - Math.cos(ang) * L * 0.95, mx = x + Math.sin(ang) * L * 0.3, my = top - L * 0.55, w = 70 + 20 * len;
    const nx = Math.cos(ang), ny = Math.sin(ang);
    g.moveTo(x, top).quadraticCurveTo(mx - nx * w, my - ny * w * 0.2, tx, ty).quadraticCurveTo(mx + nx * w, my + ny * w * 0.2, x, top).fill({ color: alt ? leafLo : leaf });
    g.moveTo(x, top).quadraticCurveTo(mx - nx * w, my - ny * w * 0.2, tx, ty).quadraticCurveTo(mx, my, x, top).fill({ color: leafHi, alpha: 0.55 });
  }
  // the pot: a tapered body, a rim, soil
  const w0 = PLANT.w * 0.5, w1 = PLANT.w * 0.36;
  g.poly([x - w0, top, x + w0, top, x + w1, ys, x - w1, ys]).fill({ color: pot });
  g.poly([x - w0, top, x - w0 + 150, top, x - w1 + 110, ys, x - w1, ys]).fill({ color: potHi, alpha: 0.5 });
  g.poly([x + w0 - 170, top, x + w0, top, x + w1, ys, x + w1 - 120, ys]).fill({ color: potLo, alpha: 0.6 });
  g.roundRect(x - w0 - 40, top - 70, 2 * w0 + 80, 110, 30).fill({ color: potHi }).stroke({ width: 6, color: potLo, alpha: 0.6 });
  g.ellipse(x, top - 28, w0 + 4, 26).fill({ color: soil });
}

export interface RugBox extends Persp { x0: number; x1: number; floor: number }

/** A rug on the floor under the desk, in the room's perspective: its sides run to the vanishing point, and it has a border, stripes and a fringe. */
export function drawRug(g: Graphics, T: Theme, B: RugBox) {
  const d = T.dark, base = d ? '#1f3d4d' : '#6f98a8', band = d ? '#8a5a3a' : '#c98f5a', stripe = d ? '#2d5a6e' : '#8fb7c6', edge = d ? '#0e1f28' : '#4a6e7e';
  const h = B.floor - B.yH, s0 = 1.075, s1 = 1.4, w = B.x1 - B.x0, c = (B.x0 + B.x1) / 2, half = w * 0.36;
  // a point of the rug: `t` from the wall to the viewer (0 to 1), `u` across it (-1 to 1)
  const pt = (t: number, u: number): [number, number] => { const s = s0 + (s1 - s0) * t; return [spreadX(B, c + half * u, s), spreadY(B, B.floor, s)]; };
  const quad = (a: number, b: number, color: string, alpha = 1, u = 1) => g.poly([...pt(a, -u), ...pt(a, u), ...pt(b, u), ...pt(b, -u)]).fill({ color, alpha });
  g.poly([...pt(-0.02, -1.03), ...pt(-0.02, 1.03), ...pt(1.05, 1.06), ...pt(1.05, -1.06)]).fill({ color: '#000000', alpha: d ? 0.4 : 0.18 }); // its shadow
  quad(0, 1, base);
  quad(0, 0.07, band); quad(0.93, 1, band);
  for (const t of [0.22, 0.5, 0.78]) quad(t, t + 0.05, stripe);
  g.poly([...pt(0, -1), ...pt(0, 1), ...pt(1, 1), ...pt(1, -1)]).stroke({ width: 14, color: edge, alpha: 0.8 });
  // the fringe at the viewer's edge
  const [, fy] = pt(1, 0), fringe = h * 0.012;
  for (let u = -0.96; u < 0.96; u += 0.045) { const [x] = pt(1, u); g.rect(x, fy, 22 * s1, fringe).fill({ color: mix(band, '#ffffff', 0.25), alpha: 0.85 }); }
}
