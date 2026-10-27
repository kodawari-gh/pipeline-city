// Contextual part picker, pure logic: what the side card shows for the selected id. No DOM, no signals.
// The card opens only when the renderer selects something (`selected`). Parts are placed by dragging from the
// inventory tray (or the world); the card offers purchases (into the inventory), the clock, power and job actions.

import { AMBIENT_C, BOARD_TIERS, CASE_TIERS, getSpec, specsOfKind, type CardSpec, type CoolerSpec, type CpuSpec, type DeviceKind, type DeviceSpec } from '../sim/board/specs';
import { ECONOMY } from '../sim/game/economy';
import { cpuProfile } from '../sim/game/cpuprofile';
import type { DeviceSnap, KeySnap, Snapshot } from '../sim/game/game';
import { getOsSpec, OS_SPECS } from '../sim/os';
import { getIspSpec, getRouterSpec, ISP_SPECS, ROUTER_SPECS } from '../sim/net/specs';
import { clockWarning, cpuFeatures, describeId, fmtMoney, fmtTicks, KIND_LABEL, type Level, statusChip } from './logic';
import { fmtMbit, isJackId } from './netdesc';
import { hardwareWarn, jackPort, netStateLines, netStats, nicLines, nicStats } from './netui';
import { cannotRunText, deadlineInfo, isNextLevelLock, lockOf, lockTooltip, moreOffer, unlockedFirst, type JobView, type LevelLock, type MoreOffer } from './levelui';
import { JOB_TYPES } from './regions';
import { boardCards, cpuVrmWarning, liquidVrmNote, ramVrmWarning, vrmLines, vrmReadout, type BoardCard, type VrmReadout } from './vrm';

/** The storage block size (bytes), as in the sim's storage device. */
const BLOCK_BYTES = 256;

export type PickerKind = DeviceKind | 'board' | 'case' | 'os' | 'router' | 'isp' | 'key' | 'tray' | 'power' | 'usb' | 'info';
export type BuyState = 'ready' | 'poor' | 'blocked';
export type IconName = 'bolt' | 'flame' | 'clock' | 'dollar' | 'memory' | 'cpu' | 'lock' | 'check' | 'box' | 'fan' | 'slot' | 'warn' | 'gauge'
  | 'net' | 'usb' | 'screen' | 'disk' | 'eff' | 'wave' | 'down' | 'up' | 'star' | 'stick'
  | 'board' | 'case' | 'heatsink' | 'layers' | 'router' | 'globe' | 'shop' | 'play' | 'pause' | 'card' | 'grid';

export interface PickerLine { level: Level | 'info'; text: string }

export interface PickerAction {
  id: 'power' | 'powerCycle' | 'plug' | 'eject' | 'uninstallOs';
  label: string;
  keyId?: number;
  primary?: boolean;
  /** Disabled reason, when the action is shown but cannot be taken now. */
  why?: string;
}

/** Under an OS the key stays in while the OS has its job; it pops out by itself. */
const osBusy = (s: Snapshot, k: { done: boolean; stage: string }): string | undefined =>
  s.os && !k.done && k.stage !== 'tray' ? 'The OS is working on this job: the key pops out by itself when the result is written' : undefined;

/** One numeric property of a part, for the bars. `value` is in `unit`; bars use `goodness` (0..1). */
export interface Stat {
  key: string;
  label: string;
  icon: IconName;
  value: number;
  unit: string;
  higherIsBetter: boolean;
  /** The values span orders of magnitude (network speeds): bar lengths use a log scale. */
  log?: boolean;
}

/** One rung of the upgrade ladder for a kind of part. */
export type LadderState = 'installed' | 'crate' | 'ready' | 'poor' | 'blocked' | 'locked' | 'level';

export interface LadderStep {
  /** Spec id (`cpu1`), or `board<tier>` for the board ladder. */
  specId: string;
  name: string;
  tier: number;
  state: LadderState;
  price?: number;
  /** Sandbox game: show "free" instead of the price. */
  free?: boolean;
  /** Why it cannot be bought (poor, blocked) or a short note (crate, locked). */
  reason?: string;
  /** State `level`: the player level that opens it (greyed tile, lock and "Level N"). */
  lock?: LevelLock;
  /** The gating level is the very next one: a subtle outline. */
  soon?: boolean;
  /** Installed device instance id, for the installed rung. */
  devId?: string;
  /** Inventory item id, for the crate rung. */
  invId?: string;
  /** A warning on the rung (a CPU the board's VRM cannot feed, a liquid cooler with no VRM heatsink, a router with no OS yet). */
  warn?: string;
  /** The word for the installed rung when "Fitted" is wrong: "Active" for a plan, "Placed" for a router. */
  fittedLabel?: string;
  /** Buying applies it at once (an internet plan) instead of adding it to the inventory. */
  applied?: boolean;
  /** Copies of it in the inventory (a spare), on a fitted or spare tile. */
  spares?: number;
  /** Buying another copy: set on a fitted or spare tile, where the tile itself has no buy button. */
  more?: MoreOffer;
}

export interface PickerModel {
  id: string;
  kind: PickerKind;
  title: string;
  plain: string;
  nerd: string;
  /** Upgrade ladder for part kinds: owned, next and blocked rungs (older tiers are left out). */
  ladder: LadderStep[];
  /** The VRM readout (the `vrm` id, and the CPU card when a CPU is fitted). */
  vrm?: VrmReadout | null;
  /** The motherboard tier cards (the `board` picker). Replaces the rung list for boards. */
  boardCards?: BoardCard[];
  /** Spec id of the part in this socket (or the first of its kind), for the before/after bars. */
  current: string | null;
  /** The spec the player selected (an inventory part, or a spec id): the default option for the bars. */
  focus: string | null;
  emptyText?: string;
  lines: PickerLine[];
  actions: PickerAction[];
  /** Show the CPU clock control. */
  clock: boolean;
  /** Installed device, for live readings and the clock. */
  device?: DeviceSnap;
  /** The installed OS, on the card for the OS itself and for the drive that hosts it. */
  osSection?: OsSection | null;
  /** The bay's shelf: operating systems on offer (only while no OS is installed). */
  shelf?: LadderStep[];
  /** A key card: its needs, deadline and decline (levelui.ts). */
  job?: JobView;
  /** A small tag next to the title: `retired` on a USB key whose client went online. */
  tag?: string;
}

