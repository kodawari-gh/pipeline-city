// The filesystem ledger of a Disk: which files own which blocks. The media layer (the Disk) always has it, with or
// without an OS. Only an OS may mount a drive and allocate on it (src/sim/game/os.ts); the kernel asm keeps raw LBAs.
// A file is a list of extents. Fixed regions (the boot image, the spool area) are created `at` an LBA; a `soft` file
// owns its blocks but marks the Disk's `used` bitmap only as they are written (the spool). Pure TS, see docs/OS.md.

import type { Disk } from "./storage";

export type FileKind = "os" | "spool" | "program" | "dataset" | "meta";
export const FILE_KINDS: readonly FileKind[] = ["os", "spool", "program", "dataset", "meta"];

/** What the drive's superblock says. `dirty`: a write was cut by a power loss. `damaged`: bad blocks hit metadata. `unformatted`: no filesystem. */
export type MountState = "clean" | "dirty" | "damaged" | "unformatted";

/** Whether the media accepts a file of this kind. Datasets need a `clean` drive; the OS tier check is the game's (`Game.driveCanHold`). */
export function canHold(disk: Disk, kind: FileKind): boolean {
  return kind === "dataset" ? disk.mount === "clean" : disk.mount !== "unformatted";
}

/** Journal blocks an `os3`+ filesystem replays after a power cut. */
export const JOURNAL_BLOCKS = 4;
/** One bitmap block describes this many data blocks, so a scan reads `used / SCAN_SPAN` blocks. */
export const SCAN_SPAN = 64;

/**
 * Device ticks of a boot probe: `scan` reads the allocation metadata (plus a seek for every extra run of data), `repair`
 * is the extra work a `dirty` drive needs: a full pass over the used blocks, or a short journal replay.
 */
export function mountCost(disk: Disk, journaled: boolean): { scan: number; repair: number } {
  const used = disk.usedBlocks;
  const dataRuns = disk.fs.runs().filter((r) => r.kind !== "free" && r.filled).length;
  const seeks = Math.max(0, dataRuns - 1) * disk.latencyTicks;
  const scan = used === 0 ? 0 : Math.ceil(used / SCAN_SPAN) * disk.blockTicks + seeks;
  const repair = journaled ? JOURNAL_BLOCKS * disk.blockTicks + disk.latencyTicks : used * disk.blockTicks + seeks;
  return { scan, repair };
}

export interface Extent { first: number; len: number }

export interface FsFile {
  id: number;
  /** Who the data belongs to: "os" for system files, otherwise a client or contract id. */
  owner: string;
  kind: FileKind;
  extents: Extent[];
  /** Owns its blocks, but the `used` bitmap fills as they are written. */
  soft: boolean;
}

/** One run of blocks for the art: a file kind (or free), whether the blocks hold data, and the file it belongs to. */
export interface FsRun {
  start: number;
  len: number;
  kind: FileKind | "free";
  /** 0 when free. */
  file: number;
  /** The blocks hold data (always true except for the empty part of a soft file and for free runs). */
  filled: boolean;
}

export interface FsUsage {
  totalBlocks: number;
  usedBlocks: number;
  freeBlocks: number;
  byKind: Record<FileKind, number>;
}

export class DiskFs {
  private readonly files = new Map<number, FsFile>();
  /** Block -> id of the file that owns it (0 = none). */
  private readonly owner: Int32Array;
  private nextId = 1;

  constructor(private readonly disk: Disk) {
    this.owner = new Int32Array(disk.blocks);
  }

  /** Forget every file (the drive was formatted). */
  clear(): void {
    this.files.clear();
    this.owner.fill(0);
    this.nextId = 1;
  }

  /** A block no file owns and nothing was written to. */
  private isFree(b: number): boolean {
    return this.owner[b] === 0 && !this.disk.isUsed(b);
  }

