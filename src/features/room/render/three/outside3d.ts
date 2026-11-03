// The view out of the 3D room's window: one quad in the window's opening whose shader casts each pixel's ray into a painted world behind the glass.
// Flat layers stand at real distances (a branch of the tree outside, the houses across the garden, the town, the towers of the city, the hills), each a
// canvas painted once (lit windows in a second, packed one), so the parallax is right from anywhere in the room and the camera can never reach them.
// Above them a sky by the game hour (skyAt's colours, the sun on its path, clouds that drift, the moon and stars at night). A ray that dips under the
// houses meets the ground: the lawn below the house, a street along it with cars parked on its far side (a low layer of their own), the front
// gardens. Painted colours with a baked light from the west, like the room's stylised look (docs/LOWPOLY_STYLE.md).
import { ClampToEdgeWrapping, Color, Mesh, PlaneGeometry, RepeatWrapping, ShaderMaterial, Vector3, Vector4, type Texture } from 'three';
import { anisotropy } from '@/core/render/three/geometry';
import { rawSrgb } from '@/core/render/three/artlod';
import { skyAt } from '../shell/room';
import { daylight, sunDir } from './roomplan';

/** A metre at the monitor's scale. The room is on the third floor: the ground is 8 m under its floor. */
const M = 18700;
export const GROUND_Y = -20000 - 8 * M;

/** A layer: a vertical plane at depth z (world), covering x0..x0+w and yb..yb+h (y up), painted on a px[0] by px[1] canvas; `wrap` repeats it along x. */
export interface Layer { z: number; x0: number; yb: number; w: number; h: number; px: [number, number]; wrap: boolean }
export const LAYERS = {
  branch: { z: -3.2 * M, x0: -110000, yb: -15000, w: 100000, h: 50000, px: [2048, 1024], wrap: false },
  cars: { z: -34.3 * M, x0: 0, yb: GROUND_Y, w: 54 * M, h: 2 * M, px: [2048, 128], wrap: true },
  near: { z: -60 * M, x0: 0, yb: GROUND_Y, w: 54 * M, h: 13.5 * M, px: [2048, 512], wrap: true },
  mid: { z: -400 * M, x0: 0, yb: GROUND_Y, w: 270 * M, h: 67.5 * M, px: [2048, 512], wrap: true },
  far: { z: -2000 * M, x0: 0, yb: GROUND_Y - 6 * M, w: 1340 * M, h: 335 * M, px: [2048, 512], wrap: true },
  hills: { z: -6500 * M, x0: 0, yb: GROUND_Y - 30 * M, w: 4300 * M, h: 540 * M, px: [1024, 128], wrap: true },
} satisfies Record<string, Layer>;

// ---------------------------------------------------------------- painting
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;

/** A canvas over a layer, its 2D context set so that world units (y up) draw straight onto it. */
function canvasFor(l: Layer): { cv: HTMLCanvasElement; c: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = l.px[0]; cv.height = l.px[1];
  const c = cv.getContext('2d')!, sx = l.px[0] / l.w, sy = l.px[1] / l.h;
  c.setTransform(sx, 0, 0, -sy, -l.x0 * sx, (l.yb + l.h) * sy);
  return { cv, c };
}

/** Draw `f` at x, and again one layer width away where it crosses the seam of a repeating layer. */
function wrapped(l: Layer, x: number, w: number, f: (dx: number) => void): void {
  f(0);
  if (!l.wrap) return;
  if (x + w > l.x0 + l.w) f(-l.w);
  if (x < l.x0) f(l.w);
}

/** Lit windows: a warm rect on the glow canvas (a lamp-lit room, a little uneven). */
function glowRect(g: CanvasRenderingContext2D | null, x: number, y: number, w: number, h: number, k = 1): void {
  if (!g) return;
  g.fillStyle = `rgba(255,255,255,${(0.55 + rnd() * 0.45) * k})`;
  g.fillRect(x, y, w, h);
}

/**
 * A tree's crown: a shaded mass of round tufts, each a gradient from its side lit from the upper west (the sun's side in the room) to its shade,
 * the lower ones under the upper ones, and leaf dabs round the crown's rim so its edge is ragged, not a row of circles.
 */
function crown(c: CanvasRenderingContext2D, x: number, y: number, r: number, tones: readonly [string, string, string]): void {
  const tufts = Array.from({ length: 20 }, () => {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.75;
    return { x: x + Math.cos(a) * d * 1.15, y: y + Math.sin(a) * d * 0.85, r: r * (0.24 + rnd() * 0.16) };
  }).sort((a, b) => a.y - b.y);
  c.fillStyle = tones[2];
  for (const t of tufts) { c.beginPath(); c.arc(t.x + r * 0.05, t.y - r * 0.06, t.r * 1.1, 0, Math.PI * 2); c.fill(); }
  // (each tuft ends in the crown's middle tone, not a dark rim: rims would outline every circle; the light falls on the crown's upper west)
  for (const t of tufts) {
    const lit = Math.max(0, Math.min(1, 0.5 + ((x - t.x) + (t.y - y)) / (r * 1.6)));
    const gr = c.createRadialGradient(t.x - t.r * 0.5, t.y + t.r * 0.5, t.r * 0.1, t.x, t.y, t.r * 1.2);
    gr.addColorStop(0, lit > 0.45 ? tones[0] : tones[1]); gr.addColorStop(0.5 + 0.3 * lit, tones[1]); gr.addColorStop(1, lit > 0.3 ? tones[1] : tones[2]);
    c.fillStyle = gr; c.beginPath(); c.arc(t.x, t.y, t.r, 0, Math.PI * 2); c.fill();
  }
  for (let i = 0; i < 160; i++) {
    const t = tufts[Math.floor(rnd() * tufts.length)]!, a = rnd() * Math.PI * 2, px = t.x + Math.cos(a) * t.r * 0.98, py = t.y + Math.sin(a) * t.r * 0.98;
    if (Math.hypot(px - x, py - y) < r * 0.6) continue;
    c.fillStyle = Math.cos(a) < 0.2 && Math.sin(a) > -0.2 ? tones[0] : tones[1];
    c.beginPath(); c.arc(px, py, t.r * (0.04 + rnd() * 0.05), 0, Math.PI * 2); c.fill();
  }
}

