// `npm run stills`: the shop's part pictures as 3D stills. It opens the game's page in a headless Chrome on the real GPU (the dev server),
// builds each part the gallery shows (`galleryGroups`, `buildShowcaseModel`), renders it in the showcase's studio on a clear ground
// (`renderStill`, core/render/three/viewer.ts) and writes `public/stills/`: `<id>.webp` and `manifest.json` (the size, each id's hash).
// `thumbOf` (board/render/thumbs.ts) serves them; the ids without a still (an OS, a router, a plan) keep their drawn art.
// Bake again after a change to a part's model: the tiles do not follow the code on their own (`stills.test.ts` checks the list only).
//   --only a,b    render only these ids again; the others' files stay
//   --size WxH    the pictures' size (480x336: a tile's 120 x 84 at 4x)
//   env: PORT (5199), CHROME_PATH, SOFTWARE=1 (allow software GL)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ONLY = flag('only', '').split(',').filter(Boolean);
const [W, H] = flag('size', '480x336').split('x').map(Number);
const QUALITY = 0.9;
const root = fileURLToPath(new URL('..', import.meta.url)), out = join(root, 'public/stills');
const PORT = Number(process.env.PORT || 5199), url = `http://localhost:${PORT}/`;
const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: root });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const stop = () => { try { server?.kill(); } catch { /* gone */ } };
process.on('exit', stop);

const old = existsSync(join(out, 'manifest.json')) ? JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) : null;
const keep = ONLY.length && old && old.w === W && old.h === H ? old.stills : {};
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: process.env.SOFTWARE ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
try {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  p.on('pageerror', (e) => console.log('[page]', e.message));
  // (the menu's page: its fonts are the ones the parts' labels draw with; a fresh server first optimizes its dependencies)
  await p.goto(url);
  await p.waitForSelector('text=Sandbox', { timeout: 120000 });
  const gl = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
  console.log('GL renderer:', gl);
  if (/swiftshader|llvmpipe|software/i.test(gl) && !process.env.SOFTWARE) { console.log('The browser fell back to software GL: stopping (SOFTWARE=1 to allow it).'); process.exitCode = 2; throw new Error('software GL'); }
  const ids = await p.evaluate(async () => {
    const [{ galleryGroups }, { buildShowcaseModel }, { renderStill }, { startBaker, bakeRenderer }] = await Promise.all([
      import('/src/features/economy/ui/shop/shopdata.ts'), import('/src/features/board/render/three/showcase.ts'),
      import('/src/core/render/three/viewer.ts'), import('/src/features/board/render/three/bake.ts'),
    ]);
    await document.fonts.ready;
    // the parts' 2D art (the labels, the die, the PCB) is drawn by the bake's Pixi renderer
    startBaker();
    for (let i = 0; i < 200 && !bakeRenderer(); i++) await new Promise((r) => setTimeout(r, 50));
    window.__still = async (id, w, h, q) => {
      const o = buildShowcaseModel(id);
      return o ? (await renderStill(o, w, h)).toDataURL('image/webp', q) : null;
    };
    return galleryGroups().flatMap((g) => g.items.map((i) => i.id));
  });
  const todo = ONLY.length ? ids.filter((id) => ONLY.includes(id)) : ids;
  const unknown = ONLY.filter((id) => !ids.includes(id));
  if (unknown.length) console.log('not in the gallery:', unknown.join(' '));
  mkdirSync(out, { recursive: true });
  const stills = { ...keep };
  let bytes = 0;
  for (const id of todo) {
    const t = Date.now(), data = await p.evaluate(([id, w, h, q]) => window.__still(id, w, h, q), [id, W, H, QUALITY]);
    if (!data?.startsWith('data:image/webp')) { console.log(`${id}: no still`); delete stills[id]; continue; }
    const buf = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
    writeFileSync(join(out, `${id}.webp`), buf);
    stills[id] = createHash('sha1').update(buf).digest('hex').slice(0, 8);
    bytes += buf.length;
    console.log(`${id}: ${(buf.length / 1024).toFixed(0)} KB, ${Date.now() - t} ms`);
  }
  // the parts the gallery no longer has: their files go
  for (const id of Object.keys(stills)) if (!ids.includes(id)) delete stills[id];
  for (const f of readdirSync(out)) if (f.endsWith('.webp') && !stills[f.slice(0, -5)]) rmSync(join(out, f));
  const sorted = Object.fromEntries(Object.keys(stills).sort().map((k) => [k, stills[k]]));
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ w: W, h: H, stills: sorted }, null, 1) + '\n');
  console.log(`${todo.length} stills, ${(bytes / 1024 / 1024).toFixed(2)} MB written; ${Object.keys(sorted).length} in the manifest`);
} finally {
  await browser.close();
  stop();
}
