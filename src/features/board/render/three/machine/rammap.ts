// The memory map on the sticks' chips (machine3d.ts): its reveal and its rail, made again when the bank changes.
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { RAM_DIE_ZOOM, RAM_FACE_AT, RAM_FACE_PITCH, RAM_FACE_YAW, dieShown } from '../ram3d';
import { RamMap3D } from '../rammap3d';
import { railAt, revealOver } from '../parts';
import { relist } from './list';
import type { MachineParts } from './types';

/**
 * The live memory map over the bank of sticks: it comes in as the spreaders go, and the bank is one detailed view a double click flies to.
 * Made again when a stick comes or goes (the old map's reveal and rail go).
 */
export function buildRamMap(m: MachineParts): void {
  m.ramBits = null;
  m.ramMap?.dispose();
  m.ramMap = null;
  if (m.ram && m.ramSticks.length > 0) {
    const map = new RamMap3D(m.ramSticks, m.T);
    m.ramMap = map;
    m.ramBits = {
      reveal: revealOver(m.ram, BOARD_Z + 200, (z) => {
        map.show(dieShown(z));
      }),
      rail: railAt('ram', m.ram, {
        z: BOARD_Z + RAM_FACE_AT,
        zoom: RAM_DIE_ZOOM,
        angle: { yaw: RAM_FACE_YAW, pitch: RAM_FACE_PITCH },
      }),
    };
  }
  relist(m);
}
