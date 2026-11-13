// `node tools/bench-costs.mjs [out.json] [--device razr-fold-folded] [--throttle 4] [--ms 3000] [--mode game-max|game] [--cases base,shadows,lights-all,hide-city,hide-machine,hide-both,hide-machine-lights]`:
// what each debug toggle costs at Low, on one device. Each case is a fresh page on the dev server (PORT 5196) with `?debug`, so the overlay's
// hide buttons exist and every case pays the same overlay cost. The page starts at Low (`setTier('low')`, frame limit off). A case changes one thing:
// `shadows`: the sun's shadow at Medium's level (2), set with `setGraphic`; `lights-all`: the lamp cap All (0); `hide-city` / `hide-machine`: the
// overlay's own buttons; `hide-machine-lights`: the machine's two PointLights off (dev only, through `__board.parts().machine`). Each case then
// waits 2.5 s, and the frames are measured for `--ms`.
// Columns: fps, p50, p95, max (ms) and % over 16.7 ms, over the drawn frames (the frames that draw into a canvas on the page, as in bench-modes),
// and n (drawn frames counted). Writes JSON to out.json (default /tmp/bench-costs.json). It reports; nothing here passes or fails.
// `game-max` (default): a sandbox with the assembled machine, so the machine hide has something to hide. `game`: a new campaign.
// The throttle default (4) follows the phone runs of bench-modes: read the frame times as CPU cost. Only the probe below is added to the page.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const out = args.find((a, i) => a.endsWith('.json') && !(args[i - 1] ?? '').startsWith('--')) ?? '/tmp/bench-costs.json';
// the device: razr-fold-folded from bench-modes.mjs (485x997 CSS px at DPR 2.225, the cover screen)
const [W, H, DPR] = [485, 997, 2.225];
const DEVICE = 'razr-fold-folded';
const THROTTLE = Number(flag('throttle', 4));
const MS = Number(flag('ms', 3000));
const MODE = flag('mode', 'game-max');
if (!['game', 'game-max'].includes(MODE)) throw new Error('--mode: game or game-max');
const ALL = ['base', 'shadows', 'lights-all', 'hide-city', 'hide-machine', 'hide-both', 'hide-machine-lights'];
const CASES = flag('cases', ALL.join(',')).split(',');
for (const c of CASES) if (!ALL.includes(c)) throw new Error(`--cases: one of ${ALL.join(', ')}`);
const BUDGET = 1000 / 60;
const PORT = Number(process.env.PORT || 5196), url = `http://localhost:${PORT}/?debug=1&tier=low`;

// every step logs its start and its end, and fails with its name after its own limit, so a stall shows as an error, not as silence
const T0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);
const step = (name, ms, fn) => {
  const s = Date.now();
  log(`${name} ...`);
  let timer;
  const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`"${name}" did not finish in ${ms / 1000} s`)), ms); });
  return Promise.race([fn(), limit]).then(
    (r) => { log(`${name} ok (${((Date.now() - s) / 1000).toFixed(1)} s)`); return r; },
    (e) => { log(`${name} FAILED: ${e.message.split('\n')[0]}`); throw e; },
  ).finally(() => clearTimeout(timer));
};
// the limits (ms): the first page load (cold Vite and SwiftShader may be slow), the menu clicks, the HUD
const BOOT = 90000, CLICK = 30000, HUD = 60000;

