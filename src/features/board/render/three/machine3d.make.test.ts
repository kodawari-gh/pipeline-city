// `Machine3D.make` builds the machine a slice at a time (Build my PC's first open, BOOT-04: one task of 0.9 s became many of a few ms) and the
// machine it builds is the constructor's.
import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import { BakeQueue } from '@/core/render/three/artlod';
import { roomGeo } from '@/features/room/render/shell/room';
import { Machine3D } from './machine3d';
import { maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

/** What a machine holds: its meshes and their vertices, the tagged objects, the lists the frame reads, the stand-ins and the hoses. */
function census(m: Machine3D): Record<string, number> {
  m.root.updateMatrixWorld(true);
  let meshes = 0, verts = 0, tagged = 0, objects = 0;
  m.root.traverse((o) => {
    objects++;
    if (typeof o.userData.id === 'string') tagged++;
    const mesh = o as Mesh;
    if (mesh.isMesh) { meshes++; verts += mesh.geometry.attributes.position?.count ?? 0; }
  });
  return { meshes, verts, tagged, objects, fades: m.fades.length, rails: m.rails.length, apart: m.apart.length, lod: m.partLod ? 1 : 0, hoses: m.hoses ? 1 : 0 };
}

describe('Machine3D.make', () => {
  const snap = maxedSnapshot();

  it('builds the machine the constructor builds', async () => {
    const whole = new Machine3D(snap, roomGeo(), new BakeQueue(), null, false);
    const made = await Machine3D.make(snap, roomGeo(), new BakeQueue(), null, false, { budget: 0, slice: async () => {} });
    expect(made).not.toBeNull();
    expect(census(made!)).toEqual(census(whole));
  });

  it('gives the page a turn at many points of the build, and none while it is under its budget', async () => {
    let turns = 0;
    const slice = async () => { turns++; };
    await Machine3D.make(snap, roomGeo(), new BakeQueue(), null, false, { budget: 0, slice });
    expect(turns).toBeGreaterThan(20);
    // (the clock stands still in this file: no time has passed, so a budget above 0 is never spent)
    turns = 0;
    await Machine3D.make(snap, roomGeo(), new BakeQueue(), null, false, { budget: 1, slice });
    expect(turns).toBe(0);
  });

  it('gives each turn to the page before it goes on, in order', async () => {
    const log: string[] = [];
    await Machine3D.make(snap, roomGeo(), new BakeQueue(), null, false, { budget: 0, slice: async () => { log.push('turn'); await Promise.resolve(); log.push('back'); } });
    expect(log.length).toBeGreaterThan(20);
    expect(log.length % 2).toBe(0);
    for (let i = 0; i < log.length; i += 2) expect([log[i], log[i + 1]]).toEqual(['turn', 'back']);
  });

  it('stops at the next turn once the caller does not want it, and returns nothing', async () => {
    let turns = 0;
    const made = await Machine3D.make(snap, roomGeo(), new BakeQueue(), null, false, { budget: 0, slice: async () => { turns++; }, stop: () => turns >= 3 });
    expect(made).toBeNull();
    expect(turns).toBe(3);
  });

  it('builds a machine with no parts at all (no snapshot)', async () => {
    const whole = new Machine3D(null, roomGeo(), new BakeQueue(), null, false);
    const made = await Machine3D.make(null, roomGeo(), new BakeQueue(), null, false, { budget: 0, slice: async () => {} });
    expect(census(made!)).toEqual(census(whole));
  });

  it('builds a bare case (no board) as the constructor does: the case and its leads, nothing of a board', async () => {
    const whole = new Machine3D(snap, roomGeo(), new BakeQueue(), null, false, true, true, false, 'case');
    const made = await Machine3D.make(snap, roomGeo(), new BakeQueue(), null, false, { budget: 0, slice: async () => {}, shown: 'case' });
    expect(census(made!)).toEqual(census(whole));
    expect(whole.shown).toBe('case');
    // (the far stand-ins of the case's own pieces sit on the root as well: they are not a board)
    expect(whole.boardRoots().filter((o) => o.name !== 'standin')).toHaveLength(0);
    expect(whole.caseRoots.length).toBeGreaterThan(0);
    // (far less than the maxed machine: no board, no part, no cable)
    expect(census(whole).meshes).toBeLessThan(census(new Machine3D(snap, roomGeo(), new BakeQueue(), null, false)).meshes!);
  });

  it('builds nothing for an empty stage: no case, no board, no part, and no side panel to move', async () => {
    const whole = new Machine3D(snap, roomGeo(), new BakeQueue(), null, false, true, true, false, 'nothing');
    const made = await Machine3D.make(snap, roomGeo(), new BakeQueue(), null, false, { budget: 0, slice: async () => {}, shown: 'nothing' });
    expect(census(made!)).toEqual(census(whole));
    expect(whole.caseRoots).toHaveLength(0);
    expect(whole.boardRoots().filter((o) => o.name !== 'standin')).toHaveLength(0);
    expect(census(whole).meshes).toBeLessThan(census(new Machine3D(snap, roomGeo(), new BakeQueue(), null, false, true, true, false, 'case')).meshes!);
    // (the calls a stage makes on any machine are no-ops with no case: there is no door)
    expect(() => { whole.setOpen(true, true); whole.toggleDoor(); whole.closeDoor(); whole.takeDoor(whole); whole.holdDetail([whole.root]); }).not.toThrow();
    expect(whole.doorOpen).toBe(false);
    expect(whole.moving).toBe(false);
    expect(whole.bodyBox().isEmpty()).toBe(true);
  });

  it('builds without the merge or the stand-ins as the constructor does', async () => {
    const whole = new Machine3D(snap, roomGeo(), new BakeQueue(), null, false, false, false);
    const made = await Machine3D.make(snap, roomGeo(), new BakeQueue(), null, false, { merge: false, lod: false, budget: 0, slice: async () => {} });
    expect(census(made!)).toEqual(census(whole));
    expect(census(made!).lod).toBe(0);
  });
});
