// Game feature: the operating system. Installing it on a drive, reading the kernel's job table out of RAM, and the OS and
// storage snapshots. Every export is a `Game` method (see game.ts).

import { deviceSpec, type InstalledDevice, type StorageSpec } from "../board";
import { BLOCK_BYTES, JobState, KDATA_BASE, KDATA_SLOTS, KSLOT, KSLOT_BYTES, PCH_RESULT_WORDS, PchPhase } from "../isa/memmap";
import { bootImage, queueSlotsFor, SPOOL_BLOCKS_PER_JOB, type OsSpec } from "../os";
import type { Game } from "./game";
import type { InvItem, KernelJob } from "./internal";
import type { KeyActivity, OsJobSnap, OsSnap, Result, StorageSnap } from "./types";

/** Why the OS cannot go on this drive, or null. */
export function osBlock(this: Game, os: OsSpec, d: InstalledDevice): string | null {
  const s = deviceSpec(d);
  if (d.burnt) return `${s.name} is burnt out`;
  const ram = this.installedRamBytes();
  if (ram < os.minRamBytes) return `${os.name} needs ${os.minRamBytes / 1024}K of RAM, only ${ram / 1024}K installed`;
  if (os.needsMmu && !this.cpuHasMmu()) return `${os.name} needs a CPU with an MMU (virtual memory): Tiny-5F or better`;
  const disk = this.diskFor(d);
  const need = os.diskBytes + SPOOL_BLOCKS_PER_JOB * BLOCK_BYTES;
  const free = disk.capacityBytes - disk.usedBytes;
  if (free < need) return `${os.name} needs ${need / 1024}K free on ${s.name}, only ${Math.floor(free / 1024)}K free`;
  return null;
}

export function installOs(this: Game, item: InvItem, os: OsSpec, slotId?: string): Result<{ deviceId: string | null; slot: string }> {
  if (this.powered) return { ok: false, reason: "power the machine off first" };
  if (os.later) return { ok: false, reason: `${os.name} is not available yet` };
  if (this.os) return { ok: false, reason: `${this.os.spec.name} is already installed: uninstall it first` };
  const drives = this.board.devices.filter((d) => deviceSpec(d).kind === "storage" && (slotId === undefined || d.slot === slotId));
  if (drives.length === 0) return { ok: false, reason: slotId === undefined ? "install a storage drive first" : `no storage drive in slot "${slotId}"` };
  let why = "";
  for (const d of drives) {
    const block = this.osBlock(os, d);
    if (block) {
      why ||= block;
      continue;
    }
    this.formatOs(os, d.id, true);
    this.removeItem(item.id);
    this.progress.osInstalled = true;
    this.note("install", `${os.name} installed on ${deviceSpec(d).name}`);
    return { ok: true, deviceId: d.id, slot: d.slot };
  }
  return { ok: false, reason: why };
}

/** Write the boot image to the drive and record the OS (also used when loading a save). */
export function formatOs(this: Game, os: OsSpec, deviceId: string, count = true): void {
  const dev = this.board.devices.find((d) => d.id === deviceId);
  if (!dev || deviceSpec(dev).kind !== "storage") throw new Error("save: the OS drive is missing");
  const disk = this.diskFor(dev);
  const osBlocks = Math.ceil(os.diskBytes / BLOCK_BYTES);
  const queueSlots = queueSlotsFor(os, disk.capacityBytes - disk.usedBytes - os.diskBytes, BLOCK_BYTES);
  if (queueSlots < 1) throw new Error("save: the OS does not fit its drive");
  disk.fs.clear();
  disk.poke(0, this.osBootImage(os, queueSlots));
  disk.reserve(0, osBlocks);
  disk.fs.create("os", "os", osBlocks, { at: 0 });
  disk.fs.create("os", "spool", queueSlots * SPOOL_BLOCKS_PER_JOB, { at: osBlocks, soft: true });
  if (count) disk.bytesWritten += os.diskBytes;
  this.os = { spec: os, deviceId, queueSlots };
}

