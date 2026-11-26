// Device spec types: the record shapes of the part catalog (`catalog.ts`), its thermal presets and the PCIe power rule.
// BALANCE IS A PLACEHOLDER: every number here is a round, plausible guess to be tuned by playing.

import type { EngineConfig } from '../../cpu/sim/engines';
import type { GpuConfig } from '../../gpu/sim/engine/engine';

/** Typed slots / ports on a board. A device only fits a free slot of its own type. */
export type SlotType =
  | 'cpu'
  | 'dimm'
  | 'pcie'
  | 'sata'
  | 'm2'
  | 'usb'
  | 'cooler'
  | 'display'
  | 'atx'
  | 'atx-plus'
  | 'vrm-sink'
  | 'ram-sink'
  | 'tpm'
  | 'radiator'
  | 'fan';

export type DeviceKind =
  | 'cpu'
  | 'ram'
  | 'psu'
  | 'cooler'
  | 'display'
  | 'storage'
  | 'vrm-sink'
  | 'ram-sink'
  | 'nic'
  | 'gpu'
  | 'npu'
  | 'tpm'
  | 'radiator'
  | 'fan';

/** The standard fan sizes, mm: a fan fits only a spot of its own size (a case mount, a heatsink's fan spot). */
export type FanSize = 40 | 92 | 120 | 140;

/** What a PCIe slot can give a card on its own (W). A card that draws more takes PCIe power leads, `cardLeads` (docs/ACCEL.md). */
export const PCIE_SLOT_W = 75;
/** What one PCIe power lead (a 6-pin) of the PSU gives a card (W). */
const PCIE_LEAD_W = 75;
/** The lowest board tier with a PCIe power connector (the Starter board has none; the render layout matches it, `pciewY`). */
export const PCIE_POWER_MIN_TIER = 1;
/** PCIe power leads a card takes: what its load needs beyond the slot's share (0 = slot power only). */
export const cardLeads = (s: { loadW: number }): number =>
  s.loadW > PCIE_SLOT_W ? Math.ceil((s.loadW - PCIE_SLOT_W) / PCIE_LEAD_W) : 0;

/** Clock range in ticks per base tick (1 = one device tick per second at 1x). */
interface ClockRange {
  min: number;
  base: number;
  max: number;
}

/** First-order thermal parameters. Temperatures in degrees C. */
export interface ThermalSpec {
  /** Passive heat loss to the case, W per degree C above ambient. */
  passive: number;
  /** A card's own fans (graphics, neural): extra W per degree C at full fan speed. The speed follows the card's heat (`cardFan`, thermal.ts). */
  fanPerC?: number | undefined;
  /** Thermal mass: joules per degree C (one base tick = 1 s). */
  mass: number;
  /** Above this the clock is throttled. */
  throttleC: number;
  /** Above this the device makes errors. */
  unstableC: number;
  /** Above this for `DAMAGE_TICKS` accumulated ticks the device burns out. */
  damageC: number;
}

interface SpecBase {
  /** Unique key, also what a save stores. */
  id: string;
  kind: DeviceKind;
  tier: number;
  name: string;
  /** Slot (or, for a PSU, connector) type it needs. */
  slot: SlotType;
  /** `pcie` cards only: the narrowest slot (lanes) it fits. Absent = any (x1). */
  pcieWidth?: number;
  price: number;
  /** Power draw in W at the base clock with no load / full load. Scales with clock, see thermal.ts. */
  idleW: number;
  loadW: number;
  /** Fraction of drawn power that becomes heat. */
  heatFactor: number;
  /** Absent for unclocked parts (PSU, cooler). */
  clock?: ClockRange;
  thermal: ThermalSpec;
  /** Opaque key for the renderer. */
  visual: string;
}

