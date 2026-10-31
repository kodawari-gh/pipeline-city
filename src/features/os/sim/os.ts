// Game feature: the operating system. Installing it on a drive, reading the kernel's job table out of RAM, and the OS and
// storage snapshots. Every export is a `Game` method (see game.ts).

import { deviceSpec, type InstalledDevice, type StorageSpec } from "../../board/sim";
import { BLOCK_BYTES, JobState, KDATA_BASE, KDATA_SLOTS, KSLOT, KSLOT_BYTES, PCH_RESULT_WORDS, PchPhase, SPOOL_PORT_SHIFT, STORAGE_PORTS } from "@/core/sim/memmap";
import { canHold, mountCost, type FileKind, type MountState } from "../../storage/sim/fs";
import { bootImage, MAX_QUEUE_SLOTS, queueSlotsFor, SPOOL_BLOCKS_PER_JOB, type OsSpec } from ".";
import type { Game } from "@/worker/game/game";
import type { DriveMount, InvItem, KernelJob } from "@/worker/game/internal";
import type { KeyActivity, OsJobSnap, OsSnap, Result, StorageSnap } from "@/worker/game/types";

/** Why the OS cannot go on this drive, or null. */
export function osBlock(this: Game, os: OsSpec, d: InstalledDevice): string | null {
  const s = deviceSpec(d);
  if (d.burnt) return `${s.name} is burnt out`;
  const ram = this.installedRamBytes();
  if (ram < os.minRamBytes) return `${os.name} needs ${os.minRamBytes / 1024}K of RAM, only ${ram / 1024}K installed`;
  if (os.needsMmu && !this.cpuHasMmu()) return `${os.name} needs a CPU with an MMU (virtual memory): Tiny-5F or better`;
  if ((s as StorageSpec).mirror) return `${os.name} cannot boot from a RAID module: it holds data volumes only`;
  const disk = this.diskFor(d);
  const need = os.diskBytes + SPOOL_BLOCKS_PER_JOB * BLOCK_BYTES;
  if (disk.hasLostBlocks(0, Math.ceil(need / BLOCK_BYTES))) return `${s.name} has bad blocks where ${os.name} must go`;
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
  disk.mount = "clean";
  disk.reserve(0, osBlocks);
  disk.fs.create("os", "os", osBlocks, { at: 0 });
  disk.fs.create("os", "spool", queueSlots * SPOOL_BLOCKS_PER_JOB, { at: osBlocks, soft: true });
  if (count) disk.bytesWritten += os.diskBytes;
  this.os = { spec: os, deviceId, queueSlots, homeSlots: queueSlots };
  // A new install adds the spool areas on the other drives now. A save load waits for power-on: the other drives' ledgers are not back yet.
  disk.poke(0, this.osBootImage(os, count ? this.layoutSpool() : Array.from({ length: queueSlots }, (_, i) => osBlocks + i * SPOOL_BLOCKS_PER_JOB)));
}

/** Why drive `d` holds no spool slot beyond the OS drive's own, or null when it may. `menuOff`: also refuse a drive the OS menu turned off (the layout does; the menu shows the other reasons only). */
export function spoolDriveWhy(this: Game, d: InstalledDevice, menuOff = true): string | null {
  const os = this.os!, s = deviceSpec(d) as StorageSpec;
  if (menuOff && this.osCfg.spoolOff.includes(d.id)) return "turned off in the OS menu";
  if (d.burnt) return `${s.name} is burnt out`;
  if (d.id === os.deviceId) return null;
  if (os.spec.fsTier < 2) return `${os.spec.name} spools on its own drive only`;
  if (s.mirror) return "a RAID module holds data volumes only";
  const disk = this.diskFor(d);
  if (disk.mount !== "clean" || STORAGE_PORTS.indexOf(d.slot) < 0) return "not formatted clean";
  return null;
}

/** The most queue slots now: what the OS allows, or less when the OS menu asks for fewer. */
export function spoolTarget(this: Game): number {
  const cap = Math.min(this.os!.spec.queueSlots, MAX_QUEUE_SLOTS);
  return Math.max(1, Math.min(cap, this.osCfg.spoolSlots ?? cap));
}

/**
 * Where the queue slots' spool areas are: first the OS drive's own (`homeSlots`), then, from the paged OS on (filesystem tier 2), the free room of the other
 * data drives, fastest first, up to the wanted slots (`spoolTarget`). A small OS drive no longer caps the queue. A drive the OS menu turned off holds none.
 * The old spool areas on the other drives are dropped and made again, so a drive that was added, wiped, burnt or left dirty is taken into account.
 * Returns the spool map of the boot header and sets `queueSlots` and `spoolPlan`.
 */
