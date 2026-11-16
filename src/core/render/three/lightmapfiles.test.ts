// The room's light bake files (`public/bake/room/`, `npm run bake`, `npm run bake:lm`): the manifest and the files agree, each map has its KTX2
// beside its PNG, and the gzipped UVs are `meshes.bin` as it is. And `loadBake` reads the UVs from the gzip, or from the plain file when it can't.
// Reads the files only (node).
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as zlibMod from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBake, type BakeManifest } from './lightmapmix';

const { readFileSync, existsSync } = fsMod as { readFileSync: (f: string, enc?: string) => any; existsSync: (f: string) => boolean };
const { gzipSync } = zlibMod as { gzipSync: (b: Uint8Array) => Uint8Array };
const dir = 'public/bake/room/'; // (from the repo's root, as `baked.test.ts` reads `public/tex/`)
const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8')) as BakeManifest;
const KTX2 = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

describe('the bake files', () => {
  it('each group has its PNG and its KTX2, and the KTX2 is an atlas-sized texture with no mips', () => {
    for (const g of manifest.groups) {
      expect(existsSync(`${dir}${g.file}`), g.file).toBe(true);
      expect(g.ktx2, g.id).toBe(`${g.id}.ktx2`);
      const b = readFileSync(`${dir}${g.ktx2}`), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      expect([...b.subarray(0, 12)], g.id).toEqual(KTX2);
      expect([v.getUint32(20, true), v.getUint32(24, true)], g.id).toEqual([manifest.width, manifest.height]);
      expect(v.getUint32(40, true), g.id).toBe(1); // (levelCount: the light is read texel for texel)
    }
  });

  it('the gzipped UVs are meshes.bin', () => {
    expect(manifest.uvs).toBe('meshes.packed'); // (no `.gz`: Vite's server sends such a file as `Content-Encoding`)
    const raw = readFileSync(`${dir}meshes.bin`), gz = readFileSync(`${dir}${manifest.uvs}`);
    expect(zlibMod.gunzipSync(gz).equals(raw)).toBe(true);
    expect(gz.length).toBeLessThan(raw.length / 2);
    // (the size the receivers say: the game checks it)
    expect(raw.length).toBe(manifest.meshes.reduce((n, m) => Math.max(n, m.offset + m.corners), 0) * 4);
  });
});

describe('loadBake: the UVs', () => {
  const asked: string[] = [];
  afterEach(() => { vi.unstubAllGlobals(); asked.length = 0; });
  const uv = new Uint16Array([1, 2, 3, 4, 65535, 0]);
  const bytes = new Uint8Array(uv.buffer);
  const serve = (m: object, files: Record<string, Uint8Array | null>) => vi.stubGlobal('fetch', async (url: string) => {
    const f = url.split('/').pop()!;
    asked.push(f);
    if (f === 'manifest.json') return new Response(JSON.stringify(m));
    const body = files[f];
    return body ? new Response(body as unknown as BodyInit) : new Response('', { status: 404 });
  });
  // (one receiver of three corners: six Uint16)
  const head = { version: 1, encoding: 'rgbm-sqrt', width: 1, height: 1, texelsPerMetre: 50, samples: 1, groups: [], dark: [], meshes: [{ name: 'a', hash: 'h', corners: 3, offset: 0 }] };

  it('unzips the gzipped file when the manifest names one', async () => {
    serve({ ...head, uvs: 'meshes.packed' }, { 'meshes.packed': gzipSync(bytes) });
    expect([...(await loadBake('/b/')).uvs]).toEqual([...uv]); // (meshes.bin is not served: only the gzip can give this)
    expect(asked).toEqual(['manifest.json', 'meshes.packed']);
  });

  it('takes the file as it is when it comes unzipped already (a server that sent it as Content-Encoding)', async () => {
    serve({ ...head, uvs: 'meshes.packed' }, { 'meshes.packed': bytes });
    expect([...(await loadBake('/b/')).uvs]).toEqual([...uv]);
    expect(asked).toEqual(['manifest.json', 'meshes.packed']); // (one download, not a second one of meshes.bin)
  });

  it('reads the plain file when the packed one has not the receivers\' size', async () => {
    serve({ ...head, uvs: 'meshes.packed' }, { 'meshes.packed': gzipSync(new Uint8Array(8)), 'meshes.bin': bytes });
    expect([...(await loadBake('/b/')).uvs]).toEqual([...uv]);
    expect(asked).toEqual(['manifest.json', 'meshes.packed', 'meshes.bin']);
  });

  it('reads the plain file when the packed one is missing', async () => {
    serve({ ...head, uvs: 'meshes.packed' }, { 'meshes.bin': bytes });
    expect([...(await loadBake('/b/')).uvs]).toEqual([...uv]);
  });

  it('reads the plain file when the manifest has no gzip', async () => {
    serve(head, { 'meshes.bin': bytes });
    expect([...(await loadBake('/b/')).uvs]).toEqual([...uv]);
  });
});
