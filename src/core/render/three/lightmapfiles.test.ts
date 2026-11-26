// The room's light bake files (`public/bake/room/`, `npm run bake`, `npm run bake:lm`): the manifest and the files agree, each map has its KTX2
// beside its PNG, and the gzipped UVs are `meshes.bin` as it is. And `loadBake` reads the UVs from the gzip, or from the plain file when it can't.
// Reads the files only (node).
import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import { loadBake } from './lightmapmix';
import type * as lightmapmixTypes from './lightmapmix';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A file's bytes (a Node Buffer), as far as this test reads them. */
interface FileBytes extends Uint8Array<ArrayBuffer> {
  equals: (other: Uint8Array) => boolean;
}
/** The parts of `node:fs` this test reads with. */
interface NodeFs {
  readFileSync: ((f: string, enc: 'utf8') => string) & ((f: string) => FileBytes);
  existsSync: (f: string) => boolean;
}
/** The parts of `node:zlib` this test uses. */
interface NodeZlib {
  gzipSync: (b: Uint8Array) => Uint8Array<ArrayBuffer>;
  gunzipSync: (b: Uint8Array) => FileBytes;
}
const { readFileSync, existsSync } = await vi.importActual<NodeFs>('node:fs');
const { gzipSync, gunzipSync } = await vi.importActual<NodeZlib>('node:zlib');
const isBakeManifest = (v: unknown): v is lightmapmixTypes.BakeManifest =>
  typeof v === 'object' && v !== null && 'groups' in v && 'meshes' in v && 'width' in v && 'height' in v;
const dir = 'public/bake/room/'; // (from the repo's root, as `baked.test.ts` reads `public/tex/`)
const manifest: unknown = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8'));
assert(isBakeManifest(manifest), 'the bake manifest reads');
/** The size the receivers' UVs take, in Uint16 pairs: up to the end of the last receiver. */
const receiverCorners = (m: lightmapmixTypes.BakeManifest) => Math.max(0, ...m.meshes.map((r) => r.offset + r.corners));
/** The file name a url asks for. */
const fileOf = (url: string) => must(url.split('/').pop());
/** What the stand-in server answers for file `f`: the manifest, a file it has, or a 404. */
const reply = (f: string, m: object, files: Record<string, Uint8Array<ArrayBuffer> | null>): Response => {
  if (f === 'manifest.json') {
    return Response.json(m);
  }
  const body = files[f];
  return body ? new Response(body) : new Response('', { status: 404 });
};
/** The UVs of the bake `loadBake` reads from `base`. */
const uvsOf = async (base: string) => {
  const bake = await loadBake(base);
  return [...bake.uvs];
};
const KTX2 = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

describe('the bake files', () => {
  it('each group has its PNG and its KTX2, and the KTX2 is an atlas-sized texture with no mips', () => {
    for (const g of manifest.groups) {
      expect(existsSync(`${dir}${g.file}`), `${g.file} exists`).toBe(true);
      expect(g.ktx2, `${g.id}: its KTX2`).toBe(`${g.id}.ktx2`);
      const b = readFileSync(`${dir}${g.ktx2}`),
        v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      expect([...b.subarray(0, 12)], `${g.id}: KTX2 magic`).toStrictEqual(KTX2);
      expect([v.getUint32(20, true), v.getUint32(24, true)], `${g.id}: size`).toStrictEqual([
        manifest.width,
        manifest.height,
      ]);
      expect(v.getUint32(40, true), `${g.id}: levels`).toBe(1); // (levelCount: the light is read texel for texel)
    }
  });

  it('the gzipped UVs are meshes.bin', () => {
    expect(manifest.uvs).toBe('meshes.packed'); // (no `.gz`: Vite's server sends such a file as `Content-Encoding`)
    const raw = readFileSync(`${dir}meshes.bin`),
      gz = readFileSync(`${dir}${manifest.uvs}`);
    expect(gunzipSync(gz).equals(raw)).toBe(true);
    expect(gz.length).toBeLessThan(raw.length / 2);
    // (the size the receivers say: the game checks it)
    expect(raw).toHaveLength(receiverCorners(manifest) * 4);
  });
});

describe('loadBake: the UVs', () => {
  const asked: string[] = [];
  afterEach(() => {
    vi.unstubAllGlobals();
    asked.length = 0;
  });
  const uv = new Uint16Array([1, 2, 3, 4, 65_535, 0]);
  const bytes = new Uint8Array(uv.buffer);
  const serve = (m: object, files: Record<string, Uint8Array<ArrayBuffer> | null>) => {
    vi.stubGlobal('fetch', async (url: string) => {
      const f = fileOf(url);
      asked.push(f);
      await Promise.resolve(); // (the answer comes later, as from a server)
      return reply(f, m, files);
    });
  };
  // (one receiver of three corners: six Uint16)
  const head = {
    version: 1,
    encoding: 'rgbm-sqrt',
    width: 1,
    height: 1,
    texelsPerMetre: 50,
    samples: 1,
    groups: [],
    dark: [],
    meshes: [{ name: 'a', hash: 'h', corners: 3, offset: 0 }],
  };

  it('unzips the gzipped file when the manifest names one', async () => {
    serve({ ...head, uvs: 'meshes.packed' }, { 'meshes.packed': gzipSync(bytes) });
    await expect(uvsOf('/b/')).resolves.toStrictEqual([...uv]); // (meshes.bin is not served: only the gzip can give this)
    expect(asked).toStrictEqual(['manifest.json', 'meshes.packed']);
  });

  it('takes the file as it is when it comes unzipped already (a server that sent it as Content-Encoding)', async () => {
    serve({ ...head, uvs: 'meshes.packed' }, { 'meshes.packed': bytes });
    await expect(uvsOf('/b/')).resolves.toStrictEqual([...uv]);
    expect(asked).toStrictEqual(['manifest.json', 'meshes.packed']); // (one download, not a second one of meshes.bin)
  });

  it("reads the plain file when the packed one has not the receivers' size", async () => {
    serve({ ...head, uvs: 'meshes.packed' }, { 'meshes.packed': gzipSync(new Uint8Array(8)), 'meshes.bin': bytes });
    await expect(uvsOf('/b/')).resolves.toStrictEqual([...uv]);
    expect(asked).toStrictEqual(['manifest.json', 'meshes.packed', 'meshes.bin']);
  });

  it('reads the plain file when the packed one is missing', async () => {
    serve({ ...head, uvs: 'meshes.packed' }, { 'meshes.bin': bytes });
    await expect(uvsOf('/b/')).resolves.toStrictEqual([...uv]);
  });

  it('reads the plain file when the manifest has no gzip', async () => {
    serve(head, { 'meshes.bin': bytes });
    await expect(uvsOf('/b/')).resolves.toStrictEqual([...uv]);
  });
});
