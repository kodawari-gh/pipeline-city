// Pure UI logic: formatting, stats helpers, hint triggers, device descriptions, HUD status text. No DOM, no signals.

import { BOARD_TIERS, getSpec, type DeviceKind, type DeviceSpec } from '../sim/board/specs';
import type { DeviceSnap, Snapshot } from '../sim/game/game';
import { JOB_TYPES, REGIONS, type Description } from './regions';

export const fmtMoney = (n: number) => '$' + Math.floor(n).toLocaleString('en-US');

export function fmtNum(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '-';
}

export function fmtTicks(t: number): string {
  t = Math.max(0, Math.round(t));
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, '0')}s`;
}

export function fmtClock(c: number): string {
  return `${Math.round(c * 100) / 100}x`;
}

export const KIND_LABEL: Record<DeviceKind | 'board', string> = {
  cpu: 'Processor', ram: 'Memory', cooler: 'Cooling', psu: 'Power supply', display: 'Monitor', storage: 'Storage', board: 'Motherboard',
};

export type Level = 'ok' | 'warn' | 'bad';

// ---- stats ----

export const STALL_CAUSES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'stallData', label: 'Waiting on data', hint: 'An instruction waited for an earlier result.' },
  { key: 'stallLoad', label: 'Load-use', hint: 'An instruction needed a value that was still being loaded.' },
  { key: 'stallFlush', label: 'Flush', hint: 'Wrong-path instructions thrown away after a mispredicted branch.' },
  { key: 'stallStruct', label: 'Structural', hint: 'Two stages wanted the memory port at once.' },
  { key: 'stallCache', label: 'Cache miss', hint: 'Pipeline frozen while memory answered a cache miss.' },
];

export function stallsByCause(counters: Record<string, number>) {
  return STALL_CAUSES.map((c) => ({ ...c, value: counters[c.key] ?? 0 }));
}

export const totalStalls = (counters: Record<string, number>) =>
  STALL_CAUSES.reduce((a, c) => a + (counters[c.key] ?? 0), 0);

export function cpiIpc(counters: Record<string, number>): { cpi: number; ipc: number } | null {
  const cyc = counters.cycles ?? 0;
  const ret = counters.retired ?? 0;
  if (cyc <= 0 || ret <= 0) return null;
  return { cpi: cyc / ret, ipc: ret / cyc };
}

export function cacheHitRate(counters: Record<string, number>): number | null {
  const h = counters.cacheHits ?? 0;
  const m = counters.cacheMisses ?? 0;
  return h + m > 0 ? h / (h + m) : null;
}

/** Temperature level from the device's own thermal spec. */
export function tempLevel(tempC: number, spec: DeviceSpec | undefined): Level {
  if (!spec) return 'ok';
  const { throttleC, unstableC } = spec.thermal;
  if (tempC >= unstableC) return 'bad';
  if (tempC >= throttleC - 5) return 'warn';
  return 'ok';
}

export function powerLevel(totalW: number, budgetW: number): Level {
  if (budgetW <= 0) return 'bad';
  const r = totalW / budgetW;
  return r > 1 ? 'bad' : r > 0.85 ? 'warn' : 'ok';
}

/** Live warning under the clock control, or null. */
export function clockWarning(cpu: DeviceSnap | undefined): { level: Level; text: string } | null {
  if (!cpu) return null;
  if (cpu.burnt) return { level: 'bad', text: 'Processor is burnt out. Replace it.' };
  const spec = getSpec(cpu.spec);
  if (!spec) return null;
  const { throttleC, unstableC } = spec.thermal;
  if (cpu.unstable || cpu.tempC >= unstableC) return { level: 'bad', text: 'Unstable: errors are restarting requests. Cool it or slow down.' };
  if (cpu.throttle < 1) return { level: 'warn', text: 'Throttling: too hot, running slower than asked.' };
  if (cpu.tempC >= throttleC - 5) return { level: 'warn', text: 'Getting close to throttling.' };
  return null;
}

// ---- hints ----

export interface Hint { id: string; text: string }

export const HINTS: Record<string, Hint> = {
  stall: { id: 'stall', text: 'A stall: part of the CPU is waiting instead of working. Faster or smarter processors waste fewer cycles.' },
  throttle: { id: 'throttle', text: 'Throttling: the processor is too hot, so it slows itself down. Better cooling or a lower clock helps.' },
  overheat: { id: 'overheat', text: 'Overheating: the processor is making errors and restarting requests. Cool it down before it burns.' },
  queue: { id: 'queue', text: 'Keys are piling up in the tray. Slow answers hurt your reputation, and reputation brings demand.' },
  burnt: { id: 'burnt', text: 'A part burnt out and does nothing now. Buy a replacement of the same kind.' },
  trip: { id: 'trip', text: 'The power supply tripped: too much draw. Power cycle it, then reduce load or buy a bigger supply.' },
  brownout: { id: 'brownout', text: 'The power supply is overloaded, so everything is slowed down. Upgrade it or lower the clock.' },
};

/** Hint ids triggered by this snapshot (ignores whether they were already shown). */
export function triggeredHints(s: Snapshot): string[] {
  const out: string[] = [];
  if (totalStalls(s.counters) > 0) out.push('stall');
  if (s.devices.some((d) => !d.burnt && d.throttle < 1)) out.push('throttle');
  if (s.devices.some((d) => !d.burnt && d.unstable)) out.push('overheat');
  if (s.queueLength >= 3) out.push('queue');
  if (s.devices.some((d) => d.burnt)) out.push('burnt');
  if (s.power.tripped) out.push('trip');
  else if (s.power.psuFactor < 1 && !s.power.off) out.push('brownout');
  return out;
}

/** Hints shown at once. */
export const MAX_TOASTS = 2;

/** Move queued hints into the visible list until `max` are visible. Pure. */
export function fillToasts(visible: Hint[], queue: Hint[], max = MAX_TOASTS): { visible: Hint[]; queue: Hint[] } {
  const room = Math.max(0, max - visible.length);
  return { visible: [...visible, ...queue.slice(0, room)], queue: queue.slice(room) };
}

export function newHints(s: Snapshot, seen: ReadonlySet<string>): Hint[] {
  return triggeredHints(s).filter((id) => !seen.has(id)).map((id) => HINTS[id]!);
}

// ---- descriptions for tooltip / picker ----

export type { Description };

const PLAIN_KIND: Record<DeviceKind, string> = {
  cpu: 'The brain. It runs each request one instruction at a time. Better ones overlap work and run faster.',
  ram: 'Short-term memory. Faster memory hurts less when the processor has to wait for data.',
  cooler: 'Pulls heat off the processor so it can run fast without slowing down or breaking.',
  psu: 'Feeds the whole machine. If parts want more power than it has, everything slows or shuts off.',
  display: 'Shows what the machine is doing. A request is done when its output has appeared here.',
  storage: 'Keeps data between power-ups. Faster drives load the operating system and its jobs sooner.',
};

export function describeSpec(spec: DeviceSpec): Description {
  const bits: string[] = [`tier ${spec.tier}`];
  if (spec.kind === 'cpu') {
    const e = spec.engine;
    if (e.kind === 'unpipelined') bits.push('unpipelined');
    else if (e.kind === 'inorder') {
      bits.push(`5-stage, ${e.forwarding ? 'forwarding' : 'no forwarding'}`);
      if (e.cacheLines) bits.push(`${e.cacheLines}-line cache`);
    }
  }
  if (spec.kind === 'ram') bits.push(`${spec.sizeBytes / 1024}K`, `latency ${spec.latency}`);
  if (spec.kind === 'psu') bits.push(`${spec.watts} W`);
  if (spec.kind === 'cooler') bits.push(`${spec.coolingPerC} W/C`);
  if (spec.clock) bits.push(`clock ${spec.clock.min}-${spec.clock.max} (base ${spec.clock.base})`);
  if (spec.kind !== 'psu') bits.push(`${spec.idleW}-${spec.loadW} W`);
  if (spec.kind === 'cpu' || spec.kind === 'ram' || spec.kind === 'display') {
    bits.push(`throttle ${spec.thermal.throttleC} C, unstable ${spec.thermal.unstableC} C`);
  }
  return { title: spec.name, plain: PLAIN_KIND[spec.kind], nerd: bits.join(' | ') };
}

const SLOT_PLAIN: Record<string, string> = {
  cpu: 'processor socket: drag a processor here',
  dimm: 'memory slot: drag a RAM stick here',
  atx: 'power supply bay: drag a power supply here',
  'atx-plus': 'power supply bay (ATX+): drag a big power supply here',
  cooler: 'cooler mount: sits on the processor',
  display: 'monitor port: drag a monitor here',
  pcie: 'expansion slot (nothing fits yet)',
  sata: 'disk port (nothing fits yet)',
  usb: 'USB port',
};

/**
 * Description for a hovered/selected id: a spec id, a region id, a world id, or (with the snapshot) a slot (empty or
 * occupied), an installed device instance, a crate item or a client key. Unknown ids give null.
 */
export function describeId(id: string, s?: Snapshot | null): Description | null {
  if (s) {
    const slot = s.slots.find((x) => x.id === id);
    if (slot) {
      if (!slot.deviceId) {
        return SLOT_PLAIN[slot.type]
          ? { title: 'Empty socket', plain: 'An empty ' + SLOT_PLAIN[slot.type] + '.', nerd: `slot ${slot.id} | type ${slot.type}` }
          : null;
      }
      const occupant = s.devices.find((d) => d.id === slot.deviceId);
      if (occupant) return describeId(occupant.spec);
    }
    const dev = s.devices.find((d) => d.id === id);
    if (dev) return describeId(dev.spec);
    if (id.startsWith('inv:')) {
      const it = s.inventory.find((x) => x.id === id.slice(4));
      const d = it ? describeId(it.spec) : null;
      return d && { ...d, plain: d.plain + ' In your inventory: drag it into a socket.' };
    }
    if (id.startsWith('key:')) {
      const k = [...s.tray, ...(s.plugged ? [s.plugged] : [])].find((x) => x.id === Number(id.slice(4)));
      if (k) {
        return {
          title: `Client key ${k.label}`,
          plain: (JOB_TYPES[k.type] ?? 'A client job.') + ` Pays about ${fmtMoney(k.payoutEstimate)}.`,
          nerd: `template ${k.template} | arrived t=${k.arrivalTick}, due t=${k.deadlineTick} | tries ${k.attempts}`,
        };
      }
    }
  }
  const spec = getSpec(id);
  if (spec) return describeSpec(spec);
  const tier = /^board([0-9]+)$/.exec(id);
  const bt = tier ? BOARD_TIERS[Number(tier[1])] : undefined;
  if (bt) {
    const slots = Object.entries(bt.slots).map(([k, n]) => `${n} ${k}`).join(', ');
    return {
      title: bt.name,
      plain: 'A bigger motherboard: more sockets, and room for a bigger power supply. Everything you own moves over.',
      nerd: `tier ${bt.tier} | slots: ${slots}`,
    };
  }
  return REGIONS[id] ?? null;
}

// ---- HUD status text ----

export type ChipLevel = 'idle' | 'ok' | 'warn' | 'bad';

/** Short machine status for the HUD chip. */
export function statusChip(s: Snapshot): { text: string; title: string; level: ChipLevel } {
  if (s.power.tripped) return { text: 'Tripped', title: 'The power supply tripped. Power cycle it from the power button.', level: 'bad' };
  switch (s.phase) {
    case 'off': return { text: 'Off', title: s.noPowerReason ?? 'The machine is off.', level: 'idle' };
    case 'posting': return { text: 'POST', title: 'Power-on self-test: the chipset checks the parts.', level: 'ok' };
    case 'waiting-for-key': return { text: 'Waiting for key', title: 'Plug a client key into the USB port.', level: 'warn' };
    case 'loading': return { text: 'Loading', title: 'Copying the job from the key into memory.', level: 'ok' };
    case 'running': return { text: 'Running', title: 'The processor is running the job.', level: 'ok' };
    case 'writing': return { text: 'Writing', title: 'Writing the answer back onto the key.', level: 'ok' };
    case 'done-remove-key': return { text: 'Remove key', title: 'The job is done. Pull the key to get paid.', level: 'warn' };
    case 'error': return { text: `Error: ${s.phaseReason ?? 'stopped'}`, title: s.phaseReason ?? 'The machine stopped.', level: 'bad' };
    case 'booting-os': return { text: 'Booting OS', title: 'Loading the operating system from the drive.', level: 'ok' };
    case 'idle-os': return { text: 'OS idle', title: 'The OS is running and waiting for work.', level: 'warn' };
    case 'ingesting': return { text: 'Ingesting', title: 'The OS is copying a key into its job queue.', level: 'ok' };
    case 'running-os': return { text: 'Running job', title: 'The OS is running a queued job.', level: 'ok' };
    case 'flashing': return { text: 'Flashing', title: 'Writing a result onto the plugged key.', level: 'ok' };
  }
}

/** Keys waiting in the tray (not the plugged one): count and the age of the oldest. */
export function queueReadout(s: Snapshot): { count: number; cap: number; oldest: number | null; late: boolean; text: string } {
  const count = s.tray.length;
  const oldest = count ? Math.max(...s.tray.map((k) => k.age)) : null;
  const late = s.tray.some((k) => k.late);
  const text = count === 0
    ? 'no keys waiting'
    : `${count} key${count === 1 ? '' : 's'} waiting, oldest ${fmtTicks(oldest ?? 0)}`;
  return { count, cap: s.queueCap, oldest, late, text };
}

/**
 * The sim refuses out-of-order actions with "<call>: <reason>". Show just the reason, as a plain sentence.
 */
export function friendlyError(message: string): string {
  const m = /^[a-zA-Z]+: (.*)$/.exec(message);
  const reason = (m ? m[1]! : message).trim();
  return `Not now: ${reason.charAt(0).toUpperCase()}${reason.slice(1)}${/[.!?]$/.test(reason) ? '' : '.'}`;
}
