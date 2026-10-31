// The plan of a disk's art: pure maths, no Pixi. It turns what the sim says is on the drive (`StorageSnap.fs`: runs of blocks, the files that own them, the
// wear of each group) into cells to draw: one cell per 8-block group, coloured by what it holds, then lays the cells out per tier (the HDD's rings of
// sectors, the SATA SSD's four NAND dies, the NVMe's eight dies on four channels). `diskart.ts` draws it, `diskview.ts` animates it. Tested in diskplan.test.ts.

import type { FsRun } from '../../sim/machine/fs';
import type { StorageSnap } from '../../sim/game/types';
import type { DriveKind } from './drives';

/** Blocks in one cell (the media's wear group, `GROUP_BLOCKS` in sim/machine/storage.ts). */
export const CELL_BLOCKS = 8;

export type CellKind = 'os' | 'spool' | 'program' | 'dataset' | 'meta' | 'free' | 'bad' | 'lost';

/** What wins when a cell holds blocks of several kinds: the worst news first, then what the system owns, then data, then free space. */
const RANK: Record<CellKind, number> = { bad: 7, lost: 6, os: 5, spool: 4, program: 3, dataset: 2, meta: 1, free: 0 };

export interface Cell {
  kind: CellKind;
  /** Share of the cell's blocks that hold data, 0..1 (a spool slot fills as jobs land; free is 0). */
  fill: number;
  /** The file that owns most of the cell (0 = none): datasets are coloured by owner. */
  file: number;
  /** Wear of the group, percent of its endurance. */
  wear: number;
}

/** One cell per group, from the runs of the ledger and the wear of each group. */
export function cellsOf(runs: readonly FsRun[], totalBlocks: number, wear: readonly number[] = []): Cell[] {
  const n = Math.ceil(totalBlocks / CELL_BLOCKS);
  const kind: CellKind[] = new Array(n).fill('free');
  const filled = new Array<number>(n).fill(0);
  const own = new Array<Map<number, number>>(n);
  for (const r of runs) {
    const first = Math.floor(r.start / CELL_BLOCKS), last = Math.floor((r.start + r.len - 1) / CELL_BLOCKS);
    for (let c = first; c <= last && c < n; c++) {
      const lo = Math.max(r.start, c * CELL_BLOCKS), hi = Math.min(r.start + r.len, (c + 1) * CELL_BLOCKS);
      const k = r.kind;
      if (RANK[k] > RANK[kind[c]!]) kind[c] = k;
      if (r.filled && k !== 'free' && k !== 'bad') filled[c]! += hi - lo;
      if (r.file) (own[c] ??= new Map()).set(r.file, (own[c]?.get(r.file) ?? 0) + (hi - lo));
    }
  }
  return kind.map((k, c) => {
    let file = 0, best = 0;
    for (const [f, v] of own[c] ?? []) if (v > best) { best = v; file = f; }
    const size = Math.min(CELL_BLOCKS, totalBlocks - c * CELL_BLOCKS);
    return { kind: k, fill: k === 'free' || k === 'bad' ? 0 : Math.min(1, filled[c]! / size), file: k === 'bad' ? 0 : file, wear: wear[c] ?? 0 };
  });
}

/** Number of owner colours the art has for datasets (more owners share them). */
export const OWNER_COLORS = 4;

/** A stable colour slot for an owner id ("c12" and "c13" differ; the same owner is always the same). */
export function ownerSlot(owner: string): number {
  let h = 0;
  for (let i = 0; i < owner.length; i++) h = (h * 31 + owner.charCodeAt(i)) >>> 0;
  return h % OWNER_COLORS;
}

/** One line of the legend: what it is, how many blocks, and for datasets the colour slot of the owner. */
export interface LegendRow { key: string; label: string; kind: CellKind; blocks: number; slot: number }

/** The legend of a drive: the system's files by kind, one row per dataset owner, then lost, bad and free; empty rows left out, biggest datasets first. */
export function legendOf(s: Pick<StorageSnap, "fs">): LegendRow[] {
  const owners = new Map(s.fs.files.map((f) => [f.id, f]));
  const sys: Record<string, number> = { os: 0, spool: 0, program: 0, meta: 0 };
  const data = new Map<string, number>();
  let lost = 0, bad = 0, free = 0;
  for (const r of s.fs.runs) {
    if (r.kind === 'free') { free += r.len; continue; }
    if (r.kind === 'bad') { bad += r.len; continue; }
    if (r.kind === 'lost') { lost += r.len; continue; }
    const filled = r.filled ? r.len : 0;
    if (r.kind === 'dataset') { const o = owners.get(r.file)?.owner ?? '?'; data.set(o, (data.get(o) ?? 0) + r.len); }
    else sys[r.kind] = (sys[r.kind] ?? 0) + (r.kind === 'spool' ? filled : r.len);
  }
  const rows: LegendRow[] = [];
  const add = (key: string, label: string, kind: CellKind, blocks: number, slot = 0) => { if (blocks > 0) rows.push({ key, label, kind, blocks, slot }); };
  add('os', 'OS', 'os', sys.os ?? 0);
  add('spool', 'Spool', 'spool', sys.spool ?? 0);
  add('program', 'Programs', 'program', sys.program ?? 0);
  add('meta', 'Other', 'meta', sys.meta ?? 0);
  for (const [o, v] of [...data].sort((a, b) => b[1] - a[1])) add(`d:${o}`, o, 'dataset', v, ownerSlot(o));
  add('lost', 'Lost', 'lost', lost);
  add('bad', 'Bad blocks', 'bad', bad);
  add('free', 'Free', 'free', free);
  return rows;
}

