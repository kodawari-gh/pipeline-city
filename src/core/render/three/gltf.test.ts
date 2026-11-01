import { describe, expect, it } from 'vitest';
import { BoxGeometry, Box3, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fitModel } from './gltf';

/** A .glb of one triangle (the smallest model the loader reads): a header, a JSON chunk and a binary chunk. */
const TRIANGLE = (() => {
  const bin = new Uint8Array(new Float32Array([0, 0, 0, 2, 0, 0, 0, 4, 0]).buffer);
  const json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [2, 4, 0] }],
    bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }],
  });
  const text = new TextEncoder().encode(json + ' '.repeat((4 - (json.length % 4)) % 4));
  const out = new ArrayBuffer(12 + 8 + text.length + 8 + bin.length), v = new DataView(out);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.byteLength, true);
  v.setUint32(12, text.length, true); v.setUint32(16, 0x4e4f534a, true); new Uint8Array(out, 20, text.length).set(text);
  const o = 20 + text.length;
  v.setUint32(o, bin.length, true); v.setUint32(o + 4, 0x004e4942, true); new Uint8Array(out, o + 8, bin.length).set(bin);
  return out;
})();

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

  it('the loader reads a model and the fit places it', async () => {
    const gltf = await new GLTFLoader().parseAsync(TRIANGLE, '');
    fitModel(gltf.scene, { x: 10, y: 20, w: 8, h: 8 }, 0, 100);
    const box = new Box3().setFromObject(gltf.scene);
    expect(box.max.y - box.min.y).toBeCloseTo(8);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(14);
  });
});
