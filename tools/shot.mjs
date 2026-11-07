// `npm run shot -- <out.png> [--view cpu|board|x,y,z] [--clip hud] [--wait ms] [--size WxH]`: starts (or reuses) the dev server, opens a sandbox game in a
// headless Chrome that draws on the real GPU (ANGLE/D3D11, never SwiftShader: software GL burns the CPU), moves the camera and saves a screenshot.
// It prints the WebGL renderer it got; if that says SwiftShader/llvmpipe it stops (SOFTWARE=1 allows it). Look at the picture after every render or UI change.
//   --view cpu            fly to the CPU die (the camera `flyToCpu`); `board` the whole board; `x,y,z` an exact camera view (board units, zoom)
//   --clip hud            only the top bar (the pause / speed / slow-motion controls)
//   --prod                build first (`npm run build`) and shoot the optimized build through `vite preview` (what players run); the dev-only `window.__board`
//                         is absent there, so --view takes cpu or board (the F / B keys), not x,y,z
//   (default)             the Three.js renderer, the game's view; --view also takes `room` there
//   --2d                  the hidden 2D Pixi board (opens the game with `?2d`)
//   --hour h              (dev server, --3d) pin the room's hour (`roomDebug.hour`), e.g. 23 or 14.2
//   --look x,y,z,yaw,pitch,height  (dev server, --3d) an exact 3D view (`window.__board.lookAt`); the room may move the eye to keep it inside.
//                         Measure the picture with `node tools/lum.mjs <png> x,y,w,h ...`
//   env: PORT (5199), CHROME_PATH (default: the installed Chrome), SOFTWARE=1
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const out = resolve(args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--')) ?? 'shot.png');
const [W, H] = (flag('size', '1600x900')).split('x').map(Number);
const PORT = Number(process.env.PORT || 5199);
const url = `http://localhost:${PORT}/`;
mkdirSync(dirname(out), { recursive: true });

const PROD = args.includes('--prod');
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

const gpu = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: process.env.SOFTWARE ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : gpu,
});
try {
  const p = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // --console: print the page's console errors and warnings too (a shader that fails to compile is only logged)
  if (args.includes('--console')) p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 2000)); });
  await p.goto(args.includes('--2d') ? url + '?2d' : url);
  await p.waitForTimeout(1500);
  const renderer = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  console.log('GL renderer:', renderer);
  if (/swiftshader|llvmpipe|software/i.test(renderer) && !process.env.SOFTWARE) { console.log('The browser fell back to software GL: stopping (SOFTWARE=1 to allow it).'); process.exitCode = 2; throw new Error('software GL'); }
  await p.click('text=Sandbox');
  await p.click('button:has-text("Start")');
  if (PROD) await p.waitForSelector('canvas', { timeout: 20000 });
  else await p.waitForFunction(() => !!window.__board, null, { timeout: 20000 });
  await p.waitForTimeout(2500);
  if (flag('hour', '')) await p.evaluate(async (h) => { const { roomDebug } = await import('/src/features/room/render/shell/room.ts'); roomDebug.hour = h; }, Number(flag('hour', '')));
  const view = flag('view', '');
  if (PROD && (view === 'cpu' || view === 'board')) await p.keyboard.press(view === 'cpu' ? 'f' : 'b');
  else if (view === 'cpu') await p.evaluate(() => window.__board.flyToCpu());
  else if (view === 'board') await p.evaluate(() => window.__board.flyToBoard());
  else if (view === 'room') await p.evaluate(() => window.__board.flyToRoom?.());
  else if (view.includes(',')) { const [x, y, z] = view.split(',').map(Number); await p.evaluate(([x, y, z]) => window.__board.camera.set({ x, y, z }), [x, y, z]); }
  if (flag('look', '')) await p.evaluate((v) => window.__board.lookAt(...v), flag('look', '').split(',').map(Number));
  // --click "text" (repeatable by "a|b"): click these in order after the view is set, e.g. the menu and then its OS entry
  for (const t of flag('click', '').split('|').filter(Boolean)) { await p.click(t.startsWith('[') || t.includes('=') ? t : `text=${t}`); await p.waitForTimeout(400); }
  // --eval "js": run this in the page (dev server only: `await import('/src/app/store.ts')` is the live store, e.g. `.powerButton()` to switch the machine on);
  // what it returns is printed
  if (flag('eval', '')) {
    const out = await p.evaluate((code) => (0, eval)(`(async () => { ${code} })()`), flag('eval', ''));
    if (out !== undefined) console.log('eval:', JSON.stringify(out));
  }
  // --keys "a" (comma list): press these keys after the clicks, e.g. `a` for the airflow lens
  for (const k of flag('keys', '').split(',').filter(Boolean)) { await p.keyboard.press(k); await p.waitForTimeout(300); }
  // --hover "x,y": rest the pointer here (screen pixels), e.g. to see a part's outline
  if (flag('hover', '')) await p.mouse.move(...flag('hover', '').split(',').map(Number));
  await p.waitForTimeout(Number(flag('wait', 2500)));
  // --fps: count animation frames for 3 s and print the mean frame rate and the slowest frame (the 3D target is 60 FPS)
  if (args.includes('--fps')) {
    const r = await p.evaluate(() => new Promise((done) => {
      let n = 0, worst = 0, t0 = performance.now(), prev = t0;
      const f = (t) => { n++; worst = Math.max(worst, t - prev); prev = t; if (t - t0 < 3000) requestAnimationFrame(f); else done({ fps: Math.round((n / (t - t0)) * 10000) / 10, worstMs: Math.round(worst) }); };
      requestAnimationFrame(f);
    }));
    console.log(`FPS ${r.fps} (slowest frame ${r.worstMs} ms)`);
  }
  const clip = flag('clip', '') === 'hud' ? { x: 0, y: 0, width: W, height: 90 } : undefined;
  await p.screenshot({ path: out, ...(clip ? { clip } : {}) });
  console.log('saved', out, errors.length ? `(page errors: ${errors.slice(0, 3).join(' | ')})` : '');
} finally {
  await browser.close();
}
// a dev server this run started keeps node alive: stop it, or the tool never returns
stop();
process.exit();
