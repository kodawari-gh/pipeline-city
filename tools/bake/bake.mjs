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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { exportScene } from './export.mjs';
import { ktx2Of } from './ktx2.mjs';
import { readManifest } from './manifest.mjs';
import { blender, decode, directGroups, readWork, writeWork } from './work.mjs';

/** @import { BakeManifest } from '@/core/render/three/lightmapmix' */
/** @import { WorkGroup } from './work.mjs' */

const { join } = path;
const args = process.argv.slice(2);
/**
 * The value after `--<n>`, or `d`.
 * @param {string} n
 * @param {string} d
 */
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  if (i === -1) {
    return d;
  }
  const v = args[i + 1];
  if (v === undefined) {
    throw new Error(`--${n} needs a value`);
  }
  return v;
};
/**
 * An environment variable, or `d` when it is unset or empty.
 * @param {string} name
 * @param {string} d
 */
const env = (name, d) => {
  const v = process.env[name];
  return v === undefined || v === '' ? d : v;
};
const FAST = args.includes('--fast'),
  SAMPLES = Number(flag('samples', FAST ? '64' : '16384')),
  TEXELS = Number(flag('texels', '50')),
  PADDING = 4;
const ONLY = flag('only', '').split(',').filter(Boolean),
  PACK = args.includes('--pack');
const BLENDER = env('BLENDER', 'C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe');
const root = fileURLToPath(new URL('../..', import.meta.url)),
  out = join(root, 'public/bake/room'),
  work = join(tmpdir(), 'pipeline-city-bake');
const config = {
  configFile: false,
  logLevel: /** @type {const} */ ('warn'),
  resolve: { alias: { '@': join(root, 'src') } },
};
/** @type {{ module: typeof import('./atlas'); dependencies: string[] }} */
const { module: atlasLib } = await runnerImport(join(root, 'tools/bake/atlas.ts'), config);
/** @type {{ module: typeof import('./rgbm'); dependencies: string[] }} */
const { module: rgbm } = await runnerImport(join(root, 'tools/bake/rgbm.ts'), config);
if (!PACK && !existsSync(BLENDER)) {
  console.log(`no Blender at ${BLENDER} (set BLENDER)`);
  process.exit(1);
}
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });
const t0 = Date.now(),
  secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;

/** The last bake's room and manifest (`--only`, `--pack`), with the groups to bake again. */
function lastBake() {
  if (!existsSync(join(work, 'scene.json')) || !existsSync(join(out, 'manifest.json'))) {
    console.log(`--${PACK ? 'pack' : 'only'} needs a full bake first`);
    process.exit(1);
  }
  const cfg = readWork(join(work, 'scene.json'));
  const manifest = readManifest(join(out, 'manifest.json'));
  // (a work dir from before a direct group: add it, so `--only desk-direct,...` bakes it on the last bake's room)
  const added = directGroups(cfg.groups).filter((d) => !cfg.groups.some((g) => g.id === d.id));
  if (added.length > 0) {
    cfg.groups.push(...added);
    writeFileSync(join(work, 'scene.json'), JSON.stringify(cfg));
  }
  const groups = cfg.groups.filter((g) => ONLY.length === 0 || ONLY.includes(g.id));
  if (ONLY.length > 0 && groups.length !== ONLY.length) {
    console.log(`no such group in the last bake: ${ONLY.filter((id) => !groups.some((g) => g.id === id)).join(',')}`);
    process.exit(1);
  }
  if (!PACK && (cfg.samples !== SAMPLES || cfg.denoise === FAST)) {
    cfg.samples = SAMPLES;
    cfg.denoise = !FAST;
    writeFileSync(join(work, 'scene.json'), JSON.stringify(cfg));
  }
  return { manifest, groups, all: cfg.groups };
}

/**
 * A new bake: the room exported, its atlas, the work dir for Blender, the receivers' UVs (`meshes.bin`) and the manifest's start.
 * @returns {Promise<{ manifest: BakeManifest; groups: WorkGroup[]; all: WorkGroup[] }>}
 */
async function newBake() {
  const scene = await exportScene(root);
  const receivers = scene.meshes.filter((m) => m.receiver);
  console.log(`room: ${scene.meshes.length} meshes, ${receivers.length} receivers (${secs()})`);
  const atlas = await atlasLib.buildAtlas(
    receivers.map((m) => ({
      pos: decode(m.pos, Float32Array) ?? new Float32Array(),
      index: decode(m.index, Uint32Array),
    })),
    TEXELS,
    PADDING,
  );
  console.log(`atlas: ${atlas.width} x ${atlas.height}, ${(atlas.utilization * 100).toFixed(0)}% used (${secs()})`);
  const groups = writeWork(scene, {
    atlas,
    receivers,
    settings: { work, samples: SAMPLES, fast: FAST, padding: PADDING },
  });
  // the receivers' UVs, for the game: a corner's UV as two Uint16 (0 to 65535 over the atlas)
  const total = atlas.meshes.reduce((n, m) => n + m.uv.length, 0),
    uv = new Uint16Array(total);
  let off = 0;
  const meshes = receivers.map((m, k) => {
    const a = atlas.meshes[k]?.uv ?? new Float32Array(),
      entry = { name: m.name, hash: m.hash, corners: a.length / 2, offset: off / 2 };
    for (const [i, v] of a.entries()) {
      uv[off + i] = Math.round(Math.min(1, Math.max(0, v)) * 65_535);
    }
    off += a.length;
    return entry;
  });
  writeFileSync(join(out, 'meshes.bin'), uv);
  /** @type {BakeManifest} */
  const manifest = {
    version: 1,
    encoding: 'rgbm-sqrt',
    width: atlas.width,
    height: atlas.height,
    texelsPerMetre: TEXELS,
    samples: SAMPLES,
    groups: [],
    dark: scene.sunHours.filter((h) => !scene.suns.some((s) => s.hour === h)).map((h) => `sun-${h}`),
    meshes,
  };
  return { manifest, groups, all: groups };
}

