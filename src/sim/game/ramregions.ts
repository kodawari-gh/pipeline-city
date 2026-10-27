// What lives where in RAM, for the memory sticks to show (docs/DIE.md "Memory"): the boot ROM shadow, the OS (header, kernel, job table) and
// the program the CPU is running. Everything is derived from the memory map and the machine's state; nothing here changes the sim.

import { disassemble, KDATA_BASE, KDATA_SLOTS, KERNEL_BASE, KSLOT_BYTES, OS_HEADER_BASE, PAGED_SHIFT, PAGED_TABLES, PAGED_TABLES_BYTES, USER_BASE } from "../isa";
import { KDATA_END, kernelImageFor } from "../os/kernel";

/** What a region is: the boot ROM, the OS (code or tables), an application (its loaded code and data), or the working memory it has claimed since (`work`). */
export type RamKind = "rom" | "os" | "osdata" | "app" | "work";

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
  /** An application or its working memory: the job's key id (its colour follows its type). */
  owner?: number;
  /** An application or its working memory: its job type ("calc", "log"...), which picks the colour so one kind of program always looks the same. */
  type?: string;
  /** An application: the address where its code ends and its data begins. */
  codeEnd?: number;
}

export interface RamContext {
  /** The OS is up (kernel loaded). */
  os: null | { name: string; tier?: number };
  /** The program in RAM at USER_BASE, or null. */
  job: null | { key: number; label: string; type: string; words: number };
  /** Pages (256 bytes each, by page number) the running program has written to outside its image and the OS: memory it claimed. */
  work?: number[];
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


export function ramRegionsOf(ram: Uint8Array, ctx: RamContext): RamRegion[] {
  const out: RamRegion[] = [];
  const add = (r: RamRegion): void => {
    const hi = Math.min(r.hi, ram.length), lo = Math.min(r.lo, hi);
    if (hi > lo) out.push({ ...r, lo, hi });
  };
  add({ id: "rom", kind: "rom", name: "Boot ROM", note: "Power-on code shadowed at address 0: POST, the key loader and the job-done vector.", lo: 0, hi: USER_BASE });
  if (ctx.os) {
    add({ id: "os-header", kind: "os", name: "OS header", note: "The boot header: magic, queue and program slots, where the spool starts.", lo: OS_HEADER_BASE, hi: KERNEL_BASE });
    const paged = (ctx.os.tier ?? 1) >= 2;
    add({ id: "os-kernel", kind: "os", name: ctx.os.name, note: "The kernel's code: it ingests keys, loads a job from the spool, runs it and flashes the result.", lo: KERNEL_BASE, hi: KERNEL_BASE + kernelImageFor(ctx.os.tier ?? 1).length * 4 });
    if (paged) add({ id: "os-tables", kind: "osdata", name: "Page tables", note: "The page tables of the running program: one level 1 table and the level 2 tables it points to.", lo: PAGED_TABLES, hi: PAGED_TABLES + PAGED_TABLES_BYTES });
    add({ id: "os-table", kind: "osdata", name: "Job table", note: `${KDATA_SLOTS} job slots of ${KSLOT_BYTES} bytes: state, key, length, spool block and the result text.`, lo: KDATA_BASE, hi: KDATA_END });
  }
  if (ctx.job) {
    // under the paged OS the program lives at physical virtual + PAGED_SHIFT (its page table maps it back to USER_BASE)
    const lo = USER_BASE + ((ctx.os?.tier ?? 1) >= 2 ? PAGED_SHIFT : 0), hi = Math.min(lo + ctx.job.words * 4, OS_HEADER_BASE);
    add({
      id: `app-${ctx.job.key}`, kind: "app", name: ctx.job.label, note: "The program the CPU is running, loaded from the spool (or the key) at the user base: its code, then its data.",
      lo, hi, owner: ctx.job.key, type: ctx.job.type, codeEnd: codeEndOf(ram, lo, Math.min(hi, ram.length)),
    });
  }
  if (ctx.job && ctx.work?.length) {
    const pages = [...ctx.work].sort((a, b) => a - b);
    let n = 0;
    for (let i = 0; i < pages.length;) {
      let j = i;
      while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
      add({
        id: `work-${ctx.job.key}-${n++}`, kind: "work", name: `${ctx.job.label} data`, note: "Memory the program claimed while running: its stack and the data it writes.",
        lo: pages[i]! * 256, hi: (pages[j]! + 1) * 256, owner: ctx.job.key, type: ctx.job.type,
      });
      i = j + 1;
    }
  }
  return out;
}

/** The pages the OS owns (ROM, header, kernel, job table) and the program image: a program cannot claim these. */
export function protectedPage(page: number, imageWords: number, base = USER_BASE): boolean {
  const lo = page * 256, hi = lo + 256;
  if (hi <= USER_BASE) return true;
  if (lo < base + imageWords * 4 && hi > base) return true;
  return hi > OS_HEADER_BASE && lo < KDATA_END;
}
