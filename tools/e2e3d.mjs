// `node tools/e2e3d.mjs [chromium|firefox|webkit] [--baseline dir] [--url http://localhost:5173]`: drives the 3D game (`?3d`) with the real pointer and checks
// the interaction (install a part from the inventory, lift it to the shelf, plug and eject a key, pull a cable and plug it back), prints the frame rate and
// the GL renderer, and with `--baseline dir` compares the room, board and CPU views with the shots saved there (the first run saves them; a mean
// difference over 2 % fails). Keep the baselines outside the repo. Needs the dev server (`npm run dev`) and, for firefox / webkit,
// `npx playwright-core install firefox webkit`. Exits 1 when a check fails.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const which = ['firefox', 'webkit'].find((b) => args.includes(b)) ?? 'chromium';
const url = flag('url', 'http://localhost:5173') + '/?3d';
const baseline = flag('baseline', '');
const b = which === 'firefox' ? await firefox.launch({ headless: true }) : which === 'webkit' ? await webkit.launch({ headless: true })
  : await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errs = [], failed = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const check = (name, ok) => { console.log(ok ? 'ok  ' : 'FAIL', name); if (!ok) failed.push(name); };
await p.goto(url);
await p.waitForTimeout(1500);
await p.click('text=Sandbox');
await p.click('button:has-text("Start")');
await p.waitForFunction(() => !!window.__board, null, { timeout: 30000 });
await p.waitForTimeout(2500);
const snap = (f) => p.evaluate(async (f) => { const s = (await import('/src/app/store.ts')).snapshot.value; return eval(f); }, f);
const at = (id) => p.evaluate((id) => window.__board.screenOf(id), id);
const view = async (v) => { await p.evaluate((v) => window.__board[v](), v); await p.waitForTimeout(2500); };
console.log(which, await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); }));
console.log('FPS', await p.evaluate(() => new Promise((done) => { let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < 2000) requestAnimationFrame(f); else done(Math.round((n / (t - t0)) * 10000) / 10); }; requestAnimationFrame(f); })));
const drag = async (a, z) => {
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.waitForTimeout(50);
  await p.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2, { steps: 6 });
  await p.mouse.move(z.x, z.y, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(1200);
};

// the shots first, from the machine as it starts
if (baseline) {
  mkdirSync(baseline, { recursive: true });
  for (const v of ['flyToRoom', 'flyToBoard', 'flyToCpu']) {
    await view(v);
    const png = await p.screenshot(), f = resolve(baseline, `${which}-${v}.png`);
    if (!existsSync(f)) { writeFileSync(f, png); console.log('saved baseline', f); continue; }
    const diff = await p.evaluate(async ([a, c]) => {
      const load = (d) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + d; });
      const [x, y] = await Promise.all([load(a), load(c)]), W = x.width, H = x.height;
      const px = (i) => { const k = document.createElement('canvas'); k.width = W; k.height = H; const g = k.getContext('2d'); g.drawImage(i, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
      const A = px(x), B = px(y);
      let s = 0;
      for (let i = 0; i < A.length; i += 4) s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      return s / (A.length / 4) / 765;
    }, [readFileSync(f).toString('base64'), png.toString('base64')]);
    check(`${v} matches its baseline (${(diff * 100).toFixed(2)} % off)`, diff < 0.02);
  }
}

// 1. install from the inventory, 2. lift it to the shelf
await p.evaluate(async () => { (await import('/src/app/store.ts')).purchase('tpm1'); });
await view('flyToBoard');
await p.click('.invbtn:has-text("Inventory")').catch(() => {});
await p.waitForTimeout(600);
const tile = await p.$('[data-inv][title*="Secure module" i]'), tb = tile && (await tile.boundingBox()), sock = await at('tpm0');
if (tb && sock) await drag({ x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 }, sock);
check('a part dragged from the inventory installs on its socket', await snap("s.devices.some((d) => d.kind === 'tpm')"));
// the part is lifted from higher up, clear of the shelf
await p.evaluate(async () => {
  const L = await import('/src/features/board/render/layout/layout.ts'), A = await import('/src/core/render/accelart.ts'), t = A.tpmRect(L.LAYOUT_TIER);
  window.__board.camera.set({ x: t.x + t.w / 2, y: t.y + t.h / 2 + 500, z: 0.5 });
});
await p.waitForTimeout(1500);
const dev = await snap("s.devices.find((d) => d.kind === 'tpm')?.id"), from = dev && (await at(dev)), shelf = await (await p.$('.inv'))?.boundingBox();
if (from && shelf) await drag(from, { x: shelf.x + shelf.width / 2, y: shelf.y + shelf.height / 2 });
check('an installed part dragged to the shelf is unmounted', !(await snap("s.devices.some((d) => d.kind === 'tpm')")));
// 3. keys
await view('flyToRoom');
const key = await snap('s.tray[0]?.id');
if (key != null) {
  const kp = await at('key:' + key), up = await at('usb');
  if (kp && up) await drag(kp, up);
  check('a key dragged to the USB port plugs in', (await snap('s.plugged?.id')) === key);
  const pk = await at('key:' + key);
  if (pk) await drag(pk, { x: 800, y: 700 });
  check('the plugged key dragged away ejects', (await snap('s.plugged?.id ?? null')) === null);
}
// 4. a cable (the PSU's leads only move while the machine is off: a plugged key starts it)
if (await snap('s.powered')) {
  await p.evaluate(async () => (await import('/src/app/store.ts')).powerButton());
  await p.waitForTimeout(1500);
}
await view('flyToBoard');
const cp = await at('cable.atx');
if (cp) {
  await drag(cp, { x: 60, y: 450 });
  check('a cable pulled out and dropped off the machine stays out', (await snap("s.cables.find((c) => c.id === 'atx')?.connected")) === false);
  const again = await at('cable.atx');
  if (again) await drag(again, { x: 700, y: 400 });
  check('a loose cable dropped on the machine plugs in', (await snap("s.cables.find((c) => c.id === 'atx')?.connected")) === true);
}
check('no page errors', errs.length === 0);
if (errs.length) console.log(errs.slice(0, 4).join('\n'));
await b.close();
process.exit(failed.length ? 1 : 0);