const { manifest, groups, all } = ONLY.length > 0 || PACK ? lastBake() : await newBake();

if (!PACK) {
  await blender({ exe: BLENDER, root, work }, [...ONLY, ...(args.includes('--preview') ? ['--preview'] : [])]);
}
if (args.includes('--preview')) {
  console.log(`previews: ${work}`);
}
const uvBytes = readFileSync(join(out, 'meshes.bin'));
// (the game reads the gzipped copy: `BakeManifest.uvs`; its name has no `.gz`, as a server that sees one may send it as `Content-Encoding`)
writeFileSync(join(out, 'meshes.packed'), gzipSync(uvBytes, { level: 9 }));
manifest.uvs = 'meshes.packed';
const size = { width: manifest.width, height: manifest.height };
const keep = atlasLib.chartTexels(
  new Uint16Array(uvBytes.buffer.slice(uvBytes.byteOffset, uvBytes.byteOffset + uvBytes.byteLength)),
  { ...size, grow: PADDING / 2 },
);
/** @param {string} id */
const light = (id) => {
  const f = readFileSync(join(work, `${id}.f32`));
  return new Float32Array(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
};
/**
 * A lamp group's lead: the baked intensity of its first light.
 * @param {WorkGroup} g
 */
const leadOf = (g) => {
  const first = g.lights?.[0];
  if (!first) {
    throw new Error(`the lamp group ${g.id} has no lights`);
  }
  return first.intensity;
};
for (const g of groups) {
  if (g.kind === 'direct') {
    continue;
  }
  const rgb = light(g.id);
  const scale = rgbm.scaleOf(rgb),
    bytes = rgbm.encode({ ...size, rgb, scale }, keep),
    file = rgbm.png(bytes, size);
  writeFileSync(join(out, `${g.id}.png`), file);
  // (and the same bytes as the game loads them, KTX2: `ktx2.mjs`; `npm run bake:lm` does it for the files already there)
  const ktx2 = await ktx2Of(bytes, size);
  writeFileSync(join(out, `${g.id}.ktx2`), ktx2);
  const entry = {
    id: g.id,
    kind: g.kind,
    file: `${g.id}.png`,
    ktx2: `${g.id}.ktx2`,
    scale,
    ...(g.kind === 'lamp' ? { lead: leadOf(g) } : {}),
    ...(g.kind === 'sun' && g.hour !== undefined ? { hour: g.hour } : {}),
  };
  const k = manifest.groups.findIndex((e) => e.id === g.id);
  if (k === -1) {
    manifest.groups.push(entry);
  } else {
    manifest.groups[k] = entry;
  }
  console.log(
    `${g.id}.png: ${(file.length / 1024).toFixed(0)} KB, ${g.id}.ktx2: ${(ktx2.byteLength / 1024).toFixed(0)} KB, scale ${scale.toPrecision(3)}`,
  );
}
// the capped lamps' direct light, three groups a file (`packDirect`): all of them again, as a file holds more than one group
const direct = all.filter((g) => g.kind === 'direct' && existsSync(join(work, `${g.id}.f32`)));
/** @type {NonNullable<BakeManifest['direct']>} */
const packed = { files: [], groups: [] };
for (let i = 0; i < direct.length; i += 3) {
  const part = direct.slice(i, i + 3),
    name = `direct-${i / 3}.png`;
  const { bytes, entries } = rgbm.packDirect(
    part.map((g) => light(g.id)),
    { ...size, keep },
  );
  const file = rgbm.png(bytes, size);
  writeFileSync(join(out, name), file);
  packed.files.push(name);
  const said = [];
  for (const [c, g] of part.entries()) {
    const e = entries[c];
    if (!e) {
      throw new Error(`no packed entry for ${g.id}`);
    }
    packed.groups.push({ id: g.of ?? g.id, map: i / 3, channel: c, scale: e.scale, colour: e.colour, lead: leadOf(g) });
    said.push(`${g.of ?? g.id} scale ${e.scale.toPrecision(3)}`);
  }
  console.log(`${name}: ${(file.length / 1024).toFixed(0)} KB, ${said.join(', ')}`);
}
if (direct.length === 0) {
  delete manifest.direct;
} else {
  manifest.direct = packed;
}
if (!PACK) {
  manifest.samples = SAMPLES;
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`wrote ${path.resolve(out)} (${secs()})`);
