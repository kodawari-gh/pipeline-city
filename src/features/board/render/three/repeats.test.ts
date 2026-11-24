// The repeated meshes of the High machine and room (LPC3): equal meshes (same vertex count, same size, same material look) that draw more
// than 4 times are the sets to instance. The count of draws they would save is held as a ceiling; `REPEATS_DUMP=1` lists the sets.
import { describe, expect, it } from 'vitest';
import { Box3, Vector3, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { Room3D } from '@/features/room/render/three/room3d';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

const shown = (o: Object3D): boolean => {
  for (let x: Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
};

/** The sets of equal drawn meshes under `root` with more than `min` members: a key (vertices, size, look), its count, the first member's path. */
export function repeats(root: Object3D, min = 4): { key: string; n: number; verts: number; at: string; up: string }[] {
  const sets = new Map<string, { n: number; verts: number; at: string; ups: Set<unknown>[] }>(),
    size = new Vector3(),
    box = new Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (
      !mesh.isMesh ||
      (mesh as { isInstancedMesh?: boolean }).isInstancedMesh ||
      !shown(o) ||
      Array.isArray(mesh.material)
    )
      return;
    // (drawn only, as `highident` counts: a pick box on the undrawn layer (`unseen`) or a hidden material makes no draw to save)
    if ((mesh.layers.mask & 1) === 0 || !mesh.material.visible) return;
    const g = mesh.geometry,
      m = mesh.material as MeshStandardMaterial,
      verts = g.attributes['position']?.count ?? 0;
    if (!g.boundingBox) g.computeBoundingBox();
    box.copy(g.boundingBox!).getSize(size);
    const key = `${verts}|${size.x.toFixed(0)},${size.y.toFixed(0)},${size.z.toFixed(0)}|${m.color?.getHexString()},${m.metalness},${m.roughness},${m.map?.uuid ?? ''},${m.transparent}`;
    const s = sets.get(key);
    if (s) s.n++;
    else {
      const path: string[] = [];
      for (let x: Object3D | null = o; x && path.length < 4; x = x.parent)
        if (x.name || typeof x.userData['id'] === 'string') path.push(x.name || (x.userData['id'] as string));
      sets.set(key, { n: 1, verts, at: path.reverse().join('/'), ups: [new Set(), new Set()] });
    }
    const ups = sets.get(key)!.ups;
    ups[0]!.add(o.parent);
    ups[1]!.add(o.parent?.parent);
  });
  return [...sets]
    .filter(([, s]) => s.n > min)
    .map(([key, { ups, ...s }]) => ({ key, ...s, up: `${ups[0]!.size} parents, ${ups[1]!.size} above` }))
    .sort((a, b) => b.n - a.n);
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** The draws that instancing every set would save (members less one per set): the machine, the room. It may only fall. (49: the NAND packages of the three NVMe sticks are caps over dies, each with materials of its own. 64: the RAM sticks' chip and plate meshes, one set per stick, for the routed copper and tier ladder.) */
const CEILING = { machine: 64, room: 4 };

describe('the repeated meshes', () => {
  it('stay under the ceiling of draws to save', () => {
    for (const [name, root] of [
      ['machine', buildMachine(maxedSnapshot(), true, true).root],
      ['room', new Room3D().root],
    ] as const) {
      const sets = repeats(root),
        save = sets.reduce((a, s) => a + s.n - 1, 0);
      console.log(`${name}: ${sets.length} sets of more than 4 equal meshes, ${save} draws to save`);
      if (env['REPEATS_DUMP'] === '1')
        console.log(sets.map((s) => `${s.n} x ${s.verts} verts  ${s.at}  ${s.key}  ${s.up}`).join('\n'));
      expect(save, name).toBeLessThanOrEqual(CEILING[name]);
    }
  }, 120_000);
});
