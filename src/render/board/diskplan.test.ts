import { describe, expect, it } from 'vitest';
import type { FsRun } from '../../sim/machine/fs';
import { ARCH, cellsOf, CELL_BLOCKS, counterRows, dieSlices, dimmed, extentRows, flatGrid, headTrack, legendOf, ownerSlot, platterCell, platterOf, queueLanes } from './diskplan';

const run = (start: number, len: number, kind: FsRun['kind'], file = 0, filled = true): FsRun => ({ start, len, kind, file, filled });
const files = [
  { id: 1, owner: 'os', kind: 'os' as const, lost: false }, { id: 2, owner: 'os', kind: 'spool' as const, lost: false },
  { id: 3, owner: 'c1', kind: 'dataset' as const, lost: false }, { id: 4, owner: 'c2', kind: 'dataset' as const, lost: false },
];
// 64 blocks = 8 cells: os 0-7, spool 8-15 (half written), dataset c1 16-27, dataset c2 28-39, lost 40-47, free 48-55, bad 56-63
const runs: FsRun[] = [
  run(0, 8, 'os', 1), run(8, 4, 'spool', 2), run(12, 4, 'spool', 2, false), run(16, 12, 'dataset', 3), run(28, 12, 'dataset', 4), run(40, 8, 'lost', 3),
  run(48, 8, 'free', 0, false), run(56, 8, 'bad', 0, false),
];

describe('cells', () => {
  it('make one cell per 8-block group with the kind that wins', () => {
    const c = cellsOf(runs, 64);
    expect(c).toHaveLength(8);
    expect(c.map((x) => x.kind)).toEqual(['os', 'spool', 'dataset', 'dataset', 'dataset', 'lost', 'free', 'bad']);
    expect(CELL_BLOCKS).toBe(8);
  });

  it('fill is the share of the cell that holds data (a half-written spool slot is half full)', () => {
    const c = cellsOf(runs, 64);
    expect(c[0]!.fill).toBe(1);
    expect(c[1]!.fill).toBe(0.5);
    expect(c[6]!.fill).toBe(0);
    expect(c[7]!.fill).toBe(0);
  });

  it('a cell shared by two datasets goes to the one with more blocks; bad and lost win over data', () => {
    const c = cellsOf([run(0, 3, 'dataset', 3), run(3, 5, 'dataset', 4), run(8, 4, 'dataset', 3), run(12, 4, 'bad', 0, false)], 16);
    expect(c[0]).toMatchObject({ kind: 'dataset', file: 4 });
    expect(c[1]).toMatchObject({ kind: 'bad', file: 0 });
  });

  it('carry the wear of the group, and a drive that is not a whole number of groups ends with a short cell', () => {
    const c = cellsOf([run(0, 10, 'os', 1)], 10, [40, 90]);
    expect(c).toHaveLength(2);
    expect(c.map((x) => x.wear)).toEqual([40, 90]);
    expect(c[1]!.fill).toBe(1);
  });
});

describe('owners and the legend', () => {
  const snap = { fs: { runs, files, fragmentation: 0, byKind: { os: 0, spool: 0, program: 0, dataset: 0, meta: 0 } } };

  it('an owner keeps its colour slot', () => {
    expect(ownerSlot('c1')).toBe(ownerSlot('c1'));
    expect(ownerSlot('c1')).toBeLessThan(4);
    expect(new Set(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(ownerSlot)).size).toBeGreaterThan(1);
  });

  it('lists the system files by kind, one row per dataset owner, then lost, bad and free', () => {
    const rows = legendOf(snap);
    expect(rows.map((r) => r.key)).toEqual(['os', 'spool', 'd:c1', 'd:c2', 'lost', 'bad', 'free']);
    expect(rows.find((r) => r.key === 'spool')!.blocks).toBe(4); // only what is written
    expect(rows.find((r) => r.key === 'd:c1')!.blocks).toBe(12);
    expect(rows.find((r) => r.key === 'lost')!.blocks).toBe(8);
  });

  it('puts the biggest dataset first and drops empty rows', () => {
    const rows = legendOf({ ...snap, fs: { ...snap.fs, runs: [run(0, 4, 'dataset', 3), run(4, 20, 'dataset', 4)] } });
    expect(rows.map((r) => r.key)).toEqual(['d:c2', 'd:c1']);
  });
});

describe('the extent list', () => {
  it('is in LBA order, without free space, capped with the rest counted', () => {
    const e = extentRows({ fs: { runs, files, fragmentation: 0, byKind: { os: 0, spool: 0, program: 0, dataset: 0, meta: 0 } } }, 4);
    expect(e.rows).toHaveLength(4);
    expect(e.rows[0]).toEqual({ start: 0, end: 7, kind: 'os', owner: 'os' });
    expect(e.rows[3]).toMatchObject({ start: 16, end: 27, kind: 'dataset', owner: 'c1' });
    expect(e.more).toBe(3);
    const all = extentRows({ fs: { runs, files, fragmentation: 0, byKind: { os: 0, spool: 0, program: 0, dataset: 0, meta: 0 } } }, 99);
    expect(all.more).toBe(0);
    expect(all.rows.some((r) => r.kind === 'free')).toBe(false);
  });
});

