// `node tools/shot-case.mjs <out.png> --part cooler|nvme2 [--preset Low|Medium|High|Ultra] [--size 1600x900] [--yaw 0] [--pitch 0.1] [--fill 0.6]`
// A close-up inside the case: opens the sandbox with the assembled machine (the 3D room, as bench-modes' `game-max`), sets the graphics preset in the
// real panel (auto-adjust off, as shot.mjs does), frames one device from its own box and saves a screenshot. `--part` takes a device's spec id
// (`nvme2`, the second M.2 drive) or its kind (`cooler`). `--fill` is the share of the view's height the part's largest side takes (0.6 by default);
// `--yaw` turns the view round the part, `--pitch` looks down on it from above (radians).
// The camera: `__board.frameSpec` (dev hook, board3d.ts) sets the view with `jumpRaw`, which skips the room clamp (`inRoom`) that snaps any
// `flyTo`, `jump` or `lookAt` view back to the room's overview. The script prints `goal()` and `view()` before and after, and checks that the
// view is the one it asked for and that it moved off the overview. Dev server only (PORT, default 5199; CHROME_PATH optional).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const out = resolve(args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--')) ?? 'case.png');
const PART = flag('part', '');
if (!PART) throw new Error('--part cooler|nvme2 (a device spec id or kind)');
const PRESET = flag('preset', 'Low');
if (!['Low', 'Medium', 'High', 'Ultra'].includes(PRESET)) throw new Error('--preset Low|Medium|High|Ultra');
const [W, H] = flag('size', '1600x900').split('x').map(Number);
const YAW = Number(flag('yaw', 0)), PITCH = Number(flag('pitch', 0.1)), FILL = Number(flag('fill', 0.6));
const PORT = Number(process.env.PORT || 5199), url = `http://localhost:${PORT}/`;
mkdirSync(dirname(out), { recursive: true });

const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const stop = () => { try { server?.kill(); } catch { /* gone */ } };
process.on('exit', stop);

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

  // the sandbox with the assembled machine (bench-modes' `game-max` path)
  await p.click('text=New game'); await p.waitForSelector('#ng-title', { timeout: 20000 });
  await p.click('.ng-back >> text=Sandbox'); await p.click('text=Assembled machine');
  await p.click('.ng-back button.primary'); await p.waitForSelector('header.hud', { timeout: 60000 });
  await p.waitForFunction(() => !!window.__board?.three, null, { timeout: 60000 });
  await p.waitForTimeout(4000); // (the flight in from the room, the programs' link)

  // the graphics preset, in the real panel, auto-adjust off (shot.mjs's steps)
  await p.click('[aria-label=Menu]');
  await p.click('role=menuitem[name=/Graphics/]');
  await p.click(`aside.gfx .gfx-presets >> text=${PRESET}`);
  await p.click('aside.gfx [aria-label=Auto-adjust] >> text=Off');
  await p.click('[aria-label="Close graphics"]');
  const g = await p.evaluate(() => JSON.parse(localStorage.getItem('pipeline-city.graphics') ?? 'null'));
  const t = await p.evaluate(() => JSON.parse(localStorage.getItem('pipeline-city.graphics.tier') ?? 'null'));
  if (!g || g.auto !== false || t?.mode !== 'manual') { console.log(`The preset ${PRESET} did not take (saved: ${JSON.stringify(g)}).`); process.exitCode = 3; throw new Error('preset'); }
  await p.waitForTimeout(3000); // (a preset change rebuilds the machine; its programs link)

  // the view: before, then the close-up through the hook, then after the frames have run
  const before = await p.evaluate(() => ({ goal: window.__board.goal(), view: window.__board.view() }));
  const asked = await p.evaluate(([k, yaw, pitch, fill]) => window.__board.frameSpec(k, yaw, pitch, fill), [PART, YAW, PITCH, FILL]);
  if (!asked) throw new Error(`no device with spec or kind "${PART}" in the sandbox machine`);
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => ({ goal: window.__board.goal(), view: window.__board.view() }));

  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const moved = d3(before.view, after.view);
  const atAsked = d3(after.view, asked) < Math.max(1, asked.height * 0.01) && Math.abs(after.view.height - asked.height) < asked.height * 0.01;
  console.log('asked (view):', JSON.stringify({ x: asked.x, y: asked.y, z: asked.z, height: asked.height, yaw: asked.yaw, pitch: asked.pitch }));
  console.log('before goal:', JSON.stringify(before.goal));
  console.log('before view:', JSON.stringify(before.view));
  console.log('after goal: ', JSON.stringify(after.goal));
  console.log('after view: ', JSON.stringify(after.view));
  console.log(`camera moved ${moved.toFixed(0)} units from the overview; the view is the asked one: ${atAsked ? 'yes' : 'NO'}`);
  if (!atAsked || moved < 1) { console.log('The camera did not reach the close-up: the picture is not the part. Check the printed views.'); process.exitCode = 4; }

  await p.screenshot({ path: out });
  console.log(`saved ${out} (${PART}, ${PRESET}, ${W}x${H})${errors.length ? ` (page errors: ${errors.slice(0, 3).join(' | ')})` : ''}`);
} finally {
  await browser.close().catch(() => {});
  stop();
}
