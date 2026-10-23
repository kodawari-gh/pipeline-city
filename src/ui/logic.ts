// Pure UI logic: formatting, shop grouping, hint triggers, device descriptions. No DOM, no signals.

import { getSpec, type DeviceKind, type DeviceSpec } from '../sim/board/specs';
import type { DeviceSnap, PurchaseSnap, Snapshot } from '../sim/game/game';

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

export const KIND_ORDER: DeviceKind[] = ['cpu', 'ram', 'cooler', 'psu', 'display'];
export const KIND_LABEL: Record<DeviceKind, string> = {
  cpu: 'Processor', ram: 'Memory', cooler: 'Cooling', psu: 'Power supply', display: 'Display',
};

export type ShopState = 'ready' | 'poor' | 'blocked';
export interface ShopItem extends PurchaseSnap { state: ShopState; reason: string; pending: boolean }
export interface ShopGroup { kind: DeviceKind; label: string; items: ShopItem[] }

/** Group purchases by device kind (stable kind order, cheapest first) with a state and hover reason. */
export function groupPurchases(purchases: PurchaseSnap[], pending: string[] = [], money = 0): ShopGroup[] {
  const groups: ShopGroup[] = [];
  for (const kind of KIND_ORDER) {
    const items = purchases
      .filter((p) => p.kind === kind)
      .sort((a, b) => a.price - b.price)
      .map<ShopItem>((p) => {
        const state: ShopState = p.blocked ? 'blocked' : p.affordable ? 'ready' : 'poor';
        const reason = p.blocked ?? (p.affordable ? '' : `Need ${fmtMoney(p.price - money)} more`);
        return { ...p, state, reason, pending: pending.includes(p.id) };
      });
    if (items.length) groups.push({ kind, label: KIND_LABEL[kind], items });
  }
  return groups;
}

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

export type Level = 'ok' | 'warn' | 'bad';

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
  queue: { id: 'queue', text: 'Requests are piling up. Slow answers hurt your reputation, and reputation brings demand.' },
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

/** Hints to show now: triggered and not yet seen. */
export function newHints(s: Snapshot, seen: ReadonlySet<string>): Hint[] {
  return triggeredHints(s).filter((id) => !seen.has(id)).map((id) => HINTS[id]!);
}

// ---- descriptions for tooltip / device panel ----

export interface Description { title: string; plain: string; nerd: string }

const PLAIN_KIND: Record<DeviceKind, string> = {
  cpu: 'The brain. It runs each request one instruction at a time. Better ones overlap work and run faster.',
  ram: 'Short-term memory. Faster memory hurts less when the processor has to wait for data.',
  cooler: 'Pulls heat off the processor so it can run fast without slowing down or breaking.',
  psu: 'Feeds the whole machine. If parts want more power than it has, everything slows or shuts off.',
  display: 'Shows the result of each request. A request is done when its output has appeared here.',
};

const REGIONS: Record<string, Description> = {
  board: {
    title: 'Motherboard',
    plain: 'Everything plugs into this. Each part has its own socket.',
    nerd: 'Mini board: 1 CPU, 2 DIMM, 1 ATX, 1 cooler, 1 display slot. Bigger boards cost more.',
  },
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

/** Description for a hovered/selected id: a spec id, a region id, or unknown (null). */
export function describeId(id: string): Description | null {
  const spec = getSpec(id);
  if (spec) return describeSpec(spec);
  return REGIONS[id] ?? null;
}

/** Live device reading for a spec id or device instance id, if that part is installed. */
export function liveDevice(s: Snapshot | null, id: string): DeviceSnap | undefined {
  return s?.devices.find((d) => d.spec === id || d.id === id);
}
