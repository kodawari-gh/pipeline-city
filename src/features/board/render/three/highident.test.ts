// High's identity: the maxed machine (merged, with LOD, as the room builds it) and the room's props, fingerprinted per group against
// `highident.expected.json`. A change to what High draws fails here. Refresh the golden from main: UPDATE_HIGH_GOLDEN=1 npx vitest run <this file>.
// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { describe, expect, it } from 'vitest';
import { Matrix4, Object3D, type BufferAttribute, type InstancedMesh, type Mesh } from 'three';
import { Room3D } from '@/features/room/render/three/room3d';
import { idOf, shown } from '@/core/render/three/pick';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

const fs = fsMod as any;
const GOLDEN: string = urlMod.fileURLToPath(new URL('./highident.expected.json', import.meta.url));

/** One group's fingerprint: its meshes, the draws a camera on layer 0 makes (a Mesh or an InstancedMesh is one), its vertices and instances, and a hash of them. */
interface Row { meshes: number; draws: number; verts: number; instances: number; sum: string }

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

/** The group a mesh belongs to: its nearest tagged ancestor's id, else the top-level child of its root that holds it (by name, or by index). */
function groupOf(root: Object3D, prefix: string, o: Object3D): string {
  const id = idOf(o);
  if (id) return `${prefix}/${id}`;
  let top: Object3D = o;
  while (top.parent && top.parent !== root) top = top.parent;
  const i = root.children.indexOf(top);
  return `${prefix}/${top.name || `${top.type}#${i}`}`;
}

interface Acc { meshes: number; draws: number; verts: number; instances: number; h: Hash }

/** Each group of each root, fingerprinted: each mesh's world-space vertex positions, its instances' world matrices, and whether a camera draws it. */
function fingerprint(roots: [string, Object3D][]): Record<string, Row> {
  const acc = new Map<string, Acc>();
  const pos = new Matrix4(), inst = new Matrix4();
  for (const [prefix, root] of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      const mesh = o as Mesh;
      const key = groupOf(root, prefix, o);
      const g = acc.get(key) ?? { meshes: 0, draws: 0, verts: 0, instances: 0, h: new Hash() };
      acc.set(key, g);
      g.meshes += 1;
      const drawn = shown(o) && (mesh.layers.mask & 1) !== 0 && [mesh.material].flat().some((x) => x.visible);
      if (drawn) g.draws += 1;
      g.h.add(drawn ? 1 : 0);
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
      if ((mesh as InstancedMesh).isInstancedMesh) {
        const im = mesh as InstancedMesh;
        g.instances += im.count;
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, inst).premultiply(mesh.matrixWorld);
          for (const n of inst.elements) g.h.add(n);
        }
      }
    });
  }
  return Object.fromEntries([...acc].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, g]) => [k, { meshes: g.meshes, draws: g.draws, verts: g.verts, instances: g.instances, sum: g.h.hex() }]));
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
  const machine = buildMachine(maxedSnapshot(), true, true);
  const room = new Room3D();
  return fingerprint([['machine', machine.root], ['room', room.root]]);
};

describe('High builds the same machine and room', () => {
  it('matches highident.expected.json, group by group', () => {
    const got = measure();
    const rows = Object.values(got);
    const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
    console.log(`High identity: ${rows.length} groups, ${sum((r) => r.meshes)} meshes, ${sum((r) => r.draws)} draws, ${sum((r) => r.verts)} verts, ${sum((r) => r.instances)} instances`);
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    if (env.UPDATE_HIGH_GOLDEN === '1') {
      fs.writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
      return;
    }
    const want = readGolden();
    expect(want, 'no High golden yet: fill highident.expected.json from origin/main (UPDATE_HIGH_GOLDEN=1 npx vitest run highident.test.ts)').not.toBeNull();
    expect(got).toEqual(want);
  }, 20_000);
});
