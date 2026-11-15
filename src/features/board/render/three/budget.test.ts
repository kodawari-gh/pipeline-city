// High's draw and triangle budget: the maxed machine, the room and the city, counted headless as `highident.test.ts` builds them. A count
// may rise by at most 5 % over its row in `BUDGET`. A rise must be a decision: raise the row in the same commit, with the reason in the message.
import { describe, expect, it } from 'vitest';
import type { Mesh, Object3D } from 'three';
import { Room3D } from '@/features/room/render/three/room3d';
import { OutsideView } from '@/features/room/render/three/outside/view';
import { drawn } from '@/features/room/render/three/outside/sweep';
import { shown } from '@/core/render/three/pick';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

/** The budget: the High counts at the time of the last decision. Keep each row a number; a rise needs a reason in the commit. */
export const BUDGET = {
  /** Machine and room: the draw calls a camera on layer 0 makes. */
  machineRoomDraws: 924,
  /** Machine and room: the vertices of the meshes drawn. */
  machineRoomVerts: 1172752, // (was 2,216,520 before the asset standard's redo, ASR1–ASR10)
  /** City: the triangles drawn (instances counted). */
  cityTris: 2103386, // (was 3,643,156 before the tree caps, ASR2)
} as const;

/** The slack over a row before the test fails. */
const SLACK = 1.05;

/** Draws and drawn vertices of the meshes under each root, counted as `highident.test.ts` counts a draw. */
function countMachineRoom(roots: Object3D[]): { draws: number; verts: number } {
  let draws = 0, verts = 0;
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      const mesh = o as Mesh;
      const drawnHere = shown(o) && (mesh.layers.mask & 1) !== 0 && [mesh.material].flat().some((x) => x.visible);
      if (!drawnHere) return;
      draws += 1;
      verts += mesh.geometry.attributes.position?.count ?? 0;
    });
  }
  return { draws, verts };
}

/** Triangles drawn under the scene, counted as `outside/highident.test.ts` counts them (an instanced mesh's copies included). */
function countCityTris(scene: Object3D): number {
  let tris = 0;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const mesh = o as Mesh & { isInstancedMesh?: boolean; count?: number };
    const indices = drawn(mesh.geometry);
    if (!mesh.visible || indices <= 0) return;
    tris += (indices / 3) * (mesh.isInstancedMesh ? (mesh.count ?? 1) : 1);
  });
  return Math.round(tris);
}

/** Each count must stay within its row plus the slack. */
const within = (got: number, row: number): boolean => got <= row * SLACK;

describe('High draw and triangle budget', () => {
  it('machine and room draws and vertices stay within BUDGET', () => {
    const machine = buildMachine(maxedSnapshot(), true, true);
    const room = new Room3D();
    const { draws, verts } = countMachineRoom([machine.root, room.root]);
    console.log(`High budget: machine+room ${draws} draws, ${verts} verts`);
    expect(within(draws, BUDGET.machineRoomDraws), `draws ${draws} > ${BUDGET.machineRoomDraws} + 5 %`).toBe(true);
    expect(within(verts, BUDGET.machineRoomVerts), `verts ${verts} > ${BUDGET.machineRoomVerts} + 5 %`).toBe(true);
  }, 20_000);

  it('city triangles stay within BUDGET', () => {
    const view = new OutsideView(0, 0, 10, 10, 0);
    const tris = countCityTris((view as unknown as { scene: Object3D }).scene);
    console.log(`High budget: city ${tris} tris`);
    expect(within(tris, BUDGET.cityTris), `tris ${tris} > ${BUDGET.cityTris} + 5 %`).toBe(true);
  }, 180_000);
});
