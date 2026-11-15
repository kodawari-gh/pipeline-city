// `npm run bake:tex`: bake the painted maps that never change to KTX2 in `public/tex/` (docs/render/three.md "Textures"; `baked.ts` loads
// them). A headless page of the dev server runs the game's own painters (with `?nobaked`, so each paints its canvas), this script reads the
// pixels and encodes them with the Basis encoder (`ktx2-encoder`, wasm: no system tool). The painters are seeded, so a rerun gives the same
// files. Each map is flipped in y: a compressed texture cannot flip at upload as a canvas does.
//   colour  ETC1S, mips (small file; BC7 on a desktop GPU, ETC2 on a phone: at most one byte a texel)
//   normal  UASTC with zstd, mips (BC7 or ASTC, one byte a texel)
//   env: PORT (5199), CHROME_PATH
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeToKTX2 } from 'ktx2-encoder';
import { chromium } from 'playwright-core';

/**
 * The set. `from`: the module and the call that give the texture (a `Surface` gives `map` and `normal`). `srgb`: the file says sRGB, so the
 * GPU decodes it (a map with `SRGBColorSpace`); the city's colour maps stay raw (their material decodes them, `DECODE_SRGB`).
 */
const SET = [
  { key: 'part-brushed', mod: '/src/features/board/render/three/casekit3d.ts', call: 'brushed', kind: 'colour', srgb: true },
  { key: 'part-grain', mod: '/src/features/board/render/three/casekit3d.ts', call: 'grain', kind: 'colour', srgb: true },
  { key: 'cooler-brushed', mod: '/src/features/board/render/three/cooler3d.ts', call: 'capBrushed', kind: 'colour', srgb: true },
  ...['stucco', 'paving', 'asphalt', 'grass', 'bark'].flatMap((n) => [
    { key: `city-${n}`, mod: '/src/features/room/render/three/outside/textures.ts', call: n, pick: 'map', kind: 'colour', srgb: false },
    { key: `city-${n}-n`, mod: '/src/features/room/render/three/outside/textures.ts', call: n, pick: 'normal', kind: 'normal', srgb: false },
  ]),
];

const PORT = Number(process.env.PORT || 5199), url = `http://localhost:${PORT}/`;
const out = fileURLToPath(new URL('../../public/tex/', import.meta.url));
const up = async () => { try { return (await fetch(url)).ok; } catch { return false; } };
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
}
process.on('exit', () => { try { server?.kill(); } catch { /* gone */ } });

const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) });
try {
  const p = await browser.newPage();
  await p.goto(`${url}?nobaked`);
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) rmSync(out + f);
  let rgba = 0, disk = 0, gpu = 0;
  for (const s of SET) {
    // the canvas's pixels, as base64 (a page gives no typed array to the script)
    const got = await p.evaluate(async ({ mod, call, pick }) => {
      const m = await import(/* @vite-ignore */ mod), r = m[call](), t = pick ? r[pick] : r, cv = t.image;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let bin = '';
      for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000));
      return { w: cv.width, h: cv.height, b64: btoa(bin) };
    }, s);
    const data = new Uint8Array(Buffer.from(got.b64, 'base64'));
    const normal = s.kind === 'normal';
    const say = console.log;
    console.log = () => {}; // (the encoder prints each slice)
    const file = await encodeToKTX2(new Uint8Array(4), {
      imageDecoder: async () => ({ width: got.w, height: got.h, data }),
      isKTX2File: true, generateMipmap: true, isYFlip: true, enableDebug: false,
      isUASTC: normal, ...(normal ? { uastcLDRQualityLevel: 2, needSupercompression: true, isNormalMap: true } : { qualityLevel: 255, compressionLevel: 3 }),
      // (the city's colour is sRGB in the texels but the file says linear: `isPerceptual` still tunes the encoder for it)
      isPerceptual: !normal, isSetKTX2SRGBTransferFunc: s.srgb,
    });
    console.log = say;
    writeFileSync(`${out}${s.key}.ktx2`, file);
    const full = got.w * got.h * 4 * 4 / 3, small = got.w * got.h * 4 / 3; // (RGBA8 and one byte a texel, each with mips)
    rgba += full; disk += file.byteLength; gpu += small;
    console.log(`${s.key.padEnd(18)} ${got.w}x${got.h} ${normal ? 'UASTC' : 'ETC1S'}  file ${(file.byteLength / 1024).toFixed(0)} KB  GPU ${(full / 1048576).toFixed(2)} -> ${(small / 1048576).toFixed(2)} MB`);
  }
  writeFileSync(`${out}manifest.json`, JSON.stringify({ keys: SET.map((s) => s.key) }) + '\n');
  console.log(`${SET.length} maps: ${(disk / 1024).toFixed(0)} KB on disk; GPU ${(rgba / 1048576).toFixed(1)} MB as RGBA8 -> about ${(gpu / 1048576).toFixed(1)} MB (one byte a texel, with mips)`);
} finally {
  await browser.close();
}
process.exit(0); // (the encoder's wasm threads keep the process alive)
