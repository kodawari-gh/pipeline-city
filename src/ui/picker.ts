// Contextual part picker, pure logic: what the side card shows for the selected id. No DOM, no signals.
// The card opens only when the renderer selects something (`selected`). Parts are placed by dragging from the
// inventory tray (or the world); the card offers purchases (into the inventory), the clock, power and job actions.

import { AMBIENT_C, BOARD_TIERS, getSpec, specsOfKind, type CoolerSpec, type CpuSpec, type DeviceKind, type DeviceSpec } from '../sim/board/specs';
import { ECONOMY } from '../sim/game/economy';
import type { DeviceSnap, KeySnap, Snapshot } from '../sim/game/game';
import { getOsSpec, OS_SPECS } from '../sim/os';
import { clockWarning, describeId, fmtMoney, fmtTicks, KIND_LABEL, type Level, statusChip } from './logic';
import { JOB_TYPES } from './regions';

/** The storage block size (bytes), as in the sim's storage device. */
const BLOCK_BYTES = 256;

export type PickerKind = DeviceKind | 'board' | 'os' | 'key' | 'tray' | 'power' | 'usb' | 'info';
export type BuyState = 'ready' | 'poor' | 'blocked';
export type IconName = 'bolt' | 'flame' | 'clock' | 'dollar' | 'memory' | 'cpu' | 'lock' | 'check' | 'box' | 'fan' | 'slot' | 'warn' | 'gauge';

export interface PickerLine { level: Level | 'info'; text: string }

export interface PickerAction {
  id: 'power' | 'powerCycle' | 'plug' | 'eject' | 'uninstallOs';
  label: string;
  keyId?: number;
  primary?: boolean;
  /** Disabled reason, when the action is shown but cannot be taken now. */
  why?: string;
}

/** One numeric property of a part, for the bars. `value` is in `unit`; bars use `goodness` (0..1). */
export interface Stat {
  key: string;
  label: string;
  icon: IconName;
  value: number;
  unit: string;
  higherIsBetter: boolean;
}

/** One rung of the upgrade ladder for a kind of part. */
export type LadderState = 'installed' | 'crate' | 'ready' | 'poor' | 'blocked' | 'locked';
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
  /** Installed device instance id, for the installed rung. */
  devId?: string;
  /** Inventory item id, for the crate rung. */
  invId?: string;
}

export interface PickerModel {
  id: string;
  kind: PickerKind;
  title: string;
  plain: string;
  nerd: string;
  /** Upgrade ladder for part kinds: owned, next and blocked rungs (older tiers are left out). */
  ladder: LadderStep[];
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
}

export interface OsQueueRow { keyId: number; label: string; type: string; state: string; text: string }
export interface OsHeldRow { keyId: number; label: string; hint: string }
/** The OS block of a card: what the OS is doing, its queue, held keys, the host drive and the later tiers. */
export interface OsSection {
  name: string;
  tier: number;
  status: string;
  level: Level | 'info';
  programSlots: number;
  queueSlots: number;
  running: string | null;
  queue: OsQueueRow[];
  held: OsHeldRow[];
  host: { slot: string; usedK: number; capK: number } | null;
  ladder: LadderStep[];
}

/** Plain job type for a key id from anywhere the machine holds it (tray, held, plugged). */
const keyType = (s: Snapshot, id: number): string =>
  [...s.tray, ...s.held, ...(s.plugged ? [s.plugged] : [])].find((k) => k.id === id)?.type ?? '';

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
    text: j.state === 'running' ? 'running now'
      : j.state === 'result' ? 'done, waiting for you'
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
    held: s.held.map((k) => ({
      keyId: k.id,
      label: k.label,
      hint: k.stage === 'result' ? `plug key ${k.id} again to collect` : 'waiting in the OS queue',
    })),
    host: host ? { slot: host.slot, usedK: Math.round(host.usedBytes / 1024), capK: Math.round(host.capacityBytes / 1024) } : null,
    ladder: ladderFor(s, 'os'),
  };
}

/** Relative throughput per base clock tick, by engine. A placeholder guess like the other balance numbers. */
export function ipcGuess(e: CpuSpec['engine']): number {
  if (e.kind === 'unpipelined') return 0.2;
  if (e.kind === 'inorder') return e.forwarding ? 0.8 : 0.55;
  return 1;
}

/** Board ids in the board ladder, one per tier. */
export const boardId = (tier: number) => `board${tier}`;

/** Every spec id of a kind, ordered by tier (or the board tiers). */
export function catalogOf(kind: PickerKind): string[] {
  if (kind === 'board') return BOARD_TIERS.map((b) => boardId(b.tier));
  if (kind === 'cpu' || kind === 'ram' || kind === 'psu' || kind === 'cooler' || kind === 'display' || kind === 'storage') {
    return specsOfKind(kind).map((x) => x.id);
  }
  if (kind === 'os') return OS_SPECS.map((o) => o.id);
  return [];
}

