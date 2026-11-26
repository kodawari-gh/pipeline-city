import type * as boardTypes from './board';
import type { Alert } from './buildalerts';

const FAMILY: Record<string, string> = {
  'psu-trip': 'psu',
  'psu-brownout': 'psu',
  'vrm-burn': 'vrm',
  'vrm-overload': 'vrm',
  'ram-vrm-burn': 'ram-vrm',
  'ram-vrm-overload': 'ram-vrm',
  'hot-throttle': 'hot',
  'hot-errors': 'hot',
  'hot-burn': 'hot',
  'vrm-hot-errors': 'vrm-hot',
  'vrm-hot-throttle': 'vrm-hot',
  'board-hot-burn': 'vrm-hot',
  'ram-vrm-hot-errors': 'ram-vrm-hot',
  'ram-vrm-hot-throttle': 'ram-vrm-hot',
};
const RANK: Record<Alert['level'], number> = { warn: 1, bad: 2 };

/**
 * What an alert is, apart from how bad it is and which device it names: its family and the part's spec. A part that came out and went back in has a new id,
 * and its problem is the same one, so a change that only moved parts about is not news (`newAlerts`).
 */
export const alertKey = (a: Alert, board: boardTypes.Board): string =>
  `${FAMILY[a.id] ?? a.id}:${board.devices.find((d) => d.id === a.part)?.spec ?? ''}`;

/**
 * The problems a machine has, each by its key (`alertKey`) with how bad the worst of it is (1 runs badly, 2 breaks). The power-on test (`boot`) is left out: a
 * part still missing is the build in progress, not a problem a change made.
 */
export function standing(list: readonly Alert[], board: boardTypes.Board): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of list) {
    if (a.id !== 'boot') {
      const k = alertKey(a, board);
      out.set(k, Math.max(out.get(k) ?? 0, RANK[a.level]));
    }
  }
  return out;
}

/**
 * The alerts of a machine that are news against what it had (`standing`): a problem it did not have, or has in a worse degree (a sag that became a trip). One
 * that stayed, or only eased (a trip that became a sag), is not news: the pill and the list still say it, the hint line does not say it twice. Worst first.
 */
export function newAlerts(list: readonly Alert[], board: boardTypes.Board, had: ReadonlyMap<string, number>): Alert[] {
  return list
    .filter((a) => a.id !== 'boot' && RANK[a.level] > (had.get(alertKey(a, board)) ?? 0))
    .toSorted((a, b) => RANK[b.level] - RANK[a.level]);
}
