// Motherboard, VRM and heatsink readouts for the UI (docs/VRM.md, docs/UI.md). Pure: numbers come from the snapshot and
// the spec data, no DOM, no signals. All sim numbers are placeholders, so these readouts are placeholders too.

import { BOARD_TIERS, getSpec, type VrmSinkSpec } from '../sim/board/specs';
import { currentDemand, loadRatio, VRM_OVERLOAD } from '../sim/board/vrm';
import type { Snapshot } from '../sim/game/game';
import { fmtMoney, type Level } from './logic';

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

/** Everything the VRM readout shows, from `snapshot.board`. */
export interface VrmReadout {
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
export function vrmReadout(s: Snapshot): VrmReadout | null {
  const b = s.board;
  if (!b) return null;
  const v = b.vrm;
  const capacityA = v.phases * v.ampsPerPhase;
  const sinkSpec = b.vrmSink ? getSpec(b.vrmSink.spec) as VrmSinkSpec | undefined : undefined;
  const tempLevel: Level = v.burnt || v.tempC >= v.unstableC ? 'bad' : v.tempC >= v.throttleC - 5 ? 'warn' : 'ok';
  return {
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
    lossW: s.power.vrmLossW ?? v.heatW,
    ripple: v.ripple,
    tempLevel,
    sink: b.vrmSink && sinkSpec?.kind === 'vrm-sink' ? { name: sinkSpec.name.split(' (')[0]!, coolingPerC: sinkSpec.coolingPerC } : null,
  };
}

/** Plain-words status lines for the VRM card. */
export function vrmLines(v: VrmReadout): Array<{ level: Level | 'info'; text: string }> {
  const out: Array<{ level: Level | 'info'; text: string }> = [];
  if (v.burnt) {
    out.push({ level: 'bad', text: 'The VRM burnt out, so the board is dead. Power off and buy a board of the same tier to replace it.' });
    return out;
  }
  if (v.unstable) out.push({ level: 'bad', text: 'Unstable: the regulator is overloaded or too hot, so the machine can crash. Slow the clock or add a VRM heatsink.' });
  else if (v.zone === 'busy') out.push({ level: 'warn', text: 'Working hard: most of its rating is in use. Keep the clock near stock.' });
  if (v.throttle < 1) out.push({ level: 'warn', text: 'Throttling: the regulator is too hot, so the processor is held back.' });
  if (!v.sink) out.push({ level: 'info', text: 'No VRM heatsink. A small one on the board cools the regulator.' });
  return out;
}

/** Slot counts shown on a board card, with the icon that stands for each. */
export type BoardSlotIcon = 'cpu' | 'memory' | 'slot' | 'disk' | 'fan' | 'bolt';
export interface BoardSlotCount { key: string; label: string; count: number; icon: BoardSlotIcon }

export type BoardCardState = 'installed' | 'dead' | 'crate' | 'ready' | 'poor' | 'blocked' | 'locked';

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
  { key: 'atx-plus', label: 'big power connector (ATX+)', icon: 'bolt' },
];

const phaseAmps = (t: { vrm: { phases: number; ampsPerPhase: number } }) => t.vrm.phases * t.vrm.ampsPerPhase;

/** Cards for every board tier this machine can still use: the installed tier, then the bigger ones. Older tiers are left out. */
export function boardCards(s: Snapshot): BoardCard[] {
  const cur = s.boardTier;
  const burnt = !!s.board?.burnt;
  const maxA = Math.max(...BOARD_TIERS.map(phaseAmps));
  const curA = phaseAmps(BOARD_TIERS[cur] ?? BOARD_TIERS[0]!);
  const out: BoardCard[] = [];
  for (const t of BOARD_TIERS) {
    if (t.tier < cur) continue;
    const id = `board${t.tier}`;
    const p = s.purchases.find((x) => x.id === id);
    const crate = s.inventory.find((i) => i.spec === id);
    const price = p?.price ?? t.price;
    const free = s.sandbox;
    const canAfford = free || (p ? p.affordable : false);
    let state: BoardCardState;
    let reason: string | undefined;
    if (t.tier === cur) {
      state = burnt ? 'dead' : 'installed';
      if (burnt) reason = p?.blocked ?? (canAfford ? undefined : `Need ${fmtMoney(price - s.money)} more`);
      else reason = 'Fitted in the machine';
    } else if (crate) {
      state = 'crate';
      reason = 'In your inventory: power off, then drag it onto the board';
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
