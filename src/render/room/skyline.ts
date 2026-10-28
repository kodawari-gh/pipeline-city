import type { Graphics } from 'pixi.js';
import { mix } from '../ink';
import type { Rect } from '../board/layout';

// What is outside the window: a night sky with stars that are scattered, not set out on a grid; clouds by day; three rows of towers with setbacks,
// antennas, water tanks, a landmark spire and windows that are lit in floors (a few of them flicker); an aircraft light that crosses the sky now
// and then. The towers and the stars are generated once from a seed (the same city every time); `drawSkyline` is the static part (redrawn when the
// light changes by a step), the rest is cheap and live.

const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
/** A stable hash of a few integers, 0..1. */
const hash = (...n: number[]) => { let h = 2166136261; for (const v of n) { h ^= v + 0x9e3779b9; h = Math.imul(h, 16777619); h ^= h >>> 13; } return ((h >>> 0) % 100003) / 100003; };

// ---------------------------------------------------------------- the stars

export interface Star {
  /** Where in the glass, 0..1 across and 0 (top) .. 1 down. */
  u: number; v: number;
  /** Radius in world units. */
  r: number;
  /** 0 white, 1 blue, 2 warm. */
  tone: number;
  /** Twinkle phase and rate. */
  ph: number; rate: number;
  /** The few brightest get a little cross. */
  sparkle: boolean;
}

/**
 * Stars: mostly faint and small, a few bright, thicker towards the top, some loose clusters and a thin drift of dust across the sky, and never two
 * close together (so it reads as a sky, not a pattern). Deterministic for a seed.
 */
export function starField(seed = 11, count = 170): Star[] {
  const r = rng(seed), out: Star[] = [];
  const clusters = Array.from({ length: 5 }, () => ({ u: 0.1 + r() * 0.8, v: 0.05 + r() * 0.5, s: 0.05 + r() * 0.06 }));
  const gauss = () => (r() + r() + r() - 1.5) / 1.5;
  for (let tries = 0; out.length < count && tries < count * 60; tries++) {
    let u: number, v: number;
    const pick = r();
    if (pick < 0.3) { const c = clusters[Math.floor(r() * clusters.length)]!; u = c.u + gauss() * c.s; v = c.v + gauss() * c.s * 1.3; }
    else if (pick < 0.5) { const t = r(); u = 0.05 + t * 0.9 + gauss() * 0.04; v = 0.62 - t * 0.5 + gauss() * 0.05; } // the dust band, rising to the east
    else { u = r(); v = Math.pow(r(), 1.4) * 0.8; }
    if (u < 0.02 || u > 0.98 || v < 0.015 || v > 0.85) continue;
    if (out.some((s) => Math.hypot((s.u - u) * 0.78, s.v - v) < 0.026)) continue;
    const m = r(), tone = r();
    out.push({ u, v, r: 11 + 56 * Math.pow(m, 4.5), tone: tone < 0.62 ? 0 : tone < 0.84 ? 1 : 2, ph: r() * 6.283, rate: 0.5 + r() * 1.3, sparkle: m > 0.94 });
  }
  return out;
}

const STAR_TONES = ['#ffffff', '#cfe0ff', '#ffe4bf'];
const STARS = starField();

/** The stars at `night` (0..1): each twinkles at its own rate; they thin out and dim towards the horizon. */
export function drawStars(g: Graphics, w: Rect, night: number, gtMs: number) {
  if (night < 0.05) return;
  for (const s of STARS) {
    const tw = 0.62 + 0.38 * Math.sin(gtMs / 1000 * s.rate * 2.1 + s.ph), a = Math.min(1, night * 1.2) * tw * (0.3 + 0.7 * Math.min(1, s.r / 40)) * (1 - s.v * 0.55);
    if (a < 0.02) continue;
    const x = w.x + s.u * w.w, y = w.y + s.v * w.h, col = STAR_TONES[s.tone]!;
    g.circle(x, y, s.r * (0.85 + 0.15 * tw)).fill({ color: col, alpha: a });
    if (s.sparkle) g.moveTo(x - s.r * 3.6, y).lineTo(x + s.r * 3.6, y).moveTo(x, y - s.r * 3.6).lineTo(x, y + s.r * 3.6).stroke({ width: 6, color: col, alpha: a * 0.5 });
  }
}

