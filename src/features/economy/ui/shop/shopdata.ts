// The shop and the inventory's category icons, pure logic: every kind of item the game sells, in the order a build meets them.

import type { DeviceKind } from '@/features/board/sim/specs';
import { BOARD_TIERS, CASE_TIERS, getSpec, specsOfKind } from '@/features/board/sim/specs';
import type { Snapshot } from '@/worker/game/game';
import { getOsSpec } from '@/features/os/sim';
import { KIND_LABEL } from '@/core/ui/logic';
import { boardId, caseId, ladderFor, type IconName, type LadderStep } from './picker';

export type ShopKind = DeviceKind | 'board' | 'case' | 'os' | 'router' | 'isp';

/** One picture per category, so the inventory and the shop read without words. */
export const KIND_ICON: Record<ShopKind, IconName> = {
  cpu: 'cpu', ram: 'memory', cooler: 'tower', fan: 'fan', psu: 'bolt', display: 'screen', storage: 'disk', board: 'board', case: 'case',
  radiator: 'flame', 'vrm-sink': 'heatsink', 'ram-sink': 'wave', nic: 'net', gpu: 'card', npu: 'grid', tpm: 'lock', os: 'layers', router: 'router', isp: 'globe',
};

export const SHOP_ORDER: ShopKind[] = ['case', 'board', 'cpu', 'cooler', 'fan', 'radiator', 'ram', 'psu', 'display', 'storage', 'vrm-sink', 'ram-sink', 'nic', 'gpu', 'npu', 'tpm', 'os', 'router', 'isp'];

/** Category name as the shelf and the shop say it ("Software" for the OS group). */
export const kindLabel = (k: string): string => (k === 'os' ? 'Software' : KIND_LABEL[k as ShopKind] ?? k);
/** The icon of a category, with a plain box for anything unknown. */
export const kindIcon = (k: string): IconName => KIND_ICON[k as ShopKind] ?? 'box';

/** Has this kind a 3D model in the showcase? (Boards, software, routers and plans are not parts you can turn in your hand.) */
export const hasModel = (k: string | null): boolean => !!k && !['board', 'os', 'router', 'isp'].includes(k);

export interface GalleryItem { id: string; name: string; note: string }
export interface GalleryGroup { key: string; kind: string; items: GalleryItem[] }

const GALLERY_KINDS: DeviceKind[] = ['cpu', 'cooler', 'fan', 'radiator', 'ram', 'psu', 'display', 'storage', 'vrm-sink', 'ram-sink', 'gpu', 'npu', 'nic', 'tpm'];

/** Every part the showcase can build, by category (cases first, as the shop lists them): the gallery's list, and the shop's stills (`tools/stills.mjs`). */
export function galleryGroups(): GalleryGroup[] {
  const out: GalleryGroup[] = [{ key: 'case', kind: 'case', items: CASE_TIERS.map((c) => ({ id: `case${c.tier}`, name: c.name, note: `${c.form} case` })) }];
  out.push({ key: 'board', kind: 'board', items: BOARD_TIERS.map((b) => ({ id: `board${b.tier}`, name: b.name, note: 'motherboard' })) });
  for (const k of GALLERY_KINDS) out.push({ key: k, kind: k, items: specsOfKind(k).map((s) => ({ id: s.id, name: s.name, note: `tier ${s.tier}` })) });
  return out.filter((g) => g.items.length > 0);
}

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

/** A group of the shelf: the kinds of parts that do one job together (the shelf's first row of chips). */
export interface PartGroup { key: string; label: string; icon: IconName; kinds: ShopKind[] }

/** The shelf's groups, in build order. Every kind the shelf holds is in exactly one group (`shopdata.test.ts`). */
export const PART_GROUPS: PartGroup[] = [
  { key: 'build', label: 'Board & case', icon: 'case', kinds: ['case', 'board'] },
  { key: 'compute', label: 'Compute', icon: 'cpu', kinds: ['cpu', 'ram', 'gpu', 'npu'] },
  { key: 'cooling', label: 'Cooling', icon: 'fan', kinds: ['cooler', 'fan', 'radiator', 'vrm-sink', 'ram-sink'] },
  { key: 'power', label: 'Power', icon: 'bolt', kinds: ['psu'] },
  { key: 'storage', label: 'Storage', icon: 'disk', kinds: ['storage'] },
  { key: 'network', label: 'Network', icon: 'net', kinds: ['nic'] },
  { key: 'security', label: 'Security', icon: 'lock', kinds: ['tpm'] },
];

/** The kinds the shelf can hold (the parts that fit the PC): the groups must cover them all. */
export const SHELF_KINDS: ShopKind[] = ['case', 'board', 'cpu', 'cooler', 'fan', 'radiator', 'ram', 'psu', 'storage', 'vrm-sink', 'ram-sink', 'gpu', 'npu', 'nic', 'tpm'];
