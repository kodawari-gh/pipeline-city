// The CPU socket filled or freed (machine3d.ts): its lever, its bare contacts and its drop box.
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { PKG, SOCKET_E } from '../../layout/layout';
import { LEVER_OPEN } from '../boardhw3d';
import { grow } from '../parts';
import type { Fill, MachineParts } from './types';
import { freeBox, swapPick } from './swap';

/** The CPU's socket: the load lever is down on a CPU and lifted on a bare socket (as a memory socket's latches close on a stick and open without one). */
export function fillCpu(m: MachineParts, { slot, filled }: Fill): void {
  m.root.traverse((o) => {
    if (o.userData['leverOf'] === slot) {
      o.rotation.y = filled ? 0 : LEVER_OPEN;
    }
  });
  // the socket is merged into the board by now, so a bare one is picked by an unseen box over it; its gold contacts show
  swapPick(m, { slot, filled }, () => {
    m.pickBox(grow(PKG, SOCKET_E), [BOARD_Z, BOARD_Z + 70], slot);
  });
  if (filled && m.bare) {
    freeBox(m.bare);
    m.bare = null;
  } else if (!filled && !m.bare && m.contacts) {
    m.bare = m.contacts();
    m.root.add(m.bare);
  }
}