// ---------------------------------------------------------------- the clouds and the aircraft

/** Clouds drift across by day (and at dusk, tinted by the horizon); gone with the night. */
export function drawClouds(g: Graphics, w: Rect, night: number, hor: string, gtMs: number) {
  const a = (1 - night) * 0.5;
  if (a < 0.03) return;
  const col = mix(hor, '#ffffff', 0.55), span = w.w + 3200;
  for (let k = 0; k < 4; k++) {
    const x = w.x - 1600 + ((gtMs / 1000 * (22 + k * 7) + k * 1650) % span), y = w.y + w.h * (0.1 + 0.07 * k + 0.03 * Math.sin(k * 2.3)), sc = 0.8 + 0.5 * hash(k, 5);
    for (const [dx, dy, rx, ry] of [[0, 0, 520, 150], [-330, 40, 330, 110], [330, 30, 380, 120], [60, -90, 300, 130]] as const) g.ellipse(x + dx * sc, y + dy * sc, rx * sc, ry * sc).fill({ color: col, alpha: a });
  }
}

/** An aircraft's lights cross the night sky now and then (red and white, blinking). */
export function drawAircraft(g: Graphics, w: Rect, night: number, gtMs: number) {
  if (night < 0.4) return;
  const period = 75000, t = (gtMs % period) / period;
  if (t > 0.45) return;
  const u = t / 0.45, x = w.x + w.w * (1.05 - 1.1 * u), y = w.y + w.h * (0.2 - 0.07 * u);
  const blink = Math.floor(gtMs / 450) % 3;
  g.circle(x, y, 20).fill({ color: blink === 0 ? '#ffffff' : '#ff4a4a', alpha: night * (blink === 2 ? 0.35 : 0.95) });
  g.circle(x + 130, y + 8, 14).fill({ color: '#6dffa6', alpha: night * 0.6 });
}

// ---------------------------------------------------------------- the towers

export type Roof = 'flat' | 'step' | 'spire' | 'tank' | 'slope' | 'dish' | 'antenna';
export interface Tower {
  /** Left edge from the glass's left (units), width, height above the glass's bottom. */
  x: number; w: number; h: number;
  /** 0 far, 1 middle, 2 near. */
  layer: 0 | 1 | 2;
  roof: Roof;
  /** The share of lit windows, and a number of its own for the hash. */
  lit: number; id: number;
  /** A blinking red light on top. */
  beacon: boolean;
}

/** How much the towers grow with the glass's height: they do not stretch with a tall window (the sky does), up to a quarter more than at 6400. */
export const skylineK = (height: number) => Math.min(1.25, height / 6400);

/** The city for a window `width` wide and `height` tall: three rows of towers, a landmark spire in the middle row. Deterministic. */
export function towers(width: number, height: number, seed = 5): Tower[] {
  const r = rng(seed), out: Tower[] = [], k = skylineK(height);
  const roofs: Roof[] = ['flat', 'step', 'slope', 'tank', 'antenna', 'dish', 'step', 'flat'];
  let id = 1;
  for (const [layer, wMin, wSpan, hMin, hSpan, gap] of [[0, 330, 420, 700, 1500, 30], [1, 480, 620, 600, 1900, 50], [2, 640, 760, 380, 1050, 90]] as const) {
    let x = -200 - r() * 300;
    while (x < width + 200) {
      const w = wMin + r() * wSpan, h = (hMin + Math.pow(r(), 1.5) * hSpan) * k;
      const roof = roofs[Math.floor(r() * roofs.length)]!;
      out.push({ x, w, h, layer, roof: layer === 0 && roof === 'tank' ? 'flat' : roof, lit: 0.3 + r() * 0.5, id: id++, beacon: layer < 2 && h > 1500 * k && r() < 0.55 });
      x += w + gap * (0.3 + r() * 1.5);
    }
  }
  // the landmark: a tall slim tower with a spire, a third of the way across
  const lw = 560, lh = 3700 * k;
  out.push({ x: width * 0.58 - lw / 2, w: lw, h: lh, layer: 1, roof: 'spire', lit: 0.7, id: id++, beacon: true });
  return out.sort((a, b) => a.layer - b.layer);
}

