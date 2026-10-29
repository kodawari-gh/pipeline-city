// Declarative device specs: plain data records, read by the sim and (via `visual`) the renderer.
// BALANCE IS A PLACEHOLDER: every number here is a round, plausible guess to be tuned by playing.

import type { EngineConfig } from "../engines";

/** Typed slots / ports on a board. A device only fits a free slot of its own type. */
export type SlotType = "cpu" | "dimm" | "pcie" | "sata" | "m2" | "usb" | "cooler" | "display" | "atx" | "atx-plus" | "vrm-sink" | "ram-sink" | "tpm";

export type DeviceKind = "cpu" | "ram" | "psu" | "cooler" | "display" | "storage" | "vrm-sink" | "ram-sink" | "nic" | "gpu" | "npu" | "tpm";

/** What a PCIe slot can give a card on its own (W). A card that draws more must have `needsPcieCable` (docs/ACCEL.md). */
export const PCIE_SLOT_W = 75;

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
  /** The part this one builds on in the CPU tree (docs/TECHTREE.md); absent for the trunk and the generalists after it. */
  after?: string;
  /** The way a specialist leans: `frontend` (instruction cache, better predictor: branchy code), `memory` (bigger and associative data cache, L2: big data), `wide` (everything big), `multicore` (several cores on one die: more programs at once). */
  branch?: "frontend" | "memory" | "wide" | "multicore";
  /** The memory controller (docs/RAM.md): how many sticks it drives in parallel (channels) and what it does with a row after an access. Default 1 channel, open page. */
  memory?: { channels: number; policy: "open" | "closed" | "adaptive" };
  /** Hardware cores, all running `engine` and sharing the L2 and memory controller (docs/MULTICORE.md). Absent: one. */
  cores?: number;
  /** Logical cores (threads) per hardware core, switching on a data cache miss (docs/MULTICORE.md section 5). Absent: one. */
  threads?: number;
  /** The memory management unit (docs/VM.md): the TLB entries it has. Absent: no MMU, programs only ever see physical memory and the paged OS will not run. */
  mmu?: { tlb: number };
}

export interface RamSpec extends SpecBase {
  kind: "ram";
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
  kind: "psu";
  /** Wattage budget. */
  watts: number;
  /** PCIe power leads the PSU has (the `pcie` cable of docs/ACCEL.md): 0 for the small ones. */
  pcieLeads: number;
}

export interface CoolerSpec extends SpecBase {
  kind: "cooler";
  /** Extra heat removal from the CPU, W per degree C above ambient. */
  coolingPerC: number;
  /** Airflow the cooler gives the VRM, W per degree C above ambient (an air cooler blows over it, liquid does not). */
  vrmAirPerC: number;
}

/** A heatsink bolted onto one of the board's VRMs: slot `vrm-sink` is the CPU's, slot `ram-sink` the memory's (see docs/VRM.md). A fan version draws idleW..loadW. */
export interface VrmSinkSpec extends SpecBase {
  kind: "vrm-sink" | "ram-sink";
  /** Heat removal from the VRM, W per degree C above ambient. */
  coolingPerC: number;
}

