// `npm run bench:modes -- [out.json] [--phone] [--throttle 4] [--presets low,medium,high] [--modes menu,gallery,build,game,game-max] [--ms 3500] [--views idle,zoom,late] [--keep-limit]`: frame cost of the
// screens that start the game (main menu, gallery, Build my PC) and of the game view (`game`: a new campaign, tutorial off; `game-max`: a sandbox with the
// assembled machine) at each graphics preset, idle and while the wheel zooms. It counts what every WebGL
// context draws (draw calls, triangles, pixels, contexts alive) by wrapping the GL calls, so it needs no dev hook. `FPS` counts every animation frame;
// `dFPS` (and `dp50`, `dp95`) counts only the frames that draw into a canvas on the page, so it reads against the frame limit (a pass into a target alone,
// as a shadow map or the city, is not one). `gpu`: GPU ms per drawn frame from EXT_disjoint_timer_query_webgl2, "n/a" where Chrome does not offer it; with
// the CPU slowed it also holds the GPU's waits for the slow CPU's commands, so read it at `--throttle 1`. `--phone`: a 412x915 screen at dpr 2.6
// with the CPU slowed by `--throttle` (default 4): the desktop GPU is far faster than a phone's, so read the draw counts and pixels as the GPU cost and
// the frame time as the CPU cost. `--firefox`: the same run in Firefox (playwright's firefox, headless, WebGL forced on, the frame rate not capped);
// the default is Chrome. Chrome's launch forces ANGLE d3d11 on Windows only: on Linux it is not forced (that flag made the GPU process fall back to
// SwiftShader on the box). Firefox never gets d3d11. It reports; nothing here passes or fails. Dev server on PORT (5196).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const has = (n) => args.includes('--' + n);
const out = args.find((a, i) => a.endsWith('.json') && !(args[i - 1] ?? '').startsWith('--'));
// `--device`: a phone's Chrome viewport (CSS px) and DPR; implies `--phone`. razr: Motorola razr 2025 (1080x2640 panel, 420 dpi in its user agent, so
// DPR 2.625 and a 411x1006 CSS screen, less about 92 px of status, address and gesture bars). razr-plus: razr+ 2025, the same panel (its density
// assumed the same). razr-ultra: razr ultra 2025, 1224x2992 panel, density not published (480 dpi, DPR 3, assumed). razr-fold: the razr fold's inner
// screen unfolded, 1004x967 CSS px measured on the owner's phone; DPR 2.2 is an ASSUMPTION (2232 px panel width / 1004 is about 2.22; 2.625 would make
// 2636 px, wider than the panel) until the real devicePixelRatio is reported. razr-fold-folded: the same phone folded (the cover screen), 485x997 CSS px
// at DPR 2.225, from the owner's Chrome canvas (727x1495 at a pixel ratio of 1.5, so 485x997 CSS). Default phone: 412x915 at 2.6.
const DEVICES = { phone: [412, 915, 2.6], razr: [411, 914, 2.625], 'razr-plus': [411, 914, 2.625], 'razr-ultra': [408, 905, 3], 'razr-fold': [1004, 967, 2.2], 'razr-fold-folded': [485, 997, 2.225] };
const DEVICE = flag('device', has('phone') ? 'phone' : '');
const PHONE = !!DEVICE;
if (DEVICE && !DEVICES[DEVICE]) throw new Error(`--device: one of ${Object.keys(DEVICES).join(', ')}`);
const [W, H, DPR] = PHONE ? DEVICES[DEVICE] : [1920, 1080, 1];
// `--tier low|medium|high`: that tier's settings, set in the page (`setTier`) with the frame limit off, so the frame time shows the headroom.
// `--keep-limit` (with `--tier`): keep that tier's own frame limit, so a cap shows in the FPS
const TIER = flag('tier', '');
const KEEP = has('keep-limit');
// `--views idle,zoom,late`: the views to measure. `late`: the frames 40 s after the last input (the pointer pokes stop for it; a build with a no-input cap drops to 30 here, the current build does not)
const VIEWS = flag('views', 'idle,zoom').split(',');
for (const v of VIEWS) if (!['idle', 'zoom', 'late'].includes(v)) throw new Error('--views: one of idle, zoom, late');
const poke = () => { window.__bmPoke = setInterval(() => window.dispatchEvent(new Event('pointermove')), 2000); };
const BUDGET = 1000 / 60;
const THROTTLE = Number(flag('throttle', PHONE ? 4 : 1));
const MS = Number(flag('ms', 3500));
const PORT = Number(process.env.PORT || 5196), url = `http://localhost:${PORT}/`;
const PRESETS = {
  low: { scale: 0.6, msaa: 0, ao: 0, bloom: 0, shadows: 1, lights: 4, lightShadows: 0, textures: 0, filtering: 2, live: 0, particles: 0 },
  medium: { scale: 0.75, msaa: 2, ao: 0, bloom: 1, shadows: 2, lights: 4, lightShadows: 1, textures: 1, filtering: 4, live: 1, particles: 1 },
  high: { scale: 1, msaa: 4, ao: 2, bloom: 2, shadows: 3, lights: 0, lightShadows: 1, textures: 2, filtering: 8, live: 2, particles: 2 },
  ultra: { scale: 1, msaa: 8, ao: 3, bloom: 2, shadows: 4, lights: 0, lightShadows: 1, textures: 3, filtering: 16, live: 3, particles: 2 },
};
const presets = flag('presets', 'low,medium,high').split(',');
// `--tier` sets that tier in every page (`setTier`), so each row is that tier whatever its preset label says (the page's boot-time build is the
// preset's, its live settings and every Low cut are the tier's). Rows that differ by preset need no `--tier`: the stored presets already have the limit off.
if (TIER && presets.length > 1) throw new Error('--tier runs every row at that tier: give one --presets value with it, or drop --tier to compare presets');
const modes = flag('modes', 'menu,gallery,build').split(',');