const TOWERS = new Map<string, Tower[]>();
const towersFor = (w: Rect) => { const key = `${Math.round(w.w)}x${Math.round(w.h)}`; let t = TOWERS.get(key); if (!t) { t = towers(w.w, w.h); TOWERS.set(key, t); } return t; };

/** The window grid of a tower: the cell size by layer. */
const CELL = [{ cw: 120, ch: 170, ww: 54, wh: 80 }, { cw: 160, ch: 220, ww: 70, wh: 110 }, { cw: 210, ch: 290, ww: 100, wh: 150 }] as const;

const windowOn = (b: Tower, c: number, r: number) => hash(b.id, r, 7) < 0.55 ? hash(b.id, c, r) < b.lit + 0.35 : hash(b.id, c, r) < b.lit * 0.35; // lit in floors
/** The windows that flicker (a few on the middle and near towers): where, in world units from the glass's corner, and a period and an offset. */
export interface Flicker { x: number; y: number; w: number; h: number; period: number; off: number }
export function flickers(w: Rect): Flicker[] {
  const out: Flicker[] = [];
  for (const b of towersFor(w)) {
    if (b.layer === 0) continue;
    const cell = CELL[b.layer], cols = Math.floor((b.w - 60) / cell.cw), rows = Math.floor((b.h - 160) / cell.ch);
    for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) if (hash(b.id, c, rr, 31) < 0.045) out.push({ x: b.x + 40 + c * cell.cw, y: w.h - b.h + 90 + rr * cell.ch, w: cell.ww, h: cell.wh, period: 6 + hash(b.id, c, rr, 3) * 14, off: hash(b.id, rr, c, 9) * 20 });
  }
  return out;
}

/**
 * The static skyline at a `night` (0..1) with `hor` the horizon's colour: hills, then three rows of towers lighter with distance (the haze), their roofs, their
 * lit windows at night (the flickering ones are `drawCityLive`), and a warm glow of streets at the bottom.
 */
export function drawSkyline(g: Graphics, w: Rect, night: number, hor: string) {
  const base = w.y + w.h, k = skylineK(w.h);
  const day = { far: mix('#8da6cc', hor, 0.35), mid: '#5d7499', near: '#3b4f74' }, ngt = { far: '#1a2150', mid: '#10163a', near: '#090d22' };
  const col = [mix(day.far, ngt.far, night), mix(day.mid, ngt.mid, night), mix(day.near, ngt.near, night)] as const;
  // hills behind everything: a soft ridge
  const hills: number[] = [w.x - 50, base + 10];
  for (let i = 0; i <= 40; i++) { const x = w.x + (w.w * i) / 40; hills.push(x, base - (700 + 380 * Math.sin(i * 0.43 + 1) + 220 * Math.sin(i * 1.1 + 2)) * k); }
  hills.push(w.x + w.w + 50, base + 10);
  g.poly(hills).fill({ color: mix(col[0], hor, 0.25) });
  for (const b of towersFor(w)) {
    const x = w.x + b.x, top = base - b.h, c = col[b.layer], cell = CELL[b.layer];
    g.rect(x, top, b.w, b.h + 10).fill({ color: c });
    // a lit edge and a shaded one: the moon or the sky from the side
    g.rect(x, top, 18, b.h + 10).fill({ color: '#ffffff', alpha: 0.05 + 0.05 * (1 - night) });
    g.rect(x + b.w - 26, top, 26, b.h + 10).fill({ color: '#000000', alpha: 0.12 });
    drawRoof(g, b, x, top, c);
    const cols = Math.floor((b.w - 60) / cell.cw), rows = Math.floor((b.h - 160) / cell.ch);
    for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
      const wx = x + 40 + cc * cell.cw, wy = top + 90 + rr * cell.ch;
      if (hash(b.id, cc, rr, 31) < 0.045 && b.layer > 0) continue; // a flickering window (live)
      if (night > 0.12 && windowOn(b, cc, rr)) {
        const t = hash(b.id, cc, rr, 4), lamp = t < 0.78 ? '#ffd27a' : t < 0.92 ? '#ffe9b8' : '#a9d8ff';
        g.rect(wx, wy, cell.ww, cell.wh).fill({ color: lamp, alpha: night * (b.layer === 0 ? 0.55 : 0.9) });
      } else if (night < 0.6) g.rect(wx, wy, cell.ww, cell.wh).fill({ color: mix(c, '#cfe0ff', 0.28), alpha: (1 - night) * 0.35 }); // day glass catches the sky
    }
  }
  // the streets glow warm under the lowest towers at night
  if (night > 0.1) for (let i = 0; i < 6; i++) g.rect(w.x, base - 520 * k + i * 80 * k, w.w, 90 * k).fill({ color: '#ff9a4a', alpha: night * 0.03 * (i + 1) });
}

