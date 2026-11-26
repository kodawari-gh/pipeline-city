// Every tier merges the room's router, key rack and mailbox (MACH-02), the cable plugs and the machine's wires (`mergeWithin`). Each part is
// checked on its own, so a merge that stops (its mutation) fails here.
import { afterEach, expect, it } from 'vitest';
import { type Mesh, type Object3D } from 'three';
import { setLowDetail } from '@/core/render/three/detail';
import { BakeQueue } from '@/core/render/three/artlod';
import { findById } from '@/core/render/three/pick';
import { roomGeo } from '@/features/room/render/shell/room';
import { Room3D } from '@/features/room/render/three/room3d';
import { Machine3D } from './machine3d';
import { rigStatic } from './cablerig3d';
import { maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();
afterEach(() => {
  setLowDetail(false);
});

const count = (o: Object3D | null | undefined): number => {
  let n = 0;
  o?.traverse((c) => {
    if ((c as Mesh).isMesh) n++;
  });
  return n;
};
/** The meshes `mergeWithin` made (`merge.ts` names them 'merged'). */
const merged = (o: Object3D | null | undefined): number => {
  let n = 0;
  o?.traverse((c) => {
    if ((c as Mesh).isMesh && c.name === 'merged') n++;
  });
  return n;
};
/** The plug's rig group (`cablerig3d.ts`, `userData.rig`) under a cable's tagged group. */
const rigOf = (root: Object3D, id: string): Object3D | null => {
  let r: Object3D | null = null;
  findById(root, id)?.traverse((c) => {
    if (!r && c.userData['rig']) r = c;
  });
  return r;
};

it('every tier merges the router, the key rack, the mailbox, the cable plugs and the wires', () => {
  const snap = maxedSnapshot();
  const build = (low: boolean) => {
    setLowDetail(low);
    const room = new Room3D();
    const machine = new Machine3D(snap, roomGeo(), new BakeQueue(), null, true);
    return { room, machine };
  };
  const hi = build(false),
    lo = build(true);

  // the router on its shelf, the key rack, the letterbox (room3d/: `mergeWithin`)
  for (const id of ['router', 'tray', 'mail']) {
    expect(merged(findById(hi.room.root, id)), `${id} merged at High`).toBeGreaterThan(0);
    expect(merged(findById(lo.room.root, id)), `${id} merged at Low`).toBeGreaterThan(0);
  }

  // each cable plug the machine builds (cablerig3d.ts: `merged`)
  for (const id of ['cable.cpu', 'cable.atx']) {
    const hr = rigOf(hi.machine.root, id),
      lr = rigOf(lo.machine.root, id);
    expect(hr, `${id} rig at High`).not.toBeNull();
    expect(lr, `${id} rig at Low`).not.toBeNull();
    expect(merged(hr), `${id} plug merged at High`).toBeGreaterThan(0);
    expect(merged(lr), `${id} plug merged at Low`).toBeGreaterThan(0);
    // the plug draws in as few meshes at High as at Low
    expect(count(hr), `${id} plug's meshes`).toBe(count(lr));
  }
}, 120000);

it("the plug's static rig is merged at every tier (cablerig3d.ts `rigStatic`)", () => {
  const snap = maxedSnapshot();
  const rigAt = (low: boolean) => {
    setLowDetail(low);
    const machine = new Machine3D(snap, roomGeo(), new BakeQueue(), null, true);
    const rig = machine.rig('cpu');
    expect(rig, "the CPU plug's rig").not.toBeNull();
    return rigStatic(rig!, rig!.canSeat, undefined);
  };
  expect(merged(rigAt(false)), 'rig merged at High').toBeGreaterThan(0);
  expect(merged(rigAt(true)), 'rig merged at Low').toBeGreaterThan(0);
}, 120000);

it("the machine's wires are merged at every tier (machine3d.ts, `mergeSiblings(this.wires)`)", () => {
  const snap = maxedSnapshot();
  const wiresAt = (low: boolean) => {
    setLowDetail(low);
    const machine = new Machine3D(snap, roomGeo(), new BakeQueue(), null, true);
    return (machine as unknown as { wires: Object3D }).wires;
  };
  // (the leads' rigs under the group are merged by their own build: only the wires' own meshes count here)
  const wireOwn = (w: Object3D): number => {
    let n = 0;
    w.traverse((c) => {
      let inRig = false;
      for (let p: Object3D | null = c; p && p !== w; p = p.parent) if (p.userData['rig']) inRig = true;
      if (!inRig && (c as Mesh).isMesh && c.name === 'merged') n++;
    });
    return n;
  };
  expect(wireOwn(wiresAt(false)), 'wires merged at High').toBeGreaterThan(0);
  expect(wireOwn(wiresAt(true)), 'wires merged at Low').toBeGreaterThan(0);
}, 120000);
