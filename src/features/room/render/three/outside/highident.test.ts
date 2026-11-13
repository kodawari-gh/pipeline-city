// High's city identity: a High `OutsideView` (detail omitted) fingerprinted per top-level group of its scene against
// `highident.expected.json`. A change to what High draws fails here. Refresh the golden from this branch's High:
//   UPDATE_HIGH_GOLDEN=1 npx vitest run src/features/room/render/three/outside/highident.test.ts
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { describe, expect, it } from 'vitest';
import { Matrix4, Object3D, type BufferAttribute, type InstancedMesh, type Mesh, type Scene } from 'three';
import { drawn } from './sweep';
import { OutsideView } from './view';

const fs = fsMod as any;
const GOLDEN: string = urlMod.fileURLToPath(new URL('./highident.expected.json', import.meta.url));

/** One group's fingerprint: its meshes, the meshes a camera draws, the triangles those draw (instances counted), its vertices and instances, and a hash of them. */
interface Row { meshes: number; draws: number; tris: number; verts: number; instances: number; sum: string }

/** A 32-bit hash of rounded numbers, in the order they are added. */
class Hash {
  private h = 0x811c9dc5;
  add(n: number): void {
    const q = Math.round(n * 1000) | 0;
    this.h = Math.imul(this.h ^ q, 0x01000193);
    this.h ^= this.h >>> 15;
  }
  hex(): string { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

interface Acc { meshes: number; draws: number; tris: number; verts: number; instances: number; h: Hash }

/** The top-level child of the scene that holds an object: its name (or type) and its index, so a group keeps its key while it keeps its place. */
function groupOf(scene: Object3D, o: Object3D): string {
  let top: Object3D = o;
  while (top.parent && top.parent !== scene) top = top.parent;
  const i = scene.children.indexOf(top);
  return `${top.name || top.type}#${i}`;
}

/** Each group of the scene, fingerprinted: each mesh's world-space vertex positions, its instances' world matrices, and whether a camera draws it. */
function fingerprint(scene: Scene): Record<string, Row> {
  const acc = new Map<string, Acc>();
  const pos = new Matrix4(), inst = new Matrix4();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const mesh = o as Mesh;
    const key = groupOf(scene, o);
    const g = acc.get(key) ?? { meshes: 0, draws: 0, tris: 0, verts: 0, instances: 0, h: new Hash() };
    acc.set(key, g);
    g.meshes += 1;
    const im = mesh as InstancedMesh;
    const copies = im.isInstancedMesh ? im.count : 1;
    const indices = drawn(mesh.geometry);
    const drawnHere = mesh.visible && indices > 0;
    if (drawnHere) { g.draws += 1; g.tris += (indices / 3) * copies; }
    g.h.add(drawnHere ? 1 : 0);
    const attr = mesh.geometry.attributes.position as BufferAttribute | undefined;
    if (attr) {
      g.verts += attr.count;
      const e = pos.copy(mesh.matrixWorld).elements;
      for (let i = 0; i < attr.count; i++) {
        const x = attr.getX(i), y = attr.getY(i), z = attr.getZ(i);
        g.h.add(e[0]! * x + e[4]! * y + e[8]! * z + e[12]!);
        g.h.add(e[1]! * x + e[5]! * y + e[9]! * z + e[13]!);
        g.h.add(e[2]! * x + e[6]! * y + e[10]! * z + e[14]!);
      }
    }
    if (im.isInstancedMesh) {
      g.instances += im.count;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, inst).premultiply(mesh.matrixWorld);
        for (const n of inst.elements) g.h.add(n);
      }
    }
  });
  return Object.fromEntries([...acc].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, g]) => [k, { meshes: g.meshes, draws: g.draws, tris: Math.round(g.tris), verts: g.verts, instances: g.instances, sum: g.h.hex() }]));
}

/** The golden, or null while it is unwritten or empty. */
function readGolden(): Record<string, Row> | null {
  if (!fs.existsSync(GOLDEN)) return null;
  const text = (fs.readFileSync(GOLDEN, 'utf8') as string).trim();
  if (!text) return null;
  const parsed = JSON.parse(text) as Record<string, Row>;
  return Object.keys(parsed).length ? parsed : null;
}

const measure = (): Record<string, Row> => {
  const view = new OutsideView(0, 0, 10, 10, 0);
  return fingerprint((view as unknown as { scene: Scene }).scene);
};

describe('High builds the same city', () => {
  it('matches highident.expected.json, group by group', () => {
    const got = measure();
    const rows = Object.values(got);
    const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
    console.log(`High city identity: ${rows.length} groups, ${sum((r) => r.meshes)} meshes, ${sum((r) => r.draws)} draws, ${sum((r) => r.tris)} tris, ${sum((r) => r.verts)} verts, ${sum((r) => r.instances)} instances`);
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    if (env.UPDATE_HIGH_GOLDEN === '1') {
      fs.writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
      return;
    }
    const want = readGolden();
    expect(want, 'no High city golden yet: fill highident.expected.json (UPDATE_HIGH_GOLDEN=1 npx vitest run src/features/room/render/three/outside/highident.test.ts)').not.toBeNull();
    expect(got).toEqual(want);
  }, 180000);
});