export interface OsQueueRow { keyId: number; label: string; type: string; state: string; text: string; job: JobView | null; retired: boolean }
/** The OS block of a card: what the OS is doing, its queue, the host drive and the later tiers. */
export interface OsSection {
  name: string;
  tier: number;
  status: string;
  level: Level | 'info';
  programSlots: number;
  queueSlots: number;
  running: string | null;
  queue: OsQueueRow[];
  host: { slot: string; usedK: number; capK: number } | null;
  ladder: LadderStep[];
}

/** A key from anywhere the machine holds it (tray, plugged). */
const findKey = (s: Snapshot, id: number): KeySnap | undefined =>
  [...s.tray, ...(s.plugged ? [s.plugged] : [])].find((k) => k.id === id);
/** Plain job type for a key id. */
const keyType = (s: Snapshot, id: number): string => findKey(s, id)?.type ?? '';

/** What the needs chips, the deadline and the decline button read from a key. */
export const jobView = (k: KeySnap): JobView => ({
  id: k.id, label: k.label, needs: k.needs, missing: k.missing, runnable: k.runnable, declinable: k.declinable,
  arrivalTick: k.arrivalTick, expiresTick: k.expiresTick,
});

/**
 * The OS section for a snapshot with an OS installed, or null. Pure: every number comes from the snapshot. Queue rows say
 * how many jobs are ahead; held keys say which key to plug in again to collect.
 */
export function osSection(s: Snapshot): OsSection | null {
  const os = s.os;
  if (!os) return null;
  const st = statusChip(s);
  const queue: OsQueueRow[] = os.queue.map((j) => ({
    keyId: j.keyId,
    label: j.label,
    type: keyType(s, j.keyId),
    state: j.state,
    retired: !!findKey(s, j.keyId)?.retired,
    job: (() => { const k = findKey(s, j.keyId); return k ? jobView(k) : null; })(),
    text: j.state === 'running' ? 'running now'
      : j.state === 'result' ? 'done'
      : j.ahead === 0 ? 'next' : `${j.ahead} ahead`,
  }));
  const host = s.storage.find((x) => x.hasOs);
  return {
    name: os.name,
    tier: os.tier,
    status: st.text,
    level: st.level === 'idle' ? 'info' : st.level,
    programSlots: os.programSlots,
    queueSlots: os.queueSlots,
    running: os.queue.find((j) => j.state === 'running')?.label ?? null,
    queue,
    host: host ? { slot: host.slot, usedK: Math.round(host.usedBytes / 1024), capK: Math.round(host.capacityBytes / 1024) } : null,
    ladder: ladderFor(s, 'os'),
  };
}

/** Board ids in the board ladder, one per tier. */
export const boardId = (tier: number) => `board${tier}`;
/** Case ids in the case ladder, one per tier. */
export const caseId = (tier: number) => `case${tier}`;

/** Every spec id of a kind, ordered by tier (or the board tiers). */
export function catalogOf(kind: PickerKind): string[] {
  if (kind === 'board') return BOARD_TIERS.map((b) => boardId(b.tier));
  if (kind === 'case') return CASE_TIERS.map((c) => caseId(c.tier));
  if (kind === 'cpu' || kind === 'ram' || kind === 'psu' || kind === 'cooler' || kind === 'display' || kind === 'storage' || kind === 'vrm-sink' || kind === 'ram-sink' || kind === 'nic' || kind === 'gpu' || kind === 'npu' || kind === 'tpm') {
    return specsOfKind(kind).map((x) => x.id);
  }
  if (kind === 'os') return OS_SPECS.map((o) => o.id);
  if (kind === 'router') return ROUTER_SPECS.map((r) => r.id);
  if (kind === 'isp') return ISP_SPECS.map((p) => p.id);
  return [];
}

/** Sustained throughput of a drive at its base clock, bytes per second (the same model as the sim's storage device). */
export function drivePerSecond(spec: { clock: { base: number }; blockTicks: number }): number {
  return Math.round((spec.clock.base * ECONOMY.cpuCyclesPerClock * BLOCK_BYTES) / spec.blockTicks);
}

