// The baked texture set (`public/tex/`, `npm run bake:tex`): the manifest and the files agree, and each file is a KTX2 with mips.
// Reads the files only (node, no DOM).
import { assert, describe, expect, it, vi } from 'vitest';
import { bakedTex } from './baked';
import type * as bakedTypes from './baked';

/** The parts of `node:fs` this test reads with. */
interface NodeFs {
  readFileSync: ((f: string, enc: 'utf8') => string) & ((f: string) => Uint8Array);
  readdirSync: (d: string) => string[];
}
const { readFileSync, readdirSync } = await vi.importActual<NodeFs>('node:fs');
const isBakedManifest = (v: unknown): v is bakedTypes.BakedManifest =>
  typeof v === 'object' && v !== null && 'keys' in v && Array.isArray(v.keys);
const dir = 'public/tex/'; // (from the repo's root, as `gltf.test.ts` reads `public/basis/`)
const manifest: unknown = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8'));
assert(isBakedManifest(manifest), 'the texture manifest reads');
/** The largest side a texture may have: the room's floor and rug are the two largest surfaces seen close (docs/3D_STYLE.md "Size and
 * compression rule"). */
const sideLimit = (k: string) => (/^room-(?:planks|rug)/u.test(k) ? 1024 : 512);
/** Whether `k` is a city colour map (not its normal map). */
const isCityColour = (k: string) => k.startsWith('city-') && !k.endsWith('-n');
const KTX2 = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

describe('baked textures', () => {
  it('the manifest lists each file once, and no file is left out', () => {
    const files = [...readdirSync(dir)]
      .filter((f) => f.endsWith('.ktx2'))
      .map((f) => f.slice(0, -5))
      .toSorted();
    expect(manifest.keys.toSorted()).toStrictEqual(files);
    expect(new Set(manifest.keys).size).toBe(manifest.keys.length);
  });

  it('each file is a KTX2 of at most 512 px a side, with its full mip chain', () => {
    for (const k of manifest.keys) {
      const b = readFileSync(`${dir}${k}.ktx2`),
        v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      expect([...b.subarray(0, 12)], `${k}: KTX2 magic`).toStrictEqual(KTX2);
      const w = v.getUint32(20, true),
        h = v.getUint32(24, true),
        levels = v.getUint32(40, true);
      // (the room's floor and rug: the two largest surfaces seen close, docs/3D_STYLE.md "Size and compression rule")
      expect(Math.max(w, h), `${k}: size`).toBeLessThanOrEqual(sideLimit(k));
      const fullChain = Math.floor(Math.log2(Math.max(w, h))) + 1;
      expect(levels, `${k}: mips`).toBe(fullChain);
    }
  });

  it('a city colour map comes with its normal map', () => {
    for (const k of manifest.keys.filter((x) => isCityColour(x))) {
      expect(manifest.keys, `${k}: its normal map`).toContain(`${k}-n`);
    }
  });

  it('gives null for a key before the set has loaded: the painter then paints', () => {
    expect(bakedTex('part-brushed')).toBeNull();
  });
});
