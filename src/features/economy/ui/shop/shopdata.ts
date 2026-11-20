// The shop and the inventory's category icons, pure logic: every kind of item the game sells, in the order a build meets them.

import type { DeviceKind } from '@/features/board/sim/specs';
import { BOARD_TIERS, CASE_TIERS, getSpec, specsOfKind } from '@/features/board/sim/specs';
import type { Snapshot } from '@/worker/game/game';
import { getOsSpec } from '@/features/os/sim';
import { ISP_SPECS, ROUTER_SPECS } from '@/features/network/sim/specs';
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
/**
 * A category's short name for the shelf's rail, where it stands beside its icon in a column of about 4 rem: one word, 9 letters at most. The heading,
 * the tooltip and the screen reader say it in full (`kindLabel`).
 */
const RAIL_LABEL: Partial<Record<ShopKind, string>> = {
  board: 'Board', psu: 'Power', display: 'Monitor', storage: 'Drive', nic: 'Network', gpu: 'Graphics', npu: 'AI card', tpm: 'Secure',
  'vrm-sink': 'VRM sink', 'ram-sink': 'RAM sink', os: 'Software', isp: 'Internet',
};
export const railLabel = (k: string): string => RAIL_LABEL[k as ShopKind] ?? kindLabel(k);
/** The icon of a category, with a plain box for anything unknown. */
export const kindIcon = (k: string): IconName => KIND_ICON[k as ShopKind] ?? 'box';

/** Has this kind a 3D model in the showcase? (Boards, software and plans are not parts you can turn in your hand; a router is.) */
export const hasModel = (k: string | null): boolean => !!k && !['board', 'os', 'isp'].includes(k);

/** The list price of a catalogue item (a part, a board tier or a case tier, an OS, a router or an internet plan), or null for an id it does not know. */
export function priceOf(item: string): number | null {
  const shell = /^(board|case)(\d+)$/.exec(item);
  if (shell) return (shell[1] === 'board' ? BOARD_TIERS : CASE_TIERS)[Number(shell[2])]?.price ?? null;
  return getSpec(item)?.price ?? getOsSpec(item)?.price ?? ROUTER_SPECS.find((r) => r.id === item)?.price ?? ISP_SPECS.find((p) => p.id === item)?.price ?? null;
}

/** A part's name in two: the name, and what the catalogue says of it in brackets (`Tiny-5F+I (front end: I-cache)` is `Tiny-5F+I` and `front end: I-cache`). */
export function splitName(name: string): { title: string; detail: string } {
  const m = /^(.*?)\s+\((.*)\)$/.exec(name);
  return m ? { title: m[1]!, detail: m[2]! } : { title: name, detail: '' };
}

/** How many of `n` pips a tier lights: at least one, all of them at the kind's top tier. */
export function pips(tier: number, top: number, n = 5): number {
  if (top <= 0) return n;
  return Math.max(1, Math.min(n, Math.round((tier / top) * n)));
}

export interface GalleryItem { id: string; name: string; note: string; tier: number }
export interface GalleryGroup { key: string; kind: string; items: GalleryItem[] }

/** The device kinds the studio screens list, in the shop's order (so the Gallery, Build my PC and the shop agree on where a category sits). */
const GALLERY_KINDS = SHOP_ORDER.filter((k): k is DeviceKind => hasModel(k) && k !== 'case' && k !== 'router');

/** Every category of the studio screens, cases and boards first, the router last (the one network prop with a model): the Gallery's rail and Build my PC's shelf (which has no monitor) take their order from it. */
export const STUDIO_KINDS: readonly string[] = ['case', 'board', ...GALLERY_KINDS, 'router'];

/** Every part the showcase can build, by category (cases first, as the shop lists them): the gallery's list, and the shop's stills (`tools/stills.mjs`). */
export function galleryGroups(): GalleryGroup[] {
  const out: GalleryGroup[] = [{ key: 'case', kind: 'case', items: CASE_TIERS.map((c) => ({ id: `case${c.tier}`, name: c.name, note: `${c.form} case`, tier: c.tier })) }];
  out.push({ key: 'board', kind: 'board', items: BOARD_TIERS.map((b) => ({ id: `board${b.tier}`, name: b.name, note: 'motherboard', tier: b.tier })) });
  for (const k of GALLERY_KINDS) out.push({ key: k, kind: k, items: specsOfKind(k).map((s) => ({ id: s.id, name: s.name, note: `tier ${s.tier}`, tier: s.tier })) });
  out.push({ key: 'router', kind: 'router', items: ROUTER_SPECS.map((r) => ({ id: r.id, name: r.name, note: `tier ${r.tier}`, tier: r.tier })) });
  return out.filter((g) => g.items.length > 0);
}

/** Ids that get a baked still but no 3D model: their picture is the board's own art (the internet plans), drawn by `tools/stills.mjs`. (An OS is software: it keeps its drawn disc.) */
export const artStillIds = (): string[] => ISP_SPECS.map((p) => p.id);

/** Every id that must have a baked still: all the gallery's parts, the routers and the plans. */
export const stillIds = (): string[] => [...galleryGroups().flatMap((g) => g.items.map((i) => i.id)), ...artStillIds()];

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
