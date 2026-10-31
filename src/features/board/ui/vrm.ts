// Motherboard, VRM and heatsink readouts for the UI (docs/VRM.md, docs/UI.md). Pure: numbers come from the snapshot and
// the spec data, no DOM, no signals. All sim numbers are placeholders, so these readouts are placeholders too.

import { BOARD_TIERS, getSpec, type RamSpec, type VrmSinkSpec } from '../sim/specs';
import { currentDemand, loadRatio, ramDemand, VRM_OVERLOAD } from '../sim/vrm';
import type { Snapshot } from '@/worker/game/game';
import { isNextLevelLock, lockOf, lockTooltip, moreOffer, type LevelLock, type MoreOffer } from '../../economy/ui/progress/levelui';
import { fmtMoney, type Level } from '@/core/ui/logic';

/** Above this share of the phases' rating the VRM is "working hard" (the efficiency curve starts to fall here). */
export const VRM_BUSY_RATIO = 0.6;

export type VrmZone = 'safe' | 'busy' | 'overload';
export const VRM_ZONE_WORD: Record<VrmZone, string> = { safe: 'Safe', busy: 'Working hard', overload: 'Overload' };
export const VRM_ZONE_HELP: Record<VrmZone, string> = {
  safe: 'Well under the phases\' rating: cool and steady.',
  busy: 'Past 60% of the rating: the switching parts waste more power and run hotter.',
  overload: 'Past the rating: the voltage sags and wobbles, errors start, and the board heats fast.',
};

/** Zone of a load ratio (demand over the phases' rating; 1 = every phase at its rated current). */
export function vrmZone(ratio: number): VrmZone {
  if (ratio > VRM_OVERLOAD) return 'overload';
  if (ratio >= VRM_BUSY_RATIO) return 'busy';
  return 'safe';
}

/** Which regulator a readout is about: the processor's or the memory's. */
export type VrmRail = 'cpu' | 'ram';

/** Everything the VRM readout shows, from `snapshot.board`. */
export interface VrmReadout {
  rail: VrmRail;
  burnt: boolean;
  tempC: number;
  throttleC: number;
  unstableC: number;
  damageC: number;
  phases: number;
  ampsPerPhase: number;
  capacityA: number;
  demandA: number;
  loadRatio: number;
  /** The load bar runs to at least 1.5 of rating, so the overload zone is visible. */
  barMax: number;
  zone: VrmZone;
  efficiency: number;
  /** Factor on the CPU clock from the VRM's own heat, [0.8, 1]. */
  throttle: number;
  unstable: boolean;
  /** Chance per busy tick of a voltage-droop crash. */
  errProb: number;
  /** Heat the regulator makes right now, W. */
  lossW: number;
  ripple: number;
  tempLevel: Level;
  sink: { name: string; coolingPerC: number } | null;
}

/** The VRM readout, or null for a snapshot without a board (never produced by the sim; kept for old fixtures). */
export function vrmReadout(s: Snapshot, rail: VrmRail = 'cpu'): VrmReadout | null {
  const b = s.board;
  if (!b) return null;
  const v = rail === 'ram' ? b.ramVrm : b.vrm;
  const sinkDev = rail === 'ram' ? b.ramSink : b.vrmSink;
  const capacityA = v.phases * v.ampsPerPhase;
  const sinkSpec = sinkDev ? getSpec(sinkDev.spec) as VrmSinkSpec | undefined : undefined;
  const tempLevel: Level = v.burnt || v.tempC >= v.unstableC ? 'bad' : v.tempC >= v.throttleC - 5 ? 'warn' : 'ok';
  return {
    rail,
    burnt: v.burnt,
    tempC: v.tempC,
    throttleC: v.throttleC,
    unstableC: v.unstableC,
    damageC: v.damageC,
    phases: v.phases,
    ampsPerPhase: v.ampsPerPhase,
    capacityA,
    demandA: v.loadRatio * capacityA,
    loadRatio: v.loadRatio,
    barMax: Math.max(1.5, v.loadRatio),
    zone: vrmZone(v.loadRatio),
    efficiency: v.efficiency,
    throttle: v.throttle,
    unstable: v.unstable,
    errProb: v.errProb,
    lossW: rail === 'ram' ? v.heatW : s.power.vrmLossW !== undefined ? s.power.vrmLossW - b.ramVrm.heatW : v.heatW,
    ripple: v.ripple,
    tempLevel,
    sink: sinkDev && sinkSpec && (sinkSpec.kind === 'vrm-sink' || sinkSpec.kind === 'ram-sink') ? { name: sinkSpec.name.split(' (')[0]!, coolingPerC: sinkSpec.coolingPerC } : null,
  };
}

