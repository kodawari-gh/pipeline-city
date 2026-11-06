// The lightmaps' file format (`src/features/room/light.md`, "Offline bakes"): HDR light in an 8-bit RGBA PNG (the owner, 2026-11-06: small
// files in the repository). RGBM over the square root: a texel's light v (linear, 0 to the map's `scale`) is e = sqrt(v / scale), stored as
// rgb = e / m and alpha = m, m the largest of e's channels rounded up. The game decodes v = scale * (rgb * alpha)²: 16 stops, finest in the
// dark. Node only (`bake.mjs`).
import { deflateSync, inflateSync } from 'node:zlib';

/** The light at each texel, linear RGB, rows from the bottom (as Blender writes them), and the scale it is stored to. */
export interface Light { width: number; height: number; rgb: Float32Array; scale: number }

/** The scale a map is stored to: its brightest channel (the denoised map has no lone hot texels). */
export function scaleOf(rgb: Float32Array): number {
  let s = 0;
  for (let i = 0; i < rgb.length; i++) if (rgb[i]! > s) s = rgb[i]!;
  return s || 1;
}

/** RGBM bytes, rows from the top (as a PNG holds them). */
export function encode({ width, height, rgb, scale }: Light): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = 3 * (y * width + x), o = 4 * ((height - 1 - y) * width + x);
    const e = [0, 1, 2].map((k) => Math.sqrt(Math.min(1, Math.max(0, rgb[i + k]! / scale))));
    const m = Math.max(1, Math.ceil(Math.max(e[0]!, e[1]!, e[2]!) * 255));
    for (let k = 0; k < 3; k++) out[o + k] = Math.min(255, Math.round((e[k]! * 255 * 255) / m));
    out[o + 3] = m;
  }
  return out;
}

/** The light back from RGBM bytes (rows from the top), rows from the bottom: what the game's shader does. */
export function decode(bytes: Uint8Array, width: number, height: number, scale: number): Float32Array {
  const out = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = 4 * ((height - 1 - y) * width + x), o = 3 * (y * width + x), m = bytes[i + 3]! / 255;
    for (let k = 0; k < 3; k++) { const e = (bytes[i + k]! / 255) * m; out[o + k] = scale * e * e; }
  }
  return out;
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]!) & 255]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

/** An RGBA PNG (8 bits a channel, each row Paeth filtered), with no colour profile: the bytes are data, not a picture. */
export function png(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const row = width * 4, raw = new Uint8Array(height * (row + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (row + 1)] = 4;
    for (let x = 0; x < row; x++) {
      const i = y * row + x, a = x >= 4 ? rgba[i - 4]! : 0, b = y ? rgba[i - row]! : 0, c = x >= 4 && y ? rgba[i - row - 4]! : 0;
      raw[y * (row + 1) + 1 + x] = (rgba[i]! - paeth(a, b, c)) & 255;
    }
  }
  const head = new Uint8Array(13), v = new DataView(head.buffer);
  v.setUint32(0, width); v.setUint32(4, height); head[8] = 8; head[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Read back a PNG that `png` wrote (for the tests and the bake's checks). */
export function unpng(file: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength), idat: Uint8Array[] = [];
  let width = 0, height = 0;
  for (let o = 8; o < file.length;) {
    const n = v.getUint32(o), type = String.fromCharCode(...file.subarray(o + 4, o + 8)), data = file.subarray(o + 8, o + 8 + n);
    if (type === 'IHDR') { width = v.getUint32(o + 8); height = v.getUint32(o + 12); }
    if (type === 'IDAT') idat.push(data);
    o += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat)), row = width * 4, rgba = new Uint8Array(height * row);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (row + 1)]!;
    for (let x = 0; x < row; x++) {
      const i = y * row + x, a = x >= 4 ? rgba[i - 4]! : 0, b = y ? rgba[i - row]! : 0, c = x >= 4 && y ? rgba[i - row - 4]! : 0;
      const p = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      rgba[i] = (raw[y * (row + 1) + 1 + x]! + p) & 255;
    }
  }
  return { width, height, rgba };
}
