import { assert, describe, expect, it } from 'vitest';
import type { GpuSnap } from '@/worker/game/types';
import type { Snapshot } from '@/worker/protocol';
import { FRAME_COLS, FRAME_HOLD, clock, dashModel, frameColor, frameModel, holdFrame, ipcBetween } from './screenmodel';
import type * as screenmodelTypes from './screenmodel';

const job = ([slot, keyId, label]: [number, number, string], state: 'queued' | 'running' | 'result', ahead = 0) => ({
  slot,
  keyId,
  label,
  state,
  persisted: true,
  ahead,
});

/** Whether a stub stands in for a snapshot (the dashboard reads only the fields it has). */
const isSnapshot = (o: unknown): o is Snapshot => typeof o === 'object' && o !== null && 'phase' in o && 'os' in o;

/** The few snapshot fields the dashboard reads. */
function snap(over: Record<string, unknown> = {}): Snapshot {
  const s = {
    phase: 'running-os',
    baseTick: 100,
    keyActivity: 'none',
    plugged: null,
    power: { totalW: 120, budgetW: 400, psuFactor: 1, off: false, tripped: false },
    cpuClock: { value: 1, min: 0.5, max: 2 },
    devices: [
      {
        id: 'cpu',
        spec: 'cpu1',
        kind: 'cpu',
        name: 'CPU',
        slot: 'cpu',
        burnt: false,
        requestedClock: null,
        effectiveClock: 1.25,
        tempC: 55,
        powerW: 30,
        throttle: 1,
        unstable: false,
      },
    ],
    storage: [
      {
        deviceId: 'd',
        slot: 'sata0',
        spec: 's',
        name: 'S',
        burnt: false,
        capacityBytes: 100 * 1024,
        usedBytes: 25 * 1024,
        bytesRead: 0,
        bytesWritten: 0,
        busy: false,
        latencyTicks: 0,
        blockTicks: 0,
        bytesPerSecond: 0,
        hasOs: true,
      },
    ],
    os: {
      spec: 'os2',
      tier: 2,
      name: 'Pipeline OS',
      deviceId: 'd',
      slot: 'sata0',
      programSlots: 2,
      queueSlots: 8,
      up: true,
      runningKeyId: 7,
      spool: { slotBytes: 0, slots: 0, used: 0, freeBytes: 0, full: false },
      queue: [job([0, 9, 'sort'], 'queued', 1), job([1, 7, 'fib'], 'running'), job([2, 8, 'hash'], 'result', -1)],
    },
    net: { state: 'link-up', bandwidth: { downMbps: 100, upMbps: 20, clients: 1, binding: null }, transfers: [] },
    ram: null,
    ...over,
  };
  assert(isSnapshot(s), 'the stub stands in for a snapshot');
  return s;
}
const ctx = (over: Partial<screenmodelTypes.DashCtx> = {}): screenmodelTypes.DashCtx => ({
  upTick: 40,
  ipc: [],
  started: new Map(),
  ...over,
});