/** Plain-words status lines for the VRM card. */
export function vrmLines(v: VrmReadout): Array<{ level: Level | 'info'; text: string }> {
  const out: Array<{ level: Level | 'info'; text: string }> = [];
  if (v.burnt) {
    out.push({ level: 'bad', text: 'The VRM burnt out, so the board is dead. Power off and buy a board of the same tier to replace it.' });
    return out;
  }
  const mem = v.rail === 'ram';
  if (v.unstable) out.push({ level: 'bad', text: `Unstable: the ${mem ? 'memory ' : ''}regulator is overloaded or too hot, so the machine can crash. Slow the ${mem ? 'memory ' : ''}clock or add a ${mem ? 'RAM ' : ''}VRM heatsink.` });
  else if (v.zone === 'busy') out.push({ level: 'warn', text: 'Working hard: most of its rating is in use. Keep the clock near stock.' });
  if (v.throttle < 1) out.push({ level: 'warn', text: `Throttling: the regulator is too hot, so the ${mem ? 'memory' : 'processor'} is held back.` });
  if (!v.sink) out.push({ level: 'info', text: mem ? 'No RAM VRM heatsink. A small one on the board cools the memory regulator.' : 'No VRM heatsink. A small one on the board cools the regulator.' });
  return out;
}

/** Slot counts shown on a board card, with the icon that stands for each. */
export type BoardSlotIcon = 'cpu' | 'memory' | 'slot' | 'disk' | 'fan' | 'bolt';
export interface BoardSlotCount { key: string; label: string; count: number; icon: BoardSlotIcon }

export type BoardCardState = 'installed' | 'dead' | 'crate' | 'ready' | 'poor' | 'blocked' | 'locked' | 'level';

/** One motherboard tier as a card: slots, features, VRM strength with before/after bars, price and the state. */
export interface BoardCard {
  tier: number;
  id: string;
  name: string;
  state: BoardCardState;
  price: number;
  /** Sandbox: nothing is paid. */
  free: boolean;
  /** Why it cannot be taken now (blocked, poor, locked, crate), for the tooltip. */
  reason?: string;
  /** State `level`: the player level that opens this tier, and whether it is the very next one. */
  lock?: LevelLock;
  soon?: boolean;
  /** Copies of this board in the inventory. */
  spares?: number;
  /** Buying another: set on a fitted or spare card. */
  more?: MoreOffer;
  /** The buy (or replace) button is live: the sim offers it, nothing blocks it and it is affordable. */
  canBuy: boolean;
  slots: BoardSlotCount[];
  ethernetMbps: number;
  usbPorts: number;
  displayPorts: number;
  phases: number;
  ampsPerPhase: number;
  /** Total current the phases can deliver, A. */
  totalA: number;
  peakEfficiency: number;
  ripple: number;
  /** The memory regulator of this tier. */
  ramPhases: number;
  ramAmpsPerPhase: number;
  ramTotalA: number;
  /** Bar lengths 0..1 against the strongest tier: the installed board (grey) and this tier (coloured). */
  curBar: number;
  optBar: number;
  trend: 'better' | 'worse' | 'same';
  deltaText: string;
}

const SLOT_LABELS: Array<{ key: string; label: string; icon: BoardSlotIcon }> = [
  { key: 'cpu', label: 'processor sockets', icon: 'cpu' },
  { key: 'dimm', label: 'memory slots', icon: 'memory' },
  { key: 'pcie', label: 'expansion (PCIe) slots', icon: 'slot' },
  { key: 'sata', label: 'drive bays (SATA)', icon: 'disk' },
  { key: 'm2', label: 'M.2 slots (fast drives)', icon: 'disk' },
  { key: 'vrm-sink', label: 'VRM heatsink slots', icon: 'fan' },
  { key: 'ram-sink', label: 'memory VRM heatsink slots', icon: 'fan' },
  { key: 'atx-plus', label: 'big power connector (ATX+)', icon: 'bolt' },
];

