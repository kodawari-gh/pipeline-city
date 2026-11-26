// The walls' plaster: one flat paint over a skimmed wall, its fine relief in a normal map and a roughness map (`plasterMaps`, or the baked set).
import { NoColorSpace, RepeatWrapping } from 'three';
import { bakedTex } from '@/core/render/three/baked';
import { paint, shareTex } from '@/core/render/three/geometry';
import type { Texture } from './types';

/** The plaster's relief: its height in the normal map's slope (per texel), how much smoother the peel's tops are than its pits. */
const PLASTER_RELIEF = 0.12,
  PLASTER_SHEEN = 0.12;
/** The plaster's tile, texels a side. */
const N = 512;

const ease = (t: number): number => t * t * (3 - 2 * t);

interface Octave {
  n: number;
  amp: number;
  v: number[];
}

/** One octave's value at texel (x, y): its lattice blended smoothly between its points, wrapped at the tile's edge. */
function octaveAt({ n, amp, v }: Octave, x: number, y: number): number {
  const fx = (x / N) * n,
    fy = (y / N) * n,
    ix = Math.floor(fx),
    iy = Math.floor(fy),
    tx = ease(fx - ix),
    ty = ease(fy - iy);
  const r0 = iy * n,
    r1 = ((iy + 1) % n) * n,
    i1 = (ix + 1) % n;
  const at = (i: number): number => v[i] ?? 0;
  return (
    amp * ((at(r0 + ix) * (1 - tx) + at(r0 + i1) * tx) * (1 - ty) + (at(r1 + ix) * (1 - tx) + at(r1 + i1) * tx) * ty)
  );
}

/** The plaster's height field: the octaves summed and a grain of noise, all from the plaster's own stream (`r`). */
function heightField(r: () => number): Float32Array {
  const hgt = new Float32Array(N * N);
  // a lattice of random values per scale (cells of about 1.7 cm, 3.4 mm, 1.7 mm), wrapped at the tile's edge, blended smoothly between its points
  const octaves: Octave[] = [
    [26, 0.3],
    [128, 0.75],
    [256, 0.4],
  ].map(([n = 0, amp = 0]) => ({ n, amp, v: Array.from({ length: n * n }, () => r() * 2 - 1) }));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (const o of octaves) {
        s += octaveAt(o, x, y);
      }
      hgt[y * N + x] = s + (r() - 0.5) * 0.2;
    }
  }
  return hgt;
}

/** A texel of a map being painted: the image's bytes and where its rgb starts. */
interface Texel {
  d: Uint8ClampedArray;
  i: number;
}

/** One map from the height field: `px(x, y, out)` fills a texel's rgb. */
function field(px: (x: number, y: number, o: Texel) => void): Texture | null {
  const t = paint(
    N,
    N,
    (c, w, h) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, w, h);
      const img = c.getImageData(0, 0, w, h),
        o: Texel = { d: img.data, i: 0 };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          o.i = (y * w + x) * 4;
          px(x, y, o);
        }
      }
      c.putImageData(img, 0, 0);
    },
    [1, 1],
  );
  if (t) {
    t.colorSpace = NoColorSpace;
  }
  return t;
}

/**
 * Plaster: one flat paint over a skimmed wall, an even modern finish. Its relief is a fine orange peel from the roller over a faint trowel
 * ripple, seamless across the tile's edges, and it shows only in the light that rakes it (the normal map); the peel's tops are a little
 * smoother than its pits (the roughness map). The paint is one flat colour, the material's (`WALL`): it has no clouds (a stain on a wall
 * is the light's, not the paint's), and no colour map (the old one moved a texel 2 levels of 255 at most, which nobody saw, for 1.4 MB of
 * GPU memory). Its own stream of random numbers, so the room's other textures keep theirs and a bake gives the same files each time. The
 * texture bake runs it (`room-plaster`, `tools/bake/textures.mjs`).
 */
export function plasterMaps(): PlasterMaps {
  let seed = 4271;
  const hgt = heightField(() => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647);
  const at = (x: number, y: number): number => hgt[((y + N) % N) * N + ((x + N) % N)] ?? 0;
  return {
    // the slope by central differences; the canvas runs down, the texture's v up
    normalMap: field((x, y, { d, i }) => {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * PLASTER_RELIEF,
        ny = (at(x, y + 1) - at(x, y - 1)) * PLASTER_RELIEF,
        l = Math.hypot(nx, ny, 1);
      d[i] = 128 + 127 * (nx / l);
      d[i + 1] = 128 + 127 * (ny / l);
      d[i + 2] = 128 + 127 / l;
    }),
    roughnessMap: field((x, y, { d, i }) => {
      d[i] = 255;
      d[i + 2] = 255;

      d[i + 1] = 255 * (1 - PLASTER_SHEEN * Math.min(1, Math.max(0, 0.5 + at(x, y) * 0.4)));
    }),
  };
}
interface PlasterMaps {
  normalMap: Texture | null;
  roughnessMap: Texture | null;
}

/** The plaster's two maps from the baked set (`public/tex/`, `npm run bake:tex`); null before it has loaded or with `?nobaked`. */
export function bakedPlaster(): PlasterMaps | null {
  const normalMap = bakedTex('room-plaster-n'),
    roughnessMap = bakedTex('room-plaster-r');
  if (!normalMap || !roughnessMap) {
    return null;
  }
  for (const t of [normalMap, roughnessMap]) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    shareTex(t);
  }
  return { normalMap, roughnessMap };
}
