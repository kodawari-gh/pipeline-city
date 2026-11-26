// High's identity: the maxed machine (merged, with LOD, as the room builds it) and the room's props, fingerprinted per group against
// `highident.expected.json`. A change to what High draws fails here. Refresh the golden from main: UPDATE_HIGH_GOLDEN=1 npx vitest run <this file>.
import { describe, expect, it, vi } from 'vitest';
import * as three from 'three';
import { Room3D } from '@/features/room/render/three/room3d';
import { idOf, shown } from '@/core/render/three/pick';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

/** The parts of `node:fs` this test reads and writes the golden with. */
interface NodeFs {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: 'utf8') => string;
  writeFileSync: (path: string, data: string, encoding?: string) => void;
}

/** The part of `node:url` this test uses. */
interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}

/** The parts of `node:process` this test uses: the switch that refreshes the golden, and the place the summary goes. */
interface NodeProcess {
  env: Record<string, string | undefined>;
  stdout: { write: (text: string) => boolean };
}

const fs = await vi.importActual<NodeFs>('node:fs');
const nodeUrl = await vi.importActual<NodeUrl>('node:url');
const { env, stdout } = await vi.importActual<NodeProcess>('node:process');

/** Returns `value` when it is present, otherwise `fallback`. */
function or<T>(value: T, fallback: NonNullable<T>): NonNullable<T> {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

const isInstancedMesh = (o: unknown): o is three.InstancedMesh =>
  typeof o === 'object' && o !== null && 'isInstancedMesh' in o && o.isInstancedMesh === true;

quietCanvas();

const GOLDEN: string = nodeUrl.fileURLToPath(new URL('highident.expected.json', import.meta.url));

/** One group's fingerprint: its meshes, the draws a camera on layer 0 makes (a Mesh or an InstancedMesh is one), its vertices and instances, and a hash of them. */
interface Row {
  meshes: number;
  draws: number;
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

/** The group a mesh belongs to: its nearest tagged ancestor's id, else the top-level child of its root that holds it (by name, or by index). */
function groupOf(root: three.Object3D, prefix: string, o: three.Object3D): string {
  const id = idOf(o);
  if (id !== null && id !== '') {
    return `${prefix}/${id}`;
  }
  let top: three.Object3D = o;
  while (top.parent && top.parent !== root) {
    top = top.parent;
  }
  const i = root.children.indexOf(top);
  return `${prefix}/${top.name || `${top.type}#${i}`}`;
}

interface Acc {
  meshes: number;
  draws: number;
  verts: number;
  instances: number;
  h: Hash;
}

/** Orders two keys by their code units (as a plain sort does). */
function byCode(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** Whether a parsed value is a golden: an object of rows by group. */
function isGolden(v: unknown): v is Record<string, Row> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((r: unknown) => typeof r === 'object' && r !== null && 'sum' in r)
  );
}

/** Each group of each root, fingerprinted: each mesh's world-space vertex positions, its instances' world matrices, and whether a camera draws it. */
function fingerprint(roots: [string, three.Object3D][]): Record<string, Row> {
  const acc = new Map<string, Acc>();
  const pos = new three.Matrix4(),
    inst = new three.Matrix4();
  for (const [prefix, root] of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!isMesh(o)) {
        return;
      }
      const mesh = asMesh(o);
      const key = groupOf(root, prefix, o);
      const g = or(acc.get(key), { meshes: 0, draws: 0, verts: 0, instances: 0, h: new Hash() });
      acc.set(key, g);
      g.meshes += 1;
      const drawn = shown(o) && (mesh.layers.mask & 1) !== 0 && [mesh.material].flat().some((x) => x.visible);
      if (drawn) {
        g.draws += 1;
      }
      g.h.add(drawn ? 1 : 0);
      const attr = mesh.geometry.attributes['position'];
      if (attr !== undefined) {
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
      if (isInstancedMesh(mesh)) {
        g.instances += mesh.count;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, inst).premultiply(mesh.matrixWorld);
          for (const n of inst.elements) {
            g.h.add(n);
          }
        }
      }
    });
  }
  return Object.fromEntries(
    [...acc]
      .toSorted(([a], [b]) => byCode(a, b))
      .map(([k, g]) => [
        k,
        { meshes: g.meshes, draws: g.draws, verts: g.verts, instances: g.instances, sum: g.h.hex() },
      ]),
  );
}

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
  if (!isGolden(parsed)) {
    throw new Error('highident.expected.json must be an object of rows by group');
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

/** The maxed machine and the room, built as the golden builds them. */
function build() {
  const machine = buildMachine(maxedSnapshot(), true, true);
  const room = new Room3D();
  return { machine, room };
}

/** The root an extra child goes under. */
const rootOf = {
  machine: (b: ReturnType<typeof build>): three.Object3D => b.machine.root,
  room: (b: ReturnType<typeof build>): three.Object3D => b.room.root,
};

/**
 * Fingerprint both roots, group by group. Build once per test: `materialKey` mints a `#id` for each texture it meets, and a later build in the
 * same process can merge in another order. The golden is this file's first build.
 */
const measure = ({ machine, room }: ReturnType<typeof build>): Record<string, Row> =>
  fingerprint([
    ['machine', machine.root],
    ['room', room.root],
  ]);

function assert_matches_highident_expected_json_group_by_group(): void {
  const got = measure(build());
  const rows = Object.values(got);
  const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
  stdout.write(
    `High identity: ${rows.length} groups, ${sum((r) => r.meshes)} meshes, ${sum((r) => r.draws)} draws, ${sum((r) => r.verts)} verts, ${sum((r) => r.instances)} instances\n`,
  );
  if (env['UPDATE_HIGH_GOLDEN'] === '1') {
    fs.writeFileSync(GOLDEN, `${JSON.stringify(got, null, 2)}\n`);
    return;
  }
  const want = readGolden();
  expect(
    want,
    'no High golden yet: fill highident.expected.json from origin/main (UPDATE_HIGH_GOLDEN=1 npx vitest run highident.test.ts)',
  ).not.toBeNull();
  expect(got).toStrictEqual(want);
}

describe('High builds the same machine and room', () => {
  it('matches highident.expected.json, group by group', () => {
    expect.hasAssertions();
    assert_matches_highident_expected_json_group_by_group();
  }, 120_000);

  it('names every top-level group, none by its position', () => {
    const got = measure(build());
    expect(Object.keys(got).filter((k) => /#\d+$/u.test(k))).toStrictEqual([]);
  }, 120_000);

  it.each(['machine', 'room'] as const)(
    'an untagged child added to the %s root changes no other key',
    (which) => {
      const built = build();
      const before = measure(built);
      const root = rootOf[which](built);
      const child = new three.Mesh();
      root.children.unshift(child);
      child.parent = root;
      const after = measure(built);
      const added = Object.keys(after).filter((k) => !(k in before));
      expect(added).toHaveLength(1);
      expect(added[0]?.startsWith(`${which}/`)).toBe(true);
      for (const k of Object.keys(before)) {
        expect(after[k]).toStrictEqual(before[k]);
      }
    },
    240_000,
  );
});
