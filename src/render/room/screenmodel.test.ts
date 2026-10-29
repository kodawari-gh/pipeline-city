import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../sim/protocol';
import { clock, dashModel, ipcBetween, type DashCtx } from './screenmodel';

const job = (slot: number, keyId: number, label: string, state: 'queued' | 'running' | 'result', ahead = 0) => ({ slot, keyId, label, state, persisted: true, ahead });

/** The few snapshot fields the dashboard reads. */
function snap(over: Record<string, unknown> = {}): Snapshot {
  return {
    phase: 'running-os', baseTick: 100, keyActivity: 'none', plugged: null,
    power: { totalW: 120, budgetW: 400, psuFactor: 1, off: false, tripped: false },
    cpuClock: { value: 1, min: 0.5, max: 2 },
    devices: [{ id: 'cpu', spec: 'cpu1', kind: 'cpu', name: 'CPU', slot: 'cpu', burnt: false, requestedClock: null, effectiveClock: 1.25, tempC: 55, powerW: 30, throttle: 1, unstable: false }],
    storage: [{ deviceId: 'd', slot: 'sata0', spec: 's', name: 'S', burnt: false, capacityBytes: 100 * 1024, usedBytes: 25 * 1024, bytesRead: 0, bytesWritten: 0, busy: false, latencyTicks: 0, blockTicks: 0, bytesPerSecond: 0, hasOs: true }],
    os: { spec: 'os2', tier: 2, name: 'Pipeline OS', deviceId: 'd', slot: 'sata0', programSlots: 2, queueSlots: 8, up: true, runningKeyId: 7, spool: { slotBytes: 0, slots: 0, used: 0, freeBytes: 0, full: false },
      queue: [job(0, 9, 'sort', 'queued', 1), job(1, 7, 'fib', 'running'), job(2, 8, 'hash', 'result', -1)] },
    net: { state: 'link-up', bandwidth: { downMbps: 100, upMbps: 20, clients: 1, binding: null }, transfers: [] },
    ram: null,
    ...over,
  } as unknown as Snapshot;
}
const ctx = (over: Partial<DashCtx> = {}): DashCtx => ({ upTick: 40, ipc: [], started: new Map(), ...over });

describe('dashModel', () => {
  it('is null without an OS', () => expect(dashModel(snap({ os: null }), ctx())).toBeNull());

  it('titles the OS and counts uptime from the tick it came up', () => {
    const m = dashModel(snap(), ctx())!;
    expect(m.title).toBe('PIPELINE OS T2');
    expect(m.status).toBe('RUNNING');
    expect(m.sub).toContain('UP 01:00');
    expect(m.sub).toContain('QUEUE 3/8');
  });

  it('lists the running program first, then the queue by place, then results', () => {
    const m = dashModel(snap(), ctx({ started: new Map([[7, 70]]) }))!;
    expect(m.procs.map((p) => p.name)).toEqual(['fib', 'sort', 'hash']);
    expect(m.procs.map((p) => p.state)).toEqual(['RUN', '+1', 'DONE']);
    expect(m.procs[0]!.time).toBe('00:30');
    expect(m.procs[1]!.time).toBe('');
  });

  it('never invents a per-process CPU share', () => {
    const m = dashModel(snap(), ctx())!;
    expect(Object.keys(m.procs[0]!)).not.toContain('cpu');
  });

  it('caps the table and counts the rest', () => {
    const queue = Array.from({ length: 11 }, (_, i) => job(i, 100 + i, `j${i}`, 'queued', i));
    const m = dashModel(snap({ os: { ...snap().os!, queue } }), ctx())!;
    expect(m.procs).toHaveLength(8);
    expect(m.more).toBe(3);
  });

  it('gives the memory of a program from the RAM map and the machine bars', () => {
    const ram = { bytes: 1000, regions: [
      { lo: 0, hi: 100, kind: 'os', name: 'kernel' },
      { lo: 100, hi: 300, kind: 'prog', name: 'fib', owner: 7 },
      { lo: 300, hi: 400, kind: 'work', name: 'fib data', owner: 7 },
    ] };
    const m = dashModel(snap({ ram }), ctx())!;
    expect(m.procs[0]!.mem).toBe('200B+100B');
    expect(m.mem!.parts.map((p) => Math.round(p.frac * 100))).toEqual([10, 30, 60]);
    expect(m.bars.map((b) => b.label)).toEqual(['CLOCK', 'TEMP', 'POWER', 'DISK SATA0']);
    expect(m.bars.find((b) => b.label === 'DISK SATA0')!.frac).toBeCloseTo(0.25);
  });

  it('flags a hot CPU and an overdrawn supply', () => {
    const hot = snap({ power: { totalW: 500, budgetW: 400, psuFactor: 1, off: false, tripped: false } });
    expect(dashModel(hot, ctx())!.bars.find((b) => b.label === 'POWER')!.tone).toBe('bad');
  });

  it('prompts for the finished key', () => {
    const m = dashModel(snap({ os: { ...snap().os!, queue: [job(2, 8, 'hash', 'result', -1)] } }), ctx())!;
    expect(m.prompt).toBe('PLUG KEY hash TO COLLECT');
    expect(m.promptTone).toBe('warn');
  });

  it('reads IPC from counter deltas', () => {
    expect(ipcBetween({ cycles: 100, retired: 50 }, { cycles: 200, retired: 130 })).toBeCloseTo(0.8);
    expect(ipcBetween(null, { cycles: 5, retired: 5 })).toBeNull();
    expect(ipcBetween({ cycles: 100, retired: 50 }, { cycles: 100, retired: 50 })).toBeNull();
    expect(dashModel(snap(), ctx({ ipc: [0.5, 0.75] }))!.ipcText).toContain('IPC 0.75');
  });

  it('formats clock time', () => expect(clock(125)).toBe('02:05'));
});
