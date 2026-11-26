// Words for the parts of the NIC card the board draws when the camera is close (docs/render/net.md "Inside the NIC and the router", render/nic/niclayout.ts; the Ethernet chip on the motherboard is
// the same die, `board.nic-<part>`: its controller and its blocks only): the bodies of the card
// (the jack, the gold fingers, the controller, the crystal, the flash, the regulator, the sticker) and the blocks of the controller's die. An id is the PCIe slot and the part:
// `pcie2.nic-mac`. Pure. It imports nothing from logic.ts (logic.ts imports netdesc.ts, which calls this).

import * as boardSpecs from '../../board/sim/specs';
import type { Snapshot } from '@/worker/game/game';
import type { Description } from '@/core/ui/regions';
import { BOARD_NIC } from '../render/nic/nicplan';
import { describeNicKind, nicName, nicPlanOf } from './nicdescParts';

const ID = /^(?<slot>pcie\d+|board)\.nic-(?<kind>[a-z]+)$/u;
const KINDS = new Set([
  'ctl',
  'jack',
  'edge',
  'label',
  'phy',
  'mac',
  'stats',
  'rxq',
  'txq',
  'dma',
  'pcie',
  'nvm',
  'xtal',
  'vreg',
  'temp',
]);
/** The parts of the Ethernet chip on the motherboard (`board.nic-mac`): its package and the blocks of its die. It has no jack, flash, crystal or regulator of its own here, and no heat sensor. */
const BOARD_KINDS = new Set(['ctl', 'phy', 'mac', 'stats', 'rxq', 'txq', 'dma', 'pcie']);

/** Is this one of the NIC card's part ids (or one of the motherboard's Ethernet chip)? */
export const isNicId = (id: string): boolean => {
  const m = ID.exec(id);
  return m !== null && (m[1] === BOARD_NIC ? BOARD_KINDS : KINDS).has(m[2]!);
};

/** Description of a NIC part by its id, or null when the id is not one of ours. */
export function describeNicId(id: string, s?: Snapshot | null): Description | null {
  const m = ID.exec(id);
  if (!m || !KINDS.has(m[2]!)) {
    return null;
  }
  const slot = m[1]!,
    kind = m[2]!,
    onboard = slot === BOARD_NIC;
  if (onboard && !BOARD_KINDS.has(kind)) {
    return null;
  }
  const dev = onboard ? undefined : s?.devices.find((d) => d.slot === slot && d.kind === 'nic');
  const spec = dev ? (boardSpecs.getSpec(dev.spec) as boardSpecs.NicSpec | undefined) : undefined,
    mbps = onboard ? (s?.board.features.ethernetMbps ?? 0) : 0;
  const plan = nicPlanOf(onboard, mbps, spec),
    n = s?.net;
  const here = onboard
    ? n?.port.kind === 'board'
    : dev !== undefined && n?.port.kind === 'nic' && n.port.deviceId === dev.id;
  const name = nicName(onboard, spec),
    chip = plan ? `${plan.chip}, ${plan.std}` : 'network chip';
  // (the sim has one NIC device: its buffers and counters are this port's while the cable is in it)
  const nic = here ? n?.stack.nic : undefined;
  return describeNicKind(kind, { onboard, name, chip, dev, plan, s, n, here, nic, spec, mbps });
}
