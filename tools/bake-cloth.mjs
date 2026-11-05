// `npm run bake:cloth -- <module.ts>`: run a cloth bake (docs/render/cloth.md) and write its model to `public/models/<name>.glb`. The module
// exports `bake` (a `ClothBake`); Vite's module runner loads it, so it may import the game's TypeScript by the `@/` paths. Offline only: the game
// loads the file it writes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const file = process.argv[2];
if (!file) { console.log('usage: npm run bake:cloth -- <module.ts>'); process.exit(1); }
const src = fileURLToPath(new URL('../src', import.meta.url));
const config = { configFile: false, logLevel: 'warn', resolve: { alias: { '@': src } } };
const { module: spec } = await runnerImport(resolve(file), config);
const { module: tool } = await runnerImport(resolve(src, 'core/render/three/cloth/bake.ts'), config);
if (!spec.bake) { console.log(`${file} exports no \`bake\``); process.exit(1); }
const bytes = tool.bakeCloth(spec.bake, (line) => console.log(line));
const out = fileURLToPath(new URL(`../public/models/${spec.bake.name}.glb`, import.meta.url));
mkdirSync(resolve(out, '..'), { recursive: true });
writeFileSync(out, bytes);
console.log(`wrote ${out} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