/** One row of the extent list: blocks `start..end` (inclusive), what they are and whose. */
export interface ExtentRow { start: number; end: number; kind: CellKind; owner: string }

/** The extents in LBA order, free space left out, at most `max` rows (the rest counted in `more`). */
export function extentRows(s: Pick<StorageSnap, 'fs'>, max: number): { rows: ExtentRow[]; more: number } {
  const owners = new Map(s.fs.files.map((f) => [f.id, f.owner]));
  const all: ExtentRow[] = [];
  for (const r of s.fs.runs) {
    if (r.kind === 'free') continue;
    all.push({ start: r.start, end: r.start + r.len - 1, kind: r.kind, owner: r.kind === 'bad' ? '' : owners.get(r.file) ?? (r.kind === 'meta' ? 'raw' : '') });
  }
  return { rows: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/** A grid for `n` cells that fills a `w` by `h` rectangle: the columns and rows, and the cell size. */
export function flatGrid(n: number, w: number, h: number): { cols: number; rows: number; cw: number; ch: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt((n * w) / Math.max(1, h))));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows, cw: w / cols, ch: h / rows };
}

/** The platter of a hard disk: `tracks` rings (the outer one first: the first blocks lie on it) of `sectors` cells each. */
export function platterOf(n: number): { tracks: number; sectors: number } {
  const tracks = Math.max(1, Math.min(8, Math.round(Math.sqrt(n / 4))));
  return { tracks, sectors: Math.ceil(n / tracks) };
}

/** Track and sector of cell `i` on the platter. */
export const platterCell = (i: number, sectors: number): { track: number; sector: number } => ({ track: Math.floor(i / sectors), sector: i % sectors });

/** The track the head sits on for block `lba` (the first blocks are on the outer track 0). */
export function headTrack(lba: number, totalBlocks: number, tracks: number): number {
  return Math.min(tracks - 1, Math.max(0, Math.floor((lba / Math.max(1, totalBlocks)) * tracks)));
}

/** The NAND dies of a flash drive: `dies` equal slices of the cells, in order, each with its own grid of `cols` columns. */
export interface DieSlice { index: number; first: number; count: number; cols: number; rows: number; channel: number }

export function dieSlices(n: number, dies: number, channels: number): DieSlice[] {
  const per = Math.ceil(n / dies);
  const out: DieSlice[] = [];
  for (let d = 0; d < dies; d++) {
    const first = d * per, count = Math.max(0, Math.min(per, n - first));
    const cols = Math.max(1, Math.ceil(Math.sqrt(per / 1.4)));
    out.push({ index: d, first, count, cols, rows: Math.max(1, Math.ceil(per / cols)), channel: d % channels });
  }
  return out;
}

/** What each tier is made of: NAND dies and channels (an HDD has none), the share of its queue the lanes show. */
export const ARCH: Record<DriveKind, { dies: number; channels: number }> = {
  hdd: { dies: 0, channels: 0 },
  'ssd-sata': { dies: 4, channels: 1 },
  'ssd-nvme': { dies: 8, channels: 4 },
};

/** The queue lanes a drive draws: one per slot of its depth up to 8, lit for the requests waiting. */
export function queueLanes(queued: number, depth: number): { lanes: number; lit: number } {
  const lanes = Math.max(1, Math.min(8, depth));
  return { lanes, lit: Math.max(0, Math.min(lanes, Math.ceil((queued / Math.max(1, depth)) * lanes))) };
}

/** What the counter tier says, as text (the view only places it). */
export interface CounterRows {
  title: string;
  state: string;
  extents: string[];
  moreExtents: number;
  legend: LegendRow[];
  wear: { text: string; pct: number };
  queue: { text: string; lanes: number; lit: number };
  health: string;
}

const MOUNT_WORD: Record<string, string> = { unmounted: 'unmounted', scanning: 'scanning', repairing: 'repairing', mounted: 'mounted' };

export function counterRows(s: StorageSnap, maxExtents: number): CounterRows {
  const { rows, more } = extentRows(s, maxExtents);
  const pct = Math.round(s.wearPct);
  const q = queueLanes(s.queued, s.queueDepth);
  const frag = Math.round(s.fs.fragmentation * 100);
  const state = s.burnt ? 'BURNT' : s.mount.state === 'unformatted' ? 'unformatted' : `${s.mount.state} · ${MOUNT_WORD[s.mount.phase] ?? s.mount.phase}${s.mount.phase === 'scanning' || s.mount.phase === 'repairing' ? ` ${Math.round(s.mount.progress * 100)}%` : ''}`;
  const parts = [`frag ${frag}%`];
  if (s.badGroups > 0) parts.push(`bad groups ${s.badGroups}`);
  if (s.lostBlocks > 0) parts.push(`lost ${s.lostBlocks} blocks`);
  if (s.mirror) parts.push('mirrored');
  return {
    title: s.name,
    state,
    extents: rows.map((r) => `${r.start}-${r.end}  ${r.kind}${r.owner && r.owner !== r.kind ? ` ${r.owner}` : ''}`),
    moreExtents: more,
    legend: legendOf(s),
    wear: { text: `wear ${pct}%`, pct: Math.min(100, Math.max(0, pct)) },
    queue: { text: `queue ${s.queued}/${s.queueDepth}`, lanes: q.lanes, lit: q.lit },
    health: parts.join('  '),
  };
}

/** Whether the data shows dimmed: the drive is not mounted (the OS is down, or it is unformatted). A burnt drive shows everything lost instead. */
export const dimmed = (s: Pick<StorageSnap, 'mount' | 'burnt'>): boolean => !s.burnt && s.mount.phase !== 'mounted';
