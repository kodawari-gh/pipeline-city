// The outside's painted textures: canvas pictures that repeat by the metre, each painted once and shared (render, paving, asphalt, grass,
// bark). A height picture painted with the
// colour gives its normal map, so the low sun rakes over the joints. A map is kept as raw sRGB (`rawSrgb`): its material decodes it
// (`DECODE_SRGB`). Without a DOM (the tests) each texture is null.
import { CanvasTexture, NoColorSpace, RepeatWrapping, type Texture } from 'three';
import { rawSrgb } from '@/core/render/three/artlod';
import { anisotropy, shareTex } from '@/core/render/three/geometry';
import { rng } from './plan';

type Ctx = CanvasRenderingContext2D;
type Rgb = readonly [number, number, number];

/** A painted surface: its map, its normal map, and the size one repeat covers (m). */
export interface Surface { map: Texture | null; normal: Texture | null; metres: readonly [number, number] }

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d', { willReadFrequently: true })!];
}

/** A repeating texture of a canvas, a uv in metres divided by `metres`. `colour`: raw sRGB (decoded by its material); else linear data (a normal map). */
function tex(cv: HTMLCanvasElement, metres: readonly [number, number], colour: boolean): Texture {
  const t = colour ? rawSrgb(cv) : new CanvasTexture(cv);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1 / metres[0], 1 / metres[1]);
  t.anisotropy = anisotropy;
  return shareTex(t);
}

/** The normal map of a height picture (white is high), its slopes scaled by `k`. It wraps at the edges, as the picture tiles. */
function normalOf(h: HTMLCanvasElement, k: number): HTMLCanvasElement {
  const w = h.width, H = h.height, src = h.getContext('2d')!.getImageData(0, 0, w, H).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = H;
  const c = out.getContext('2d')!, img = c.createImageData(w, H), d = img.data;
  const at = (x: number, y: number) => src[((((y + H) % H) * w + ((x + w) % w)) * 4)]! / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) {
    // the picture's y runs down, a texture's v up: a rise toward the picture's bottom tilts the normal toward -v
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k, l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (0.5 / l + 0.5) * 255; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return out;
}

/** A surface painted on two canvases at once: the colour and the height. */
function surface(w: number, h: number, metres: readonly [number, number], bump: number, draw: (c: Ctx, hc: Ctx, w: number, h: number) => void): Surface {
  const a = canvas(w, h), b = canvas(w, h);
  if (!a || !b) return { map: null, normal: null, metres };
  draw(a[1], b[1], w, h);
  return { map: tex(a[0], metres, true), normal: tex(normalOf(b[0], bump), metres, false), metres };
}

/** Draw at (x, y), and again across each edge the shape (radius `r`) crosses, so the picture tiles. */
function wrapped(w: number, h: number, x: number, y: number, r: number, draw: (x: number, y: number) => void): void {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
    const px = x + dx, py = y + dy;
    if (px + r < 0 || px - r > w || py + r < 0 || py - r > h) continue;
    draw(px, py);
  }
}

const rgb = (c: Rgb, k = 1, a = 1): string => `rgba(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)},${a})`;

/** Fine grain: each pixel's lightness moved by up to ±k (0..1). */
function grain(c: Ctx, w: number, h: number, k: number, seed: number): void {
  const img = c.getImageData(0, 0, w, h), d = img.data, r = rng(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 2 * k * 255;
    d[i] = d[i]! + n; d[i + 1] = d[i + 1]! + n; d[i + 2] = d[i + 2]! + n;
  }
  c.putImageData(img, 0, 0);
}

/** Soft round stains, each a colour fading out to its edge. */
function stains(c: Ctx, w: number, h: number, r: () => number, n: number, rad: readonly [number, number], col: (r: () => number) => [Rgb, number]): void {
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, s = rad[0] + r() * (rad[1] - rad[0]), [cc, a] = col(r);
    wrapped(w, h, x, y, s, (px, py) => {
      const g = c.createRadialGradient(px, py, 0, px, py, s);
      g.addColorStop(0, rgb(cc, 1, a)); g.addColorStop(1, rgb(cc, 1, 0));
      c.fillStyle = g;
      c.fillRect(px - s, py - s, s * 2, s * 2);
    });
  }
}

/** Render (stucco): near white, so a material's colour tints it, with faint weather stains and grain. */
export function stucco(): Surface {
  return surface(512, 512, [3, 3], 1.4, (c, hc, S) => {
    const r = rng(9);
    c.fillStyle = '#ecebe6'; c.fillRect(0, 0, S, S);
    stains(c, S, S, r, 40, [30, 140], (q) => [[118, 112, 100], 0.04 + q() * 0.07]);
    stains(c, S, S, r, 20, [20, 60], (q) => [[255, 255, 250], 0.05 + q() * 0.08]);
    grain(c, S, S, 0.035, 10);
    hc.fillStyle = '#808080'; hc.fillRect(0, 0, S, S);
    stains(hc, S, S, r, 60, [6, 26], (q) => [q() < 0.5 ? [40, 40, 40] : [220, 220, 220], 0.25]);
    grain(hc, S, S, 0.35, 11);
  });
}