export function layoutSpool(this: Game): number[] {
  const os = this.os!;
  const home = this.board.devices.find((d) => d.id === os.deviceId)!;
  const first = Math.ceil(os.spec.diskBytes / BLOCK_BYTES);
  const target = this.spoolTarget();
  const map: number[] = [];
  const homeN = this.spoolDriveWhy(home) ? 0 : Math.min(os.homeSlots, target);
  for (let i = 0; i < homeN; i++) map.push(first + i * SPOOL_BLOCKS_PER_JOB);
  this.spoolPlan = [{ deviceId: home.id, slots: homeN }];
  const others = this.board.devices.filter((d) => d.id !== home.id && deviceSpec(d).kind === "storage");
  for (const d of others) {
    const fs = this.disks.get(d.id)?.fs;
    if (fs) for (const f of fs.list("spool")) fs.remove(f.id);
  }
  for (const d of others.filter((x) => !this.spoolDriveWhy(x)).sort((a, b) => deviceSpec(b).tier - deviceSpec(a).tier)) {
    const disk = this.diskFor(d);
    const port = STORAGE_PORTS.indexOf(d.slot);
    let n = Math.min(target - map.length, Math.floor((disk.capacityBytes - disk.usedBytes) / (SPOOL_BLOCKS_PER_JOB * BLOCK_BYTES)));
    for (; n > 0; n--) { // one run of blocks, so the slots follow one another
      const f = disk.fs.create("os", "spool", n * SPOOL_BLOCKS_PER_JOB, { soft: true });
      if (f && f.extents.length === 1) {
        for (let i = 0; i < n; i++) map.push((port + 1) * 2 ** SPOOL_PORT_SHIFT + f.extents[0]!.first + i * SPOOL_BLOCKS_PER_JOB);
        this.spoolPlan.push({ deviceId: d.id, slots: n });
        break;
      }
      if (f) disk.fs.remove(f.id);
    }
  }
  if (map.length === 0) { // never none: the OS drive keeps one slot
    map.push(first);
    this.spoolPlan[0]!.slots = 1;
  }
  os.queueSlots = map.length;
  return map;
}

/** OS menu: the most queue slots wanted (null: as many as the OS allows). Takes effect at the next power-on (at once while off). */
export function setSpoolSlots(this: Game, slots: number | null): Result<{ slots: number | null }> {
  if (!this.os) return { ok: false, reason: "no OS is installed" };
  if (slots !== null && (!Number.isInteger(slots) || slots < 1)) return { ok: false, reason: "at least one queue slot" };
  this.osCfg.spoolSlots = slots === null || slots >= Math.min(this.os.spec.queueSlots, MAX_QUEUE_SLOTS) ? null : slots;
  if (!this.powered) this.refreshBootImage();
  return { ok: true, slots: this.osCfg.spoolSlots };
}

/** OS menu: let a drive hold spool slots or not. Takes effect at the next power-on (at once while off). */
export function setSpoolDrive(this: Game, deviceId: string, on: boolean): Result<{ on: boolean }> {
  if (!this.os) return { ok: false, reason: "no OS is installed" };
  const d = this.board.devices.find((x) => x.id === deviceId);
  if (!d || deviceSpec(d).kind !== "storage") return { ok: false, reason: "no such drive" };
  const off = new Set(this.osCfg.spoolOff);
  if (on) off.delete(deviceId); else off.add(deviceId);
  this.osCfg.spoolOff = [...off];
  if (!this.powered) this.refreshBootImage();
  return { ok: true, on };
}

/** Why this drive cannot be formatted now, or null. Formatting needs an OS with allocation (filesystem tier 2+), a data drive and a powered-off machine. */
export function formatBlock(this: Game, deviceId: string): string | null {
  const dev = this.board.devices.find((d) => d.id === deviceId);
  if (!dev || deviceSpec(dev).kind !== "storage") return "no such drive";
  if (dev.burnt) return `${deviceSpec(dev).name} is burnt out`;
  if (this.powered) return "power the machine off first";
  if (!this.os) return "needs an OS that can format drives: Paged OS 2.0 or better";
  if (this.os.spec.fsTier < 2) return `${this.os.spec.name} cannot format drives: Paged OS 2.0 or better`;
  if (this.os.deviceId === deviceId) return "this drive holds the OS: uninstall the OS to wipe it";
  return null;
}

