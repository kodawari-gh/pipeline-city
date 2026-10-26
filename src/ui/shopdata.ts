// The shop and the inventory's category icons, pure logic: every kind of item the game sells, in the order a build meets them.

import type { DeviceKind } from '../sim/board/specs';
import { getSpec } from '../sim/board/specs';
import type { Snapshot } from '../sim/game/game';
import { getOsSpec } from '../sim/os';
import { KIND_LABEL } from './logic';
import { boardId, caseId, ladderFor, type IconName, type LadderStep } from './picker';

export type ShopKind = DeviceKind | 'board' | 'case' | 'os' | 'router' | 'isp';

/** One picture per category, so the inventory and the shop read without words. */
export const KIND_ICON: Record<ShopKind, IconName> = {
  cpu: 'cpu', ram: 'memory', cooler: 'fan', psu: 'bolt', display: 'screen', storage: 'disk', board: 'board', case: 'case',
  'vrm-sink': 'heatsink', 'ram-sink': 'wave', nic: 'net', gpu: 'card', npu: 'grid', tpm: 'lock', os: 'layers', router: 'router', isp: 'globe',
};

export const SHOP_ORDER: ShopKind[] = ['case', 'board', 'cpu', 'cooler', 'ram', 'psu', 'display', 'storage', 'vrm-sink', 'ram-sink', 'nic', 'gpu', 'npu', 'tpm', 'os', 'router', 'isp'];

/** Category name as the shelf and the shop say it ("Software" for the OS group). */
export const kindLabel = (k: string): string => (k === 'os' ? 'Software' : KIND_LABEL[k as ShopKind] ?? k);
/** The icon of a category, with a plain box for anything unknown. */
export const kindIcon = (k: string): IconName => KIND_ICON[k as ShopKind] ?? 'box';

export interface ShopSection { kind: ShopKind; label: string; icon: IconName; items: LadderStep[] }

/** Every item the game sells, by category, with its state for this player (buy, poor, blocked, level lock, later, owned, outgrown). */
export function shopFor(s: Snapshot): ShopSection[] {
  return SHOP_ORDER
    .map((kind) => ({ kind, label: kindLabel(kind), icon: KIND_ICON[kind], items: ladderFor(s, kind) }))
    .filter((x) => x.items.length > 0);
}

/** The spec of the part of this kind that is fitted now (the one a new part would replace), or null. */
export function currentSpecFor(s: Snapshot, kind: string): string | null {
  switch (kind) {
    case 'board': return boardId(s.boardTier);
    case 'case': return caseId(s.caseTier);
    case 'os': return s.os?.spec ?? null;
    case 'router': return s.net.router?.id ?? null;
    case 'isp': return s.net.isp?.id ?? null;
    default: return s.devices.find((d) => d.kind === kind)?.spec ?? null;
  }
}

/** Tier of a spec id, or null when it has none. */
export function tierOfSpec(specId: string): number | null {
  const bm = /^board(\d+)$/.exec(specId);
  if (bm) return Number(bm[1]);
  const cm = /^case(\d+)$/.exec(specId);
  if (cm) return Number(cm[1]);
  return getOsSpec(specId)?.tier ?? getSpec(specId)?.tier ?? null;
}
