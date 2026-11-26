// Compress the models in public/models/ with meshopt (quantized geometry), in place.
// Safe to run twice: a file already meshopt-compressed is skipped. Exits 1 if a file is still over the 200 KB room budget.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const { join } = path;

const root = join(import.meta.dirname, '..', '..');
const dir = join(root, 'public', 'models');
const win = process.platform === 'win32';
const bin = join(root, 'node_modules', '.bin', win ? 'gltf-transform.cmd' : 'gltf-transform');
const BUDGET = 200 * 1024;
const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;
// A .glb has a 12-byte header, then the JSON chunk: its length (4 bytes) and type, then the JSON.
const isMeshopt = (/** @type {string} */ file) => {
  const buf = readFileSync(file);
  /** @type {unknown} */
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  return (
    typeof json === 'object' &&
    json !== null &&
    'extensionsUsed' in json &&
    Array.isArray(json.extensionsUsed) &&
    json.extensionsUsed.includes('EXT_meshopt_compression')
  );
};

let failed = false;
for (const name of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
  const file = join(dir, name);
  const before = statSync(file).size;
  if (isMeshopt(file)) {
    console.log(`${name}: ${kb(before)} (already meshopt, skipped)`);
  } else {
    const tmp = `${file}.tmp.glb`;
    execFileSync(bin, ['meshopt', file, tmp, '--level', 'medium'], { stdio: 'inherit', shell: win });
    renameSync(tmp, file);
    console.log(`${name}: ${kb(before)} -> ${kb(statSync(file).size)}`);
  }
  const after = statSync(file).size;
  if (after > BUDGET) {
    console.error(`${name}: over the 200 KB room budget`);
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
