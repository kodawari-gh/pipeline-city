// Block storage as a memory-mapped device. A StoragePort is a fixed bus window per storage slot (sata0, sata1, m20);
// the game attaches a Disk (the "media") when a storage part is installed in that slot. The port runs in its own clock
// domain (named after the slot): a command takes `latencyTicks` (skipped when it continues right after the previous
// block, e.g. a sequential read) plus `blockTicks` to move one block, and the CPU polls STATUS.busy. Registers and
// the buffer window are in src/sim/isa/memmap.ts; see docs/BOARD.md.

import { BLOCK_BYTES, STORAGE_BASE, STORAGE_BUF, STORAGE_REG, STORAGE_STRIDE, StorageStatus } from "../isa/memmap";
import type { Rate } from "./clock";
import type { Device } from "./device";
import { DiskFs, type MountState } from "./fs";
import { Prng } from "./prng";

/** Blocks per wear group: the wear counters and the bad-block marks are kept per group. */
export const GROUP_BLOCKS = 8;

export interface DiskOpts {
  /** Writes one 8-block group takes before it turns bad (each group varies by up to 20% around it). Default: never wears out. */
  enduranceBlocks?: number;
  /** Requests the drive queue holds before it stops serving reads in time. */
  queueDepth?: number;
  /** A seek costs time by LBA distance (a spinning disk) instead of a flat latency. */
  seekByDistance?: boolean;
  /** Chance per write that the group fails mechanically (a spinning disk). */
  mechBadRate?: number;
  /** Seeds the per-group endurance spread and the mechanical failures. */
  seed?: number;
  /** A mirrored module: a second set of media that every write goes to (docs/OS.md, RAID mirror). */
  mirror?: boolean;
}

/** What is physically in the drive: bytes plus the access statistics. */
export class Disk {
  readonly data: Uint8Array;
  readonly blocks: number;
  /** Blocks that hold data: written by a command, or reserved by the OS install. */
  private readonly used: Uint8Array;
  usedBlocks = 0;
  bytesRead = 0;
  bytesWritten = 0;
  /** Device ticks the port spent on commands. */
  busyTicks = 0;
  commands = 0;

  /** Which files own which blocks (docs/OS.md). The media always has it; only an OS allocates on it. */
  readonly fs: DiskFs;
  /** The superblock's verdict. Stays with the drive; `formatOs` sets `clean`, a power cut during a write sets `dirty`. */
  mount: MountState = "unformatted";

  /** Requests waiting at the drive (reads the game queued, see `Game.canServe`). */
  queued = 0;
  readonly queueDepth: number;
  readonly enduranceBlocks: number;
  readonly seekByDistance: boolean;
  readonly seed: number;
  /** Writes each group took, and whether the group is bad. Physical: a format keeps them. */
  readonly wear: Uint32Array;
  private readonly bad: Uint8Array;
  private readonly limit: Uint32Array;
  badGroups = 0;
  /** The second member of a mirrored module (null on a plain drive); it has no ledger of its own. */
  readonly twin: Disk | null;
  private partner: Disk | null = null;
  private readonly mechBadRate: number;
  private readonly rng: Prng;

  constructor(readonly capacityBytes: number, readonly latencyTicks: number, readonly blockTicks: number, opts: DiskOpts = {}) {
    this.blocks = Math.floor(capacityBytes / BLOCK_BYTES);
    this.data = new Uint8Array(this.blocks * BLOCK_BYTES);
    this.used = new Uint8Array(this.blocks);
    this.fs = new DiskFs(this);
    this.enduranceBlocks = opts.enduranceBlocks ?? 1e9;
    this.queueDepth = opts.queueDepth ?? 4;
    this.seekByDistance = !!opts.seekByDistance;
    this.mechBadRate = opts.mechBadRate ?? 0;
    this.seed = opts.seed ?? 1;
    const groups = Math.ceil(this.blocks / GROUP_BLOCKS);
    this.wear = new Uint32Array(groups);
    this.bad = new Uint8Array(groups);
    this.limit = new Uint32Array(groups);
    this.rng = new Prng(this.seed);
    this.twin = opts.mirror ? new Disk(capacityBytes, latencyTicks, blockTicks, { ...opts, mirror: false, seed: (this.seed ^ 0x9e3779b9) >>> 0 }) : null;
    if (this.twin) this.twin.partner = this;
  }

  get groups(): number {
    return this.wear.length;
  }

  /** The group `b` is in has failed (on this member alone). */
  isBad(b: number): boolean {
    return this.bad[Math.floor(b / GROUP_BLOCKS)] === 1;
  }

