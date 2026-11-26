// What a pick of a part of the machine's detailed views means (machine3d.ts, `pickId`): a NIC's part, a part of the router's board.
import type { MachineParts } from './types';

/** A part of the router's board, which is the router until the shell is gone and shows its parts. */
const ROUTER_PART = /^router\.[a-z]+$/u;

/** A part of a NIC, which is the card itself until its cooler has gone. */
const NIC_PART = /^(?<slot>pcie\d+)\.nic-(?:jack|edge|ctl|xtal|nvm|vreg|label)$/u;

/**
 * What a pick of `id` means: a part of a NIC (`pcie2.nic-xtal`) is the card itself until its cooler has gone and it shows its parts. The die's blocks (`pcie2.nic-mac`) are not asked: they are hit only through the live layer, once the lid is gone.
 */
export function pickId(m: MachineParts, id: string | null): string | null {
  // (a part of the router's board is the router until the shell is gone and shows its parts)
  if (id !== null && ROUTER_PART.test(id)) {
    return m.routerBits?.board.shown() === true ? id : 'router';
  }
  const slot = id === null ? undefined : NIC_PART.exec(id)?.groups?.['slot'];
  const card = slot === undefined ? undefined : m.cards.get(slot);
  return card && card.detail() < 0.9 ? (m.devs.find((d) => d.slot === slot)?.id ?? id) : id;
}
