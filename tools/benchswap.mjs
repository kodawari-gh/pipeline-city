// `npm run bench:swap -- [out.json] [--preset High|Low] [--size 1600x900] [--top 14] [--no-profile]`: opens Build my PC in a headless Chrome on the real GPU and plays
// the swaps a player makes: a RAM stick out and back, a graphics card out, the 24-pin unplugged and plugged. For each step it reports the wall time, the machine builds
// (`BuildStage.cost`: full builds, their ms, builds skipped), the longest frame gap, the render programs, geometries and textures after it, the JS heap, and the hottest
// functions of a CPU profile over the whole run. Nothing here passes or fails: it reports (docs/render/load.md "Swap cost"). Dev server only (`window.__build`).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const out = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
const [W, H] = flag('size', '1600x900').split('x').map(Number);
const PORT = Number(process.env.PORT || 5241), url = `http://localhost:${PORT}/`, TOP = Number(flag('top', 14));
const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
process.on('exit', () => { try { server?.kill(); } catch { /* gone */ } });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-precise-memory-info'],
});

const hottest = (profile) => {
  const self = new Map(), nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => { const n = nodes.get(id), k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-1)[0]}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000); });
  return [...self].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]);
};

try {
  const p = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForTimeout(1500);
  const gl = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'), e = g?.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  console.log('GL renderer:', gl);
  if (/swiftshader|llvmpipe|software/i.test(gl)) throw new Error('software GL');
  if (flag('preset', '')) {
    // (the real graphics panel, as tools/bench3d.mjs does)
    const name = flag('preset', '');
    await p.evaluate(async (n) => { const g = await import('/src/app/graphics.ts'); g.setPreset?.(n); g.setAuto?.(false); }, name).catch(() => {});
  }
  await p.click('text=Build my PC');
  await p.waitForSelector('.bld-bar', { timeout: 30000 });
  await p.waitForFunction(() => !!window.__build, null, { timeout: 30000 });
  await p.waitForTimeout(4000);
  // a probe for the longest gap between two frames inside a step
  await p.evaluate(() => {
    window.__gap = { max: 0, last: performance.now(), on: false };
    const tick = (t) => { const g = window.__gap; if (g.on) g.max = Math.max(g.max, t - g.last); g.last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const cdp = await p.context().newCDPSession(p);
  const profile = !args.includes('--no-profile');
  if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }

  const steps = [
    ['ram out', `const r=B.snapshot.devices.find(d=>d.kind==='ram'); window.__ram=r; await B.remove('dev:'+r.id)`],
    ['ram back', `await B.fit(window.__ram.spec)`],
    ['nic out', `const r=B.snapshot.devices.find(d=>d.kind==='nic'); await B.remove('dev:'+r.id)`],
    ['cpu out', `const r=B.snapshot.devices.find(d=>d.kind==='cpu'); await B.remove('dev:'+r.id)`],
    ['24-pin unplug', `await B.remove('cable:atx')`],
  ];
  const rows = [];
  for (const [name, code] of steps) {
    const r = await p.evaluate(async ([code]) => {
      const B = window.__build, c0 = { ...B.cost }, g = window.__gap;
      const info = () => { const i = B.ctx.renderer.info; return { programs: i.programs?.length ?? 0, geometries: i.memory.geometries, textures: i.memory.textures }; };
      g.max = 0; g.on = true;
      const t0 = performance.now();
      await (0, eval)(`(async (B) => { ${code} })`)(B);
      const ms = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 600));
      g.on = false;
      const c1 = B.cost;
      return { ms: Math.round(ms), builds: c1.builds - c0.builds, buildMs: Math.round(c1.buildMs - c0.buildMs), skipped: c1.skipped - c0.skipped, gapMs: Math.round(g.max), ...info(), heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576) };
    }, [code]);
    rows.push({ name, ...r });
    console.log(name.padEnd(15) + Object.entries(r).map(([k, v]) => `${k} ${v}`).join('   '));
  }
  let top = [];
  if (profile) { top = hottest((await cdp.send('Profiler.stop')).profile).filter(([k]) => !/^\((idle|program|garbage collector)\)/.test(k)).slice(0, TOP); for (const [k, v] of top) console.log(`   ${String(v).padStart(6)} ms  ${k}`); }
  if (errors.length) console.log('page errors:', errors.slice(0, 3));
  if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), JSON.stringify({ gl, rows, top }, null, 1)); }
} finally {
  await browser.close();
  try { server?.kill(); } catch { /* gone */ }
}
