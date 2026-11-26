// The jacks the LAN lead's PC end can go in (machine3d.ts, the LAN lead): the board's own and each network card's, and the port it is in.
import { BOARD_TIERS } from '@/features/board/sim/specs';
import { nicInput } from '@/features/network/render/nic/nicplan';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { CASE, ETH0_RECT } from '../../layout/layout';
import { nicJackAt } from '../card3d';
import { idx } from '../parts';
import { visualOf } from './keys';
import type { Outside, PortKind, V3 } from './types';

/** A jack the lead's PC end can go into: its port (`board`, or a card's device id), its kind and where its mouth is. */
export interface Jack {
  port: string;
  kind: PortKind;
  at: V3;
}

/** The board's jack's mouth, on the case's west side. */
export const boardJackAt = (): V3 => [CASE.x, -(ETH0_RECT.y + ETH0_RECT.h / 2), BOARD_Z + 300];

/** A card's jack is on its bracket, in the slot's opening: the plug goes into its mouth (nic3d's `mouthAt`). */
const nicAt = (d: { spec: string; slot: string }): V3 => {
  const p = nicJackAt(visualOf(d.spec), idx(d.slot));
  return [p.x - 2, -p.y, p.z];
};

/** Its ports: the board's jack, and each network card's (the 2D game's `eth0`, `eth1`...). A port is an RJ45 jack, or a QSFP+ cage (the 40G card's). */
export function jacksOf(o: Outside): Jack[] {
  const { s } = o;
  return [
    ...((BOARD_TIERS[s.boardTier]?.features.ethernetMbps ?? 0) > 0 && !s.board.burnt
      ? [{ port: 'board', kind: 'rj45' as PortKind, at: boardJackAt() }]
      : []),
    ...s.devices
      .filter((d) => d.kind === 'nic' && !d.burnt)
      .map((d) => ({ port: d.id, kind: nicInput(visualOf(d.spec)).port, at: nicAt(d) })),
  ];
}
