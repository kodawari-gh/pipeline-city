// Visible scene share, the method of docs/pipeline-city-menu-ui/reference/coverage.py (ACCEPTANCE.md section 5).
// Usage: node tools/hud-coverage.mjs with-ui.png without-ui.png [--dilate 12] [--threshold 6] [--min 88]
// Both screenshots show the same paused frame. A pixel is covered when any channel differs by more than the
// threshold; the covered mask grows by a square of side 2r+1. Prints the unobstructed share in %.
// With --min, exit code 1 when the share is below it (package: 88 desktop, 80 phone; HUD reference 90.6).
// Reads 8-bit, non-interlaced PNG (RGB or RGBA), as headless Chrome writes it. No dependencies.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function readPng(path) {
  const buf = readFileSync(path);
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), tag = buf.toString('latin1', pos + 4, pos + 8), d = buf.subarray(pos + 8, pos + 8 + len);
    if (tag === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (tag === 'IDAT') idat.push(d);
    else if (tag === 'IEND') break;
    pos += 12 + len;
  }
  const ch = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (depth !== 8 || !ch || interlace) throw new Error(`${path}: only 8-bit non-interlaced RGB/RGBA PNG is supported`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= ch ? out[dst + i - ch] : 0, b = y ? out[dst - stride + i] : 0, c = y && i >= ch ? out[dst - stride + i - ch] : 0;
      let v = x;
      if (f === 1) v = x + a; else if (f === 2) v = x + b; else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[dst + i] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

// 1D max filter of radius r over a 0/1 array of rows (axis 0 = along a column, 1 = along a row), by prefix sums.
function grow(m, w, h, r, axis) {
  const out = new Uint8Array(w * h), n = axis ? w : h, lines = axis ? h : w, step = axis ? 1 : w, lstep = axis ? w : 1;
  const c = new Int32Array(n + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lstep;
    for (let i = 0; i < n; i++) c[i + 1] = c[i] + m[base + i * step];
    for (let i = 0; i < n; i++) out[base + i * step] = c[Math.min(n, i + r + 1)] - c[Math.max(0, i - r)] > 0 ? 1 : 0;
  }
  return out;
}

export function unobstructed(uiPath, noUiPath, dilate = 12, threshold = 6) {
  const a = readPng(uiPath), b = readPng(noUiPath);
  if (a.w !== b.w || a.h !== b.h) throw new Error(`size mismatch: ${a.w}x${a.h} vs ${b.w}x${b.h}`);
  let m = new Uint8Array(a.w * a.h);
  for (let p = 0; p < m.length; p++) {
    for (let k = 0; k < 3; k++) if (Math.abs(a.data[p * a.ch + k] - b.data[p * b.ch + k]) > threshold) { m[p] = 1; break; }
  }
  if (dilate > 0) m = grow(grow(m, a.w, a.h, dilate, 0), a.w, a.h, dilate, 1);
  let covered = 0;
  for (let p = 0; p < m.length; p++) covered += m[p];
  return Math.round(1000 * (1 - covered / m.length)) / 10;
}

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : Number(args.splice(i, 2)[1]); };
if (process.argv[1]?.endsWith('hud-coverage.mjs')) {
  const dilate = opt('--dilate', 12), threshold = opt('--threshold', 6), min = opt('--min', NaN);
  if (args.length !== 2) { console.error('usage: node tools/hud-coverage.mjs with-ui.png without-ui.png [--dilate 12] [--threshold 6] [--min 88]'); process.exit(2); }
  const share = unobstructed(args[0], args[1], dilate, threshold);
  console.log(`unobstructed ${share} %`);
  if (!Number.isNaN(min) && share < min) { console.error(`below ${min} %`); process.exit(1); }
}
