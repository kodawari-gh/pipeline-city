// Economy purchase catalog: everything the shop sells, list prices, and what a spare is worth when sold.

import { getIspSpec, getRouterSpec } from '../../network/sim';
import { getOsSpec } from '../../os/sim';
import * as boardSim from '../../board/sim';

/** Every kind of device the shop sells. */
const DEVICE_KINDS: boardSim.DeviceKind[] = [
  'cpu',
  'ram',
  'psu',
  'cooler',
  'display',
  'storage',
  'vrm-sink',
  'ram-sink',
  'nic',
  'gpu',
  'npu',
  'tpm',
  'radiator',
  'fan',
];

/** Something the player can buy: a device spec id, or a board tier (`board1`). */
export interface Offer {
  id: string;
  name: string;
  kind: boardSim.DeviceKind | 'board' | 'case';
  price: number;
}

const BOARD_ID = /^board(?<tier>[0-9]+)$/u;
const CASE_ID = /^case(?<tier>[0-9]+)$/u;

/** Case tier of an offer id like "case1", or undefined. */
export function caseTierOf(id: string): number | undefined {
  const m = CASE_ID.exec(id);
  return m ? Number(m[1]) : undefined;
}

/** Board tier of an offer id like "board1", or undefined for a device id. */
export function boardTierOf(id: string): number | undefined {
  const m = BOARD_ID.exec(id);
  return m ? Number(m[1]) : undefined;
}

export function offerPrice(id: string): number | undefined {
  const t = boardTierOf(id);
  const c = caseTierOf(id);
  if (c !== undefined) {
    return boardSim.CASE_TIERS[c]?.price;
  }
  return t === undefined
    ? (boardSim.getSpec(id)?.price ?? getOsSpec(id)?.price ?? getRouterSpec(id)?.price ?? getIspSpec(id)?.price)
    : boardSim.BOARD_TIERS[t]?.price;
}

/** Selling a spare part back returns this share of its list price: the rest is lost (docs/GAME.md "Selling"). */
export const SELL_RATE = 0.8;

/** The cheapest a spare costs: the starter crate's parts are free to receive but not to buy again. */
export const SPARE_FLOOR = 10;

/** What a spare is worth when sold, in whole dollars: `SELL_RATE` of the price the shop asks (the starter crate's free parts count as the `SPARE_FLOOR`). */
export const sellValue = (spec: string): number => Math.floor(Math.max(offerPrice(spec) ?? 0, SPARE_FLOOR) * SELL_RATE);

/** Why a board of this tier cannot go into the board's case. */
export const caseTooSmall = (board: boardSim.Board, boardTier: number): string =>
  `the ${boardSim.CASE_TIERS[board.caseTier]?.name ?? 'case'} is too small for a ${boardSim.BOARD_TIERS[boardTier]?.name ?? 'bigger'} board: buy a ${boardSim.CASE_TIERS[boardSim.caseFor(boardTier)]?.name ?? 'bigger case'} first`;

/**
 * Everything the shop sells, in a campaign and in the sandbox: every board tier, every case tier and every device spec, whatever is
 * fitted and however many are owned (spares, downgrades, a second machine). Nothing here asks whether it fits: the inventory says
 * what a part can go into (`reason`), and the level gate (`levelLock`) is the game's only restriction.
 */
const floorPrice = (price: number): number => Math.max(price, SPARE_FLOOR);

export function catalog(): Offer[] {
  const out: Offer[] = [];
  for (const t of boardSim.BOARD_TIERS) {
    out.push({ id: `board${t.tier}`, name: t.name, kind: 'board', price: floorPrice(t.price) });
  }
  for (const c of boardSim.CASE_TIERS) {
    out.push({ id: `case${c.tier}`, name: c.name, kind: 'case', price: floorPrice(c.price) });
  }
  for (const kind of DEVICE_KINDS) {
    for (const s of boardSim.specsOfKind(kind)) {
      out.push({ id: s.id, name: s.name, kind: s.kind, price: floorPrice(s.price) });
    }
  }
  return out;
}