/** Format a data drive with the OS's filesystem: the ledger is wiped and the drive turns `clean`. Datasets on it are lost, so they need `confirm`. */
export function formatDrive(this: Game, deviceId: string, confirm = false): Result<{ wiped: number }> {
  const why = this.formatBlock(deviceId);
  if (why) return { ok: false, reason: why };
  const disk = this.disks.get(deviceId) ?? this.diskFor(this.board.devices.find((d) => d.id === deviceId)!);
  const wiped = disk.fs.list("dataset").length;
  if (wiped > 0 && !confirm) return { ok: false, reason: `${wiped} dataset${wiped === 1 ? "" : "s"} on this drive would be lost: confirm to format` };
  disk.format();
  disk.mount = "clean";
  this.note("install", `${deviceSpec(this.board.devices.find((d) => d.id === deviceId)!).name} formatted`);
  return { ok: true, wiped };
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
export function osBootImage(this: Game, os: OsSpec, spoolMap: number[]): Uint8Array {
  return bootImage({ queueSlots: spoolMap.length, programSlots: this.osProgramSlots(os), spoolLba: Math.ceil(os.diskBytes / BLOCK_BYTES), spoolBlocks: SPOOL_BLOCKS_PER_JOB, spoolMap, tier: os.tier, smp: this.osSmp(os.tier) });
}

/** Write the boot area again, so the kernel on the drive matches the CPU and the spool areas match the drives (the player may swap either after installing the OS). Only while off. */
export function refreshBootImage(this: Game): void {
  const os = this.os;
  const dev = os && this.board.devices.find((d) => d.id === os.deviceId);
  if (!os || !dev || dev.burnt) return;
  this.diskFor(dev).poke(0, this.osBootImage(os.spec, this.layoutSpool()));
}

/** Take the OS off its drive (back to the inventory; the drive is wiped). Only while off. */
export function uninstallOs(this: Game): Result<{ invId: string }> {
  if (this.powered) return { ok: false, reason: "power the machine off first" };
  const os = this.os;
  if (!os) return { ok: false, reason: "no OS is installed" };
  this.disks.get(os.deviceId)?.format();
  for (const [id, disk] of this.disks) if (id !== os.deviceId) for (const f of disk.fs.list("spool")) disk.fs.remove(f.id); // (the spool areas on the other drives)
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

/**
 * The OS probes every drive on the bus at boot (after POST). Each drive gets a scan, and a `dirty` one a repair pass
 * (a full pass on filesystem tier 1 and 2, a short journal replay from tier 3). The probes run in parallel, so the CPU
 * waits for the slowest. An unformatted drive stays unmounted. Returns the base ticks to wait. No OS: nothing mounts.
 */
export function startMountScan(this: Game): number {
  this.mounts.clear();
  const os = this.osPort() ? this.os : null;
  if (!os) return 0;
  const perTick = this.cfg.cpuCyclesPerClock;
  let longest = 0;
  for (const port of this.ports) {
    const disk = port.media;
    const dev = this.board.devices.find((d) => d.slot === port.name && d.id && this.disks.get(d.id) === disk);
    if (!disk || !dev) continue;
    if (disk.mount === "unformatted") {
      this.mounts.set(dev.id, { phase: "unmounted", scanTicks: 0, repairTicks: 0, left: 0 });
      continue;
    }
    if (disk.twin && os.spec.fsTier < 4) {
      this.mounts.set(dev.id, { phase: "unmounted", scanTicks: 0, repairTicks: 0, left: 0 });
      continue;
    }
    const cost = mountCost(disk, os.spec.fsTier >= 3);
    const scanTicks = Math.ceil(cost.scan / perTick);
    const repairTicks = disk.mount === "dirty" ? Math.ceil(cost.repair / perTick) : 0;
    const left = scanTicks + repairTicks;
    this.mounts.set(dev.id, { phase: left > 0 ? "scanning" : "mounted", scanTicks, repairTicks, left });
    longest = Math.max(longest, left);
  }
  return longest;
}

/** One base tick of the boot probe: the scans count down, a repaired drive turns `clean`. */
export function mountTick(this: Game): void {
  for (const [id, m] of this.mounts) {
    if (m.left <= 0) continue;
    m.left--;
    m.phase = m.left > m.repairTicks ? "scanning" : m.left > 0 ? "repairing" : "mounted";
    if (m.left === 0 && m.repairTicks > 0) {
      const disk = this.disks.get(id);
      if (disk?.mount === "dirty") disk.mount = "clean";
    }
  }
}

/** Base ticks of boot probe still to run (the CPU waits for them). */
export function mountTicksLeft(this: Game): number {
  let n = 0;
  for (const m of this.mounts.values()) n = Math.max(n, m.left);
  return n;
}

/** Progress (0..1) of the slowest drive still being probed. */
export function mountProgress(this: Game): number {
  let slowest: DriveMount | null = null;
  for (const m of this.mounts.values()) if (m.left > (slowest?.left ?? 0)) slowest = m;
  return slowest ? 1 - slowest.left / (slowest.scanTicks + slowest.repairTicks) : 1;
}

/** The OS has the drive mounted. */
export function isMounted(this: Game, deviceId: string): boolean {
  return this.powered && this.mounts.get(deviceId)?.phase === "mounted";
}

/** Whether a file of `kind` may go on this drive now: the OS is up with the drive mounted, the superblock is `clean` for a dataset, and the OS's filesystem tier allows datasets (tier 2+). */
export function driveCanHold(this: Game, deviceId: string, kind: FileKind): boolean {
  const disk = this.disks.get(deviceId);
  const os = this.os;
  if (!disk || !os || !this.isMounted(deviceId)) return false;
  if (kind === "dataset" && os.spec.fsTier < 2) return false;
  if (disk.twin && os.spec.fsTier < 4) return false;
  return canHold(disk, kind);
}

/** The OS is up: the machine is on, booted into the kernel and past POST. */
export function osUp(this: Game): boolean {
  return !!this.os && this.powered && this.pch.osMode && !this.postError;
}

/**
 * Whether a read of file `fileId` on drive `deviceId` can be served now. No when the drive is burnt or off the bus, the
 * OS is down, the drive is not mounted, the data is lost, or the drive queue is deeper than its `queueDepth`.
 */
export function canServe(this: Game, deviceId: string, fileId: number): boolean {
  if (!this.driveUp(deviceId)) return false;
  const disk = this.disks.get(deviceId)!;
  const f = disk.fs.file(fileId);
  if (!f || f.lost) return false;
  const port = this.ports.find((p) => p.media === disk)!;
  return port.queueLoad() <= disk.queueDepth;
}

/** The drive can serve at all: not burnt, on the bus, the OS up and the drive mounted. */
export function driveUp(this: Game, deviceId: string): boolean {
  const dev = this.board.devices.find((d) => d.id === deviceId);
  const disk = this.disks.get(deviceId);
  if (!dev || !disk || dev.burnt) return false;
  const port = this.ports.find((p) => p.name === dev.slot);
  if (!port || port.media !== disk) return false;
  return this.osUp() && this.isMounted(deviceId);
}

/** What the OS offers to data jobs now: its filesystem tier and the most free bytes on a drive that can hold a dataset (zero when the OS is down or no drive is mounted clean). */
export function fsCaps(this: Game): { fsTier: number; dataFreeBytes: number } {
  const os = this.os;
  if (!os || !this.osUp()) return { fsTier: 0, dataFreeBytes: 0 };
  let free = 0;
  let any = false;
  for (const d of this.board.devices) {
    if (deviceSpec(d).kind !== "storage" || !this.driveCanHold(d.id, "dataset")) continue;
    any = true;
    free = Math.max(free, this.disks.get(d.id)!.fs.freeBlocks() * BLOCK_BYTES);
  }
  return { fsTier: any ? os.spec.fsTier : 0, dataFreeBytes: free };
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
      fs: { runs: disk.fs.runs(), fragmentation: disk.fs.fragmentation(), byKind: disk.fs.usage().byKind, files: disk.fs.list().map((f) => ({ id: f.id, owner: f.owner, kind: f.kind, lost: f.lost })) },
      wear: disk.wearGroups(), headLba: port?.media === disk ? port.headLba : 0, cmds: port?.media === disk ? port.cmds.slice() : [],
      wearPct: Math.round(disk.wearPct * 10) / 10, badGroups: disk.badGroups + (disk.twin?.badGroups ?? 0), lostBlocks: disk.fs.lostBlocks(),
      queueDepth: disk.queueDepth, queued: port ? port.queueLoad() : 0, mirror: !!disk.twin,
      mount: this.mountSnap(d.id, disk.mount),
      format: { why: this.formatBlock(d.id), datasets: disk.fs.list("dataset").length },
    };
  });
}

export function mountSnap(this: Game, deviceId: string, state: MountState): StorageSnap["mount"] {
  const m = this.powered ? this.mounts.get(deviceId) : undefined;
  if (!m) return { state, phase: "unmounted", progress: 0 };
  const total = m.scanTicks + m.repairTicks;
  return { state, phase: m.phase, progress: total > 0 ? 1 - m.left / total : 1 };
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
    config: {
      spoolWanted: this.osCfg.spoolSlots,
      spoolMax: Math.min(os.spec.queueSlots, MAX_QUEUE_SLOTS),
      drives: this.board.devices.filter((d) => deviceSpec(d).kind === "storage").map((d) => ({
        deviceId: d.id, slot: d.slot, name: deviceSpec(d).name, tier: deviceSpec(d).tier, home: d.id === os.deviceId,
        on: !this.osCfg.spoolOff.includes(d.id), why: this.spoolDriveWhy(d, false),
        slots: this.spoolPlan.find((p) => p.deviceId === d.id)?.slots ?? (d.id === os.deviceId ? os.homeSlots : 0),
        freeBytes: this.diskFor(d).capacityBytes - this.diskFor(d).usedBytes,
      })),
    },
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