/** Programs the OS runs at once on this machine: the paged OS uses a second core when the CPU has one, the preemptive OS up to two programs per logical core (docs/MULTICORE.md), every other tier its own number. */
export function osProgramSlots(this: Game, os: OsSpec): number {
  if (os.tier >= 3) return Math.max(os.programSlots, Math.min(8, 2 * this.cpuLogicalCores()));
  return os.tier === 2 ? Math.min(2, this.cpuCores()) : os.programSlots;
}

/** The OS tier boots its multicore kernel on this machine: the paged OS with a second core, the preemptive OS with several logical cores. */
export function osSmp(this: Game, tier: number): boolean {
  return tier === 2 ? this.cpuCores() > 1 : tier >= 3 && this.cpuLogicalCores() > 1;
}

/** The boot area of `os` as this machine needs it (the paged OS has a multicore kernel for a CPU with two cores or more). */
export function osBootImage(this: Game, os: OsSpec, queueSlots: number): Uint8Array {
  return bootImage({ queueSlots, programSlots: this.osProgramSlots(os), spoolLba: Math.ceil(os.diskBytes / BLOCK_BYTES), spoolBlocks: SPOOL_BLOCKS_PER_JOB, tier: os.tier, smp: this.osSmp(os.tier) });
}

/** Write the boot area again, so the kernel on the drive matches the CPU (the player may swap the CPU after installing the OS). Only while off. */
export function refreshBootImage(this: Game): void {
  const os = this.os;
  const dev = os && this.board.devices.find((d) => d.id === os.deviceId);
  if (!os || !dev || dev.burnt || os.spec.tier < 2) return;
  this.diskFor(dev).poke(0, this.osBootImage(os.spec, os.queueSlots));
}

/** Take the OS off its drive (back to the inventory; the drive is wiped). Only while off. */
export function uninstallOs(this: Game): Result<{ invId: string }> {
  if (this.powered) return { ok: false, reason: "power the machine off first" };
  const os = this.os;
  if (!os) return { ok: false, reason: "no OS is installed" };
  this.disks.get(os.deviceId)?.format();
  this.os = null;
  this.returnSpool();
  const invId = `inv${this.nextInvId++}`;
  this.inventory.push({ id: invId, spec: os.spec.id });
  this.note("install", `${os.spec.name} removed`);
  return { ok: true, invId };
}

/** Whether an OS is installed. */
export function hasOs(this: Game): boolean {
  return this.os !== null;
}

/** The kernel's job table, read straight from RAM (empty unless the kernel is up). */
export function kernelJobs(this: Game): KernelJob[] {
  if (!this.powered || !this.pch.osMode || this.postError) return [];
  const bus = this.machine.bus;
  const out: KernelJob[] = [];
  for (let i = 0; i < KDATA_SLOTS; i++) {
    const at = KDATA_BASE + i * KSLOT_BYTES;
    const state = bus.load32(at + KSLOT.STATE);
    if (state === JobState.Free) continue;
    out.push({ slot: i, state, key: bus.load32(at + KSLOT.KEY), len: bus.load32(at + KSLOT.LEN), seq: bus.load32(at + KSLOT.SEQ) });
  }
  return out;
}

