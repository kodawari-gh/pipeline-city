// The sky's cloud and moon-sea noise, baked once for Low. It is the live `fbm` of `sky.ts` (five octaves, the same weights), made periodic:
// the base lattice has `NOISE_PERIOD` cells per period, and each octave doubles the cells, so every octave repeats with the map. The map
// is sampled with wrap and mipmaps, so the clouds drift on without a seam and the far ones do not shimmer. Built on first use, then shared.
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

/** Texels per side of the baked map. */
export const NOISE_SIZE = 256;
/** The sky's units across one period of the map (the base lattice's cells). */
export const NOISE_PERIOD = 16;
/** The octaves, as the live `fbm`. */
const OCTAVES = 5;

/** A hash of a lattice point to [0, 1). */
function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Periodic value noise at (u, v), in lattice cells, the lattice `cells` across. Smooth-stepped, as the live `noise`. */
function vnoise(u: number, v: number, cells: number): number {
  const iu = Math.floor(u), iv = Math.floor(v);
  let fu = u - iu, fv = v - iv;
  fu = fu * fu * (3 - 2 * fu);
  fv = fv * fv * (3 - 2 * fv);
  const x0 = ((iu % cells) + cells) % cells, y0 = ((iv % cells) + cells) % cells;
  const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
  const a = hash(x0, y0), b = hash(x1, y0), c = hash(x0, y1), d = hash(x1, y1);
  const low = a + (b - a) * fu, high = c + (d - c) * fu;
  return low + (high - low) * fv;
}

/**
 * The periodic fbm of a `size` by `size` map, in RGBA bytes (the same value in each channel), `period` lattice cells across. Octave `o`
 * has `period * 2^o` cells, so every octave repeats with the map. Returned as bytes so the GPU can sample it.
 */
export function bakeFbm(size = NOISE_SIZE, period = NOISE_PERIOD): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let s = 0, a = 0.5, cells = period;
      for (let o = 0; o < OCTAVES; o++) {
        s += a * vnoise((i / size) * cells, (j / size) * cells, cells);
        cells *= 2;
        a *= 0.5;
      }
      const q = Math.round(s * 255), k = (j * size + i) * 4;
      out[k] = out[k + 1] = out[k + 2] = out[k + 3] = q;
    }
  }
  return out;
}

let baked: DataTexture | null = null;

/** The shared baked map: the periodic fbm, wrapped and mipmapped. Its sample at `p / NOISE_PERIOD` is the live `fbm(p)`'s value, to a byte. */
export function skyNoise(): DataTexture {
  if (!baked) {
    const t = new DataTexture(bakeFbm(), NOISE_SIZE, NOISE_SIZE, RGBAFormat, UnsignedByteType);
    t.colorSpace = NoColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.needsUpdate = true;
    baked = t;
  }
  return baked;
}
