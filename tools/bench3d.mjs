// `npm run bench:3d -- [out.json] [--2d] [--lowpower] [--size 1920x1080] [--dpr 1] [--only a,b] [--preset High] [--baseline old.json] [--top 6] [--no-profile] [--no-vsync-off]`:
// plays the game with the real pointer on the real GPU and measures what a player feels: the idle views, the flights, the side door, the hover, a cable pulled
// and plugged, a part lifted, the running machine. Each scenario prints its frame times; out.json keeps, per scenario, the time of each part of the frame
// (`cpu`), the GPU time of each pass (`gpu`, with EXT_disjoint_timer_query), how many times the scene and the shadow maps were drawn per frame, the draw
// calls, the machine rebuilds, the long tasks and the hottest functions of a CPU profile. Compare two runs with `--baseline old.json`. It starts its own dev
// server on PORT (5197), so no hot update changes the code under it; `window.__board` exists only there. Nothing here is a pass or a fail: it reports.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const has = (n) => args.includes('--' + n);
const out = args.find((a, i) => a.endsWith('.json') && !(args[i - 1] ?? '').startsWith('--'));
const [W, H] = flag('size', '1920x1080').split('x').map(Number);
const TWO = has('2d'), LOW = has('lowpower'), TOP = Number(flag('top', 6)), only = flag('only', '').split(',').filter(Boolean);
const PORT = Number(process.env.PORT || 5197), url = `http://localhost:${PORT}/${TWO ? '?2d' : `?3d${LOW ? '&lowpower' : ''}`}`;

const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const browser = await chromium.launch({
  headless: true, channel: 'chrome',
  // without the frame limit a frame rate over the screen's still says how much room is left
  args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...(has('no-vsync-off') ? [] : ['--disable-frame-rate-limit', '--disable-gpu-vsync']), ...(LOW ? ['--force_low_power_gpu'] : [])],
});
const stop = async () => { await browser.close().catch(() => {}); try { server?.kill(); } catch { /* gone */ } };

