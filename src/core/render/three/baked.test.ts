// The baked texture set (`public/tex/`, `npm run bake:tex`): the manifest and the files agree, and each file is a KTX2 with mips.
// Reads the files only (node, no DOM).
// @ts-ignore
import * as fsMod from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bakedTex, type BakedManifest } from './baked';

const { readFileSync, readdirSync } = fsMod as {
  readFileSync: (f: string, enc?: string) => any;
  readdirSync: (d: string) => string[];
};
const dir = 'public/tex/'; // (from the repo's root, as `gltf.test.ts` reads `public/basis/`)
const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8')) as BakedManifest;
const KTX2 = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

describe('baked textures', () => {
  it('the manifest lists each file once, and no file is left out', () => {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.ktx2'))
      .map((f) => f.slice(0, -5))
      .sort();
    expect([...manifest.keys].sort()).toEqual(files);
    expect(new Set(manifest.keys).size).toBe(manifest.keys.length);
  });

  it('each file is a KTX2 of at most 512 px a side, with its full mip chain', () => {
    for (const k of manifest.keys) {
      const b = readFileSync(`${dir}${k}.ktx2`),
        v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      expect([...b.subarray(0, 12)], k).toEqual(KTX2);
      const w = v.getUint32(20, true),
        h = v.getUint32(24, true),
        levels = v.getUint32(40, true);
      // (the room's floor and rug: the two largest surfaces seen close, docs/3D_STYLE.md "Size and compression rule")
      expect(Math.max(w, h), k).toBeLessThanOrEqual(/^room-(planks|rug)/.test(k) ? 1024 : 512);
      expect(levels, k).toBe(Math.floor(Math.log2(Math.max(w, h))) + 1);
    }
  });

  it('a city colour map comes with its normal map', () => {
    for (const k of manifest.keys.filter((x) => x.startsWith('city-') && !x.endsWith('-n')))
      expect(manifest.keys, k).toContain(`${k}-n`);
  });

  it('gives null for a key before the set has loaded: the painter then paints', () => {
    expect(bakedTex('part-brushed')).toBeNull();
  });
});
