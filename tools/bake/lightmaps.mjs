// `npm run bake:lm`: each light group's lightmap PNG in `public/bake/room/` as a KTX2 file beside it (`<group>.ktx2`), and the manifest's
// `ktx2` name in the group (`src/features/room/light.md`, "Offline bakes"). The game loads the KTX2 when it can (`loadBake`): a fifth of the
// download, a quarter of the GPU memory. The PNG stays: it is the bake's own file, and the game's fallback. The receivers' UVs too:
// `meshes.packed` (gzip; the manifest's `uvs`) beside `meshes.bin`. `bake.mjs` does this for the groups it bakes; this tool does it for the files
// already there, with no Blender.
//   --mode etc1s|uastc   (etc1s: see `ktx2.mjs`)
//   --only a,b           only these groups
//   --out dir            write the files and the manifest there, not beside the PNGs (to look at a mode before it is the bake's)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { runnerImport } from 'vite';
import { ktx2Of } from './ktx2.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const MODE = flag('mode', 'etc1s'), ONLY = flag('only', '').split(',').filter(Boolean);
const root = fileURLToPath(new URL('../..', import.meta.url)), src = join(root, 'public/bake/room'), out = flag('out', src);
const { module: rgbm } = await runnerImport(join(root, 'tools/bake/rgbm.ts'), { configFile: false, logLevel: 'warn' });
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
let png = 0, ktx = 0;
for (const g of manifest.groups) {
  if (ONLY.length && !ONLY.includes(g.id)) continue;
  const bytes = readFileSync(join(src, g.file)), { width, height, rgba } = rgbm.unpng(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const file = await ktx2Of(rgba, width, height, MODE);
  writeFileSync(join(out, `${g.id}.ktx2`), file);
  g.ktx2 = `${g.id}.ktx2`;
  png += bytes.length; ktx += file.byteLength;
  console.log(`${g.id.padEnd(8)} ${width}x${height}  PNG ${(bytes.length / 1024).toFixed(0)} KB -> ${MODE} ${(file.byteLength / 1024).toFixed(0)} KB`);
}
// and the receivers' UVs gzipped (`BakeManifest.uvs`)
const gz = gzipSync(readFileSync(join(src, 'meshes.bin')), { level: 9 });
writeFileSync(join(out, 'meshes.packed'), gz); manifest.uvs = 'meshes.packed';
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${(png / 1048576).toFixed(2)} MB -> ${(ktx / 1048576).toFixed(2)} MB (${MODE}); meshes.packed ${(gz.length / 1024).toFixed(0)} KB`);
