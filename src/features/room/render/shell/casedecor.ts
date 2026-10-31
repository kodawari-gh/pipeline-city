import { Container, Graphics } from 'pixi.js';
import { disc } from '@/core/render/ink';
import type { Theme } from '@/core/render/theme';
import type { Rect } from '@/features/board/render/layout/layout';

// What gives each PC case its character (used by exterior.ts): the city skyline along the foot of the case, the pipeline logo mark,
// circuit traces, stickers, slashes and rivets. Static art, drawn once into the baked exterior texture. Sizes are world units: the
// whole case is about 9000 wide and is seen at about 0.06 px per unit, so a stroke under 20 units is lost.

/** Which pieces a case tier carries. */
export interface CaseLook {
  /** How tall the skyline grows, as a share of its band. */
  rise: number;
  /** Stickers on the top panel. */
  stickers: number;
  /** Aggressive slashes on the top panel instead of stickers. */
  slashes: boolean;
  /** Brass rivets on the corners of the lower panel and the badge. */
  rivets: boolean;
  /** Circuit traces that run out of the glass bezel. */
  traces: boolean;
  /** A tower crane on the skyline. */
  crane: boolean;
}

/** A tiny deterministic generator, so the art is the same on every build and in every test. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export interface CityOpts { seed: number; look: CaseLook; acc: string; shade: string; metal: string }

/** The city: towers with lit windows over a ground pipe with flanges (the pipeline), across `r.w`, standing on `base`. */
export function skyline(g: Graphics, T: Theme, r: Rect, base: number, o: CityOpts) {
  const rn = rng(o.seed), maxH = r.h * o.look.rise, d = T.dark;
  const body = { color: o.shade, alpha: d ? 0.92 : 0.6 };
  const x1 = r.x + r.w;
  let x = r.x, tallest = { x: r.x, h: 0 };
  while (x < x1 - 80) {
    const w = Math.min(x1 - x, 150 + Math.floor(rn() * 170)), h = 90 + Math.floor(rn() * rn() * (maxH - 90));
    g.rect(x, base - h, w, h).fill(body);
    g.rect(x, base - h, w, 8).fill({ color: '#ffffff', alpha: d ? 0.12 : 0.4 });
    const roof = rn();
    if (roof < 0.25) g.rect(x + w * 0.42, base - h - 70, 18, 70).fill(body); // an aerial
    else if (roof < 0.4) g.rect(x + w * 0.2, base - h - 34, w * 0.6, 34).fill(body); // a water tank
    for (let wy = base - h + 34; wy < base - 60; wy += 62) for (let wx = x + 24; wx < x + w - 38; wx += 52) {
      const lit = rn() < 0.34;
      g.rect(wx, wy, 26, 32).fill({ color: lit ? o.acc : '#ffffff', alpha: lit ? 0.9 : d ? 0.05 : 0.12 });
    }
    if (h > tallest.h) tallest = { x: x + w / 2, h };
    x += w + 16;
  }
  if (o.look.crane) {
    const cx = tallest.x, top = base - tallest.h - 150;
    g.moveTo(cx, base - tallest.h).lineTo(cx, top).moveTo(cx - 170, top + 22).lineTo(cx + 320, top + 22).moveTo(cx + 270, top + 22).lineTo(cx + 270, top + 120)
      .moveTo(cx, top).lineTo(cx + 320, top + 22).moveTo(cx, top).lineTo(cx - 170, top + 22)
      .stroke({ width: 12, color: o.shade, alpha: d ? 0.75 : 0.5, join: 'round' });
    g.circle(cx - 170, top + 22, 16).fill({ color: o.acc, alpha: 1 });
  }
  // the ground pipe: a steel run with a flange every few hundred units and an accent light on it
  const py = base - 22;
  g.rect(r.x, py - 22, r.w, 44).fill({ color: o.metal, alpha: 1 });
  g.rect(r.x, py - 22, r.w, 8).fill({ color: '#ffffff', alpha: d ? 0.2 : 0.5 });
  g.rect(r.x, py + 12, r.w, 10).fill({ color: '#000000', alpha: d ? 0.4 : 0.2 });
  for (let fx = r.x + 260; fx < x1 - 100; fx += 620) {
    g.roundRect(fx - 18, py - 36, 36, 72, 8).fill({ color: o.metal }).stroke({ width: 4, color: '#000000', alpha: 0.35 });
    g.roundRect(fx - 18, py - 36, 36, 10, 5).fill({ color: '#ffffff', alpha: d ? 0.2 : 0.5 });
  }
  for (let fx = r.x + 570; fx < x1 - 100; fx += 1240) g.circle(fx, py, 10).fill({ color: o.acc });
}

/** The pipeline mark (rising bars, the one on the monitor's splash) with its square foot, `s` units tall. */
export function logoMark(g: Graphics, x: number, y: number, s: number, ink: string, acc: string) {
  const bw = s * 0.17, gap = s * 0.07;
  for (let k = 0; k < 4; k++) {
    const h = s * (0.34 + k * 0.2), bx = x + k * (bw + gap);
    g.roundRect(bx, y + s - h, bw, h, bw * 0.28).fill({ color: k === 3 ? acc : ink, alpha: k === 3 ? 1 : 0.85 });
    g.roundRect(bx, y + s - h, bw, bw * 0.3, bw * 0.15).fill({ color: '#ffffff', alpha: 0.25 });
  }
  g.roundRect(x - gap, y + s + gap, 4 * bw + 4 * gap, s * 0.07, s * 0.03).fill({ color: ink, alpha: 0.85 });
}