const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const FF = has('firefox');
const browser = FF ? await firefox.launch({ headless: true, firefoxUserPrefs: { 'webgl.force-enabled': true, 'layout.frame_rate': 0 } }) : await chromium.launch({
  headless: true, channel: 'chrome',
  args: ['--enable-gpu', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const stop = async () => { await browser.close().catch(() => {}); try { server?.kill(); } catch { /* gone */ } };

// in the page, before the game: count the GL work and the frames
const probe = () => {
  const c = { calls: 0, tris: 0, ctx: new Set(), frames: [], rec: false, last: 0, long: 0, pix: 0 };
  c.by = new Map();
  // drawn frames (`drawn`: their intervals, `nd`: their count) and the GPU ms of each animation frame (`gpu`, by frame number `fn`, for window `win`)
  Object.assign(c, { drawn: [], dlast: 0, nd: 0, fn: 0, win: 0, gpu: new Map(), pend: [], timer: false, disjoint: 0 });
  const bucket = (g) => { const b = c.by.get(g) ?? { calls: 0, tris: 0, drawn: 0 }; c.by.set(g, b); return b; };
  const per = (g, mode, count, inst = 1) => {
    if (!c.rec) return;
    c.calls++;
    const k = (mode === 4 ? count / 3 : mode === 5 || mode === 6 ? count - 2 : 0) * inst;
    c.tris += k;
    const b = bucket(g);
    b.calls++; b.tris += k;
  };
  // a frame draws when a context draws into its own canvas on the page (no framebuffer bound): a pass into a target (shadow map, city, bloom) is not one
  const off = new WeakMap(), shot = new Set(), timers = new WeakMap();
  const timer = (g) => {
    if (!timers.has(g)) {
      const ext = g instanceof WebGL2RenderingContext ? g.getExtension('EXT_disjoint_timer_query_webgl2') : null;
      timers.set(g, ext && { ext, open: false });
      if (ext) c.timer = true;
    }
    return timers.get(g);
  };
  // the GPU time: one query from a context's first GL work in a callback to the callback's end (queries cannot nest), filed under its frame
  const work = (g) => {
    if (!off.get(g) && g.canvas.isConnected) shot.add(g);
    const s = c.rec && timer(g);
    if (!s || s.open) return;
    const q = g.createQuery(), at = [c.win, c.fn];
    g.beginQuery(s.ext.TIME_ELAPSED_EXT, q);
    s.open = true;
    queueMicrotask(() => { g.endQuery(s.ext.TIME_ELAPSED_EXT); s.open = false; c.pend.push({ g, q, ext: s.ext, at }); });
  };
  const poll = () => {
    for (let i = 0; i < c.pend.length;) {
      const p = c.pend[i], g = p.g, lost = g.isContextLost();
      if (!lost && !g.getQueryParameter(p.q, g.QUERY_RESULT_AVAILABLE)) { i++; continue; }
      c.pend.splice(i, 1);
      if (lost) continue;
      if (g.getParameter(p.ext.GPU_DISJOINT_EXT)) c.disjoint++;
      else if (p.at[0] === c.win) c.gpu.set(p.at[1], (c.gpu.get(p.at[1]) ?? 0) + g.getQueryParameter(p.q, g.QUERY_RESULT) / 1e6);
      g.deleteQuery(p.q);
    }
  };
  for (const G of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const P = G.prototype;
    for (const [name, f] of [['drawElements', (g, m, n) => per(g, m, n)], ['drawArrays', (g, m, _f, n) => per(g, m, n)], ['drawElementsInstanced', (g, m, n, _t, _o, i) => per(g, m, n, i)], ['drawArraysInstanced', (g, m, _f, n, i) => per(g, m, n, i)]]) {
      const o = P[name];
      if (!o) continue;
      P[name] = function (...a) { c.ctx.add(this); f(this, ...a); work(this); return o.apply(this, a); };
    }
    for (const name of ['clear', 'blitFramebuffer']) {
      const o = P[name];
      if (o) P[name] = function (...a) { work(this); return o.apply(this, a); };
    }
    const bind = P.bindFramebuffer;
    // (FRAMEBUFFER or DRAW_FRAMEBUFFER: where the draws go)
    P.bindFramebuffer = function (t, fb) { if (t === 0x8d40 || t === 0x8ca9) off.set(this, !!fb); return bind.call(this, t, fb); };
  }
  new PerformanceObserver((l) => { if (c.rec) for (const e of l.getEntries()) c.long += e.duration; }).observe({ type: 'longtask' });
  const tick = (t) => {
    if (c.rec && c.last) c.frames.push(t - c.last);
    // the frame before this one drew into a canvas: it counts at its own time
    if (shot.size && c.rec && c.last) {
      if (c.dlast) c.drawn.push(c.last - c.dlast);
      c.dlast = c.last; c.nd++;
      for (const g of shot) bucket(g).drawn++;
    }
    shot.clear();
    c.last = t; c.fn++;
    poll();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__bm = {
    start: () => { c.calls = 0; c.tris = 0; c.frames = []; c.long = 0; c.last = 0; c.by = new Map(); c.drawn = []; c.dlast = 0; c.nd = 0; c.win++; c.gpu = new Map(); c.disjoint = 0; shot.clear(); c.rec = true; },
    stop: async () => {
      c.rec = false;
      // (the last frames' GPU times come back a frame or two later)
      for (let i = 0; i < 30 && c.pend.length; i++) await new Promise((r) => requestAnimationFrame(r));
      const live = [...c.ctx].filter((g) => !g.isContextLost() && g.canvas.isConnected);
      return {
        frames: c.frames, calls: c.calls, tris: c.tris, long: c.long, contexts: live.length, pixels: live.map((g) => g.drawingBufferWidth * g.drawingBufferHeight), shown: live.map((g) => g.canvas.offsetWidth > 0),
        by: live.map((g) => ({ w: g.drawingBufferWidth, h: g.drawingBufferHeight, ...(c.by.get(g) ?? { calls: 0, tris: 0, drawn: 0 }) })),
        drawn: c.drawn, nd: c.nd, gpu: [...c.gpu.values()], timer: c.timer, disjoint: c.disjoint,
      };
    },
  };
};

const pct = (a, k) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const rows = [];
let gpuTimer = false, disjoint = 0;
try {
  const sizeCol = (s) => `${(s.pixels.reduce((a, b) => a + b, 0) / 1e6).toFixed(2)}Mpx/${s.contexts}ctx`;
  console.log(`${W}x${H} @${DPR}x${DEVICE ? ` (${DEVICE})` : ''}, CPU /${THROTTLE}${TIER ? `, tier ${TIER}, frame limit ${KEEP ? 'kept' : 'off'}` : ''}; over16: % of drawn frames over ${BUDGET.toFixed(1)} ms`);
  console.log('mode'.padEnd(9) + 'preset'.padEnd(8) + 'view'.padEnd(8) + 'FPS'.padStart(7) + 'p50'.padStart(7) + 'p95'.padStart(7) + 'max'.padStart(7) + 'dFPS'.padStart(7) + 'dp50'.padStart(7) + 'dp95'.padStart(7) + 'gpu'.padStart(7) + 'long'.padStart(7) + 'calls'.padStart(7) + 'ktri'.padStart(7) + '  px/contexts');
  let warm = false;
  for (const preset of presets) {
    for (const mode of modes) {
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: PHONE, isMobile: PHONE });
      const p = await ctx.newPage();
      // `default`: store nothing, so the first-start settings of this device class apply (their frame limit too: read the FPS against it)
      if (preset !== 'default') await p.addInitScript(([g]) => { localStorage.setItem('pipeline-city.graphics', JSON.stringify({ ...g, fps: 0, brightness: 1, auto: false, v: 2 })); }, [PRESETS[preset]]);
      await p.addInitScript(probe);
      p.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 200)));
      await p.goto(PHONE && preset === 'default' ? `${url}${url.includes('?') ? '&' : '?'}tier=low` : url); // the tier, not touch, picks the phone's settings
      await p.waitForSelector('text=Build my PC', { timeout: warm ? 60000 : 180000 });
      warm = true;
      // (the CDP session is Chrome's: under `--firefox` the CPU slow-down is not set)
      const cdp = FF ? null : await ctx.newCDPSession(p);
      if (THROTTLE > 1 && cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      if (TIER) await p.evaluate(async ([t, keep]) => { const G = await import('/src/app/graphics.ts'); G.setTier(t); if (!keep) G.setGraphic('fps', 0); }, [TIER, KEEP]);
      // (a pointer move each 2 s. Builds from before the no-input cap was dropped (e.g. 0305cab, AwayWatch) would hold the loop to 30 fps after 30 s with no input; the pokes keep old and new builds comparable)
      await p.evaluate(poke);
      if (mode === 'gallery') { await p.click('text=Gallery'); await p.waitForSelector('.gallery', { timeout: 20000 }); }
      if (mode === 'build') { await p.click('text=Build my PC'); await p.waitForSelector('.bld-bar', { timeout: 30000 }); }
      if (mode.startsWith('game')) {
        await p.click('text=New game'); await p.waitForSelector('#ng-title', { timeout: 20000 });
        if (mode === 'game-max') { await p.click('.ng-back >> text=Sandbox'); await p.click('text=Assembled machine'); } else await p.click('text=No, I know the game');
        await p.click('.ng-back button.primary'); await p.waitForSelector('header.hud', { timeout: 60000 });
        await p.waitForTimeout(4000); // (the flight in from the room)
      }
      await p.waitForTimeout(4000);
      const cx = W / 2, cy = H / 2;
      const views = [];
      for (const v of VIEWS) {
        if (v === 'zoom') { if (mode !== 'menu') views.push(['zoom', async () => { await p.mouse.move(cx, cy); for (let i = 0; i < 60; i++) { await p.mouse.wheel(0, i < 30 ? -80 : 80); await p.waitForTimeout(40); } }]); }
        else views.push([v, () => p.waitForTimeout(MS)]);
      }
      for (const [view, run] of views) {
        // (late: stop the pokes, wait 40 s with no input, then measure; the pokes start again after)
        if (view === 'late') { await p.evaluate(() => clearInterval(window.__bmPoke)); await p.waitForTimeout(40000); }
        await p.evaluate(() => window.__bm.start());
        await run();
        const s = await p.evaluate(() => window.__bm.stop());
        if (view === 'late') await p.evaluate(poke);
        const f = [...s.frames].sort((a, b) => a - b), mean = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length), n = Math.max(1, f.length);
        const row = { preset, mode, view, fps: r1(f.length ? 1000 / mean : 0), p50: r1(pct(f, 0.5)), p95: r1(pct(f, 0.95)), max: r1(f[f.length - 1] ?? 0), longMs: Math.round(s.long), calls: Math.round(s.calls / n), ktris: Math.round(s.tris / n / 1000), pixels: s.pixels, shown: s.shown, contexts: s.contexts };
        row.by = s.by.map((b) => ({ px: `${b.w}x${b.h}`, calls: Math.round(b.calls / n), ktris: Math.round(b.tris / n / 1000), drawn: b.drawn ?? 0 }));
        // the frames that drew: their rate, their intervals and the GPU ms each (all the GPU work of the window over the drawn frames)
        const d = [...s.drawn].sort((a, b) => a - b), dmean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length), g = [...s.gpu].sort((a, b) => a - b);
        Object.assign(row, { over16: r1((100 * d.filter((x) => x > BUDGET).length) / Math.max(1, d.length)), drawnMean: r1(dmean), drawn: s.nd, drawnFps: r1(d.length ? 1000 / dmean : 0), drawnP50: r1(pct(d, 0.5)), drawnP95: r1(pct(d, 0.95)), drawnMax: r1(d[d.length - 1] ?? 0), gpuMs: s.timer ? r2(g.reduce((a, b) => a + b, 0) / Math.max(1, s.nd)) : null, gpuP95: s.timer ? r2(pct(g, 0.95)) : null });
        gpuTimer ||= s.timer; disjoint += s.disjoint;
        rows.push(row);
        console.log(mode.padEnd(9) + preset.padEnd(8) + view.padEnd(8) + String(row.fps).padStart(7) + String(row.p50).padStart(7) + String(row.p95).padStart(7) + String(row.max).padStart(7) + String(row.drawnFps).padStart(7) + (' >16:' + row.over16 + '%').padStart(10) + String(row.drawnP50).padStart(7) + String(row.drawnP95).padStart(7) + String(row.gpuMs ?? 'n/a').padStart(7) + String(row.longMs).padStart(7) + String(row.calls).padStart(7) + String(row.ktris).padStart(7) + '  ' + sizeCol(s) + '  ' + row.by.map((b) => `[${b.px} ${b.calls}c ${b.ktris}kt ${b.drawn}d]`).join(' '));
      }
      await ctx.close();
    }
  }
  console.log(gpuTimer ? `GPU timer: EXT_disjoint_timer_query_webgl2${disjoint ? ` (${disjoint} disjoint results dropped)` : ''}${THROTTLE > 1 ? `; CPU /${THROTTLE}: the GPU ms hold its waits for the CPU, read them at --throttle 1` : ''}` : 'GPU timer: n/a');
  if (out) writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), device: DEVICE || 'desktop', tier: TIER || null, keepLimit: KEEP, size: `${W}x${H}@${DPR}`, throttle: THROTTLE, gpuTimer, rows }, null, 1));
} finally { await stop(); }
