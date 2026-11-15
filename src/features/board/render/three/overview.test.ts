// The machine at the room overview (LPC5): every still mesh draws in a stand-in, so the draw count falls far below the board view's.
import { describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import { LOD_OVERVIEW, drawnMeshes } from '@/core/render/three/partlod';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

/** The ceiling of the machine's draws at the overview. It may only fall. */
const CEILING = 182;

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
    // (a mesh with a list of materials draws once for each group of its geometry)
    const calls = (): number => { let n = 0; machine.root.traverseVisible((o) => { const m = o as Mesh; if (m.isMesh && (m.layers.mask & 1)) n += Array.isArray(m.material) ? Math.max(1, m.geometry.groups.length) : 1; }); return n; };
    console.log(`machine: ${near} draws near, ${far} at the overview, ${calls()} calls there (build ${ms})`);
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.OVERVIEW_DUMP === '1') {
      // what still draws: the stand-ins by anchor, and the meshes left out by reason
      const why = new Map<string, number>(), add = (k: string) => why.set(k, (why.get(k) ?? 0) + 1);
      machine.root.traverseVisible((o) => {
        const m = o as Mesh, mat = m.material as MeshStandardMaterial;
        if (!m.isMesh || !(m.layers.mask & 1)) return;
        let anchor = ''; for (let p: Object3D | null = o; p; p = p.parent) if (typeof p.userData.id === 'string') { anchor = p.userData.id as string; break; }
        let moving = ''; for (let p: Object3D | null = o; p; p = p.parent) for (const k of ['spin', 'live', 'rig']) if (p.userData[k]) moving = `${k} ${p.name}`;
        if (m.userData.standIn) add(`stand-in: under ${m.parent?.userData.id ?? m.parent?.name ?? '?'} ${Object.keys(m.geometry.attributes).join(',')} ${mat.side} ${mat.map ? 'map' : ''} ${mat.metalness > 0.5 ? 'metal' : ''} ${m.castShadow}${m.receiveShadow}`);
        else if (moving) add(`moving: ${moving} ${anchor.replace(/\d+$/, '#')} | ${Array.isArray(mat) ? 'multi' : `${m.name || m.geometry.type} ${(m as { isInstancedMesh?: boolean }).isInstancedMesh ? 'inst' : ''} ${mat.map ? 'map' : ''} ${mat.transparent ? 'clear' : ''} ${mat.emissiveIntensity > 0 && mat.emissive?.getHex() ? 'glow' : ''} side${mat.side} ${Object.keys(m.userData).join(',')} ${m.castShadow}`}`);
        else if (Array.isArray(mat)) add(`multi-material: ${anchor.replace(/\d+$/, '#') || 'case'} x${mat.length} in ${m.geometry.groups.length} groups, ${m.geometry.type} ${m.geometry.attributes.position?.count}, ${new Set(mat as MeshStandardMaterial[]).size} distinct`);
        else if (mat.transparent || mat.opacity !== 1) add(`see-through: ${anchor.replace(/\d+$/, '#') || 'case'} ${mat.emissiveIntensity > 0 && mat.emissive.getHex() ? 'glow' : 'glass'} ${m.geometry.type}`);
        else if ((m as { isInstancedMesh?: boolean }).isInstancedMesh) add('instanced, left out');
        else add(`other: ${anchor || 'case'} ${m.name} ${m.geometry.attributes.position?.count}`);
      });
      console.log([...why].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}  ${k}`).join('\n'));
    }
    expect(far).toBeLessThan(near);
    expect(far).toBeLessThanOrEqual(CEILING);
  }, 30_000);
});
