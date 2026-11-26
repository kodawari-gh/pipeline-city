import { GEO, PKG, SOCKET_E } from '../layout/layout';
import { SATA_LANES } from '../layout/pins';
import { NVME_LANES, addHops } from './bus';
import { audioBus, lanBus } from './chipBuses';
import { atxPowerBus, cpuPowerBus, slotPowerBus, vcoreBus, vdimmBus } from './powerBuses';
import { signalBuses } from './signals';
import type { Bus, BusKind, Edges, Lane, TierGeo } from './types';

/** The buses drawn as differential pairs. */
const PAIRED: ReadonlySet<BusKind> = new Set(['pcie', 'nvme', 'dmi', 'video', 'dp']);
/** The buses whose lanes all arrive together, as one group. */
const ONE_GROUP: ReadonlySet<BusKind> = new Set(['dmi', 'video', 'dp', 'lan']);

/** The bus's lanes cut into consecutive groups of the given sizes. */
const cut = (b: Bus, sizes: number[]): Lane[][] => {
  let k = 0;
  return sizes.map((n) => b.lanes.slice(k, (k += n)));
};

/** The groups whose lanes must arrive together, for the buses that have them. */
function groupsOf(b: Bus, g: TierGeo): Lane[][] | undefined {
  if (b.id === 'mem') {
    return [(b.taps ?? []).flatMap((t) => t.lanes)];
  }
  if (b.id === 'nvme') {
    return cut(
      b,
      g.m2.map(() => NVME_LANES),
    );
  }
  if (b.id === 'sata') {
    return cut(
      b,
      g.sata.map(() => SATA_LANES),
    );
  }
  if (b.id === 'usb') {
    return cut(b, [4, ...Array.from({ length: g.usb }, () => 2)]);
  }
  return ONE_GROUP.has(b.id) ? [b.lanes] : undefined;
}

/**
 * Every board bus of the current tier (`GEO`), routed once. Lane order inside a bundle is stable; direction runs CPU outward.
 * Every lane ends on a pin that the part's art draws (`pins.ts`): the CPU socket's escape pads at one end, a pad bar on a socket, a leg
 * of a chip, a contact of a connector at the other. A run changes lane pitch only on a 45 degree leg right before its pins.
 */
export function buildBuses(): Bus[] {
  const g = GEO;
  const e: Edges = {
    px: PKG.x - SOCKET_E,
    qx: PKG.x + PKG.w + SOCKET_E,
    qy: PKG.y + PKG.h + SOCKET_E,
    py: PKG.y - SOCKET_E,
  };
  const buses: Bus[] = [
    ...signalBuses(g, e),
    // ---- power ----
    cpuPowerBus(g),
    vcoreBus(g, e),
    atxPowerBus(g),
    vdimmBus(g),
    ...slotPowerBus(g),
    audioBus(g),
    ...lanBus(g),
  ];
  addHops(buses);
  for (const b of buses) {
    if (PAIRED.has(b.id)) {
      b.pair = true;
    }
  }
  for (const b of buses) {
    const groups = groupsOf(b, g);
    if (groups) {
      b.groups = groups;
    }
  }
  return buses;
}
