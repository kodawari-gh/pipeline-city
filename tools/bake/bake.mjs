// `npm run bake`: the room's light bake (`src/features/room/light.md`, "Offline bakes"; T179). It opens the game in a headless Chrome (the
// dev server), exports the room (`scene.ts`), cuts the receivers' lightmap UVs (`atlas.ts`), has Blender's Cycles bake each light group's
// indirect light (`bake.py`) and writes `public/bake/room/`: a lightmap for each group (`<group>.png`, RGBM: `rgbm.ts`), the receivers' UVs
// (`meshes.bin`: two Uint16 a corner, 0 to 65535 over the atlas, v up) and `manifest.json` (the groups, their scales, the meshes by hash).
//   --samples n   Cycles' samples a texel (16384: the dim groups need them; about a minute a group on an RTX 5080)
//   --texels n    texels a metre (50: 2 cm)
//   --only a,b    bake again only these groups, on the last bake's room and atlas (the work dir); the others' files stay
//   --fast        64 samples and no denoiser: to try the tool
//   --preview     also render each group's lightmap on the room (`preview-<group>.png` in the work dir): look at it
//   --pack        no Blender: write the lightmap files again from the last bake's light (the work dir), for a change to their format
//   env: BLENDER (default: Steam's Blender 5.2), PORT (5199), CHROME_PATH
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { runnerImport } from 'vite';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const FAST = args.includes('--fast'), SAMPLES = Number(flag('samples', FAST ? 64 : 16384)), TEXELS = Number(flag('texels', 50)), PADDING = 4;
const ONLY = flag('only', '').split(',').filter(Boolean), PACK = args.includes('--pack');
const BLENDER = process.env.BLENDER || 'C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe';
const root = fileURLToPath(new URL('../..', import.meta.url)), out = join(root, 'public/bake/room'), work = join(tmpdir(), 'pipeline-city-bake');
const config = { configFile: false, logLevel: 'warn', resolve: { alias: { '@': join(root, 'src') } } };
const { module: atlasLib } = await runnerImport(join(root, 'tools/bake/atlas.ts'), config);
const { module: rgbm } = await runnerImport(join(root, 'tools/bake/rgbm.ts'), config);
if (!PACK && !existsSync(BLENDER)) { console.log(`no Blender at ${BLENDER} (set BLENDER)`); process.exit(1); }
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });
const t0 = Date.now(), secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;

/** The room as the game builds it, from the dev server's page. */
async function exportScene() {
  const PORT = Number(process.env.PORT || 5199), url = `http://localhost:${PORT}/`;
  const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
  let server = null;
  if (!(await up())) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: root });
    for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
  }
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  });
  try {
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    p.on('pageerror', (e) => console.log('[page]', e.message));
    await p.goto(url + '?3d');
    // a fresh server first optimizes its dependencies: the menu can take a while
    await p.click('text=Sandbox', { timeout: 120000 });
    await p.click('button:has-text("Start")');
    await p.waitForFunction(() => !!window.__board, null, { timeout: 30000 });
    // the loaded models (the mouse, the hoodie) block light too: wait for them
    await p.waitForFunction(() => { const r = window.__board.parts().room?.root; return !!r?.getObjectByName('mouse_1') && !!r.getObjectByName('hoodie_1'); }, null, { timeout: 60000 })
      .catch(() => console.log('the models did not load: the bake goes on without them'));
    await p.waitForTimeout(1000);
    return await p.evaluate(async () => {
      const { exportRoom } = await import('/tools/bake/scene.ts');
      const parts = window.__board.parts();
      return exportRoom(parts.room, [parts.machine.root]);
    });
  } finally {
    await browser.close();
    try { server?.kill(); } catch { /* gone */ }
  }
}

/** Write the room for Blender: `scene.json` and the arrays it points into, `scene.bin`. */
function writeWork(scene, atlas, receivers) {
  const parts = [];
  let size = 0;
  const put = (a) => { if (!a) return -1; const off = size; parts.push(a); size += a.byteLength; return off; };
  const b64 = (s, T) => { if (!s) return null; const b = Buffer.from(s, 'base64'); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const meshes = scene.meshes.map((m) => {
    const pos = b64(m.pos, Float32Array), index = b64(m.index, Uint32Array), k = receivers.indexOf(m), a = k >= 0 ? atlas.meshes[k] : null;
    return {
      name: m.name, receiver: k >= 0, colour: m.colour, roughness: m.roughness, metalness: m.metalness, verts: pos.length / 3, corners: index ? index.length : pos.length / 3,
      pos: put(pos), nrm: put(b64(m.nrm, Float32Array)), index: put(index), uv: put(a?.uv), chart: put(a?.chart),
    };
  });
  const groups = [
    ...scene.groups.map((g) => ({ id: g.id, kind: 'lamp', lights: g.lights })),
    { id: 'sky', kind: 'sky' }, { id: 'city', kind: 'city' },
    ...scene.suns.map((s) => ({ id: `sun-${s.hour}`, kind: 'sun', hour: s.hour, dir: s.dir })),
  ];
  writeFileSync(join(work, 'scene.bin'), Buffer.concat(parts.map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength))));
  writeFileSync(join(work, 'scene.json'), JSON.stringify({ samples: SAMPLES, denoise: !FAST, padding: PADDING, width: atlas.width, height: atlas.height, meshes, groups }));
  return groups;
}

