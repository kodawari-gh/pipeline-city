// `npm run bake:tex`: bake the painted maps that never change to KTX2 in `public/tex/` (docs/render/three.md "Textures"; `baked.ts` loads
// them). A headless page of the dev server runs the game's own painters (with `?nobaked`, so each paints its canvas), this script reads the
// pixels and encodes them with the Basis encoder (`ktx2-encoder`, wasm: no system tool). The painters are seeded, so a rerun gives the same
// files. Each map is flipped in y: a compressed texture cannot flip at upload as a canvas does.
//   colour  ETC1S, mips (small file; BC7 on a desktop GPU, ETC2 on a phone: at most one byte a texel)
//   normal  UASTC with zstd, mips (BC7 or ASTC, one byte a texel)
//   env: PORT (5199), CHROME_PATH
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { encodeToKTX2 } from 'ktx2-encoder';
import { chromium } from 'playwright-core';

/**
 * The set. `from`: the module and the call that give the texture (a `Surface` gives `map` and `normal`). `srgb`: the file says sRGB, so the
 * GPU decodes it (a map with `SRGBColorSpace`); the city's colour maps stay raw (their material decodes them, `DECODE_SRGB`).
 */
/** @type {{ key: string; mod: string; call: string; pick?: string; kind: 'colour' | 'normal' | 'data'; srgb: boolean }[]} */
const SET = [
  {
    key: 'part-brushed',
    mod: '/src/features/board/render/three/casekit3d.ts',
    call: 'brushed',
    kind: 'colour',
    srgb: true,
  },
  {
    key: 'part-grain',
    mod: '/src/features/board/render/three/casekit3d.ts',
    call: 'grain',
    kind: 'colour',
    srgb: true,
  },
  {
    key: 'cooler-brushed',
    mod: '/src/features/board/render/three/cooler3d.ts',
    call: 'capBrushed',
    kind: 'colour',
    srgb: true,
  },
  ...['stucco', 'paving', 'asphalt', 'grass', 'bark'].flatMap((n) => [
    {
      key: `city-${n}`,
      mod: '/src/features/room/render/three/outside/textures.ts',
      call: n,
      pick: 'map',
      kind: 'colour',
      srgb: false,
    },
    {
      key: `city-${n}-n`,
      mod: '/src/features/room/render/three/outside/textures.ts',
      call: n,
      pick: 'normal',
      kind: 'normal',
      srgb: false,
    },
  ]),
  // the room's board (`smokedOak`: the desk top and the bookcase), its floor (1024 px: the largest surface, seen close) and its rug
  {
    key: 'room-oak',
    mod: '/src/features/room/render/three/furniture3d.ts',
    call: 'oakMaps',
    pick: 'map',
    kind: 'colour',
    srgb: true,
  },
  {
    key: 'room-oak-n',
    mod: '/src/features/room/render/three/furniture3d.ts',
    call: 'oakMaps',
    pick: 'normal',
    kind: 'normal',
    srgb: false,
  },
  {
    key: 'room-planks',
    mod: '/src/features/room/render/three/room3d.ts',
    call: 'planksMaps',
    pick: 'map',
    kind: 'colour',
    srgb: true,
  },
  {
    key: 'room-planks-n',
    mod: '/src/features/room/render/three/room3d.ts',
    call: 'planksMaps',
    pick: 'normal',
    kind: 'normal',
    srgb: false,
  },
  { key: 'room-rug', mod: '/src/features/room/render/three/room3d.ts', call: 'rugMap', kind: 'colour', srgb: true },
  // the walls' plaster: its relief and its sheen (`data`: linear values, ETC1S; it has no colour map, the material holds the paint)
  {
    key: 'room-plaster-n',
    mod: '/src/features/room/render/three/room3d.ts',
    call: 'plasterMaps',
    pick: 'normalMap',
    kind: 'normal',
    srgb: false,
  },
  {
    key: 'room-plaster-r',
    mod: '/src/features/room/render/three/room3d.ts',
    call: 'plasterMaps',
    pick: 'roughnessMap',
    kind: 'data',
    srgb: false,
  },
];

const port = process.env['PORT'],
  PORT = Number(port === undefined || port === '' ? 5199 : port),
  url = `http://localhost:${PORT}/`;