/** A tree's trunk from the ground at `x` up to `top`: tapered, its east side in shade, and two limbs forking into the crown. */
function trunk(c: CanvasRenderingContext2D, x: number, ground: number, top: number, w: number): void {
  c.fillStyle = '#5e4636';
  c.beginPath(); c.moveTo(x - w * 0.6, ground); c.lineTo(x - w * 0.35, top); c.lineTo(x + w * 0.35, top); c.lineTo(x + w * 0.6, ground); c.closePath(); c.fill();
  c.fillStyle = 'rgba(30,20,15,0.3)'; c.fillRect(x + w * 0.1, ground, w * 0.45, top - ground);
  c.strokeStyle = '#5e4636'; c.lineWidth = w * 0.4; c.lineCap = 'round';
  for (const s of [-1, 1]) { c.beginPath(); c.moveTo(x, top - w); c.lineTo(x + s * w * 2.2, top + w * 2.5); c.stroke(); }
}

/** The houses across the garden (60 m): two- and three-storey houses with pitched roofs and chimneys, gardens with trees, a hedge, street lamps. */
function paintNear(l: Layer, c: CanvasRenderingContext2D, g: CanvasRenderingContext2D | null): void {
  const G = l.yb;
  const walls = ['#efe6d4', '#e7d6b8', '#d9c09a', '#c98a6b', '#e9e3da', '#c7cdbf', '#b8735a'], roofs = ['#a5523a', '#8f4733', '#5d6168', '#6e5446', '#b4643f'];
  let x = l.x0 + rnd() * 2 * M;
  while (x < l.x0 + l.w) {
    const w = (7 + rnd() * 4) * M, floors = rnd() < 0.4 ? 3 : 2, h = floors * 2.9 * M + 0.6 * M, roof = (2.6 + rnd() * 1.6) * M, gable = rnd() < 0.45;
    const wall = pick(walls), rf = pick(roofs), hx = x, brick = wall === '#c98a6b' || wall === '#b8735a';
    wrapped(l, hx, w, (dx) => {
      const X = hx + dx;
      c.fillStyle = wall; c.fillRect(X, G, w, h);
      // brick courses or render's faint bands, the shaded east side of the facade, the plinth
      c.fillStyle = brick ? 'rgba(70,35,25,0.1)' : 'rgba(80,70,60,0.04)';
      for (let by = G + 0.3 * M; by < G + h; by += brick ? 0.3 * M : 0.9 * M) c.fillRect(X, by, w, 0.04 * M);
      c.fillStyle = 'rgba(40,30,30,0.12)'; c.fillRect(X + w * 0.82, G, w * 0.18, h);
      c.fillStyle = 'rgba(60,50,45,0.25)'; c.fillRect(X, G, w, 0.5 * M);
      // the roof: a gable end toward us or a slope with its ridge along the street, its tile courses
      const roofPath = () => {
        c.beginPath();
        if (gable) { c.moveTo(X - 0.4 * M, G + h); c.lineTo(X + w / 2, G + h + roof); c.lineTo(X + w + 0.4 * M, G + h); }
        else { c.moveTo(X - 0.5 * M, G + h); c.lineTo(X + 1.6 * M, G + h + roof); c.lineTo(X + w - 1.6 * M, G + h + roof); c.lineTo(X + w + 0.5 * M, G + h); }
        c.closePath();
      };
      c.fillStyle = rf; roofPath(); c.fill();
      c.save(); roofPath(); c.clip();
      c.fillStyle = 'rgba(30,15,10,0.18)';
      for (let ty = G + h + 0.3 * M; ty < G + h + roof; ty += 0.32 * M) c.fillRect(X - M, ty, w + 2 * M, 0.06 * M);
      c.restore();
      c.fillStyle = 'rgba(255,240,220,0.18)';
      c.beginPath();
      if (gable) { c.moveTo(X - 0.4 * M, G + h); c.lineTo(X + w / 2, G + h + roof); c.lineTo(X + w / 2, G + h); }
      else { c.moveTo(X - 0.5 * M, G + h); c.lineTo(X + 1.6 * M, G + h + roof); c.lineTo(X + w / 2, G + h + roof); c.lineTo(X + w / 2, G + h); }
      c.closePath(); c.fill();
      // the eaves' shadow, the gutter and its downpipe
      c.fillStyle = 'rgba(30,20,20,0.22)'; c.fillRect(X, G + h - 0.35 * M, w, 0.35 * M);
      c.fillStyle = '#6d6a66'; c.fillRect(X - 0.4 * M, G + h - 0.1 * M, w + 0.8 * M, 0.16 * M); c.fillRect(X + w - 0.4 * M, G, 0.12 * M, h);
      // a chimney
      const chx = X + w * (0.2 + rnd() * 0.5);
      c.fillStyle = '#8d5a46'; c.fillRect(chx, G + h + roof * 0.5, 0.7 * M, roof * 0.75);
      c.fillStyle = '#5b3a2e'; c.fillRect(chx - 0.1 * M, G + h + roof * 1.2, 0.9 * M, 0.25 * M);
      // windows: white frames, dark glass with the sky in its top; a door on the ground floor
      const cols = Math.max(2, Math.floor(w / (2.4 * M)));
      for (let f = 0; f < floors; f++) for (let k = 0; k < cols; k++) {
        const wx = X + (k + 0.5) * (w / cols) - 0.55 * M, wy = G + 0.9 * M + f * 2.9 * M, ww = 1.1 * M, wh = 1.4 * M;
        if (f === 0 && k === Math.floor(cols / 2)) {
          // the front door: its step, a canopy over it
          c.fillStyle = '#5a4136'; c.fillRect(wx, G + 0.5 * M, ww, 2.1 * M);
          c.fillStyle = 'rgba(255,240,220,0.12)'; c.fillRect(wx + 0.1 * M, G + 0.6 * M, ww * 0.4, 1.9 * M);
          c.fillStyle = '#bdb6aa'; c.fillRect(wx - 0.25 * M, G + 0.32 * M, ww + 0.5 * M, 0.2 * M);
          c.fillStyle = '#4a4440'; c.fillRect(wx - 0.35 * M, G + 2.72 * M, ww + 0.7 * M, 0.18 * M);
          c.fillStyle = 'rgba(30,20,20,0.25)'; c.fillRect(wx - 0.2 * M, G + 2.5 * M, ww + 0.4 * M, 0.22 * M);
          continue;
        }
        c.fillStyle = '#f4f1ea'; c.fillRect(wx - 0.12 * M, wy - 0.12 * M, ww + 0.24 * M, wh + 0.24 * M);
        const gr = c.createLinearGradient(0, wy, 0, wy + wh);
        gr.addColorStop(0, '#3b4656'); gr.addColorStop(0.55, '#5f7088'); gr.addColorStop(1, '#a9bed2');
        c.fillStyle = gr; c.fillRect(wx, wy, ww, wh);
        // curtains drawn back in some, the glazing bar, the sill and its shadow
        if (rnd() < 0.45) {
          c.fillStyle = pick(['rgba(240,232,215,0.85)', 'rgba(214,196,170,0.85)', 'rgba(180,110,95,0.8)', 'rgba(150,165,185,0.8)']);
          c.fillRect(wx, wy, ww * 0.2, wh); c.fillRect(wx + ww * 0.8, wy, ww * 0.2, wh);
        }
        c.fillStyle = '#f4f1ea'; c.fillRect(wx + ww / 2 - 0.05 * M, wy, 0.1 * M, wh);
        c.fillStyle = '#e6e1d7'; c.fillRect(wx - 0.22 * M, wy - 0.24 * M, ww + 0.44 * M, 0.14 * M);
        c.fillStyle = 'rgba(30,20,20,0.15)'; c.fillRect(wx - 0.18 * M, wy - 0.4 * M, ww + 0.36 * M, 0.16 * M);
        // a lit room shows its glazing bar against the light
        if (rnd() < 0.5) { glowRect(g, wx, wy, ww, wh, 0.75); g?.clearRect(wx + ww / 2 - 0.05 * M, wy, 0.1 * M, wh); }
      }
    });
    x += w + (2 + rnd() * 5) * M;
  }
  // gardens: trees of several sizes in front of and between the houses
  const greens: readonly (readonly [string, string, string])[] = [['#9cc06f', '#6f9a4b', '#4e7438'], ['#a8c47a', '#7ea458', '#58803d'], ['#8fb46a', '#628c45', '#436a31']];
  for (let k = 0; k < 16; k++) {
    const tx = l.x0 + rnd() * l.w, th = (4 + rnd() * 7) * M, r = (1.6 + rnd() * 2.2) * M, tones = pick(greens);
    wrapped(l, tx - r * 1.4, r * 2.8, (dx) => {
      trunk(c, tx + dx, G, G + th - r * 0.6, 0.36 * M);
      crown(c, tx + dx, G + th, r, tones);
    });
  }
  // street lamps
  for (let k = 0; k < 6; k++) {
    const lx = l.x0 + (k + rnd() * 0.6) * (l.w / 6);
    wrapped(l, lx, 1.2 * M, (dx) => {
      c.fillStyle = '#3c4048'; c.fillRect(lx + dx, G, 0.14 * M, 4.2 * M); c.fillRect(lx + dx, G + 4.1 * M, 0.9 * M, 0.12 * M);
      c.fillStyle = '#e9e4d6'; c.fillRect(lx + dx + 0.6 * M, G + 3.85 * M, 0.4 * M, 0.25 * M);
      if (g) {
        // the lamp's glow: bright at the bulb, fading into the air round it
        const gx = lx + dx + 0.8 * M, gy = G + 3.9 * M, gr = g.createRadialGradient(gx, gy, 0, gx, gy, 0.7 * M);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(gx, gy, 0.7 * M, 0, Math.PI * 2); g.fill();
      }
    });
  }
  // a clipped hedge along the street, the nearest thing
  c.fillStyle = '#4f7a3c';
  c.beginPath(); c.moveTo(l.x0 - M, G);
  for (let x2 = l.x0 - M; x2 <= l.x0 + l.w + M; x2 += 0.8 * M) c.lineTo(x2, G + 1.3 * M + Math.sin(x2 / M * 1.7) * 0.12 * M);
  c.lineTo(l.x0 + l.w + M, G); c.closePath(); c.fill();
  c.fillStyle = 'rgba(190,220,140,0.35)'; c.fillRect(l.x0, G + 1.15 * M, l.w, 0.15 * M);
}

