// The machine at the room overview (LPC5): every still mesh draws in a stand-in, so the draw count falls far below the board view's.
import { describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import { LOD_OVERVIEW, drawnMeshes } from '@/core/render/three/partlod';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

/** The ceiling of the machine's draws at the overview. It may only fall. */
const CEILING = 202;

describe('the machine at the room overview', () => {
  it('draws as stand-ins', () => {
    buildMachine(maxedSnapshot(), true, false); // (warm the caches: the next two builds compare)
    const t1 = Date.now(); buildMachine(maxedSnapshot(), true, false); const plain = Date.now() - t1;
    const t0 = Date.now(), machine = buildMachine(maxedSnapshot(), true, true), ms = `${Date.now() - t0} ms, ${plain} ms with no stand-ins`;
    const lod = machine.partLod!;
    lod.update(1);
    const near = drawnMeshes(machine.root);
    lod.update(LOD_OVERVIEW / 2);
    const far = drawnMeshes(machine.root);
    console.log(`machine: ${near} draws near, ${far} at the overview (build ${ms})`);
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.OVERVIEW_DUMP === '1') {
      // what still draws: the stand-ins by anchor, and the meshes left out by reason
      const why = new Map<string, number>(), add = (k: string) => why.set(k, (why.get(k) ?? 0) + 1);
      machine.root.traverseVisible((o) => {
        const m = o as Mesh, mat = m.material as MeshStandardMaterial;
        if (!m.isMesh || !(m.layers.mask & 1)) return;
        let anchor = ''; for (let p: Object3D | null = o; p; p = p.parent) if (typeof p.userData.id === 'string') { anchor = p.userData.id as string; break; }
        let moving = ''; for (let p: Object3D | null = o; p; p = p.parent) for (const k of ['spin', 'live', 'rig']) if (p.userData[k]) moving = `${k} ${p.name}`;
        if (m.userData.standIn) add(`stand-in`);
        else if (moving) add(`moving: ${moving} ${anchor.replace(/\d+$/, '#')}`);
        else if (Array.isArray(mat)) add('multi-material');
        else if (mat.transparent || mat.opacity !== 1) add('see-through');
        else if ((m as { isInstancedMesh?: boolean }).isInstancedMesh) add('instanced, left out');
        else add(`other: ${anchor || 'case'} ${m.name} ${m.geometry.attributes.position?.count}`);
      });
      console.log([...why].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}  ${k}`).join('\n'));
    }
    expect(far).toBeLessThan(near);
    expect(far).toBeLessThanOrEqual(CEILING);
  }, 30_000);
});
