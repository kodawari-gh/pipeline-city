// What a part card is about (the slot, inventory item and device behind a selected id), and what the card reads from it:
// its actions, the current part and the part to compare.

import { getSpec } from '@/features/board/sim/specs';
import type { DeviceSnap, Snapshot } from '@/worker/game/game';
import { getOsSpec } from '@/features/os/sim';
import { filled } from './pickerBase';
import { boardId, caseId, WORLD_KIND } from './pickerKinds';
import type { OsSection, PickerAction, SelectedKind } from './pickerTypes';
import { osSection } from './osSection';

/** What a part card is about: the selected id, the slot, inventory item and device behind it. */
export interface PartCtx {
  id: string;
  s: Snapshot;
  kind: SelectedKind;
  slot: Snapshot['slots'][number] | undefined;
  invItem: Snapshot['inventory'][number] | undefined;
  dev: DeviceSnap | undefined;
  emptySocket: boolean;
  /** A fan spot takes one size: the size of the spot (or of the fan). */
  fanSize: number | undefined;
  /** The device is the drive that holds the OS. */
  hostsOs: boolean;
  sec: OsSection | null;
}

/** The device a selected id stands for: the one in the slot, the one of a world object's kind, or the id or spec itself. */
function deviceFor(s: Snapshot, id: string, at: Pick<PartCtx, 'kind' | 'slot'>): DeviceSnap | undefined {
  const slotDev = at.slot?.deviceId;
  if (filled(slotDev)) {
    return s.devices.find((d) => d.id === slotDev);
  }
  if (WORLD_KIND[id] !== undefined) {
    return s.devices.find((d) => d.kind === at.kind);
  }
  return s.devices.find((d) => d.id === id) ?? s.devices.find((d) => d.spec === id);
}

function fanSizeOf(kind: SelectedKind, at: Pick<PartCtx, 'id' | 'slot' | 'invItem' | 'dev'>): number | undefined {
  if (kind !== 'fan') {
    return undefined;
  }
  const fanSpec = getSpec(at.dev?.spec ?? at.invItem?.spec ?? at.id);
  return at.slot?.size ?? (fanSpec?.kind === 'fan' ? fanSpec.size : undefined);
}

export function partCtx(id: string, s: Snapshot, kind: SelectedKind): PartCtx {
  const slot = s.slots.find((x) => x.id === id);
  const invItem = id.startsWith('inv:') ? s.inventory.find((x) => x.id === id.slice(4)) : undefined;
  const dev = deviceFor(s, id, { kind, slot });
  const hostsOs = dev !== undefined && s.os?.deviceId === dev.id;
  return {
    id,
    s,
    kind,
    slot,
    invItem,
    dev,
    emptySocket: slot !== undefined && !filled(slot.deviceId),
    fanSize: fanSizeOf(kind, { id, slot, invItem, dev }),
    hostsOs,
    sec: kind === 'os' || hostsOs ? osSection(s) : null,
  };
}

/** Why a fitted part cannot come out now, if it cannot. */
function uninstallWhy({ s, hostsOs }: PartCtx): string | undefined {
  if (s.powered) {
    return 'Power the machine off first';
  }
  return hostsOs ? 'The OS is on this drive: uninstall the OS first' : undefined;
}

/** Format a drive that does not hold the OS. */
function formatAction({ s, kind, dev }: PartCtx): PickerAction[] {
  const st = kind === 'storage' && dev ? s.storage.find((x) => x.deviceId === dev.id) : undefined;
  if (!st || !dev || st.hasOs || dev.burnt) {
    return [];
  }
  return [{ id: 'formatDrive', deviceId: dev.id, label: 'Format drive', why: st.format.why ?? undefined }];
}

/** Any fitted part (the monitor, the PSU, a DIMM, a card...) can come out again, into the inventory; a burnt one is scrapped. */
function uninstallAction(c: PartCtx): PickerAction[] {
  const { dev, id } = c;
  if (!dev || c.emptySocket || c.invItem) {
    return [];
  }
  const fitted = c.slot?.deviceId === dev.id || id === dev.id || WORLD_KIND[id] !== undefined;
  if (!fitted) {
    return [];
  }
  return [
    {
      id: 'uninstall',
      deviceId: dev.id,
      label: dev.burnt ? `Scrap ${dev.name}` : `Remove ${dev.name}`,
      why: uninstallWhy(c),
    },
  ];
}

/** The card's actions: power cycle a tripped PSU, format a drive, uninstall the OS, take the part out. */
export function partActions(c: PartCtx): PickerAction[] {
  const { s, kind } = c;
  const actions: PickerAction[] = [];
  if (kind === 'psu' && s.power.tripped) {
    actions.push({ id: 'powerCycle', label: 'Power cycle', primary: true });
  }
  actions.push(...formatAction(c));
  if (c.sec) {
    actions.push({
      id: 'uninstallOs',
      label: 'Uninstall OS',
      why: s.powered ? 'Power the machine off first' : undefined,
    });
  }
  actions.push(...uninstallAction(c));
  return actions;
}

export function currentOf({ s, kind, dev, slot }: PartCtx): string | null {
  if (kind === 'board') {
    return boardId(s.boardTier);
  }
  if (kind === 'case') {
    return caseId(s.caseTier);
  }
  if (kind === 'os') {
    return s.os?.spec ?? null;
  }
  return dev?.spec ?? (slot ? null : (s.devices.find((x) => x.kind === kind)?.spec ?? null));
}

/** A spec id that is neither a slot nor a fitted part (a shop or ladder item) is the comparison to show. */
export function focusOf({ id, invItem, slot, dev }: PartCtx): string | null {
  if (invItem) {
    return invItem.spec;
  }
  return !slot && !dev && (getSpec(id) ?? getOsSpec(id)) ? id : null;
}