const phaseAmps = (t: { vrm: { phases: number; ampsPerPhase: number } }) => t.vrm.phases * t.vrm.ampsPerPhase;

/** Cards for every board tier: the installed one, the spares you own and each tier the shop sells (smaller ones too: a downgrade, a second machine). */
export function boardCards(s: Snapshot): BoardCard[] {
  const cur = s.boardTier;
  const burnt = !!s.board?.burnt;
  const maxA = Math.max(...BOARD_TIERS.map(phaseAmps));
  const curA = phaseAmps(BOARD_TIERS[cur] ?? BOARD_TIERS[0]!);
  const out: BoardCard[] = [];
  for (const t of BOARD_TIERS) {
    const id = `board${t.tier}`;
    const p = s.purchases.find((x) => x.id === id);
    const copies = s.inventory.filter((i) => i.spec === id);
    const crate = copies[0];
    const price = p?.price ?? t.price;
    const free = s.sandbox;
    const canAfford = free || (p ? p.affordable : false);
    const lock = lockOf(s, id, p);
    let state: BoardCardState;
    let reason: string | undefined;
    if (t.tier === cur) {
      state = burnt ? 'dead' : 'installed';
      if (burnt) reason = p?.blocked ?? (canAfford ? undefined : `Need ${fmtMoney(price - s.money)} more`);
      else reason = 'Fitted in the machine';
    } else if (crate) {
      state = 'crate';
      reason = 'In your inventory: drag it onto the board';
    } else if (lock) {
      state = 'level';
      reason = lockTooltip(lock, { blocked: p?.blocked, priceShort: p && !s.sandbox ? price - s.money : 0 });
    } else if (p?.later) {
      state = 'locked';
      reason = p.description ?? 'Not available yet';
    } else if (p) {
      if (p.blocked) { state = 'blocked'; reason = p.blocked; }
      else if (canAfford) state = 'ready';
      else { state = 'poor'; reason = `Need ${fmtMoney(price - s.money)} more`; }
    } else {
      state = 'locked';
      reason = 'Not available yet';
    }
    const a = phaseAmps(t);
    const trend: BoardCard['trend'] = a === curA ? 'same' : a > curA ? 'better' : 'worse';
    const diff = a - curA;
    out.push({
      tier: t.tier,
      id,
      name: t.name,
      state,
      price,
      free,
      reason,
      lock,
      spares: copies.length || undefined,
      more: p && !p.later && (state === 'installed' || state === 'crate') ? moreOffer(s, p, lock) : undefined,
      soon: isNextLevelLock(lock, s.level.level),
      canBuy: (state === 'ready' || state === 'dead') && !!p && !p.blocked && canAfford,
      slots: SLOT_LABELS
        .map((x) => ({ key: x.key, label: x.label, icon: x.icon, count: t.slots[x.key as keyof typeof t.slots] ?? 0 }))
        .filter((x) => x.count > 0),
      ethernetMbps: t.features.ethernetMbps,
      usbPorts: t.features.usbPorts,
      displayPorts: t.features.displayPorts,
      phases: t.vrm.phases,
      ampsPerPhase: t.vrm.ampsPerPhase,
      totalA: a,
      peakEfficiency: t.vrm.peakEfficiency,
      ripple: t.vrm.ripple,
      ramPhases: t.ramVrm.phases,
      ramAmpsPerPhase: t.ramVrm.ampsPerPhase,
      ramTotalA: t.ramVrm.phases * t.ramVrm.ampsPerPhase,
      curBar: curA / maxA,
      optBar: a / maxA,
      trend,
      deltaText: diff === 0 ? 'same' : `${diff > 0 ? '+' : '-'}${Math.abs(diff)} A`,
    });
  }
  return out;
}

/** The motherboard tier the sim would plan: the installed one, or a bigger board in the inventory. */
export function plannedBoardTier(s: Snapshot): number {
  let tier = s.boardTier;
  for (const i of s.inventory) {
    if (i.kind !== 'board') continue;
    const n = Number(i.spec.slice(5));
    if (n > tier) tier = n;
  }
  return tier;
}

