// Which traces carry what. Pure geometry and tables: the role of every bus of the board, and the chains of hops a message takes (a SATA read goes
// port -> chipset -> CPU), each hop naming the lanes it runs on. `live.ts` decides when a message happens; this decides where it goes.

import type { Bus, BusKind, Lane } from './routes';

/**
 * What a bus is for. `data` and `control` carry messages (a packet runs along them when something is sent), `power` glows in proportion to
 * current, `dark` is there to be seen (no signal in the game moves on it: crystals, audio, RGB, the fan lead, DisplayPort without a display).
 */
export type BusRole = 'data' | 'control' | 'power' | 'dark';

/** The role of every bus (a `Record`, so a new bus must be classified here). */
export const BUS_ROLE: Record<BusKind, BusRole> = {
  mem: 'data', nvme: 'data', dmi: 'data', pcie: 'data', sata: 'data', usb: 'data', video: 'data',
  lan: 'data', phyl: 'data',
  spi: 'control', lpc: 'control', hdr: 'control', svid: 'control', pwmc: 'control', dbg: 'control', fanc: 'control',
  pwr12: 'power', pwrcpu: 'power', vcore: 'power', vdimm: 'power',
  dp: 'dark', audio: 'dark', hda: 'dark', rtc: 'dark', clk: 'dark', rgb: 'dark', pwrpcie: 'dark',
};

/** Buses that carry messages. */
export const isMessageBus = (id: BusKind): boolean => BUS_ROLE[id] === 'data' || BUS_ROLE[id] === 'control';

/** Which lanes of a bus a hop runs on: all of them, one group (one M.2, one SATA port, one slot), the USB uplink, or one USB port's pair. */
export type Pick = 'all' | { group: number } | 'uplink' | { usbPort: number };

/** One leg of a message: `dir` 1 runs along the bus's lanes as routed (first end to second), -1 the other way. */
export interface Hop { bus: BusKind; dir: 1 | -1; pick?: Pick }

/** The lanes a pick selects (none when the board lacks that group: a port or slot it does not have). */
export function lanesOf(bus: Bus, pick: Pick = 'all'): Lane[] {
  if (pick === 'all') return bus.lanes;
  if (pick === 'uplink') return bus.groups?.[0] ?? [];
  if ('group' in pick) return bus.groups?.[pick.group] ?? [];
  return bus.groups?.[1 + pick.usbPort] ?? []; // (group 0 of the USB bus is the uplink, then one pair per port)
}

/** A hop with its lanes found, or null when the board has no such bus or lanes (tier 0 has no ethernet jack, no debug display...). */
export interface Leg { bus: BusKind; dir: 1 | -1; lanes: Lane[]; w: number }
export function resolve(buses: ReadonlyMap<BusKind, Bus>, hops: readonly Hop[]): Leg[] {
  const out: Leg[] = [];
  for (const h of hops) {
    const bus = buses.get(h.bus), lanes = bus ? lanesOf(bus, h.pick) : [];
    if (bus && lanes.length) out.push({ bus: h.bus, dir: h.dir, lanes, w: bus.w });
  }
  return out;
}

/** The USB port the key goes in (`USB_PORT` is the first port, level with the CPU). */
export const KEY_PORT = 0;

/** The key and the CPU talk: the hub's uplink and the key's port only, never the chipset. `toKey`: the CPU writes. */
export const keyChain = (toKey: boolean): Hop[] => toKey
  ? [{ bus: 'usb', dir: 1, pick: 'uplink' }, { bus: 'usb', dir: 1, pick: { usbPort: KEY_PORT } }]
  : [{ bus: 'usb', dir: -1, pick: { usbPort: KEY_PORT } }, { bus: 'usb', dir: -1, pick: 'uplink' }];

/**
 * A drive and the CPU talk. An M.2 is wired to the CPU itself; a SATA port is on the chipset, so its traffic crosses DMI.
 * The bus lanes run CPU -> M.2 and chipset -> port; DMI runs CPU -> chipset.
 */
export function driveChain(slot: string, toDrive: boolean): Hop[] {
  const m = /^(m2|sata)(\d+)$/.exec(slot);
  if (!m) return [];
  const group = { group: Number(m[2]) }, d = toDrive ? 1 : -1;
  if (m[1] === 'm2') return [{ bus: 'nvme', dir: d, pick: group }];
  return toDrive ? [{ bus: 'dmi', dir: 1 }, { bus: 'sata', dir: 1, pick: group }] : [{ bus: 'sata', dir: -1, pick: group }, { bus: 'dmi', dir: -1 }];
}

/** A card in a PCIe slot (`pcie<k>`) and the CPU talk. The first slot is the CPU's own x16; the others hang off the chipset, so cross DMI. */
export function slotChain(slot: string, toCard: boolean): Hop[] {
  const m = /^pcie(\d+)$/.exec(slot);
  if (!m) return [];
  const k = Number(m[1]), group = { group: k }, d = toCard ? 1 : -1;
  if (k === 0) return [{ bus: 'pcie', dir: d, pick: group }];
  return toCard ? [{ bus: 'dmi', dir: 1 }, { bus: 'pcie', dir: 1, pick: group }] : [{ bus: 'pcie', dir: -1, pick: group }, { bus: 'dmi', dir: -1 }];
}

/** The board's own ethernet: jack, PHY, the I/O hub, its uplink to the CPU (the jack's lanes run PHY -> jack, the PHY's PHY -> hub). `down`: toward the CPU. */
export const boardNetChain = (down: boolean): Hop[] => down
  ? [{ bus: 'lan', dir: -1 }, { bus: 'phyl', dir: 1 }, { bus: 'usb', dir: -1, pick: 'uplink' }]
  : [{ bus: 'usb', dir: 1, pick: 'uplink' }, { bus: 'phyl', dir: -1 }, { bus: 'lan', dir: 1 }];

/** POST reads the BIOS: flash -> chipset (SPI), chipset -> CPU (DMI). */
export const BIOS_CHAIN: Hop[] = [{ bus: 'spi', dir: 1 }, { bus: 'dmi', dir: -1 }];
/** The power switch is read: pin header -> I/O controller (the trunk), -> chipset (LPC), -> CPU (DMI). */
export const POWER_ON_CHAIN: Hop[] = [{ bus: 'hdr', dir: -1 }, { bus: 'lpc', dir: 1 }, { bus: 'dmi', dir: -1 }];
/** The CPU asks the regulator for a voltage (SVID), the controller drives its phases (PWM). The CPU's controller is the first `pwmc`. */
export const VOLTAGE_CHAIN: Hop[] = [{ bus: 'svid', dir: -1 }, { bus: 'pwmc', dir: 1 }];
/** POST asks the cooler: the I/O hub's lanes to the CPU_FAN header (the first `fanc`; the heatsink fans' leads stay quiet). */
export const COOLER_CHAIN: Hop[] = [{ bus: 'fanc', dir: 1 }];
/** A POST code: CPU -> chipset (DMI), chipset -> debug display. */
export const POST_CODE_CHAIN: Hop[] = [{ bus: 'dmi', dir: 1 }, { bus: 'dbg', dir: 1 }];
/** The picture leaves the CPU's video lanes for the HDMI port. */
export const VIDEO_CHAIN: Hop[] = [{ bus: 'video', dir: 1 }];

/** The slot number of a drive or card slot id, or -1. */
export const slotIndex = (slot: string): number => { const m = /(\d+)$/.exec(slot); return m ? Number(m[1]) : -1; };
