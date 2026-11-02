// The view out of the 3D room's window: one quad in the window's opening whose shader casts each pixel's ray into a painted world behind the glass.
// Flat layers stand at real distances (a branch of the tree outside, the houses across the garden, the town, the towers of the city, the hills), each a
// canvas painted once (lit windows in a second, packed one), so the parallax is right from anywhere in the room and the camera can never reach them.
// Above them a sky by the game hour (skyAt's colours, the sun on its path, clouds that drift, the moon and stars at night). A ray that dips under the
// houses meets the street. Plain flat colours with a baked light from the west, like the room's stylised look (docs/LOWPOLY_STYLE.md).
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
  branch: { z: -3.2 * M, x0: -110000, yb: -15000, w: 100000, h: 50000, px: [1024, 512], wrap: false },
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

/** A tree's crown: overlapping round tufts, darker under and lit from the upper west (the sun's side in the room). */
function crown(c: CanvasRenderingContext2D, x: number, y: number, r: number, tones: readonly [string, string, string]): void {
  const tufts = Array.from({ length: 9 }, () => ({ dx: (rnd() - 0.5) * r * 1.3, dy: (rnd() - 0.4) * r * 1.1, r: r * (0.45 + rnd() * 0.3) }));
  c.fillStyle = tones[2];
  for (const t of tufts) { c.beginPath(); c.arc(x + t.dx + r * 0.08, y + t.dy - r * 0.1, t.r, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = tones[1];
  for (const t of tufts) { c.beginPath(); c.arc(x + t.dx, y + t.dy, t.r * 0.92, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = tones[0];
  for (const t of tufts) { if (t.dx > r * 0.25 || t.dy < -r * 0.1) continue; c.beginPath(); c.arc(x + t.dx - t.r * 0.25, y + t.dy + t.r * 0.25, t.r * 0.55, 0, Math.PI * 2); c.fill(); }
}

/** The houses across the garden (60 m): two- and three-storey houses with pitched roofs and chimneys, gardens with trees, a hedge, street lamps. */
function paintNear(l: Layer, c: CanvasRenderingContext2D, g: CanvasRenderingContext2D | null): void {
  const G = l.yb;
  const walls = ['#efe6d4', '#e7d6b8', '#d9c09a', '#c98a6b', '#e9e3da', '#c7cdbf', '#b8735a'], roofs = ['#a5523a', '#8f4733', '#5d6168', '#6e5446', '#b4643f'];
  let x = l.x0 + rnd() * 2 * M;
  while (x < l.x0 + l.w) {
    const w = (7 + rnd() * 4) * M, floors = rnd() < 0.4 ? 3 : 2, h = floors * 2.9 * M + 0.6 * M, roof = (2.6 + rnd() * 1.6) * M, gable = rnd() < 0.45;
    const wall = pick(walls), rf = pick(roofs), hx = x;
    wrapped(l, hx, w, (dx) => {
      const X = hx + dx;
      c.fillStyle = wall; c.fillRect(X, G, w, h);
      // the shaded east side of the facade, the plinth
      c.fillStyle = 'rgba(40,30,30,0.12)'; c.fillRect(X + w * 0.82, G, w * 0.18, h);
      c.fillStyle = 'rgba(60,50,45,0.25)'; c.fillRect(X, G, w, 0.5 * M);
      // the roof: a gable end toward us or a slope with its ridge along the street
      c.fillStyle = rf;
      c.beginPath();
      if (gable) { c.moveTo(X - 0.4 * M, G + h); c.lineTo(X + w / 2, G + h + roof); c.lineTo(X + w + 0.4 * M, G + h); }
      else { c.moveTo(X - 0.5 * M, G + h); c.lineTo(X + 1.6 * M, G + h + roof); c.lineTo(X + w - 1.6 * M, G + h + roof); c.lineTo(X + w + 0.5 * M, G + h); }
      c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,240,220,0.18)';
      c.beginPath();
      if (gable) { c.moveTo(X - 0.4 * M, G + h); c.lineTo(X + w / 2, G + h + roof); c.lineTo(X + w / 2, G + h); }
      else { c.moveTo(X - 0.5 * M, G + h); c.lineTo(X + 1.6 * M, G + h + roof); c.lineTo(X + w / 2, G + h + roof); c.lineTo(X + w / 2, G + h); }
      c.closePath(); c.fill();
      // the eaves' shadow
      c.fillStyle = 'rgba(30,20,20,0.22)'; c.fillRect(X, G + h - 0.35 * M, w, 0.35 * M);
      // a chimney
      const chx = X + w * (0.2 + rnd() * 0.5);
      c.fillStyle = '#8d5a46'; c.fillRect(chx, G + h + roof * 0.5, 0.7 * M, roof * 0.75);
      c.fillStyle = '#5b3a2e'; c.fillRect(chx - 0.1 * M, G + h + roof * 1.2, 0.9 * M, 0.25 * M);
      // windows: white frames, dark glass with the sky in its top; a door on the ground floor
      const cols = Math.max(2, Math.floor(w / (2.4 * M)));
      for (let f = 0; f < floors; f++) for (let k = 0; k < cols; k++) {
        const wx = X + (k + 0.5) * (w / cols) - 0.55 * M, wy = G + 0.9 * M + f * 2.9 * M, ww = 1.1 * M, wh = 1.4 * M;
        if (f === 0 && k === Math.floor(cols / 2)) {
          c.fillStyle = '#5a4136'; c.fillRect(wx, G + 0.5 * M, ww, 2.1 * M);
          c.fillStyle = '#f2ede4'; c.fillRect(wx - 0.12 * M, G + 2.6 * M, ww + 0.24 * M, 0.14 * M);
          continue;
        }
        c.fillStyle = '#f4f1ea'; c.fillRect(wx - 0.12 * M, wy - 0.12 * M, ww + 0.24 * M, wh + 0.24 * M);
        const gr = c.createLinearGradient(0, wy, 0, wy + wh);
        gr.addColorStop(0, '#3b4656'); gr.addColorStop(0.55, '#5f7088'); gr.addColorStop(1, '#a9bed2');
        c.fillStyle = gr; c.fillRect(wx, wy, ww, wh);
        c.fillStyle = '#f4f1ea'; c.fillRect(wx + ww / 2 - 0.05 * M, wy, 0.1 * M, wh);
        if (rnd() < 0.5) glowRect(g, wx, wy, ww, wh);
      }
    });
    x += w + (2 + rnd() * 5) * M;
  }
  // gardens: trees of several sizes in front of and between the houses
  const greens: readonly (readonly [string, string, string])[] = [['#9cc06f', '#6f9a4b', '#4e7438'], ['#a8c47a', '#7ea458', '#58803d'], ['#8fb46a', '#628c45', '#436a31']];
  for (let k = 0; k < 16; k++) {
    const tx = l.x0 + rnd() * l.w, th = (4 + rnd() * 7) * M, r = (1.6 + rnd() * 2.2) * M, tones = pick(greens);
    wrapped(l, tx - r * 1.4, r * 2.8, (dx) => {
      c.fillStyle = '#5e4636'; c.fillRect(tx + dx - 0.18 * M, G, 0.36 * M, th - r * 0.6);
      crown(c, tx + dx, G + th, r, tones);
    });
  }
  // street lamps
  for (let k = 0; k < 6; k++) {
    const lx = l.x0 + (k + rnd() * 0.6) * (l.w / 6);
    wrapped(l, lx, 1.2 * M, (dx) => {
      c.fillStyle = '#3c4048'; c.fillRect(lx + dx, G, 0.14 * M, 4.2 * M); c.fillRect(lx + dx, G + 4.1 * M, 0.9 * M, 0.12 * M);
      c.fillStyle = '#e9e4d6'; c.fillRect(lx + dx + 0.6 * M, G + 3.85 * M, 0.4 * M, 0.25 * M);
      if (g) { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(lx + dx + 0.8 * M, G + 3.9 * M, 0.5 * M, 0.3 * M, 0, 0, Math.PI * 2); g.fill(); }
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

/** A branch of the garden's tree reaching in from the upper west, three metres out: leaves lit on the sun's side. */
function paintBranch(l: Layer, c: CanvasRenderingContext2D): void {
  c.lineCap = 'round';
  const limb = (pts: [number, number][], w0: number, w1: number) => {
    for (let i = 1; i < pts.length; i++) {
      c.strokeStyle = '#4a3a2e'; c.lineWidth = w0 + (w1 - w0) * (i / pts.length);
      c.beginPath(); c.moveTo(...pts[i - 1]!); c.lineTo(...pts[i]!); c.stroke();
    }
  };
  const main: [number, number][] = [[-110000, 30000], [-90000, 26000], [-72000, 21000], [-58000, 17500], [-46000, 16000], [-36000, 17000]];
  limb(main, 1600, 300);
  const twigs: [number, number][][] = [[[-80000, 23500], [-72000, 30000], [-64000, 33000]], [[-62000, 18500], [-56000, 11000], [-50000, 8000]], [[-52000, 16800], [-44000, 22500], [-38000, 24000]]];
  for (const t of twigs) limb(t, 600, 160);
  const leafAt = (x: number, y: number) => {
    const a = rnd() * Math.PI * 2, s = 1300 + rnd() * 900, tone = pick(['#6f9a47', '#5c8a3c', '#7ca854', '#4f7b35', '#88b45e']);
    c.save(); c.translate(x, y); c.rotate(a);
    c.fillStyle = tone; c.beginPath(); c.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(230,255,190,0.25)'; c.beginPath(); c.ellipse(-s * 0.2, s * 0.1, s * 0.6, s * 0.2, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  };
  for (const path of [main, ...twigs]) for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]!, [x1, y1] = path[i]!;
    for (let k = 0; k < 16; k++) { const u = rnd(); leafAt(x0 + (x1 - x0) * u + (rnd() - 0.5) * 6000, y0 + (y1 - y0) * u + (rnd() - 0.4) * 6000); }
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
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform sampler2D tBranch, tNear, tMid, tFar, tHills, tGlow, tClouds;
uniform vec4 rBranch, rNear, rMid, rFar, rHills; // x0, yb, w, h
uniform vec4 zLayers;                             // near, mid, far, hills
uniform float zBranch, groundY, time, day, night, lights, wind;
uniform vec3 skyTop, skyHor, sunDir, sunCol, moonDir, light, haze;
uniform vec4 hazeK;                               // near, mid, far, hills
varying vec3 vWorld;

vec3 lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
float hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }

vec2 uvOn(vec4 r, float z, vec3 o, vec3 d) {
  vec3 p = o + d * ((z - o.z) / d.z);
  return vec2((p.x - r.x) / r.z, (p.y - r.y) / r.w);
}

/** One painted layer over what is behind it: its colour lit by the hour and hazed by distance, its lit windows on top. */
vec3 over(vec3 col, sampler2D t, vec4 r, float z, float k, int glow, vec3 o, vec3 d) {
  vec2 uv = uvOn(r, z, o, d);
  if (uv.y < 0.0 || uv.y > 1.0) return col;
  vec4 a = texture(t, vec2(uv.x, 1.0 - uv.y));
  vec3 c = mix(lin(a.rgb) * light, haze, k);
  if (glow >= 0) {
    vec4 g = texture(tGlow, vec2(uv.x, 1.0 - uv.y));
    float e = glow == 0 ? g.r : glow == 1 ? g.g : g.b;
    c += vec3(1.0, 0.72, 0.42) * e * lights * (glow == 2 ? 1.2 : 1.6);
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
  // a ray that dips under the houses meets the street and the garden below
  if (d.y < 0.0) {
    float tg = (groundY - o.y) / d.y;
    if (tg < (zLayers.x - o.z) / d.z) {
      vec3 p = o + d * tg;
      float lane = smoothstep(0.0, 1.0, abs(fract(p.x / 90000.0) - 0.5) * 2.0);
      vec3 g = mix(vec3(0.20, 0.30, 0.13), vec3(0.32, 0.31, 0.29), step(0.6, lane)) * (0.85 + 0.15 * hash(floor(p / 6000.0)));
      col = mix(g * light, haze, hazeK.x);
    }
  }
  // the branch outside, stirred a little by the wind
  vec2 bu = uvOn(rBranch, zBranch, o, d);
  bu.x += sin(time * 0.9 + bu.y * 5.0) * 0.004 * wind;
  if (bu.x > 0.0 && bu.x < 1.0 && bu.y > 0.0 && bu.y < 1.0) {
    vec4 b = texture(tBranch, vec2(bu.x, 1.0 - bu.y));
    // at night it is close enough to catch the moon and the room's spill: a dim blue-grey floor keeps its leaves from going black
    col = mix(col, lin(b.rgb) * (light * 0.9 + vec3(0.16, 0.18, 0.28) * lights), b.a);
  }
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
    const tGlow = texOf(packGlow(glow), true), tClouds = texOf(paintClouds(), true);
    this.mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        tBranch: { value: tBranch }, tNear: { value: tNear }, tMid: { value: tMid }, tFar: { value: tFar }, tHills: { value: tHills }, tGlow: { value: tGlow }, tClouds: { value: tClouds },
        rBranch: { value: rect(L.branch) }, rNear: { value: rect(L.near) }, rMid: { value: rect(L.mid) }, rFar: { value: rect(L.far) }, rHills: { value: rect(L.hills) },
        zLayers: { value: new Vector4(L.near.z, L.mid.z, L.far.z, L.hills.z) }, zBranch: { value: L.branch.z }, groundY: { value: GROUND_Y },
        time: { value: 0 }, day: { value: 1 }, night: { value: 0 }, lights: { value: 0 }, wind: { value: 1 },
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
    const s = skyAt(hour), day = daylight(hour), night = 1 - day, lift = 1.15 + 0.35 * day;
    const top = new Color(s.top).multiplyScalar(lift), hor = new Color(s.hor).multiplyScalar(lift);
    u.skyTop!.value.copy(top); u.skyHor!.value.copy(hor);
    u.day!.value = day; u.night!.value = night;
    u.lights!.value = Math.min(1, Math.max(0, 1.25 - day * 1.6));
    const sd = sunDir(hour);
    u.sunDir!.value.set(sd[0], sd[1], sd[2]);
    // the sun's light: white at midday, the horizon's warm colour low down, none at night
    const low = 1 - Math.min(1, Math.max(0, sd[1] / 0.45));
    u.sunCol!.value.copy(new Color(0xfff4e0).lerp(new Color(s.hor), low * 0.85)).multiplyScalar(day * 1.4);
    u.light!.value.copy(new Color(0x24304f).multiplyScalar(0.35)).lerp(new Color(0xfff6ea).lerp(new Color(s.hor), low * 0.6).multiplyScalar(1.15), day);
    u.haze!.value.copy(hor).multiplyScalar(0.92);
  }
}

/** The quad is part of the window (a click on the view works the blind), but it casts no shadow and takes none. */
export function outsideMesh(o: Outside): Mesh {
  o.mesh.castShadow = o.mesh.receiveShadow = false;
  return o.mesh;
}

