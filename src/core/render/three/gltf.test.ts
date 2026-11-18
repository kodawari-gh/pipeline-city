// @ts-ignore
import * as fsMod from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Box3, Mesh, MeshBasicMaterial, Texture, Vector3, type MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fitModel, ktx2Support, loadModel, modelsIn, type Ktx2 } from './gltf';

const fs = fsMod as any;
// (three's file loader tells its progress with a browser event that Node does not have)
vi.stubGlobal('ProgressEvent', class { constructor(readonly type: string, init: object = {}) { Object.assign(this, init); } });
// (and it reads `self.URL` for an image inside the file)
if (typeof self === 'undefined') vi.stubGlobal('self', globalThis);

/**
 * A .glb of one triangle (the smallest model the loader reads): a header, a JSON chunk and a binary chunk. `more`: more of the JSON (a
 * material with a KTX2 texture); `material`: the triangle wears material 0.
 */
const glb = (more: Record<string, unknown> = {}, material = false): ArrayBuffer => {
  const bin = new Uint8Array(new Float32Array([0, 0, 0, 2, 0, 0, 0, 4, 0]).buffer);
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...(material ? { material: 0 } : {}) }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [2, 4, 0] }],
    bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }], ...more,
  });
  const text = new TextEncoder().encode(json + ' '.repeat((4 - (json.length % 4)) % 4));
  const out = new ArrayBuffer(12 + 8 + text.length + 8 + bin.length), v = new DataView(out);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.byteLength, true);
  v.setUint32(12, text.length, true); v.setUint32(16, 0x4e4f534a, true); new Uint8Array(out, 20, text.length).set(text);
  const o = 20 + text.length;
  v.setUint32(o, bin.length, true); v.setUint32(o + 4, 0x004e4942, true); new Uint8Array(out, o + 8, bin.length).set(bin);
  return out;
};
const TRIANGLE = glb();
/** The triangle with a base colour map that is a KTX2 image (`KHR_texture_basisu`, required: no PNG beside it). */
const WITH_KTX2 = glb({
  extensionsUsed: ['KHR_texture_basisu'], extensionsRequired: ['KHR_texture_basisu'],
  materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
  textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }], images: [{ uri: 'skin.ktx2' }],
}, true);
/** The model as a url the loader can fetch with no server; `tag` makes it a model of its own (the cache is by url). */
const urlOf = (model: ArrayBuffer, tag: string): string => `data:model/gltf-binary;name=${tag};base64,${btoa(String.fromCharCode(...new Uint8Array(model)))}`;
/** A stand-in for three's `KTX2Loader` (it needs a worker and the wasm transcoder): it gives `tex`, or fails. */
const fakeKtx2 = (tex: Texture | null, asked: string[] = []): Ktx2 => ({
  load(url: string, onLoad: (t: Texture) => void, _p: unknown, onError: (e: unknown) => void) { asked.push(url); if (tex) onLoad(tex); else onError(new Error('no transcoder')); },
}) as unknown as Ktx2;

describe('glTF models', () => {
  it('fitModel scales evenly into the rect and the depth, and centres on the rect', () => {
    const o = new Mesh(new BoxGeometry(2, 4, 6), new MeshBasicMaterial());
    fitModel(o, { x: 0, y: 0, w: 100, h: 100 }, 10, 40);
    const box = new Box3().setFromObject(o), size = box.getSize(new Vector3()), mid = box.getCenter(new Vector3());
    expect(size.z).toBeCloseTo(30);
    expect(size.x).toBeCloseTo(10);
    expect(size.y).toBeCloseTo(20);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(-50);
    expect(box.min.z).toBeCloseTo(10);
  });

  it('fitModel with stretch fills the rect in x and y and keeps the height to the smaller', () => {
    const o = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    fitModel(o, { x: 0, y: 0, w: 100, h: 40 }, 0, 1000, true);
    const size = new Box3().setFromObject(o).getSize(new Vector3());
    expect(size.x).toBeCloseTo(100);
    expect(size.y).toBeCloseTo(40);
    expect(size.z).toBeCloseTo(40);
  });

  it('the loader reads a model and the fit places it', async () => {
    const gltf = await new GLTFLoader().parseAsync(TRIANGLE, '');
    fitModel(gltf.scene, { x: 10, y: 20, w: 8, h: 8 }, 0, 100);
    const box = new Box3().setFromObject(gltf.scene);
    expect(box.max.y - box.min.y).toBeCloseTo(8);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(14);
  });
});