/** The town (400 m): blocks of flats with flat roofs, plant rooms and water tanks, rows of windows, trees at their feet. */
function paintMid(l: Layer, c: CanvasRenderingContext2D, g: CanvasRenderingContext2D | null): void {
  const G = l.yb, walls = ['#e2d3b8', '#d6b48f', '#c98a6c', '#a9b7c6', '#e8e3d8', '#b9825f', '#cfc5b0', '#93a3b5'];
  let x = l.x0;
  while (x < l.x0 + l.w) {
    const w = (14 + rnd() * 26) * M, h = (12 + rnd() * 38) * M, wall = pick(walls), bx = x;
    wrapped(l, bx, w, (dx) => {
      const X = bx + dx;
      c.fillStyle = wall; c.fillRect(X, G, w, h);
      c.fillStyle = 'rgba(255,245,225,0.16)'; c.fillRect(X, G, w * 0.08, h);
      c.fillStyle = 'rgba(30,30,45,0.16)'; c.fillRect(X + w * 0.85, G, w * 0.15, h);
      c.fillStyle = 'rgba(40,40,50,0.35)'; c.fillRect(X - 0.2 * M, G + h, w + 0.4 * M, 0.5 * M);
      // rows of windows (darker glass, a few balconies)
      const fl = Math.floor((h - 2 * M) / (3 * M)), cols = Math.floor(w / (3.2 * M)), cw = w / cols;
      for (let f = 0; f < fl; f++) for (let k = 0; k < cols; k++) {
        const wx = X + k * cw + cw * 0.25, wy = G + 2 * M + f * 3 * M;
        c.fillStyle = 'rgba(45,58,78,0.72)'; c.fillRect(wx, wy, cw * 0.5, 1.6 * M);
        if (rnd() < 0.32) glowRect(g, wx, wy, cw * 0.5, 1.6 * M, 0.85);
      }
      if (rnd() < 0.5) { c.fillStyle = 'rgba(255,255,255,0.35)'; for (let f = 1; f < fl; f += 2) c.fillRect(X + w * 0.1, G + 1.8 * M + f * 3 * M, w * 0.8, 0.25 * M); }
      // what stands on the roof
      c.fillStyle = '#7a7f88'; c.fillRect(X + w * (0.15 + rnd() * 0.4), G + h, (3 + rnd() * 4) * M, (1.5 + rnd() * 2) * M);
      if (rnd() < 0.5) { const tx = X + w * (0.6 + rnd() * 0.25); c.fillStyle = '#6b5446'; c.fillRect(tx, G + h + 1.6 * M, 2.2 * M, 2.4 * M); c.fillRect(tx + 0.2 * M, G + h, 0.2 * M, 1.6 * M); c.fillRect(tx + 1.8 * M, G + h, 0.2 * M, 1.6 * M); }
    });
    x += w + (rnd() < 0.3 ? (4 + rnd() * 12) * M : 0.5 * M);
  }
  for (let k = 0; k < 40; k++) {
    const tx = l.x0 + rnd() * l.w, r = (2.5 + rnd() * 3) * M;
    wrapped(l, tx - r * 1.4, r * 2.8, (dx) => crown(c, tx + dx, G + r * 1.2, r, ['#8fb070', '#6a8f52', '#4f6f40']));
  }
}

