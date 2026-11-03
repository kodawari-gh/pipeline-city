// The outside's painted textures: canvas pictures that repeat by the metre, each painted once and shared (bricks, render, roof tiles,
// paving, asphalt, grass, a hedge, bark, a twig of leaves, the rooms behind the panes, a tower's windows). A height picture painted with the
// colour gives its normal map, so the low sun rakes over the joints. A map is kept as raw sRGB (`rawSrgb`): its material decodes it
// (`DECODE_SRGB`). Without a DOM (the tests) each texture is null.
import { CanvasTexture, NoColorSpace, RepeatWrapping, type Texture } from 'three';
import { rawSrgb } from '@/core/render/three/artlod';
import { anisotropy } from '@/core/render/three/geometry';
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
  return t;
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

/** Stretcher-bond brickwork, 8 bricks by 24 courses to 1.8 m: each brick its own shade, a few overburnt, in pale mortar. */
export function bricks(kind: 'red' | 'buff'): Surface {
  return surface(512, 512, [1.8, 1.8], 3, (c, hc, S) => {
    const r = rng(kind === 'red' ? 3 : 5), rows = 24, cols = 8, bh = S / rows, bw = S / cols, j = 3;
    const base: Rgb = kind === 'red' ? [150, 64, 46] : [186, 156, 108];
    c.fillStyle = kind === 'red' ? '#b5ab9c' : '#c9c1b0'; c.fillRect(0, 0, S, S);
    hc.fillStyle = '#383838'; hc.fillRect(0, 0, S, S);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const px = x * bw + (y % 2) * (bw / 2) + j / 2, py = y * bh + j / 2;
      const v = 0.8 + r() * 0.36, burnt = r() < 0.1 ? 0.62 : 1, warm = (r() - 0.5) * 18;
      const col: Rgb = [base[0] * v * burnt + warm, base[1] * v * burnt, base[2] * v * burnt - warm * 0.4], hv = 190 + r() * 50;
      for (const ox of [0, -S]) {
        c.fillStyle = rgb(col); c.fillRect(px + ox, py, bw - j, bh - j);
        hc.fillStyle = rgb([hv, hv, hv]); hc.fillRect(px + ox, py, bw - j, bh - j);
      }
    }
    stains(c, S, S, r, 18, [30, 110], (q) => [[60, 50, 45], 0.06 + q() * 0.08]);
    grain(c, S, S, 0.05, 7);
    grain(hc, S, S, 0.12, 8);
  });
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

/**
 * Roof tiles in courses of 20 cm, 30 cm wide, each lapped over the one above it. A uv's v runs down the slope (the picture's top is the eaves'
 * side): each tile rises to its lower edge, so the normal map steps at every course and the course below lies in its shadow line.
 */
