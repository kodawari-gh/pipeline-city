// The lightmaps' file format (`src/features/room/light.md`, "Offline bakes"): HDR light in an 8-bit RGBA PNG (the owner, 2026-11-06: small
// files in the repository). RGBM over the square root: a texel's light v (linear, 0 to the map's `scale`) is e = sqrt(v / scale), stored as
// rgb = e / m and alpha = m, m the largest of e's channels rounded up. The game decodes v = scale * (rgb * alpha)²: 16 stops, finest in the
// dark. Node only (`bake.mjs`).
import { constants, deflateSync, inflateSync } from 'node:zlib';

/** The light at each texel, linear RGB, rows from the bottom (as Blender writes them), and the scale it is stored to. */
export interface Light {
  width: number;
  height: number;
  rgb: Float32Array;
  scale: number;
}

/** The number at `i` of an array the caller indexes within its length. */
const num = (a: ArrayLike<number>, i: number): number => a[i] ?? 0;

/** A map's size in texels. */
export interface Size {
  width: number;
  height: number;
}

/** The scale a map is stored to: its brightest channel (the denoised map has no lone hot texels). */
export function scaleOf(rgb: Float32Array): number {
  let s = 0;
  for (const v of rgb) {
    if (v > s) {
      s = v;
    }
  }
  return s > 0 ? s : 1;
}

/**
 * RGBM bytes, rows from the top (as a PNG holds them). A texel `keep` (rows from the top) marks 0 is black: nothing reads it, and the noise
 * the bake leaves there is a third of a file (`chartTexels`).
 */
export function encode({ width, height, rgb, scale }: Light, keep?: Uint8Array): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 3 * (y * width + x),
        t = (height - 1 - y) * width + x,
        o = 4 * t;
      if (keep && num(keep, t) === 0) {
        out[o + 3] = 1;
        continue;
      }
      const e = [0, 1, 2].map((k) => {
        const v = num(rgb, i + k) / scale;
        return Math.sqrt(Math.min(1, Math.max(0, v)));
      });
      const m = Math.max(1, Math.ceil(Math.max(...e) * 255));
      for (const [k, ek] of e.entries()) {
        out[o + k] = Math.min(255, Math.round((ek * 255 * 255) / m));
      }
      out[o + 3] = m;
    }
  }
  return out;
}

/** The light back from RGBM bytes (rows from the top), rows from the bottom: what the game's shader does. */
export function decode(bytes: Uint8Array, { width, height, scale }: Omit<Light, 'rgb'>): Float32Array {
  const out = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 4 * ((height - 1 - y) * width + x),
        o = 3 * (y * width + x),
        m = num(bytes, i + 3) / 255;
      for (let k = 0; k < 3; k++) {
        const e = (num(bytes, i + k) / 255) * m;
        out[o + k] = scale * e * e;
      }
    }
  }
  return out;
}

/** A direct map's channel clips above this many times its 99.5th percentile: the few texels beside the lamp must not take the 8 bits' range. */
export const DIRECT_CLIP = 4;

/** One lamp group's direct light in a packed map: the scale its channel decodes by and its hue (the light is `colour * scale * byte²`). */
export interface DirectEntry {
  scale: number;
  colour: [number, number, number];
}

/**
 * Up to three lamp groups' direct light in one RGBA map (rows from the top, alpha 255), a group a channel: the square root of its brightest
 * channel over its scale. A group's light has one hue (its lamps share a colour, and a lightmap holds the light before the surface's colour),
 * so one value a texel and `colour` give it back. `keep` as in `encode`.
 */
/** The size of the maps `packDirect` packs and the texels it keeps (`keep` as in `encode`). */
export interface PackOptions extends Size {
  keep?: Uint8Array;
}

/** One group's channel of a packed map: its light (the brightest channel a texel), its scale and its hue. */
function directChannel(
  rgb: Float32Array,
  { width, height, keep }: PackOptions,
): { s: Float32Array; entry: DirectEntry } {
  const s = new Float32Array(width * height),
    sum = [0, 0, 0];
  let total = 0,
    top = 0;
  const lit: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 3 * (y * width + x),
        t = (height - 1 - y) * width + x,
        c = [0, 1, 2].map((k) => num(rgb, i + k)),
        v = Math.max(0, ...c);
      if ((keep && num(keep, t) === 0) || v <= 0) {
        continue;
      }
      s[t] = v;
      total += v;
      top = Math.max(top, v);
      lit.push(v);
      for (const [k, ck] of c.entries()) {
        sum[k] = num(sum, k) + Math.max(0, ck);
      }
    }
  }
  lit.sort((a, b) => a - b);
  const clip = Math.min(top, DIRECT_CLIP * num(lit, Math.floor(0.995 * (lit.length - 1))));
  const scale = lit.length > 0 && clip > 0 ? clip : 1;
  const colour: [number, number, number] =
    total > 0 ? [num(sum, 0) / total, num(sum, 1) / total, num(sum, 2) / total] : [1, 1, 1];
  return { s, entry: { scale, colour } };
}

