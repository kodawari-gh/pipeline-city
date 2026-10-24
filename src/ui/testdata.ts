// Snapshot fixtures for the UI tests. A fresh game by default: bare board, starter crate, nothing progressed.

import type { BoardSnap, DeviceSnap, InventorySnap, KeySnap, PurchaseSnap, Snapshot, SlotSnap, VrmSnap } from '../sim/game/game';
import { newProgress } from '../sim/game/save';
import { BOARD_TIERS } from '../sim/board/specs';
import { levelRows } from '../sim/game/levels';

export const dev = (o: Partial<DeviceSnap> = {}): DeviceSnap => ({
  id: 'dev1', spec: 'cpu0', kind: 'cpu', name: 'Tiny-1 (unpipelined)', burnt: false, requestedClock: 1, effectiveClock: 1,
  tempC: 30, powerW: 5, throttle: 1, unstable: false, slot: 'cpu0', ...o,
});

export const key = (o: Partial<KeySnap> = {}): KeySnap => ({
  id: 1, template: 'cli.log', type: 'log', jobNo: 72, label: '#72 log', arrivalTick: 0, deadlineTick: 120, age: 10,
  late: false, payoutEstimate: 50, attempts: 1, done: false, result: '', stage: 'tray',
  cls: 'cli', needs: [], runnable: true, missing: [], expiresTick: 120, declinable: true, ...o,
});

/** The bare board: every socket empty (the cooler mounts on the CPU, so it starts in the crate). */
export const EMPTY_SLOTS: SlotSnap[] = [
  { id: 'cpu0', type: 'cpu', deviceId: null },
  { id: 'dimm0', type: 'dimm', deviceId: null },
  { id: 'dimm1', type: 'dimm', deviceId: null },
  { id: 'atx0', type: 'atx', deviceId: null },
  { id: 'cooler0', type: 'cooler', deviceId: null },
  { id: 'display0', type: 'display', deviceId: null },
];

/** The starter crate: CPU, PSU, RAM, monitor and the stock cooler. */
export const STARTER_CRATE: InventorySnap[] = [
  { id: 'inv1', spec: 'cpu0', kind: 'cpu', name: 'Tiny-1 (unpipelined)', freeSlots: ['cpu0'], swapSlots: [], installable: true },
  { id: 'inv2', spec: 'psu0', kind: 'psu', name: 'PSU 40 W', freeSlots: ['atx0'], swapSlots: [], installable: true },
  { id: 'inv3', spec: 'ram0', kind: 'ram', name: 'DRAM 16K', freeSlots: ['dimm0', 'dimm1'], swapSlots: [], installable: true },
  { id: 'inv4', spec: 'display0', kind: 'display', name: 'CLI monitor', freeSlots: ['display0'], swapSlots: [], installable: true },
  { id: 'inv5', spec: 'cooler0', kind: 'cooler', name: 'Stock heatsink', freeSlots: [], swapSlots: [], installable: false, reason: 'install the CPU first: the cooler mounts on it' },
];

export const PURCHASES: PurchaseSnap[] = [
  { id: 'cpu1', name: 'Tiny-5 (5-stage, no forwarding)', kind: 'cpu', price: 200, affordable: false },
  { id: 'cpu2', name: 'Tiny-5F (5-stage, forwarding)', kind: 'cpu', price: 800, affordable: false, blocked: 'needs a 100 W power supply' },
  { id: 'ram1', name: 'DRAM 32K fast', kind: 'ram', price: 100, affordable: true },
  { id: 'psu1', name: 'PSU 100 W', kind: 'psu', price: 60, affordable: true },
];

/** The motherboard snapshot for a tier (Starter by default), a cool VRM, nothing burnt, no heatsink. */
export function boardSnap(o: Omit<Partial<BoardSnap>, 'vrm'> & { vrm?: Partial<VrmSnap> } = {}): BoardSnap {
  const tier = o.tier ?? 0;
  const t = BOARD_TIERS[tier]!;
  const { vrm, ...rest } = o;
  return {
    tier, name: t.name, burnt: false,
    features: { ...t.features },
    slots: EMPTY_SLOTS,
    vrm: {
      phases: t.vrm.phases, ampsPerPhase: t.vrm.ampsPerPhase, ripple: t.vrm.ripple, tempC: 30, loadRatio: 0, efficiency: t.vrm.peakEfficiency,
      throttle: 1, unstable: false, burnt: false, errProb: 0, heatW: 0, throttleC: t.vrm.throttleC, unstableC: t.vrm.unstableC,
      damageC: t.vrm.damageC, sinkDeviceId: null, ...vrm,
    },
    vrmSink: null,
    ...rest,
  };
}

export const NO_PROGRESS = newProgress(false);
export const ALL_PROGRESS = newProgress(true);

export const STOCK_COOLER: DeviceSnap = { id: 'dev-cooler', spec: 'cooler0', kind: 'cooler', name: 'Stock heatsink', burnt: false, requestedClock: null, effectiveClock: 1, tempC: 25, powerW: 0, throttle: 1, unstable: false, slot: 'cooler0' };

/** A fresh game: nothing installed, nothing connected, no keys yet. */
export function snap(o: Partial<Snapshot> = {}): Snapshot {
  return {
    money: 0, cycle: 0, baseTick: 0, queueLength: 0, queueCap: 8, request: null, boardTier: 0, pipe: null,
    display: '', counters: {}, completed: 0, errors: 0, dropped: 0, lastCompleted: null, avgTurnaround: 0,
    reputation: 1, demandRate: 0.1, devices: [], power: { vrmLossW: 0, totalW: 0, budgetW: 40, psuFactor: 1, off: true, tripped: false },
    cpuClock: null, purchases: PURCHASES, pendingPurchases: [],
    phase: 'off', phaseReason: null, powered: false, bootProgress: 0, monitorLive: false,
    noPowerReason: 'Install a power supply and connect the ATX cable first.', postBlocker: null,
    inventory: STARTER_CRATE, slots: EMPTY_SLOTS,
    cables: [
      { id: 'atx', name: '24-pin ATX power', connected: false, blocked: 'the power supply is not installed' },
      { id: 'cpu', name: '8-pin CPU power', connected: false, blocked: 'the power supply is not installed' },
      { id: 'video', name: 'Video cable', connected: false, blocked: 'the monitor is not installed' },
    ] as Snapshot['cables'],
    tray: [], plugged: null, progress: NO_PROGRESS, log: [],
    storage: [], os: null, held: [], keyActivity: 'none',
    haltReason: null, keyIgnored: false, postFailed: false, sandbox: false,
    patience: { mul: 3, targetTurnaround: 180, deadlineTicks: 540, sinceFirstBoot: 0 },
    level: { level: 1, name: 'Garage Bench', clientBase: 0, floor: 0, next: 4, progress: 0, patienceMul: 4, payMul: 1, demandMul: 1, leveledUpAt: null, recentlyUnlocked: [], upcoming: levelRows(), sandbox: false },
    expired: 0, declined: 0, postTicks: 30,
    net: {
      state: 'no-device', reason: 'no ISP plan: buy one', port: { kind: null, deviceId: null, mbps: 0 }, router: null, isp: null,
      bandwidth: { downMbps: 0, upMbps: 0, clients: 0, binding: null }, transfers: [], offers: [], spooled: [], usbRetired: false,
      usbFallback: { state: 'off', deadTicks: 0, startsIn: null, keyRateMul: 1 }, retiredKeys: 0, portBusyKey: null, counters: { delivered: 0, downloaded: 0, uploaded: 0, lost: 0 },
    },
    board: boardSnap(),
    ...o,
  } as Snapshot;
}