export function tiles(kind: 'clay' | 'slate' | 'brown'): Surface {
  return surface(512, 512, [2.4, 2.4], 4, (c, hc, S) => {
    const r = rng(kind === 'clay' ? 13 : kind === 'slate' ? 14 : 15), rows = 12, cols = 8, th = S / rows, tw = S / cols;
    const base: Rgb = kind === 'clay' ? [160, 80, 54] : kind === 'slate' ? [74, 78, 86] : [116, 76, 60];
    c.fillStyle = rgb(base, 0.35); c.fillRect(0, 0, S, S);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const px = x * tw + (y % 2) * (tw / 2), py = y * th, v = 0.78 + r() * 0.34, moss = kind !== 'slate' && r() < 0.08;
      const col: Rgb = moss ? [base[0] * 0.7, base[1] * 0.85 + 12, base[2] * 0.6] : [base[0] * v, base[1] * v, base[2] * v];
      for (const ox of [0, -S]) {
        // the exposed tile: lighter toward its lower edge (the picture's top), a dark joint each side
        const g = c.createLinearGradient(0, py + th, 0, py);
        g.addColorStop(0, rgb(col, 0.82)); g.addColorStop(0.8, rgb(col, 1.04)); g.addColorStop(1, rgb(col, 0.9));
        c.fillStyle = g; c.fillRect(px + ox + 1.5, py, tw - 3, th);
        const hg = hc.createLinearGradient(0, py + th, 0, py);
        hg.addColorStop(0, '#303030'); hg.addColorStop(0.92, '#e8e8e8'); hg.addColorStop(1, '#c8c8c8');
        hc.fillStyle = hg; hc.fillRect(px + ox + 1.5, py, tw - 3, th);
      }
    }
    // the shadow each course casts on the one below it (toward the eaves: up the picture)
    for (let y = 0; y < rows; y++) {
      const g = c.createLinearGradient(0, y * th, 0, y * th - th * 0.22);
      g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, y * th - th * 0.22, S, th * 0.22);
    }
    grain(c, S, S, 0.05, 16);
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

/** A clipped hedge: small leaves packed close, darker in their gaps. */
export function hedge(): Surface {
  return surface(512, 512, [2, 2], 3, (c, hc, S) => {
    const r = rng(27);
    c.fillStyle = '#1d2c15'; c.fillRect(0, 0, S, S);
    hc.fillStyle = '#202020'; hc.fillRect(0, 0, S, S);
    for (let i = 0; i < 5200; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI, l = 5 + r() * 6, v = 0.6 + r() * 0.7;
      wrapped(S, S, x, y, l, (px, py) => {
        for (const [cc, col] of [[c, rgb([58 * v, 92 * v, 40 * v])], [hc, rgb([120 + v * 100, 120 + v * 100, 120 + v * 100])]] as const) {
          cc.fillStyle = col; cc.beginPath(); cc.ellipse(px, py, l, l * 0.5, a, 0, Math.PI * 2); cc.fill();
        }
      });
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

/** Birch bark: chalk white, ringed with dark lenticels, blacker toward the foot (u along the trunk, its foot at u = 0). */
export function birch(): Surface {
  return surface(512, 256, [3, 1.2], 2, (c, hc, W, H) => {
    const r = rng(31);
    c.fillStyle = '#e4e1da'; c.fillRect(0, 0, W, H);
    hc.fillStyle = '#c0c0c0'; hc.fillRect(0, 0, W, H);
    for (let i = 0; i < 420; i++) {
      const x = r() * W, y = r() * H, l = 6 + r() * 26, t = 1 + r() * 2.2, foot = 1 - x / W;
      c.fillStyle = `rgba(30,28,26,${0.45 + r() * 0.4})`;
      c.fillRect(x, y - l / 2, t + foot * 3, l);
      hc.fillStyle = 'rgba(40,40,40,0.8)'; hc.fillRect(x, y - l / 2, t, l);
    }
    const g = c.createLinearGradient(0, 0, W * 0.25, 0);
    g.addColorStop(0, 'rgba(40,36,32,0.75)'); g.addColorStop(1, 'rgba(40,36,32,0)');
    c.fillStyle = g; c.fillRect(0, 0, W * 0.25, H);
    grain(c, W, H, 0.04, 32);
  });
}

/**
 * A twig of leaves on a transparent card: some ninety pointed leaves round short stems, each with its midrib, in middling greens (a tree's
 * colour tints them). Denser in the middle, so a far card, its mipmaps averaged, still holds its shape.
 */
export function leaves(): Texture | null {
  const a = canvas(512, 512);
  if (!a) return null;
  const [cv, c] = a, r = rng(33), S = 512, C = S / 2;
  c.strokeStyle = 'rgba(70,58,40,1)'; c.lineWidth = 3;
  const stems: [number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2 + r() * 0.5, len = 120 + r() * 90;
    const x = C + Math.cos(ang) * len, y = C + Math.sin(ang) * len;
    c.beginPath(); c.moveTo(C, C); c.quadraticCurveTo(C + Math.cos(ang + 0.4) * len * 0.5, C + Math.sin(ang + 0.4) * len * 0.5, x, y); c.stroke();
    stems.push([x, y]);
  }
  for (let i = 0; i < 95; i++) {
    const [sx, sy] = stems[i % stems.length]!, t = r();
    const x = C + (sx - C) * (0.25 + t * 0.85) + (r() - 0.5) * 70, y = C + (sy - C) * (0.25 + t * 0.85) + (r() - 0.5) * 70;
    const l = 34 + r() * 26, w = l * (0.42 + r() * 0.14), ang = Math.atan2(y - C, x - C) + (r() - 0.5) * 1.6, v = 0.75 + r() * 0.5;
    c.save(); c.translate(x, y); c.rotate(ang);
    const g = c.createLinearGradient(-l, 0, l, 0);
    g.addColorStop(0, rgb([62 * v, 96 * v, 38 * v])); g.addColorStop(1, rgb([88 * v, 126 * v, 52 * v]));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(-l, 0); c.quadraticCurveTo(-l * 0.2, -w, l, 0); c.quadraticCurveTo(-l * 0.2, w, -l, 0); c.fill();
    c.strokeStyle = rgb([120 * v, 150 * v, 80 * v], 1, 0.6); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-l * 0.9, 0); c.lineTo(l * 0.85, 0); c.stroke();
    c.restore();
  }
  const t = rawSrgb(cv);
  t.anisotropy = anisotropy;
  return t;
}

/**
 * The rooms behind the panes, four to a picture (a pane takes one quarter): curtains drawn to each side in their folds, a sheer, a blind,
 * the dim room between. `lit`: the same rooms at night with their lights on (an emissive map: the curtains glow, the room is warm).
 */
export function rooms(lit: boolean): Texture | null {
  const a = canvas(512, 512);
  if (!a) return null;
  const [cv, c] = a, r = rng(lit ? 35 : 34), Q = 256;
  const cloth: Rgb[] = [[214, 200, 170], [120, 140, 112], [150, 74, 56], [96, 112, 140]];
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * Q, oy = Math.floor(q / 2) * Q;
    // the room: darker low down, a ceiling and a far wall catching a little light (at night, a lamp's warm glow)
    const g = c.createLinearGradient(0, oy, 0, oy + Q);
    if (lit) { g.addColorStop(0, '#ffd9a0'); g.addColorStop(0.5, '#d89a58'); g.addColorStop(1, '#5a3a20'); } else { g.addColorStop(0, '#3a3a3e'); g.addColorStop(0.45, '#26262a'); g.addColorStop(1, '#141416'); }
    c.fillStyle = g; c.fillRect(ox, oy, Q, Q);
    if (!lit) { c.fillStyle = 'rgba(70,64,58,0.6)'; c.fillRect(ox + Q * 0.35, oy + Q * 0.55, Q * 0.3, Q * 0.2); }
    const col = cloth[q]!, cw = Q * (0.18 + r() * 0.12);
    for (const side of [0, 1]) {
      const x0 = side ? ox + Q - cw : ox;
      for (let f = 0; f < cw; f += 6) {
        const v = 0.75 + 0.3 * Math.sin((f / cw) * Math.PI * 5 + side), k = lit ? 1.1 : 0.55;
        c.fillStyle = rgb(col, v * k);
        c.fillRect(x0 + f, oy, 6, Q);
      }
    }
    if (q === 1) { c.fillStyle = lit ? 'rgba(255,240,215,0.55)' : 'rgba(225,225,220,0.35)'; c.fillRect(ox, oy + Q * 0.45, Q, Q * 0.55); }
    if (q === 2) for (let y = 0; y < Q * 0.32; y += 7) { c.fillStyle = lit ? 'rgba(255,226,180,0.9)' : 'rgba(200,196,186,0.8)'; c.fillRect(ox, oy + y, Q, 5); }
  }
  const t = rawSrgb(cv);
  t.anisotropy = anisotropy;
  return t;
}

/**
 * A tower's facade, 8 bays by 8 floors to one picture (a bay 2.6 m, a floor 3.4 m): mullions, spandrels and dark glass that holds a little
 * sky. `lit`: the emissive map of the night, some rooms lit warm, some cool, most dark.
 */
export function towerFace(lit: boolean): Surface {
  const metres = [20.8, 27.2] as const, a = canvas(256, 256);
  if (!a) return { map: null, normal: null, metres };
  const [cv, c] = a, r = rng(lit ? 41 : 40), n = 8, s = 256 / n;
  c.fillStyle = lit ? '#000' : '#c9c6bf'; c.fillRect(0, 0, 256, 256);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const px = x * s + 3, py = y * s + 6, w = s - 6, h = s - 12;
    if (lit) {
      const on = r() < 0.32, cool = r() < 0.3, v = 0.5 + r() * 0.5;
      c.fillStyle = on ? (cool ? rgb([190, 215, 255], v) : rgb([255, 205, 140], v)) : '#000';
    } else {
      const g = c.createLinearGradient(0, py, 0, py + h);
      g.addColorStop(0, '#6d7f93'); g.addColorStop(1, '#2c3440');
      c.fillStyle = g;
    }
    c.fillRect(px, py, w, h);
  }
  return { map: tex(cv, metres, true), normal: null, metres };
}
