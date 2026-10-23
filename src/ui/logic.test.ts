import { describe, expect, it } from 'vitest';
import type { DeviceSnap, Snapshot } from '../sim/game/game';
import {
  cacheHitRate, clockWarning, cpiIpc, describeId, fmtMoney, fmtTicks, groupPurchases, newHints, stallsByCause,
  fillToasts, tempLevel, triggeredHints,
} from './logic';
import { getSpec } from '../sim/board/specs';

const dev = (o: Partial<DeviceSnap> = {}): DeviceSnap => ({
  id: 'dev1', spec: 'cpu0', kind: 'cpu', name: 'cpu', burnt: false, requestedClock: 1, effectiveClock: 1,
  tempC: 30, powerW: 5, throttle: 1, unstable: false, slot: 'cpu0', ...o,
});
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  money: 0, cycle: 0, baseTick: 0, queueLength: 0, queueCap: 8, request: null, display: '', counters: {},
  completed: 0, errors: 0, dropped: 0, lastCompleted: null, avgTurnaround: 0, reputation: 1, demandRate: 0.1,
  devices: [dev()], power: { totalW: 10, budgetW: 40, psuFactor: 1, off: false, tripped: false },
  cpuClock: null, purchases: [], pendingPurchases: [], boardTier: 0, pipe: null,
  phase: 'waiting-for-key', phaseReason: null, powered: true, bootProgress: 0.4, monitorLive: true, noPowerReason: null,
  postBlocker: null, inventory: [], slots: [], cables: [], tray: [], plugged: null, log: [],
  progress: {
    cpuInstalled: true, psuInstalled: true, ramInstalled: true, monitorInstalled: true, atxConnected: true,
    cpuPowerConnected: true, videoConnected: true, poweredOn: true, firstKeyPlugged: false, firstJobDone: false,
    firstKeyEjected: false, firstPurchase: false,
  },
  ...o,
});

describe('format', () => {
  it('money and ticks', () => {
    expect(fmtMoney(1234.9)).toBe('$1,234');
    expect(fmtTicks(45)).toBe('45s');
    expect(fmtTicks(125)).toBe('2m 05s');
  });
});

describe('shop grouping', () => {
  const ps = [
    { id: 'cpu2', name: 'C2', kind: 'cpu' as const, price: 800, affordable: false },
    { id: 'cpu1', name: 'C1', kind: 'cpu' as const, price: 200, affordable: true },
    { id: 'psu2', name: 'P2', kind: 'psu' as const, price: 250, affordable: true, blocked: 'needs ATX+' },
    { id: 'ram1', name: 'R1', kind: 'ram' as const, price: 100, affordable: true },
  ];
  it('orders kinds, sorts by price, assigns state and reason', () => {
    const g = groupPurchases(ps, ['ram1'], 500);
    expect(g.map((x) => x.kind)).toEqual(['cpu', 'ram', 'psu']);
    expect(g[0]!.items.map((i) => i.id)).toEqual(['cpu1', 'cpu2']);
    expect(g[0]!.items[0]!.state).toBe('ready');
    expect(g[0]!.items[1]).toMatchObject({ state: 'poor', reason: 'Need $300 more' });
    expect(g[2]!.items[0]).toMatchObject({ state: 'blocked', reason: 'needs ATX+' });
    expect(g[1]!.items[0]!.pending).toBe(true);
  });

  it('lists the board upgrade as its own group and describes it', () => {
    const g = groupPurchases([{ id: 'board1', name: 'ATX+ board', kind: 'board', price: 300, affordable: true }], [], 500);
    expect(g.map((x) => x.kind)).toEqual(['board']);
    expect(g[0]!.items[0]!.state).toBe('ready');
    expect(describeId('board1')!.nerd).toMatch(/atx-plus/);
  });
});

describe('stats', () => {
  it('cpi, cache, stalls', () => {
    expect(cpiIpc({ cycles: 0, retired: 0 })).toBeNull();
    expect(cpiIpc({ cycles: 150, retired: 100 })).toEqual({ cpi: 1.5, ipc: 100 / 150 });
    expect(cacheHitRate({})).toBeNull();
    expect(cacheHitRate({ cacheHits: 3, cacheMisses: 1 })).toBe(0.75);
    expect(stallsByCause({ stallFlush: 4 }).find((c) => c.key === 'stallFlush')!.value).toBe(4);
  });
  it('temp level uses the spec', () => {
    const cpu = getSpec('cpu0');
    expect(tempLevel(40, cpu)).toBe('ok');
    expect(tempLevel(66, cpu)).toBe('warn');
    expect(tempLevel(90, cpu)).toBe('bad');
  });
  it('clock warning escalates', () => {
    expect(clockWarning(dev())).toBeNull();
    expect(clockWarning(dev({ tempC: 67 }))?.level).toBe('warn');
    expect(clockWarning(dev({ throttle: 0.9, tempC: 75 }))?.level).toBe('warn');
    expect(clockWarning(dev({ unstable: true, tempC: 88 }))?.level).toBe('bad');
    expect(clockWarning(dev({ burnt: true }))?.level).toBe('bad');
  });
});

describe('hints', () => {
  it('nothing on a calm snapshot', () => {
    expect(triggeredHints(snap())).toEqual([]);
  });
  it('triggers each condition', () => {
    expect(triggeredHints(snap({ counters: { stallCache: 2 } }))).toContain('stall');
    expect(triggeredHints(snap({ devices: [dev({ throttle: 0.9 })] }))).toContain('throttle');
    expect(triggeredHints(snap({ devices: [dev({ unstable: true })] }))).toContain('overheat');
    expect(triggeredHints(snap({ queueLength: 3 }))).toContain('queue');
    expect(triggeredHints(snap({ devices: [dev({ burnt: true })] }))).toContain('burnt');
    expect(triggeredHints(snap({ power: { totalW: 90, budgetW: 40, psuFactor: 0.4, off: false, tripped: true } }))).toEqual(['trip']);
    expect(triggeredHints(snap({ power: { totalW: 50, budgetW: 40, psuFactor: 0.8, off: false, tripped: false } }))).toEqual(['brownout']);
  });
  it('shows each only once', () => {
    const s = snap({ queueLength: 5 });
    expect(newHints(s, new Set()).map((h) => h.id)).toEqual(['queue']);
    expect(newHints(s, new Set(['queue']))).toEqual([]);
  });
});

describe('toast queue', () => {
  const h = (id: string) => ({ id, text: id });
  it('shows at most two and queues the rest in order', () => {
    const r = fillToasts([], [h('a'), h('b'), h('c'), h('d')]);
    expect(r.visible.map((t) => t.id)).toEqual(['a', 'b']);
    expect(r.queue.map((t) => t.id)).toEqual(['c', 'd']);
  });
  it('shows the next one when a slot frees up', () => {
    const r = fillToasts([h('b')], [h('c'), h('d')]);
    expect(r.visible.map((t) => t.id)).toEqual(['b', 'c']);
    expect(r.queue.map((t) => t.id)).toEqual(['d']);
  });
  it('does nothing when full', () => {
    const r = fillToasts([h('a'), h('b')], [h('c')]);
    expect(r.visible).toHaveLength(2);
    expect(r.queue).toHaveLength(1);
  });
});

describe('descriptions', () => {
  it('spec and region ids', () => {
    expect(describeId('cpu2')?.nerd).toContain('forwarding');
    expect(describeId('ram1')?.nerd).toContain('32K');
    expect(describeId('board')?.title).toBe('Motherboard');
    expect(describeId('nope')).toBeNull();
  });
});
