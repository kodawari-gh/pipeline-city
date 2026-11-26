// The video cable's PC end (machine3d.ts, the video cable): the ports that offer video (the board's, a card's) and the one it is in.
import { getSpec } from '@/features/board/sim/specs';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { CASE, VIDEO_Y } from '../../layout/layout';
import { gpuVideoAt } from '../card3d';
import { idx } from '../parts';
import { visualOf } from './keys';
import type { Outside, V3 } from './types';

/** A graphics card's HDMI port. */
const gpuAt = (d: { spec: string; slot: string }): V3 => {
  const p = gpuVideoAt(visualOf(d.spec), idx(d.slot));
  return [p.x - 2, -p.y, p.z];
};

/** The PC end's ports: the board's, and with a graphics display each sound graphics card's (on its bracket, inside the slot's opening). */
export function videoPorts(o: Outside): { port: string; at: V3 }[] {
  const { s } = o,
    z = BOARD_Z + 520;
  // (a card's HDMI is on its bracket, inside the slot's opening: the plug reaches in through the case's back to its mouth)
  const at = (yy: number): V3 => [CASE.x, -yy, z];
  const display = getSpec(s.devices.find((d) => d.kind === 'display')?.spec ?? ''),
    gfx = display !== undefined && 'graphics' in display && display.graphics;
  return [
    { port: 'board', at: at(VIDEO_Y) },
    ...(gfx ? s.devices.filter((d) => d.kind === 'gpu' && !d.burnt).map((d) => ({ port: d.slot, at: gpuAt(d) })) : []),
  ];
}