function drawRoof(g: Graphics, b: Tower, x: number, top: number, c: string) {
  const dark = mix(c, '#000000', 0.2);
  switch (b.roof) {
    case 'step': g.rect(x + b.w * 0.18, top - 150, b.w * 0.64, 150).fill({ color: c }); g.rect(x + b.w * 0.34, top - 270, b.w * 0.32, 120).fill({ color: dark }); break;
    case 'slope': g.poly([x, top, x + b.w, top, x + b.w, top - 120, x + b.w * 0.3, top - 220]).fill({ color: dark }); break;
    case 'tank': {
      const tx = x + b.w * 0.5;
      g.rect(tx - 110, top - 110, 20, 110).fill({ color: dark }); g.rect(tx + 90, top - 110, 20, 110).fill({ color: dark });
      g.roundRect(tx - 150, top - 330, 300, 230, 30).fill({ color: dark }); g.poly([tx - 160, top - 330, tx + 160, top - 330, tx, top - 420]).fill({ color: c });
      break;
    }
    case 'antenna': g.rect(x + b.w * 0.62, top - 520, 14, 520).fill({ color: dark }); g.moveTo(x + b.w * 0.62 - 90, top - 360).lineTo(x + b.w * 0.62 + 104, top - 360).stroke({ width: 10, color: dark }); break;
    case 'dish': g.rect(x + b.w * 0.4, top - 70, 120, 70).fill({ color: dark }); g.ellipse(x + b.w * 0.4 + 60, top - 150, 130, 70).fill({ color: dark }); break;
    case 'spire': {
      const cx = x + b.w / 2;
      g.rect(x + 60, top - 260, b.w - 120, 260).fill({ color: c }); g.rect(x + b.w * 0.3, top - 520, b.w * 0.4, 260).fill({ color: dark });
      g.poly([cx - 46, top - 520, cx + 46, top - 520, cx + 8, top - 1250, cx - 8, top - 1250]).fill({ color: dark });
      g.rect(x - 30, top - 90, b.w + 60, 90).fill({ color: dark }); // an observation deck
      break;
    }
    default: g.rect(x - 8, top - 26, b.w + 16, 26).fill({ color: dark });
  }
}

/** The live part of the city, over the static one: the flickering windows and the red beacons. */
export function drawCityLive(g: Graphics, w: Rect, night: number, gtMs: number) {
  if (night < 0.12) return;
  const base = w.y + w.h, k = skylineK(w.h), sec = gtMs / 1000;
  for (const f of flickers(w)) {
    const on = ((sec + f.off) % f.period) < f.period * 0.55;
    if (on) g.rect(w.x + f.x, w.y + f.y, f.w, f.h).fill({ color: '#ffe9b8', alpha: night * 0.9 });
  }
  if (night > 0.25 && Math.floor(gtMs / 800) % 2 === 0) {
    for (const b of towersFor(w)) if (b.beacon) {
      const bx = w.x + b.x + b.w / 2, by = base - b.h - (b.roof === 'spire' ? 1280 : b.roof === 'antenna' ? 540 : b.roof === 'step' ? 290 : 40);
      g.circle(bx, by, 40 * Math.max(0.7, k)).fill({ color: '#ff4a4a', alpha: night * 0.95 });
      g.circle(bx, by, 110 * Math.max(0.7, k)).fill({ color: '#ff4a4a', alpha: night * 0.14 });
    }
  }
}