// ---- in the page: times the frame's parts without changing them ----
const installProbe = () => {
  const B = window.__board, now = () => performance.now();
  // (a long run has no input: the frame limit for a player who is away must not time it)
  setInterval(() => window.dispatchEvent(new Event('pointermove')), 5000);
  let rec = null, prev = 0;
  const add = (map, k, v) => { map[k] = (map[k] ?? 0) + v; };
  const fresh = () => ({ frames: [], cpu: {}, gpu: {}, scenes: 0, shadows: 0, drawn: 0, calls: 0, tris: 0, rebuilds: 0, long: [], programs: 0 });
  new PerformanceObserver((l) => { if (rec) for (const e of l.getEntries()) rec.long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  let poll = () => {}, flush = () => {}, lastMachine = null;
  if (B.three) {
    const r = B.renderer, gl = r.getContext(), P = B.parts(), info = r.info, ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const { post, chips, fx, lens, bakes, room, machine } = P;
    lastMachine = machine;
    info.autoReset = false;
    const time = (o, name, label) => { const f = o[name]; o[name] = function (...a) { const t = now(); try { return f.apply(this, a); } finally { if (rec) add(rec.cpu, label, now() - t); } }; };
    time(Object.getPrototypeOf(machine), 'frame', 'machine.frame');
    time(Object.getPrototypeOf(machine), 'lod', 'machine.lod');
    time(Object.getPrototypeOf(room), 'frame', 'room.frame');
    time(chips, 'frame', 'chips.frame'); time(fx, 'frame', 'fx.frame'); time(lens, 'frame', 'lens.frame'); time(bakes, 'run', 'bakes.run');
    // the GPU: one timer query after the other (they cannot nest), labelled by what runs
    let open = null;
    const pending = [];
    const mark = (label) => {
      if (!ext) return;
      if (open) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(open); open = null; }
      if (label && rec) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); open = { q, label, rec }; }
    };
    poll = () => {
      while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
        const p = pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) add(p.rec.gpu, p.label, gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(p.q);
      }
    };
    flush = () => mark(null);
    for (const pass of post.composer.passes) {
      const f = pass.render, label = pass.constructor.name.replace(/Pass$/, '');
      pass.render = function (...a) { mark(label); const t = now(); try { return f.apply(this, a); } finally { if (rec) add(rec.cpu, 'pass:' + label, now() - t); } };
    }
    const render = r.render;
    r.render = function (...a) { if (rec && a[0] === B.scene) rec.scenes++; return render.apply(this, a); };
    const sm = r.shadowMap, shadow = sm.render;
    sm.render = function (...a) {
      const lights = a[0]?.filter((l) => l.shadow.autoUpdate || l.shadow.needsUpdate).length ?? 0;
      if (!rec || !lights) return shadow.apply(this, a);
      const was = open?.label, t = now();
      mark('shadow');
      shadow.apply(this, a);
      mark(was);
      rec.shadows += lights;
      add(rec.cpu, 'shadow', now() - t);
    };
    const whole = post.render;
    post.render = function (...a) {
      const t = now();
      whole.apply(this, a);
      mark(null);
      if (rec) { add(rec.cpu, 'post.render', now() - t); rec.drawn++; rec.calls += info.render.calls; rec.tris += info.render.triangles; rec.programs = info.programs?.length ?? 0; }
      info.reset();
      poll();
    };
  }
  const tick = (t) => {
    if (rec) {
      if (prev) rec.frames.push(t - prev);
      const m = B.three ? B.parts().machine : null;
      if (m !== lastMachine) { lastMachine = m; rec.rebuilds++; }
    }
    prev = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__probe = {
    start: () => { rec = fresh(); prev = 0; },
    stop: async () => {
      const r = rec;
      flush();
      rec = null;
      for (let i = 0; i < 12; i++) { await new Promise((d) => requestAnimationFrame(d)); poll(); }
      return r;
    },
    gpuTimers: () => !!(B.three && B.renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2')),
    size: () => {
      if (!B.three) return null;
      let objects = 0, meshes = 0, instances = 0, shown = 0, casters = 0, tris = 0;
      const mats = new Set();
      const walk = (o, seen) => {
        objects++;
        const on = seen && o.visible;
        if (o.isMesh) {
          meshes++;
          const n = o.count ?? 1, g = o.geometry, t = ((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3) * n;
          if (o.isInstancedMesh) instances += n;
          if (on) { shown++; tris += t; if (o.castShadow) casters++; }
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
        }
        for (const c of o.children) walk(c, on);
      };
      walk(B.scene, true);
      const m = B.renderer.info.memory;
      return { objects, meshes, instances, shown, casters, tris: Math.round(tris), materials: mats.size, geometries: m.geometries, textures: m.textures, programs: B.renderer.info.programs?.length ?? 0 };
    },
  };
};

// ---- the CPU profile: where the main thread's time went ----
const hottest = (profile) => {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const self = new Map();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000));
  const place = (u) => (u.match(/\/(src\/.*?|deps\/[^?]*?)(\?.*)?$/)?.[1] ?? u.split('/').pop()?.split('?')[0] ?? '').replace(/^src\//, '').replace(/^deps\//, '');
  const name = (n) => { const f = n.callFrame; return `${f.functionName || '(anonymous)'} ${place(f.url)}${f.url ? ':' + (f.lineNumber + 1) : ''}`.trim(); };
  const S = new Map(), I = new Map(), bump = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
  for (const [id, ms] of self) {
    const key = name(nodes.get(id)), seen = new Set();
    bump(S, key, ms);
    for (let a = id; a !== undefined; a = parent.get(a)) { const k = name(nodes.get(a)); if (!seen.has(k)) { seen.add(k); bump(I, k, ms); } }
  }
  const skip = /^\((root|idle|program|garbage collector)\)/, list = (m) => [...m].filter(([k]) => !skip.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([k, v]) => [k, Math.round(v)]);
  return { idle: Math.round(S.get('(idle)') ?? 0), gc: Math.round(S.get('(garbage collector)') ?? 0), program: Math.round(S.get('(program)') ?? 0), self: list(S), total: list(I) };
};

const pct = (a, k) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : 0;
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const per = (m, n) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v / Math.max(1, n), 2)]).sort((a, b) => b[1] - a[1]));
const sum = (r, ms) => {
  const f = [...r.frames].sort((a, b) => a - b), mean = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length), n = r.drawn || f.length;
  return {
    ms: Math.round(ms), frames: f.length, fps: round(f.length ? 1000 / mean : 0), p50: round(pct(f, 0.5)), p95: round(pct(f, 0.95)), p99: round(pct(f, 0.99)), max: round(f[f.length - 1] ?? 0),
    over33: f.filter((x) => x > 33.4).length, over100: f.filter((x) => x > 100).length, longMs: r.long.reduce((a, b) => a + b, 0), longMax: Math.max(0, ...r.long),
    rebuilds: r.rebuilds, scenes: round(r.scenes / n, 2), shadows: round(r.shadows / n, 2), calls: Math.round(r.calls / n), ktris: Math.round(r.tris / n / 1000), programs: r.programs, cpu: per(r.cpu, n), gpu: per(r.gpu, n),
  };
};