/**
 * The warning on a CPU upgrade row: the stock clock's current demand over the planned board's VRM rating. Null when the
 * board can feed it (demand at or under the phases' rating).
 */
export function cpuVrmWarning(s: Snapshot, cpuId: string): string | null {
  const spec = getSpec(cpuId);
  const tier = BOARD_TIERS[plannedBoardTier(s)];
  if (!spec || spec.kind !== 'cpu' || !tier) return null;
  const demand = currentDemand(spec.loadW, 1);
  if (loadRatio(tier.vrm, demand) <= VRM_OVERLOAD) return null;
  return "this board's VRM can't feed it: expect throttling or crashes";
}

export const LIQUID_VRM_NOTE = "liquid coolers don't cool the VRM: add a VRM heatsink";

/** Liquid coolers give the VRM no airflow: without a VRM heatsink the regulator has nothing to cool it. Null otherwise. */
export function liquidVrmNote(s: Snapshot, coolerId: string): string | null {
  const spec = getSpec(coolerId);
  if (!spec || spec.kind !== 'cooler' || spec.vrmAirPerC > 0) return null;
  return s.board?.vrmSink ? null : LIQUID_VRM_NOTE;
}

/** The clock axis of one memory stick: its range and where heat or its regulator's rating make it throttle or crash (raw, may lie outside the range). */
export interface RamZones { min: number; max: number; base: number; throttleAt: number; unstableAt: number; overloadAt: number }

/**
 * Where on the clock axis a stick throttles (steady heat reaches its throttle temperature), goes unstable (heat) and overloads
 * the board's memory regulator (every other stick held at its current clock), from the sim's own steady-state model.
 */
export function ramZones(s: Snapshot, devId: string): RamZones | null {
  const dev = s.devices.find((d) => d.id === devId);
  const spec = dev ? getSpec(dev.spec) as RamSpec | undefined : undefined;
  const tier = BOARD_TIERS[s.boardTier];
  if (!dev || !spec || spec.kind !== 'ram' || !tier) return null;
  const heat = spec.loadW * spec.heatFactor;
  const at = (t: number) => (heat > 0 ? spec.clock.base * Math.cbrt(((t - 25) * spec.thermal.passive) / heat) : spec.clock.max);
  const others = s.devices.filter((d) => d.kind === 'ram' && d.id !== devId && !d.burnt).map((d) => {
    const sp = getSpec(d.spec) as RamSpec;
    const r = (d.requestedClock ?? sp.clock.base) / sp.clock.base;
    return { w: sp.loadW * r ** 3, r };
  });
  const cap = tier.ramVrm.phases * tier.ramVrm.ampsPerPhase * VRM_OVERLOAD;
  const demandAt = (clock: number) => {
    const r = clock / spec.clock.base;
    const all = [...others, { w: spec.loadW * r ** 3, r }];
    return ramDemand(all.reduce((a, x) => a + x.w, 0), all.reduce((a, x) => a + x.r, 0) / all.length);
  };
  let lo = spec.clock.min, hi = spec.clock.max * 2;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (demandAt(mid) > cap) hi = mid; else lo = mid; }
  const overloadAt = demandAt(spec.clock.max * 2) > cap ? hi : Infinity;
  return { min: spec.clock.min, max: spec.clock.max, base: spec.clock.base, throttleAt: at(spec.thermal.throttleC), unstableAt: at(spec.thermal.unstableC), overloadAt };
}

/** Warning on a memory upgrade row: the stock load of every stick over the planned board's memory regulator. Null when it can feed them. */
export function ramVrmWarning(s: Snapshot, ramId: string): string | null {
  const spec = getSpec(ramId);
  const tier = BOARD_TIERS[plannedBoardTier(s)];
  if (!spec || spec.kind !== 'ram' || !tier) return null;
  const sticks = s.devices.filter((d) => d.kind === 'ram' && !d.burnt).length;
  const demand = ramDemand(spec.loadW * Math.max(1, sticks), 1);
  if (loadRatio(tier.ramVrm, demand) <= VRM_OVERLOAD) return null;
  return "this board's memory VRM can't feed it: expect crashes";
}
