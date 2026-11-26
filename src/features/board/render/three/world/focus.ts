// A part's aligned view (board3d.ts `focusPart`): head on, centred in the free window, the part filling most of it.
import { Box3 } from 'three';
import { snapshot } from '@/app/store';
import { deviceOf } from '../drag3d';
import { FLAT, LIE, ROOM_ANGLE } from './consts';
import { objOf, real } from './anchors';
import { flyTo, flyToBoard, flyToRoom } from './flights';
import { idAt } from './pointer';
import { inFree } from './view';
import type { Scope } from './world';
import type { At } from './types';

/** The part's rail (its detailed view, `Machine3D.rails`): a stick's is the bank's, the sticks' faces are read together, in a row. */
const railOf = (s: Scope, id: string) => {
  const rails = s.held.machine?.rails;
  return (
    rails?.find((x) => x.id === id) ??
    (snapshot.peek()?.devices.find((d) => d.id === id)?.kind === 'ram' ? rails?.find((x) => x.id === 'ram') : undefined)
  );
};

/**
 * A part's aligned view: head on, centred in the free window, the part filling most of it (a die by its rail's face, any other part by its box). A part that lies (`Rail.lie`: the router's
 * board in its shell) is looked down on from the front, as far down as the camera tilts: its top fills the window as that tilt shows it (its depth, short by the sine of the tilt).
 */
export const focusPart = (s: Scope, id: string): boolean => {
  const r = railOf(s, id);
  if (r) {
    // (close enough that its detail is all in, `Rail.zoom`)
    const { lie } = r,
      eff = lie ? lie.d * Math.sin(LIE.pitch) : 0;
    const v = lie
      ? inFree(s, { x: r.rect.x, y: -lie.y - eff / 2, w: r.rect.w, h: eff }, { z: r.z, from: LIE, margin: 0.8 })
      : inFree(s, r.rect, { z: r.z, from: r.angle ? { ...r.angle, fov: ROOM_ANGLE.fov } : FLAT, margin: 0.8 });
    flyTo(s, { ...v, height: Math.min(v.height, s.stage.H / r.zoom) });
    return true;
  }
  const o = objOf(s, real(s, id)),
    b = o && new Box3().setFromObject(o);
  if (!b || b.isEmpty()) {
    return false;
  }
  flyTo(
    s,
    inFree(
      s,
      { x: b.min.x, y: -b.max.y, w: b.max.x - b.min.x, h: b.max.y - b.min.y },
      { z: b.max.z, from: FLAT, margin: 0.7 },
    ),
  );
  return true;
};

/**
 * A double click or tap: on a part it brings it up, aligned; on the board it fits the board, anywhere else it frames the room again (as in Build my
 * PC and the Gallery). A part with a detailed view of its own has a flight of its own: a NIC's parts and its controller's die (`nicBits` in
 * `parts.ts`), the router's blocks (`Machine3D.buildRouter`).
 */
export function focusAt(s: Scope, e: At): void {
  const id = idAt(s, e),
    dev = deviceOf(id, snapshot.peek());
  if (id !== null && s.held.machine?.rails.some((r) => r.id === id) === true && focusPart(s, id)) {
    return;
  }
  if (dev && focusPart(s, dev.id)) {
    return;
  }
  if (id === 'board') {
    flyToBoard(s);
  } else {
    flyToRoom(s);
  }
}
