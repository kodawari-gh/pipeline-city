// `node tools/build-style-check.mjs [--prod] [--json]`: walks every element on "Build my PC" at five viewports and lists the ones that break
// SPEC §1 rules 5 and 6: border width > 0, radius > 4 px, box-shadow, text-shadow, backdrop-filter, filter, or a gradient background-image.
// A chip (class contains "chip" or "key", or the element sets data-chip) may have a radius up to 4 px. Exit: 0 when the list is empty, 1 when not,
// 2 on software GL. Dev server by default; `--prod` builds and serves the optimized game. Env: PORT (5199), CHROME_PATH.
import { spawn } from 'node:child_process';
import { chromium, firefox } from 'playwright-core';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const FIREFOX = args.includes('--firefox'); // Firefox (WebGL forced on, as shot.mjs) instead of Chrome
const PORT = Number(process.env.PORT || 5199);
const url = `http://localhost:${PORT}/`;
const SIZES = [[1920, 1080], [390, 844], [360, 800], [412, 915], [844, 390]];
if (PROD) {
  const b = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
  if (await new Promise((r) => b.on('exit', r))) { console.log('the build failed'); process.exit(1); }
}
let server = null;
const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(PROD ? ['preview'] : []), '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const stop = () => { try { server?.kill(); } catch { /* gone */ } };
process.on('exit', stop);
const browser = FIREFOX
  ? await firefox.launch({ headless: true, firefoxUserPrefs: { 'webgl.force-enabled': true } })
  : await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  });
/** Page side: every element inside .build that breaks a rule. */
const walk = () => {
  const out = [];
  const name = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`;
  for (const e of document.querySelectorAll('.build, .build *')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || e.closest('canvas')) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const why = [];
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) if (parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none') { why.push(`border-${s.toLowerCase()} ${cs[`border${s}Width`]}`); }
    const chip = /chip|\bkey\b|kbd/.test(String(e.className)) || e.tagName === 'KBD';
    const rad = Math.max(...['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map((c) => parseFloat(cs[`border${c}Radius`]) || 0));
    if (rad > 4 || (rad > 0 && !chip && r.width < 4000 && false)) why.push(`radius ${rad}`);
    if (cs.boxShadow !== 'none') why.push(`box-shadow ${cs.boxShadow.slice(0, 40)}`);
    if (cs.textShadow !== 'none') why.push('text-shadow');
    if (cs.backdropFilter && cs.backdropFilter !== 'none') why.push(`backdrop-filter ${cs.backdropFilter}`);
    if (cs.filter !== 'none') why.push(`filter ${cs.filter.slice(0, 30)}`);
    if (/gradient/.test(cs.backgroundImage)) why.push('gradient');
    if (why.length) out.push(`${name(e)} :: ${why.join(', ')}`);
  }
  return out;
};
const all = new Map();
let gl = false;
try {
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    await p.goto(url);
    // The menu rows (Build my PC among them) stay disabled until the 3D world boots: wait for that, capped at 120 s.
    await p.waitForSelector('.pl-row', { timeout: 60000 });
    await p.waitForFunction(() => document.querySelectorAll('.pl-row:disabled').length === 0, null, { timeout: 120000 });
    await p.waitForTimeout(1500);
    const rend = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
    if (/swiftshader|llvmpipe|software/i.test(rend)) { console.log('software GL: stopping'); gl = true; break; }
    await p.click('text=Build my PC');
    await p.waitForSelector('.bld-foot', { timeout: 20000 });
    await p.waitForTimeout(3000);
    const tabs = p.locator('.bld-panes [role=tab]:visible');
    const n = (await tabs.count().catch(() => 0));
    if (n) for (let i = 0; i < n; i++) { await tabs.nth(i).click(); await p.waitForTimeout(300); for (const x of await p.evaluate(walk)) (all.get(x) ?? all.set(x, new Set()).get(x)).add(`${w}x${h}`); }
    else {
      for (const x of await p.evaluate(walk)) (all.get(x) ?? all.set(x, new Set()).get(x)).add(`${w}x${h}`);
      await p.locator('.bld-mtog').first().click().catch(() => {});
      await p.waitForTimeout(400);
    }
    for (const x of await p.evaluate(walk)) (all.get(x) ?? all.set(x, new Set()).get(x)).add(`${w}x${h}`);
    await ctx.close();
  }
} finally { await browser.close(); stop(); }
for (const [k, v] of all) console.log(`${k}  [${[...v].join(' ')}]`);
console.log(`${all.size} distinct break(s)`);
process.exit(gl ? 2 : all.size ? 1 : 0);