/** The city (2 km): towers, some stepped back, with antennas, and the tall spire tower that the reference shows; a hazy foot. */
function paintFar(l: Layer, c: CanvasRenderingContext2D, g: CanvasRenderingContext2D | null): void {
  const G = l.yb + 6 * M, tones = ['#b5c3d4', '#a3b3c8', '#c4cdd8', '#9aa9bf', '#b9c0cc'];
  const tower = (X: number, w: number, h: number, tone: string, spire = false) => {
    let y = G, ww = w, xx = X;
    const steps = spire ? 3 : rnd() < 0.4 ? 2 : 1;
    for (let s = 0; s < steps; s++) {
      const sh = s === steps - 1 ? h - (y - G) : h * (spire ? [0.55, 0.3][s]! : 0.7);
      c.fillStyle = tone; c.fillRect(xx, y, ww, sh);
      c.fillStyle = 'rgba(255,250,240,0.22)'; c.fillRect(xx, y, ww * 0.35, sh);
      c.fillStyle = 'rgba(70,85,110,0.25)';
      for (let fy = y + 3 * M; fy < y + sh - 2 * M; fy += 3.5 * M) c.fillRect(xx, fy, ww, 0.9 * M);
      for (let fy = y + 3 * M; fy < y + sh - 2 * M; fy += 3.5 * M) for (let fx = xx + 1.5 * M; fx < xx + ww - 1.5 * M; fx += 3 * M) if (rnd() < 0.18) glowRect(g, fx, fy, 1.5 * M, 1.2 * M, 0.8);
      y += sh;
      xx += ww * 0.15; ww *= 0.7;
    }
    c.fillStyle = '#8e9bb0';
    if (spire) { c.beginPath(); c.moveTo(xx + ww * 0.3, y); c.lineTo(xx + ww * 0.5, y + 60 * M); c.lineTo(xx + ww * 0.7, y); c.closePath(); c.fill(); }
    else if (rnd() < 0.5) c.fillRect(xx + ww * 0.45, y, 0.6 * M, (10 + rnd() * 20) * M);
    if (g) { g.fillStyle = '#ff6040'; g.fillRect(xx + ww * 0.45, y + (spire ? 59 * M : 0), 1.6 * M, 1.6 * M); }
  };
  let x = l.x0;
  while (x < l.x0 + l.w) {
    const w = (25 + rnd() * 45) * M, h = (50 + rnd() * 160) * M, tone = pick(tones), bx = x;
    wrapped(l, bx, w, (dx) => tower(bx + dx, w, h, tone));
    x += w + (rnd() < 0.5 ? (10 + rnd() * 60) * M : 4 * M);
  }
  tower(l.x0 + l.w * 0.5, 52 * M, 255 * M, '#a9b8cc', true);
  // the city's hazy foot and a low band of buildings
  const gr = c.createLinearGradient(0, G - 6 * M, 0, G + 30 * M);
  gr.addColorStop(0, 'rgba(160,175,195,1)'); gr.addColorStop(1, 'rgba(160,175,195,0)');
  c.fillStyle = gr; c.fillRect(l.x0, G - 6 * M, l.w, 36 * M);
}

/** The hills behind the city (6.5 km): two soft ridges. */
function paintHills(l: Layer, c: CanvasRenderingContext2D): void {
  const G = l.yb + 30 * M;
  for (const [tone, amp, base, f] of [['#9fb6a8', 160 * M, 90 * M, 3], ['#8aa596', 110 * M, 40 * M, 5]] as const) {
    c.fillStyle = tone; c.beginPath(); c.moveTo(l.x0, l.yb);
    for (let i = 0; i <= 64; i++) {
      const u = i / 64, y = G + base + amp * (0.5 + 0.3 * Math.sin(u * Math.PI * 2 * f + f) + 0.2 * Math.sin(u * Math.PI * 2 * (f * 2 + 1)));
      c.lineTo(l.x0 + u * l.w, y);
    }
    c.lineTo(l.x0 + l.w, l.yb); c.closePath(); c.fill();
  }
}

