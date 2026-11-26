// The machine at the room overview (LPC5): every still mesh draws in a stand-in, so the draw count falls far below the board view's.
import { describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial, Object3D } from 'three';

import { LOD_OVERVIEW, drawnMeshes } from '@/core/render/three/partlod';
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

const isMesh = (o: unknown): o is Mesh => typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

const isMeshStandardMaterial = (o: unknown): o is MeshStandardMaterial =>
  typeof o === 'object' && o !== null && 'isMeshStandardMaterial' in o && o.isMeshStandardMaterial === true;
function asMeshStandardMaterial(o: unknown): MeshStandardMaterial {
  if (!isMeshStandardMaterial(o)) {
    throw new Error('expected a MeshStandardMaterial');
  }
  return o;
}

quietCanvas();

/**
 * The ceiling of the machine's draws at the overview. It may only fall. (136: the case maker's debossed lockup is one clear decal. 143: the airflow lens's
 * skins. A material that carries a part's temperature joins no palette stand-in, so its meshes draw as one: the radiator's four materials, one for each
 * sink, and the two hoses (one more than the single draw they were in). 151: the NIC's insides are real parts now: its jack's two lamps and its three
 * chip markings keep a material of their own, and its PCB and its parts' odd shadow flags leave a few meshes alone in their sets. 153: the Ethernet chip on the motherboard is a real
 * package with a die: its mould and its marking fade with the zoom, so they keep a material of their own. The board's small parts hide at the overview in the room, so only this count sees them. 155: the packages of the NVMe sticks and the RAM chips are caps over
 * dies (`chipdie3d.ts`): each cap fades alone, so it keeps materials of its own. 163: the top RAM sticks wear spreader plates and a light bar now (`ram3d.ts`, one plate material a side and the glowing bar, eight sticks).)
 */
const CEILING = 163;

function assert_draws_as_stand_ins(): void {
  buildMachine(maxedSnapshot(), true, false); // (warm the caches: the next two builds compare)
  const t1 = Date.now();
  buildMachine(maxedSnapshot(), true, false);
  const plain = Date.now() - t1;
  const t0 = Date.now(),
    machine = buildMachine(maxedSnapshot(), true, true),
    ms = `${Date.now() - t0} ms, ${plain} ms with no stand-ins`;
  const lod = must(machine.partLod);
  lod.update(1);
  const near = drawnMeshes(machine.root);
  lod.update(LOD_OVERVIEW / 2);
  const far = drawnMeshes(machine.root);
  // (a mesh with a list of materials draws once for each group of its geometry)
  const calls = (): number => {
    let n = 0;
    machine.root.traverseVisible((o) => {
      if (!isMesh(o)) {
        return;
      }
      const m = o;
      if (m.layers.mask & 1) {
        n += Array.isArray(m.material) ? Math.max(1, m.geometry.groups.length) : 1;
      }
    });
    return n;
  };
  console.log(`machine: ${near} draws near, ${far} at the overview, ${calls()} calls there (build ${ms})`);
  if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env['OVERVIEW_DUMP'] === '1') {
    // what still draws: the stand-ins by anchor, and the meshes left out by reason
    const why = new Map<string, number>(),
      add = (k: string) => why.set(k, or(why.get(k), 0) + 1);
    machine.root.traverseVisible((o) => {
      if (!isMesh(o)) {
        return;
      }
      const m = asMesh(o),
        mat = asMeshStandardMaterial(m.material);
      if (!m.isMesh || !(m.layers.mask & 1)) {
        return;
      }
      let anchor = '';
      for (let p: Object3D | null = o; p; p = p.parent) {
        if (typeof p.userData['id'] === 'string') {
          anchor = p.userData['id'];
          break;
        }
      }
      let moving = '';
      for (let p: Object3D | null = o; p; p = p.parent) {
        for (const k of ['spin', 'live']) {
          if (p.userData[k]) {
            moving = `${k} ${p.name}`;
          }
        }
      }
      if (m.userData['standIn']) {
        add(
          `stand-in: under ${or(or(m.parent?.userData['id'], m.parent?.name), '?')} ${Object.keys(m.geometry.attributes).join(',')} ${mat.side} ${mat.map ? 'map' : ''} ${mat.metalness > 0.5 ? 'metal' : ''} ${m.castShadow}${m.receiveShadow}`,
        );
      } else if (moving) {
        add(
          `moving: ${moving} ${anchor.replace(/\d+$/u, '#')} | ${Array.isArray(mat) ? 'multi' : `${m.name || m.geometry.type} ${(m as { isInstancedMesh?: boolean }).isInstancedMesh ? 'inst' : ''} ${mat.map ? 'map' : ''} ${mat.transparent ? 'clear' : ''} ${mat.emissiveIntensity > 0 && mat.emissive?.getHex() ? 'glow' : ''} side${mat.side} ${Object.keys(m.userData).join(',')} ${m.castShadow}`}`,
        );
      } else if (Array.isArray(mat)) {
        add(
          `multi-material: ${anchor.replace(/\d+$/u, '#') || 'case'} x${mat.length} in ${m.geometry.groups.length} groups, ${m.geometry.type} ${m.geometry.attributes['position']?.count}, ${new Set(mat as MeshStandardMaterial[]).size} distinct`,
        );
      } else if (mat.transparent || mat.opacity !== 1) {
        add(
          `see-through: ${anchor.replace(/\d+$/u, '#') || 'case'} ${mat.emissiveIntensity > 0 && mat.emissive.getHex() ? 'glow' : 'glass'} ${m.geometry.type}`,
        );
      } else if ((m as { isInstancedMesh?: boolean }).isInstancedMesh) {
        add('instanced, left out');
      } else {
        add(`other: ${anchor || 'case'} ${m.name} ${m.geometry.attributes['position']?.count}`);
      }
    });
    console.log(
      [...why]
        .toSorted((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n}  ${k}`)
        .join('\n'),
    );
  }
  expect(far).toBeLessThan(near);
  expect(far).toBeLessThanOrEqual(CEILING);
}

function assert_draws_a_cable_built_again_a_plug_in_or_out_in_th(): void {
  const machine = buildMachine(maxedSnapshot(), true, true),
    lod = must(machine.partLod);
  lod.update(LOD_OVERVIEW / 2);
  const far = drawnMeshes(machine.root);
  let atx: Object3D | undefined;
  machine.root.traverse((o) => {
    if (o.userData['id'] === 'cable.atx') {
      atx = o;
    }
  });
  const own = () => {
    let n = 0;
    must(atx).traverseVisible((o) => {
      if (isMesh(o) && !o.userData['standIn'] && o.layers.mask & 1) {
        n++;
      }
    });
    return n;
  };
  expect(own()).toBe(0);
  for (const seated of [false, true]) {
    machine.setCable('atx', seated);
    expect(own()).toBe(0);
    expect(drawnMeshes(machine.root)).toBe(far);
  }
}

describe('the machine at the room overview', () => {
  it('draws as stand-ins', () => {
    expect.hasAssertions();
    assert_draws_as_stand_ins();
  }, 30_000);

  it("draws a cable built again (a plug in or out) in the cables' stand-ins, with its new rig (MACH-06)", () => {
    expect.hasAssertions();
    assert_draws_a_cable_built_again_a_plug_in_or_out_in_th();
  }, 30_000);
});
