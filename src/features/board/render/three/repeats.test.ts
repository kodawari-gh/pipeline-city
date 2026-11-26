// The repeated meshes of the High machine and room (LPC3): equal meshes (same vertex count, same size, same material look) that draw more
// than 4 times are the sets to instance. The count of draws they would save is held as a ceiling; `REPEATS_DUMP=1` lists the sets.
import { describe, expect, it, vi } from 'vitest';
import * as three from 'three';
import { Room3D } from '@/features/room/render/three/room3d';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Returns `value` when it is present, otherwise `fallback`. */
function or<T>(value: T, fallback: NonNullable<T>): NonNullable<T> {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}

function asKeyPart(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v);
  }
  return '';
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

quietCanvas();

function hexStringOf(color: unknown): string | undefined {
  if (typeof color !== 'object' || color === null || !('getHexString' in color)) {
    return undefined;
  }
  const { getHexString } = color;
  if (typeof getHexString !== 'function') {
    return undefined;
  }
  const n: unknown = getHexString.call(color);
  return typeof n === 'string' ? n : undefined;
}

function uuidOf(map: unknown): string {
  if (typeof map !== 'object' || map === null || !('uuid' in map)) {
    return '';
  }
  const { uuid } = map;
  return typeof uuid === 'string' ? uuid : '';
}

const shown = (o: three.Object3D): boolean => {
  for (let x: three.Object3D | null = o; x; x = x.parent) {
    if (!x.visible) {
      return false;
    }
  }
  return true;
};

/** The sets of equal drawn meshes under `root` with more than `min` members: a key (vertices, size, look), its count, the first member's path. */
export function repeats(
  root: three.Object3D,
  min = 4,
): { key: string; n: number; verts: number; at: string; up: string }[] {
  const sets = new Map<string, { n: number; verts: number; at: string; ups: Set<unknown>[] }>(),
    size = new three.Vector3(),
    box = new three.Box3();
  root.updateMatrixWorld(true);
  const countDraw = (mesh: three.Mesh, o: three.Object3D): void => {
    const g = mesh.geometry,
      m = mesh.material;
    if (Array.isArray(m)) {
      return;
    }
    const verts = or(g.attributes['position']?.count, 0);
    if (!g.boundingBox) {
      g.computeBoundingBox();
    }
    box.copy(must(g.boundingBox)).getSize(size);
    const color = hexStringOf('color' in m ? m.color : undefined);
    const metalness = 'metalness' in m ? m.metalness : undefined;
    const roughness = 'roughness' in m ? m.roughness : undefined;
    const mapId = uuidOf('map' in m ? m.map : undefined);
    const key = `${verts}|${size.x.toFixed(0)},${size.y.toFixed(0)},${size.z.toFixed(0)}|${asKeyPart(color)},${asKeyPart(metalness)},${asKeyPart(roughness)},${asKeyPart(mapId)},${asKeyPart(m.transparent)}`;
    const s = sets.get(key);
    if (s) {
      s.n++;
    } else {
      const path: string[] = [];
      for (let x: three.Object3D | null = o; x && path.length < 4; x = x.parent) {
        const id: unknown = x.userData['id'];
        if (x.name !== '') {
          path.push(x.name);
        } else if (typeof id === 'string') {
          path.push(id);
        }
      }
      sets.set(key, { n: 1, verts, at: path.toReversed().join('/'), ups: [new Set(), new Set()] });
    }
    const { ups } = must(sets.get(key));
    must(ups[0]).add(o.parent);
    must(ups[1]).add(o.parent?.parent);
  };
  const recordDraw = (o: three.Object3D): void => {
    if (!isMesh(o)) {
      return;
    }
    const mesh = asMesh(o);
    if (
      !mesh.isMesh ||
      ('isInstancedMesh' in mesh && mesh.isInstancedMesh === true) ||
      !shown(o) ||
      Array.isArray(mesh.material)
    ) {
      return;
    }
    // (drawn only, as `highident` counts: a pick box on the undrawn layer (`unseen`) or a hidden material makes no draw to save)
    if ((mesh.layers.mask & 1) === 0 || !mesh.material.visible) {
      return;
    }
    countDraw(mesh, o);
  };
  root.traverse(recordDraw);
  return [...sets]
    .filter(([, s]) => s.n > min)
    .map(([key, { ups, n, verts, at }]) => ({
      key,
      n,
      verts,
      at,
      up: `${must(ups[0]).size} parents, ${must(ups[1]).size} above`,
    }))
    .toSorted((a, b) => b.n - a.n);
}

/** The parts of `node:process` this test uses: the dump switch and the place the report goes. */
interface NodeProcess {
  env: Record<string, string | undefined>;
  stdout: { write: (text: string) => boolean };
}

const { env, stdout } = await vi.importActual<NodeProcess>('node:process');

/** The draws that instancing every set would save (members less one per set): the machine, the room. It may only fall. (49: the NAND packages of the three NVMe sticks are caps over dies, each with materials of its own. 64: the RAM sticks' chip and plate meshes, one set per stick, for the routed copper and tier ladder.) */
const CEILING = { machine: 64, room: 4 };

function assert_stay_under_the_ceiling_of_draws_to_save(): void {
  for (const [name, root] of [
    ['machine', buildMachine(maxedSnapshot(), true, true).root],
    ['room', new Room3D().root],
  ] as const) {
    const sets = repeats(root),
      save = sets.reduce((a, s) => a + s.n - 1, 0);
    stdout.write(`${name}: ${sets.length} sets of more than 4 equal meshes, ${save} draws to save\n`);
    if (env['REPEATS_DUMP'] === '1') {
      stdout.write(`${sets.map((s) => `${s.n} x ${s.verts} verts  ${s.at}  ${s.key}  ${s.up}`).join('\n')}\n`);
    }
    expect(save).toBeLessThanOrEqual(CEILING[name]);
  }
}

describe('the repeated meshes', () => {
  it('stay under the ceiling of draws to save', () => {
    expect.hasAssertions();
    assert_stay_under_the_ceiling_of_draws_to_save();
  }, 120_000);
});
