// The job almanac (docs/JOBS.md): what each kind of job is, what it stresses and how to be better at it, revealed in stages as the player meets it:
// unseen (a silhouette and the level it arrives at), seen (what it is and what it needs), done (once finished: the tips and the player's own record).
// Pure data and small helpers; the sim keeps the per-game record (`DexRecord`) and the UI draws it.

import { describeNeed, jobClass, type JobClassId } from "./levels";

/** The part of the machine a tip is about: the almanac draws an icon for it instead of a sentence. */
export type TipPart = "clock" | "cpu" | "ram" | "bank" | "cache" | "display" | "tlb" | "os" | "drive" | "gpu" | "npu" | "tpm" | "predictor" | "net" | "none";

/** One way to do a job better: a part, a few words for the chip, and the full sentence behind it. `none` marks a part that does NOT help (worth knowing before buying it). */
export interface Tip { part: TipPart; short: string; text: string; none?: boolean }

/** One entry: a kind of job, as the labels on the monitor name it (`Key.type`). */
export interface DexEntry {
  id: string;
  name: string;
  /** The job class it belongs to (levels.ts), which decides its needs and when it arrives. */
  cls: JobClassId;
  /** What it is, in a line. */
  blurb: string;
  /** What the job leans on, in the order it matters: the hardware to look at first. */
  stresses: string[];
  /** The memory the job keeps, in words. */
  footprint: string;
  /** How to do it faster or better: shown once the player has finished one. Each is something the sim really does. */
  tips: Tip[];
  /** Not built yet: shown, never unlocked. */
  planned?: boolean;
}

/** A group of kinds of job, shown as one collapsible section with its own colour. */
export interface DexGroup { id: string; name: string; color: string; ids: string[] }

export const DEX_GROUPS: readonly DexGroup[] = [
  { id: "everyday", name: "Everyday", color: "#4fd1c5", ids: ["log", "calc", "checksum"] },
  { id: "memory", name: "Memory-hungry", color: "#f0803c", ids: ["scan", "db"] },
  { id: "network", name: "Network", color: "#5b9cf5", ids: ["web"] },
  { id: "trust", name: "Trust", color: "#ef5b7b", ids: ["secure"] },
  { id: "accel", name: "Accelerators", color: "#8b7cf6", ids: ["gpu", "npu"] },
  { id: "soon", name: "Coming soon", color: "#8893b0", ids: ["hpc"] },
];

