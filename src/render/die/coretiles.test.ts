import { describe, expect, it } from 'vitest';
import type { CoresSnap, PipeSnap } from '../../sim/game/pipesnap';
import { pipeCells, threadTint, tileModels, tileRect } from './coretiles';

const stage = (op: string) => ({ kind: op ? 1 : 0, id: op ? 1 : -1, op, text: op, cause: 0, stalled: false });
const inorder = (...ops: string[]): PipeSnap => ({ width: 1, stages: ops.map(stage) });
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
    const t = tileModels(snap(), true);
    expect(t.map((x) => x.core)).toEqual([0, 1, 2]);
    expect(t.map((x) => x.selected)).toEqual([false, true, false]);
    expect(t[0]!.cells).toEqual(['alu', 'ld', null, null, 'st']);
    expect(t[1]!.cells).toEqual([null, null, 'mul', null, null]);
    expect(t[0]!.label).toBe('C0');
    expect(t[0]!.sub).toBe('T0');
    expect(t[1]!.sub).toBe('T1');
  });

  it('an idle parked core shows nothing in its pipeline and says so; a core with no job has no tint', () => {
    const t = tileModels(snap(), true)[2]!;
    expect(t.tint).toBeNull();
    expect(t.cells.every((c) => c === null)).toBe(true);
    expect(t.sub).toBe('idle');
  });

  it('tints a thread by its job and its number: one family per job, a different one for another job', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return Math.round(h * 60);
    };
    const a0 = threadTint(4096, 0, true), a5 = threadTint(4096, 5, true), b0 = threadTint(4096 + 64, 0, true);
    expect(a0).toMatch(/^#[0-9a-f]{6}$/);
    expect(a0).not.toBe(a5); // another thread of the job: another shade
    expect(Math.abs(hue(a0) - hue(a5))).toBeLessThanOrEqual(2); // the same hue
    expect(Math.abs(hue(a0) - hue(b0))).toBeGreaterThan(5); // another job: another hue
    expect(threadTint(4096, 0, false)).not.toBe(a0); // the light theme has its own
  });

  it('reads the out-of-order engine as its four units and the reorder buffer fill', () => {
    const p: PipeSnap = { width: 2, stages: [], ooo: {
      fetchQ: [], decode: [], rob: Array.from({ length: 8 }, () => ({ op: '', state: 0 })), robHead: 0, robCount: 6, sched: [],
      units: [{ op: 'add', left: 1, total: 1 }, { op: '', left: 0, total: 0 }, { op: 'mul', left: 2, total: 3 }, { op: 'lw', left: 1, total: 1 }], stall: [0, 0, 0],
    } };
    expect(pipeCells(p)).toEqual({ cells: ['alu', null, 'mul', 'ld'], fill: 0.75 });
    expect(pipeCells(undefined)).toEqual({ cells: [], fill: 0 });
  });

  it('lays the tiles out in a row that fits', () => {
    const r = tileRect(7, 8, 1000, 10, 200, 60);
    expect(r.x + r.w).toBeLessThanOrEqual(1000.0001);
    expect(tileRect(0, 2, 1000, 10, 200, 60).w).toBe(200);
  });
});
