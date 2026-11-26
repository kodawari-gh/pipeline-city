// The case's side panel (machine3d.ts): the zoom opens it from the board view in and shuts it again past a dead band under that; a drag or a
// tutorial target inside holds it open, and a click on it opens or shuts it until the zoom crosses its band again.
import { CASE_FRONT as FRONT } from '@/features/room/render/three/roomplan';
import { CASE } from '../../layout/layout';
import { DOOR_SECONDS, doorPose, stepDoor } from '../casedoor';
import { DOOR_ZOOM, HIT, NO_HIT } from './consts';
import type { Door, MachineParts } from './types';

/** Is the side panel open (or opening)? */
export function doorOpen(m: MachineParts): boolean {
  const d = m.door;
  return d !== null && (d.inside || (d.manual ?? d.zoomOpen));
}

/**
 * Move the side panel toward open or shut at its kind's pace and set its pose (`doorPose`). The zoom opens it from the board view in and shuts
 * it again past a dead band under that, and a new crossing forgets the player's last click. Rays reach the plate that opens it only while it is shut.
 */
export function swingDoor(m: MachineParts, d: Door, dt: number): void {
  const { cm } = d,
    open = d.zoom > DOOR_ZOOM[1] * d.board,
    shut = d.zoom < DOOR_ZOOM[0] * d.board;
  if ((open && !d.zoomOpen) || (shut && d.zoomOpen)) {
    d.zoomOpen = open;
    d.manual = null;
  }
  // (at rest it stays: a step back and forth would jiggle it every frame)
  d.t = stepDoor(d.t, doorOpen(m) ? 1 : 0, dt, DOOR_SECONDS[d.kind]);
  const p = doorPose(d.kind, d.t);
  cm.door.position.set(cm.px - p.slide, 0, FRONT + p.out);
  cm.door.rotation.y = p.swing;
  for (const sc of cm.screws) {
    sc.position.x = CASE.x - 24 - p.screws * 80;
    sc.rotation.x = p.screws * Math.PI * 8;
  }
  cm.hit.raycast = d.t < 0.01 && !d.busy ? HIT : NO_HIT;
}

/** Open the case's outer side whatever the zoom (a part or a cable is dragged, a tutorial target is inside), or let the zoom decide again. */
export function setOpen(m: MachineParts, inside: boolean, busy: boolean): void {
  const d = m.door;
  if (!d) {
    return;
  }
  // (a panel a job held open stays open when the job lets go, as if the zoom had opened it: it shuts when the zoom falls under its band)
  if (d.inside && !inside && doorOpen(m)) {
    d.manual = null;
    d.zoomOpen = true;
  }
  d.inside = inside;
  d.busy = busy;
}

/** The side panel as `from` (the machine this one replaces) had it: how far open, and what holds it, so a new build does not swing it again. */
export function takeDoor(m: MachineParts, from: MachineParts): void {
  const a = from.door,
    b = m.door;
  if (!a || !b) {
    return;
  }
  b.t = a.t;
  b.zoom = a.zoom;
  b.board = a.board;
  b.zoomOpen = a.zoomOpen;
  b.manual = a.manual;
  b.inside = a.inside;
  b.busy = a.busy;
  swingDoor(m, b, 0);
}