export const JOB_DEX: readonly DexEntry[] = [
  { id: "log", name: "Log line", cls: "cli",
    blurb: "A few status lines written to the display.",
    stresses: ["display speed", "CPU clock"], footprint: "a few bytes of the display",
    tips: [
      { part: "display", short: "Faster display", text: "It waits for the display to be idle and writes line by line: a faster display (its write latency) and a higher CPU clock shorten it." },
      { part: "ram", short: "RAM does nothing", none: true, text: "Memory does not matter: a bigger or faster stick changes nothing here." },
      { part: "os", short: "Cheap with an OS", text: "It is the cheapest job there is: with an OS it costs almost nothing to keep the machine busy with them." },
    ] },
  { id: "calc", name: "Calculation", cls: "cli",
    blurb: "A chain of multiply-and-add rounds, shown as a two-digit result.",
    stresses: ["CPU clock", "multiplier and branch speed"], footprint: "registers only",
    tips: [
      { part: "clock", short: "Clock beats width", text: "Every round depends on the one before, so a wider CPU (2-wide, out-of-order) gains little: a higher clock gains more." },
      { part: "predictor", short: "Loop predictor", text: "The loop branch is taken every round: a predictor that learns a loop (2-bit counters) saves the redirect penalty." },
      { part: "ram", short: "No memory use", none: true, text: "No memory traffic at all: RAM and caches are irrelevant." },
    ] },
  { id: "checksum", name: "Checksum", cls: "cli",
    blurb: "Hash a few words of data and show the low bits.",
    stresses: ["load and ALU speed", "D-cache"], footprint: "a few dozen bytes",
    tips: [
      { part: "cache", short: "Forwarding, D-cache", text: "Each word is loaded, mixed, and the next load waits for it: forwarding and a bigger D-cache hide the load latency." },
      { part: "ram", short: "One cold miss", none: true, text: "The data is tiny, so only the first touch misses: RAM latency matters once, not per word." },
    ] },
  { id: "scan", name: "Memory scan", cls: "scan",
    blurb: "Fill a buffer at a fixed stride, then add it all up: every element on a new cache line.",
    stresses: ["RAM latency", "DRAM banks and open rows", "D-cache size", "memory channels"], footprint: "up to about 8K of buffer at 0x4000",
    tips: [
      { part: "ram", short: "Faster RAM timings", text: "The stride defeats the cache, so it is bound by memory latency: faster RAM (lower tCL, tRCD, tRP) helps directly, and a RAM overclock helps more." },
      { part: "bank", short: "Open rows", text: "The fill walks memory in order: with the open page policy the next element is often in the row that is already open (a row hit)." },
      { part: "bank", short: "Banks, two channels", text: "More banks keep more rows open at once, and two sticks on a dual-channel controller let two misses go out together." },
      { part: "cache", short: "Bigger D-cache, L2", text: "A bigger D-cache or an L2 keeps the second pass (the sum) from missing again." },
    ] },
  { id: "db", name: "In-memory index", cls: "db",
    blurb: "Build a table of 256-byte records, one per page, then look them up all over.",
    stresses: ["how much RAM there is", "page faults (paged OS)", "TLB size", "DRAM banks and row conflicts"], footprint: "a 32K table at 0x10000 (64K to 512K at larger scales)",
    tips: [
      { part: "ram", short: "RAM past 96K", text: "It needs RAM that reaches past the table: with less than 96K installed it is refused at the port, and bigger tables need more." },
      { part: "os", short: "OS 1 is fastest", text: "The table is claimed one page at a time. On OS 1 that is free; under a paged OS each page is a page fault the kernel has to serve, so OS 1 finishes it fastest." },
      { part: "bank", short: "More banks", text: "The lookups are scattered: they land in different DRAM rows, so row conflicts are the rule. More banks keep more rows open, and a DDR4 or DDR5 stick has many more banks than SDRAM." },
      { part: "tlb", short: "Bigger TLB", text: "A bigger TLB (a CPU with 16 or 32 entries) keeps the lookups from walking the page table each time." },
      { part: "drive", short: "Needs an SSD", text: "It needs an OS and a SATA SSD or better, because the program is loaded from the spool on the drive." },
    ] },
  { id: "web", name: "Web request", cls: "web",
    blurb: "A client's page request that arrives over the network.",
    stresses: ["network link", "CPU clock"], footprint: "registers only (the program is a stand-in)",
    tips: [
      { part: "net", short: "Faster plan, router", text: "Most of a web job is the download and the upload: a faster plan and router shorten them, and more client slots on the link run several jobs at once." },
      { part: "none", short: "Stand-in program", none: true, text: "Until real web code exists the program is the calculation job, so the CPU side behaves like it." },
    ] },
  { id: "secure", name: "Signed transaction", cls: "secure",
    blurb: "Measure its data with the TPM, hash it in protected mode, seal the digest and unseal it.",
    stresses: ["TPM speed", "protected-mode surcharge", "ECC RAM"], footprint: "a few words of data, in protected memory",
    tips: [
      { part: "tpm", short: "TPM and ECC", text: "It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused." },
      { part: "clock", short: "Faster CPU", text: "Inside protected mode every RAM access pays an encryption surcharge, so the hashing is slower than a plain checksum: a faster CPU helps there." },
      { part: "tpm", short: "TPM clock is fixed", none: true, text: "The TPM itself runs on one slow clock: its measure and attest waits are fixed, whatever the CPU does." },
    ] },
  { id: "gpu", name: "GPU batch", cls: "gpu",
    blurb: "One of four array kernels (add, scale-and-add, blur, Mandelbrot) over a seeded array.",
    stresses: ["a GPU (lanes)", "CPU copy speed", "card memory"], footprint: "a few hundred bytes of arrays",
    tips: [
      { part: "gpu", short: "More lanes", text: "With a card the program copies the kernel and its data to the card and waits: more lanes finish the array faster, and the copy loop is the CPU's." },
      { part: "gpu", short: "No card, slow path", text: "Without a card the same work runs on the CPU, slower, for the same pay: a card is how you stop losing time on these." },
      { part: "gpu", short: "Card memory", text: "A card with too little memory for the array falls back to the CPU too." },
    ] },
  { id: "npu", name: "Inference", cls: "npu",
    blurb: "A few dense layers over a small batch with seeded weights.",
    stresses: ["an NPU (array size)", "else a GPU", "else the CPU"], footprint: "a few hundred bytes to a few K of weights",
    tips: [
      { part: "npu", short: "NPU, GPU, then CPU", text: "The program takes the best path it finds: the NPU, then a GPU (one launch per layer), then the CPU (a loop per layer). Each step down is much slower at the same pay." },
      { part: "npu", short: "Grid fits the batch", text: "An NPU's grid has to divide the batch size and its memory has to hold the weights, or the job falls through to the next path." },
    ] },
  { id: "hpc", name: "High-performance compute", cls: "hpc",
    blurb: "A hard, long, serial job that wants one big fast core, or many of them.", planned: true,
    stresses: ["single-thread speed", "cores"], footprint: "not built yet", tips: [] },
];

export const dexEntry = (id: string): DexEntry | undefined => JOB_DEX.find((e) => e.id === id);

/** The group an entry belongs to. */
export const dexGroup = (id: string): DexGroup | undefined => DEX_GROUPS.find((g) => g.ids.includes(id));

/** The player's record of one entry: when it first arrived, how many were finished and the fastest run (base ticks the machine took, plug to done). */
export interface DexRecord { seen: number; runs: number; best: number }

export type DexState = "unseen" | "seen" | "done" | "planned";

/** One line of the snapshot: the entry's id, how far the player has got with it and the record. */
export interface DexSnap { id: string; state: DexState; runs: number; best: number; seenTick: number }

export function dexState(e: DexEntry, rec: DexRecord | undefined): DexState {
  if (e.planned) return "planned";
  if (!rec) return "unseen";
  return rec.runs > 0 ? "done" : "seen";
}

/** What the class needs, as the phrases the monitor uses; and the level it arrives at. */
export function dexNeeds(e: DexEntry): { needs: string[]; firstLevel: number } {
  const c = jobClass(e.cls);
  return { needs: (c?.needs ?? []).map((n) => describeNeed(n).long), firstLevel: c?.firstLevel ?? 1 };
}

/** What the class needs as chips: the kind (for an icon), the short label and the long phrase. */
export function needChips(e: DexEntry): Array<{ kind: string; short: string; long: string }> {
  return (jobClass(e.cls)?.needs ?? []).map((n) => ({ kind: n.kind, ...describeNeed(n) }));
}
