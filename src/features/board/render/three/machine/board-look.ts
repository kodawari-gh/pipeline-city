// The board's own looks (machine3d.ts): the lights the live frame drives, and the small parts, which stand up only up close.
import { DEVICE_LOD } from '@/core/render/lod/lod';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { BD } from '../../layout/layout';
import { phyBits } from '../parts';
import { reveal, spin } from './reveal';
import { addHead } from './list';
import type { Board3D, MachineParts } from './types';

/** The board's lights: the live frame drives them. */
export function boardLights(m: MachineParts, b: Board3D): void {
  for (const l of b.lights) {
    spin(m, l);
  }
}

/** The board's small parts and its PHY's bits: far out the flat drawing is enough, the small parts stand up only up close. */
export function boardSmall(m: MachineParts, b: Board3D): void {
  m.small = b.small;
  reveal(m, { r: BD, z: BOARD_Z }, (z) => {
    b.small.visible = z > DEVICE_LOD.labels.board;
  });
  if (b.phy) {
    addHead(m, phyBits(b.phy));
  }
}
