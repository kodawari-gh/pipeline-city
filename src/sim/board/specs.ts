// Declarative device specs: plain data records, read by the sim and (via `visual`) the renderer.
// BALANCE IS A PLACEHOLDER: every number here is a round, plausible guess to be tuned by playing.

import type { EngineConfig } from "../engines";

/** Typed slots / ports on a board. A device only fits a free slot of its own type. */
export type SlotType = "cpu" | "dimm" | "pcie" | "sata" | "usb" | "cooler" | "display" | "atx" | "atx-plus";

export type DeviceKind = "cpu" | "ram" | "psu" | "cooler" | "display";

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
}

export interface DisplaySpec extends SpecBase {
  kind: "display";
  clock: ClockRange;
  /** Display ticks per landed write. */
  writeLatency: number;
}

export type DeviceSpec = CpuSpec | RamSpec | PsuSpec | CoolerSpec | DisplaySpec;

export const AMBIENT_C = 25;
/** Ticks above damageC (accumulated, cooling slowly forgives) before a device is burnt. */
export const DAMAGE_TICKS = 10;

const cpuThermal: ThermalSpec = { passive: 0.15, mass: 20, throttleC: 70, unstableC: 85, damageC: 95 };
const ramThermal: ThermalSpec = { passive: 0.3, mass: 20, throttleC: 75, unstableC: 90, damageC: 100 };
const dispThermal: ThermalSpec = { passive: 0.3, mass: 30, throttleC: 80, unstableC: 95, damageC: 110 };
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
    thermal: inertThermal, visual: "cooler-stock", coolingPerC: 0.35 },
  { id: "cooler1", kind: "cooler", tier: 1, name: "Tower fan", slot: "cooler", price: 50, idleW: 0.5, loadW: 3, heatFactor: 0,
    thermal: inertThermal, visual: "cooler-tower", coolingPerC: 0.8 },
  { id: "cooler2", kind: "cooler", tier: 2, name: "Liquid loop", slot: "cooler", price: 300, idleW: 1, loadW: 6, heatFactor: 0,
    thermal: inertThermal, visual: "cooler-liquid", coolingPerC: 1.8 },

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

/** Board tiers: slot counts by type. */
export interface BoardTierSpec {
  tier: number;
  name: string;
  price: number;
  slots: Partial<Record<SlotType, number>>;
  visual: string;
}

export const BOARD_TIERS: readonly BoardTierSpec[] = [
  { tier: 0, name: "Mini board", price: 0, visual: "board-mini",
    slots: { cpu: 1, dimm: 2, sata: 1, usb: 1, atx: 1, cooler: 1, display: 1 } },
  { tier: 1, name: "ATX+ board", price: 300, visual: "board-atxplus",
    slots: { cpu: 1, dimm: 4, pcie: 2, sata: 2, usb: 2, "atx-plus": 1, cooler: 1, display: 1 } },
];