/**
 * Up to three lamp groups' direct light in one RGBA map (rows from the top, alpha 255), a group a channel: the square root of its brightest
 * channel over its scale. A group's light has one hue (its lamps share a colour, and a lightmap holds the light before the surface's colour),
 * so one value a texel and `colour` give it back. `keep` as in `encode`.
 */
export function packDirect(
  lights: readonly Float32Array[],
  options: PackOptions,
): { bytes: Uint8Array; entries: DirectEntry[] } {
  const n = options.width * options.height,
    bytes = new Uint8Array(n * 4),
    entries: DirectEntry[] = [];
  for (let t = 0; t < n; t++) {
    bytes[4 * t + 3] = 255;
  }
  for (const [c, rgb] of lights.slice(0, 3).entries()) {
    const { s, entry } = directChannel(rgb, options);
    for (let t = 0; t < n; t++) {
      const v = num(s, t) / entry.scale;
      bytes[4 * t + c] = Math.round(255 * Math.sqrt(Math.min(1, v)));
    }
    entries.push(entry);
  }
  return { bytes, entries };
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) === 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
  }
  return c;
});
function crc32(b: Uint8Array): number {
  let c = -1;
  for (const byte of b) {
    c = num(CRC, (c ^ byte) & 255) ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length),
    v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.codePointAt(i) ?? 0;
  }
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
};

/** The bytes left (`a`), above (`b`) and above left (`c`) of byte `i` of a row of `row` bytes: 0 off the picture. */
function around(rgba: Uint8Array, i: number, row: number): [number, number, number] {
  const x = i % row,
    y = Math.floor(i / row);
  return [x >= 4 ? num(rgba, i - 4) : 0, y > 0 ? num(rgba, i - row) : 0, x >= 4 && y > 0 ? num(rgba, i - row - 4) : 0];
}

/** The prediction a PNG filter type makes from the bytes around (`around`). */
function predict(f: number, [a, b, c]: [number, number, number]): number {
  switch (f) {
    case 0: {
      return 0;
    }
    case 1: {
      return a;
    }
    case 2: {
      return b;
    }
    case 3: {
      return (a + b) >> 1;
    }
    default: {
      return paeth(a, b, c);
    }
  }
}

/** An RGBA PNG (8 bits a channel, each row Paeth filtered), with no colour profile: the bytes are data, not a picture. */
export function png(rgba: Uint8Array, { width, height }: Size): Uint8Array {
  const row = width * 4,
    raw = new Uint8Array(height * (row + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (row + 1)] = 4;
    for (let x = 0; x < row; x++) {
      const i = y * row + x;
      raw[y * (row + 1) + 1 + x] = (num(rgba, i) - predict(4, around(rgba, i, row))) & 255;
    }
  }
  const head = new Uint8Array(13),
    v = new DataView(head.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  head[8] = 8;
  head[9] = 6;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw, { level: 9, memLevel: 9, strategy: constants.Z_FILTERED })),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Read back a PNG that `png` wrote (for the tests and the bake's checks). */
export function unpng(file: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength),
    idat: Uint8Array[] = [];
  let width = 0,
    height = 0;
  for (let o = 8; o < file.length;) {
    const n = v.getUint32(o),
      type = String.fromCodePoint(...file.subarray(o + 4, o + 8)),
      data = file.subarray(o + 8, o + 8 + n);
    if (type === 'IHDR') {
      width = v.getUint32(o + 8);
      height = v.getUint32(o + 12);
    }
    if (type === 'IDAT') {
      idat.push(data);
    }
    o += 12 + n;
  }
  const raw = inflateSync(Buffer.concat(idat)),
    row = width * 4,
    rgba = new Uint8Array(height * row);
  for (let y = 0; y < height; y++) {
    const f = num(raw, y * (row + 1));
    for (let x = 0; x < row; x++) {
      const i = y * row + x;
      rgba[i] = (num(raw, y * (row + 1) + 1 + x) + predict(f, around(rgba, i, row))) & 255;
    }
  }
  return { width, height, rgba };
}
