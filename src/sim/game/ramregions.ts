// What lives where in RAM, for the memory sticks to show (docs/DIE.md "Memory"): the boot ROM shadow, the OS (header, kernel, job table) and
// the program the CPU is running. Everything is derived from the memory map and the machine's state; nothing here changes the sim.

import { disassemble, KDATA_BASE, KDATA_SLOTS, KERNEL_BASE, KSLOT_BYTES, OS_HEADER_BASE, USER_BASE } from "../isa";
import { KERNEL_IMAGE } from "../os/kernel";

/** What a region is: the boot ROM, the OS (code or tables), an application (one per program in RAM). */
export type RamKind = "rom" | "os" | "osdata" | "app";

export interface RamRegion {
  id: string;
  kind: RamKind;
  /** Short name for the legend ("OS kernel", "#07 calc"). */
  name: string;
  /** Why this memory exists, one line (the legend and the hover show it). */
  note: string;
  lo: number;
  /** Exclusive. */
  hi: number;
  /** An application: the job's key id (its colour follows its type). */
  owner?: number;
  /** An application: its job type ("calc", "log"...), which picks the colour so one kind of program always looks the same. */
  type?: string;
  /** An application: the address where its code ends and its data begins. */
  codeEnd?: number;
}

export interface RamContext {
  /** The OS is up (kernel loaded). */
  os: null | { name: string };
  /** The program in RAM at USER_BASE, or null. */
  job: null | { key: number; label: string; type: string; words: number };
}

/** Where the code of the program at `lo` ends: after its last return or ecall (what follows is its data). */
export function codeEndOf(ram: Uint8Array, lo: number, hi: number): number {
  let end = lo;
  for (let a = lo; a + 4 <= hi; a += 4) {
    const w = (ram[a]! | (ram[a + 1]! << 8) | (ram[a + 2]! << 16) | (ram[a + 3]! << 24)) >>> 0;
    if (w === 0) continue;
    const t = disassemble(w);
    if (t === "ecall" || t.startsWith("jalr zero, ra") || t === "iret") end = a + 4;
  }
  return end === lo ? hi : end;
}

const KDATA_END = KDATA_BASE + KDATA_SLOTS * KSLOT_BYTES + 24;

export function ramRegionsOf(ram: Uint8Array, ctx: RamContext): RamRegion[] {
  const out: RamRegion[] = [];
  const add = (r: RamRegion): void => {
    const hi = Math.min(r.hi, ram.length), lo = Math.min(r.lo, hi);
    if (hi > lo) out.push({ ...r, lo, hi });
  };
  add({ id: "rom", kind: "rom", name: "Boot ROM", note: "Power-on code shadowed at address 0: POST, the key loader and the job-done vector.", lo: 0, hi: USER_BASE });
  if (ctx.os) {
    add({ id: "os-header", kind: "os", name: "OS header", note: "The boot header: magic, queue and program slots, where the spool starts.", lo: OS_HEADER_BASE, hi: KERNEL_BASE });
    add({ id: "os-kernel", kind: "os", name: ctx.os.name, note: "The kernel's code: it ingests keys, loads a job from the spool, runs it and flashes the result.", lo: KERNEL_BASE, hi: KERNEL_BASE + KERNEL_IMAGE.length * 4 });
    add({ id: "os-table", kind: "osdata", name: "Job table", note: `${KDATA_SLOTS} job slots of ${KSLOT_BYTES} bytes: state, key, length, spool block and the result text.`, lo: KDATA_BASE, hi: KDATA_END });
  }
  if (ctx.job) {
    const lo = USER_BASE, hi = Math.min(USER_BASE + ctx.job.words * 4, OS_HEADER_BASE);
    add({
      id: `app-${ctx.job.key}`, kind: "app", name: ctx.job.label, note: "The program the CPU is running, loaded from the spool (or the key) at the user base: its code, then its data.",
      lo, hi, owner: ctx.job.key, type: ctx.job.type, codeEnd: codeEndOf(ram, lo, Math.min(hi, ram.length)),
    });
  }
  return out;
}