export interface CpuSpec extends SpecBase {
  kind: 'cpu';
  clock: ClockRange;
  /** Engine selection: tier maps to engine kind and options. */
  engine: EngineConfig;
  /** The part this one builds on in the CPU tree (docs/TECHTREE.md); absent for the trunk and the generalists after it. */
  after?: string;
  /** The way a specialist leans: `frontend` (instruction cache, better predictor: branchy code), `memory` (bigger and associative data cache, L2: big data), `wide` (everything big), `multicore` (several cores on one die: more programs at once). */
  branch?: 'frontend' | 'memory' | 'wide' | 'multicore';
  /** The memory controller (docs/RAM.md): how many sticks it drives in parallel (channels) and what it does with a row after an access. Default 1 channel, open page. */
  memory?: { channels: number; policy: 'open' | 'closed' | 'adaptive' };
  /** Hardware cores, all running `engine` and sharing the L2 and memory controller (docs/MULTICORE.md). Absent: one. */
  cores?: number;
  /** Logical cores (threads) per hardware core, switching on a data cache miss (docs/MULTICORE.md section 5). Absent: one. */
  threads?: number;
  /** The memory management unit (docs/VM.md): the TLB entries it has. Absent: no MMU, programs only ever see physical memory and the paged OS will not run. */
  mmu?: { tlb: number };
}

export interface RamSpec extends SpecBase {
  kind: 'ram';
  clock: ClockRange;
  sizeBytes: number;
  /** Access cost in RAM clock ticks (to a bank whose row is closed); becomes the CPU's cache miss penalty (see apply.ts). */
  latency: number;
  /** The DRAM chips (docs/RAM.md): banks in groups, each with its own row buffer; bytes per row; the row timings in RAM ticks (column access, activate, precharge) and the ticks a line takes on the bus. */
  banks: number;
  bankGroups: number;
  rowBytes: number;
  tCL: number;
  tRCD: number;
  tRP: number;
  burst: number;
  /** Error-correcting memory: a flipped bit is found and fixed instead of corrupting a program. A TPM needs it. */
  ecc?: boolean;
  /** The memory generation, for the name and the look: SDR, DDR2, DDR3, DDR4, DDR5 (docs/RAM.md "The ladder"). */
  gen: string;
  /** Independent channels one stick brings to the controller (DDR5: two 32-bit sub-channels on one stick); default 1. */
  subChannels?: number;
}

export interface PsuSpec extends SpecBase {
  kind: 'psu';
  /** Wattage budget. */
  watts: number;
  /** PCIe power leads the PSU has (the `pcie` cable of docs/ACCEL.md): 0 for the small ones. */
  pcieLeads: number;
  /** Whether the PSU has a fan: the two cheapest are passive (fan-less) units. */
  fan: boolean;
}

/**
 * The fan spots of a heatsink (docs/ASSEMBLY.md "Fans"): `n` spots for fans of `size`, slots `<its slot>.fan<k>` while it is fitted. It cools
 * by its rating times `fanShare`: `bare` of it with no fan turning, all of it with one basic fan, a little more with more air.
 */
export interface FanSpots {
  n: number;
  size: FanSize;
  bare: number;
}

export interface CoolerSpec extends SpecBase {
  kind: 'cooler';
  /** Extra heat removal from the CPU, W per degree C above ambient (with one basic fan turning on an air heatsink). */
  coolingPerC: number;
  /** Airflow the cooler gives the VRM, W per degree C above ambient (an air cooler's fan blows over it, liquid does not). */
  vrmAirPerC: number;
  /** A liquid loop (an AIO): `coolingPerC` is its best, with a radiator; the pump alone gives `pumpPerC`, and the radiator adds its own (`RadiatorSpec`). */
  loop?: { pumpPerC: number };
  /** An air heatsink's fan spots (the fans are parts of their own). */
  fanSpots?: FanSpots;
}

/** A radiator for a liquid loop: it bolts along the front or the top of the case (slot `rad-front` / `rad-top`), spanning every fan mount of that side; the fans on those mounts push air through it, each on its mount's cable. */
export interface RadiatorSpec extends SpecBase {
  kind: 'radiator';
  /** W per degree C it adds to the loop (every mount of its side with a basic fan turning). */
  coolingPerC: number;
}