/** The result text the kernel kept in job slot `slot` (up to the first NUL). */
export function kernelResult(this: Game, slot: number): string {
  const bus = this.machine.bus;
  let s = "";
  for (let i = 0; i < PCH_RESULT_WORDS * 4; i++) {
    const b = bus.load8(KDATA_BASE + slot * KSLOT_BYTES + KSLOT.RESULT + i);
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s.trimEnd();
}

export function freeKernelSlot(this: Game, keyId: number): void {
  for (const j of this.kernelJobs()) if (j.key === keyId) this.machine.bus.store32(KDATA_BASE + j.slot * KSLOT_BYTES + KSLOT.STATE, JobState.Free);
}

/** The OS is gone: its spooled jobs go back to the offers unserved. */
export function returnSpool(this: Game): void {
  for (const k of this.spool) this.offersQ.giveBack(k);
  this.spool = [];
}

export function storageSnaps(this: Game): StorageSnap[] {
  return this.board.devices.filter((d) => deviceSpec(d).kind === "storage").map((d) => {
    const s = deviceSpec(d) as StorageSpec;
    const disk = this.diskFor(d);
    const port = this.ports.find((p) => p.name === d.slot);
    const clk = this.thermal.state(d.id)?.effClock ?? 0;
    return {
      deviceId: d.id, slot: d.slot, spec: d.spec, name: s.name, burnt: !!d.burnt,
      capacityBytes: disk.capacityBytes, usedBytes: disk.usedBytes, bytesRead: disk.bytesRead, bytesWritten: disk.bytesWritten,
      busy: !!port?.isBusy && port.media === disk, latencyTicks: s.latencyTicks, blockTicks: s.blockTicks,
      bytesPerSecond: Math.round((clk * this.cfg.cpuCyclesPerClock * BLOCK_BYTES) / s.blockTicks),
      hasOs: this.os?.deviceId === d.id,
      fs: { runs: disk.fs.runs(), fragmentation: disk.fs.fragmentation(), byKind: disk.fs.usage().byKind },
    };
  });
}

export function osSnap(this: Game, jobs: KernelJob[]): OsSnap | null {
  const os = this.os;
  if (!os) return null;
  const dev = this.board.devices.find((d) => d.id === os.deviceId)!;
  const running = jobs.find((j) => j.state === JobState.Running);
  const queued = jobs.filter((j) => j.state === JobState.Queued).sort((a, b) => a.seq - b.seq);
  const results = jobs.filter((j) => j.state === JobState.Result).sort((a, b) => a.seq - b.seq);
  const label = (id: number): string => {
    const k = this.plugged?.id === id ? this.plugged : this.spool.find((x) => x.id === id);
    return k ? this.keySnap(k, jobs).label : `key ${id}`;
  };
  const row = (j: KernelJob, state: OsJobSnap["state"], ahead: number): OsJobSnap => ({ slot: j.slot, keyId: j.key, label: label(j.key), state, persisted: true, ahead });
  const spool = this.spoolSnap();
  return {
    spec: os.spec.id, tier: os.spec.tier, name: os.spec.name, deviceId: os.deviceId, slot: dev.slot,
    programSlots: this.osProgramSlots(os.spec), queueSlots: os.queueSlots, up: this.powered && this.pch.osMode && !this.postError,
    queue: [
      ...(running ? [row(running, "running", 0)] : []),
      ...queued.map((j, i) => row(j, "queued", i + (running ? 1 : 0))),
      ...results.map((j) => row(j, "result", -1)),
    ],
    runningKeyId: running?.key ?? null,
    spool,
    spoolFull: spool.full,
  };
}

export function spoolSnap(this: Game): OsSnap["spool"] {
  const slotBytes = SPOOL_BLOCKS_PER_JOB * BLOCK_BYTES;
  const slots = this.os?.queueSlots ?? 0;
  const used = Math.min(slots, this.reserved());
  const dev = this.os && this.board.devices.find((d) => d.id === this.os!.deviceId);
  const free = dev ? this.diskFor(dev).capacityBytes - this.diskFor(dev).usedBytes : 0;
  return { slotBytes, slots, used, freeBytes: free, full: slots > 0 && used >= slots };
}

/** Without an OS the ROM looks at the port once at boot: a key that is in the port after that is never read. */
export function keyIgnored(this: Game): boolean {
  const k = this.plugged;
  return !!k && !k.done && this.powered && !this.os && !this.postError && this.currentPhase() === "halted";
}

export function keyActivity(this: Game): KeyActivity {
  const k = this.plugged;
  if (!k) return "none";
  if (k.done) return "done";
  if (this.pch.flashing) return "flashing";
  if (!this.pch.ready) return "enumerating";
  return this.pch.phase === PchPhase.OsIngest ? "ingesting" : "none";
}