/** The cars parked along the street's far kerb: side views, some facing each way, a shadow under each, their glass catching the sky. */
function paintCars(l: Layer, c: CanvasRenderingContext2D): void {
  const G = l.yb, bodies = ['#b8383a', '#e9e6df', '#2f4a6e', '#8c9096', '#2d2f33', '#c8a24a', '#5f7f63', '#dcdad4'];
  const car = (X: number, len: number, body: string, flip: boolean, tall: number) => {
    const at = (u: number) => X + (flip ? 1 - u : u) * len, y0 = G + 0.28 * M, belt = G + 0.92 * M, top = G + tall;
    c.fillStyle = 'rgba(20,20,25,0.5)'; c.fillRect(X + 0.1 * len, G, len * 0.8, 0.2 * M);
    // the body (a sloped bonnet at the front, the boot's square end), the cabin
    c.fillStyle = body;
    c.beginPath(); c.moveTo(at(0.02), y0); c.lineTo(at(0), G + 0.62 * M); c.quadraticCurveTo(at(0.03), belt, at(0.2), belt);
    c.lineTo(at(0.94), belt + 0.05 * M); c.quadraticCurveTo(at(1), belt, at(1), G + 0.55 * M); c.lineTo(at(0.98), y0); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(at(0.24), belt); c.lineTo(at(0.4), top); c.lineTo(at(0.8), top); c.lineTo(at(0.9), belt); c.closePath(); c.fill();
    // the glass, dark under the sky it shows in its top; the pillar between the doors
    const gr = c.createLinearGradient(0, belt, 0, top);
    gr.addColorStop(0, '#2a3340'); gr.addColorStop(1, '#8fa4bb');
    c.fillStyle = gr;
    c.beginPath(); c.moveTo(at(0.28), belt + 0.04 * M); c.lineTo(at(0.415), top - 0.07 * M); c.lineTo(at(0.785), top - 0.07 * M); c.lineTo(at(0.86), belt + 0.04 * M); c.closePath(); c.fill();
    c.fillStyle = body; c.fillRect(Math.min(at(0.58), at(0.61)), belt, len * 0.03, top - belt);
    // the shoulder's highlight, the door seams, the sill's shade, the lamps
    c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(X + 0.04 * len, belt - 0.1 * M, len * 0.9, 0.05 * M);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (const u of [0.32, 0.6]) c.fillRect(at(u), y0 + 0.08 * M, 0.025 * M, belt - y0 - 0.1 * M);
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(X + 0.03 * len, y0, len * 0.94, 0.12 * M);
    c.fillStyle = '#f3efe2'; c.fillRect(at(0) - (flip ? 0.12 : 0) * M, G + 0.62 * M, 0.12 * M, 0.12 * M);
    c.fillStyle = '#b02a22'; c.fillRect(at(1) - (flip ? 0 : 0.12) * M, G + 0.64 * M, 0.12 * M, 0.14 * M);
    // the wheels in their arches
    for (const u of [0.18, 0.8]) {
      const wx = at(u);
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.beginPath(); c.arc(wx, G + 0.33 * M, 0.4 * M, 0, Math.PI); c.fill();
      c.fillStyle = '#1d1e21'; c.beginPath(); c.arc(wx, G + 0.32 * M, 0.32 * M, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#9da2a8'; c.beginPath(); c.arc(wx, G + 0.32 * M, 0.17 * M, 0, Math.PI * 2); c.fill();
    }
  };
  // (the last car ends short of the seam, so none is cut there)
  let x = l.x0 + rnd() * 3 * M;
  while (x < l.x0 + l.w - 5 * M) {
    const len = (3.9 + rnd() * 0.9) * M, body = pick(bodies), flip = rnd() < 0.5, tall = (1.38 + rnd() * 0.12) * M;
    car(x, len, body, flip, tall);
    x += len + (rnd() < 0.25 ? (8 + rnd() * 10) * M : (0.8 + rnd() * 1.5) * M);
  }
}

/**
 * A branch of the garden's tree reaching in from the upper west, three metres out: its limbs lit along their top, side twigs, and clusters of
 * pointed leaves at their ends, each leaf lit on its upper half; the far leaves are drawn first and darker, so the cluster has depth.
 */
function paintBranch(l: Layer, c: CanvasRenderingContext2D): void {
  c.lineCap = 'round';
  const limb = (pts: [number, number][], w0: number, w1: number) => {
    for (let i = 1; i < pts.length; i++) {
      const lw = w0 + (w1 - w0) * (i / pts.length);
      c.strokeStyle = '#4a3a2e'; c.lineWidth = lw;
      c.beginPath(); c.moveTo(...pts[i - 1]!); c.lineTo(...pts[i]!); c.stroke();
      c.strokeStyle = '#6e5a46'; c.lineWidth = lw * 0.3;
      c.beginPath(); c.moveTo(pts[i - 1]![0], pts[i - 1]![1] + lw * 0.25); c.lineTo(pts[i]![0], pts[i]![1] + lw * 0.25); c.stroke();
    }
  };
  const main: [number, number][] = [[-110000, 30000], [-90000, 26000], [-72000, 21000], [-58000, 17500], [-46000, 16000], [-36000, 17000]];
  limb(main, 1600, 300);
  const twigs: [number, number][][] = [[[-80000, 23500], [-72000, 30000], [-64000, 33000]], [[-62000, 18500], [-56000, 11000], [-50000, 8000]], [[-52000, 16800], [-44000, 22500], [-38000, 24000]]];
  for (const t of twigs) limb(t, 600, 160);
  // side twigs out to the leaf clusters
  const clusters: [number, number][] = [];
  for (const path of [main, ...twigs]) for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]!, [x1, y1] = path[i]!;
    for (let k = 0; k < 3; k++) {
      const u = rnd(), bx = x0 + (x1 - x0) * u, by = y0 + (y1 - y0) * u, ex = bx + (rnd() - 0.5) * 7000, ey = by + (rnd() - 0.35) * 6000;
      limb([[bx, by], [ex, ey]], 260, 90);
      clusters.push([ex, ey]);
    }
  }
  const leaf = (x: number, y: number, a: number, s: number, body: string, lit: string) => {
    c.save(); c.translate(x, y); c.rotate(a);
    const half = (side: number) => { c.moveTo(0, 0); c.bezierCurveTo(s * 0.3, side * s * 0.42, s * 0.75, side * s * 0.3, s, 0); };
    c.strokeStyle = '#5b5a34'; c.lineWidth = s * 0.05; c.beginPath(); c.moveTo(-s * 0.2, 0); c.lineTo(0, 0); c.stroke();
    c.fillStyle = body; c.beginPath(); half(1); c.bezierCurveTo(s * 0.75, -s * 0.3, s * 0.3, -s * 0.42, 0, 0); c.fill();
    // the half that faces up in the world catches the light
    c.fillStyle = lit; c.beginPath(); half(Math.cos(a) >= 0 ? 1 : -1); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(40,55,20,0.4)'; c.lineWidth = s * 0.035; c.beginPath(); c.moveTo(0, 0); c.lineTo(s * 0.92, 0); c.stroke();
    c.restore();
  };
  const back: [string, string][] = [['#3f6a2c', '#527d38'], ['#365f27', '#4a7433'], ['#446f30', '#5a8740']];
  const front: [string, string][] = [['#5f8f3f', '#8dbb62'], ['#6c9c47', '#9bc76d'], ['#548638', '#7fb257'], ['#78a851', '#a5cf78']];
  for (const [tones, n, spread] of [[back, 9, 2600], [front, 8, 1900]] as const) for (const [cx, cy] of clusters) {
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, d = rnd() * spread, [body, lit] = pick(tones);
      leaf(cx + Math.cos(a) * d * 0.4, cy + Math.sin(a) * d * 0.4, a + (rnd() - 0.5) * 0.8, 1500 + rnd() * 900, body, lit);
    }
  }
}