/** Paving slabs of 60 cm in a square grid, each its own shade, with dark joints and a few stains. */
export function paving(): Surface {
  return surface(512, 512, [1.8, 1.8], 2.5, (c, hc, S) => {
    const r = rng(17), n = 3, s = S / n, j = 3;
    c.fillStyle = '#5c5a55'; c.fillRect(0, 0, S, S);
    hc.fillStyle = '#303030'; hc.fillRect(0, 0, S, S);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 0.86 + r() * 0.2, hv = 200 + r() * 30;
      c.fillStyle = rgb([176 * v, 170 * v, 158 * v]); c.fillRect(x * s + j / 2, y * s + j / 2, s - j, s - j);
      hc.fillStyle = rgb([hv, hv, hv]); hc.fillRect(x * s + j / 2, y * s + j / 2, s - j, s - j);
    }
    stains(c, S, S, r, 26, [4, 18], (q) => [[40, 38, 35], 0.15 + q() * 0.3]);
    stains(c, S, S, r, 10, [40, 120], (q) => [[90, 86, 78], 0.06 + q() * 0.08]);
    grain(c, S, S, 0.06, 18);
    grain(hc, S, S, 0.1, 19);
  });
}

/** Asphalt: dark grey aggregate with lighter stones, worn patches and a few cracks. */
export function asphalt(): Surface {
  return surface(512, 512, [4, 4], 1.6, (c, hc, S) => {
    const r = rng(21);
    c.fillStyle = '#4a4a4c'; c.fillRect(0, 0, S, S);
    hc.fillStyle = '#707070'; hc.fillRect(0, 0, S, S);
    stains(c, S, S, r, 24, [40, 160], (q) => [q() < 0.5 ? [30, 30, 32] : [110, 108, 104], 0.06 + q() * 0.07]);
    for (let i = 0; i < 9000; i++) {
      const x = r() * S, y = r() * S, z = 0.6 + r() * 1.8, l = r();
      c.fillStyle = l < 0.55 ? `rgba(150,148,142,${0.25 + r() * 0.4})` : `rgba(20,20,22,${0.2 + r() * 0.4})`;
      c.fillRect(x, y, z, z);
      hc.fillStyle = l < 0.55 ? 'rgba(230,230,230,0.6)' : 'rgba(20,20,20,0.6)';
      hc.fillRect(x, y, z, z);
    }
    c.strokeStyle = 'rgba(18,18,18,0.6)'; hc.strokeStyle = 'rgba(0,0,0,0.9)';
    for (let k = 0; k < 5; k++) {
      let x = r() * S, y = r() * S;
      c.beginPath(); hc.beginPath(); c.moveTo(x, y); hc.moveTo(x, y);
      for (let i = 0; i < 9; i++) { x += (r() - 0.5) * 40; y += (r() - 0.3) * 30; c.lineTo(x, y); hc.lineTo(x, y); }
      c.lineWidth = hc.lineWidth = 1.4; c.stroke(); hc.stroke();
    }
    grain(c, S, S, 0.05, 22);
  });
}

/** Mown grass: short blades in mixed greens, a few yellower. */
export function grass(): Surface {
  return surface(512, 512, [3, 3], 2, (c, hc, S) => {
    const r = rng(25);
    c.fillStyle = '#4a6a2e'; c.fillRect(0, 0, S, S);
    hc.fillStyle = '#606060'; hc.fillRect(0, 0, S, S);
    stains(c, S, S, r, 30, [30, 120], (q) => [q() < 0.6 ? [96, 120, 52] : [52, 74, 34], 0.15 + q() * 0.15]);
    c.lineWidth = hc.lineWidth = 1.3;
    for (let i = 0; i < 14000; i++) {
      const x = r() * S, y = r() * S, a = (r() - 0.5) * 1.2, l = 3 + r() * 6, v = 0.7 + r() * 0.6, dry = r() < 0.08;
      c.strokeStyle = dry ? rgb([150 * v, 150 * v, 80 * v], 1, 0.8) : rgb([70 * v, 108 * v, 42 * v], 1, 0.8);
      hc.strokeStyle = `rgba(${Math.round(150 + r() * 100)},0,0,0.6)`;
      for (const cc of [c, hc]) { cc.beginPath(); cc.moveTo(x, y); cc.lineTo(x + Math.sin(a) * l, y - Math.cos(a) * l); cc.stroke(); }
    }
  });
}

/** Furrowed bark (u along the trunk, v round it): grey-brown ridges and dark cracks, a few lichen patches. */
export function bark(): Surface {
  return surface(512, 256, [2.4, 1.2], 4, (c, hc, W, H) => {
    const r = rng(29);
    c.fillStyle = '#5a4f45'; c.fillRect(0, 0, W, H);
    hc.fillStyle = '#909090'; hc.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {
      let x = r() * W, y = r() * H;
      const len = 40 + r() * 160, dark = r() < 0.55;
      c.strokeStyle = dark ? 'rgba(30,24,20,0.7)' : 'rgba(140,128,112,0.5)';
      hc.strokeStyle = dark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.5)';
      c.lineWidth = hc.lineWidth = dark ? 1.5 + r() * 2.5 : 2 + r() * 3;
      c.beginPath(); hc.beginPath(); c.moveTo(x, y); hc.moveTo(x, y);
      for (let s = 0; s < len; s += 12) { x += 12; y += (r() - 0.5) * 5; c.lineTo(x, y); hc.lineTo(x, y); }
      c.stroke(); hc.stroke();
    }
    stains(c, W, H, r, 14, [8, 30], (q) => [[150, 160, 120], 0.2 + q() * 0.2]);
    grain(c, W, H, 0.06, 30);
  });
}