/** Traces that leave the bezel's lower edge and run sideways with 45 degree jogs, ending in a solder pad: the machine's veins. */
export function traces(g: Graphics, band: Rect, acc: string, glow: boolean, seed: number) {
  const rn = rng(seed), a = glow ? 0.85 : 0.5, y0 = band.y, y1 = band.y + band.h;
  const run = (x: number, dir: 1 | -1, lane: number) => {
    let px = x, py = y0 + 10, down = true;
    g.moveTo(px, py);
    const steps = 3 + Math.floor(rn() * 2);
    for (let k = 0; k < steps; k++) {
      const len = 160 + rn() * 260;
      const dy = Math.min(y1 - 30 - py, 40 + lane * 22 + rn() * 60) * (down ? 1 : -1);
      px += dir * (len + Math.abs(dy)); py += dy;
      g.lineTo(px - dir * Math.abs(dy), py - dy).lineTo(px, py);
      down = py < y0 + band.h * 0.5;
    }
    g.stroke({ width: 26, color: acc, alpha: a, cap: 'round', join: 'round' });
    disc(g, px, py, 46, { fill: acc, fa: a, stroke: '#000000', lw: 8, sa: 0.4 });
    disc(g, px, py, 16, { fill: '#000000', fa: 0.7 });
    if (glow) disc(g, px, py, 90, { fill: acc, fa: 0.1 });
  };
  const w = band.w;
  for (let k = 0; k < 4; k++) { run(band.x + 140 + k * 70, 1, k); run(band.x + w - 140 - k * 70, -1, k); }
}

/** Slashes cut across the top panel (the black case's menace). */
export function slashes(g: Graphics, z: Rect, acc: string, cut: string) {
  const n = Math.max(2, Math.floor(z.w / 150));
  for (let k = 0; k < n; k++) {
    const x = z.x + k * (z.w / n), w = 56 + (k % 3) * 22;
    g.poly([x + 90, z.y, x + 90 + w, z.y, x + w, z.y + z.h, x, z.y + z.h]).fill({ color: k % 4 === 3 ? acc : cut, alpha: k % 4 === 3 ? 0.9 : 0.85 });
  }
}

/** Brass rivets (a lit cap on a dark seat). */
export function rivets(g: Graphics, pts: [number, number][], col: string) {
  for (const [x, y] of pts) {
    disc(g, x, y, 24, { fill: '#000000', fa: 0.4 });
    disc(g, x - 2, y - 3, 20, { fill: col, stroke: '#000000', lw: 3, sa: 0.4 });
    disc(g, x - 8, y - 9, 6, { fill: '#ffffff', fa: 0.55 });
  }
}

/** Stickers on the top panel, a little crooked: a chip with eyes, a warning, a bug crossed out, a pipeline tag. */
export function stickers(root: Container, z: Rect, n: number, T: Theme, seed: number) {
  const rn = rng(seed), ink = '#10162a', paper = [T.ld, '#f2f4fb', T.alu, T.br], u = Math.min(z.h, 250);
  const kinds = [0, 2, 1, 3];
  for (let i = 0; i < n; i++) {
    const kind = kinds[i % 4]!, s = new Container(), g = new Graphics(), col = paper[kind]!;
    s.position.set(z.x + (z.w * (i + 0.5)) / n, z.y + z.h / 2 + (rn() - 0.5) * 24);
    s.rotation = (rn() - 0.5) * 0.4;
    g.roundRect(-u / 2 + 8, -u / 2 + 12, u, u, u * 0.2).fill({ color: '#000000', alpha: 0.35 });
    g.roundRect(-u / 2, -u / 2, u, u, u * 0.2).fill(col).stroke({ width: 7, color: '#ffffff', alpha: 0.85 });
    if (kind === 0) {
      g.roundRect(-u * 0.27, -u * 0.22, u * 0.54, u * 0.44, 12).fill(ink);
      for (const sx of [-1, 1]) {
        g.circle(sx * u * 0.1, -u * 0.04, u * 0.075).fill('#ffffff'); g.circle(sx * u * 0.1 + 4, -u * 0.03, u * 0.035).fill(ink);
        for (const sy of [-0.1, 0.1]) g.moveTo(sx * u * 0.27, sy * u).lineTo(sx * u * 0.38, sy * u).stroke({ width: 12, color: ink, cap: 'round' });
      }
      g.moveTo(-u * 0.09, u * 0.1).quadraticCurveTo(0, u * 0.19, u * 0.09, u * 0.1).stroke({ width: 8, color: '#ffffff', cap: 'round' });
    } else if (kind === 1) {
      g.poly([0, -u * 0.36, u * 0.38, u * 0.3, -u * 0.38, u * 0.3]).fill(ink);
      g.rect(-8, -u * 0.12, 16, u * 0.24).fill(col); g.circle(0, u * 0.2, 10).fill(col);
    } else if (kind === 2) {
      g.ellipse(0, 0, u * 0.14, u * 0.2).fill(ink);
      for (const sy of [-1, 0, 1]) for (const sx of [-1, 1]) g.moveTo(sx * u * 0.12, sy * u * 0.1).lineTo(sx * u * 0.3, sy * u * 0.18).stroke({ width: 9, color: ink, cap: 'round' });
      g.moveTo(-u * 0.36, -u * 0.36).lineTo(u * 0.36, u * 0.36).stroke({ width: 18, color: '#d23b3b', cap: 'round' });
    } else logoMark(g, -u * 0.27, -u * 0.3, u * 0.5, ink, '#d23b3b');
    s.addChild(g);
    root.addChild(s);
  }
}