describe('dashModel', () => {
  it('is null without an OS', () => {
    expect(dashModel(snap({ os: null }), ctx())).toBeNull();
  });

  it('titles the OS and counts uptime from the tick it came up', () => {
    const m = dashModel(snap(), ctx());
    assert.exists(m);
    expect(m.title).toBe('PIPELINE OS T2');
    expect(m.status).toBe('RUNNING');
    expect(m.sub).toContain('UP 01:00');
    expect(m.sub).toContain('QUEUE 3/8');
  });

  it('lists the running program first, then the queue by place, then results', () => {
    const m = dashModel(snap(), ctx({ started: new Map([[7, 70]]) }));
    assert.exists(m);
    expect(m.procs.map((p) => p.name)).toStrictEqual(['fib', 'sort', 'hash']);
    expect(m.procs.map((p) => p.state)).toStrictEqual(['RUN', '+1', 'DONE']);
    assert.exists(m.procs[0]);
    expect(m.procs[0].time).toBe('00:30');
    assert.exists(m.procs[1]);
    expect(m.procs[1].time).toBe('');
  });

  it('never invents a per-process CPU share', () => {
    const m = dashModel(snap(), ctx());
    assert.exists(m);
    assert.exists(m.procs[0]);
    expect(Object.keys(m.procs[0])).not.toContain('cpu');
  });

  it('caps the table and counts the rest', () => {
    const queue = Array.from({ length: 11 }, (_, i) => job([i, 100 + i, `j${i}`], 'queued', i));
    const os2 = snap().os;
    assert.exists(os2);
    const m = dashModel(snap({ os: { ...os2, queue } }), ctx());
    assert.exists(m);
    expect(m.procs).toHaveLength(8);
    expect(m.more).toBe(3);
  });

  it('gives the memory of a program from the RAM map and the machine bars', () => {
    const ram = {
      bytes: 1000,
      regions: [
        { lo: 0, hi: 100, kind: 'os', name: 'kernel' },
        { lo: 100, hi: 300, kind: 'prog', name: 'fib', owner: 7 },
        { lo: 300, hi: 400, kind: 'work', name: 'fib data', owner: 7 },
      ],
    };
    const m = dashModel(snap({ ram }), ctx());
    assert.exists(m);
    assert.exists(m.procs[0]);
    expect(m.procs[0].mem).toBe('200B+100B');
    assert.exists(m.mem);
    expect(m.mem.parts.map((p) => Math.round(p.frac * 100))).toStrictEqual([10, 30, 60]);
    expect(m.bars.map((b) => b.label)).toStrictEqual(['CLOCK', 'TEMP', 'POWER', 'DISK SATA0']);
    const diskBar = m.bars.find((b) => b.label === 'DISK SATA0');
    assert.exists(diskBar);
    expect(diskBar.frac).toBeCloseTo(0.25);
  });

  it('flags a hot CPU and an overdrawn supply', () => {
    const hot = snap({ power: { totalW: 500, budgetW: 400, psuFactor: 1, off: false, tripped: false } });
    const dashModelResult = dashModel(hot, ctx());
    assert.exists(dashModelResult);
    const powerBar = dashModelResult.bars.find((b) => b.label === 'POWER');
    assert.exists(powerBar);
    expect(powerBar.tone).toBe('bad');
  });

  it('prompts for the finished key', () => {
    const os3 = snap().os;
    assert.exists(os3);
    const m = dashModel(snap({ os: { ...os3, queue: [job([2, 8, 'hash'], 'result', -1)] } }), ctx());
    assert.exists(m);
    expect(m.prompt).toBe('PLUG KEY hash TO COLLECT');
    expect(m.promptTone).toBe('warn');
  });

  it('reads IPC from counter deltas', () => {
    expect(ipcBetween({ cycles: 100, retired: 50 }, { cycles: 200, retired: 130 })).toBeCloseTo(0.8);
    expect(ipcBetween(null, { cycles: 5, retired: 5 })).toBeNull();
    expect(ipcBetween({ cycles: 100, retired: 50 }, { cycles: 100, retired: 50 })).toBeNull();
    const dashModelResult2 = dashModel(snap(), ctx({ ipc: [0.5, 0.75] }));
    assert.exists(dashModelResult2);
    expect(dashModelResult2.ipcText).toContain('IPC 0.75');
  });

  it('formats clock time', () => {
    expect(clock(125)).toBe('02:05');
  });
});

const card = (o: Partial<GpuSnap> = {}): GpuSnap => ({
  slot: 'pcie1',
  lanes: 8,
  banks: 1,
  memBytes: 8192,
  phase: 'idle',
  mask: 0,
  stack: [],
  pc: 0,
  regs: [],
  trace: [],
  launches: 1,
  error: false,
  stats: { instructions: 100, idleLaneSlots: 80, conflictCycles: 3, cycles: 120 },
  frame: [],
  ...o,
});

/** A word of the first rows: every fourth one full, the rest a fifth. */
const brightAt = (i: number): number => (i % 4 === 0 ? 255 : 51);

