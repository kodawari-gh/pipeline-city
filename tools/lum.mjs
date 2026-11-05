// `node tools/lum.mjs <png> x,y,w,h [x,y,w,h ...]`: the mean linear luminance (Rec. 709) and the mean sRGB of each rect of a screenshot, one line
// each, so a render change can be measured, not only looked at (a shot from `shot.mjs`, e.g. the 3D room at a pinned hour and view). It reads
// the 8-bit, non-interlaced PNGs that Chrome saves, with node's zlib and no other package.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const [file, ...rects] = process.argv.slice(2);
if (!file || !rects.length) { console.log('usage: node tools/lum.mjs <png> x,y,w,h [x,y,w,h ...]'); process.exit(1); }

/** A PNG's size, its channels and its bytes, row after row (8-bit grey, grey and alpha, RGB or RGBA; no palette, no interlace). */
function decode(buf) {
  let at = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), kind = buf.toString('latin1', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0 || type === 3) throw new Error('only 8-bit, non-interlaced PNGs without a palette');
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  const n = { 0: 1, 2: 3, 4: 2, 6: 4 }[type], stride = w * n, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
  // each row is filtered against the pixel to its left (a), the one above (b) and the one above that one's left (c)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= n ? px[row + i - n] : 0, b = y ? px[row - stride + i] : 0, c = i >= n && y ? px[row - stride + i - n] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      px[row + i] = (raw[src + i] + pred) & 255;
    }
  }
  return { w, h, n, px };
}

const img = decode(readFileSync(file));
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
for (const r of rects) {
  const [x0, y0, w, h] = r.split(',').map(Number);
  const xa = Math.max(0, x0), ya = Math.max(0, y0), xb = Math.min(img.w, x0 + w), yb = Math.min(img.h, y0 + h);
  if (xb <= xa || yb <= ya) { console.log(r, 'outside the picture', `${img.w}x${img.h}`); continue; }
  let sr = 0, sg = 0, sb = 0, L = 0, k = 0;
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
    const i = (y * img.w + x) * img.n, grey = img.n < 3;
    const R = img.px[i], G = grey ? R : img.px[i + 1], B = grey ? R : img.px[i + 2];
    sr += R; sg += G; sb += B; L += 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B); k++;
  }
  console.log(r, 'L', (L / k).toFixed(4), 'sRGB', [sr / k, sg / k, sb / k].map(Math.round).join(','));
}
