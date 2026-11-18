// `npm run bench:boot [-- --runs 1 --cpu 1 --size 1600x900 --enc gzip --dist <dir> --no-prewarm --json out.json]`: the boot of the optimized game as a visitor meets it, in numbers
// (docs/render/load.md "Boot, 2026-11-18"; BOOT-06). It builds the game into a temp folder (`--dist` uses a build you made: `vite build --outDir <dir>`), serves it as a real host
// does (gzip or brotli, an ETag, a 10 minute cache) and loads it twice in a headless Chrome on the real GPU (ANGLE/D3D11; it stops on SwiftShader, as tools/shot.mjs does):
// in a fresh profile (cold: nothing cached) and again in the same profile (warm: the HTTP cache and Chrome's shader cache). It prints the table of the doc, the time of each stage,
// and the lists behind the numbers: the programs linked at or after the first draw with their defines, the driver calls that waited, the main-thread tasks over 100 ms.
//   --runs n       n fresh profiles, each loaded cold and then warm; a cell shows the middle run and [the lowest to the highest]
//   --cpu n        Chrome's CPU throttle (4 is a slow laptop); the page gets 400 s to boot, not 150 s
//   --enc e        gzip (default), br or none: how the host squeezes text
//   --no-prewarm   do not start Chrome's GPU process before the cold load. A visitor's browser has one; starting it is the first long task of a cold run (about 1.1 s)
//   --json file    keep the raw captures
//   env: CHROME_PATH (default: the installed Chrome), SOFTWARE=1 (allow software GL: the times then mean nothing)
// The exit code is 1 when a visit is no measurement (the boot failed or did not end, or a stage the table reads was renamed): see `problems` in tools/bench-boot-report.mjs.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { describeVisit, lists, problems, SLOW_MS, stageTable, table } from './bench-boot-report.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const o = { runs: Number(flag('runs', 1)), cpu: Number(flag('cpu', 1)), enc: flag('enc', 'gzip'), size: flag('size', '1600x900'), prewarm: !args.includes('--no-prewarm') };
const [W, H] = o.size.split('x').map(Number);
if (!(o.runs >= 1) || !(o.cpu >= 1) || !['gzip', 'br', 'none'].includes(o.enc) || !(W > 0 && H > 0)) { console.log('Bad option: see the head of tools/bench-boot.mjs.'); process.exit(1); }

// ---- the host ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary' };
const SQUEEZE = new Set(['.html', '.js', '.css', '.json', '.wasm', '.svg', '.bin']);

function listFiles(dir, base = dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) listFiles(p, base, out);
    else out.push(p.slice(base.length + 1).split(sep).join('/'));
  }
  return out;
}

/** A static host as a real one behaves: text squeezed, an ETag, and a 10 minute cache (GitHub Pages' default). `vite preview` sends text as it is, which is not what a visitor gets. */
function serve(dir, enc) {
  const files = new Map();
  for (const rel of listFiles(dir)) {
    const raw = readFileSync(join(dir, rel)), ext = extname(rel), squeeze = enc !== 'none' && SQUEEZE.has(ext);
    const body = !squeeze ? raw : enc === 'br' ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }) : gzipSync(raw, { level: 9 });
    files.set('/' + rel, { body, squeeze, type: MIME[ext] ?? 'application/octet-stream', etag: `"${createHash('md5').update(raw).digest('hex').slice(0, 16)}"` });
  }
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]), f = files.get(path === '/' ? '/index.html' : path);
    if (!f) { res.writeHead(404); res.end('not found'); return; }
    const head = { 'Content-Type': f.type, 'Cache-Control': 'public, max-age=600', ETag: f.etag, ...(f.squeeze ? { 'Content-Encoding': enc } : {}) };
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, head); res.end(); return; }
    res.writeHead(200, { ...head, 'Content-Length': f.body.length });
    res.end(f.body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}/`, close: () => { server.closeAllConnections?.(); server.close(); } })));
}

async function build(out) {
  console.log('Building the game (vite build) ...');
  const b = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', out, '--emptyOutDir'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  b.stdout.on('data', (c) => { log += c; });
  b.stderr.on('data', (c) => { log += c; });
  if (await new Promise((done) => b.on('exit', done))) { console.log(log.slice(-4000)); console.log('The build failed.'); process.exit(1); }
}

// ---- the page ----
/**
 * Runs in the page before its own scripts: the clock for each event of the table. Times are ms of `performance.now()`, which starts with the page.
 * It reads the boot screen's stage (src/app/boot.ts), the classes of `#boot`, the browser's long tasks and paints, and the WebGL calls that link a program.
 */