  /** The block's data is gone: bad here and, on a mirrored module, bad on the other member too. */
  blockLost(b: number): boolean {
    return this.isBad(b) && (!this.twin || this.twin.isBad(b));
  }

  /** Whether any block of the range has lost its data. */
  hasLostBlocks(first: number, len: number): boolean {
    for (let b = first; b < Math.min(this.blocks, first + len); b++) if (this.blockLost(b)) return true;
    return false;
  }

  /** Writes group `g` takes before it fails: the endurance spread +-20% by group, from the seed. */
  limitOf(g: number): number {
    let l = this.limit[g]!;
    if (l === 0) {
      l = Math.max(1, Math.round(this.enduranceBlocks * (0.8 + 0.4 * new Prng((this.seed + g * 2654435761) >>> 0).next())));
      this.limit[g] = l;
    }
    return l;
  }

  /** How worn the media is, 0..100: the most worn group's writes against its endurance (no wear levelling; the worse member of a mirror). */
  get wearPct(): number {
    let worst = 0;
    for (let g = 0; g < this.groups; g++) worst = Math.max(worst, Math.min(1, this.wear[g]! / this.limitOf(g)));
    return Math.max(100 * worst, this.twin?.wearPct ?? 0);
  }

  /** A write landed on `lba`: the group wears, and a worn-out group (or, on a spinning disk, a rare mechanical fault) turns bad. */
  noteWrite(lba: number): void {
    this.twin?.noteWrite(lba);
    const g = Math.floor(lba / GROUP_BLOCKS);
    if (this.bad[g]) return;
    this.wear[g]!++;
    if (this.wear[g]! >= this.limitOf(g) || (this.mechBadRate > 0 && this.rng.next() < this.mechBadRate)) this.failGroup(g);
  }

  /** Turn a group bad. The files with data on lost blocks are marked lost; a bad block under the OS or metadata damages the filesystem. */
  failGroup(g: number): void {
    if (this.bad[g]) return;
    this.bad[g] = 1;
    this.badGroups++;
    (this.partner ?? this).fs.loseBlocks(g * GROUP_BLOCKS, GROUP_BLOCKS);
  }

  /** Delay in device ticks for a command at `lba` when the head is at `from`: flat, or scaled by the distance on a spinning disk. */
  seekTicks(from: number, lba: number): number {
    if (!this.seekByDistance) return this.latencyTicks;
    const frac = Math.abs(lba - from) / Math.max(1, this.blocks - 1);
    return Math.max(1, Math.round(this.latencyTicks * (0.3 + 1.4 * frac)));
  }

  isUsed(b: number): boolean {
    return this.used[b] === 1;
  }

  /** Mark a block as holding no data any more. */
  release(b: number): void {
    if (this.used[b]) {
      this.used[b] = 0;
      this.usedBlocks--;
    }
  }

  /** Mark blocks as occupied (capacity the OS or its files take) without counting traffic. */
  reserve(first: number, count: number): void {
    for (let b = first; b < Math.min(this.blocks, first + count); b++) this.markUsed(b);
  }

  markUsed(b: number): void {
    if (!this.used[b]) {
      this.used[b] = 1;
      this.usedBlocks++;
    }
  }

  /** Wipe the media (the OS was uninstalled). Traffic counters stay. */
  format(): void {
    this.data.fill(0);
    this.used.fill(0);
    this.usedBlocks = 0;
    this.fs.clear();
    this.mount = "unformatted";
    this.queued = 0;
    this.twin?.format();
  }

  get usedBytes(): number {
    return this.usedBlocks * BLOCK_BYTES;
  }

  /** Put bytes straight into the media (the OS installer; not a bus access, so not counted as traffic). */
  poke(block: number, bytes: Uint8Array): void {
    this.data.set(bytes.subarray(0, Math.max(0, this.data.length - block * BLOCK_BYTES)), block * BLOCK_BYTES);
    this.reserve(block, Math.ceil(bytes.length / BLOCK_BYTES));
  }
}

export class StoragePort implements Device {
  readonly size = STORAGE_STRIDE;
  readonly base: number;
  /** Starts stopped; the game sets the rate from the installed part's (throttled) clock. */
  readonly clock: Rate = { mul: 0, div: 1 };
  media: Disk | null = null;