describe('frameModel', () => {
  it('is null before the first launch', () => {
    const none: GpuSnap[] = []; // (a machine with no card)
    expect(frameModel(none[0])).toBeNull();
    expect(frameModel(card({ frame: [] }))).toBeNull();
  });

  it('fills whole rows of 64 and reads each word as a brightness over 255', () => {
    const frame = Array.from({ length: 256 }, () => 0);
    for (let i = 0; i < 40; i++) {
      frame[i] = brightAt(i);
    }
    const m = frameModel(card({ frame }));
    assert.exists(m);
    expect(m.cols).toBe(FRAME_COLS);
    expect(m.rows).toBe(4); // 256 words: four rows of 64
    expect(m.cells).toHaveLength(256);
    expect(m.cells[0]).toBe(1);
    expect(m.cells[1]).toBeCloseTo(0.2);
    expect(m.cells[100]).toBe(0);
  });

  it('keeps a whole 16:10 picture (64 x 40), even when its last rows are black', () => {
    const frame = Array.from({ length: 64 * 40 }, () => 0);
    frame[0] = 5;
    const m = frameModel(card({ frame }));
    assert.exists(m);
    expect([m.cols, m.rows]).toStrictEqual([64, 40]);
  });

  it('clamps negative and big words into 0..1', () => {
    const frame = Array.from({ length: 256 }, () => 0);
    frame[0] = 0xff_ff_ff_ff;
    frame[1] = 1000;
    const m = frameModel(card({ frame }));
    assert.exists(m);
    expect(m.cells[0]).toBe(0);
    expect(m.cells[1]).toBe(1);
  });

  it('states what the card is doing, in numbers it has', () => {
    const frame = Array.from({ length: 256 }, () => 1);
    const runFrameModel = frameModel(card({ frame, phase: 'run' }));
    assert.exists(runFrameModel);
    expect(runFrameModel.status).toContain('DRAWING');
    const frameModelResult = frameModel(card({ frame }));
    assert.exists(frameModelResult);
    expect(frameModelResult.status).toContain('DONE');
    const frameModelResult2 = frameModel(card({ frame, error: true }));
    assert.exists(frameModelResult2);
    expect(frameModelResult2.status).toContain('FAULT');
    const frameModelResult3 = frameModel(card({ frame, launches: 3 }));
    assert.exists(frameModelResult3);
    const s = frameModelResult3.status;
    expect(s).toContain('FRAME 3');
    expect(s).toContain('120 CYC');
    expect(s).toContain('8 LANES 90% BUSY');
    expect(s).toContain('3 CONFLICTS');
  });
});

describe('frameColor', () => {
  it('runs from dark glass to white', () => {
    expect(frameColor(0)).toBe('#060418');
    expect(frameColor(1)).toBe('#ffffeb');
    expect(frameColor(-3)).toBe(frameColor(0));
    expect(frameColor(7)).toBe(frameColor(1));
  });
});

describe('holdFrame', () => {
  const idle = card({ launches: 1 });
  it('shows nothing before a launch', () => {
    expect(holdFrame({ seq: 0, at: -Infinity }, card({ launches: 0 }), 50).show).toBe(false);
  });
  it('shows while the card works and for the hold after its latest launch, then lets go', () => {
    let h = { seq: 0, at: -Infinity };
    let r = holdFrame(h, card({ launches: 1, phase: 'run' }), 100);
    expect(r.show).toBe(true);
    h = r.hold;
    r = holdFrame(h, idle, 100 + FRAME_HOLD);
    expect(r.show).toBe(true);
    h = r.hold;
    r = holdFrame(h, idle, 100 + FRAME_HOLD + 1);
    expect(r.show).toBe(false);
  });
  it('a new launch restarts the hold, even one that finished between two snapshots', () => {
    let h = { seq: 1, at: 100 };
    const r = holdFrame(h, card({ launches: 2 }), 150);
    expect(r.show).toBe(true);
    h = r.hold;
    expect(holdFrame(h, card({ launches: 2 }), 150 + FRAME_HOLD).show).toBe(true);
  });
});
