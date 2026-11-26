// (b) lock: closing Build my PC frees its scene with `disposeTree`, so nothing in that scene may be shared with the live room or its machine
// (a shared material that is disposed makes the live renderer link its program again: a hitch). Today the machine and the monitor own all of theirs.
import { expect, test } from 'vitest';
import type * as three from 'three';
import { roomGeo } from '@/features/room/render/shell/room';
import { Room3D } from '@/features/room/render/three/room3d';
import { Monitor } from '@/features/room/render/three/props3d';
import { BakeQueue } from '@/core/render/three/artlod';
import { DESK_Y, MONITOR, SCREEN } from '../layout/layout';
import { Machine3D } from './machine3d';
import { maxedSnapshot, quietCanvas } from './testutil';

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

const isTexture = (o: unknown): o is three.Texture =>
  typeof o === 'object' && o !== null && 'isTexture' in o && o.isTexture === true;
function asTexture(o: unknown): three.Texture {
  if (!isTexture(o)) {
    throw new Error('expected a Texture');
  }
  return o;
}

quietCanvas();

/** The materials under `o` and the textures they hold. */
const owned = (o: three.Object3D) => {
  const mats = new Set<three.Material>(),
    texs = new Set<three.Texture>();
  o.traverse((c) => {
    if (!isMesh(c)) {
      return;
    }
    const m = asMesh(c).material as three.Material | three.Material[] | undefined;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) {
      mats.add(x);
      for (const v of Object.values(x)) {
        if ((v as three.Texture | null)?.isTexture) {
          texs.add(asTexture(v));
        }
      }
    }
  });
  return { mats, texs };
};
const common = (a: ReturnType<typeof owned>, b: ReturnType<typeof owned>) => ({
  mats: [...a.mats].filter((m) => b.mats.has(m)).length,
  texs: [...a.texs].filter((t) => b.texs.has(t)).length,
});

function assert_the_Build_my_PC_scene_shares_no_material_or_text(): void {
  const snap = maxedSnapshot();
  const stage = new Machine3D(snap, roomGeo(), { q: new BakeQueue(), chips: null, inRoom: false }),
    live = new Machine3D(snap, roomGeo(), { q: new BakeQueue(), chips: null, inRoom: true });
  const room = new Room3D(),
    monitor = new Monitor(MONITOR, SCREEN, DESK_Y, 0);
  monitor.set({ installed: true, powered: true, live: false, text: '' }, 12);
  for (const [name, other] of [
    ['machine', live.root],
    ['room', room.root],
  ] as const) {
    expect(common(owned(stage.root), owned(other)), `stage machine / live ${name}`).toStrictEqual({ mats: 0, texs: 0 });
    expect(common(owned(monitor.root), owned(other)), `stage monitor / live ${name}`).toStrictEqual({
      mats: 0,
      texs: 0,
    });
  }
}

test('the Build my PC scene shares no material or texture with the live room or the live machine', () => {
  expect.hasAssertions();
  assert_the_Build_my_PC_scene_shares_no_material_or_text();
}, 180_000);
