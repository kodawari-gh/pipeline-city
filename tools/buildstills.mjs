// `npm run buildstills`: the pictures of the Start list in Build my PC (Budget, Gaming, Workstation, Full rig; Empty puts nothing on the stage, so it has none).
// It opens Build my PC in a headless Chrome on the real GPU (the dev server), plays each start on the real stage and takes `BuildStage.capture` (the whole
// case from the stage's start view, its side panel off) into `public/stills/builds/`: `<key>.webp` and `manifest.json` (the size, each picture's hash and
// the recipe it was taken from, `recipeOf`).
// `buildstills.test.ts` fails when a recipe has changed since (a preset's parts, a tier, the catalogue): bake again. A change to a part's model is not seen by it.
//   --only a,b    take only these keys again; the others stay
//   --size WxH    the pictures' size (default 320x240, the 4:3 of a row's thumbnail, drawn at about 4x)
//   --view WxH    the browser window (default 1600x900, drawn at 2x)
//   --out dir     write there instead of public/stills/builds (to look at them first)
//   env: PORT (5199), CHROME_PATH, SOFTWARE=1 (allow software GL)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  return i < 0 ? d : args[i + 1];
};
const ONLY = flag('only', '').split(',').filter(Boolean);
const [W, H] = flag('size', '320x240').split('x').map(Number);
const [VW, VH] = flag('view', '1600x900').split('x').map(Number);
const QUALITY = 0.88;
const root = fileURLToPath(new URL('..', import.meta.url)),
  out = flag('out', null) ? resolve(flag('out', '')) : join(root, 'public/stills/builds');
const PORT = Number(process.env.PORT || 5199),
  url = `http://localhost:${PORT}/`;
const up = async () => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    cwd: root,
  });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
const stop = () => {
  try {
    server?.kill();
  } catch {
    /* gone */
  }
};
process.on('exit', stop);

const old = existsSync(join(out, 'manifest.json'))
  ? JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
  : null;
const same = !!old && old.w === W && old.h === H;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  args: process.env.SOFTWARE
    ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']
    : ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
try {
  const p = await (await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 })).newPage();
  p.on('pageerror', (e) => console.log('[page]', e.message));
  await p.goto(url);
  await p.waitForSelector('text=Build my PC', { timeout: 120000 });
  const gl = await p.evaluate(() => {
    const g = document.createElement('canvas').getContext('webgl2');
    const e = g?.getExtension('WEBGL_debug_renderer_info');
    return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('GL renderer:', gl);
  if (/swiftshader|llvmpipe|software/i.test(gl) && !process.env.SOFTWARE) {
    console.log('The browser fell back to software GL: stopping (SOFTWARE=1 to allow it).');
    process.exitCode = 2;
    throw new Error('software GL');
  }
  await p.click('text=Build my PC');
  await p.waitForSelector('.bld-foot', { timeout: 120000 });
  // (the stage's first picture: its programs link, the parts' art comes in)
  await p.waitForTimeout(4000);
  const keys = await p.evaluate(
    async ([w, h, q]) => {
      if (!window.__build) throw new Error('window.__build is only there on the dev server');
      const [{ PICTURE_KEYS, presetKey, recipeOf }, { BUILD_PRESETS }] = await Promise.all([
        import('/src/features/board/sim/buildpreset.ts'),
        import('/src/features/board/sim/buildspecs.ts'),
      ]);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__start = async (key) => {
        const s = window.__build;
        s.speed.value = 4;
        if (key === 'full') await s.reset();
        else await s.buildPreset(BUILD_PRESETS.find((x) => presetKey(x) === key));
        for (let i = 0; i < 400 && s.status.value.busy; i++) await wait(50);
        // (the machine's art and the eye's exposure settle)
        await wait(2500);
        return {
          data: await s.capture(w, h, { type: 'image/webp', quality: Number(q) }),
          recipe: recipeOf(s.game, s.shown.value),
        };
      };
      return PICTURE_KEYS;
    },
    [W, H, QUALITY],
  );
  const todo = ONLY.length ? keys.filter((k) => ONLY.includes(k)) : keys;
  const unknown = ONLY.filter((k) => !keys.includes(k));
  if (unknown.length) console.log('not a start:', unknown.join(' '), '(the keys are', keys.join(' ') + ')');
  mkdirSync(out, { recursive: true });
  const stills = { ...(same && ONLY.length ? old.stills : {}) },
    recipes = { ...(same && ONLY.length ? old.recipes : {}) };
  let bytes = 0;
  for (const key of todo) {
    const t = Date.now(),
      r = await p.evaluate((k) => window.__start(k), key);
    if (!r.data?.startsWith('data:image/webp')) {
      console.log(`${key}: no picture`);
      delete stills[key];
      delete recipes[key];
      continue;
    }
    const buf = Buffer.from(r.data.slice(r.data.indexOf(',') + 1), 'base64');
    writeFileSync(join(out, `${key}.webp`), buf);
    stills[key] = createHash('sha1').update(buf).digest('hex').slice(0, 8);
    recipes[key] = r.recipe;
    bytes += buf.length;
    console.log(`${key}: ${(buf.length / 1024).toFixed(0)} KB, recipe ${r.recipe}, ${Date.now() - t} ms`);
  }
  // the starts that are gone: their files go
  for (const k of Object.keys(stills))
    if (!keys.includes(k)) {
      delete stills[k];
      delete recipes[k];
    }
  for (const f of readdirSync(out)) if (f.endsWith('.webp') && !stills[f.slice(0, -5)]) rmSync(join(out, f));
  const sort = (o) =>
    Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]]),
    );
  writeFileSync(
    join(out, 'manifest.json'),
    JSON.stringify({ w: W, h: H, stills: sort(stills), recipes: sort(recipes) }, null, 1) + '\n',
  );
  console.log(`${todo.length} pictures, ${(bytes / 1024).toFixed(0)} KB written to ${out}`);
} finally {
  await browser.close();
  stop();
}
