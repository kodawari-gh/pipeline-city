import { describe, expect, it } from 'vitest';
import type { CoresSnap, PipeSnap } from '../../sim/pipesnap';
import { coreColor, oooStages, pipeCells, threadTint, tileModels, tileRect, washModels } from './coretiles';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const stage = (op: string) => ({ kind: op ? 1 : 0, id: op ? 1 : -1, op, text: op, cause: 0, stalled: false });
const inorder = (...ops: string[]): PipeSnap => ({ width: 1, stages: ops.map((op) => stage(op)) });
/** The hue of a `#rrggbb` colour, in degrees. */
function hue(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b),
    d = mx - Math.min(r, g, b);
  if (d === 0) {
    return 0;
  }
  if (mx === r) {
    return Math.round((((g - b) / d + 6) % 6) * 60);
  }
  if (mx === g) {
    return Math.round(((b - r) / d + 2) * 60);
  }
  return Math.round(((r - g) / d + 4) * 60);
}

const snap = (): CoresSnap => ({
  selected: 1,
  live: [
    { core: 0, hw: 0, parked: false, job: 4096, thread: 0 },
    { core: 1, hw: 1, parked: false, job: 4096, thread: 1 },
    { core: 2, hw: 0, parked: true, job: 0, thread: 0 },
  ],
  tiles: [inorder('add', 'lw', '', '', 'sw'), inorder('', '', 'mul', '', '')],
});

describe('core tiles', () => {
  it('has a tile per logical core, in order, with the selected one marked and the cells of its hardware core', () => {
    const t = tileModels(snap());
    expect(t.map((x) => x.core)).toStrictEqual([0, 1, 2]);
    expect(t.map((x) => x.selected)).toStrictEqual([false, true, false]);
    expect(must(t[0]).cells).toStrictEqual(['alu', 'ld', null, null, 'st']);
    expect(must(t[1]).cells).toStrictEqual([null, null, 'mul', null, null]);
    expect(must(t[0]).label).toBe('C0');
    expect(must(t[0]).sub).toBe('T0');
    expect(must(t[1]).sub).toBe('T1');
  });

  it('an idle parked core shows nothing in its pipeline and says so; a core with no job has no tint', () => {
    const t = must(tileModels(snap())[2]);
    expect(t.tint).toBeNull();
    expect(t.cells.every((c) => c === null)).toBe(true);
    expect(t.sub).toBe('parked');
  });

  it('gives every core its own colour, the same whatever runs on it, and a different one from its neighbours', () => {
    const t = tileModels(snap());
    expect(new Set(t.map((x) => x.color)).size).toBe(3);
    expect(must(t[0]).color).toMatch(/^#[0-9a-f]{6}$/u);
    const many = Array.from({ length: 8 }, (_, k) => coreColor(k));
    expect(new Set(many).size).toBe(8);
    const other = snap();
    other.live[0] = { ...must(other.live[0]), job: 8192, thread: 3 };
    expect(must(tileModels(other)[0]).color).toBe(must(t[0]).color);
  });

  it('carries the rates of its hardware core, none for a parked idle core', () => {
    const t = tileModels(snap(), [
      { ipc: 0.8, stall: 0.25, l2Wait: 0 },
      { ipc: 1.5, stall: 0, l2Wait: 0 },
    ]);
    expect([must(t[0]).ipc, must(t[0]).stall]).toStrictEqual([0.8, 0.25]);
    expect(must(t[1]).ipc).toBe(1.5);
    expect([must(t[2]).ipc, must(t[2]).stall]).toStrictEqual([0, 0]);
    const fresh = tileModels(snap());
    expect(must(fresh[0]).ipc).toBe(0);
  });

  it('tints a thread by its job and its number: one family per job, a different one for another job', () => {
    const a0 = threadTint(4096, 0),
      a5 = threadTint(4096, 5),
      b0 = threadTint(4096 + 64, 0);
    expect(a0).toMatch(/^#[0-9a-f]{6}$/u);
    expect(a0).not.toBe(a5); // another thread of the job: another shade
    expect(Math.abs(hue(a0) - hue(a5))).toBeLessThanOrEqual(2); // the same hue
    expect(Math.abs(hue(a0) - hue(b0))).toBeGreaterThan(5); // another job: another hue
  });

  it('reads the out-of-order engine as its four units and the reorder buffer fill', () => {
    const p: PipeSnap = {
      width: 2,
      stages: [],
      ooo: {
        fetchQ: [],
        decode: [],
        rob: Array.from({ length: 8 }, () => ({ op: '', state: 0 })),
        robHead: 0,
        robCount: 6,
        sched: [],
        units: [
          { op: 'add', left: 1, total: 1 },
          { op: '', left: 0, total: 0 },
          { op: 'mul', left: 2, total: 3 },
          { op: 'lw', left: 1, total: 1 },
        ],
        stall: [0, 0, 0],
      },
    };
    expect(pipeCells(p)).toStrictEqual({ cells: ['alu', null, 'mul', 'ld'], fill: 0.75 });
    expect(pipeCells(snap().tiles.at(99))).toStrictEqual({ cells: [], fill: 0 }); // a tile the snapshot does not have
  });

  it('lays the tiles out in a row that fits', () => {
    const r = tileRect(7, 8, 1000, 10, 200, 60);
    expect(r.x + r.w).toBeLessThanOrEqual(1000.0001);
    expect(tileRect(0, 2, 1000, 10, 200, 60).w).toBe(200);
  });
});

describe('washModels', () => {
  it('groups the logical cores by the hardware core they share, in tile order, and marks the tile of the selected core', () => {
    const w = washModels(snap());
    expect(w.map((x) => [x.hw, x.models.map((m) => m.core), x.selected])).toStrictEqual([
      [0, [0, 2], false],
      [1, [1], true],
    ]);
  });
});

describe('oooStages', () => {
  const o = {
    fetchQ: ['add', 'ld'],
    decode: ['add', ''],
    rob: [
      { op: 'add', state: 3 },
      { op: 'ld', state: 1 },
      { op: '', state: 0 },
      { op: '', state: 0 },
    ],
    robHead: 0,
    robCount: 2,
    sched: [
      { op: 'ld', state: 2 },
      { op: '', state: 0 },
    ],
    units: [
      { op: 'add', left: 1, total: 4 },
      { op: '', left: 0, total: 0 },
      { op: '', left: 0, total: 0 },
      { op: 'ld', left: 0, total: 3 },
    ],
    fetchCap: 8,
    stall: [1, 0, 2] as [number, number, number],
  };
  it('counts what each structure holds against its size', () => {
    const s = oooStages(o);
    expect(s.gauges.map((g) => [g.name, g.used, g.cap])).toStrictEqual([
      ['FETCH', 2, 8],
      ['DECODE', 1, 2],
      ['SCHED', 1, 2],
      ['ROB', 2, 4],
    ]);
  });
  it('names why the front end and commit are stuck', () => {
    const s = oooStages(o);
    expect(must(s.gauges[0]).stall).toBe('queue full');
    expect(must(s.gauges[1]).stall).toBeNull();
    expect(must(s.gauges[3]).stall).toBe('head waiting');
  });
  it('marks finished reorder-buffer entries and the progress of each unit', () => {
    const s = oooStages(o);
    expect(must(s.gauges[3]).slots.map((x) => x.done)).toStrictEqual([true, false]);
    expect(must(s.units[0]).progress).toBeCloseTo(0.75);
    expect(must(s.units[1]).cls).toBeNull();
    expect(must(s.units[3]).progress).toBe(1);
  });
});