/** Sustained throughput of a drive at its base clock, bytes per second (the same model as the sim's storage device). */
export function drivePerSecond(spec: { clock: { base: number }; blockTicks: number }): number {
  return Math.round((spec.clock.base * ECONOMY.cpuCyclesPerClock * BLOCK_BYTES) / spec.blockTicks);
}

/** Numeric stats of a spec (or a board tier). Empty for an unknown id. */
export function statsOf(specId: string): Stat[] {
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
  const spec = getSpec(specId);
  if (!spec) return [];
  switch (spec.kind) {
    case 'cpu': return [
      { key: 'speed', label: 'Speed', icon: 'clock', value: Math.round(spec.clock.base * ipcGuess(spec.engine) * 100) / 100, unit: '', higherIsBetter: true },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
    case 'ram': return [
      { key: 'size', label: 'Memory', icon: 'memory', value: spec.sizeBytes / 1024, unit: 'K', higherIsBetter: true },
      { key: 'latency', label: 'Latency', icon: 'gauge', value: spec.latency, unit: 'ticks', higherIsBetter: false },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
    case 'psu': return [{ key: 'watts', label: 'Capacity', icon: 'bolt', value: spec.watts, unit: 'W', higherIsBetter: true }];
    case 'cooler': return [
      { key: 'cooling', label: 'Heat removal', icon: 'flame', value: spec.coolingPerC, unit: 'W/C', higherIsBetter: true },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
    case 'display': return [{ key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false }];
    case 'vrm-sink': return [{ key: 'cooling', label: 'Heat removal', icon: 'flame', value: spec.coolingPerC, unit: 'W/C', higherIsBetter: true }];
    case 'storage': return [
      { key: 'size', label: 'Capacity', icon: 'memory', value: spec.capacityBytes / 1024, unit: 'K', higherIsBetter: true },
      { key: 'latency', label: 'Latency', icon: 'gauge', value: spec.latencyTicks, unit: 'ticks', higherIsBetter: false },
      { key: 'throughput', label: 'Throughput', icon: 'clock', value: drivePerSecond(spec), unit: 'B/s', higherIsBetter: true },
      { key: 'power', label: 'Power', icon: 'bolt', value: spec.loadW, unit: 'W', higherIsBetter: false },
    ];
  }
}

/** Bar length for one stat: 1 for the best part of its kind, less for the rest (0..1). */
export function goodness(kind: PickerKind, key: string, value: number, higherIsBetter: boolean): number {
  const vals = catalogOf(kind).flatMap((id) => statsOf(id).filter((x) => x.key === key).map((x) => x.value)).filter((v) => v > 0);
  if (!vals.length || value <= 0) return 0;
  const best = higherIsBetter ? Math.max(...vals) : Math.min(...vals);
  const g = higherIsBetter ? value / best : best / value;
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
      const e = spec.engine;
      const arch = e.kind === 'unpipelined'
        ? 'one step at a time'
        : e.kind === 'inorder' && e.forwarding ? '5-stage, forwarding' : '5-stage, no forwarding';
      const clk = spec.clock ? `, ${spec.clock.base}x base clock (max ${spec.clock.max}x)` : '';
      return arch + clk;
    }
    case 'ram': return `${spec.sizeBytes / 1024}K, latency ${spec.latency}`;
    case 'psu': return `${spec.watts} W${spec.slot === 'atx-plus' ? ', needs ATX+ board' : ''}`;
    case 'cooler': return `${spec.coolingPerC} W/C cooling`;
    case 'display': return 'text monitor';
    case 'storage': return `${spec.capacityBytes / 1024}K, ${spec.slot === 'm2' ? 'M.2' : 'SATA'}`;
    case 'vrm-sink': return `${spec.coolingPerC} W/C cooling for the VRM`;
  }
}

const SLOT_KIND: Record<string, DeviceKind> = {
  cpu: 'cpu', dimm: 'ram', atx: 'psu', 'atx-plus': 'psu', cooler: 'cooler', display: 'display', sata: 'storage', m2: 'storage',
};
const WORLD_KIND: Record<string, DeviceKind | 'board' | 'os'> = { psu: 'psu', monitor: 'display', 'psu.readout': 'psu', board: 'board', bay: 'storage', os: 'os' };

/** The kind a selected id stands for, if any (slot, device, inventory item, spec id, world object or board tier). */
export function kindOf(id: string, s: Snapshot): DeviceKind | 'board' | 'os' | null {
  const slot = s.slots.find((x) => x.id === id);
  if (slot) return SLOT_KIND[slot.type] ?? null;
  const dev = s.devices.find((d) => d.id === id);
  if (dev) return dev.kind;
  if (id.startsWith('inv:')) {
    const it = s.inventory.find((x) => x.id === id.slice(4));
    return it ? it.kind : null;
  }
  if (WORLD_KIND[id]) return WORLD_KIND[id]!;
  const spec = getSpec(id);
  if (spec) return spec.kind;
  if (getOsSpec(id)) return 'os';
  if (/^board[0-9]+$/.test(id)) return 'board';
  return null;
}

/**
 * The upgrade ladder for a kind: installed and inventory rungs, then each tier the sim offers (ready, poor, blocked).
 * Tiers older than the best part you own are left out; tiers the sim does not offer and you do not own are `locked`.
 */
export function ladderFor(s: Snapshot, kind: PickerKind): LadderStep[] {
  const installed: Array<{ spec: string; devId: string }> = kind === 'board'
    ? [{ spec: boardId(s.boardTier), devId: '' }]
    : kind === 'os'
      ? (s.os ? [{ spec: s.os.spec, devId: '' }] : [])
      : s.devices.filter((d) => d.kind === kind).map((d) => ({ spec: d.spec, devId: d.id }));
  const crate = kind === 'board' ? [] : s.inventory.filter((i) => i.kind === kind);
  const tierOf = (id: string) => (kind === 'board' ? Number(id.slice(5)) : getSpec(id)?.tier ?? getOsSpec(id)?.tier ?? -1);
  const ownedMax = Math.max(-1, ...installed.map((x) => tierOf(x.spec)), ...crate.map((x) => tierOf(x.spec)));
  const nameOf = (id: string) => (kind === 'board' ? BOARD_TIERS[Number(id.slice(5))]?.name : getSpec(id)?.name ?? getOsSpec(id)?.name) ?? id;
  const out: LadderStep[] = [];
  for (const id of catalogOf(kind)) {
    const tier = tierOf(id);
    const name = nameOf(id);
    const inst = installed.find((x) => x.spec === id);
    if (inst) { out.push({ specId: id, name, tier, state: 'installed', devId: inst.devId || undefined }); continue; }
    const inv = crate.find((x) => x.spec === id);
    if (inv) {
      // A spare that the sim will not fit right now says why (memory minimum, free capacity, no slot); otherwise it can go in.
      const reason = inv.installable ? 'In your inventory: drag it onto its socket' : inv.reason ?? 'Nothing to fit it to right now';
      out.push({ specId: id, name, tier, state: 'crate', invId: inv.id, reason });
      continue;
    }
    if (tier < ownedMax) continue;
    const p = s.purchases.find((x) => x.id === id);
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
  return out;
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
  ];
}

/** Every key the machine knows about: tray plus the plugged one. */
export function allKeys(s: Snapshot): KeySnap[] {
  return [...s.tray, ...(s.plugged ? [s.plugged] : [])];
}

const powerStatus = (s: Snapshot) => (s.powered ? `Status: ${s.phase.replace(/-/g, ' ')}` : 'Status: off');

function emptyCard(id: string, kind: PickerKind, title: string, plain: string, nerd: string): PickerModel {
  return { id, kind, title, plain, nerd, ladder: [], current: null, focus: null, lines: [], actions: [], clock: false };
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
    if (k.done) lines.push({ level: 'ok', text: `Result: ${k.result}` });
    return {
      ...emptyCard(id, 'key', `Client key ${k.label}`, d.plain, d.nerd), lines,
      actions: plugged
        ? [{ id: 'eject', label: k.done ? 'Remove key (get paid)' : 'Remove key', keyId: k.id, primary: k.done }]
        : [{ id: 'plug', label: 'Plug into USB', keyId: k.id, primary: true, why: s.plugged ? 'A key is already plugged in' : undefined }],
    };
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
      actions: k ? [{ id: 'eject', label: k.done ? 'Remove key (get paid)' : 'Remove key', keyId: k.id, primary: k.done }] : [],
    };
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
    const title = emptySocket
      ? `${KIND_LABEL[kind]} socket`
      : dev ? dev.name : d.title;
    return {
      ...emptyCard(id, kind, title, d.plain, d.nerd),
      // With an OS installed, its ladder is in the OS section; the bay offers the systems while none is installed.
      ladder: sec && kind === 'os' ? [] : ladder,
      osSection: sec,
      shelf: id === 'bay' && !s.os ? ladderFor(s, 'os') : undefined,
      current, lines, actions,
      // A spec id that is neither a slot nor a fitted part (a shop or ladder item) is the comparison to show.
      focus: invItem ? invItem.spec : !slot && !dev && (getSpec(id) || getOsSpec(id)) ? id : null,
      device: emptySocket ? undefined : dev,
      clock: kind === 'cpu' && !!s.cpuClock && !!dev && !dev.burnt,
      emptyText: ladder.some((r) => r.state === 'ready' || r.state === 'poor' || r.state === 'blocked') ? undefined : 'Nothing better to buy right now.',
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
