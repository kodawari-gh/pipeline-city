// (b) lock: closing Build my PC frees its scene with `disposeTree`, so nothing in that scene may be shared with the live room or its machine
// (a shared material that is disposed makes the live renderer link its program again: a hitch). Today the machine and the monitor own all of theirs.
import { expect, it } from 'vitest';
import { Mesh, type Material, type Object3D, type Texture } from 'three';
import { roomGeo } from '@/features/room/render/shell/room';
import { Room3D } from '@/features/room/render/three/room3d';
import { Monitor } from '@/features/room/render/three/props3d';
import { BakeQueue } from '@/core/render/three/artlod';
import { DESK_Y, MONITOR, SCREEN } from '../layout/layout';
import { Machine3D } from './machine3d';
import { maxedSnapshot, quietCanvas } from './testutil';

quietCanvas();

/** The materials under `o` and the textures they hold. */
const owned = (o: Object3D) => {
  const mats = new Set<Material>(), texs = new Set<Texture>();
  o.traverse((c) => {
    const m = (c as Mesh).material as Material | Material[] | undefined;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) { mats.add(x); for (const v of Object.values(x)) if ((v as Texture | null)?.isTexture) texs.add(v as Texture); }
  });
  return { mats, texs };
};
const common = (a: ReturnType<typeof owned>, b: ReturnType<typeof owned>) => ({ mats: [...a.mats].filter((m) => b.mats.has(m)).length, texs: [...a.texs].filter((t) => b.texs.has(t)).length });

it('the Build my PC scene shares no material or texture with the live room or the live machine', () => {
  const snap = maxedSnapshot();
  const stage = new Machine3D(snap, roomGeo(), new BakeQueue(), null, false), live = new Machine3D(snap, roomGeo(), new BakeQueue(), null, true);
  const room = new Room3D(), monitor = new Monitor(MONITOR, SCREEN, DESK_Y, 0);
  monitor.set({ installed: true, powered: true, live: false, text: '' }, 12);
  for (const [name, other] of [['machine', live.root], ['room', room.root]] as const) {
    expect(common(owned(stage.root), owned(other)), `stage machine / live ${name}`).toEqual({ mats: 0, texs: 0 });
    expect(common(owned(monitor.root), owned(other)), `stage monitor / live ${name}`).toEqual({ mats: 0, texs: 0 });
  }
}, 60000);