/** Numeric stats of a spec (or a board tier). Empty for an unknown id. */
export function statsOf(specId: string): Stat[] {
  if (/^case\d+$/.test(specId)) {
    const ct = CASE_TIERS[Number(specId.slice(4))];
    if (!ct) return [];
    const bt = BOARD_TIERS[ct.maxBoard]!;
    return [
      { key: 'board', label: 'Biggest board', icon: 'board', value: ct.maxBoard + 1, unit: '', higherIsBetter: true },
      { key: 'dimm', label: 'Memory slots it can hold', icon: 'memory', value: bt.slots.dimm ?? 0, unit: '', higherIsBetter: true },
    ];
  }
  if (/^board\d+$/.test(specId)) {
    const bt = BOARD_TIERS[Number(specId.slice(5))];
    if (!bt) return [];
    const total = Object.values(bt.slots).reduce((a, n) => a + (n ?? 0), 0);
    return [
      { key: 'dimm', label: 'Memory slots', icon: 'memory', value: bt.slots.dimm ?? 0, unit: '', higherIsBetter: true },
      { key: 'slots', label: 'Slots', icon: 'slot', value: total, unit: '', higherIsBetter: true },
    ];
  }
  const os = getOsSpec(specId);
  if (os) return [
    { key: 'programs', label: 'Programs', icon: 'cpu', value: os.programSlots, unit: '', higherIsBetter: true },
    { key: 'queue', label: 'Queue', icon: 'slot', value: os.queueSlots, unit: 'jobs', higherIsBetter: true },
    { key: 'memory', label: 'Memory needed', icon: 'memory', value: os.minRamBytes / 1024, unit: 'K', higherIsBetter: false },
    { key: 'disk', label: 'Disk needed', icon: 'memory', value: os.diskBytes / 1024, unit: 'K', higherIsBetter: false },
  ];
  const net = netStats(specId);
  if (net) return net;
  const spec = getSpec(specId);
  if (!spec) return [];
  switch (spec.kind) {
    case 'cpu': {
      // Measured on the real engine (sim/game/cpuprofile.ts): speed is the average of the three kinds of work, and each kind is a bar of
      // its own, so the branches of the CPU tree read as what they are good at.
      const p = cpuProfile(specId)!;
      return [
        { key: 'speed', label: 'Speed', icon: 'clock', value: Math.round(((p.compute + p.memory + p.branchy) / 3) * 100) / 100, unit: '', higherIsBetter: true },
        { key: 'compute', label: 'Number crunching', icon: 'clock', value: p.compute, unit: '', higherIsBetter: true },
        { key: 'memory', label: 'Big data', icon: 'memory', value: p.memory, unit: '', higherIsBetter: true },
        { key: 'branchy', label: 'Branchy code', icon: 'clock', value: p.branchy, unit: '', higherIsBetter: true },
        { key: 'tlb', label: 'Virtual memory (TLB)', icon: 'memory', value: spec.mmu?.tlb ?? 0, unit: '', higherIsBetter: true },
        { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
      ];
    }
    case 'ram': return [
      { key: 'size', label: 'Memory', icon: 'memory', value: spec.sizeBytes / 1024, unit: 'K', higherIsBetter: true },
      { key: 'latency', label: 'Latency', icon: 'gauge', value: spec.latency, unit: 'ticks', higherIsBetter: false },
      { key: 'banks', label: 'Banks', icon: 'memory', value: spec.banks, unit: '', higherIsBetter: true },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
    case 'psu': return [{ key: 'watts', label: 'Capacity', icon: 'bolt', value: spec.watts, unit: 'W', higherIsBetter: true }];
    case 'cooler': return [
      { key: 'cooling', label: 'Heat removal', icon: 'flame', value: spec.coolingPerC, unit: 'W/C', higherIsBetter: true },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
    case 'display': return [{ key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false }];
    case 'vrm-sink': case 'ram-sink': return [
      { key: 'cooling', label: 'Heat removal', icon: 'flame', value: spec.coolingPerC, unit: 'W/C', higherIsBetter: true },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
    case 'storage': return [
      { key: 'size', label: 'Capacity', icon: 'memory', value: spec.capacityBytes / 1024, unit: 'K', higherIsBetter: true },
      { key: 'latency', label: 'Latency', icon: 'gauge', value: spec.latencyTicks, unit: 'ticks', higherIsBetter: false },
      { key: 'throughput', label: 'Throughput', icon: 'clock', value: drivePerSecond(spec), unit: 'B/s', higherIsBetter: true },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
    case 'nic': return nicStats(spec);
    case 'gpu': return [
      { key: 'lanes', label: 'Lanes', icon: 'cpu', value: spec.gpu?.lanes ?? 0, unit: '', higherIsBetter: true },
      { key: 'cardclk', label: 'Clock', icon: 'clock', value: spec.clock?.base ?? 0, unit: 'x', higherIsBetter: true },
      { key: 'cardmem', label: 'Card memory', icon: 'memory', value: (spec.gpu?.memBytes ?? 0) / 1024, unit: 'K', higherIsBetter: true },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
    case 'npu': return [
      { key: 'cells', label: 'Matrix cells', icon: 'cpu', value: (spec.npu?.grid ?? 0) ** 2, unit: '', higherIsBetter: true },
      { key: 'cardclk', label: 'Clock', icon: 'clock', value: spec.clock?.base ?? 0, unit: 'x', higherIsBetter: true },
      { key: 'cardmem', label: 'Card memory', icon: 'memory', value: (spec.npu?.memBytes ?? 0) / 1024, unit: 'K', higherIsBetter: true },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
    case 'tpm': return [
      { key: 'measure', label: 'Measuring', icon: 'clock', value: spec.tpm?.measureTicks ?? 0, unit: 'ticks/word', higherIsBetter: false },
      { key: 'attest', label: 'Attesting', icon: 'gauge', value: spec.tpm?.attestTicks ?? 0, unit: 'ticks', higherIsBetter: false },
      { key: 'surcharge', label: 'Memory overhead', icon: 'warn', value: spec.tpm?.surcharge ?? 0, unit: 'cycles', higherIsBetter: false },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
  }
}

/** Bar length for one stat: 1 for the best part of its kind, less for the rest (0..1). */
export function goodness(kind: PickerKind, key: string, value: number, higherIsBetter: boolean): number {
  const stats = catalogOf(kind).flatMap((id) => statsOf(id).filter((x) => x.key === key));
  const vals = stats.map((x) => x.value).filter((v) => v > 0);
  if (!vals.length || value <= 0) return 0;
  // Speeds that span orders of magnitude (the network) are measured on a log scale, or the low tiers would be invisible slivers.
  const t = stats.some((x) => x.log) ? (v: number) => Math.log10(1 + v) : (v: number) => v;
  const best = higherIsBetter ? Math.max(...vals) : Math.min(...vals);
  const g = higherIsBetter ? t(value) / t(best) : t(best) / t(value);
  return Math.min(1, Math.max(0, g));
}

export interface CompareRow {
  key: string;
  label: string;
  icon: IconName;
  /** Bar lengths 0..1 for the current part (null when there is none) and the option. */
  cur: number | null;
  opt: number;
  curText: string | null;
  optText: string;
  /** better / worse / same, for the colour of the delta. Null with no current part. */
  trend: 'better' | 'worse' | 'same' | null;
  deltaText: string | null;
}

const fmtStat = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Before/after rows for the option against the current part of the same kind. */
export function compareRows(kind: PickerKind, current: string | null, option: string): CompareRow[] {
  const cur = current ? statsOf(current) : [];
  return statsOf(option).map((o) => {
    const c = cur.find((x) => x.key === o.key) ?? null;
    const trend: CompareRow['trend'] = c === null ? null
      : o.value === c.value ? 'same'
      : (o.higherIsBetter ? o.value > c.value : o.value < c.value) ? 'better' : 'worse';
    const diff = c ? o.value - c.value : 0;
    const unit = o.unit ? ` ${o.unit}` : '';
    return {
      key: o.key, label: o.label, icon: o.icon,
      cur: c ? goodness(kind, o.key, c.value, o.higherIsBetter) : null,
      opt: goodness(kind, o.key, o.value, o.higherIsBetter),
      curText: c ? `${fmtStat(c.value)}${unit}` : null,
      optText: `${fmtStat(o.value)}${unit}`,
      trend,
      deltaText: c ? (diff === 0 ? 'same' : `${diff > 0 ? '+' : '-'}${fmtStat(Math.abs(diff))}${unit}`) : null,
    };
  });
}

/**
 * Overclock zones on the clock axis, from the sim's own steady-state heat model (thermal.ts): the clock at which a
 * full-load CPU with this cooler settles at its throttle and unstable temperatures. Raw values (may lie outside the
 * clock range); the dial clamps them when it draws.
 */
export interface ClockZones { min: number; max: number; throttleAt: number; unstableAt: number }

export function clockZones(cpu: CpuSpec, cooler: CoolerSpec | undefined): ClockZones {
  const coeff = cpu.thermal.passive + (cooler?.coolingPerC ?? 0);
  const heat = cpu.loadW * cpu.heatFactor;
  const at = (t: number) => (heat > 0 ? cpu.clock.base * Math.cbrt(((t - AMBIENT_C) * coeff) / heat) : cpu.clock.max);
  return { min: cpu.clock.min, max: cpu.clock.max, throttleAt: at(cpu.thermal.throttleC), unstableAt: at(cpu.thermal.unstableC) };
}

/** Steady temperature estimate (C) at a clock, same model as `clockZones`. */
export function estTempC(cpu: CpuSpec, cooler: CoolerSpec | undefined, clock: number): number {
  const r = clock / cpu.clock.base;
  return AMBIENT_C + (cpu.loadW * cpu.heatFactor * r ** 3) / (cpu.thermal.passive + (cooler?.coolingPerC ?? 0));
}

export type ZoneName = 'safe' | 'throttle' | 'unstable';
export function zoneOf(z: ClockZones, clock: number): ZoneName {
  if (clock >= z.unstableAt) return 'unstable';
  if (clock >= z.throttleAt) return 'throttle';
  return 'safe';
}

/** One line of key stats for a spec (used in tooltips and the nerd text). */
export function specBrief(spec: DeviceSpec): string {
  switch (spec.kind) {
    case 'cpu': {
      const arch = spec.engine.kind === 'unpipelined' ? 'one step at a time' : cpuFeatures(spec.engine).filter((x, i) => i === 0 || !/^\d+-line data cache$/.test(x)).join(', ');
      const clk = spec.clock ? `, ${spec.clock.base}x base clock (max ${spec.clock.max}x)` : '';
      return arch + clk;
    }
    case 'ram': return `${spec.sizeBytes / 1024}K, latency ${spec.latency}, ${spec.banks} banks${spec.ecc ? ', ECC' : ''}`;
    case 'psu': return `${spec.watts} W${spec.slot === 'atx-plus' ? ', needs ATX+ board' : ''}`;
    case 'cooler': return `${spec.coolingPerC} W/C cooling`;
    case 'display': return 'text monitor';
    case 'storage': return `${spec.capacityBytes / 1024}K, ${spec.slot === 'm2' ? 'M.2' : 'SATA'}`;
    case 'vrm-sink': return `${spec.coolingPerC} W/C cooling for the VRM`;
    case 'ram-sink': return `${spec.coolingPerC} W/C cooling for the memory VRM`;
    case 'nic': return `${spec.mbps} Mbit network card`;
    case 'gpu': return `${spec.gpu?.lanes ?? 0} lanes, ${(spec.gpu?.memBytes ?? 0) / 1024}K, ${spec.loadW} W`;
    case 'npu': return `${spec.npu?.grid ?? 0}x${spec.npu?.grid ?? 0} cells, ${(spec.npu?.memBytes ?? 0) / 1024}K, ${spec.loadW} W`;
    case 'tpm': return `secure module, ${spec.loadW} W`;
  }
}

const SLOT_KIND: Record<string, DeviceKind> = {
  cpu: 'cpu', dimm: 'ram', atx: 'psu', 'atx-plus': 'psu', cooler: 'cooler', display: 'display', sata: 'storage', m2: 'storage',
  'vrm-sink': 'vrm-sink', 'ram-sink': 'ram-sink', pcie: 'nic', tpm: 'tpm',
};
const WORLD_KIND: Record<string, DeviceKind | 'board' | 'case' | 'os' | 'router' | 'isp'> = {
  psu: 'psu', monitor: 'display', 'psu.readout': 'psu', board: 'board', case: 'case', bay: 'storage', os: 'os', router: 'router', wall: 'isp',
};

/** The kind a selected id stands for, if any (slot, device, inventory item, spec id, world object or board tier). */
export function kindOf(id: string, s: Snapshot): DeviceKind | 'board' | 'case' | 'os' | 'router' | 'isp' | null {
  const slot = s.slots.find((x) => x.id === id);
  if (slot) return SLOT_KIND[slot.type] ?? null;
  const dev = s.devices.find((d) => d.id === id);
  if (dev) return dev.kind;
  if (id.startsWith('inv:')) {
    const it = s.inventory.find((x) => x.id === id.slice(4));
    return it ? it.kind : null;
  }
  if (WORLD_KIND[id]) return WORLD_KIND[id]!;
  if (getRouterSpec(id)) return 'router';
  if (getIspSpec(id)) return 'isp';
  const spec = getSpec(id);
  if (spec) return spec.kind;
  if (getOsSpec(id)) return 'os';
  if (/^board[0-9]+$/.test(id)) return 'board';
  if (/^case[0-9]+$/.test(id)) return 'case';
  return null;
}

/**
 * The ladder for a kind: installed and inventory rungs, then each tier the shop sells (ready, poor, blocked, level). Every tier is
 * for sale whatever you own, and a tile you own carries a `more` offer (buy another: a spare, a downgrade, a second machine).
 */
export function ladderFor(s: Snapshot, kind: PickerKind): LadderStep[] {
  const installed: Array<{ spec: string; devId: string }> = kind === 'board'
    ? [{ spec: boardId(s.boardTier), devId: '' }]
    : kind === 'case' ? [{ spec: caseId(s.caseTier), devId: '' }]
    : kind === 'os'
      ? (s.os ? [{ spec: s.os.spec, devId: '' }] : [])
      : kind === 'router' ? (s.net.router ? [{ spec: s.net.router.id, devId: '' }] : [])
      : kind === 'isp' ? (s.net.isp ? [{ spec: s.net.isp.id, devId: '' }] : [])
      : s.devices.filter((d) => d.kind === kind).map((d) => ({ spec: d.spec, devId: d.id }));
  const crate = kind === 'isp' ? [] : s.inventory.filter((i) => i.kind === kind);
  const tierOf = (id: string) => (kind === 'board' ? Number(id.slice(5)) : kind === 'case' ? Number(id.slice(4)) : getSpec(id)?.tier ?? getOsSpec(id)?.tier ?? getRouterSpec(id)?.tier ?? getIspSpec(id)?.tier ?? -1);
  const nameOf = (id: string) => (kind === 'board' ? BOARD_TIERS[Number(id.slice(5))]?.name : kind === 'case' ? CASE_TIERS[Number(id.slice(4))]?.name : getSpec(id)?.name ?? getOsSpec(id)?.name ?? getRouterSpec(id)?.name ?? (getIspSpec(id) && `${getIspSpec(id)!.name} plan`)) ?? id;
  const out: LadderStep[] = [];
  for (const id of catalogOf(kind)) {
    const tier = tierOf(id);
    const name = nameOf(id);
    const inst = installed.find((x) => x.spec === id);
    const copies = crate.filter((x) => x.spec === id);
    const p = s.purchases.find((x) => x.id === id);
    // The player level comes first: before money, hardware and "later".
    const lock = lockOf(s, id, p);
    const spares = copies.length || undefined;
    const more = p && !p.later ? moreOffer(s, p, lock) : undefined;
    if (inst) { out.push({ specId: id, name, tier, state: 'installed', devId: inst.devId || undefined, spares, more }); continue; }
    const inv = copies[0];
    if (inv) {
      // A spare that the sim will not fit right now says why (memory minimum, free capacity, no slot); otherwise it can go in.
      const reason = inv.installable ? 'In your inventory: drag it onto its socket' : inv.reason ?? 'Nothing to fit it to right now';
      out.push({ specId: id, name, tier, state: 'crate', invId: inv.id, reason, spares, more });
      continue;
    }
    if (lock) {
      out.push({
        specId: id, name, tier, state: 'level', price: p?.price, free: s.sandbox || undefined, lock,
        soon: isNextLevelLock(lock, s.level.level),
        reason: lockTooltip(lock, { blocked: p?.blocked, priceShort: p && !s.sandbox ? p.price - s.money : 0 }),
      });
      continue;
    }
    if (p?.later) {
      out.push({ specId: id, name, tier, state: 'locked', reason: p.description ?? 'Not available yet' });
      continue;
    }
    if (p) {
      // Sandbox: nothing is unaffordable and prices read "free".
      const can = s.sandbox || p.affordable;
      const state: BuyState = p.blocked ? 'blocked' : can ? 'ready' : 'poor';
      out.push({
        specId: id, name, tier, state, price: p.price, free: s.sandbox || undefined,
        reason: p.blocked ?? (can ? undefined : `Need ${fmtMoney(p.price - s.money)} more`),
      });
    } else {
      out.push({ specId: id, name, tier, state: 'locked', reason: 'Not available yet' });
    }
  }
  // Warnings on the rungs (not on a part already fitted): a CPU the board's VRM cannot feed, a liquid cooler with no VRM heatsink.
  if (kind === 'cpu' || kind === 'ram' || kind === 'cooler') {
    for (const r of out) {
      if (r.state === 'installed') continue;
      r.warn = kind === 'cpu' ? cpuVrmWarning(s, r.specId) ?? undefined : kind === 'ram' ? ramVrmWarning(s, r.specId) ?? undefined : liquidVrmNote(s, r.specId) ?? undefined;
    }
  }
  // An operating system the installed memory cannot hold: say so on the tile (the OS will not boot).
  if (kind === 'os') {
    const have = installedRamBytes(s);
    for (const r of out) {
      const spec = getOsSpec(r.specId);
      if (r.state === 'installed' || !spec || have >= spec.minRamBytes) continue;
      r.warn = `needs ${spec.minRamBytes / 1024}K of memory, you have ${have / 1024}K. Buy more memory first.`;
    }
  }
  // The network parts: what the rest of the chain still lacks (an OS, 64K of RAM, a jack), and the words for owned and applied rungs.
  if (kind === 'router' || kind === 'isp' || kind === 'nic') {
    const note = hardwareWarn(s, kind) ?? undefined;
    for (const r of out) {
      if (kind === 'isp') r.applied = true;
      if (r.state === 'installed') { if (kind !== 'nic') r.fittedLabel = kind === 'isp' ? 'Active' : 'Placed'; continue; }
      r.warn = note;
    }
  }
  return out;
}

/** Total memory of the working sticks in the machine, bytes. */
export function installedRamBytes(s: Snapshot): number {
  let n = 0;
  for (const d of s.devices) {
    if (d.kind !== 'ram' || d.burnt) continue;
    const spec = getSpec(d.spec);
    if (spec?.kind === 'ram') n += spec.sizeBytes;
  }
  return n;
}

/**
 * The next tier up from the fitted part: a spare you own above it (the lowest), else the lowest-tier rung above the installed tier
 * (a buy, a poor or blocked rung, or a later tier). Undefined when the fitted part is the top tier.
 * With nothing fitted (an empty socket) every rung is "up".
 */
export function nextUpgrade(ladder: LadderStep[]): LadderStep | undefined {
  const fitted = ladder.find((r) => r.state === 'installed');
  const fittedTier = fitted ? fitted.tier : -1;
  const above = ladder.filter((r) => r.state !== 'installed' && r.tier > fittedTier).sort((a, b) => a.tier - b.tier);
  return above.find((r) => r.state === 'crate') ?? above[0];
}

/** Plain lines about a key: what it is, how late, what it pays. */
export function keyLines(k: KeySnap, now: number): PickerLine[] {
  const left = k.deadlineTick - now;
  return [
    { level: 'info', text: JOB_TYPES[k.type] ?? 'A client job.' },
    k.late
      ? { level: 'bad', text: `Late by ${fmtTicks(-left)}. Late jobs pay less.` }
      : { level: left < 30 ? 'warn' : 'info', text: `Due in ${fmtTicks(left)} (waiting ${fmtTicks(k.age)})` },
    { level: 'info', text: `Pays about ${fmtMoney(k.payoutEstimate)} if served on time; faster pays more.` },
    ...(k.attempts > 1 ? [{ level: 'warn' as const, text: `Tried ${k.attempts} times already.` }] : []),
    ...(k.retired ? [{ level: 'info' as const, text: RETIRED_LINE }] : []),
  ];
}

/** The line on a retired USB key (its client went online): no penalty if it expires or is declined, serving it still pays. */
export const RETIRED_LINE = 'Retired: this client now sends jobs over the network. If the key expires or you decline it, nothing is lost; serving it still pays.';

/** Every key the machine knows about: tray plus the plugged one. */
export function allKeys(s: Snapshot): KeySnap[] {
  return [...s.tray, ...(s.plugged ? [s.plugged] : [])];
}

const powerStatus = (s: Snapshot) => (s.powered ? `Status: ${s.phase.replace(/-/g, ' ')}` : 'Status: off');

function emptyCard(id: string, kind: PickerKind, title: string, plain: string, nerd: string): PickerModel {
  return { id, kind, title, plain, nerd, ladder: [], current: null, focus: null, lines: [], actions: [], clock: false };
}

/**
 * The card of the router spot, the wall socket or a router in the inventory: the ladder of routers or plans, the link in
 * plain lines, and (for a spare router) where it goes. Both are applied with the machine on.
 */
function netCard(id: string, kind: 'router' | 'isp', s: Snapshot): PickerModel {
  const inv = id.startsWith('inv:') ? s.inventory.find((x) => x.id === id.slice(4)) : undefined;
  const specId = inv?.spec ?? (id === 'router' || id === 'wall' ? null : id);
  const cur = kind === 'router' ? s.net.router : s.net.isp;
  const d = describeId(id, s) ?? { title: KIND_LABEL[kind], plain: '', nerd: '' };
  const ladder = ladderFor(s, kind);
  const lines: PickerLine[] = [];
  if (inv) {
    lines.push(inv.installable
      ? { level: 'info', text: 'Drag it onto the router spot next to the monitor. The machine can stay on.' }
      : { level: 'warn', text: `${(inv.reason ?? 'Nothing to place it on right now').replace(/^./, (c) => c.toUpperCase())}.` });
  }
  if (kind === 'isp' && !cur) lines.push({ level: 'warn', text: 'No internet plan yet. Buy one below: it sets how fast jobs and results travel.' });
  if (kind === 'router' && !cur && !inv) lines.push({ level: 'warn', text: 'No router yet. Buy one below, then drag it from the inventory to this spot.' });
  lines.push(...netStateLines(s));
  return {
    ...emptyCard(id, kind, d.title, d.plain, d.nerd),
    ladder, current: cur?.id ?? null, focus: specId, lines,
    emptyText: nextUpgrade(ladder) ? undefined : 'Nothing better to buy right now.',
  };
}

/** The picker card for a selected id, or null when there is nothing to show. */
export function pickerFor(id: string | null, s: Snapshot | null): PickerModel | null {
  if (!id || !s) return null;

  if (id.startsWith('key:')) {
    const k = allKeys(s).find((x) => x.id === Number(id.slice(4)));
    if (!k) return null;
    const d = describeId(id, s)!;
    const plugged = s.plugged?.id === k.id;
    const lines = keyLines(k, s.baseTick);
    // A job the machine cannot run has a hard deadline (the client takes it back) instead of the soft one.
    const dl = deadlineInfo(k, s.baseTick);
    if (dl) lines.splice(1, 1, { level: dl.urgency === 'ok' ? 'info' : dl.urgency, text: `The client takes it back in ${fmtTicks(dl.left)}${dl.urgency === 'ok' ? '' : ': a missed job costs reputation'}.` });
    // The generic fallback ("A client job.") says nothing the title does not.
    if (JOB_TYPES[k.type] === undefined) lines.shift();
    const cannot = cannotRunText(k);
    if (cannot) lines.unshift({ level: 'bad', text: cannot });
    if (k.done) lines.push({ level: 'ok', text: `Result: ${k.result}` });
    return {
      ...emptyCard(id, 'key', `Client key ${k.label}`, d.plain, d.nerd), lines, job: jobView(k), tag: k.retired ? 'retired' : undefined,
      actions: plugged
        ? [{ id: 'eject', label: k.done ? 'Remove key (get paid)' : 'Remove key', keyId: k.id, primary: k.done, why: osBusy(s, k) }]
        : [{ id: 'plug', label: 'Plug into USB', keyId: k.id, primary: k.runnable, why: s.plugged ? 'A key is already plugged in' : k.runnable ? undefined : `Cannot run yet: it needs ${k.missing.join(' and ')}` }],
    };
  }

  if (id === 'vrm') {
    // The board's voltage regulator: live readout, status in plain words (docs/VRM.md).
    const d = describeId('vrm', s)!;
    const v = vrmReadout(s);
    return { ...emptyCard(id, 'info', d.title, d.plain, d.nerd), vrm: v, lines: v ? vrmLines(v) : [] };
  }

  if (id === 'vrm2') {
    // The memory regulator: the same readout, fed by the DIMMs.
    const d = describeId('vrm2', s)!;
    const v = vrmReadout(s, 'ram');
    return { ...emptyCard(id, 'info', d.title, d.plain, d.nerd), vrm: v, lines: v ? vrmLines(v) : [] };
  }

  if (id === 'tray') {
    const d = describeId('tray')!;
    return {
      ...emptyCard(id, 'tray', d.title, d.plain, d.nerd),
      lines: [{ level: s.tray.length >= s.queueCap ? 'bad' : 'info', text: `${s.tray.length} of ${s.queueCap} keys waiting. A full tray turns clients away.` }],
    };
  }

  if (id === 'power') {
    const d = describeId('power')!;
    const lines: PickerLine[] = [{ level: 'info', text: powerStatus(s) }];
    if (!s.powered && s.noPowerReason) lines.push({ level: 'warn', text: s.noPowerReason });
    if (s.powered && s.postBlocker) lines.push({ level: 'bad', text: `POST error: ${s.postBlocker}` });
    if (s.phase === 'error' && s.phaseReason) lines.push({ level: 'bad', text: s.phaseReason });
    const actions: PickerAction[] = [];
    if (s.power.tripped) {
      lines.unshift({ level: 'bad', text: 'The power supply tripped: too much draw. Power cycle it, then lighten the load or buy a bigger supply.' });
      actions.push({ id: 'powerCycle', label: 'Power cycle', primary: true });
    }
    lines.push({ level: 'info', text: `Boot (POST) takes about ${s.postTicks} s: memory, devices and firmware are checked each time it starts. More RAM and more devices make it longer.` });
    if (s.powered && s.phase !== 'halted') lines.push({ level: 'info', text: 'Power off is immediate: a job in progress is lost, but its key keeps its data and the job restarts at the next boot.' });
    actions.push({
      id: 'power', label: s.powered ? 'Power off' : 'Power on', primary: !s.powered && !s.power.tripped,
      why: !s.powered ? s.noPowerReason ?? undefined : undefined,
    });
    return { ...emptyCard(id, 'power', d.title, d.plain, d.nerd), lines, actions };
  }

  if (id === 'usb') {
    const d = describeId('usb')!;
    const k = s.plugged;
    const lines: PickerLine[] = k
      ? [
        { level: 'info', text: `${k.label}: ${k.done ? 'finished, ready to hand back' : s.keyIgnored ? 'ignored until the next boot' : s.phase.replace(/-/g, ' ')}` },
        ...keyLines(k, s.baseTick).slice(1),
        ...(s.keyIgnored ? [{ level: 'warn' as const, text: 'Without an OS the machine only reads a key at boot. Power off and on again.' }] : []),
      ]
      : [{ level: 'info', text: s.tray.length ? 'Port is free. Drag a key from the tray into it.' : 'Port is free. No keys waiting right now.' }];
    return {
      ...emptyCard(id, 'usb', d.title, d.plain, d.nerd), lines,
      actions: k ? [{ id: 'eject', label: k.done ? 'Remove key (get paid)' : 'Remove key', keyId: k.id, primary: k.done, why: osBusy(s, k) }] : [],
    };
  }

  if (id === 'cable.lan') {
    // The ethernet cable is the one cable that moves with the machine on.
    const c = s.cables.find((x) => x.id === 'lan');
    const d = describeId(id, s)!;
    const port = s.net.port;
    const where = port.kind === 'board' ? 'the board jack' : port.kind === 'nic' ? (s.devices.find((x) => x.id === port.deviceId)?.name ?? 'a network card') : null;
    return {
      ...emptyCard(id, 'info', d.title, d.plain, d.nerd),
      lines: [
        c?.connected
          ? { level: 'ok', text: `Plugged into ${where ?? 'a jack'}. Drag the plug to another jack to move it; the machine can stay on.` }
          : { level: 'warn', text: c?.blocked ?? 'Not plugged in. Drag the plug onto a network jack.' },
        ...netStateLines(s),
      ],
    };
  }

  if (isJackId(id)) {
    // A network jack on the board (eth0) or a card (eth1..): its speed and whether the cable is in it.
    const d = describeId(id, s)!;
    const j = jackPort(s, id);
    const plugged = !!j && s.net.port.kind !== null && (s.net.port.kind === 'board' ? j.port === 'board' : j.port === s.net.port.deviceId);
    const lines: PickerLine[] = j
      ? [
        j.burnt ? { level: 'bad', text: 'This jack is dead: the part is burnt out.' }
          : { level: plugged ? 'ok' : 'info', text: plugged ? `The ethernet cable is plugged in here (${fmtMbit(j.mbps)}).` : `${fmtMbit(j.mbps)}. Drag the ethernet plug onto it to use it.` },
      ]
      : [{ level: 'warn', text: 'There is no jack here.' }];
    return { ...emptyCard(id, 'info', d.title, d.plain, d.nerd), lines };
  }

  if (id.startsWith('cable.') && id !== 'cable.pcie') {
    const cid = id.slice(6);
    const c = s.cables.find((x) => x.id === cid);
    const d = describeId(id)!;
    return {
      ...emptyCard(id, 'info', d.title, d.plain, d.nerd),
      lines: c
        ? [{ level: c.connected ? 'ok' : 'warn', text: c.connected ? 'Connected. Power off to unplug it.' : c.blocked ?? 'Not plugged in. Drag its end to the socket.' }]
        : [],
    };
  }

  // The router spot, the wall socket (the plan) and a router in the inventory: their own ladders, applied without a power-off.
  const netKind = id === 'router' || id === 'wall' || getRouterSpec(id) || getIspSpec(id) ? kindOf(id, s)
    : id.startsWith('inv:') && s.inventory.find((x) => x.id === id.slice(4))?.kind === 'router' ? 'router' : null;
  if (netKind === 'router' || netKind === 'isp') return netCard(id, netKind, s);

  const kind = kindOf(id, s);
  if (kind) {
    // A slot id: empty socket, or the part in it. A device id, a spec id, an inventory item or a world object otherwise.
    const slot = s.slots.find((x) => x.id === id);
    const invItem = id.startsWith('inv:') ? s.inventory.find((x) => x.id === id.slice(4)) : undefined;
    const dev = slot?.deviceId
      ? s.devices.find((d) => d.id === slot.deviceId)
      : WORLD_KIND[id] ? s.devices.find((d) => d.kind === kind)
      : s.devices.find((d) => d.id === id) ?? s.devices.find((d) => d.spec === id);
    const emptySocket = !!slot && !slot.deviceId;
    const d = (dev && !emptySocket ? describeId(dev.spec) : describeId(id, s))
      ?? describeId(id)
      ?? { title: KIND_LABEL[kind], plain: '', nerd: '' };
    const ladder = ladderFor(s, kind);
    const current = kind === 'board'
      ? boardId(s.boardTier)
      : kind === 'case' ? caseId(s.caseTier)
      : kind === 'os' ? s.os?.spec ?? null
      : dev?.spec ?? (slot ? null : s.devices.find((x) => x.kind === kind)?.spec ?? null);
    const lines: PickerLine[] = [];
    if (invItem) {
      lines.push({ level: 'info', text: s.powered ? 'Power the machine off to install it.' : 'Drag it onto its socket.' });
      const why = s.inventory.find((x) => x.id === invItem.id)?.reason;
      if (why && !s.powered) lines.push({ level: 'warn', text: `${why.charAt(0).toUpperCase()}${why.slice(1)}.` });
    }
    const actions: PickerAction[] = [];
    if (kind === 'psu') {
      const p = s.power;
      lines.push({
        level: p.tripped ? 'bad' : p.totalW > p.budgetW * 0.85 ? 'warn' : 'info',
        text: `Load ${p.totalW.toFixed(0)} W of ${p.budgetW.toFixed(0)} W${p.tripped ? ' (tripped)' : ''}`,
      });
      if (p.tripped) actions.push({ id: 'powerCycle', label: 'Power cycle', primary: true });
    }
    if (kind === 'storage' && dev) {
      const st = s.storage.find((x) => x.deviceId === dev.id);
      if (st) {
        const full = st.usedBytes / st.capacityBytes > 0.9;
        lines.push({
          level: full ? 'warn' : 'info',
          text: `Used ${Math.round(st.usedBytes / 1024)}K of ${Math.round(st.capacityBytes / 1024)}K${st.hasOs ? '. Holds the operating system.' : '.'}`,
        });
      }
    }
    // The OS: its section shows on the OS badge and on the drive that hosts it; uninstall lives there too.
    const hostsOs = !!dev && s.os?.deviceId === dev.id;
    const sec = kind === 'os' || hostsOs ? osSection(s) : null;
    if (sec) {
      actions.push({ id: 'uninstallOs', label: 'Uninstall OS', why: s.powered ? 'Power the machine off first' : undefined });
    } else if (kind === 'os') {
      lines.push({ level: 'info', text: 'No operating system installed. Buy one from a drive bay, then install it onto a drive.' });
    }
    const cpu = kind === 'cpu' ? dev : undefined;
    if (cpu) {
      const w = clockWarning(cpu);
      if (w) lines.push({ level: w.level, text: w.text });
    }
    if (kind === 'board' && s.board?.burnt) {
      const same = s.purchases.find((p) => p.id === boardId(s.boardTier));
      const price = same ? `, ${s.sandbox ? 'free' : fmtMoney(same.price)}` : '';
      lines.push({ level: 'bad', text: `The board is dead: its VRM burnt out. Power off and replace it with a ${BOARD_TIERS[s.boardTier]?.name ?? 'board'}${price}.` });
    }
    // The case: what it holds, and why a bigger board needs a bigger one.
    if (kind === 'case') {
      const cur = CASE_TIERS[s.caseTier]!, board = BOARD_TIERS[s.boardTier]!;
      lines.push({ level: 'info', text: `${cur.name}: holds boards up to ${cur.form}. Your ${board.name} board is fitted.` });
      const next = CASE_TIERS[s.caseTier + 1];
      if (next) lines.push({ level: 'info', text: `A bigger board needs a bigger case first: the ${next.name} holds up to ${next.form}.` });
      if (s.powered) lines.push({ level: 'warn', text: 'Power the machine off to change the case.' });
    }
    // A VRM heatsink slot that is empty is the drop target for the heatsink rows.
    if (kind === 'vrm-sink' && emptySocket) {
      lines.push({ level: 'info', text: 'Drop a VRM heatsink here: it bolts onto the voltage regulators next to the processor.' });
    }
    if (kind === 'ram-sink' && emptySocket) {
      lines.push({ level: 'info', text: 'Drop a RAM VRM heatsink here: it bolts onto the memory regulator beside the RAM slots.' });
    }
    // A network card: which jack it is, whether the cable is in it, and its heat (a hot card runs at half speed).
    if (kind === 'nic') {
      if (emptySocket) lines.push({ level: 'info', text: 'Drop a network card here: its jack then appears on the back of the machine. This slot also takes a graphics card or an AI card.' });
      if (dev) lines.push(...nicLines(s, dev));
    }
    // Accelerator cards: the PCIe power lead they ask for, the secure module's header, and what each is for.
    if ((kind === 'gpu' || kind === 'npu') && dev && !dev.burnt) {
      const spec = getSpec(dev.spec) as CardSpec | undefined;
      if (spec?.needsPcieCable) {
        const lead = s.cables.find((c) => c.id === 'pcie');
        lines.push(lead?.connected
          ? { level: 'info', text: 'Power lead plugged in.' }
          : { level: 'bad', text: 'Needs the PCIe power lead from the PSU: plug it in with the machine off, or the machine will not start.' });
      }
    }
    if (kind === 'tpm' && emptySocket) lines.push({ level: 'info', text: 'Drop a secure module here: secure jobs need one, and it slows memory a little while they run.' });
    // A liquid cooler (fitted, or the one in the inventory) gives the VRM no airflow.
    if (kind === 'cooler') {
      const coolerId = dev?.spec ?? invItem?.spec;
      const note = coolerId ? liquidVrmNote(s, coolerId) : null;
      if (note) lines.push({ level: 'warn', text: `${note.charAt(0).toUpperCase()}${note.slice(1)}.` });
    }
    const title = emptySocket
      ? `${KIND_LABEL[kind]} socket`
      : dev ? dev.name : d.title;
    return {
      ...emptyCard(id, kind, title, d.plain, d.nerd),
      // With an OS installed, its ladder is in the OS section; the bay offers the systems while none is installed.
      ladder: sec && kind === 'os' ? [] : ladder,
      osSection: sec,
      shelf: id === 'bay' && !s.os ? unlockedFirst(ladderFor(s, 'os'), (r) => r.lock) : undefined,
      // The VRM readout rides on the CPU card (what it draws from the regulator) and the motherboard card (the cards).
      vrm: kind === 'cpu' && dev && !dev.burnt ? vrmReadout(s) : kind === 'ram' && dev && !dev.burnt ? vrmReadout(s, 'ram') : undefined,
      boardCards: kind === 'board' ? boardCards(s) : undefined,
      current, lines, actions,
      // A spec id that is neither a slot nor a fitted part (a shop or ladder item) is the comparison to show.
      focus: invItem ? invItem.spec : !slot && !dev && (getSpec(id) || getOsSpec(id)) ? id : null,
      device: emptySocket ? undefined : dev,
      clock: ((kind === 'cpu' && !!s.cpuClock) || kind === 'ram') && !!dev && !dev.burnt,
      // Only when the fitted part is the top tier: any higher tier (spare, buyable, blocked or later) gets its own line.
      emptyText: nextUpgrade(ladder) ? undefined : 'Nothing better to buy right now.',
    };
  }

  const desc = describeId(id, s);
  if (desc) return emptyCard(id, 'info', desc.title, desc.plain, desc.nerd);
  return null;
}

/** The installed cooler, for the clock zones. */
export function installedCooler(s: Snapshot): CoolerSpec | undefined {
  const c = s.devices.find((d: DeviceSnap) => d.kind === 'cooler');
  const spec = c ? getSpec(c.spec) : undefined;
  return spec?.kind === 'cooler' ? spec : undefined;
}