const out = fileURLToPath(new URL('../../public/tex/', import.meta.url));
const up = async () => {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
};
let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 100 && !(await up()); i++) {
    await sleep(300);
  }
}
process.on('exit', () => {
  try {
    server?.kill();
  } catch {
    /* gone */
  }
});

const chromePath = process.env['CHROME_PATH'];
const browser = await chromium.launch({
  headless: true,
  ...(chromePath === undefined || chromePath === '' ? { channel: 'chrome' } : { executablePath: chromePath }),
});
try {
  const p = await browser.newPage();
  await p.goto(`${url}?nobaked`);
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) {
    rmSync(out + f);
  }
  let rgba = 0,
    disk = 0,
    gpu = 0;
  for (const s of SET) {
    // the canvas's pixels, as base64 (a page gives no typed array to the script)
    const got = await p.evaluate(async ({ mod, call, pick }) => {
      /** @type {(v: unknown) => asserts v is () => unknown} */
      const mustCall = (v) => {
        if (typeof v !== 'function') {
          throw new TypeError(`${mod} has no ${call}()`);
        }
      };
      /** @type {unknown} */
      const loaded = await import(/* @vite-ignore */ mod);
      /** @type {Record<string, unknown>} */
      const m = typeof loaded === 'object' && loaded !== null ? loaded : {};
      const make = m[call];
      mustCall(make);
      /** @type {unknown} */
      const r = make();
      /** @type {Record<string, unknown>} */
      const maps = typeof r === 'object' && r !== null ? r : {};
      const t = pick === undefined ? r : maps[pick],
        cv = typeof t === 'object' && t !== null && 'image' in t ? t.image : undefined,
        ctx = cv instanceof HTMLCanvasElement ? cv.getContext('2d') : null;
      if (!(cv instanceof HTMLCanvasElement) || ctx === null) {
        throw new TypeError(`${mod} ${call}() gives no painted canvas`);
      }
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let bin = '';
      for (let i = 0; i < d.length; i += 0x80_00) {
        bin += String.fromCodePoint(...d.subarray(i, i + 0x80_00));
      }
      return { w: cv.width, h: cv.height, b64: btoa(bin) };
    }, s);
    const data = new Uint8Array(Buffer.from(got.b64, 'base64'));
    const normal = s.kind === 'normal';
    // (the encoder asks for the decoded image: it is the canvas's pixels as they are)
    const image = Promise.resolve({ width: got.w, height: got.h, data });
    const say = console.log;
    console.log = () => {
      // (the encoder prints each slice)
    };
    const file = await encodeToKTX2(new Uint8Array(4), {
      imageDecoder: async () => image,
      isKTX2File: true,
      generateMipmap: true,
      isYFlip: true,
      enableDebug: false,
      isUASTC: normal,
      ...(normal
        ? { uastcLDRQualityLevel: 2, needSupercompression: true, isNormalMap: true }
        : { qualityLevel: 255, compressionLevel: 3 }),
      // (the city's colour is sRGB in the texels but the file says linear: `isPerceptual` still tunes the encoder for it)
      isPerceptual: s.kind === 'colour',
      isSetKTX2SRGBTransferFunc: s.srgb,
    });
    console.log = say;
    writeFileSync(`${out}${s.key}.ktx2`, file);
    const full = (got.w * got.h * 4 * 4) / 3,
      small = (got.w * got.h * 4) / 3; // (RGBA8 and one byte a texel, each with mips)
    rgba += full;
    disk += file.byteLength;
    gpu += small;
    console.log(
      `${s.key.padEnd(18)} ${got.w}x${got.h} ${normal ? 'UASTC' : 'ETC1S'}  file ${(file.byteLength / 1024).toFixed(0)} KB  GPU ${(full / 1_048_576).toFixed(2)} -> ${(small / 1_048_576).toFixed(2)} MB`,
    );
  }
  writeFileSync(`${out}manifest.json`, `${JSON.stringify({ keys: SET.map((s) => s.key) })}\n`);
  console.log(
    `${SET.length} maps: ${(disk / 1024).toFixed(0)} KB on disk; GPU ${(rgba / 1_048_576).toFixed(1)} MB as RGBA8 -> about ${(gpu / 1_048_576).toFixed(1)} MB (one byte a texel, with mips)`,
  );
} finally {
  await browser.close();
}
process.exit(0); // (the encoder's wasm threads keep the process alive)
