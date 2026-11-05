// A minimal binary glTF writer for baked meshes (docs/render/cloth.md): one node, one mesh, a primitive per material with its position,
// normal, uv, indices and any custom attributes. The materials carry only their names: the game puts its own on them by name. Pure: bytes
// in, bytes out.

/** A custom attribute: `size` floats a vertex. glTF wants its name to start with `_`; three's loader reads it in lower case (`_AO` is `_ao`). */
export interface GlbExtra { name: string; size: number; data: Float32Array }

export interface GlbPrimitive { material: string; position: Float32Array; normal: Float32Array; uv: Float32Array; index: Uint32Array; extra?: readonly GlbExtra[] }

const pad4 = (n: number): number => (n + 3) & ~3;
const TYPE = ['', 'SCALAR', 'VEC2', 'VEC3', 'VEC4'];

export function writeGlb(name: string, prims: readonly GlbPrimitive[]): Uint8Array {
  const views: { offset: number; length: number; target: number }[] = [], accessors: Record<string, unknown>[] = [], chunks: Uint8Array[] = [];
  let size = 0;
  const add = (bytes: Uint8Array, target: number) => {
    views.push({ offset: size, length: bytes.byteLength, target });
    chunks.push(bytes);
    size = pad4(size + bytes.byteLength);
    return views.length - 1;
  };
  const vec = (a: Float32Array, k: number, type: string, bounds = false) => {
    const view = add(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), 34962), count = a.length / k;
    const acc: Record<string, unknown> = { bufferView: view, componentType: 5126, count, type };
    if (bounds) {
      const min = Array<number>(k).fill(Infinity), max = Array<number>(k).fill(-Infinity);
      for (let i = 0; i < count; i++) for (let c = 0; c < k; c++) { min[c] = Math.min(min[c]!, a[i * k + c]!); max[c] = Math.max(max[c]!, a[i * k + c]!); }
      Object.assign(acc, { min, max });
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const materials = [...new Set(prims.map((p) => p.material))];
  const primitives = prims.map((p) => {
    const small = p.position.length / 3 < 65536, idx = small ? Uint16Array.from(p.index) : p.index;
    const attributes: Record<string, number> = { POSITION: vec(p.position, 3, 'VEC3', true), NORMAL: vec(p.normal, 3, 'VEC3'), TEXCOORD_0: vec(p.uv, 2, 'VEC2') };
    for (const x of p.extra ?? []) attributes[x.name] = vec(x.data, x.size, TYPE[x.size]!);
    const view = add(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength), 34963);
    accessors.push({ bufferView: view, componentType: small ? 5123 : 5125, count: idx.length, type: 'SCALAR' });
    return { attributes, indices: accessors.length - 1, material: materials.indexOf(p.material) };
  });
  const json = {
    asset: { version: '2.0', generator: 'pipeline-city cloth bake' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }], meshes: [{ name, primitives }],
    materials: materials.map((m) => ({ name: m })),
    accessors, bufferViews: views.map((v) => ({ buffer: 0, byteOffset: v.offset, byteLength: v.length, target: v.target })), buffers: [{ byteLength: size }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json)), jl = pad4(text.byteLength), total = 12 + 8 + jl + 8 + size;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jl); out.set(text, 20);
  dv.setUint32(20 + jl, size, true); dv.setUint32(24 + jl, 0x004e4942, true);
  let at = 28 + jl;
  views.forEach((v, i) => { out.set(chunks[i]!, at + v.offset); });
  at += size;
  return out.subarray(0, at);
}
