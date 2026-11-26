import { assert, describe, expect, it } from 'vitest';
import { writeGlb } from './glb';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The parts of a GLB's JSON chunk these tests read. */
interface GltfJson {
  nodes: { name: string }[];
  materials: { name: string }[];
  meshes: { primitives: { material: number; indices: number; attributes: Record<string, number> }[] }[];
  accessors: {
    bufferView: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
    componentType: number;
  }[];
  bufferViews: { byteOffset: number; byteLength: number }[];
}
const isGltf = (v: unknown): v is GltfJson =>
  typeof v === 'object' && v !== null && 'meshes' in v && 'accessors' in v && 'bufferViews' in v;
/** The JSON chunk of a GLB, `jl` bytes long after the headers. */
function jsonOf(bytes: Uint8Array, jl: number): GltfJson {
  const json: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl)));
  assert(isGltf(json), 'the GLB has its JSON chunk');
  return json;
}

describe('glb writer', () => {
  it('writes a binary glTF: header, a JSON chunk naming the materials, a binary chunk the views fit in', () => {
    const tri = {
      position: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
      normal: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
      uv: Float32Array.of(0, 0, 1, 0, 0, 1),
    };
    const bytes = writeGlb('thing', [
      { material: 'knit', ...tri, index: Uint32Array.of(0, 1, 2) },
      { material: 'rib', ...tri, index: Uint32Array.of(0, 2, 1) },
    ]);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x46_54_6c_67);
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(bytes.byteLength);
    const jl = dv.getUint32(12, true);
    expect(dv.getUint32(16, true)).toBe(0x4e_4f_53_4a);
    expect(jl % 4).toBe(0);
    const json = jsonOf(bytes, jl);
    expect(must(json.nodes[0]).name).toBe('thing');
    expect(json.materials.map((m) => m.name)).toStrictEqual(['knit', 'rib']);
    expect(must(json.meshes[0]).primitives.map((p) => p.material)).toStrictEqual([0, 1]);
    // small meshes take 16-bit indices
    const prim = must(must(json.meshes[0]).primitives[0]);
    expect(must(json.accessors[prim.indices]).componentType).toBe(5123);
    expect(must(json.accessors[0]).max).toStrictEqual([1, 1, 0]);
    const bl = dv.getUint32(20 + jl, true);
    expect(dv.getUint32(24 + jl, true)).toBe(0x00_4e_49_42);
    expect(28 + jl + bl).toBe(bytes.byteLength);
    for (const v of json.bufferViews) {
      expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(bl);
    }
  });

  it('writes a custom attribute by its name and size', () => {
    const tri = {
      position: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
      normal: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
      uv: Float32Array.of(0, 0, 1, 0, 0, 1),
    };
    const bytes = writeGlb('thing', [
      {
        material: 'knit',
        ...tri,
        index: Uint32Array.of(0, 1, 2),
        extra: [{ name: '_AO', size: 2, data: Float32Array.of(1, 0.5, 0.25, 1, 1, 1) }],
      },
    ]);
    const jl = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true);
    const json = jsonOf(bytes, jl),
      prim = must(must(json.meshes[0]).primitives[0]);
    const acc = must(json.accessors[must(prim.attributes['_AO'])]),
      at = 28 + jl + must(json.bufferViews[acc.bufferView]).byteOffset;
    expect(acc).toMatchObject({ count: 3, type: 'VEC2' });
    expect([...new Float32Array(bytes.slice(at, at + 24).buffer)]).toStrictEqual([1, 0.5, 0.25, 1, 1, 1]);
  });
});
