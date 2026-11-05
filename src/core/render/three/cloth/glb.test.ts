import { describe, expect, it } from 'vitest';
import { writeGlb } from './glb';

describe('glb writer', () => {
  it('writes a binary glTF: header, a JSON chunk naming the materials, a binary chunk the views fit in', () => {
    const tri = { position: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), normal: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1), uv: Float32Array.of(0, 0, 1, 0, 0, 1) };
    const bytes = writeGlb('thing', [{ material: 'knit', ...tri, index: Uint32Array.of(0, 1, 2) }, { material: 'rib', ...tri, index: Uint32Array.of(0, 2, 1) }]);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(bytes.byteLength);
    const jl = dv.getUint32(12, true);
    expect(dv.getUint32(16, true)).toBe(0x4e4f534a);
    expect(jl % 4).toBe(0);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jl))) as {
      nodes: { name: string }[]; materials: { name: string }[]; meshes: { primitives: { material: number; indices: number }[] }[];
      accessors: { count: number; min?: number[]; max?: number[]; componentType: number }[]; bufferViews: { byteOffset: number; byteLength: number }[];
    };
    expect(json.nodes[0]!.name).toBe('thing');
    expect(json.materials.map((m) => m.name)).toEqual(['knit', 'rib']);
    expect(json.meshes[0]!.primitives.map((p) => p.material)).toEqual([0, 1]);
    // small meshes take 16-bit indices
    expect(json.accessors[json.meshes[0]!.primitives[0]!.indices]!.componentType).toBe(5123);
    expect(json.accessors[0]!.max).toEqual([1, 1, 0]);
    const bl = dv.getUint32(20 + jl, true);
    expect(dv.getUint32(24 + jl, true)).toBe(0x004e4942);
    expect(28 + jl + bl).toBe(bytes.byteLength);
    for (const v of json.bufferViews) expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(bl);
  });
});