function probe({ slowMs }) {
  const B = (window.__boot = { marks: {}, stages: [], long: [], slow: [], sources: [] });
  const tenth = (x) => Math.round(x * 10) / 10, now = () => tenth(performance.now());
  const mark = (k, t = now()) => { if (!(k in B.marks)) B.marks[k] = t; };
  // `bootStage` says the stage with one `textContent` write on `.boot-stage`: catch it there, when it happens (a watcher of the DOM reports it when the task that wrote it ends)
  const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  Object.defineProperty(Node.prototype, 'textContent', { ...text, set(v) { if (this.classList?.contains('boot-stage')) B.stages.push([now(), String(v)]); text.set.call(this, v); } });
  const seen = [];
  const watch = (type, each) => { try { const w = new PerformanceObserver((l) => l.getEntries().forEach(each)); w.observe({ type, buffered: true }); seen.push([w, each]); } catch { /* an old browser: the table shows - */ } };
  watch('paint', (e) => { if (e.name === 'first-paint') mark('firstPaint', tenth(e.startTime)); });
  watch('longtask', (e) => { B.long.push([tenth(e.startTime), Math.round(e.duration)]); });
  const look = () => {
    const boot = document.getElementById('boot');
    if (boot?.classList.contains('menu')) mark('bootMenu');
    if (boot?.classList.contains('fail')) mark('bootFail');
    if (boot?.classList.contains('done')) mark('bootDone');
    if (document.querySelector('nav.mainmenu')) mark('menuMounted');
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const P = C.prototype, shaderSource = P.shaderSource, attachShader = P.attachShader, linkProgram = P.linkProgram, getProgramInfoLog = P.getProgramInfoLog;
    P.shaderSource = function (s, src) { s.__src = src; return shaderSource.call(this, s, src); };
    P.attachShader = function (p, s) { (p.__sh ??= []).push(s); return attachShader.call(this, p, s); };
    // (the fragment shader holds the program's defines: Three writes them at the head of both; the other is read at the end of the run, not here)
    P.linkProgram = function (p) { B.sources.push([now(), (p.__sh ?? []).map((s) => s.__src ?? '').find((s) => /pc_fragColor|gl_FragColor/.test(s)) ?? '']); return linkProgram.call(this, p); };
    // with parallel compile a call that waits is the program not done yet
    P.getProgramInfoLog = function (p) { const t = performance.now(), r = getProgramInfoLog.call(this, p), d = performance.now() - t; if (d > slowMs) B.slow.push([tenth(t), tenth(d)]); return r; };
  }
  const KEEP = /^(TONE_MAPPING|USE_SHADOWMAP|SHADOWMAP_TYPE_\w+|NUM_\w+_LIGHTS|USE_ENVMAP|USE_MAP|USE_ALPHAMAP|USE_LIGHTMAP|USE_AOMAP|USE_NORMALMAP|USE_ROUGHNESSMAP|USE_METALNESSMAP|USE_EMISSIVEMAP|USE_INSTANCING|USE_COLOR|USE_BATCHING|USE_SKINNING|USE_TRANSMISSION|USE_CLEARCOAT|USE_SHEEN|USE_FOG|USE_ALPHATEST|OPAQUE|DOUBLE_SIDED|FLIP_SIDED|DEPTH_PACKING|DITHERING)$/;
  /** What the run saw, as tools/bench-boot-report.mjs reads it. */
  B.collect = () => {
    for (const [w, each] of seen) w.takeRecords().forEach(each);
    const links = B.sources.map(([t, frag]) => {
      const type = /^#define SHADER_TYPE (\S+)/m.exec(frag)?.[1] ?? '', name = /^#define SHADER_NAME (\S+)/m.exec(frag)?.[1] ?? '';
      const defs = [...frag.matchAll(/^#define (\w+)(?: (\S+))?/gm)].filter((m) => KEEP.test(m[1])).map((m) => (m[2] ? `${m[1]}=${m[2]}` : m[1]));
      return [t, name && name !== type ? `${type} ${name}`.trim() : type || '?', defs.join(' ')];
    });
    return { marks: B.marks, stages: B.stages, long: B.long, slow: B.slow, links };
  };
}

/** One load of the page in `ctx`: the capture, once the boot screen is done (or has failed, or the limit has passed). */
async function visit(ctx, url) {
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (o.cpu > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: o.cpu });
  await page.addInitScript(probe, { slowMs: SLOW_MS });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => { const m = window.__boot?.marks; return !!m && ('bootDone' in m || 'bootFail' in m); }, null, { timeout: o.cpu > 1 ? 400000 : 150000, polling: 100 }).catch(() => {});
  // (what follows the end of the boot: a program linked at the first draw of a late model, a task of the first frames)
  await page.waitForTimeout(1500);
  const raw = await page.evaluate(() => window.__boot.collect());
  await page.close();
  return { raw, errors };
}

