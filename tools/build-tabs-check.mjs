// `node tools/build-tabs-check.mjs <outDir> [--prod]`: opens "Build my PC" at the four viewports of the browser check (parent #29, which #41 builds
// under): 1920x1080 desk, 390x844 and 360x800 phones, 844x390 landscape phone. Each one gets the layout checks a person would see: no page errors, no
// page scroll across the width, the layout the viewport picks, the summary, the lens, the bottom bar and the panels inside the screen, and no two of them
// overlapping. A phone also picks a part and checks its card is on screen. A phone checks each pane (Parts, Machine, Run); the desk checks the machine list shut and open. A screenshot per state goes to outDir.
// Exit: 0 when every check passes, 1 when a check fails, 2 when the browser draws on software GL (nothing checked). Dev server by default; `--prod`
// builds and serves the optimized game (`vite preview`). Like tools/shot.mjs it draws on the real GPU. Env: PORT (5199), CHROME_PATH.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'build-tabs');
const PROD = args.includes('--prod');
const PORT = Number(process.env.PORT || 5199);
const url = `http://localhost:${PORT}/`;
const SIZES = [
  { name: 'desk', w: 1920, h: 1080, phone: false },
  { name: 'phone', w: 390, h: 844, phone: true },
  { name: 'phone-small', w: 360, h: 800, phone: true },
  { name: 'landscape', w: 844, h: 390, phone: true },
];
// the Build pieces that must not overlap each other (a piece inside another one is not a pair)
const CHROME = ['.bld-read', '.bld-lens', '.bld-hint', '.bld-panes', '.bld-run', '.bld-tools', '.bld-views', '.bld-bin', '.bld-inst', '.bld-mtog'];
mkdirSync(outDir, { recursive: true });

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

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const problems = [];
const fail = (where, what) => { problems.push(`${where}: ${what}`); console.log(`FAIL ${where}: ${what}`); };
/** Page side: the pieces on screen, the pairs that overlap (a piece inside another is not a pair), the pieces that leave the screen. */
const facts = (chrome) => {
  const shown = (e) => { if (getComputedStyle(e).display === 'none') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const items = [];
  for (const q of chrome) for (const e of document.querySelectorAll(q)) if (shown(e)) { const r = e.getBoundingClientRect(); items.push({ q, e, x: r.left, y: r.top, r: r.right, b: r.bottom }); }
  const overlaps = [], offscreen = [];
  items.forEach((a, i) => {
    if (a.x < -0.5 || a.y < -0.5 || a.r > innerWidth + 0.5 || a.b > innerHeight + 0.5) offscreen.push(a.q);
    items.slice(i + 1).forEach((b) => {
      if (a.e.contains(b.e) || b.e.contains(a.e)) return;
      if (Math.min(a.r, b.r) - Math.max(a.x, b.x) > 1 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 1) overlaps.push(`${a.q} x ${b.q}`);
    });
  });
  const build = document.querySelector('.build');
  const panes = document.querySelector('.bld-panes');
  return {
    layout: build?.getAttribute('data-layout') ?? null,
    machine: build?.getAttribute('data-machine') ?? null,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    paneTabsShown: !!panes && shown(panes),
    overlaps, offscreen,
    boxes: items.map((a) => `  ${a.q} at ${Math.round(a.x)},${Math.round(a.y)} size ${Math.round(a.r - a.x)}x${Math.round(a.b - a.y)}`),
  };
};

let glFailed = false;
try {
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h } });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    /** One state of the screen: its facts, a screenshot, and a failure for each broken check. */
    const check = async (label) => {
      const where = `${s.name} ${label}`, f = await p.evaluate(facts, CHROME);
      const file = resolve(outDir, `build-${s.name}-${label}-${PROD ? 'prod' : 'dev'}.png`);
      await p.screenshot({ path: file });
      console.log(`[${where}] layout ${f.layout}, machine ${f.machine}, overflowX ${f.overflowX}, pane tabs ${f.paneTabsShown ? 'shown' : 'hidden'}; saved ${file}`);
      if (f.layout !== (s.phone ? 'phone' : 'desk')) fail(where, `the layout is ${f.layout}, the viewport wants ${s.phone ? 'phone' : 'desk'}`);
      if (f.overflowX > 0) fail(where, `the page scrolls sideways by ${f.overflowX}px`);
      if (f.paneTabsShown !== s.phone) fail(where, `the pane tabs are ${f.paneTabsShown ? 'shown' : 'hidden'}`);
      if (f.overlaps.length) fail(where, `pieces overlap: ${[...new Set(f.overlaps)].join('; ')}`);
      if (f.offscreen.length) fail(where, `pieces leave the screen: ${[...new Set(f.offscreen)].join(', ')}`);
      if (f.overlaps.length || f.offscreen.length) console.log(f.boxes.join('\n'));
    };
    /** A phone: pick a part (dev builds expose the stage as `window.__build`) and fail when its card leaves the screen. */
    const cardCheck = async () => {
      const picked = await p.evaluate(() => { const b = window.__build; const d = b?.board.devices[0]; if (!d) return b ? 'none' : 'nostage'; b.select(d.id); return 'ok'; });
      if (picked === 'nostage') { console.log(`[${s.name}] no window.__build (a prod build): the part card is not checked`); return; }
      if (picked === 'none') { fail(`${s.name} part card`, 'there is no part to pick, so no card to check'); return; }
      await p.waitForTimeout(600);
      const r = await p.evaluate(() => { const e = document.querySelector('.bld-card'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: innerWidth, h: innerHeight }; });
      await p.screenshot({ path: resolve(outDir, `build-${s.name}-card-${PROD ? 'prod' : 'dev'}.png`) });
      if (!r) fail(`${s.name} part card`, 'a part is picked but no card is drawn');
      else if (r.x < -0.5 || r.y < -0.5 || r.r > r.w + 0.5 || r.b > r.h + 0.5) fail(`${s.name} part card`, `the card is outside the screen: ${Math.round(r.x)},${Math.round(r.y)} to ${Math.round(r.r)},${Math.round(r.b)} in ${r.w}x${r.h}`);
      await p.evaluate(() => window.__build?.select(null));
    };
    try {
      await p.goto(url);
      await p.waitForTimeout(1500);
      const renderer = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
      console.log(`[${s.name} ${s.w}x${s.h}] GL renderer: ${renderer}`);
      if (/swiftshader|llvmpipe|software/i.test(renderer)) { console.log('The browser fell back to software GL: stopping.'); glFailed = true; }
      else {
        await p.click('text=Build my PC');
        await p.waitForSelector('.bld-foot', { timeout: 20000 });
        await p.waitForTimeout(4000);
        if (s.phone) await cardCheck();
        if (s.phone) {
          // a phone shows one pane at a time: each one is a state of its own
          const tabs = p.locator('.bld-panes [role=tab]');
          const n = await tabs.count();
          for (let i = 0; i < n; i++) {
            await tabs.nth(i).click();
            await p.waitForTimeout(400);
            await check((await tabs.nth(i).textContent()).trim().toLowerCase());
          }
        } else {
          // name each state by the page's own data-machine value (the desk may start open or shut)
          const before = await p.getAttribute('.build', 'data-machine');
          await check(`machine-${before}`);
          await p.locator('.bld-mtog').first().click();
          await p.waitForTimeout(400);
          const after = await p.getAttribute('.build', 'data-machine');
          if (after === before) fail(s.name, `the machine toggle did not change data-machine (${before})`);
          await check(`machine-${after}`);
        }
      }
    } catch (e) {
      fail(s.name, `the checks could not run: ${String(e.message).split('\n')[0]}`);
    }
    if (errors.length) fail(s.name, `page errors: ${errors.slice(0, 3).join(' | ')}`);
    await ctx.close();
    if (glFailed) break;
  }
} finally {
  await browser.close();
}
stop();
console.log(problems.length ? `${problems.length} check(s) failed` : 'all checks passed');
process.exit(glFailed ? 2 : problems.length ? 1 : 0);
