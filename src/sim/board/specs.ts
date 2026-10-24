// Declarative device specs: plain data records, read by the sim and (via `visual`) the renderer.
// BALANCE IS A PLACEHOLDER: every number here is a round, plausible guess to be tuned by playing.

import type { EngineConfig } from "../engines";

/** Typed slots / ports on a board. A device only fits a free slot of its own type. */
export type SlotType = "cpu" | "dimm" | "pcie" | "sata" | "m2" | "usb" | "cooler" | "display" | "atx" | "atx-plus" | "vrm-sink";

export type DeviceKind = "cpu" | "ram" | "psu" | "cooler" | "display" | "storage" | "vrm-sink" | "nic";

/** Clock range in ticks per base tick (1 = one device tick per second at 1x). */
export interface ClockRange { min: number; base: number; max: number }

/** First-order thermal parameters. Temperatures in degrees C. */
export interface ThermalSpec {
  /** Passive heat loss to the case, W per degree C above ambient. */
  passive: number;
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
  kind: "cpu";
  clock: ClockRange;
  /** Engine selection: tier maps to engine kind and options. */
  engine: EngineConfig;
}

export interface RamSpec extends SpecBase {
  kind: "ram";
  clock: ClockRange;
  sizeBytes: number;
  /** Access cost in RAM clock ticks; becomes the CPU's cache miss penalty (see apply.ts). */
  latency: number;
}

export interface PsuSpec extends SpecBase {
  kind: "psu";
  /** Wattage budget. */
  watts: number;
}

export interface CoolerSpec extends SpecBase {
  kind: "cooler";
  /** Extra heat removal from the CPU, W per degree C above ambient. */
  coolingPerC: number;
  /** Airflow the cooler gives the VRM, W per degree C above ambient (an air cooler blows over it, liquid does not). */
  vrmAirPerC: number;
}

/** A heatsink bolted onto the board's VRM (see docs/VRM.md). A fan version draws idleW..loadW. */
export interface VrmSinkSpec extends SpecBase {
  kind: "vrm-sink";
  /** Heat removal from the VRM, W per degree C above ambient. */
  coolingPerC: number;
}

export interface DisplaySpec extends SpecBase {
  kind: "display";
  clock: ClockRange;
  /** Display ticks per landed write. */
  writeLatency: number;
}

/**
 * A block device on the bus (see src/sim/machine/storage.ts). Timing is in the device's own clock ticks: a command
 * takes `latencyTicks` (skipped for the block right after the previous one) plus `blockTicks` for the 256-byte block.
 * SATA drives draw from the PSU budget (watts only, no separate connector); NVMe needs the M.2 slot.
 */
export interface StorageSpec extends SpecBase {
  kind: "storage";
  clock: ClockRange;
  capacityBytes: number;
  latencyTicks: number;
  blockTicks: number;
}

/** A PCIe network card (docs/NETWORK.md). Its jack replaces the onboard one for the cable plugged into it; load watts follow the traffic. */
export interface NicSpec extends SpecBase {
  kind: "nic";
  /** Link speed in Mbit/s (halved above the throttle temperature). */
  mbps: number;
}

export type DeviceSpec = CpuSpec | RamSpec | PsuSpec | CoolerSpec | DisplaySpec | StorageSpec | VrmSinkSpec | NicSpec;

export const AMBIENT_C = 25;
/** Ticks above damageC (accumulated, cooling slowly forgives) before a device is burnt. */
export const DAMAGE_TICKS = 10;

const cpuThermal: ThermalSpec = { passive: 0.15, mass: 20, throttleC: 70, unstableC: 85, damageC: 95 };
const ramThermal: ThermalSpec = { passive: 0.3, mass: 20, throttleC: 75, unstableC: 90, damageC: 100 };
const dispThermal: ThermalSpec = { passive: 0.3, mass: 30, throttleC: 80, unstableC: 95, damageC: 110 };
const storageThermal: ThermalSpec = { passive: 0.4, mass: 25, throttleC: 55, unstableC: 70, damageC: 85 };
const inertThermal: ThermalSpec = { passive: 1, mass: 50, throttleC: 999, unstableC: 999, damageC: 999 };