try {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: Number(flag('dpr', 1)) })).newPage(), p = page;
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem('pipeline-city.graphics', JSON.stringify({ fps: 0 })));
  // a cold server transforms every module on the first load and may reload the page for a new dependency: warm it, then start clean
  await p.goto(url);
  await p.waitForFunction(() => !!window.__board, null, { timeout: 180000 });
  await p.waitForTimeout(2000);
  await p.goto(url);
  await p.waitForFunction(() => !!window.__board, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.click('text=Sandbox');
  await p.click('button:has-text("Start")');
  await p.waitForFunction(() => !!window.__board, null, { timeout: 30000 });
  await p.waitForTimeout(3000);
  if (!TWO) await p.waitForFunction(() => !!window.__board.parts().machine, null, { timeout: 30000 });
  await p.evaluate(installProbe);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  const gl = await p.evaluate(() => { const g = window.__board.renderer?.getContext?.() ?? document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  console.log(`GL renderer: ${gl}`);
  if (/swiftshader|llvmpipe|software/i.test(gl)) throw new Error('software GL');
  if (!TWO) console.log(`GPU timers: ${(await p.evaluate(() => window.__probe.gpuTimers())) ? 'yes' : 'no'}   ${W} x ${H}`);

  const wait = (ms) => p.waitForTimeout(ms);
  const store = (code) => p.evaluate(async (c) => { const S = await import('/src/app/store.ts'); const s = S.snapshot.value; return (0, eval)(`(S, s) => ${c}`)(S, s); }, code);
  const fly = async (v) => { await p.evaluate((v) => window.__board[v]?.(), v); };
  const at = (id) => p.evaluate((id) => window.__board.screenOf(id), id);
  const clearPointer = () => p.mouse.move(W / 2, 4);
  // sets the view and lets it settle, the art bake and the pointer rest, so a scenario starts clean
  const go = async (v, ms = 3000) => { await clearPointer(); await fly(v); await wait(ms); };
  /** The pointer on a path for `ms`, at a real mouse's rate. */
  const trace = async (ms, f) => { const t0 = Date.now(); for (let t = 0; t < ms; t = Date.now() - t0) { const { x, y } = f(t / ms); await p.mouse.move(x, y); await wait(8); } };
  const zigzag = (k) => ({ x: W * (0.15 + 0.7 * (Math.abs(((k * 3) % 2) - 1))), y: H * (0.2 + 0.6 * k) });
  const circle = (o, r) => (k) => ({ x: o.x + r * Math.cos(k * Math.PI * 4), y: o.y + r * Math.sin(k * Math.PI * 4) });

  // Each scenario: `pre` sets the stage (not measured), `run` is measured, `post` undoes it (not measured).
  const three = [
    ['room idle', { pre: () => go('flyToRoom'), run: () => wait(3500) }],
    ['board idle', { pre: () => go('flyToBoard'), run: () => wait(3500) }],
    ['cpu idle', { pre: () => go('flyToCpu'), run: () => wait(3500) }],
    ['fly room to board', { pre: () => go('flyToRoom'), run: async () => { await fly('flyToBoard'); await wait(3000); } }],
    ['fly board to cpu', { pre: () => go('flyToBoard'), run: async () => { await fly('flyToCpu'); await wait(3000); } }],
    ['fly cpu to room', { pre: () => go('flyToCpu'), run: async () => { await fly('flyToRoom'); await wait(3000); } }],
    ['door first open', { pre: () => go('flyToRoom'), run: async () => { await p.keyboard.press('o'); await wait(2500); } }],
    ['door shut', { run: async () => { await p.keyboard.press('o'); await wait(2500); } }],
    ['door open again', { run: async () => { await p.keyboard.press('o'); await wait(2500); }, post: () => p.keyboard.press('o') }],
    // the player's gesture: the pointer on the shut side panel, a click, the pointer stays there
    ['door click', { pre: async () => { await go('flyToRoom'); const c = await at('case.side'); if (c) { await p.mouse.move(c.x, c.y); await wait(500); } }, run: async () => { await p.mouse.down(); await p.mouse.up(); await wait(2500); } }],
    ['door click shut', { run: async () => { await p.mouse.down(); await p.mouse.up(); await wait(2500); }, post: () => go('flyToRoom', 1000) }],
    ['hover held', { pre: async () => { await go('flyToBoard'); const c = (await at('cable.atx')) ?? { x: W / 2, y: H / 2 }; await p.mouse.move(c.x, c.y); await wait(500); }, run: () => wait(3000) }],
    ['hover sweep', { pre: () => go('flyToBoard'), run: () => trace(4000, zigzag) }],
    ['zoom in and out', { pre: async () => { await go('flyToBoard'); await p.mouse.move(W / 2, H / 2); }, run: async () => { for (let i = 0; i < 90; i++) { await p.mouse.wheel(0, i < 45 ? -60 : 60); await wait(40); } } }],
    ['orbit', { pre: () => go('flyToRoom'), run: async () => { await p.mouse.move(W / 2, H / 2); await p.mouse.down({ button: 'right' }); await trace(3000, circle({ x: W / 2, y: H / 2 }, 240)); await p.mouse.up({ button: 'right' }); }, post: () => go('flyToRoom', 1500) }],
    ['cable pull', {
      pre: async () => { await go('flyToBoard'); },
      run: async () => {
        const c = await at('cable.atx');
        if (!c) return;
        await p.mouse.move(c.x, c.y); await p.mouse.down(); await wait(50);
        await trace(3000, circle({ x: W * 0.45, y: H * 0.5 }, 260));
        // let go away from the socket: the plug falls on its cable and comes to rest
        await p.mouse.move(60, 450, { steps: 6 }); await p.mouse.up(); await wait(3500);
      },
    }],
    ['cable plug', {
      run: async () => {
        const c = await at('cable.atx'), s = await at('atx');
        if (!c || !s) return;
        await p.mouse.move(c.x, c.y); await p.mouse.down(); await wait(50);
        await p.mouse.move(s.x, s.y, { steps: 20 }); await wait(300); await p.mouse.up(); await wait(2000);
      },
    }],
    ['part lift', {
      pre: () => go('flyToBoard'),
      run: async () => {
        const id = await store(`s.devices.find((d) => d.kind === 'storage' || d.kind === 'nvme' || d.kind === 'ram')?.id ?? null`), c = id && (await at(id));
        if (!c) return;
        await p.mouse.move(c.x, c.y); await p.mouse.down(); await wait(50);
        await trace(2500, circle({ x: c.x, y: c.y }, 120));
        await p.mouse.move(c.x, c.y, { steps: 6 }); await p.mouse.up(); await wait(1500);
      },
    }],
    ['panel open', { pre: () => go('flyToRoom'), run: async () => { await p.click('[aria-label=Menu]'); await p.click('role=menuitem[name=/Graphics/]'); await wait(2500); }, post: () => p.click('[aria-label="Close graphics"]') }],
    ['running room', { pre: async () => { await store(`(s.tray[0] && !s.plugged && S.plugKey(s.tray[0].id), !s.powered && S.powerButton(), 0)`); await go('flyToRoom', 6000); }, run: () => wait(3500) }],
    ['running board', { pre: () => go('flyToBoard'), run: () => wait(3500) }],
    ['running cpu', { pre: () => go('flyToCpu'), run: () => wait(3500) }],
  ];
  const flat = [
    ['board idle', { pre: () => go('flyToBoard'), run: () => wait(3500) }],
    ['cpu idle', { pre: () => go('flyToCpu'), run: () => wait(3500) }],
    ['fly cpu to board', { pre: () => go('flyToCpu'), run: async () => { await fly('flyToBoard'); await wait(3000); } }],
    ['fly board to cpu', { pre: () => go('flyToBoard'), run: async () => { await fly('flyToCpu'); await wait(3000); } }],
    ['hover sweep', { pre: () => go('flyToBoard'), run: () => trace(4000, zigzag) }],
    ['zoom in and out', { pre: async () => { await go('flyToBoard'); await p.mouse.move(W / 2, H / 2); }, run: async () => { for (let i = 0; i < 90; i++) { await p.mouse.wheel(0, i < 45 ? -60 : 60); await wait(40); } } }],
    ['panel open', { pre: () => go('flyToBoard'), run: async () => { await p.click('[aria-label=Menu]'); await p.click('role=menuitem[name=/Graphics/]'); await wait(2500); }, post: () => p.click('[aria-label="Close graphics"]') }],
  ];

  // a chosen preset, through the real panel; auto-adjust off, so a slow frame does not change the picture under the numbers
  await p.click('[aria-label=Menu]');
  await p.click('role=menuitem[name=/Graphics/]');
  if (flag('preset', '')) await p.click(`aside.gfx .gfx-presets >> text=${flag('preset', '')}`);
  if (!TWO) await p.click('aside.gfx [aria-label=Auto-adjust] >> text=Off');
  await p.click('[aria-label="Close graphics"]');
  await wait(800);

  const report = { when: new Date().toISOString(), renderer: TWO ? '2d' : '3d', gl, size: `${W}x${H}`, preset: flag('preset', 'default'), scene: {}, scenarios: {} };
  const head = 'scenario'.padEnd(20) + 'FPS'.padStart(7) + 'p50'.padStart(7) + 'p95'.padStart(7) + 'p99'.padStart(7) + 'max'.padStart(7) + '>33'.padStart(5) + '>100'.padStart(5) + 'long'.padStart(7) + 'rb'.padStart(3) + 'scn'.padStart(5) + 'shd'.padStart(5) + 'calls'.padStart(7) + 'ktri'.padStart(7) + 'cpu'.padStart(7) + 'gpu'.padStart(7);
  console.log(head);
  for (const [name, s] of TWO ? flat : three) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    await s.pre?.();
    if (!has('no-profile')) await cdp.send('Profiler.start');
    await p.evaluate(() => window.__probe.start());
    const t0 = Date.now();
    await s.run();
    const ms = Date.now() - t0, raw = await p.evaluate(() => window.__probe.stop());
    const profile = has('no-profile') ? null : (await cdp.send('Profiler.stop')).profile;
    const r = sum(raw, ms);
    if (profile) r.profile = hottest(profile);
    report.scenarios[name] = r;
    const gpu = Object.values(r.gpu).reduce((a, b) => a + b, 0);
    console.log(name.padEnd(20) + String(r.fps).padStart(7) + String(r.p50).padStart(7) + String(r.p95).padStart(7) + String(r.p99).padStart(7) + String(Math.round(r.max)).padStart(7) + String(r.over33).padStart(5) + String(r.over100).padStart(5) + String(r.longMs).padStart(7) + String(r.rebuilds).padStart(3) + String(r.scenes).padStart(5) + String(r.shadows).padStart(5) + String(r.calls).padStart(7) + String(r.ktris).padStart(7) + String(round(r.cpu['post.render'] ?? 0)).padStart(7) + String(round(gpu)).padStart(7));
    if (r.profile && TOP) for (const [k, v] of r.profile.total.filter(([k]) => !/^(frame|anonymous|\(anonymous\)|render|tick|f|run|e|i) /.test(k)).slice(0, TOP)) console.log(`      ${String(v).padStart(6)} ms  ${k}`);
    await s.post?.();
    await p.keyboard.press('Escape').catch(() => {});
  }
  if (!TWO) { await go('flyToBoard'); report.scene.board = await p.evaluate(() => window.__probe.size()); await go('flyToRoom'); report.scene.room = await p.evaluate(() => window.__probe.size()); console.log('scene', JSON.stringify(report.scene)); }
  if (errors.length) console.log('page errors:', errors.slice(0, 4).join(' | '));
  report.errors = errors;
  if (out) { writeFileSync(resolve(out), JSON.stringify(report, null, 1)); console.log('saved', resolve(out)); }
  const base = flag('baseline', '');
  if (base && existsSync(base)) {
    const old = JSON.parse(readFileSync(base, 'utf8')).scenarios;
    console.log('\nagainst ' + base + '\n' + 'scenario'.padEnd(20) + 'FPS'.padStart(16) + 'p99'.padStart(16) + 'max'.padStart(16));
    const cell = (a, b) => `${a} > ${b}`.padStart(16);
    for (const [k, r] of Object.entries(report.scenarios)) { const o = old[k]; if (o) console.log(k.padEnd(20) + cell(o.fps, r.fps) + cell(o.p99, r.p99) + cell(Math.round(o.max), Math.round(r.max))); }
  }
} finally {
  await stop();
}
process.exit();
