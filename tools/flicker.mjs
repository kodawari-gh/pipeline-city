// `node tools/flicker.mjs [--preset Low|Medium|High] [--frames N] [--window x,y,w,h] [--keep first.png] [--map range.png]`
// (`--map`: a grey picture of the still frames' luma range per pixel, times 4: white is where the still picture flickers.)
// Measures flicker of the 3D night scene. It opens the sandbox with the assembled machine as tools/shot-case.mjs does, sets the room to night (hour 23),
// sets the graphics preset in the real panel (auto-adjust off) and captures frames of the picture (the top bar is left out).
//   (a) still: the camera does not move. Share of pixels whose luma range over the frames is above 24/255. Full frame.
//   (b) pan: the view moves about 2 px per frame (`__board.jumpRaw`). Pan numbers include motion: the window (the city) and the rest (room and case)
//       are reported apart, and the shift is not compensated. Read the pan line as an upper bound, not as flicker alone.
// The luma is Rec. 709 on the 8-bit sRGB values. The PNG decoder is the one in tools/lum.mjs (copied: lum.mjs runs on import).
// Dev server only (PORT, default 5231, --strictPort; CHROME_PATH optional). Frames stay in memory; `--keep` saves the first still frame.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const PRESET = flag('preset', 'High');
if (!['Low', 'Medium', 'High'].includes(PRESET)) throw new Error('--preset Low|Medium|High');
const FRAMES = Number(flag('frames', 30));
// the city window (the sky and the towers above the lamp), in measured-rect pixels: x,y,w,h. The lamp and the room lie outside it.
const WIN = flag('window', '205,0,650,290').split(',').map(Number);
const KEEP = flag('keep', ''), MAP = flag('map', '');
// the wait after the preset is set, before the first frame (ms): the night's lamps and the new render size must settle first
// (3 s was too short: at Low the lamps still ramped and the frame still changed size, which read as 6 % flicker; 15 s reads 0.3 %)
const SETTLE = Number(flag('settle', 15000));
const W = 1600, H = 900, TOP = 90;               // the viewport; the HUD bar is left out of the measured rect
const CLIP = { x: 0, y: TOP, width: W, height: H - TOP };
const PORT = Number(process.env.PORT || 5231), url = `http://localhost:${PORT}/`;
const THRESH = 24;

const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const stop = () => { try { server?.kill(); } catch { /* gone */ } };
process.on('exit', stop);

/** A PNG's size and its bytes, row after row (8-bit; grey, grey and alpha, RGB or RGBA; no palette, no interlace). As in tools/lum.mjs. */
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

/** Per pixel, the lowest and highest luma over the frames (Uint8 each). */
function lumaRange(pngs) {
  let w = 0, h = 0, mn = null, mx = null;
  for (const buf of pngs) {
    const img = decode(buf);
    if (!mn) { w = img.w; h = img.h; mn = new Uint8Array(w * h).fill(255); mx = new Uint8Array(w * h); }
    const grey = img.n < 3;
    for (let k = 0; k < w * h; k++) {
      const i = k * img.n, R = img.px[i], G = grey ? R : img.px[i + 1], B = grey ? R : img.px[i + 2];
      const y = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B);
      if (y < mn[k]) mn[k] = y;
      if (y > mx[k]) mx[k] = y;
    }
  }
  return { w, h, mn, mx };
}

