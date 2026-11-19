// `npm run jobsheet -- <out.png> <job> [--preset level,ram,storage,gpus,npus] [--focus slot] [--view yaw,pitch,fill] [--speed n] [--cols n] [--crop x,y,w,h] [--max n] [--keep]`
// One command, one picture: runs a Build my PC job (`remove:<slot>` or `fit:<spec>:<slot>`, e.g. `fit:cpu2:cpu0`, `remove:vrm-sink0.fan0`) in a headless Chrome
// on the real GPU, records it with the CDP screencast, picks the middle frame of each step (at most --max, default 16) and writes ONE contact sheet
// labelled with the steps. The page reads and the sheet is composed in the page: no Python, no per-frame files. Reuses a running dev server (PORT 5245)
// and leaves it running with --keep, so the next run skips the 5 s start. About 15 s for a whole swap at --speed 2.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
const out = resolve(pos[0] ?? 'jobsheet.png'), JOB = pos[1] ?? 'remove:vrm-sink0.fan0';
const FOCUS = flag('focus', JOB.startsWith('fit:') ? JOB.split(':')[2] : JOB.split(':')[1]), VIEW = flag('view', '0.35,0.55,6'), SPEED = Number(flag('speed', '2'));
const COLS = Number(flag('cols', '4')), MAX = Number(flag('max', '16')), CROP = flag('crop', '0,0,1600,900').split(',').map(Number);
const PORT = Number(process.env.PORT || 5245), url = `http://localhost:${PORT}/`;
mkdirSync(dirname(out), { recursive: true });

const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: args.includes('--keep') });
  if (args.includes('--keep')) server.unref();
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 150));
}
const t0 = Date.now();
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } }), p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await p.goto(url);
  await p.click('text=Build my PC');
  await p.waitForFunction(() => !!window.__build && !!document.querySelector('.bld-read'), null, { timeout: 30000 });
  const gl = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c?.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
  if (/swiftshader|llvmpipe/i.test(gl) && !process.env.SOFTWARE) { console.log('software GL:', gl); process.exit(1); }
  // `--preset level,ram,storage,gpus,npus`: play the job on that ready-made machine (as `buildPreset` makes it: level 0 is a Mini, 0.3 a Micro, 0.65 a Mid, 1 a Full tower) instead of the maxed one
  if (flag('preset', '')) {
    const [level, ram, storage, gpus, npus] = flag('preset', '').split(',').map(Number);
    await p.evaluate(async (pr) => { await window.__build.buildPreset({ name: 'x', ...pr }); }, { level, ram, storage, gpus, npus });
    await p.waitForTimeout(2500);
  }
  // (the machine stands once the first frames draw: aim the camera at the focus part)
  await p.evaluate(async ([FOCUS, VIEW]) => {
    const B = window.__build;
    B.openInside(true);
    await new Promise((r) => setTimeout(r, 1200)); // (the door swings and the camera follows: aim after it)
    const [yaw, pitch, fill] = VIEW.split(',').map(Number);
    for (let i = 0; i < 80; i++) {
      const f = B.board.devices.find((d) => d.slot === FOCUS);
      if (f && B.focus('dev:' + f.id, yaw, pitch, fill)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 700));
  }, [FOCUS, VIEW]);
  const cdp = await ctx.newCDPSession(p), shots = [];
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    shots.push({ data: f.data, at: Date.now() });
  });
  const steps = [];
  await p.exposeFunction('__step', (s, at) => steps.push({ s, at }));
  await p.evaluate((SPEED) => {
    const B = window.__build; B.speed.value = SPEED;
    let last = null;
    const tick = () => { const s = B.status.peek().step; if (s !== last) { last = s; window.__step(s, Date.now()); } requestAnimationFrame(tick); };
    tick();
  }, SPEED);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  await p.evaluate(([JOB]) => {
    const B = window.__build, [verb, a, b] = JOB.split(':'), dev = (slot) => 'dev:' + B.board.devices.find((d) => d.slot === slot).id;
    window.__job = verb === 'remove' ? B.remove(dev(a)) : B.fit(a, b);
  }, [JOB]);
  await p.waitForFunction(() => { const B = window.__build; return !B.anim && !B.status.peek().busy && B.status.peek().step === ''; }, null, { timeout: 300000, polling: 100 }).catch(() => {});
  await cdp.send('Page.stopScreencast');
  // the middle frame of each step, thinned evenly to --max
  const spans = steps.filter((s) => s.s).map((s, i, all) => ({ s: s.s, a: s.at, b: (steps[steps.indexOf(s) + 1] ?? { at: Date.now() }).at }));
  let pick = spans.map((w) => ({ s: w.s, f: shots.reduce((best, f) => (Math.abs(f.at - (w.a + w.b) / 2) < Math.abs(best.at - (w.a + w.b) / 2) ? f : best), shots[0]) })).filter((x) => x.f);
  if (pick.length > MAX) pick = Array.from({ length: MAX }, (_, i) => pick[Math.round((i * (pick.length - 1)) / (MAX - 1))]);
  const png = await p.evaluate(async ([pick, COLS, CROP]) => {
    const [cx, cy, cw, ch] = CROP, tw = 480, th = Math.round((tw * ch) / cw), rows = Math.ceil(pick.length / COLS);
    const c = document.createElement('canvas'); c.width = tw * COLS; c.height = th * rows;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.font = '12px sans-serif';
    for (let i = 0; i < pick.length; i++) {
      const im = new Image(); im.src = 'data:image/jpeg;base64,' + pick[i].f.data; await im.decode();
      const x = (i % COLS) * tw, y = Math.floor(i / COLS) * th, k = im.width / 1600;
      g.drawImage(im, cx * k, cy * k, cw * k, ch * k, x, y, tw, th);
      g.fillStyle = '#000'; g.fillRect(x, y, tw, 15); g.fillStyle = '#ff0'; g.fillText(`${i + 1} ${pick[i].s}`, x + 4, y + 12);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, [pick, COLS, CROP]);
  writeFileSync(out, Buffer.from(png, 'base64'));
  console.log(`${out}: ${pick.length} steps of ${spans.length}, ${shots.length} frames, GL ${gl}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} finally {
  await browser.close();
  if (server && !args.includes('--keep')) server.kill();
}
