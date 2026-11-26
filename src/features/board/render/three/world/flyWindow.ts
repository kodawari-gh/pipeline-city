// The window a flight to an id frames (board3d.ts `flyToId`): the target with room round it, a plug or a key close enough to grab, under the
// desk from low down.
import type { Box3 } from 'three';
import type { Box } from '@/core/render/three/camera';
import { findById } from '@/core/render/three/pick';
import { DESK_TOP } from '@/features/room/render/three/roomplan';
import { freeRect, real } from './anchors';
import { FLAT, OUTSIDE, ROOM_ANGLE } from './consts';
import type { Fit } from './view';
import type { Scope } from './world';

/** The window a flight to `id` frames round its world box `box`, and how it is seen. */
export function windowFor(s: Scope, id: string, box: Box3): { rect: Box; fit: Fit } {
  const { machine, room } = s.held;
  const inCaseId = machine !== null && findById(machine.root, real(s, id)) !== null && !OUTSIDE.has(id),
    pad = id.startsWith('key:') ? 600 : 0;
  const f = freeRect(s),
    bw = box.max.x - box.min.x,
    bh = box.max.y - box.min.y,
    cx = (box.min.x + box.max.x) / 2,
    cy = (box.min.y + box.max.y) / 2;
  // the 2D window: at least 9500 wide with room round the target, as tall as the free area's shape asks
  // (a plug or a key is small: its window hugs it and what it goes to, so it reads at a size the pointer can grab)
  const small = id.startsWith('cable.') || id.startsWith('key:'),
    ext = Math.max(bw, bh);
  const minW = small ? Math.min(9500, Math.max(2500, ext * 2.5 + 800)) : 9500,
    margin = small ? Math.max(800, ext * 0.6) : 1800;
  let cw = Math.max(minW, bw + (small ? 2 * margin : 2200) + 2 * pad),
    ch = (cw * f.h) / f.w;
  if (ch < bh + margin + 2 * pad) {
    ch = bh + margin + 2 * pad;
    cw = (ch * f.w) / f.h;
  }
  // under the desk (the wall socket, the mains plugs) the desk's top hides the floor from above: look along it, from low down
  const underDesk = !inCaseId && room !== null && box.max.y < -(room.geo.ys + DESK_TOP);
  let from = ROOM_ANGLE;
  if (inCaseId) {
    from = FLAT;
  } else if (underDesk) {
    from = { ...ROOM_ANGLE, pitch: -0.07 };
  }
  return { rect: { x: cx - cw / 2, y: -cy - ch / 2, w: cw, h: ch }, fit: { z: box.max.z, from, margin: 1 } };
}
