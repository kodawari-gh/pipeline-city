// A socket other than the CPU's filled or freed (machine3d.ts): a DIMM's latches, a slot's cover, a seat's or a tray's drop box.
import { tag } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { GEO, M2_SLOTS } from '../../layout/layout';
import { SLOT_H } from '../ram3d';
import { addBlank } from './trays';
import { nth } from './keys';
import type { Fill, MachineParts, Object3D } from './types';
import { freeBox, swapPick } from './swap';

/** A board socket (`dimm`, `m2`, `pcie`): its tag, a PCIe slot's plate, a memory socket's latches and the drop box. */
export function fillSocket(
  m: MachineParts,
  { slot, filled }: Fill,
  at: { kind: string; i: number; added: Object3D[] },
): void {
  const { kind, i } = at,
    sock = m.sockets.get(slot);
  if (sock) {
    if (filled) {
      delete sock.userData['id'];
    } else {
      tag(sock, slot);
    }
  }
  if (kind === 'pcie') {
    const b = m.blanks.get(slot);
    if (filled && b) {
      freeBox(b);
      m.blanks.delete(slot);
    } else if (!filled && !b) {
      at.added.push(addBlank(m, i));
    }
    return;
  }
  if (kind === 'dimm') {
    m.root.traverse((o) => {
      if (o.userData['dimm'] === slot) {
        for (const p of o.children) {
          const end: unknown = p.userData['latchEnd'];
          p.rotation.x = (typeof end === 'number' ? end : 0) * (filled ? 0 : 0.5);
        }
      }
    });
  }
  swapPick(m, { slot, filled }, () => {
    if (kind === 'dimm') {
      m.pickBox(nth(GEO.dimm, i).rect, [BOARD_Z, BOARD_Z + SLOT_H], slot);
    } else {
      m.pickBox(nth(M2_SLOTS, i), [BOARD_Z, BOARD_Z + 40], slot);
    }
  });
}