describe('layouts', () => {
  it('a flat grid fills the rectangle in whole cells', () => {
    const g = flatGrid(64, 400, 100);
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(64);
    expect(g.cols).toBeGreaterThan(g.rows); // a wide rectangle gets wide rows
    expect(g.cw * g.cols).toBeCloseTo(400);
    expect(flatGrid(1, 10, 10)).toMatchObject({ cols: 1, rows: 1 });
  });

  it('the platter has rings of sectors and the first blocks are on the outer ring', () => {
    const p = platterOf(48);
    expect(p.tracks * p.sectors).toBeGreaterThanOrEqual(48);
    expect(platterCell(0, p.sectors)).toEqual({ track: 0, sector: 0 });
    expect(platterCell(p.sectors, p.sectors)).toEqual({ track: 1, sector: 0 });
    expect(headTrack(0, 384, p.tracks)).toBe(0);
    expect(headTrack(383, 384, p.tracks)).toBe(p.tracks - 1);
    expect(headTrack(192, 384, p.tracks)).toBe(Math.floor(p.tracks / 2));
    expect(headTrack(9999, 384, p.tracks)).toBe(p.tracks - 1);
  });

  it('flash dies share the cells in order and the channels in turn', () => {
    const d = dieSlices(64, ARCH['ssd-nvme'].dies, ARCH['ssd-nvme'].channels);
    expect(d).toHaveLength(8);
    expect(d.reduce((n, x) => n + x.count, 0)).toBe(64);
    expect(d[1]!.first).toBe(8);
    expect(d.map((x) => x.channel)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(dieSlices(30, 4, 1).reduce((n, x) => n + x.count, 0)).toBe(30);
    expect(dieSlices(30, 4, 1).every((x) => x.cols * x.rows >= x.count)).toBe(true);
  });

  it('the tiers differ: a hard disk has no dies, an NVMe has more dies and channels than a SATA SSD', () => {
    expect(ARCH.hdd.dies).toBe(0);
    expect(ARCH['ssd-nvme'].dies).toBeGreaterThan(ARCH['ssd-sata'].dies);
    expect(ARCH['ssd-nvme'].channels).toBeGreaterThan(ARCH['ssd-sata'].channels);
  });

  it('queue lanes show the waiting requests against the depth', () => {
    expect(queueLanes(0, 16)).toEqual({ lanes: 8, lit: 0 });
    expect(queueLanes(8, 16)).toEqual({ lanes: 8, lit: 4 });
    expect(queueLanes(99, 16)).toEqual({ lanes: 8, lit: 8 });
    expect(queueLanes(1, 2)).toEqual({ lanes: 2, lit: 1 });
  });
});

describe('dimming', () => {
  it('data shows dimmed while the drive is not mounted, and not on a burnt drive (it shows lost)', () => {
    const m = (phase: string) => ({ state: 'clean', phase, progress: 1 }) as never;
    expect(dimmed({ mount: m('mounted'), burnt: false })).toBe(false);
    expect(dimmed({ mount: m('unmounted'), burnt: false })).toBe(true);
    expect(dimmed({ mount: m('scanning'), burnt: false })).toBe(true);
    expect(dimmed({ mount: m('unmounted'), burnt: true })).toBe(false);
  });
});

describe('the counter tier rows', () => {
  const s = {
    name: 'SSD 4K', burnt: false, wearPct: 41.6, badGroups: 1, lostBlocks: 8, mirror: true, queued: 2, queueDepth: 4,
    fs: { runs, fragmentation: 0.25, byKind: { os: 8, spool: 8, program: 0, dataset: 24, meta: 0 }, files },
    mount: { state: 'clean', phase: 'mounted', progress: 1 },
  } as unknown as Parameters<typeof counterRows>[0];

  it('says the title, extents, legend, wear, queue and health in words', () => {
    const r = counterRows(s, 3);
    expect(r.title).toBe('SSD 4K');
    expect(r.extents).toHaveLength(3);
    expect(r.moreExtents).toBe(4);
    expect(r.legend.map((l) => l.key)).toContain('d:c1');
    expect(r.wear).toEqual({ text: 'wear 42%', pct: 42 });
    expect(r.queue).toEqual({ text: 'queue 2/4', lanes: 4, lit: 2 });
    expect(r.health).toBe('frag 25%  bad groups 1  lost 8 blocks  mirrored');
  });

  it('shows a burnt drive as burnt, and the progress of a scan', () => {
    expect(counterRows({ ...s, burnt: true }, 1).state).toBe('BURNT');
    expect(counterRows({ ...s, mount: { state: 'dirty', phase: 'scanning', progress: 0.5 } } as never, 1).state).toBe('dirty · scanning 50%');
  });
});
