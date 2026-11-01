// `node tools/make-models.mjs`: writes the glTF models of `public/models/` (the 3D parts that wear one, features/board/render/three/models3d.ts). Each is a
// unit-sized .glb built here from boxes, so the file can be regenerated and changed in code. x and y span 0..1 (the part is stretched to its socket),
// z stands up off the board.
import { mkdirSync, writeFileSync } from 'node:fs';

/** A box's 24 vertices (flat normals) and 36 indices, appended to the lists. */
function box(P, N, I, [x0, y0, z0], [x1, y1, z1]) {
  const faces = [
    [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]], [[-1, 0, 0], [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]],
    [[0, 1, 0], [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]]], [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]], [[0, 0, -1], [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]]],
  ];
  for (const [n, vs] of faces) {
    const b = P.length / 3;
    for (const v of vs) { P.push(...v); N.push(...n); }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}

/** The .glb bytes of a model: one mesh, one material (`color` 0xRRGGBB). */
function glb(P, N, I, color, metal, rough) {
  const pos = new Float32Array(P), nor = new Float32Array(N), idx = new Uint16Array(I);
  const parts = [pos, nor, idx].map((a) => Buffer.from(a.buffer));
  const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const bin = Buffer.concat(parts.map(pad)), offs = [0, pad(parts[0]).length, pad(parts[0]).length + pad(parts[1]).length];
  const lo = [0, 0, 0].map((k) => Math.min(...P.filter((_, i) => i % 3 === k))), hi = [0, 0, 0].map((k) => Math.max(...P.filter((_, i) => i % 3 === k)));
  const c = [(color >> 16) & 255, (color >> 8) & 255, color & 255].map((v) => Math.pow(v / 255, 2.2));
  const json = JSON.stringify({
    asset: { version: '2.0', generator: 'tools/make-models.mjs' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: metal, roughnessFactor: rough } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5126, count: N.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: I.length, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: offs[0], byteLength: parts[0].length, target: 34962 }, { buffer: 0, byteOffset: offs[1], byteLength: parts[1].length, target: 34962 }, { buffer: 0, byteOffset: offs[2], byteLength: parts[2].length, target: 34963 }],
    buffers: [{ byteLength: bin.length }],
  });
  const j = Buffer.from(json + ' '.repeat((4 - (json.length % 4)) % 4));
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bin.length, 8);
  jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, j, bh, bin]);
}

// a finned heat sink: a base plate and a row of rails with a notched crown
{
  const P = [], N = [], I = [], n = 9;
  box(P, N, I, [0, 0, 0], [1, 1, 0.16]);
  for (let i = 0; i < n; i++) {
    const x0 = 0.04 + (i * 0.92) / n, w = 0.92 / n * 0.46;
    box(P, N, I, [x0, 0.03, 0.16], [x0 + w, 0.97, 1]);
    box(P, N, I, [x0 - 0.004, 0.03, 0.9], [x0 + w + 0.004, 0.97, 1]);
  }
  mkdirSync('public/models', { recursive: true });
  writeFileSync('public/models/sink-fins.glb', glb(P, N, I, 0x8590b5, 0.75, 0.32));
}
console.log('wrote public/models/sink-fins.glb');