const specList: DeviceSpec[] = [
  { id: "cpu0", kind: "cpu", tier: 0, name: "Tiny-1 (unpipelined)", slot: "cpu", price: 0, idleW: 2, loadW: 10, heatFactor: 1,
    clock: { min: 0.25, base: 1, max: 1.5 }, thermal: cpuThermal, visual: "cpu-unpipelined",
    engine: { kind: "unpipelined" } },
  { id: "cpu1", kind: "cpu", tier: 1, name: "Tiny-5 (5-stage, no forwarding)", slot: "cpu", price: 200, idleW: 3, loadW: 20, heatFactor: 1,
    clock: { min: 0.5, base: 2, max: 3 }, thermal: cpuThermal, visual: "cpu-inorder",
    engine: { kind: "inorder", forwarding: false } },
  { id: "cpu2", kind: "cpu", tier: 2, name: "Tiny-5F (5-stage, forwarding)", slot: "cpu", price: 800, idleW: 4, loadW: 35, heatFactor: 1,
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder", forwarding: true, cacheLines: 16 } },
  // Placeholder price, power and art: the owner sets the price (docs/PROGRESSION.md), T32 the board/VRM demand, T33 the art.
  { id: "cpu3", kind: "cpu", tier: 3, name: "Tiny-5F2 (2-wide in-order)", slot: "cpu", price: 2400, idleW: 5, loadW: 50, heatFactor: 1,
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder2", forwarding: true, cacheLines: 16 } },

  { id: "ram0", kind: "ram", tier: 0, name: "DRAM 16K", slot: "dimm", price: 0, idleW: 1, loadW: 2, heatFactor: 1,
    clock: { min: 0.5, base: 1, max: 1.5 }, thermal: ramThermal, visual: "dimm-basic",
    sizeBytes: 16 * 1024, latency: 200 },
  { id: "ram1", kind: "ram", tier: 1, name: "DRAM 32K fast", slot: "dimm", price: 100, idleW: 1, loadW: 3, heatFactor: 1,
    clock: { min: 1, base: 2, max: 3 }, thermal: ramThermal, visual: "dimm-fast",
    sizeBytes: 32 * 1024, latency: 12 },
  { id: "ram2", kind: "ram", tier: 2, name: "DRAM 64K low-latency", slot: "dimm", price: 400, idleW: 2, loadW: 5, heatFactor: 1,
    clock: { min: 2, base: 3, max: 5 }, thermal: ramThermal, visual: "dimm-lowlat",
    sizeBytes: 64 * 1024, latency: 4 },

  { id: "psu0", kind: "psu", tier: 0, name: "PSU 40 W", slot: "atx", price: 0, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "psu-basic", watts: 40 },
  { id: "psu1", kind: "psu", tier: 1, name: "PSU 100 W", slot: "atx", price: 60, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "psu-mid", watts: 100 },
  { id: "psu2", kind: "psu", tier: 2, name: "PSU 250 W (ATX+)", slot: "atx-plus", price: 250, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "psu-big", watts: 250 },

  { id: "cooler0", kind: "cooler", tier: 0, name: "Stock heatsink", slot: "cooler", price: 0, idleW: 0, loadW: 1, heatFactor: 0,
    thermal: inertThermal, visual: "cooler-stock", coolingPerC: 0.35, vrmAirPerC: 0.05 },
  { id: "cooler1", kind: "cooler", tier: 1, name: "Tower fan", slot: "cooler", price: 50, idleW: 0.5, loadW: 3, heatFactor: 0,
    thermal: inertThermal, visual: "cooler-tower", coolingPerC: 0.8, vrmAirPerC: 0.25 },
  { id: "cooler2", kind: "cooler", tier: 2, name: "Liquid loop", slot: "cooler", price: 300, idleW: 1, loadW: 6, heatFactor: 0,
    thermal: inertThermal, visual: "cooler-liquid", coolingPerC: 1.8, vrmAirPerC: 0 },

  { id: "vsink0", kind: "vrm-sink", tier: 0, name: "VRM fins", slot: "vrm-sink", price: 30, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "vrm-sink-fins", coolingPerC: 0.25 },
  { id: "vsink1", kind: "vrm-sink", tier: 1, name: "VRM big fins", slot: "vrm-sink", price: 70, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "vrm-sink-big", coolingPerC: 0.5 },
  { id: "vsink2", kind: "vrm-sink", tier: 2, name: "VRM fins + fan", slot: "vrm-sink", price: 140, idleW: 0.3, loadW: 1.5, heatFactor: 0,
    thermal: inertThermal, visual: "vrm-sink-fan", coolingPerC: 1 },

  { id: "hdd0", kind: "storage", tier: 0, name: "HDD 96K", slot: "sata", price: 40, idleW: 1, loadW: 4, heatFactor: 1,
    clock: { min: 0.5, base: 1, max: 1.25 }, thermal: storageThermal, visual: "hdd",
    capacityBytes: 96 * 1024, latencyTicks: 720, blockTicks: 72 },
  { id: "ssd1", kind: "storage", tier: 1, name: "SATA SSD 64K", slot: "sata", price: 150, idleW: 0.5, loadW: 2.5, heatFactor: 1,
    clock: { min: 1, base: 2, max: 3 }, thermal: storageThermal, visual: "ssd-sata",
    capacityBytes: 64 * 1024, latencyTicks: 72, blockTicks: 36 },
  { id: "nvme2", kind: "storage", tier: 2, name: "NVMe SSD 128K", slot: "m2", price: 400, idleW: 1, loadW: 6, heatFactor: 1,
    clock: { min: 2, base: 4, max: 6 }, thermal: storageThermal, visual: "ssd-nvme",
    capacityBytes: 128 * 1024, latencyTicks: 14, blockTicks: 14 },

  { id: "nic1", kind: "nic", tier: 1, name: "GbE card", slot: "pcie", price: 120, idleW: 1.5, loadW: 3.5, heatFactor: 1,
    thermal: { passive: 0.3, mass: 20, throttleC: 75, unstableC: 90, damageC: 105 }, visual: "nic-gbe", mbps: 1000 },
  { id: "nic2", kind: "nic", tier: 2, name: "10GbE card", slot: "pcie", price: 500, idleW: 5, loadW: 11, heatFactor: 1,
    thermal: { passive: 0.3, mass: 20, throttleC: 65, unstableC: 80, damageC: 95 }, visual: "nic-10g", mbps: 10000 },
  { id: "nic3", kind: "nic", tier: 3, name: "40GbE card", slot: "pcie", price: 1800, idleW: 9, loadW: 22, heatFactor: 1,
    thermal: { passive: 0.3, mass: 20, throttleC: 60, unstableC: 75, damageC: 90 }, visual: "nic-40g", mbps: 40000 },

  { id: "display0", kind: "display", tier: 0, name: "CLI monitor", slot: "display", price: 0, idleW: 1, loadW: 3, heatFactor: 1,
    clock: { min: 0.5, base: 1, max: 2 }, thermal: dispThermal, visual: "monitor-cli", writeLatency: 1 },
];

export const DEVICE_SPECS: Readonly<Record<string, DeviceSpec>> = Object.fromEntries(specList.map((s) => [s.id, s]));

export function getSpec(id: string): DeviceSpec | undefined {
  return DEVICE_SPECS[id];
}

/** Specs of one kind ordered by tier (the per-device upgrade ladder). */
export function specsOfKind<K extends DeviceKind>(kind: K): Extract<DeviceSpec, { kind: K }>[] {
  return specList.filter((s) => s.kind === kind).sort((a, b) => a.tier - b.tier) as Extract<DeviceSpec, { kind: K }>[];
}

/** The board's voltage regulator (see docs/VRM.md): phases of buck converters feeding the CPU. */
export interface VrmSpec {
  phases: number;
  ampsPerPhase: number;
  /** Best efficiency (0..1), reached at moderate per-phase load. */
  peakEfficiency: number;
  /** Voltage ripple 0..1 (lower is better quality): raises the error chance when unstable. */
  ripple: number;
  /** Joules per degree C. */
  mass: number;
  /** Passive heat loss to the case, W per degree C above ambient. */
  passive: number;
  throttleC: number;
  unstableC: number;
  damageC: number;
}

/** Board features beyond slots. `ethernetMbps` is the onboard port ("board" uplink of the network). */
export interface BoardFeatures {
  /** Onboard ethernet speed in Mbit/s, 0 = none. */
  ethernetMbps: number;
  usbPorts: number;
  displayPorts: number;
}

/** Board tiers: slot counts by type (a slot a tier lacks is absent), features and the VRM. */
export interface BoardTierSpec {
  tier: number;
  name: string;
  /** Price to buy it (also the price of a replacement of the same tier when the board is burnt). */
  price: number;
  slots: Partial<Record<SlotType, number>>;
  features: BoardFeatures;
  vrm: VrmSpec;
  visual: string;
}

const vrmTemps = { throttleC: 90, unstableC: 105, damageC: 120 };

export const BOARD_TIERS: readonly BoardTierSpec[] = [
  { tier: 0, name: "Starter", price: 40, visual: "board-starter",
    slots: { cpu: 1, dimm: 1, sata: 1, usb: 1, atx: 1, cooler: 1, display: 1, "vrm-sink": 1 },
    features: { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 },
    vrm: { phases: 2, ampsPerPhase: 12, peakEfficiency: 0.8, ripple: 0.6, mass: 20, passive: 0.15, ...vrmTemps } },
  { tier: 1, name: "Basic", price: 150, visual: "board-basic",
    slots: { cpu: 1, dimm: 2, pcie: 1, sata: 2, usb: 2, atx: 1, cooler: 1, display: 1, "vrm-sink": 1 },
    features: { ethernetMbps: 100, usbPorts: 2, displayPorts: 1 },
    vrm: { phases: 3, ampsPerPhase: 12, peakEfficiency: 0.84, ripple: 0.45, mass: 30, passive: 0.2, ...vrmTemps } },
  { tier: 2, name: "Mainstream", price: 300, visual: "board-mainstream",
    slots: { cpu: 1, dimm: 4, pcie: 2, sata: 2, m2: 1, usb: 3, "atx-plus": 1, cooler: 1, display: 1, "vrm-sink": 1 },
    features: { ethernetMbps: 100, usbPorts: 3, displayPorts: 2 },
    vrm: { phases: 4, ampsPerPhase: 15, peakEfficiency: 0.88, ripple: 0.25, mass: 45, passive: 0.3, ...vrmTemps } },
  { tier: 3, name: "Enthusiast", price: 700, visual: "board-enthusiast",
    slots: { cpu: 1, dimm: 8, pcie: 4, sata: 2, m2: 1, usb: 4, "atx-plus": 1, cooler: 1, display: 1, "vrm-sink": 1 },
    features: { ethernetMbps: 1000, usbPorts: 4, displayPorts: 2 },
    vrm: { phases: 6, ampsPerPhase: 20, peakEfficiency: 0.92, ripple: 0.1, mass: 60, passive: 0.4, ...vrmTemps } },
];