const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  log(`starting vite on ${PORT}`);
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
  if (!(await up())) throw new Error(`vite did not answer on ${url} in 30 s`);
}
// the ANGLE flag is Windows-only (the owner's PC). On Linux, forcing d3d11 makes the GPU process fall back to swiftshader-webgl, so it is left out.
const ANGLE = process.platform === 'win32' ? ['--use-angle=d3d11'] : [];
const browser = await step('launch chrome', 30000, () => chromium.launch({
  headless: true, channel: 'chrome',
  args: ['--enable-gpu', ...ANGLE, '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
}));
log(`chrome flags: ${ANGLE.join(' ') || '(no ANGLE flag)'} on ${process.platform}`);
const stop = async () => { await browser.close().catch(() => {}); try { server?.kill(); } catch { /* gone */ } };

// in the page, before the game: the frame intervals, and the drawn ones (a frame that draws with the default framebuffer bound)
const probe = () => {
  const c = { rec: false, last: 0, all: [], drawn: [], dlast: 0, hit: false };
  const off = new WeakMap();
  for (const G of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const P = G.prototype;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const o = P[name];
      if (o) P[name] = function (...a) { if (!off.get(this) && this.canvas.isConnected) c.hit = true; return o.apply(this, a); };
    }
    const bind = P.bindFramebuffer;
    P.bindFramebuffer = function (t, fb) { if (t === 0x8d40 || t === 0x8ca9) off.set(this, !!fb); return bind.call(this, t, fb); };
  }
  const tick = (t) => {
    if (c.rec && c.last) c.all.push(t - c.last);
    if (c.hit && c.rec && c.last) { if (c.dlast) c.drawn.push(c.last - c.dlast); c.dlast = c.last; }
    c.hit = false;
    c.last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__cost = {
    start: () => { c.all = []; c.drawn = []; c.dlast = 0; c.last = 0; c.hit = false; c.rec = true; },
    stop: () => { c.rec = false; return { all: c.all, drawn: c.drawn }; },
  };
};

// the ?debug panel sits over the menu's New game button, so it is hidden while the menu is used and shown again before the case (display only;
// the panel's own rule is not changed). Found by its Hide city button: that button's parent is the panel.
const setPanel = (p, shown) => p.evaluate((on) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Hide city');
  if (b) b.parentElement.parentElement.style.display = on ? '' : 'none';
  return !!b;
}, shown);

// the case's change, made in the page before the measure (`base` changes nothing)
const apply = async (p, name) => {
  if (name === 'shadows') await p.evaluate(async () => { const G = await import('/src/app/graphics.ts'); G.setGraphic('shadows', 2); });
  if (name === 'lights-all') await p.evaluate(async () => { const G = await import('/src/app/graphics.ts'); G.setGraphic('lights', 0); });
  if (name === 'hide-city' || name === 'hide-both') await p.getByRole('button', { name: 'Hide city', exact: true }).click({ timeout: CLICK });
  if (name === 'hide-machine' || name === 'hide-both') await p.getByRole('button', { name: 'Hide machine', exact: true }).click({ timeout: CLICK });
  // dev only: the machine's two PointLights (its RGB and the spill through the glass), off, through the board's parts
  if (name === 'hide-machine-lights') await p.evaluate(() => { const m = window.__board.parts().machine; m.rgb.visible = false; m.spill.visible = false; });
};

