// Game feature: what the memory is doing. The RAM map and its regions, page tables, the pages a job claims, bit flips,
// memory faults and the health panel's checks. Every export is a `Game` method (see game.ts).

import type { PipelineEngine } from "../engines";
import { JobState, KDATA_BASE, KSLOT_BYTES, PAGED_HEAP, PAGED_TABLES } from "../isa/memmap";
import { FMAP, FRAME_END, FRAME_FIRST, KBUMP, KFAULTS, PCB, PCBS, RESERVED_FRAME } from "../os";
import type { Game } from "./game";
import type { KernelJob } from "./internal";
import { pipeSnapOf, ramMapOf, type PipeSnap, type RamMap, type VmSnap, type VSpaceSnap } from "./pipesnap";
import { protectedPage, ramRegionsOf, type RamContext, type RamRegion } from "./ramregions";
import type { HealthItem } from "./types";
import { walkTable } from "./vmmap";

export function ramSnap(this: Game, jobs: KernelJob[]): RamMap {
  const m = ramMapOf(this.installedMemory(), this.ramRegions(jobs));
  const st = (this.machine.engine as { storedState?: () => { dram?: RamMap["dram"] } } | null)?.storedState?.();
  if (st?.dram) m.dram = st.dram;
  const vm = this.vmSnap(jobs);
  if (vm) m.vm = vm;
  return m;
}

/** The running programs' page tables read out of RAM (paged OSes only). */
export function vmSnap(this: Game, jobs: KernelJob[]): VmSnap | null {
  const tier = this.os?.spec.tier ?? 0;
  if (tier < 2 || !this.powered || !this.pch.osMode || this.postError) return null;
  const bus = this.machine.bus, spaces: VSpaceSnap[] = [];
  const label = (j: KernelJob): { label: string; owner?: number } => {
    const key = this.plugged?.id === j.key ? this.plugged : this.spool.find((k) => k.id === j.key);
    return key ? { label: `#${String(key.jobNo).padStart(2, "0")} ${key.type}`, owner: key.id } : { label: `program ${j.slot + 1}` };
  };
  for (const j of jobs) {
    if (j.state !== JobState.Running) continue;
    // OS 4: a threaded job has one context per thread, not one per slot: the contexts that belong to the slot (their PCB.SLOT is its record address) share the table
    let ctx = j.slot;
    if (tier >= 4) for (let c = 0; c < 8; c++) if (bus.load32(PCBS + c * PCB.BYTES + PCB.SLOT) === KDATA_BASE + j.slot * KSLOT_BYTES) { ctx = c; break; }
    const table = tier >= 3 ? bus.load32(PCBS + ctx * PCB.BYTES + PCB.TABLE) : PAGED_TABLES;
    const w = walkTable(this.machine.ram, table);
    if (w.pages.length) spaces.push({ ...label(j), table, pages: w.pages.flatMap((p) => [p.vpn, p.frame, p.flags]), tables: w.tables });
  }
  const mmu = this.machine.mmu;
  return { spaces, ...(mmu.faults > 0 ? { fault: { addr: mmu.faultAddr, cause: mmu.cause } } : {}) };
}

/** What lives where in RAM now: the boot ROM, the OS when it is up, and the program the CPU has loaded (docs/DIE.md "Memory"). */
export function ramRegions(this: Game, jobs: KernelJob[]): RamRegion[] {
  const osUp = !!this.os && this.pch.osMode && !this.postError;
  const job = this.ramJob(jobs);
  if (osUp && this.os!.spec.tier >= 3) {
    // the preemptive OS keeps a map of RAM frames: whose every page is comes from there, for every running program
    const bus = this.machine.bus;
    const frames = Array.from({ length: FRAME_END }, (_, f) => bus.load32(FMAP + 4 * f));
    const procs: NonNullable<RamContext["procs"]> = [];
    for (const j of jobs) {
      const key = this.plugged?.id === j.key ? this.plugged : this.spool.find((k) => k.id === j.key);
      if (key) procs[j.slot] = { key: key.id, label: `#${String(key.jobNo).padStart(2, "0")} ${key.type}`, type: key.type };
    }
    return ramRegionsOf(this.installedMemory(), { os: { name: this.os!.spec.name, tier: this.os!.spec.tier }, job: null, frames, procs });
  }
  return ramRegionsOf(this.installedMemory(), { os: osUp ? { name: this.os!.spec.name, tier: this.os!.spec.tier } : null, job, work: job && this.claimKey === job.key ? [...this.claimed] : [] });
}

/** The program the CPU has in RAM right now (OS: the kernel's running slot; no OS: the key's program), or null. */
export function ramJob(this: Game, jobs: KernelJob[]): RamContext["job"] {
  const osUp = !!this.os && this.pch.osMode && !this.postError;
  const running = jobs.find((j) => j.state === JobState.Running);
  const key = running ? (this.plugged?.id === running.key ? this.plugged : this.spool.find((k) => k.id === running.key)) : !osUp ? this.plugged : null;
  if (!key || key.done || !(running || this.pch.key)) return null;
  const words = running ? running.len : this.pch.key?.program.length ?? 0;
  return words > 0 ? { key: key.id, label: `#${String(key.jobNo).padStart(2, "0")} ${key.type}`, type: key.type, words } : null;
}

/** One of the engine's MMU counters (0 without an engine). */
export function mmuCount(this: Game, i: number): number {
  return (this.machine.engine as { view?: { counters: Float64Array } } | null)?.view?.counters[i] ?? 0;
}

export function pipeSnap(this: Game, eng: PipelineEngine): PipeSnap {
  const s = pipeSnapOf(eng, this.machine.ram, this.traceCycles);
  if (s.stored && this.machine.mmu.tlbEntries > 0) s.stored.tlb = this.machine.mmu.dump();
  return s;
}