/** Soft cumulus on a band of sky round the horizon: a canvas that wraps once round the view, its bottom the horizon. Red: lit (top) to shaded (base). */
function paintClouds(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 2048; cv.height = 512;
  const c = cv.getContext('2d')!;
  const puff = (x: number, y: number, r: number) => {
    const gr = c.createRadialGradient(x, y - r * 0.35, r * 0.1, x, y, r);
    gr.addColorStop(0, 'rgba(255,0,0,1)'); gr.addColorStop(0.6, 'rgba(200,0,0,0.95)'); gr.addColorStop(1, 'rgba(120,0,0,0)');
    c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  };
  for (let k = 0; k < 26; k++) {
    // nearer the horizon a cloud is smaller and flatter
    const cy = 120 + rnd() * 330, size = 0.35 + (1 - cy / 512) * 0.9, cx = rnd() * 2048, n = 6 + Math.floor(rnd() * 8);
    for (const dx of [0, -2048, 2048]) {
      if (cx + dx < -300 || cx + dx > 2348) continue;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1) - 0.5;
        puff(cx + dx + u * 260 * size, cy - (1 - u * u * 4) * 34 * size - rnd() * 18 * size, (34 + rnd() * 30) * size * (1 - Math.abs(u) * 0.6));
      }
      // the flat, shaded base
      c.fillStyle = 'rgba(90,0,0,0.85)';
      c.beginPath(); c.ellipse(cx + dx, cy + 6 * size, 150 * size, 14 * size, 0, 0, Math.PI * 2); c.fill();
    }
  }
  return cv;
}

// ---------------------------------------------------------------- the shader
const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform sampler2D tBranch, tCars, tNear, tMid, tFar, tHills, tGlow, tClouds;
uniform vec4 rBranch, rCars, rNear, rMid, rFar, rHills; // x0, yb, w, h
uniform vec4 zLayers;                             // near, mid, far, hills
uniform float zBranch, zCars, groundY, time, day, night, lights, wind, gain;
uniform vec3 skyTop, skyHor, sunDir, sunCol, moonDir, light, haze, sheen;
uniform vec4 hazeK;                               // near, mid, far, hills
varying vec3 vWorld;
varying vec2 vUv;

const float METRE = ${M}.0;

vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(vec3(i, 0.0)), hash(vec3(i + vec2(1.0, 0.0), 0.0)), f.x), mix(hash(vec3(i + vec2(0.0, 1.0), 0.0)), hash(vec3(i + vec2(1.0, 1.0), 0.0)), f.x), f.y);
}
/** 0 before the edge e of x, 1 after it, smoothed over w. */
float after(float x, float e, float w) { return smoothstep(e - w, e + w, x); }
/** 1 on the lines of a grid of step 1 in x, t wide; they fade out where they get finer than a pixel. */
float joint(float x, float t) { float w = fwidth(x); return (1.0 - smoothstep(t, t + w, abs(fract(x + 0.5) - 0.5))) * clamp(1.0 - w * 3.0, 0.0, 1.0); }

/**
 * The ground below the window, m metres out from the house and a along it: paving round the house, the lawn (mown in bands, a gravel path
 * across it), a pavement of flags, the street (its centre dashes, the gutters, the parked cars' shadows), the far pavement, the front gardens.
 */
vec3 ground(float m, float a) {
  float w = fwidth(m) * 0.8 + 0.01, n = vnoise(vec2(a, m) * 1.3) * 0.55 + vnoise(vec2(a, m) * 6.1) * 0.45;
  vec3 pave = lin(vec3(0.74, 0.72, 0.68)) * (0.9 + 0.12 * n) * (1.0 - 0.3 * max(joint(a / 0.6, 0.04), joint(m / 0.6, 0.04)));
  vec3 lawn = lin(vec3(0.48, 0.63, 0.33)) * (0.8 + 0.3 * n) * (1.0 + 0.07 * (step(0.5, fract(m / 5.0)) - 0.5));
  vec3 path = lin(vec3(0.80, 0.74, 0.62)) * (0.88 + 0.16 * n);
  vec3 kerb = lin(vec3(0.85, 0.83, 0.79));
  vec3 walk = lin(vec3(0.72, 0.70, 0.66)) * (0.92 + 0.1 * n) * (1.0 - 0.28 * max(joint(a, 0.025), joint(m, 0.025)));
  vec3 road = lin(vec3(0.33, 0.34, 0.36)) * (0.82 + 0.25 * n);
  vec3 garden = lin(vec3(0.42, 0.58, 0.30)) * (0.8 + 0.3 * n);
  vec3 soil = lin(vec3(0.42, 0.33, 0.25)) * (0.85 + 0.2 * n);
  vec3 c = pave;
  c = mix(c, lawn, after(m, 1.6, w));
  c = mix(c, path, after(m, 12.0, w) - after(m, 13.4, w));
  c = mix(c, kerb, after(m, 26.0, w));
  c = mix(c, walk, after(m, 26.3, w));
  c = mix(c, kerb, after(m, 29.2, w));
  c = mix(c, road, after(m, 29.45, w));
  float dash = (after(m, 32.85, w) - after(m, 33.05, w)) * step(fract(a / 9.0), 0.35);
  c = mix(c, lin(vec3(0.9, 0.89, 0.85)) * (0.85 + 0.15 * n), dash);
  c *= 1.0 - 0.22 * (after(m, 29.45, w) - after(m, 29.8, w)) - 0.22 * (after(m, 36.2, w) - after(m, 36.55, w));
  // under a car: its body's row of the cars' layer, blurred by a coarse mip
  float car = textureLod(tCars, vec2((a * METRE - rCars.x) / rCars.z, 0.35), 4.0).a;
  c *= 1.0 - 0.5 * car * (after(m, 34.1, w) - after(m, 36.3, w));
  c = mix(c, kerb, after(m, 36.55, w));
  c = mix(c, walk, after(m, 36.8, w));
  c = mix(c, garden, after(m, 39.8, w));
  // the front gardens: a path up to each house, low hedges between them
  float yard = after(m, 39.8, w) - after(m, 57.6, w), u = fract(a / 12.5), wa = fwidth(a / 12.5) * 0.8 + 0.002;
  c = mix(c, path * 0.95, yard * (after(u, 0.46, wa) - after(u, 0.54, wa)));
  c = mix(c, lin(vec3(0.28, 0.42, 0.2)) * (0.8 + 0.3 * n), yard * (1.0 - after(u, 0.03, wa)));
  c = mix(c, soil, after(m, 57.6, w));
  return c;
}

