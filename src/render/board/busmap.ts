// Which traces carry what. Pure geometry and tables: the role of every bus of the board, and the chains of hops a message takes (a SATA read goes
// port -> chipset -> CPU), each hop naming the lanes it runs on. `live.ts` decides when a message happens; this decides where it goes.

import {
  DISPLAY_BASE, DISPLAY_SIZE, GPU_BASE, GPU_PORTS, GPU_STRIDE, INTC_BASE, INTC_SIZE, MMU_BASE, MMU_SIZE, MPU_BASE, MPU_SIZE, NPU_BASE, NPU_PORTS, NPU_STRIDE, PCH_BASE, TIMER_BASE, TIMER_SIZE, PCH_KEY_WINDOW, PCH_KEY_WINDOW_SIZE, PCH_RESULT_WINDOW, PCH_RESULT_WORDS,
  STORAGE_BASE, STORAGE_PORTS, STORAGE_STRIDE, TPM_BASE, TPM_SIZE,
} from '../../sim/isa/memmap';
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
  pwr12: 'power', pwrcpu: 'power', vcore: 'power', vdimm: 'power', pwrpcie: 'power',
  dp: 'dark', audio: 'dark', hda: 'dark', rtc: 'dark', clk: 'dark', rgb: 'dark',
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

/** The part a bus address belongs to (everything but RAM is memory-mapped, and the CPU moves every word itself: there is no DMA). */
export type DeviceHit = { kind: 'drive'; slot: string } | { kind: 'card'; slot: string } | { kind: 'key' } | { kind: 'tpm' } | { kind: 'display' } | { kind: 'chipset' }
  // on the CPU's die (the die view shows them: `PlanView.poke`)
  | { kind: 'intc' } | { kind: 'timer' } | { kind: 'mpu' } | { kind: 'mmu' };

/**
 * The device whose window holds `addr`: a drive's registers and block buffer, a graphics or AI card's registers and memory (the NPU in slot k
 * is at the slot's `pcie<k>`), the plugged key's program and result words, the TPM on its header, the text display, the chipset's own
 * registers, and the units on the CPU's own die (interrupt controller, timer, MPU, MMU: no trace on the board, the die view shows them); null for RAM.
 */
export function deviceAt(addr: number): DeviceHit | null {
  const a = addr >>> 0, within = (base: number, size: number) => a >= base && a < base + size;
  if (within(STORAGE_BASE, STORAGE_PORTS.length * STORAGE_STRIDE)) return { kind: 'drive', slot: STORAGE_PORTS[Math.floor((a - STORAGE_BASE) / STORAGE_STRIDE)]! };
  if (within(GPU_BASE, GPU_PORTS.length * GPU_STRIDE)) return { kind: 'card', slot: GPU_PORTS[Math.floor((a - GPU_BASE) / GPU_STRIDE)]! };
  if (within(NPU_BASE, NPU_PORTS.length * NPU_STRIDE)) return { kind: 'card', slot: 'pcie' + Math.floor((a - NPU_BASE) / NPU_STRIDE) };
  if (within(PCH_BASE + PCH_KEY_WINDOW, PCH_KEY_WINDOW_SIZE) || within(PCH_BASE + PCH_RESULT_WINDOW, PCH_RESULT_WORDS * 4)) return { kind: 'key' };
  if (within(PCH_BASE, PCH_KEY_WINDOW)) return { kind: 'chipset' };
  if (within(TPM_BASE, TPM_SIZE)) return { kind: 'tpm' };
  if (within(DISPLAY_BASE, DISPLAY_SIZE)) return { kind: 'display' };
  if (within(INTC_BASE, INTC_SIZE)) return { kind: 'intc' };
  if (within(TIMER_BASE, TIMER_SIZE)) return { kind: 'timer' };
  if (within(MPU_BASE, MPU_SIZE)) return { kind: 'mpu' };
  if (within(MMU_BASE, MMU_SIZE)) return { kind: 'mmu' };
  return null;
}

/** An access to an AI card's window: the PCIe slot of the card and the offset in the window (registers below `NPU_MEM`, card memory from it), or null for any other address. */
export function npuAccess(addr: number): { slot: string; off: number } | null {
  const a = addr >>> 0;
  if (a < NPU_BASE || a >= NPU_BASE + NPU_PORTS.length * NPU_STRIDE) return null;
  return { slot: 'pcie' + Math.floor((a - NPU_BASE) / NPU_STRIDE), off: (a - NPU_BASE) % NPU_STRIDE };
}

/** The CPU reads or writes one of the chipset's registers (the boot phase, the key's id...): over DMI. */
export const chipsetChain = (write: boolean): Hop[] => [{ bus: 'dmi', dir: write ? 1 : -1 }];
/** The TPM stands on a pin header off the I/O controller's trunk, which is on the chipset's LPC lanes: DMI, LPC, the header trunk. */
export const tpmChain = (write: boolean): Hop[] => write
  ? [{ bus: 'dmi', dir: 1 }, { bus: 'lpc', dir: -1 }, { bus: 'hdr', dir: 1 }]
  : [{ bus: 'hdr', dir: -1 }, { bus: 'lpc', dir: 1 }, { bus: 'dmi', dir: -1 }];

/** The slot number of a drive or card slot id, or -1. */
export const slotIndex = (slot: string): number => { const m = /(\d+)$/.exec(slot); return m ? Number(m[1]) : -1; };