/** Run Blender on the work dir; its whole log goes to `blender.log` there, the bake's own lines to the console. */
function blender(only) {
  const log = createWriteStream(join(work, 'blender.log'));
  const b = spawn(BLENDER, ['-b', '--factory-startup', '--python-exit-code', '1', '-P', join(root, 'tools/bake/bake.py'), '--', work, ...only]);
  let tail = '';
  const line = (d) => {
    log.write(d);
    tail = (tail + d).slice(-4000);
    for (const l of d.toString().split(/\r?\n/)) if (l.startsWith('[bake]') || /Error|Traceback/.test(l)) console.log(l);
  };
  b.stdout.on('data', line);
  b.stderr.on('data', line);
  return new Promise((done, fail) => b.on('exit', (code) => (code ? fail(new Error(`Blender stopped (${code}):\n${tail}`)) : done())));
}

let manifest, groups;
if (ONLY.length || PACK) {
  if (!existsSync(join(work, 'scene.json')) || !existsSync(join(out, 'manifest.json'))) { console.log(`--${PACK ? 'pack' : 'only'} needs a full bake first`); process.exit(1); }
  const cfg = JSON.parse(readFileSync(join(work, 'scene.json'), 'utf8'));
  manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  groups = cfg.groups.filter((g) => !ONLY.length || ONLY.includes(g.id));
  if (ONLY.length && groups.length !== ONLY.length) { console.log(`no such group in the last bake: ${ONLY.filter((id) => !groups.some((g) => g.id === id))}`); process.exit(1); }
  if (!PACK && (cfg.samples !== SAMPLES || cfg.denoise === FAST)) { cfg.samples = SAMPLES; cfg.denoise = !FAST; writeFileSync(join(work, 'scene.json'), JSON.stringify(cfg)); }
} else {
  const scene = await exportScene();
  const receivers = scene.meshes.filter((m) => m.receiver);
  console.log(`room: ${scene.meshes.length} meshes, ${receivers.length} receivers (${secs()})`);
  const decode = (s, T) => { if (!s) return null; const b = Buffer.from(s, 'base64'); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const atlas = await atlasLib.buildAtlas(receivers.map((m) => ({ pos: decode(m.pos, Float32Array), index: decode(m.index, Uint32Array) })), TEXELS, PADDING);
  console.log(`atlas: ${atlas.width} x ${atlas.height}, ${(atlas.utilization * 100).toFixed(0)}% used (${secs()})`);
  groups = writeWork(scene, atlas, receivers);
  // the receivers' UVs, for the game: a corner's UV as two Uint16 (0 to 65535 over the atlas)
  const total = atlas.meshes.reduce((n, m) => n + m.uv.length, 0), uv = new Uint16Array(total);
  let off = 0;
  const meshes = receivers.map((m, k) => {
    const a = atlas.meshes[k].uv, entry = { name: m.name, hash: m.hash, corners: a.length / 2, offset: off / 2 };
    for (let i = 0; i < a.length; i++) uv[off + i] = Math.round(Math.min(1, Math.max(0, a[i])) * 65535);
    off += a.length;
    return entry;
  });
  writeFileSync(join(out, 'meshes.bin'), uv);
  manifest = {
    version: 1, encoding: 'rgbm-sqrt', width: atlas.width, height: atlas.height, texelsPerMetre: TEXELS, samples: SAMPLES,
    groups: [], dark: scene.sunHours.filter((h) => !scene.suns.some((s) => s.hour === h)).map((h) => `sun-${h}`), meshes,
  };
}

if (!PACK) await blender([...ONLY, ...(args.includes('--preview') ? ['--preview'] : [])]);
if (args.includes('--preview')) console.log(`previews: ${work}`);
const uvBytes = readFileSync(join(out, 'meshes.bin')), keep = atlasLib.chartTexels(new Uint16Array(uvBytes.buffer.slice(uvBytes.byteOffset, uvBytes.byteOffset + uvBytes.byteLength)), manifest.width, manifest.height, PADDING / 2);
for (const g of groups) {
  const f = readFileSync(join(work, `${g.id}.f32`)), rgb = new Float32Array(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
  const scale = rgbm.scaleOf(rgb), file = rgbm.png(rgbm.encode({ width: manifest.width, height: manifest.height, rgb, scale }, keep), manifest.width, manifest.height);
  writeFileSync(join(out, `${g.id}.png`), file);
  const entry = { id: g.id, kind: g.kind, file: `${g.id}.png`, scale, ...(g.kind === 'lamp' ? { lead: g.lights[0].intensity } : {}), ...(g.kind === 'sun' ? { hour: g.hour } : {}) };
  const k = manifest.groups.findIndex((e) => e.id === g.id);
  if (k < 0) manifest.groups.push(entry); else manifest.groups[k] = entry;
  console.log(`${g.id}.png: ${(file.length / 1024).toFixed(0)} KB, scale ${scale.toPrecision(3)}`);
}
if (!PACK) manifest.samples = SAMPLES;
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`wrote ${resolve(out)} (${secs()})`);