const pct = (a, k) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const rows = [];
try {
  console.log(`${DEVICE} ${W}x${H} @${DPR}x, Low, CPU /${THROTTLE}, ${MODE}, ${MS} ms per case (drawn frames)`);
  console.log('case'.padEnd(13) + 'fps'.padStart(7) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'max'.padStart(8) + `>${BUDGET.toFixed(1)}ms`.padStart(10) + 'n'.padStart(7));
  // one game for all cases would carry state between them, so each case gets its own page
  for (const name of CASES) {
    log(`case ${name}`);
    const ctx = await step('new browser context', CLICK, () => browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true }));
    const p = await step('new page', CLICK, () => ctx.newPage());
    await p.addInitScript(probe);
    p.on('pageerror', (e) => log(`page error: ${e.message.slice(0, 200)}`));
    p.on('console', (m) => { if (m.type() === 'error') log(`page console error: ${m.text().slice(0, 200)}`); });
    p.on('crash', () => log('page CRASHED (the renderer died; the page cannot finish)'));
    await step('goto', BOOT, () => p.goto(url, { waitUntil: 'domcontentloaded', timeout: BOOT }));
    await step('menu visible ("Build my PC")', BOOT, () => p.waitForSelector('text=Build my PC', { timeout: BOOT }));
    const gl = await step('WebGL renderer', CLICK, () => p.evaluate(() => {
      const g = document.createElement('canvas').getContext('webgl2');
      const d = g && g.getExtension('WEBGL_debug_renderer_info');
      return g ? (d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : 'no WebGL2';
    }));
    log(`GL renderer: ${gl}`);
    const cdp = await ctx.newCDPSession(p);
    if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    // Low, as the tier is: the frame limit off, so the frame time shows the headroom (as bench-modes does)
    await step('set tier low', CLICK, () => p.evaluate(async () => { const G = await import('/src/app/graphics.ts'); G.setTier('low'); G.setGraphic('fps', 0); }));
    await step('pointer pokes', CLICK, () => p.evaluate(() => { window.__bmPoke = setInterval(() => window.dispatchEvent(new Event('pointermove')), 2000); }));
    // the panel covers the menu's New game button: hidden for the menu clicks, shown again before the case
    await step('hide debug panel (menu)', CLICK, () => setPanel(p, false));
    await step('New game', CLICK, () => p.click('text=New game', { timeout: CLICK }));
    await step('new-game screen (#ng-title)', CLICK, () => p.waitForSelector('#ng-title', { timeout: CLICK }));
    if (MODE === 'game-max') {
      await step('Sandbox', CLICK, () => p.click('.ng-back >> text=Sandbox', { timeout: CLICK }));
      await step('Assembled machine', CLICK, () => p.click('text=Assembled machine', { timeout: CLICK }));
    } else await step('No, I know the game', CLICK, () => p.click('text=No, I know the game', { timeout: CLICK }));
    // (bench-modes clicks Start with a plain click; here the click does not wait for a navigation that never comes, the HUD wait below does)
    await step('Start', CLICK, () => p.click('.ng-back button.primary', { noWaitAfter: true, timeout: CLICK }));
    await step('hud (header.hud)', HUD, () => p.waitForSelector('header.hud', { timeout: HUD }));
    await step('flight in from the room', 10000, () => p.waitForTimeout(4000)); // (the flight in from the room)
    await step('show debug panel (case)', CLICK, () => setPanel(p, true));
    await step(`case change: ${name}`, CLICK, () => apply(p, name));
    await step('settle', 10000, () => p.waitForTimeout(2500)); // settle after the change
    let s;
    await step('measure', MS + CLICK, async () => {
      await p.evaluate(() => window.__cost.start());
      await p.waitForTimeout(MS);
      return p.evaluate(() => window.__cost.stop());
    }).then((r) => { s = r; });
    await step('close page', CLICK, () => p.evaluate(() => clearInterval(window.__bmPoke)));
    await ctx.close();

    const d = [...s.drawn].sort((a, b) => a - b);
    const mean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
    const row = {
      case: name, n: d.length, fps: r1(d.length ? 1000 / mean : 0), p50: r1(pct(d, 0.5)), p95: r1(pct(d, 0.95)),
      max: r1(d[d.length - 1] ?? 0), over16: r1((100 * d.filter((x) => x > BUDGET).length) / Math.max(1, d.length)),
    };
    rows.push(row);
    console.log(`${name.padEnd(13)}${String(row.fps).padStart(7)}${String(row.p50).padStart(8)}${String(row.p95).padStart(8)}${String(row.max).padStart(8)}${(row.over16 + '%').padStart(10)}${String(row.n).padStart(7)}`);
  }
  writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), device: DEVICE, size: `${W}x${H}@${DPR}`, tier: 'low', mode: MODE, throttle: THROTTLE, ms: MS, budgetMs: r1(BUDGET), rows }, null, 1));
  console.log(`wrote ${out}`);
} catch (e) {
  console.error(`bench-costs stopped: ${e.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally { await stop(); }
