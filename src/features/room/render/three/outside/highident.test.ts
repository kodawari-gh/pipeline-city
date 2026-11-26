// High's city identity: a High `OutsideView` (detail omitted) fingerprinted per top-level group of its scene against
// `highident.expected.json`. A change to what High draws fails here. Refresh the golden from this branch's High:
//   UPDATE_HIGH_GOLDEN=1 npx vitest run src/features/room/render/three/outside/highident.test.ts
import { assert, describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Matrix4, Mesh } from 'three';
import type * as threeTypes from 'three';
import { drawn } from './sweep';
import { OutsideView } from './view';

/** The parts of `node:fs` this test reads and writes the golden with. */
interface NodeFs {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: 'utf8') => string;
  writeFileSync: (path: string, data: string) => void;
}

/** The part of `node:url` this test uses. */
interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}

/** The part of `node:process` this test reads: the switch that refreshes the golden. */
interface NodeProcess {
  env: Record<string, string | undefined>;
}

const fs = await vi.importActual<NodeFs>('node:fs');
const { env } = await vi.importActual<NodeProcess>('node:process');
const { fileURLToPath } = await vi.importActual<NodeUrl>('node:url');
const GOLDEN: string = fileURLToPath(new URL('highident.expected.json', import.meta.url));

/** Whether an object is a mesh. */
const isMesh = (o: unknown): o is threeTypes.Mesh => o instanceof Mesh;

/** Whether a mesh is instanced. */
const isInstanced = (o: unknown): o is threeTypes.InstancedMesh => o instanceof InstancedMesh;

/** Orders two keys by their code units (as a plain sort does). */
function byCode(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** One group's fingerprint: its meshes, the meshes a camera draws, the triangles those draw (instances counted), its vertices and instances, and a hash of them. */
interface Row {
  meshes: number;
  draws: number;
  tris: number;
  verts: number;
  instances: number;
  sum: string;
}

/** A 32-bit hash of rounded numbers, in the order they are added. */
class Hash {
  private h = 0x81_1c_9d_c5;
  add(n: number): void {
    const q = Math.trunc(Math.round(n * 1000));
    this.h = Math.imul(this.h ^ q, 0x01_00_01_93);
    this.h ^= this.h >>> 15;
  }
  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}

interface Acc {
  meshes: number;
  draws: number;
  tris: number;
  verts: number;
  instances: number;
  h: Hash;
}

/** The top-level child of the scene that holds an object: its name (or type) and its index, so a group keeps its key while it keeps its place. */
function groupOf(scene: threeTypes.Object3D, o: threeTypes.Object3D): string {
  let top: threeTypes.Object3D = o;
  while (top.parent && top.parent !== scene) {
    top = top.parent;
  }
  const i = scene.children.indexOf(top);
  return `${top.name || top.type}#${i}`;
}

/** Each group of the scene, fingerprinted: each mesh's world-space vertex positions, its instances' world matrices, and whether a camera draws it. */
function fingerprint(scene: threeTypes.Scene): Record<string, Row> {
  const acc = new Map<string, Acc>();
  const pos = new Matrix4(),
    inst = new Matrix4();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!isMesh(o)) {
      return;
    }
    const mesh = o;
    const key = groupOf(scene, o);
    const g = acc.get(key) ?? { meshes: 0, draws: 0, tris: 0, verts: 0, instances: 0, h: new Hash() };
    acc.set(key, g);
    g.meshes += 1;
    const im = isInstanced(mesh) ? mesh : null;
    const copies = im ? im.count : 1;
    const indices = drawn(mesh.geometry);
    const drawnHere = mesh.visible && indices > 0;
    if (drawnHere) {
      g.draws += 1;
      g.tris += (indices / 3) * copies;
    }
    g.h.add(drawnHere ? 1 : 0);
    const attr = mesh.geometry.attributes['position'];
    if (attr) {
      g.verts += attr.count;
      const e = pos.copy(mesh.matrixWorld).elements;
      for (let i = 0; i < attr.count; i++) {
        const x = attr.getX(i),
          y = attr.getY(i),
          z = attr.getZ(i);
        g.h.add(e[0] * x + e[4] * y + e[8] * z + e[12]);
        g.h.add(e[1] * x + e[5] * y + e[9] * z + e[13]);
        g.h.add(e[2] * x + e[6] * y + e[10] * z + e[14]);
      }
    }
    if (im) {
      g.instances += im.count;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, inst).premultiply(mesh.matrixWorld);
        for (const n of inst.elements) {
          g.h.add(n);
        }
      }
    }
  });
  return Object.fromEntries(
    [...acc]
      .toSorted(([a], [b]) => byCode(a, b))
      .map(([k, g]) => [
        k,
        {
          meshes: g.meshes,
          draws: g.draws,
          tris: Math.round(g.tris),
          verts: g.verts,
          instances: g.instances,
          sum: g.h.hex(),
        },
      ]),
  );
}

/** Whether a value is a fingerprint row. */
const isRow = (r: unknown): r is Row =>
  typeof r === 'object' &&
  r !== null &&
  ['meshes', 'draws', 'tris', 'verts', 'instances'].every(
    (k) => typeof new Map(Object.entries(r)).get(k) === 'number',
  ) &&
  typeof new Map(Object.entries(r)).get('sum') === 'string';

/** Whether a value is a table of fingerprint rows by group. */
const isRows = (o: unknown): o is Record<string, Row> =>
  typeof o === 'object' && o !== null && Object.values(o).every((r) => isRow(r));

/** The golden, or null while it is unwritten or empty. */
function readGolden(): Record<string, Row> | null {
  if (!fs.existsSync(GOLDEN)) {
    return null;
  }
  const text = fs.readFileSync(GOLDEN, 'utf8').trim();
  if (!text) {
    return null;
  }
  const parsed: unknown = JSON.parse(text);
  assert(isRows(parsed), 'the golden is a table of group fingerprints');
  return Object.keys(parsed).length > 0 ? parsed : null;
}

const measure = (): Record<string, Row> => {
  const view = new OutsideView(0, 0, 10, 10, 0);
  return fingerprint(view.scene);
};

/** What to match: the golden; or, refreshing it (UPDATE_HIGH_GOLDEN=1), what this branch's High drew, written as the new golden. */
function goldenFor(got: Record<string, Row>): Record<string, Row> | null {
  if (env['UPDATE_HIGH_GOLDEN'] === '1') {
    fs.writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    return got;
  }
  return readGolden();
}

describe('High builds the same city', () => {
  it('matches highident.expected.json, group by group', async ({ annotate }) => {
    const got = measure();
    const rows = Object.values(got);
    const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
    await annotate(
      `High city identity: ${rows.length} groups, ${sum((r) => r.meshes)} meshes, ${sum((r) => r.draws)} draws, ${sum((r) => r.tris)} tris, ${sum((r) => r.verts)} verts, ${sum((r) => r.instances)} instances`,
    );
    const want = goldenFor(got);
    expect(
      want,
      'no High city golden yet: fill highident.expected.json (UPDATE_HIGH_GOLDEN=1 npx vitest run src/features/room/render/three/outside/highident.test.ts)',
    ).not.toBeNull();
    expect(got).toStrictEqual(want);
  }, 180_000);
});
