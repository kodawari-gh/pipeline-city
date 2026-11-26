// The picker card for a selected id: picks the card builder for keys, the machine's spots, the network and parts.

import type { Snapshot } from '@/worker/game/game';
import { describeId } from '@/core/ui/logic';
import { getIspSpec, getRouterSpec } from '@/features/network/sim/specs';
import { emptyCard } from './pickerBase';
import { kindOf } from './pickerKinds';
import { keyCard, usbCard } from './keyCards';
import { powerCard, trayCard, vrmCard } from './systemCards';
import { netCard, wireCard } from './netCards';
import { partCard } from './partCard';
import type { PickerModel } from './pickerTypes';

/** The card of a fixed spot of the machine (a VRM, the tray, the power button, the USB port), or undefined. */
function spotCard(id: string, s: Snapshot): PickerModel | undefined {
  if (id === 'vrm' || id === 'vrm2') {
    return vrmCard(id, s);
  }
  if (id === 'tray') {
    return trayCard(id, s);
  }
  if (id === 'power') {
    return powerCard(id, s);
  }
  return id === 'usb' ? usbCard(id, s) : undefined;
}

/** The router spot, the wall socket (the plan) and a router in the inventory: their own ladders, applied without a power-off. */
function netKindOf(id: string, s: Snapshot): 'router' | 'isp' | null {
  if (id === 'router' || id === 'wall' || getRouterSpec(id) || getIspSpec(id)) {
    const kind = kindOf(id, s);
    return kind === 'router' || kind === 'isp' ? kind : null;
  }
  const routerInInventory = id.startsWith('inv:') && s.inventory.find((x) => x.id === id.slice(4))?.kind === 'router';
  return routerInInventory ? 'router' : null;
}

/** Every card that is not a key: the machine's spots, the wires, the network, parts and anything with a description. */
function cardOf(id: string, s: Snapshot): PickerModel | null {
  const card = spotCard(id, s) ?? wireCard(id, s);
  if (card) {
    return card;
  }
  const netKind = netKindOf(id, s);
  if (netKind) {
    return netCard(id, netKind, s);
  }
  const kind = kindOf(id, s);
  if (kind) {
    return partCard(id, s, kind);
  }
  const desc = describeId(id, s);
  return desc ? emptyCard(id, 'info', desc) : null;
}

/** The picker card for a selected id, or null when there is nothing to show. */
export function pickerFor(id: string | null, s: Snapshot | null): PickerModel | null {
  if (id === null || id === '' || !s) {
    return null;
  }
  return id.startsWith('key:') ? keyCard(id, s) : cardOf(id, s);
}