vec2 uvOn(vec4 r, float z, vec3 o, vec3 d) {
  vec3 p = o + d * ((z - o.z) / d.z);
  return vec2((p.x - r.x) / r.z, (p.y - r.y) / r.w);
}

/** One painted layer over what is behind it: its colour lit by the hour and hazed by distance, its lit windows on top. */
vec3 over(vec3 col, sampler2D t, vec4 r, float z, float k, int glow, vec3 o, vec3 d) {
  vec2 uv = uvOn(r, z, o, d);
  if (uv.y < 0.0 || uv.y > 1.0) return col;
  // (a canvas texture is flipped on upload: v runs up the layer as y does)
  vec4 a = texture(t, uv);
  vec3 c = mix(lin(a.rgb) * light, haze, k);
  if (glow >= 0) {
    vec4 g = texture(tGlow, uv);
    float e = glow == 0 ? g.r : glow == 1 ? g.g : g.b;
    c += vec3(1.0, 0.68, 0.36) * e * lights * (glow == 2 ? 1.2 : glow == 1 ? 1.4 : 0.85);
  }
  return mix(col, c, a.a);
}

vec3 sky(vec3 d) {
  float e = d.y;
  vec3 c = mix(skyHor, skyTop, pow(clamp(e / 0.6, 0.0, 1.0), 0.65));
  float cs = max(dot(d, sunDir), 0.0), up = smoothstep(-0.08, 0.05, sunDir.y);
  c += sunCol * (pow(cs, 10.0) * 0.45 + pow(cs, 3.0) * 0.12) * up;
  c += sunCol * smoothstep(0.99935, 0.99965, cs) * 7.0 * up;
  // clouds: a band round the horizon that drifts
  float az = atan(d.x, -d.z);
  vec2 cuv = vec2(az / 6.2831853 * 3.0 + time * 0.0012, clamp(e / 0.5, 0.0, 1.0));
  vec4 cl = texture(tClouds, vec2(cuv.x, cuv.y));
  vec3 lit = mix(sunCol, vec3(1.0), 0.55) * (0.25 + 0.95 * day) + skyTop * 0.15, shade = mix(skyHor, skyTop, 0.5) * (0.55 + 0.25 * day);
  c = mix(c, mix(shade, lit, cl.r), cl.a * smoothstep(0.0, 0.05, e) * 0.92);
  // the moon and the stars at night
  float cm = max(dot(d, moonDir), 0.0);
  c += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99955, 0.9998, cm) * 2.2 + pow(cm, 60.0) * 0.12) * night;
  vec3 sp = d * 420.0, cell = floor(sp);
  float h = hash(cell);
  if (h > 0.9955 && e > 0.03) c += vec3(0.9, 0.94, 1.0) * smoothstep(0.32, 0.0, length(fract(sp) - 0.5)) * night * (0.55 + 0.45 * sin(time * 1.7 + h * 90.0)) * 1.4;
  return c;
}

