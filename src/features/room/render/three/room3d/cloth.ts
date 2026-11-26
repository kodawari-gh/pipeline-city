// The room's cloths, painted from the room's stream (`rnd`): the blinds' screen and the rug.
import { paint } from '@/core/render/three/geometry';
import { RUG_LINE, RUG_WOOL } from '../palette';
import { reseed, rnd, seedNow } from './seed';
import type { Texture } from './types';

const ease = (t: number): number => t * t * (3 - 2 * t);

/** The blinds' screen: a dark cloth with a soft cloud of light and shade (smooth noise over three scales, seamless) and a fine stipple. */
export function screenTex(base: string, repeat: [number, number]): Texture | null {
  return paint(
    512,
    512,
    (c, w, h) => {
      c.fillStyle = base;
      c.fillRect(0, 0, w, h);
      const img = c.getImageData(0, 0, w, h),
        d = img.data;
      // a lattice of random values per scale, wrapped at the tile's edge, blended smoothly between its points
      const octaves = [
        [4, 5],
        [9, 3],
        [23, 1.6],
      ].map(([n = 0, amp = 0]) => ({ n, amp, v: Array.from({ length: n * n }, () => rnd() * 2 - 1) }));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let s = 0;
          for (const { n, amp, v } of octaves) {
            const fx = (x / w) * n,
              fy = (y / h) * n,
              ix = Math.floor(fx),
              iy = Math.floor(fy),
              tx = ease(fx - ix),
              ty = ease(fy - iy);
            const r0 = iy * n,
              r1 = ((iy + 1) % n) * n,
              i1 = (ix + 1) % n;
            const at = (i: number): number => v[i] ?? 0;
            s +=
              amp *
              ((at(r0 + ix) * (1 - tx) + at(r0 + i1) * tx) * (1 - ty) +
                (at(r1 + ix) * (1 - tx) + at(r1 + i1) * tx) * ty);
          }
          s += (rnd() - 0.5) * 4;
          const o = (y * w + x) * 4;
          for (let k = 0; k < 3; k++) {
            d[o + k] = Math.max(0, Math.min(255, (d[o + k] ?? 0) + s));
          }
        }
      }
      c.putImageData(img, 0, 0);
    },
    repeat,
  );
}

/**
 * A flat-woven wool rug: charcoal, a faint weave of light and dark rows, a thin quiet line inside a plain edge; a fleck of pile (its bump too).
 * One quiet field: the weave and the line stay well under the floor's grain and the bed's cloth.
 */
function rugTex(): Texture | null {
  return paint(1024, 768, (c, w, h) => {
    c.fillStyle = RUG_WOOL;
    c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 12) {
      for (let y = 0; y < h; y += 6) {
        c.fillStyle = (Math.floor(x / 12) + Math.floor(y / 6)) % 2 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.03)';
        c.fillRect(x, y, 12, 3);
      }
    }
    for (let k = 0; k < 14_000; k++) {
      c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.03 + rnd() * 0.05})` : `rgba(0,0,0,${0.05 + rnd() * 0.08})`;
      c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    const m = 54;
    c.globalAlpha = 0.35;
    c.strokeStyle = RUG_LINE;
    c.lineWidth = 2;
    c.strokeRect(m, m, w - 2 * m, h - 2 * m);
    c.globalAlpha = 1;
  });
}

/** The rug's map, painted: always the same flecks (its own seed). The texture bake runs it (`room-rug`, `tools/bake/textures.mjs`). */
export function rugMap(): Texture | null {
  const keep = seedNow();
  reseed(9311);
  const map = rugTex();
  reseed(keep);
  return map;
}
