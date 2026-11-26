// The build's end: the still scenery in few draws, the room's shared materials, the monitor's empty place, and the baked bounce.
import { MeshStandardMaterial } from 'three';
import { rectBox } from '@/core/render/three/geometry';
import { mergeStatic } from '@/core/render/three/merge';
import { tag, unseen } from '@/core/render/three/pick';
import { MONITOR } from '@/features/board/render/layout/layout';
import { MONITOR_Z } from '../roomplan';
import { settleBake, shareRoom } from './bake';
import type { RoomParts } from './types';

/**
 * The build's last things: the monitor's empty place on the desk (an unseen box a part dragged from the inventory lands on, `display0`, there
 * only while no monitor stands), and the baked bounce once its files are in, then the still scenery by palette (`ready`).
 */
function settleRoom(room: RoomParts): void {
  const spotM = new MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false });
  room.monitorSpot = tag(
    rectBox({ x: MONITOR.x, y: MONITOR.y, w: MONITOR.w, h: MONITOR.h }, MONITOR_Z - 300, MONITOR_Z + 400, spotM),
    'display0',
  );
  room.root.add(unseen(room.monitorSpot));
  room.ready = settleBake(room);
}

/** The room built: the still scenery in few draws (`mergeStatic`), its materials shared, its last things (`settleRoom`). */
export function finishRoom(room: RoomParts): void {
  mergeStatic(room.root);
  shareRoom(room);
  settleRoom(room);
}
