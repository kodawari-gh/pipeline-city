// Contextual part picker, pure logic: what the side card shows for the selected id. No DOM, no signals.
// The card opens only when the renderer selects something (`selected`). Parts and cables are placed by dragging in
// the world; the card only offers purchases (into the crate), the clock, power actions and job actions.

import { getSpec, type DeviceKind, type DeviceSpec } from '../sim/board/specs';
import type { DeviceSnap, KeySnap, Snapshot } from '../sim/game/game';
import { clockWarning, describeId, fmtMoney, fmtTicks, KIND_LABEL, type Level } from './logic';
import { JOB_TYPES } from './regions';

export type PickerKind = DeviceKind | 'board' | 'crate' | 'key' | 'tray' | 'power' | 'usb' | 'info';
export type BuyState = 'ready' | 'poor' | 'blocked';

export interface PickerRow {
  /** Spec id (installed or upgrade) or inventory id (crate). */
  id: string;
  name: string;
  /** Tier, for upgrades and parts. */
  tier?: number;
  /** One line of key stats. */
  brief: string;
  tag: 'installed' | 'crate' | 'upgrade';
  /** Upgrade price and buy state (upgrades only). */
  price?: number;
  state?: BuyState;
  /** Why it cannot be bought now, or why an installed part is flagged. */
  reason?: string;
}

export interface PickerLine { level: Level | 'info'; text: string }

export interface PickerAction {
  id: 'power' | 'powerCycle' | 'plug' | 'eject';
  label: string;
  keyId?: number;
  primary?: boolean;
  /** Disabled reason, when the action is shown but cannot be taken now. */
  why?: string;
}

export interface PickerModel {
  id: string;
  kind: PickerKind;
  title: string;
  plain: string;
  nerd: string;
  rows: PickerRow[];
  /** Shown under the rows when there is nothing to list. */
  emptyText?: string;
  lines: PickerLine[];
  actions: PickerAction[];
  /** Show the CPU clock control. */
  clock: boolean;
  /** Installed device, for live readings and the clock. */
  device?: DeviceSnap;
}

/** One line of key stats for a spec. */
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
  }
}

const SLOT_KIND: Record<string, DeviceKind> = {
  cpu: 'cpu', dimm: 'ram', atx: 'psu', 'atx-plus': 'psu', cooler: 'cooler', display: 'display',
};
const WORLD_KIND: Record<string, DeviceKind | 'board'> = { psu: 'psu', monitor: 'display', 'psu.readout': 'psu', board: 'board' };

/** The kind a selected id stands for, if any (slot, device, crate item, spec id, world object or board tier). */
export function kindOf(id: string, s: Snapshot): DeviceKind | 'board' | null {
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
  if (/^board[0-9]+$/.test(id)) return 'board';
  return null;
}

function upgradeRows(s: Snapshot, kind: DeviceKind | 'board'): PickerRow[] {
  const rows: PickerRow[] = [];
  for (const d of s.devices.filter((x) => x.kind === kind)) {
    const spec = getSpec(d.spec);
    rows.push({ id: d.spec, name: d.name, tier: spec?.tier, brief: spec ? specBrief(spec) : '', tag: 'installed', reason: d.burnt ? 'burnt out' : undefined });
  }
  for (const it of s.inventory.filter((x) => x.kind === kind)) {
    const spec = getSpec(it.spec);
    rows.push({ id: it.id, name: it.name, tier: spec?.tier, brief: spec ? specBrief(spec) : '', tag: 'crate', reason: 'in the crate: drag it onto a socket' });
  }
  const ups = s.purchases.filter((p) => p.kind === kind).sort((a, b) => a.price - b.price);
  for (const p of ups) {
    const spec = getSpec(p.id);
    const state: BuyState = p.blocked ? 'blocked' : p.affordable ? 'ready' : 'poor';
    rows.push({
      id: p.id, name: p.name, tier: spec?.tier, brief: spec ? specBrief(spec) : 'bigger board, more sockets',
      tag: 'upgrade', price: p.price, state,
      reason: p.blocked ?? (p.affordable ? undefined : `Need ${fmtMoney(p.price - s.money)} more`),
    });
  }
  return rows;
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
  return { id, kind, title, plain, nerd, rows: [], lines: [], actions: [], clock: false };
}

