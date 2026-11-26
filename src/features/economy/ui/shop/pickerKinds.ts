// The part picker's ids: board and case ids, the kind a selected id stands for, and every spec id of a kind.

import { BOARD_TIERS, CASE_TIERS, getSpec, specsOfKind } from '@/features/board/sim/specs';
import type { DeviceKind } from '@/features/board/sim';
import { getOsSpec, OS_SPECS } from '@/features/os/sim';
import { getIspSpec, getRouterSpec, ISP_SPECS, ROUTER_SPECS } from '@/features/network/sim/specs';
import type { Snapshot } from '@/worker/game/game';
import type { PickerKind, SelectedKind } from './pickerTypes';

/** Board ids in the board ladder, one per tier. */
export const boardId = (tier: number): string => `board${tier}`;
/** Case ids in the case ladder, one per tier. */
export const caseId = (tier: number): string => `case${tier}`;

const SLOT_KIND: Record<string, DeviceKind> = {
  cpu: 'cpu',
  dimm: 'ram',
  atx: 'psu',
  'atx-plus': 'psu',
  cooler: 'cooler',
  display: 'display',
  sata: 'storage',
  m2: 'storage',
  'vrm-sink': 'vrm-sink',
  'ram-sink': 'ram-sink',
  pcie: 'nic',
  tpm: 'tpm',
  radiator: 'radiator',
  fan: 'fan',
};

/** World objects that stand for a part kind (the monitor, the PSU readout, the drive bay...). */
export const WORLD_KIND: Record<string, SelectedKind> = {
  psu: 'psu',
  monitor: 'display',
  'psu.readout': 'psu',
  board: 'board',
  case: 'case',
  bay: 'storage',
  os: 'os',
  router: 'router',
  wall: 'isp',
};

/** The kind of a spec id or a board or case tier id, if any. */
function kindOfSpecId(id: string): SelectedKind | null {
  if (getRouterSpec(id)) {
    return 'router';
  }
  if (getIspSpec(id)) {
    return 'isp';
  }
  const spec = getSpec(id);
  if (spec) {
    return spec.kind;
  }
  if (getOsSpec(id)) {
    return 'os';
  }
  if (/^board[0-9]+$/u.test(id)) {
    return 'board';
  }
  if (/^case[0-9]+$/u.test(id)) {
    return 'case';
  }
  return null;
}

/** The kind a selected id stands for, if any (slot, device, inventory item, spec id, world object or board tier). */
export function kindOf(id: string, s: Snapshot): SelectedKind | null {
  const slot = s.slots.find((x) => x.id === id);
  if (slot) {
    return SLOT_KIND[slot.type] ?? null;
  }
  const dev = s.devices.find((d) => d.id === id);
  if (dev) {
    return dev.kind;
  }
  if (id.startsWith('inv:')) {
    const it = s.inventory.find((x) => x.id === id.slice(4));
    return it ? it.kind : null;
  }
  const world = WORLD_KIND[id];
  if (world !== undefined) {
    return world;
  }
  return kindOfSpecId(id);
}

const SPEC_KINDS = new Set<PickerKind>([
  'cpu',
  'ram',
  'psu',
  'cooler',
  'fan',
  'display',
  'storage',
  'vrm-sink',
  'ram-sink',
  'nic',
  'gpu',
  'npu',
  'tpm',
  'radiator',
]);

const isSpecKind = (kind: PickerKind): kind is DeviceKind => SPEC_KINDS.has(kind);

/** Every spec id of a kind, ordered by tier (or the board tiers). */
export function catalogOf(kind: PickerKind): string[] {
  if (kind === 'board') {
    return BOARD_TIERS.map((b) => boardId(b.tier));
  }
  if (kind === 'case') {
    return CASE_TIERS.map((c) => caseId(c.tier));
  }
  if (isSpecKind(kind)) {
    return specsOfKind(kind).map((x) => x.id);
  }
  if (kind === 'os') {
    return OS_SPECS.map((o) => o.id);
  }
  if (kind === 'router') {
    return ROUTER_SPECS.map((r) => r.id);
  }
  if (kind === 'isp') {
    return ISP_SPECS.map((p) => p.id);
  }
  return [];
}