// ---- the run ----
const work = mkdtempSync(join(tmpdir(), 'bench-boot-'));
const cold = [], warm = [], kept = [], notes = [];
let renderer = '', code = 0, host = null;
try {
  const dist = flag('dist', '') ? resolve(flag('dist', '')) : join(work, 'dist');
  if (!flag('dist', '')) await build(dist);
  host = await serve(dist, o.enc);
  for (let run = 1; run <= o.runs; run++) {
    const ctx = await chromium.launchPersistentContext(mkdtempSync(join(work, 'profile-')), {
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      args: process.env.SOFTWARE ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
      viewport: { width: W, height: H },
    });
    try {
      // the first page of the profile starts the browser's GPU process and holds a context, so the process stays up for both loads
      const gl = ctx.pages()[0] ?? (await ctx.newPage());
      renderer = await gl.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); window.__gl = g; const e = g?.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
      if (/swiftshader|llvmpipe|software/i.test(renderer) && !process.env.SOFTWARE) { console.log(`The browser fell back to software GL (${renderer}): stopping (SOFTWARE=1 to allow it).`); code = 2; break; }
      if (o.prewarm) await gl.waitForTimeout(2500);
      const first = await visit(ctx, host.url), second = await visit(ctx, host.url);
      for (const [kind, v, list] of [['cold', first, cold], ['warm', second, warm]]) {
        const d = describeVisit(v.raw);
        list.push(d);
        for (const p of problems(d)) notes.push(`run ${run}, ${kind}: ${p}`);
        if (v.errors.length) notes.push(`run ${run}, ${kind}: page errors: ${v.errors.slice(0, 3).join(' | ')}`);
      }
      kept.push({ cold: first.raw, warm: second.raw });
    } finally {
      await ctx.close();
    }
    console.log(`Run ${run} of ${o.runs} done.`);
  }
} finally {
  host?.close();
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* Chrome still holds its profile: the system clears the temp folder */ }
}

if (!code && cold.length) {
  console.log(`\nBoot of the optimized build: ${o.enc}, Chrome on ${renderer}, ${o.size}, CPU x${o.cpu}, ${o.runs} run${o.runs > 1 ? 's' : ''}${o.prewarm ? ', the GPU process up before the cold load' : ''}.\n`);
  console.log(table(cold, warm));
  console.log(`\nStages: the time each was first shown, and how long it lasted.\n\n${stageTable(cold, warm)}`);
  console.log(`\n${lists('Cold', cold)}\n\n${lists('Warm', warm)}`);
  if (notes.length) { console.log(`\nNot a measurement, or a warning:\n${notes.map((n) => `  ${n}`).join('\n')}`); code = notes.some((n) => !/page errors/.test(n)) ? 1 : code; }
  if (flag('json', '')) writeFileSync(resolve(flag('json', '')), JSON.stringify({ options: o, renderer, runs: kept }, null, 1));
}
await new Promise((done) => process.stdout.write('', done));
process.exit(code);