/** The picker card for a selected id, or null when there is nothing to show. */
export function pickerFor(id: string | null, s: Snapshot | null): PickerModel | null {
  if (!id || !s) return null;

  if (id === 'crate') {
    const d = describeId('crate')!;
    const rows: PickerRow[] = s.inventory.map((it) => {
      const spec = getSpec(it.spec);
      return { id: it.id, name: it.name, tier: spec?.tier, brief: spec ? specBrief(spec) : '', tag: 'crate', reason: 'drag it onto a socket' };
    });
    return {
      ...emptyCard(id, 'crate', `${d.title} (${s.inventory.length})`, d.plain, d.nerd), rows,
      emptyText: 'The crate is empty. Buy a part from the upgrade list on any part on the board.',
      lines: s.inventory.length
        ? [{ level: 'info', text: 'Drag a part onto its socket. Parts only change while the machine is off.' }]
        : [],
    };
  }

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
    if (s.powered && s.postBlocker) lines.push({ level: 'bad', text: `Self-test fails: ${s.postBlocker}` });
    if (s.phase === 'error' && s.phaseReason) lines.push({ level: 'bad', text: s.phaseReason });
    const actions: PickerAction[] = [];
    if (s.power.tripped) {
      lines.unshift({ level: 'bad', text: 'The power supply tripped: too much draw. Power cycle it, then lighten the load or buy a bigger supply.' });
      actions.push({ id: 'powerCycle', label: 'Power cycle', primary: true });
    }
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
      ? [{ level: 'info', text: `${k.label}: ${k.done ? 'finished, ready to hand back' : s.phase.replace(/-/g, ' ')}` }, ...keyLines(k, s.baseTick).slice(1)]
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
    // A slot id: empty socket, or the part in it. A device id, a spec id, a crate item or a world object otherwise.
    const slot = s.slots.find((x) => x.id === id);
    const dev = slot?.deviceId
      ? s.devices.find((d) => d.id === slot.deviceId)
      : WORLD_KIND[id] ? s.devices.find((d) => d.kind === kind)
      : s.devices.find((d) => d.id === id) ?? s.devices.find((d) => d.spec === id);
    const emptySocket = !!slot && !slot.deviceId;
    const d = (dev && !emptySocket ? describeId(dev.spec) : describeId(id, s))
      ?? describeId(id)
      ?? { title: KIND_LABEL[kind], plain: '', nerd: '' };
    const rows = upgradeRows(s, kind);
    const lines: PickerLine[] = [];
    if (emptySocket) lines.push({ level: 'info', text: 'Empty socket. Drag a matching part from the crate onto it.' });
    if (s.powered && rows.some((r) => r.tag !== 'installed')) lines.push({ level: 'info', text: 'Power the machine off to swap parts.' });
    const actions: PickerAction[] = [];
    if (kind === 'psu') {
      const p = s.power;
      lines.push({
        level: p.tripped ? 'bad' : p.totalW > p.budgetW * 0.85 ? 'warn' : 'info',
        text: `Load ${p.totalW.toFixed(0)} W of ${p.budgetW.toFixed(0)} W${p.tripped ? ' (tripped)' : ''}`,
      });
      if (p.tripped) actions.push({ id: 'powerCycle', label: 'Power cycle', primary: true });
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
      rows, lines, actions,
      device: emptySocket ? undefined : dev,
      clock: kind === 'cpu' && !!s.cpuClock && !!dev && !dev.burnt,
      emptyText: rows.some((r) => r.tag === 'upgrade') ? undefined : 'Nothing better to buy right now.',
    };
  }

  const desc = describeId(id, s);
  if (desc) return emptyCard(id, 'info', desc.title, desc.plain, desc.nerd);
  return null;
}
