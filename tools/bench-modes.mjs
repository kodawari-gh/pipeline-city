// `npm run bench:modes -- [out.json] [--phone] [--throttle 4] [--presets low,medium,high] [--modes menu,gallery,build] [--ms 3500]`: frame cost of the three
// screens that start the game (main menu, gallery, Build my PC) at each graphics preset, idle and while the wheel zooms. It counts what every WebGL
// context draws (draw calls, triangles, pixels, contexts alive) by wrapping the GL calls, so it needs no dev hook. `--phone`: a 412x915 screen at dpr 2.6
// with the CPU slowed by `--throttle` (default 4): the desktop GPU is far faster than a phone's, so read the draw counts and pixels as the GPU cost and
// the frame time as the CPU cost. It reports; nothing here passes or fails. Dev server on PORT (5196).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const has = (n) => args.includes('--' + n);
const out = args.find((a, i) => a.endsWith('.json') && !(args[i - 1] ?? '').startsWith('--'));
const PHONE = has('phone');
const [W, H, DPR] = PHONE ? [412, 915, 2.6] : [1920, 1080, 1];
const THROTTLE = Number(flag('throttle', PHONE ? 4 : 1));
const MS = Number(flag('ms', 3500));
const PORT = Number(process.env.PORT || 5196), url = `http://localhost:${PORT}/`;
const PRESETS = {
  low: { scale: 0.6, msaa: 0, ao: 0, bloom: 0, shadows: 1, textures: 0, filtering: 2, live: 0, particles: 0 },
  medium: { scale: 0.75, msaa: 2, ao: 0, bloom: 1, shadows: 2, textures: 1, filtering: 4, live: 1, particles: 1 },
  high: { scale: 1, msaa: 4, ao: 2, bloom: 2, shadows: 3, textures: 2, filtering: 8, live: 2, particles: 2 },
  ultra: { scale: 1, msaa: 8, ao: 3, bloom: 2, shadows: 4, textures: 3, filtering: 16, live: 3, particles: 2 },
};
const presets = flag('presets', 'low,medium,high').split(',');
const modes = flag('modes', 'menu,gallery,build').split(',');