/** A cosmic ray: at the economy's rate a bit flips in memory the running job uses. ECC memory corrects it; plain memory keeps it. */
export function memoryFlips(this: Game): void {
  const rate = this.cfg.memoryFlipRate;
  if (rate <= 0 || this.flipRng.nextU32() / 4294967296 >= rate) return;
  const regions = this.ramRegions(this.kernelJobs()).filter((r) => r.kind === "app" || r.kind === "work");
  if (regions.length === 0) return;
  const r = regions[this.flipRng.nextU32() % regions.length]!;
  const addr = r.lo + (this.flipRng.nextU32() % (r.hi - r.lo)), bit = this.flipRng.nextU32() & 7;
  if (this.eccInstalled()) {
    this.eccCorrected++;
    this.note("ecc", `ECC corrected a flipped bit at 0x${addr.toString(16)}`);
  } else {
    this.machine.ram[addr] = this.machine.ram[addr]! ^ (1 << bit);
    this.bitFlips++;
    this.note("fault", `a bit flipped in memory at 0x${addr.toString(16)}: no ECC`);
  }
}

/** A fault is the OS killing a job that wrote to protected memory: counted and logged; the kernel has already ended the job. */
export function checkFaults(this: Game): void {
  if (!this.powered || !this.pch.osMode) { this.mpuSeen = 0; return; }
  const killed = this.machine.bus.load32(KFAULTS); // the kernel counts the jobs it kills
  if (killed < this.mpuSeen) this.mpuSeen = 0;
  if (killed === this.mpuSeen) return;
  this.mpuSeen = killed;
  this.faults++;
  const job = this.claimKey >= 0 ? `job on key ${this.claimKey}` : "a job";
  const paged = (this.os?.spec.tier ?? 1) >= 2, at = paged ? this.machine.mmu.faultAddr : this.machine.mpu.faultAddr;
  this.note("fault", `memory fault: ${job} ${paged ? "touched memory it has no right to" : "wrote to protected memory"} at 0x${at.toString(16)} and was killed by the OS`);
}

/** The pages the running program has written to outside the OS and its own image: it claims memory by using it (docs/OS.md "Memory"). */
export function trackPages(this: Game): void {
  const dirty = this.machine.bus.dirty;
  const job = this.powered ? this.ramJob(this.kernelJobs()) : null;
  if (!job || job.key !== this.claimKey) { this.claimed = new Set(); this.claimKey = job?.key ?? -1; }
  if (job && (this.os?.spec.tier ?? 1) === 2) {
    // the paged OS hands out frames from its bump pointer: those are the pages the program has claimed
    const bus = this.machine.bus, next = bus.load32(KBUMP);
    for (let p = PAGED_HEAP >> 8; p < next; p++) if (p < (PAGED_TABLES >> 8) || p >= 256) this.claimed.add(p); // the bump pointer skips the tables and the OS
  } else if (job && (this.os?.spec.tier ?? 1) < 2) for (let p = 0; p < dirty.length; p++) if (dirty[p] && !protectedPage(p, job.words)) this.claimed.add(p);
  dirty.fill(0);
}

/**
 * Checks that should always hold while the OS runs, and the session's trouble so far. A check has to fail on several snapshots in a row before it
 * is reported (the kernel is mid-update at some instants), so a line here means something is really wrong.
 */
export function health(this: Game): HealthItem[] {
  const out: HealthItem[] = [];
  const tier = this.os?.spec.tier ?? 0;
  if (this.powered && this.pch.osMode && !this.postError && tier >= 3) {
    const bus = this.machine.bus, jobs = this.kernelJobs();
    const running = jobs.filter((j) => j.state === JobState.Running).length;
    let used = 0, leaked = 0, reserved = 0;
    for (let f = FRAME_FIRST; f < FRAME_END; f++) {
      const w = bus.load32(FMAP + 4 * f);
      if (w === 0) continue;
      if (w === RESERVED_FRAME) { reserved++; continue; }
      used++;
      const j = jobs.find((x) => x.slot === (w & 15) - 1);
      if (!j || (j.state !== JobState.Running && j.state !== JobState.Queued)) leaked++;
    }
    this.leakSeen = leaked > 0 ? this.leakSeen + 1 : 0;
    this.timerSeen = running > 0 && this.machine.timer.interval === 0 ? this.timerSeen + 1 : 0;
    if (this.leakSeen >= 3) out.push({ level: "bad", text: `${leaked} frames are owned by a job that is not running: the kernel did not give them back` });
    if (this.timerSeen >= 3) out.push({ level: "bad", text: "programs are running but the timer is off: none will be preempted" });
    const free = FRAME_END - FRAME_FIRST - reserved - used;
    if (free < 16) out.push({ level: "warn", text: `only ${free} free frames: a new program may have to wait` });
    if (out.length === 0) out.push({ level: "ok", text: `${used} of ${FRAME_END - FRAME_FIRST - reserved} frames in use, ${running} running, ${this.machine.timer.fired} timer interrupts` });
  }
  if (this.faults > 0) out.push({ level: "warn", text: `${this.faults} job${this.faults === 1 ? "" : "s"} killed by the OS this session` });
  if (this.bitFlips > 0) out.push({ level: "warn", text: `${this.bitFlips} bit flip${this.bitFlips === 1 ? "" : "s"} in memory (no ECC)` });
  if (this.eccCorrected > 0) out.push({ level: "ok", text: `ECC corrected ${this.eccCorrected} flipped bit${this.eccCorrected === 1 ? "" : "s"}` });
  return out;
}
