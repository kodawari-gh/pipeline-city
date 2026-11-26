// The furniture's painted textures: woven cloth (`weave`, `woven`), wood veneer (`oak`) and the relief of a painted map (`relief`).
import { NoColorSpace } from 'three';
import { paint } from '@/core/render/three/geometry';
import { rnd } from './seed';
import type { Texture } from './types';

/** How deep a weave's threads are (`relief`, in its texels). */
const WEAVE_DEPTH = 2.5;
/** Woven cloth: a weave (`weave`) as its map, and its threads' relief from the same texture as its normal map, so the light rakes them. */
export function woven(
  base: string,
  o: { knit?: boolean; repeat?: [number, number] } = {},
): { map: Texture | null; normalMap: Texture | null } {
  const map = weave(base, o);
  return { map, normalMap: relief(map, WEAVE_DEPTH) };
}

/** Cloth: a fine weave with a slub here and there. */
export function weave(base: string, o: { knit?: boolean; repeat?: [number, number] } = {}): Texture | null {
  return paint(
    256,
    256,
    (c, w, h) => {
      c.fillStyle = base;
      c.fillRect(0, 0, w, h);
      if (o.knit === true) {
        // rows of little V stitches
        for (let y = 0; y < h; y += 8) {
          for (let x = 0; x < w; x += 8) {
            c.fillStyle = `rgba(255,255,255,${0.06 + rnd() * 0.05})`;
            c.beginPath();
            c.ellipse(x + 2, y + 4, 2.2, 4, 0.5, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.05})`;
            c.beginPath();
            c.ellipse(x + 6, y + 4, 2.2, 4, -0.5, 0, Math.PI * 2);
            c.fill();
          }
        }
      } else {
        for (let i = 0; i < w; i += 2) {
          c.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.04})`;
          c.fillRect(i, 0, 1, h);
          c.fillRect(0, i, w, 1);
        }
        for (let k = 0; k < 40; k++) {
          c.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.05})`;
          c.fillRect(rnd() * w, rnd() * h, 6 + rnd() * 20, 1);
        }
      }
    },
    o.repeat ?? [6, 6],
  );
}

/** Wood veneer: a close straight grain along the texture's u (pale oak by default). `size` texels a side, the grain as close at every size. */
export function oak(
  base = '#c49a6c',
  line = '#8a6440',
  { repeat = [1, 1], size = 256 }: { repeat?: [number, number]; size?: number } = {},
): Texture | null {
  return paint(
    size,
    size,
    (c, w, h) => {
      c.fillStyle = base;
      c.fillRect(0, 0, w, h);
      const k = size / 256;
      for (let i = 0; i < 70 * k; i++) {
        c.strokeStyle = line;
        c.globalAlpha = 0.05 + rnd() * 0.12;
        c.lineWidth = (0.6 + rnd() * 1.6) * Math.sqrt(k);
        // a line that waves and comes back to its height at the tile's edge, drawn again a tile up and down: the tile repeats with no seam
        const y = rnd() * h,
          c1 = (rnd() * 8 - 4) * k,
          c2 = (rnd() * 8 - 4 + rnd() * 6 - 3) * k;
        for (const dy of [0, -h, h]) {
          c.beginPath();
          c.moveTo(0, y + dy);
          c.bezierCurveTo(w * 0.3, y + dy + c1, w * 0.6, y + dy + c2, w, y + dy);
          c.stroke();
        }
      }
      c.globalAlpha = 1;
    },
    repeat,
  );
}

/** Is `x` a canvas (a painted map's image, `paint`)? */
function isCanvas(x: unknown): x is HTMLCanvasElement {
  return typeof x === 'object' && x !== null && 'getContext' in x && typeof x.getContext === 'function';
}

/**
 * A normal map from a painted map's shade:
 its dark strokes (the grain's pores, a joint) are grooves, a full stroke `depth` deep (in the
 * map's own texels). It wraps and repeats as the map does. Null with no canvas.
 */
export function relief(map: Texture | null, depth: number): Texture | null {
  const src: unknown = map?.image;
  if (!map || !isCanvas(src)) {
    return null;
  }
  const ctx = src.getContext('2d');
  if (!ctx) {
    return null;
  }

  const w = src.width,
    h = src.height,
    d = ctx.getImageData(0, 0, w, h).data;
  const at = (x: number, y: number) => {
    const i = (((y + h) % h) * w + ((x + w) % w)) * 4;
    return ((d[i] ?? 0) * 0.3 + (d[i + 1] ?? 0) * 0.59 + (d[i + 2] ?? 0) * 0.11) / 255;
  };
  const t = paint(w, h, (c) => {
    const img = c.createImageData(w, h),
      o = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // the slope by central differences; the canvas runs down, the texture's v up
        const nx = -(at(x + 1, y) - at(x - 1, y)) * depth,
          ny = (at(x, y + 1) - at(x, y - 1)) * depth,
          l = Math.hypot(nx, ny, 1),
          i = (y * w + x) * 4;
        o[i] = 128 + 127 * (nx / l);
        o[i + 1] = 128 + 127 * (ny / l);
        o[i + 2] = 128 + 127 / l;
        o[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
  });
  if (!t) {
    return null;
  }
  t.colorSpace = NoColorSpace;

  t.wrapS = map.wrapS;
  t.wrapT = map.wrapT;
  t.repeat.copy(map.repeat);
  return t;
}