const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const browser = await chromium.launch({
  headless: true, channel: 'chrome',
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const stop = async () => { await browser.close().catch(() => {}); try { server?.kill(); } catch { /* gone */ } };

// in the page, before the game: count the GL work and the frames
const probe = () => {
  const c = { calls: 0, tris: 0, ctx: new Set(), frames: [], rec: false, last: 0, long: 0, pix: 0 };
  c.by = new Map();
  const per = (g, mode, count, inst = 1) => {
    if (!c.rec) return;
    c.calls++;
    const k = (mode === 4 ? count / 3 : mode === 5 || mode === 6 ? count - 2 : 0) * inst;
    c.tris += k;
    const b = c.by.get(g) ?? { calls: 0, tris: 0 };
    b.calls++; b.tris += k; c.by.set(g, b);
  };
  for (const G of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const P = G.prototype;
    for (const [name, f] of [['drawElements', (g, m, n) => per(g, m, n)], ['drawArrays', (g, m, _f, n) => per(g, m, n)], ['drawElementsInstanced', (g, m, n, _t, _o, i) => per(g, m, n, i)], ['drawArraysInstanced', (g, m, _f, n, i) => per(g, m, n, i)]]) {
      const o = P[name];
      if (!o) continue;
      P[name] = function (...a) { c.ctx.add(this); f(this, ...a); return o.apply(this, a); };
    }
  }
  new PerformanceObserver((l) => { if (c.rec) for (const e of l.getEntries()) c.long += e.duration; }).observe({ type: 'longtask' });
  const tick = (t) => { if (c.rec && c.last) c.frames.push(t - c.last); c.last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__bm = {
    start: () => { c.calls = 0; c.tris = 0; c.frames = []; c.long = 0; c.last = 0; c.by = new Map(); c.rec = true; },
    stop: () => {
      c.rec = false;
      const live = [...c.ctx].filter((g) => !g.isContextLost() && g.canvas.isConnected);
      return { frames: c.frames, calls: c.calls, tris: c.tris, long: c.long, contexts: live.length, pixels: live.map((g) => g.drawingBufferWidth * g.drawingBufferHeight), shown: live.map((g) => g.canvas.offsetWidth > 0), by: live.map((g) => ({ w: g.drawingBufferWidth, h: g.drawingBufferHeight, ...(c.by.get(g) ?? { calls: 0, tris: 0 }) })) };
    },
  };
};

const pct = (a, k) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const rows = [];
try {
  const sizeCol = (s) => `${(s.pixels.reduce((a, b) => a + b, 0) / 1e6).toFixed(2)}Mpx/${s.contexts}ctx`;
  console.log(`${W}x${H} @${DPR}x, CPU /${THROTTLE}`);
  console.log('mode'.padEnd(9) + 'preset'.padEnd(8) + 'view'.padEnd(8) + 'FPS'.padStart(7) + 'p50'.padStart(7) + 'p95'.padStart(7) + 'max'.padStart(7) + 'long'.padStart(7) + 'calls'.padStart(7) + 'ktri'.padStart(7) + '  px/contexts');
  let warm = false;
  for (const preset of presets) {
    for (const mode of modes) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: PHONE, isMobile: PHONE });
      const p = await ctx.newPage();
      // `default`: store nothing, so the first-start settings of this device class apply (their frame limit too: read the FPS against it)
      if (preset !== 'default') await p.addInitScript(([g]) => { localStorage.setItem('pipeline-city.graphics', JSON.stringify({ ...g, fps: 0, brightness: 1, auto: false, v: 2 })); }, [PRESETS[preset]]);
      await p.addInitScript(probe);
      p.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 200)));
      await p.goto(url);
      await p.waitForSelector('text=Build my PC', { timeout: warm ? 60000 : 180000 });
      warm = true;
      const cdp = await ctx.newCDPSession(p);
      if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      if (mode === 'gallery') { await p.click('text=Gallery'); await p.waitForSelector('.gallery', { timeout: 20000 }); }
      if (mode === 'build') { await p.click('text=Build my PC'); await p.waitForSelector('.bld-bar', { timeout: 30000 }); }
      await p.waitForTimeout(4000);
      const cx = W / 2, cy = H / 2;
      const views = [['idle', () => p.waitForTimeout(MS)]];
      if (mode !== 'menu') views.push(['zoom', async () => { await p.mouse.move(cx, cy); for (let i = 0; i < 60; i++) { await p.mouse.wheel(0, i < 30 ? -80 : 80); await p.waitForTimeout(40); } }]);
      for (const [view, run] of views) {
        await p.evaluate(() => window.__bm.start());
        await run();
        const s = await p.evaluate(() => window.__bm.stop());
        const f = [...s.frames].sort((a, b) => a - b), mean = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length), n = Math.max(1, f.length);
        const row = { preset, mode, view, fps: r1(f.length ? 1000 / mean : 0), p50: r1(pct(f, 0.5)), p95: r1(pct(f, 0.95)), max: r1(f[f.length - 1] ?? 0), longMs: Math.round(s.long), calls: Math.round(s.calls / n), ktris: Math.round(s.tris / n / 1000), pixels: s.pixels, shown: s.shown, contexts: s.contexts };
        row.by = s.by.map((b) => ({ px: `${b.w}x${b.h}`, calls: Math.round(b.calls / n), ktris: Math.round(b.tris / n / 1000) }));
        rows.push(row);
        console.log(mode.padEnd(9) + preset.padEnd(8) + view.padEnd(8) + String(row.fps).padStart(7) + String(row.p50).padStart(7) + String(row.p95).padStart(7) + String(row.max).padStart(7) + String(row.longMs).padStart(7) + String(row.calls).padStart(7) + String(row.ktris).padStart(7) + '  ' + sizeCol(s) + '  ' + row.by.map((b) => `[${b.px} ${b.calls}c ${b.ktris}kt]`).join(' '));
      }
      await ctx.close();
    }
  }
  if (out) writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), size: `${W}x${H}@${DPR}`, throttle: THROTTLE, rows }, null, 1));
} finally { await stop(); }