/** A grey PNG of the luma range per pixel, times 4 (a range of 64 or more is white): where the still picture flickers. */
function rangeMap({ w, h, mn, mx }) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = Math.min(255, (mx[y * w + x] - mn[y * w + x]) * 4);
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const chunk = (kind, data) => {
    const body = Buffer.concat([Buffer.from(kind, 'latin1'), data]), out = Buffer.alloc(body.length + 8);
    let c = 0xffffffff;
    for (const b of body) c = table[(c ^ b) & 255] ^ (c >>> 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE((c ^ 0xffffffff) >>> 0, body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Share (%) of the pixels that pass `inRegion` (x, y) whose luma range is above THRESH. */
function share({ w, h, mn, mx }, inRegion) {
  let n = 0, over = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inRegion(x, y)) continue;
    const k = y * w + x;
    n++;
    if (mx[k] - mn[k] > THRESH) over++;
  }
  return n ? (100 * over) / n : 0;
}

const gpu = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: gpu,
});
try {
  const p = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForSelector('text=Build my PC', { timeout: 180000 });
  const renderer = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  console.log('GL renderer:', renderer);
  if (/swiftshader|llvmpipe|software/i.test(renderer) && !process.env.SOFTWARE) { console.log('The browser fell back to software GL: stopping.'); process.exitCode = 2; throw new Error('software GL'); }

  // the sandbox with the assembled machine (as tools/shot-case.mjs)
  await p.click('text=New game'); await p.waitForSelector('#ng-title', { timeout: 20000 });
  await p.click('.ng-back >> text=Sandbox'); await p.click('text=Assembled machine');
  await p.click('.ng-back button.primary'); await p.waitForSelector('header.hud', { timeout: 60000 });
  await p.waitForFunction(() => !!window.__board?.three, null, { timeout: 60000 });
  await p.waitForTimeout(4000);
  // night: the room's hour (as tools/shot.mjs --hour)
  await p.evaluate(async (h) => { const { roomDebug } = await import('/src/features/room/render/shell/room.ts'); roomDebug.hour = h; }, 23);

  // the graphics preset, in the real panel, auto-adjust off
  await p.click('[aria-label=Menu]');
  await p.click('role=menuitem[name=/Graphics/]');
  await p.click(`aside.gfx .gfx-presets >> text=${PRESET}`);
  await p.click('aside.gfx [aria-label=Auto-adjust] >> text=Off');
  await p.click('[aria-label="Close graphics"]');
  const g = await p.evaluate(() => JSON.parse(localStorage.getItem('pipeline-city.graphics') ?? 'null'));
  const t = await p.evaluate(() => JSON.parse(localStorage.getItem('pipeline-city.graphics.tier') ?? 'null'));
  if (!g || g.auto !== false || t?.mode !== 'manual') { console.log(`The preset ${PRESET} did not take (saved: ${JSON.stringify(g)}).`); process.exitCode = 3; throw new Error('preset'); }
  await p.waitForTimeout(SETTLE);

  // (a) still camera
  const still = [];
  for (let i = 0; i < FRAMES; i++) { still.push(await p.screenshot({ clip: CLIP })); await p.waitForTimeout(50); }
  if (KEEP) { writeFileSync(resolve(KEEP), still[0]); console.log('saved', resolve(KEEP)); }
  const rs = lumaRange(still);
  if (MAP) { writeFileSync(resolve(MAP), rangeMap(rs)); console.log('saved', resolve(MAP)); }
  const pctStill = share(rs, () => true);
  console.log(`still  ${PRESET} night, full frame: ${pctStill.toFixed(2)}% of pixels move more than ${THRESH}/255 over ${FRAMES} frames`);

  // (b) slow pan, about 2 px per frame in the view's own units (the view's height over the screen's height)
  const pan = [];
  for (let i = 0; i < FRAMES; i++) {
    pan.push(await p.screenshot({ clip: CLIP }));
    await p.evaluate((px) => {
      const v = window.__board.view();
      const step = (px * v.height) / innerHeight;
      window.__board.jumpRaw({ ...v, x: v.x + step });
    }, 2);
    await p.waitForTimeout(50);
  }
  const rp = lumaRange(pan);
  const [wx, wy, ww, wh] = WIN;
  const inWin = (x, y) => x >= wx && x < wx + ww && y >= wy && y < wy + wh;
  const pctWin = share(rp, inWin), pctRest = share(rp, (x, y) => !inWin(x, y));
  console.log(`pan    ${PRESET} night, 2 px/frame (includes motion): window ${pctWin.toFixed(2)}%, rest ${pctRest.toFixed(2)}% (${WIN.join(',')} is the window, in clip pixels)`);
  if (errors.length) console.log(`(page errors: ${errors.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close().catch(() => {});
  stop();
}
process.exit();