describe('modelsIn (the boot waits for the models its scene asked for)', () => {
  it('waits until the users of the models have them', async () => {
    const used: string[] = [];
    void loadModel(urlOf(TRIANGLE, 'wait-a')).then(() => { used.push('a'); });
    void loadModel(urlOf(TRIANGLE, 'wait-b')).then(() => { used.push('b'); });
    expect(used).toEqual([]);
    await modelsIn();
    expect(used.sort()).toEqual(['a', 'b']);
  });

  it('is done at once when no load is under way', async () => {
    await modelsIn();
    await expect(modelsIn(5)).resolves.toBeUndefined();
  });

  it('holds a model back until `until` settles (a build that must not see it), and modelsIn waits for it too', async () => {
    let open = () => {};
    const until = new Promise<void>((done) => { open = done; });
    let got: unknown = 'none';
    void loadModel(urlOf(TRIANGLE, 'held'), until).then((m) => { got = m; });
    await new Promise((done) => setTimeout(done, 50));
    expect(got).toBe('none');
    open();
    await modelsIn();
    expect(got).not.toBe('none');
    expect(got).not.toBeNull();
  });

  it('gives up after its time on a slow model, which still reaches its user later', async () => {
    const real = globalThis.fetch;
    let arrive = () => {};
    globalThis.fetch = (() => new Promise<Response>((done) => { arrive = () => done(new Response(TRIANGLE)); })) as typeof fetch;
    try {
      let used = false;
      void loadModel('http://localhost/slow-model.glb').then(() => { used = true; });
      await modelsIn(20);
      expect(used).toBe(false);
      arrive();
      await modelsIn();
      expect(used).toBe(true);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('KTX2 textures in a model (KTX1)', () => {
  const mapOf = (o: { traverse(f: (c: unknown) => void): void }): Texture | null => {
    let map: Texture | null = null;
    o.traverse((c) => { const m = c as Mesh; if (m.isMesh) map = (m.material as MeshStandardMaterial).map; });
    return map;
  };

  it('a model with a KTX2 texture loads through the KTX2 loader', async () => {
    const tex = new Texture(), asked: string[] = [];
    await ktx2Support(null, () => Promise.resolve(fakeKtx2(tex, asked)));
    const m = await loadModel(urlOf(WITH_KTX2, 'ok'));
    expect(m).not.toBeNull();
    expect(asked.length).toBe(1);
    expect(asked[0]).toMatch(/skin\.ktx2$/);
    expect(mapOf(m!)).toBe(tex);
  });

  it('a model without KTX2 loads as before', async () => {
    const m = await loadModel(urlOf(TRIANGLE, 'plain'));
    expect(m).not.toBeNull();
    expect(new Box3().setFromObject(m!).max.y).toBeCloseTo(4);
  });

  it('a KTX2 texture that fails gives no model (the primitives stay) and no throw', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await ktx2Support(null, () => Promise.resolve(fakeKtx2(null)));
    await expect(loadModel(urlOf(WITH_KTX2, 'broken'))).resolves.toBeNull();
    quiet.mockRestore();
  });

  it('a KTX2 loader that cannot be made leaves the plain loads working', async () => {
    await expect(ktx2Support(null, () => Promise.reject(new Error('no chunk')))).resolves.toBeUndefined();
    expect(await loadModel(urlOf(TRIANGLE, 'after'))).not.toBeNull();
  });

  it('the served transcoder is three\'s own (public/basis/ is a copy: copy it again after a three upgrade)', () => {
    for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
      expect(fs.readFileSync(`public/basis/${f}`).equals(fs.readFileSync(`node_modules/three/examples/jsm/libs/basis/${f}`)), f).toBe(true);
    }
  });
});
