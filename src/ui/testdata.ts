// Snapshot fixtures for the UI tests. A fresh game by default: bare board, starter crate, nothing progressed.

import type { DeviceSnap, InventorySnap, KeySnap, PurchaseSnap, Snapshot, SlotSnap } from '../sim/game/game';
import { newProgress } from '../sim/game/save';

export const dev = (o: Partial<DeviceSnap> = {}): DeviceSnap => ({
  id: 'dev1', spec: 'cpu0', kind: 'cpu', name: 'Tiny-1 (unpipelined)', burnt: false, requestedClock: 1, effectiveClock: 1,
  tempC: 30, powerW: 5, throttle: 1, unstable: false, slot: 'cpu0', ...o,
});

export const key = (o: Partial<KeySnap> = {}): KeySnap => ({
  id: 1, template: 'cli.log', type: 'log', jobNo: 72, label: '#72 log', arrivalTick: 0, deadlineTick: 120, age: 10,
  late: false, payoutEstimate: 50, attempts: 1, done: false, result: '', stage: 'tray', ...o,
});

/** The bare board: every socket empty except the stock heatsink. */
export const EMPTY_SLOTS: SlotSnap[] = [
  { id: 'cpu0', type: 'cpu', deviceId: null },
  { id: 'dimm0', type: 'dimm', deviceId: null },
  { id: 'dimm1', type: 'dimm', deviceId: null },
  { id: 'atx0', type: 'atx', deviceId: null },
  { id: 'cooler0', type: 'cooler', deviceId: 'dev-cooler' },
  { id: 'display0', type: 'display', deviceId: null },
];

/** The starter crate: CPU, PSU, RAM and monitor. */
export const STARTER_CRATE: InventorySnap[] = [
  { id: 'inv1', spec: 'cpu0', kind: 'cpu', name: 'Tiny-1 (unpipelined)', freeSlots: ['cpu0'], swapSlots: [], installable: true },
  { id: 'inv2', spec: 'psu0', kind: 'psu', name: 'PSU 40 W', freeSlots: ['atx0'], swapSlots: [], installable: true },
  { id: 'inv3', spec: 'ram0', kind: 'ram', name: 'DRAM 16K', freeSlots: ['dimm0', 'dimm1'], swapSlots: [], installable: true },
  { id: 'inv4', spec: 'display0', kind: 'display', name: 'CLI monitor', freeSlots: ['display0'], swapSlots: [], installable: true },
];

export const PURCHASES: PurchaseSnap[] = [
  { id: 'cpu1', name: 'Tiny-5 (5-stage, no forwarding)', kind: 'cpu', price: 200, affordable: false },
  { id: 'cpu2', name: 'Tiny-5F (5-stage, forwarding)', kind: 'cpu', price: 800, affordable: false, blocked: 'needs a 100 W power supply' },
  { id: 'ram1', name: 'DRAM 32K fast', kind: 'ram', price: 100, affordable: true },
  { id: 'psu1', name: 'PSU 100 W', kind: 'psu', price: 60, affordable: true },
];

export const NO_PROGRESS = newProgress(false);
export const ALL_PROGRESS = newProgress(true);

const STOCK_COOLER: DeviceSnap = { id: 'dev-cooler', spec: 'cooler0', kind: 'cooler', name: 'Stock heatsink', burnt: false, requestedClock: null, effectiveClock: 1, tempC: 25, powerW: 0, throttle: 1, unstable: false, slot: 'cooler0' };

/** A fresh game: nothing installed, nothing connected, no keys yet. */
export function snap(o: Partial<Snapshot> = {}): Snapshot {
  return {
    money: 0, cycle: 0, baseTick: 0, queueLength: 0, queueCap: 8, request: null, boardTier: 0, pipe: null,
    display: '', counters: {}, completed: 0, errors: 0, dropped: 0, lastCompleted: null, avgTurnaround: 0,
    reputation: 1, demandRate: 0.1, devices: [STOCK_COOLER], power: { vrmLossW: 0, totalW: 0, budgetW: 40, psuFactor: 1, off: true, tripped: false },
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
    ...o,
  } as Snapshot;
}