  /**
   * Make a file of `blocks` blocks. With `at` it takes exactly that range (null if any block is taken). Without it, it
   * takes the free blocks first-fit and may split over several extents (null if the drive is too full).
   */
  create(owner: string, kind: FileKind, blocks: number, opts: { at?: number; soft?: boolean } = {}): FsFile | null {
    if (blocks < 1 || (kind === "dataset" && !canHold(this.disk, kind))) return null;
    const extents: Extent[] = [];
    if (opts.at !== undefined) {
      const first = opts.at;
      if (first < 0 || first + blocks > this.disk.blocks) return null;
      for (let b = first; b < first + blocks; b++) if (this.owner[b] !== 0 || (!opts.soft && this.disk.isUsed(b) && kind !== "os")) return null;
      extents.push({ first, len: blocks });
    } else {
      let need = blocks;
      let b = 0;
      while (need > 0 && b < this.disk.blocks) {
        if (!this.isFree(b)) { b++; continue; }
        const first = b;
        while (b < this.disk.blocks && b - first < need && this.isFree(b)) b++;
        extents.push({ first, len: b - first });
        need -= b - first;
      }
      if (need > 0) return null;
    }
    const f: FsFile = { id: this.nextId++, owner, kind, extents, soft: !!opts.soft };
    this.files.set(f.id, f);
    for (const e of extents) {
      for (let b = e.first; b < e.first + e.len; b++) this.owner[b] = f.id;
      if (!f.soft) this.disk.reserve(e.first, e.len);
    }
    return f;
  }

  /** Delete a file and free its blocks. */
  remove(id: number): boolean {
    const f = this.files.get(id);
    if (!f) return false;
    for (const e of f.extents) {
      for (let b = e.first; b < e.first + e.len; b++) {
        this.owner[b] = 0;
        this.disk.release(b);
      }
    }
    this.files.delete(id);
    return true;
  }

  file(id: number): FsFile | undefined {
    return this.files.get(id);
  }

  list(kind?: FileKind): FsFile[] {
    const all = [...this.files.values()];
    return kind ? all.filter((f) => f.kind === kind) : all;
  }

  /** Blocks of a file that hold data. */
  filledBlocks(f: FsFile): number {
    if (!f.soft) return f.extents.reduce((n, e) => n + e.len, 0);
    let n = 0;
    for (const e of f.extents) for (let b = e.first; b < e.first + e.len; b++) if (this.disk.isUsed(b)) n++;
    return n;
  }

  usage(): FsUsage {
    const byKind = { os: 0, spool: 0, program: 0, dataset: 0, meta: 0 } satisfies Record<FileKind, number>;
    for (const f of this.files.values()) byKind[f.kind] += this.filledBlocks(f);
    const total = this.disk.blocks;
    return { totalBlocks: total, usedBlocks: this.disk.usedBlocks, freeBlocks: total - this.disk.usedBlocks, byKind };
  }

  /** Every block of the drive as runs, in LBA order, for the art. Blocks written outside any file read as "meta". */
  runs(): FsRun[] {
    const out: FsRun[] = [];
    const n = this.disk.blocks;
    const push = (b: number, kind: FsRun["kind"], file: number, filled: boolean): void => {
      const last = out[out.length - 1];
      if (last && last.kind === kind && last.file === file && last.filled === filled && last.start + last.len === b) last.len++;
      else out.push({ start: b, len: 1, kind, file, filled });
    };
    for (let b = 0; b < n; b++) {
      const id = this.owner[b]!;
      const f = id ? this.files.get(id) : undefined;
      const used = this.disk.isUsed(b);
      if (f) push(b, f.kind, f.id, f.soft ? used : true);
      else if (used) push(b, "meta", 0, true);
      else push(b, "free", 0, false);
    }
    return out;
  }

  /** 0 (all free space in one run) to 1 (free space in many small runs). */
  fragmentation(): number {
    let free = 0;
    let largest = 0;
    let run = 0;
    for (let b = 0; b < this.disk.blocks; b++) {
      if (this.isFree(b)) {
        free++;
        largest = Math.max(largest, ++run);
      } else run = 0;
    }
    return free === 0 ? 0 : 1 - largest / free;
  }
}