  private readonly regs = new Uint8Array(16);
  private readonly buf = new Uint8Array(BLOCK_BYTES);
  private readonly latch = new Uint8Array(BLOCK_BYTES);
  private busy = 0;
  private cmd = 0;
  private error = false;
  private lastLba = -2;
  /** Where the head rests (the last block moved). */
  private head = 0;
  /** Set by every command, cleared by `takeActivity` (the game reads it for the thermal load and the LED). */
  active = false;

  constructor(readonly name: string, index: number) {
    this.base = STORAGE_BASE + index * STORAGE_STRIDE;
  }

  /** Attach (or remove) the drive. Forgets any command in flight. */
  attach(media: Disk | null): void {
    if (media === this.media) return;
    this.cutPower();
    this.media = media;
    this.reset();
  }

  /** The power went (or the drive dropped off the bus) with a write in flight: the torn write leaves the drive `dirty`. */
  cutPower(): void {
    if (this.busy > 0 && this.cmd === 2 && this.media?.mount === "clean") this.media.mount = "dirty";
  }

  /** Power-on reset: no command in flight, head position forgotten. */
  reset(): void {
    this.busy = 0;
    this.cmd = 0;
    this.error = false;
    this.lastLba = -2;
    this.head = 0;
    this.regs.fill(0);
    this.buf.fill(0);
  }

  get isBusy(): boolean {
    return this.busy > 0;
  }

  /** Requests ahead of a new one: the ones queued at the drive plus the command on the bus. */
  queueLoad(): number {
    return (this.media?.queued ?? 0) + (this.busy > 0 ? 1 : 0);
  }

  private get lba(): number {
    return (this.regs[STORAGE_REG.LBA]! | (this.regs[STORAGE_REG.LBA + 1]! << 8) | (this.regs[STORAGE_REG.LBA + 2]! << 16) | (this.regs[STORAGE_REG.LBA + 3]! << 24)) >>> 0;
  }

  read(off: number): number {
    if (off >= STORAGE_BUF) return off < STORAGE_BUF + BLOCK_BYTES ? this.buf[off - STORAGE_BUF]! : 0;
    const reg = off & ~3;
    let w = 0;
    switch (reg) {
      case STORAGE_REG.STATUS: w = (this.busy > 0 ? StorageStatus.Busy : 0) | (this.error ? StorageStatus.Error : 0) | (this.media ? StorageStatus.Present : 0); break;
      case STORAGE_REG.LBA: w = this.lba; break;
      case STORAGE_REG.BLOCKS: w = this.media?.blocks ?? 0; break;
    }
    return (w >>> (8 * (off & 3))) & 0xff;
  }

  write(off: number, val: number): void {
    if (off >= STORAGE_BUF) {
      if (off < STORAGE_BUF + BLOCK_BYTES) this.buf[off - STORAGE_BUF] = val & 0xff;
      return;
    }
    if (off === STORAGE_REG.LBA || off === STORAGE_REG.LBA + 1 || off === STORAGE_REG.LBA + 2 || off === STORAGE_REG.LBA + 3) {
      this.regs[off] = val & 0xff;
    } else if (off === STORAGE_REG.CMD) {
      this.start(val & 0xff); // the command fires on the low byte, after the LBA word has landed
    }
  }

  private start(cmd: number): void {
    const m = this.media;
    const lba = this.lba;
    if (this.busy > 0 || !m || (cmd !== 1 && cmd !== 2) || lba >= m.blocks) {
      this.error = true;
      return;
    }
    this.error = false;
    this.cmd = cmd;
    this.active = true;
    if (cmd === 2) this.latch.set(this.buf);
    const seq = lba === this.lastLba + 1;
    this.busy = (seq ? 0 : m.seekTicks(this.head, lba)) + m.blockTicks;
    m.commands++;
  }

  tick(): void {
    if (this.busy <= 0) return;
    const m = this.media;
    if (!m) {
      this.busy = 0;
      return;
    }
    m.busyTicks++;
    if (--this.busy > 0) return;
    const lba = this.lba;
    const at = lba * BLOCK_BYTES;
    if (this.cmd === 1) {
      this.buf.set(m.data.subarray(at, at + BLOCK_BYTES));
      m.bytesRead += BLOCK_BYTES;
    } else {
      m.data.set(this.latch, at);
      m.markUsed(lba);
      m.bytesWritten += BLOCK_BYTES;
      m.noteWrite(lba);
    }
    this.lastLba = lba;
    this.head = lba;
    this.cmd = 0;
  }

  /** Whether the port did anything since the last call (and clear the flag). */
  takeActivity(): boolean {
    const a = this.active || this.busy > 0;
    this.active = false;
    return a;
  }
}