void main() {
  vec3 o = cameraPosition, d = normalize(vWorld - cameraPosition);
  vec3 col = sky(d);
  col = over(col, tHills, rHills, zLayers.w, hazeK.w, -1, o, d);
  col = over(col, tFar, rFar, zLayers.z, hazeK.z, 2, o, d);
  col = over(col, tMid, rMid, zLayers.y, hazeK.y, 1, o, d);
  col = over(col, tNear, rNear, zLayers.x, hazeK.x, 0, o, d);
  // a ray that dips under the houses meets the ground, then the parked cars stand on it (the ground is worked out for every pixel, so its
  // lines can be smoothed by their size on the screen)
  float tg = (groundY - o.y) / min(d.y, -1e-5);
  vec3 p = o + d * tg;
  vec3 gc = ground(-p.z / METRE, p.x / METRE);
  if (d.y < 0.0 && tg < (zLayers.x - o.z) / d.z) col = mix(gc * light, haze, hazeK.x * clamp(-p.z / METRE / 40.0, 0.0, 1.5));
  col = over(col, tCars, rCars, zCars, hazeK.x, -1, o, d);
  // the branch outside, stirred a little by the wind
  vec2 bu = uvOn(rBranch, zBranch, o, d);
  bu.x += sin(time * 0.9 + bu.y * 5.0) * 0.004 * wind;
  if (bu.x > 0.0 && bu.x < 1.0 && bu.y > 0.0 && bu.y < 1.0) {
    vec4 b = texture(tBranch, bu);
    // at night it is close enough to catch the moon and the room's spill: a dim blue-grey floor keeps its leaves from going black
    col = mix(col, lin(b.rgb) * (light * 0.9 + vec3(0.08, 0.09, 0.14) * lights), b.a);
  }
  // daylight outside is far brighter than the room: the view is lifted over the room's whites, so it reads as the light's source and blooms
  col *= gain;
  // the glass: a faint sheen, more toward its top and at a grazing look
  col += sheen * (0.35 + 0.65 * vUv.y) * (0.4 + 3.0 * pow(1.0 - abs(d.z), 3.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const rect = (l: Layer) => new Vector4(l.x0, l.yb, l.w, l.h);

function texOf(cv: HTMLCanvasElement | null, wrap: boolean): Texture | null {
  if (!cv) return null;
  const t = rawSrgb(cv);
  t.wrapS = wrap ? RepeatWrapping : ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  return t;
}

/** The lit windows of three layers packed in one texture: red the houses, green the town, blue the city. */
function packGlow(cs: (HTMLCanvasElement | null)[]): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || cs.some((c) => !c)) return null;
  const [w, h] = [cs[0]!.width, cs[0]!.height], out = document.createElement('canvas');
  out.width = w; out.height = h;
  const o = out.getContext('2d')!, img = o.createImageData(w, h), px = cs.map((c) => c!.getContext('2d')!.getImageData(0, 0, w, h).data);
  for (let i = 0; i < w * h * 4; i += 4) {
    img.data[i] = px[0]![i + 3]!; img.data[i + 1] = px[1]![i + 3]!; img.data[i + 2] = px[2]![i + 3]!; img.data[i + 3] = 255;
  }
  o.putImageData(img, 0, 0);
  return out;
}

/** The view out of the window, painted once. `frame` sets the hour's sky and light. */
export class Outside {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private key = -1;

  /** A quad over the window's opening (world: centre x, y, its size, the depth of the glass). */
  constructor(cx: number, cy: number, w: number, h: number, z: number) {
    seed = 7;
    const L = LAYERS, glow: (HTMLCanvasElement | null)[] = [];
    const layer = (l: Layer, paintIt: (l: Layer, c: CanvasRenderingContext2D, g: CanvasRenderingContext2D | null) => void, lit: boolean) => {
      const a = canvasFor(l), g = lit ? canvasFor(l) : null;
      if (a) paintIt(l, a.c, g?.c ?? null);
      if (lit) glow.push(g?.cv ?? null);
      return texOf(a?.cv ?? null, l.wrap);
    };
    const tNear = layer(L.near, paintNear, true), tMid = layer(L.mid, paintMid, true), tFar = layer(L.far, paintFar, true);
    const tHills = layer(L.hills, (l, c) => paintHills(l, c), false), tBranch = layer(L.branch, (l, c) => paintBranch(l, c), false);
    const tCars = layer(L.cars, (l, c) => paintCars(l, c), false);
    const tGlow = texOf(packGlow(glow), true), tClouds = texOf(paintClouds(), true);
    this.mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        tBranch: { value: tBranch }, tCars: { value: tCars }, tNear: { value: tNear }, tMid: { value: tMid }, tFar: { value: tFar }, tHills: { value: tHills },
        tGlow: { value: tGlow }, tClouds: { value: tClouds },
        rBranch: { value: rect(L.branch) }, rCars: { value: rect(L.cars) }, rNear: { value: rect(L.near) }, rMid: { value: rect(L.mid) }, rFar: { value: rect(L.far) },
        rHills: { value: rect(L.hills) },
        zLayers: { value: new Vector4(L.near.z, L.mid.z, L.far.z, L.hills.z) }, zBranch: { value: L.branch.z }, zCars: { value: L.cars.z }, groundY: { value: GROUND_Y },
        time: { value: 0 }, day: { value: 1 }, night: { value: 0 }, lights: { value: 0 }, wind: { value: 1 }, gain: { value: 1 }, sheen: { value: new Color() },
        skyTop: { value: new Color() }, skyHor: { value: new Color() }, sunDir: { value: new Vector3(0, 1, 0) }, sunCol: { value: new Color() },
        moonDir: { value: new Vector3(-0.33, 0.2, -0.92).normalize() }, light: { value: new Color(1, 1, 1) }, haze: { value: new Color() },
        hazeK: { value: new Vector4(0.04, 0.2, 0.5, 0.66) },
      },
    });
    this.mesh = new Mesh(new PlaneGeometry(w, h), this.mat);
    this.mesh.position.set(cx, cy, z);
  }

  /** The hour's sky, sun and light on the scenery (redone a few times a game hour), the clouds' drift and the wind every frame. */
  frame(hour: number, t: number): void {
    const u = this.mat.uniforms;
    u.time!.value = t;
    const k = Math.round(hour * 30);
    if (k === this.key) return;
    this.key = k;
    // (lifted only a little: more, and the noon horizon and its haze wash out to white)
    const s = skyAt(hour), day = daylight(hour), night = 1 - day, lift = 1.1 + 0.15 * day;
    const top = new Color(s.top).multiplyScalar(lift), hor = new Color(s.hor).multiplyScalar(lift);
    u.skyTop!.value.copy(top); u.skyHor!.value.copy(hor);
    u.day!.value = day; u.night!.value = night;
    u.gain!.value = 1 + 0.45 * day;
    u.lights!.value = Math.min(1, Math.max(0, 1.25 - day * 1.6));
    const sd = sunDir(hour);
    u.sunDir!.value.set(sd[0], sd[1], sd[2]);
    // the sun's light: white at midday, the horizon's warm colour low down, none at night
    const low = 1 - Math.min(1, Math.max(0, sd[1] / 0.45));
    u.sunCol!.value.copy(new Color(0xfff4e0).lerp(new Color(s.hor), low * 0.85)).multiplyScalar(day * 1.4);
    u.light!.value.copy(new Color(0x24304f).multiplyScalar(0.35)).lerp(new Color(0xfff6ea).lerp(new Color(s.hor), low * 0.6).multiplyScalar(1.15), day);
    u.haze!.value.copy(hor).multiplyScalar(0.92);
    // the glass's sheen: the day's sky on it, at night the warm room behind the viewer
    u.sheen!.value.setRGB(0.012, 0.013, 0.015).multiplyScalar(day).add(new Color(0x1a120c).multiplyScalar(0.25 * night));
  }
}

/** The quad is part of the window (a click on the view works the blind), but it casts no shadow and takes none. */
export function outsideMesh(o: Outside): Mesh {
  o.mesh.castShadow = o.mesh.receiveShadow = false;
  return o.mesh;
}