export interface DisplaySpec extends SpecBase {
  kind: "display";
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

/** An accelerator card in a PCIe slot (docs/ACCEL.md): a GPU or an NPU. Its own regulator is folded into `heatFactor`; it draws from the PSU. */
export interface CardSpec extends SpecBase {
  kind: "gpu" | "npu";
  /** It needs the PSU's PCIe power lead plugged in (the `pcie` cable). Required above `PCIE_SLOT_W`. */
  needsPcieCable: boolean;
  /** Leads it takes: 1 normally, 2 on the biggest card. */
  pcieLeads?: number;
  /** GPU only: the SIMD unit and its card memory. */
  gpu?: { lanes: number; memBytes: number; banks: number };
  /** NPU only: the systolic grid (grid x grid multiply-accumulate cells) and its card memory. */
  npu?: { grid: number; memBytes: number };
}

/** A TPM daughterboard on the board's header (slot `tpm`), no cable (docs/ACCEL.md). */
export interface TpmSpec extends SpecBase {
  kind: "tpm";
  /** Bus costs in the module's own ticks: per word measured, per attestation, and the extra RAM ticks a protected-mode access pays. */
  tpm?: { measureTicks: number; attestTicks: number; surcharge: number };
}

export type DeviceSpec = CpuSpec | RamSpec | PsuSpec | CoolerSpec | DisplaySpec | StorageSpec | VrmSinkSpec | NicSpec | CardSpec | TpmSpec;

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
  { id: "cpu2", kind: "cpu", tier: 2, name: "Tiny-5F (5-stage, forwarding)", slot: "cpu", mmu: { tlb: 4 }, price: 800, idleW: 4, loadW: 35, heatFactor: 1,
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder", forwarding: true, cacheLines: 16, redirectPenalty: 2 } },
  // Placeholder price, power and art: the owner sets the price (docs/PROGRESSION.md), T32 the board/VRM demand, T33 the art.
  { id: "cpu3", kind: "cpu", tier: 3, name: "Tiny-5F2 (2-wide in-order)", slot: "cpu", memory: { channels: 2, policy: "adaptive" }, mmu: { tlb: 8 }, price: 2400, idleW: 5, loadW: 50, heatFactor: 1,
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder2", forwarding: true, cacheLines: 16, redirectPenalty: 2 } },
  // The consumer dual core (owner 2026-10-29, docs/MULTICORE.md): two `cpu2` cores on one shared 32-line L2. Placeholder price, power and art. 70 W is the whole chip with both cores busy.
  { id: "cpu2d", kind: "cpu", tier: 3, name: "Tiny-5F x2 (dual core)", slot: "cpu", memory: { channels: 2, policy: "open" }, mmu: { tlb: 4 }, cores: 2, price: 2000, idleW: 5, loadW: 70, heatFactor: 1, after: "cpu2", branch: "multicore",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder", forwarding: true, cacheLines: 16, l2Lines: 32, redirectPenalty: 2 } },
  // The Duo with two threads on each core (docs/MULTICORE.md section 5): a thread that misses the data cache hands its core to the other one. Four logical cores. Placeholder price, power and art.
  { id: "cpu3t", kind: "cpu", tier: 4, name: "Tiny-5F x2 SMT (dual core, 2 threads)", slot: "cpu", memory: { channels: 2, policy: "open" }, mmu: { tlb: 4 }, cores: 2, threads: 2, price: 5000, idleW: 6, loadW: 80, heatFactor: 1, after: "cpu2d", branch: "multicore",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder", forwarding: true, cacheLines: 16, l2Lines: 64, redirectPenalty: 2 } },
  // The level 14 pair (docs/MULTICORE.md sections 5 and 8). The server: four cores with two switch-on-miss threads each, eight logical cores for the 8-thread `hpc` kinds. Placeholder price, power and art.
  { id: "cpu5s", kind: "cpu", tier: 5, name: "Tiny-5F x4 SMT (server, 4 cores, 8 threads)", slot: "cpu", memory: { channels: 4, policy: "open" }, mmu: { tlb: 8 }, cores: 4, threads: 2, price: 9000, idleW: 8, loadW: 95, heatFactor: 1, after: "cpu3t", branch: "multicore",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder", forwarding: true, cacheLines: 16, l2Lines: 64, redirectPenalty: 2 } },
  // The HPC part: two out-of-order cores with full SMT (both threads in the pipeline at once, a ROB of 16 split between them). Four logical cores.
  { id: "cpu5h", kind: "cpu", tier: 5, name: "Tiny-OoO x2 SMT (HPC, 2 cores, 4 threads)", slot: "cpu", memory: { channels: 4, policy: "adaptive" }, mmu: { tlb: 16 }, cores: 2, threads: 2, price: 11000, idleW: 9, loadW: 115, heatFactor: 1, after: "cpu4", branch: "multicore",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "ooo", robSize: 16, schedSize: 8, fetchQueue: 8, commitWidth: 4, cacheLines: 16, l2Lines: 64, redirectPenalty: 2 } },
  // The only ooo CPU (owner 2026-10-24): ROB 8, 4-wide commit. ROB 16 and 32 are deferred. Placeholder price, power and art as cpu3.
  { id: "cpu4", kind: "cpu", tier: 4, name: "Tiny-OoO (out-of-order, ROB 8)", slot: "cpu", memory: { channels: 2, policy: "adaptive" }, mmu: { tlb: 16 }, price: 6000, idleW: 6, loadW: 80, heatFactor: 1,
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "ooo", robSize: 8, commitWidth: 4, cacheLines: 16, redirectPenalty: 2 } },
  // The branches (owner 2026-10-27, docs/TECHTREE.md): at each step a specialist leans one way. Placeholder numbers like the rest.
  // Tier is the depth in the tree, so siblings share a tier: cpu3, cpu2f and cpu2m are all tier 3.
  { id: "cpu2f", kind: "cpu", tier: 3, name: "Tiny-5F+I (front end: I-cache, 2-bit predictor)", slot: "cpu", mmu: { tlb: 8 }, price: 1500, idleW: 4, loadW: 40, heatFactor: 1, after: "cpu2", branch: "frontend",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder", forwarding: true, cacheLines: 16, icacheLines: 8, predEntries: 128, predBits: 2, redirectPenalty: 2 } },
  { id: "cpu2m", kind: "cpu", tier: 3, name: "Tiny-5F+D (memory: 2-way D-cache, L2)", slot: "cpu", memory: { channels: 2, policy: "open" }, mmu: { tlb: 8 }, price: 1500, idleW: 4, loadW: 42, heatFactor: 1, after: "cpu2", branch: "memory",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder", forwarding: true, cacheLines: 32, ways: 2, l2Lines: 32, redirectPenalty: 2 } },
  { id: "cpu3f", kind: "cpu", tier: 4, name: "Tiny-5F2+I (2-wide, front end)", slot: "cpu", memory: { channels: 2, policy: "adaptive" }, mmu: { tlb: 8 }, price: 3600, idleW: 5, loadW: 58, heatFactor: 1, after: "cpu2f", branch: "frontend",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder2", forwarding: true, cacheLines: 16, icacheLines: 16, predEntries: 256, predBits: 2, redirectPenalty: 2 } },
  { id: "cpu3m", kind: "cpu", tier: 4, name: "Tiny-5F2+D (2-wide, memory)", slot: "cpu", memory: { channels: 2, policy: "adaptive" }, mmu: { tlb: 16 }, price: 3600, idleW: 5, loadW: 60, heatFactor: 1, after: "cpu2m", branch: "memory",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "inorder2", forwarding: true, cacheLines: 64, ways: 4, l2Lines: 64, redirectPenalty: 2 } },
  { id: "cpu4f", kind: "cpu", tier: 5, name: "Tiny-OoO+I (out of order, ROB 16, front end)", slot: "cpu", memory: { channels: 2, policy: "adaptive" }, mmu: { tlb: 16 }, price: 8500, idleW: 6, loadW: 88, heatFactor: 1, after: "cpu3f", branch: "frontend",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "ooo", robSize: 16, schedSize: 8, fetchQueue: 8, commitWidth: 4, cacheLines: 16, icacheLines: 32, predEntries: 512, predBits: 2, redirectPenalty: 2 } },
  { id: "cpu4m", kind: "cpu", tier: 5, name: "Tiny-OoO+D (out of order, ROB 16, memory)", slot: "cpu", memory: { channels: 4, policy: "adaptive" }, mmu: { tlb: 32 }, price: 8500, idleW: 6, loadW: 90, heatFactor: 1, after: "cpu3m", branch: "memory",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "ooo", robSize: 16, schedSize: 8, fetchQueue: 8, commitWidth: 4, cacheLines: 64, ways: 4, l2Lines: 128, redirectPenalty: 2 } },
  { id: "cpu4w", kind: "cpu", tier: 6, name: "Tiny-OoO-W (4-wide out of order, ROB 32)", slot: "cpu", memory: { channels: 4, policy: "adaptive" }, mmu: { tlb: 32 }, price: 12000, idleW: 8, loadW: 100, heatFactor: 1, after: "cpu4", branch: "wide",
    clock: { min: 1, base: 3, max: 5 }, thermal: cpuThermal, visual: "cpu-inorder-fwd",
    engine: { kind: "ooo", width: 4, robSize: 32, schedSize: 16, fetchQueue: 8, commitWidth: 8, cacheLines: 64, ways: 4, icacheLines: 32, l2Lines: 128, predEntries: 512, predBits: 2, redirectPenalty: 2 } },

  { id: "ram0", kind: "ram", tier: 0, gen: "SDR", name: "SDRAM 16K", slot: "dimm", price: 0, idleW: 1, loadW: 2, heatFactor: 1,
    clock: { min: 0.5, base: 1, max: 1.5 }, thermal: ramThermal, visual: "dimm-basic",
    sizeBytes: 16 * 1024, latency: 200, banks: 2, bankGroups: 1, rowBytes: 256, tCL: 80, tRCD: 120, tRP: 100, burst: 8 },
  { id: "ram1", kind: "ram", tier: 1, gen: "DDR2", name: "DDR2 32K", slot: "dimm", price: 100, idleW: 1, loadW: 3, heatFactor: 1,
    clock: { min: 1, base: 2, max: 3 }, thermal: ramThermal, visual: "dimm-fast",
    sizeBytes: 32 * 1024, latency: 12, banks: 4, bankGroups: 1, rowBytes: 256, tCL: 5, tRCD: 7, tRP: 6, burst: 2 },
  { id: "ram1b", kind: "ram", tier: 2, gen: "DDR3", name: "DDR3 64K", slot: "dimm", price: 220, idleW: 1, loadW: 3, heatFactor: 1,
    clock: { min: 1.5, base: 2.5, max: 3.5 }, thermal: ramThermal, visual: "dimm-ddr3",
    sizeBytes: 64 * 1024, latency: 9, banks: 8, bankGroups: 1, rowBytes: 256, tCL: 4, tRCD: 5, tRP: 4, burst: 2 },
  { id: "ram2", kind: "ram", tier: 3, gen: "DDR4", name: "DDR4 128K", slot: "dimm", price: 400, idleW: 2, loadW: 5, heatFactor: 1,
    clock: { min: 2, base: 3, max: 5 }, thermal: ramThermal, visual: "dimm-lowlat",
    sizeBytes: 128 * 1024, latency: 4, banks: 16, bankGroups: 4, rowBytes: 256, tCL: 2, tRCD: 2, tRP: 2, burst: 1 },
  { id: "ram3", kind: "ram", tier: 4, gen: "DDR4", name: "DDR4 ECC 128K", slot: "dimm", price: 1500, idleW: 3, loadW: 7, heatFactor: 1,
    clock: { min: 2, base: 3, max: 4 }, thermal: ramThermal, visual: "dimm-ecc",
    sizeBytes: 128 * 1024, latency: 5, banks: 16, bankGroups: 4, rowBytes: 256, tCL: 2, tRCD: 3, tRP: 2, burst: 1, ecc: true },
  { id: "ram4", kind: "ram", tier: 5, gen: "DDR5", name: "DDR5 256K", slot: "dimm", price: 2400, idleW: 3, loadW: 7, heatFactor: 1,
    clock: { min: 3, base: 4, max: 6 }, thermal: ramThermal, visual: "dimm-ddr5", subChannels: 2,
    sizeBytes: 256 * 1024, latency: 4, banks: 32, bankGroups: 8, rowBytes: 256, tCL: 2, tRCD: 2, tRP: 2, burst: 1 },
  { id: "ram5", kind: "ram", tier: 6, gen: "DDR5", name: "DDR5 ECC 256K", slot: "dimm", price: 4200, idleW: 4, loadW: 9, heatFactor: 1,
    clock: { min: 3, base: 4, max: 5.5 }, thermal: ramThermal, visual: "dimm-ddr5ecc", subChannels: 2,
    sizeBytes: 256 * 1024, latency: 4, banks: 32, bankGroups: 8, rowBytes: 256, tCL: 2, tRCD: 3, tRP: 2, burst: 1, ecc: true },

  { id: "psu0", kind: "psu", tier: 0, name: "PSU 40 W", slot: "atx", price: 0, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "psu-basic", watts: 40, pcieLeads: 0 },
  { id: "psu1", kind: "psu", tier: 1, name: "PSU 100 W", slot: "atx", price: 60, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "psu-mid", watts: 100, pcieLeads: 0 },
  { id: "psu2", kind: "psu", tier: 2, name: "PSU 250 W (ATX+)", slot: "atx-plus", price: 250, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "psu-big", watts: 250, pcieLeads: 1 },

  // 500 W with two PCIe leads (docs/ACCEL.md). Placeholder price.
  { id: "psu3", kind: "psu", tier: 3, name: "PSU 500 W (ATX+)", slot: "atx-plus", price: 900, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "psu-big", watts: 500, pcieLeads: 2 },

  // 1 kW with four PCIe leads. Placeholder price.
  { id: "psu4", kind: "psu", tier: 4, name: "PSU 1 kW (ATX+)", slot: "atx-plus", price: 2400, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "psu-big", watts: 1000, pcieLeads: 4 },

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
  { id: "rsink0", kind: "ram-sink", tier: 0, name: "RAM VRM fins", slot: "ram-sink", price: 25, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "vrm-sink-fins", coolingPerC: 0.25 },
  { id: "rsink1", kind: "ram-sink", tier: 1, name: "RAM VRM big fins", slot: "ram-sink", price: 60, idleW: 0, loadW: 0, heatFactor: 0,
    thermal: inertThermal, visual: "vrm-sink-big", coolingPerC: 0.5 },
  { id: "rsink2", kind: "ram-sink", tier: 2, name: "RAM VRM fins + fan", slot: "ram-sink", price: 120, idleW: 0.3, loadW: 1.5, heatFactor: 0,
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

  // Accelerators (docs/ACCEL.md). Prices are orders of magnitude only; the card's own cooler is folded into `passive`.
  { id: "gpu1", kind: "gpu", tier: 1, name: "GPU 8 lanes", slot: "pcie", price: 1500, idleW: 4, loadW: 40, heatFactor: 1,
    clock: { min: 1, base: 2, max: 3 }, thermal: { passive: 1, mass: 40, throttleC: 80, unstableC: 95, damageC: 110 }, visual: "gpu-1",
    needsPcieCable: true, gpu: { lanes: 8, memBytes: 8 * 1024, banks: 1 } },
  // Later tiers (docs/ACCEL.md tables): more lanes, memory and banks, a faster clock. gpu3 needs both PCIe leads of a big PSU.
  { id: "gpu2", kind: "gpu", tier: 2, name: "GPU 16 lanes", slot: "pcie", price: 5000, idleW: 8, loadW: 90, heatFactor: 1,
    clock: { min: 1.5, base: 3, max: 4.5 }, thermal: { passive: 2, mass: 60, throttleC: 80, unstableC: 95, damageC: 110 }, visual: "gpu-2",
    needsPcieCable: true, gpu: { lanes: 16, memBytes: 16 * 1024, banks: 2 } },
  { id: "gpu3", kind: "gpu", tier: 3, name: "GPU 32 lanes", slot: "pcie", price: 15000, idleW: 12, loadW: 180, heatFactor: 1,
    clock: { min: 2, base: 4, max: 6 }, thermal: { passive: 4, mass: 90, throttleC: 80, unstableC: 95, damageC: 110 }, visual: "gpu-3",
    needsPcieCable: true, pcieLeads: 2, gpu: { lanes: 32, memBytes: 32 * 1024, banks: 4 } },
  { id: "npu1", kind: "npu", tier: 1, name: "NPU 4x4", slot: "pcie", price: 2500, idleW: 2, loadW: 15, heatFactor: 1,
    clock: { min: 1, base: 2, max: 3 }, thermal: { passive: 0.4, mass: 25, throttleC: 75, unstableC: 90, damageC: 105 }, visual: "npu-1", needsPcieCable: false,
    npu: { grid: 4, memBytes: 8 * 1024 } },
  { id: "npu2", kind: "npu", tier: 2, name: "NPU 8x8", slot: "pcie", price: 10000, idleW: 5, loadW: 45, heatFactor: 1,
    clock: { min: 1.5, base: 3, max: 4.5 }, thermal: { passive: 1.2, mass: 40, throttleC: 75, unstableC: 90, damageC: 105 }, visual: "npu-2", needsPcieCable: true,
    npu: { grid: 8, memBytes: 32 * 1024 } },
  { id: "tpm1", kind: "tpm", tier: 1, name: "Secure module", slot: "tpm", price: 400, idleW: 0.2, loadW: 0.5, heatFactor: 1,
    thermal: { passive: 0.2, mass: 5, throttleC: 90, unstableC: 105, damageC: 120 }, visual: "tpm-1",
    tpm: { measureTicks: 4, attestTicks: 60, surcharge: 2 } },
  { id: "tpm2", kind: "tpm", tier: 2, name: "Secure module 2", slot: "tpm", price: 1500, idleW: 0.3, loadW: 0.8, heatFactor: 1,
    thermal: { passive: 0.2, mass: 5, throttleC: 90, unstableC: 105, damageC: 120 }, visual: "tpm-2",
    tpm: { measureTicks: 1, attestTicks: 20, surcharge: 1 } },

  { id: "display0", kind: "display", tier: 0, name: "CLI monitor", slot: "display", price: 0, idleW: 1, loadW: 3, heatFactor: 1,
    clock: { min: 0.5, base: 1, max: 2 }, thermal: dispThermal, visual: "monitor-cli", writeLatency: 1 },
  // The graphics display (docs/ACCEL.md "Display"): a faster panel (writes land at once) with a richer screen: the OS dashboard, or what a GPU draws when the cable is on the card.
  { id: "display1", kind: "display", tier: 1, name: "Graphics display", slot: "display", price: 2500, idleW: 3, loadW: 8, heatFactor: 1,
    clock: { min: 0.5, base: 1, max: 2 }, thermal: dispThermal, visual: "monitor-gfx", writeLatency: 0, graphics: true },
];

export const DEVICE_SPECS: Readonly<Record<string, DeviceSpec>> = Object.fromEntries(specList.map((s) => [s.id, s]));

export function getSpec(id: string): DeviceSpec | undefined {
  return DEVICE_SPECS[id];
}

/** Specs of one kind ordered by tier (the per-device upgrade ladder). */
export function specsOfKind<K extends DeviceKind>(kind: K): (DeviceSpec & { kind: K })[] {
  return specList.filter((s) => s.kind === kind).sort((a, b) => a.tier - b.tier) as (DeviceSpec & { kind: K })[];
}

/** A voltage regulator on the board (see docs/VRM.md): phases of buck converters feeding the CPU or the memory. */
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
  /** The CPU core regulator. */
  vrm: VrmSpec;
  /** The memory regulator (feeds every DIMM). */
  ramVrm: VrmSpec;
  visual: string;
}

/**
 * PC cases: the chassis the board lives in (docs/BOARD.md "Cases"). A case of tier `t` holds boards up to tier `maxBoard` (a form
 * factor: mini-ITX, micro-ATX, ATX, E-ATX), so a bigger board needs a bigger case first. The campaign starts in the Mini tower.
 */
export interface CaseTierSpec {
  tier: number;
  name: string;
  /** Price of the case (placeholder). */
  price: number;
  /** The biggest board tier it holds. */
  maxBoard: number;
  /** The form factor of the biggest board it holds, for the player's eyes. */
  form: string;
  visual: string;
}

export const CASE_TIERS: readonly CaseTierSpec[] = [
  { tier: 0, name: "Mini tower", price: 25, maxBoard: 0, form: "mini-ITX", visual: "case-mini" },
  { tier: 1, name: "Micro tower", price: 70, maxBoard: 1, form: "micro-ATX", visual: "case-micro" },
  { tier: 2, name: "Mid tower", price: 160, maxBoard: 2, form: "ATX", visual: "case-mid" },
  { tier: 3, name: "Full tower", price: 320, maxBoard: 3, form: "E-ATX", visual: "case-full" },
];

/** The smallest case tier that holds a board tier. */
export const caseFor = (boardTier: number): number => CASE_TIERS.findIndex((c) => c.maxBoard >= boardTier);

const vrmTemps = { throttleC: 90, unstableC: 105, damageC: 120 };

export const BOARD_TIERS: readonly BoardTierSpec[] = [
  { tier: 0, name: "Starter", price: 40, visual: "board-starter",
    slots: { cpu: 1, dimm: 1, pcie: 1, sata: 2, usb: 1, atx: 1, cooler: 1, display: 1, "vrm-sink": 1, "ram-sink": 1 },
    features: { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 },
    vrm: { phases: 2, ampsPerPhase: 12, peakEfficiency: 0.8, ripple: 0.6, mass: 20, passive: 0.15, ...vrmTemps },
    ramVrm: { phases: 2, ampsPerPhase: 6, peakEfficiency: 0.78, ripple: 0.6, mass: 15, passive: 0.15, ...vrmTemps } },
  { tier: 1, name: "Basic", price: 150, visual: "board-basic",
    slots: { cpu: 1, dimm: 2, pcie: 2, sata: 3, usb: 2, atx: 1, cooler: 1, display: 1, "vrm-sink": 1, "ram-sink": 1 },
    features: { ethernetMbps: 100, usbPorts: 2, displayPorts: 1 },
    vrm: { phases: 3, ampsPerPhase: 12, peakEfficiency: 0.84, ripple: 0.45, mass: 30, passive: 0.2, ...vrmTemps },
    ramVrm: { phases: 2, ampsPerPhase: 8, peakEfficiency: 0.82, ripple: 0.45, mass: 22, passive: 0.2, ...vrmTemps } },
  { tier: 2, name: "Mainstream", price: 300, visual: "board-mainstream",
    slots: { cpu: 1, dimm: 4, pcie: 3, sata: 4, m2: 2, usb: 3, tpm: 1, "atx-plus": 1, cooler: 1, display: 1, "vrm-sink": 1, "ram-sink": 1 },
    features: { ethernetMbps: 100, usbPorts: 3, displayPorts: 2 },
    vrm: { phases: 4, ampsPerPhase: 15, peakEfficiency: 0.88, ripple: 0.25, mass: 45, passive: 0.3, ...vrmTemps },
    ramVrm: { phases: 3, ampsPerPhase: 10, peakEfficiency: 0.86, ripple: 0.25, mass: 32, passive: 0.3, ...vrmTemps } },
  { tier: 3, name: "Enthusiast", price: 700, visual: "board-enthusiast",
    slots: { cpu: 1, dimm: 8, pcie: 4, sata: 8, m2: 3, usb: 4, tpm: 1, "atx-plus": 1, cooler: 1, display: 1, "vrm-sink": 1, "ram-sink": 1 },
    features: { ethernetMbps: 1000, usbPorts: 4, displayPorts: 2 },
    vrm: { phases: 6, ampsPerPhase: 20, peakEfficiency: 0.92, ripple: 0.1, mass: 60, passive: 0.4, ...vrmTemps },
    ramVrm: { phases: 4, ampsPerPhase: 15, peakEfficiency: 0.9, ripple: 0.1, mass: 45, passive: 0.4, ...vrmTemps } },
];