/** A heatsink bolted onto one of the board's VRMs: slot `vrm-sink` is the CPU's, slot `ram-sink` the memory's (see docs/VRM.md). The fan fins take a fan on their spot. */
export interface VrmSinkSpec extends SpecBase {
  kind: 'vrm-sink' | 'ram-sink';
  /** Heat removal from the VRM, W per degree C above ambient (with its fan turning, if it has a spot). */
  coolingPerC: number;
  /** The fan fins' spot: the fan's cable plugs into the board's VRM_FAN / RAM_FAN header. */
  fanSpots?: FanSpots;
}

/** A fan (docs/ASSEMBLY.md "Fans"): it fits a spot of its `size` only. `airflow` 1 is a basic fan's; it draws idleW..loadW while it turns. */
export interface FanSpec extends SpecBase {
  kind: 'fan';
  size: FanSize;
  airflow: number;
}

export interface DisplaySpec extends SpecBase {
  kind: 'display';
  clock: ClockRange;
  /** Display ticks per landed write. */
  writeLatency: number;
  /** A graphics display: its video cable can go to a GPU's display port, and the card's frame shows on it (docs/ACCEL.md "Display"). */
  graphics?: boolean;
}

/**
 * A block device on the bus (see src/sim/machine/storage.ts). Timing is in the device's own clock ticks: a command
 * takes `latencyTicks` (skipped for the block right after the previous one) plus `blockTicks` for the 256-byte block.
 * SATA drives draw from the PSU budget (watts only, no separate connector); NVMe needs the M.2 slot.
 */
export interface StorageSpec extends SpecBase {
  kind: 'storage';
  clock: ClockRange;
  capacityBytes: number;
  latencyTicks: number;
  blockTicks: number;
  /** Writes one 8-block group takes before it turns bad (docs/OS.md, wear). Placeholder numbers. */
  enduranceBlocks: number;
  /** Requests the drive queue holds before reads miss their time. */
  queueDepth: number;
  /** A seek costs time by LBA distance (a spinning disk). */
  seekByDistance?: boolean;
  /** Chance per write of a mechanical bad sector (a spinning disk). */
  mechBadRate?: number;
  /** A module with two member drives that every write goes to (RAID 1): needs a filesystem tier 4 OS, survives the loss of one member's blocks. */
  mirror?: boolean;
}

/** A PCIe network card (docs/NETWORK.md). Its jack replaces the onboard one for the cable plugged into it; load watts follow the traffic. */
export interface NicSpec extends SpecBase {
  kind: 'nic';
  /** Link speed in Mbit/s (halved above the throttle temperature). */
  mbps: number;
}

/** An accelerator card in a PCIe slot (docs/ACCEL.md): a GPU or an NPU. Its own regulator is folded into `heatFactor`; it draws from the PSU. */
export interface CardSpec extends SpecBase {
  kind: 'gpu' | 'npu';
  /** GPU only: its microarchitecture (docs/GPU.md); every kind exposes lanes, memBytes and banks. */
  gpu?: GpuConfig;
  /** NPU only: the systolic grid (grid x grid multiply-accumulate cells) and its card memory. */
  npu?: { grid: number; memBytes: number };
}

/** A TPM daughterboard on the board's header (slot `tpm`), no cable (docs/ACCEL.md). */
export interface TpmSpec extends SpecBase {
  kind: 'tpm';
  /** Bus costs in the module's own ticks: per word measured, per attestation, and the extra RAM ticks a protected-mode access pays. */
  tpm?: { measureTicks: number; attestTicks: number; surcharge: number };
}

export type DeviceSpec =
  | CpuSpec
  | RamSpec
  | PsuSpec
  | CoolerSpec
  | DisplaySpec
  | StorageSpec
  | VrmSinkSpec
  | NicSpec
  | CardSpec
  | TpmSpec
  | RadiatorSpec
  | FanSpec;
