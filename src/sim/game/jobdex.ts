// The job almanac (docs/JOBS.md): what each kind of job is, what it stresses and how to be better at it, revealed in stages as the player meets it:
// unseen (a silhouette and the level it arrives at), seen (what it is and what it needs), done (once finished: the tips and the player's own record).
// Pure data and small helpers; the sim keeps the per-game record (`DexRecord`) and the UI draws it.

import { describeNeed, jobClass, type JobClassDef, type JobClassId, type Need } from "./levels";

/** The part of the machine a tip is about: the almanac draws an icon for it instead of a sentence. */
export type TipPart = "clock" | "cpu" | "ram" | "bank" | "cache" | "display" | "tlb" | "os" | "drive" | "gpu" | "npu" | "tpm" | "predictor" | "net" | "none";

/** One way to do a job better: a part, a few words for the chip, and the full sentence behind it. `none` marks a part that does NOT help (worth knowing before buying it). */
export interface Tip { part: TipPart; short: string; text: string; none?: boolean }

/** One entry: a kind of job, as the labels on the monitor name it (`Key.type`). */
export interface DexEntry {
  id: string;
  name: string;
  /** The job class it belongs to (levels.ts), which decides its default needs and level. */
  cls: JobClassId;
  /** The generator template (src/sim/gen) that makes this job's program; the key keeps it, so the template names the kind of job. */
  template: string;
  /** The work scale the class sends this job at (default: the class's). */
  scale?: number;
  /** The level clients start sending it (default: the class's first level). A job arrives only once the player has reached it. */
  level?: number;
  /** What it needs from the machine, instead of the class's (default: the class's). The hardware lock. */
  needs?: Need[];
  /** Pay relative to the class's multiplier (default 1). */
  payMul?: number;
  /** Relative share among the jobs of its class that have arrived at the player's level (default 1). */
  weight?: number;
  /** What an optional part does for it, as the chip reads (the job runs without it, slower): the card of an accelerator job, with the speed-up measured on the sim's cards. */
  boost?: string;
  /** One of the jobs the class sent before it had several: while these are the only ones unlocked the class sends its own template, so a game that has not reached the new ones plays as it always did. */
  legacy?: boolean;
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
  { id: "everyday", name: "Everyday", color: "#4fd1c5", ids: ["log", "calc", "checksum", "fib", "reverse", "gcd", "popcount", "sort", "matmul", "crc"] },
  { id: "memory", name: "Memory-hungry", color: "#f0803c", ids: ["scan", "chase", "stream", "stencil", "transpose", "sieve", "db", "hashtab"] },
  { id: "network", name: "Network", color: "#5b9cf5", ids: ["page", "api", "dns", "form", "search", "upload", "image", "video"] },
  { id: "trust", name: "Trust", color: "#ef5b7b", ids: ["secure", "verify", "measure", "encrypt", "vault", "rotate", "attest"] },
  { id: "accel", name: "Accelerators", color: "#8b7cf6", ids: ["vadd", "saxpy", "thresh", "blur3", "poly", "mandel", "sphere", "spherewide", "perceptron", "npu", "deep"] },
  { id: "hpc", name: "High-performance", color: "#f2c14e", ids: ["hpc-reduce", "hpc-matmul", "hpc-nbody", "hpc-montecarlo", "hpc-sort", "hpc-bfs", "hpc-fft"] },
];

export const JOB_DEX: readonly DexEntry[] = [
  { id: "log", name: "Log line", cls: "cli", template: "cli.log", legacy: true,
    blurb: "A few status lines written to the display.",
    stresses: ["display speed", "CPU clock"], footprint: "a few bytes of the display",
    tips: [
      { part: "display", short: "Faster display", text: "It waits for the display to be idle and writes line by line: a faster display (its write latency) and a higher CPU clock shorten it." },
      { part: "ram", short: "RAM does nothing", none: true, text: "Memory does not matter: a bigger or faster stick changes nothing here." },
      { part: "os", short: "Cheap with an OS", text: "It is the cheapest job there is: with an OS it costs almost nothing to keep the machine busy with them." },
    ] },
  { id: "calc", name: "Calculation", cls: "cli", template: "cli.calc", legacy: true,
    blurb: "A chain of multiply-and-add rounds, shown as a two-digit result.",
    stresses: ["CPU clock", "multiplier and branch speed"], footprint: "registers only",
    tips: [
      { part: "clock", short: "Clock beats width", text: "Every round depends on the one before, so a wider CPU (2-wide, out-of-order) gains little: a higher clock gains more." },
      { part: "predictor", short: "Loop predictor", text: "The loop branch is taken every round: a predictor that learns a loop (2-bit counters) saves the redirect penalty." },
      { part: "ram", short: "No memory use", none: true, text: "No memory traffic at all: RAM and caches are irrelevant." },
    ] },
  { id: "checksum", name: "Checksum", cls: "cli", template: "cli.checksum", legacy: true,
    blurb: "Hash a few words of data and show the low bits.",
    stresses: ["load and ALU speed", "D-cache"], footprint: "a few dozen bytes",
    tips: [
      { part: "cache", short: "Forwarding, D-cache", text: "Each word is loaded, mixed, and the next load waits for it: forwarding and a bigger D-cache hide the load latency." },
      { part: "ram", short: "One cold miss", none: true, text: "The data is tiny, so only the first touch misses: RAM latency matters once, not per word." },
    ] },
  { id: "fib", name: "Fibonacci", cls: "cli", template: "cli.fib", level: 4,
    blurb: "Add the last two numbers, again and again: every step waits for the one before.",
    stresses: ["ALU latency", "forwarding"], footprint: "registers only",
    tips: [
      { part: "cpu", short: "Forwarding helps", text: "Every add needs the sum before it: a CPU that forwards results between stages (the Tiny-5F and up) saves a stall on every step, and the one without forwarding pays it each time." },
      { part: "clock", short: "Clock beats width", text: "It is one long chain with nothing to overlap, so a wider CPU gains nothing: a higher clock does." },
      { part: "ram", short: "No memory use", none: true, text: "No memory traffic at all: RAM and caches are irrelevant." },
    ] },
  { id: "reverse", name: "Reverse text", cls: "cli", template: "cli.reverse", level: 4,
    blurb: "Write a word to the display backwards, one byte at a time.",
    stresses: ["display speed", "byte stores"], footprint: "a few bytes of the display",
    tips: [
      { part: "display", short: "Faster display", text: "Every byte goes straight to the display, which takes its time on each store: a faster display (its write latency) shortens it most." },
      { part: "clock", short: "Higher CPU clock", text: "Between the stores the CPU only counts down and steps two pointers: a higher clock shortens the gaps." },
      { part: "ram", short: "RAM does nothing", none: true, text: "The word sits in the program: memory does not matter." },
    ] },
  { id: "gcd", name: "Greatest common divisor", cls: "cli", template: "cli.gcd", level: 5,
    blurb: "Take the smaller number from the larger until they meet: which way each step goes depends on the data.",
    stresses: ["branch predictor", "CPU clock"], footprint: "a few words in the program",
    tips: [
      { part: "predictor", short: "Better predictor", text: "Each step goes one of two ways, and the numbers decide: a CPU that guesses wrong throws work away, so a quicker redirect (or a bigger predictor table) helps, though no table learns data this random." },
      { part: "clock", short: "Higher CPU clock", text: "The loop is short and its branches cost cycles: a higher clock shortens every one of them." },
      { part: "ram", short: "No memory use", none: true, text: "Two loads per pair and then registers only: RAM and caches are irrelevant." },
    ] },
  { id: "popcount", name: "Bit count", cls: "cli", template: "cli.popcount", level: 5,
    blurb: "Count the 1 bits in a few words, one shift at a time.",
    stresses: ["CPU clock", "branch speed"], footprint: "a few words in the program",
    tips: [
      { part: "predictor", short: "Loop predictor", text: "The inner loop runs once per bit and stops when the word is empty: a predictor with 2-bit counters learns it and misses only when it ends." },
      { part: "clock", short: "Higher CPU clock", text: "Five instructions per bit, nothing to overlap: a higher clock helps most." },
      { part: "ram", short: "No memory use", none: true, text: "One load per word: RAM and caches are irrelevant." },
    ] },
  { id: "sort", name: "Sort", cls: "cli", template: "cli.sort", level: 6,
    blurb: "Put a handful of numbers in order by shuffling them along in memory.",
    stresses: ["loads and stores", "D-cache", "branches"], footprint: "a few dozen bytes at 0x4000",
    tips: [
      { part: "cache", short: "D-cache helps", text: "The array is walked back and forth many times: a D-cache that holds all of it turns each pass into hits, and one that does not misses again and again." },
      { part: "predictor", short: "Predictor", text: "Whether a number moves on depends on the data: mispredicted branches cost a redirect each, so a CPU that recovers fast helps." },
      { part: "cpu", short: "Forwarding again", text: "A load, then a compare of what it loaded: forwarding hides the wait between them." },
    ] },
  { id: "matmul", name: "Matrix product", cls: "cli", template: "cli.matmul", level: 7,
    blurb: "Multiply two small square matrices and add up the result: three loops of multiply-and-add.",
    stresses: ["the multiplier", "loads", "CPU width"], footprint: "two small tables in the program",
    tips: [
      { part: "cpu", short: "A wider CPU", text: "The products of different elements do not depend on each other, so a 2-wide or out-of-order CPU overlaps them and finishes sooner." },
      { part: "cache", short: "D-cache holds both", text: "Both matrices are read again and again: a D-cache big enough for them avoids misses on every pass." },
      { part: "clock", short: "Higher CPU clock", text: "Three multiplies per step: the multiplier is the busiest unit, and its speed follows the clock." },
    ] },
  { id: "crc", name: "CRC check", cls: "cli", template: "cli.crc", level: 8,
    blurb: "A cyclic redundancy check, one bit at a time: 32 shifts for every word.",
    stresses: ["branch predictor", "CPU clock"], footprint: "a few words in the program",
    tips: [
      { part: "predictor", short: "Bigger predictor", text: "Whether the polynomial is mixed in follows each bit of the data, so about half the branches go each way: no predictor can learn random data, but one that recovers fast loses less." },
      { part: "clock", short: "Higher CPU clock", text: "Six instructions per bit with nothing to overlap: a higher clock helps most." },
      { part: "ram", short: "No memory use", none: true, text: "One load per word: RAM and caches are irrelevant." },
    ] },
  { id: "scan", name: "Memory scan", cls: "scan", template: "cli.scan", legacy: true,
    blurb: "Fill a buffer at a fixed stride, then add it all up: every element on a new cache line.",
    stresses: ["RAM latency", "DRAM banks and open rows", "D-cache size", "memory channels"], footprint: "up to about 8K of buffer at 0x4000",
    tips: [
      { part: "ram", short: "Faster RAM timings", text: "The stride defeats the cache, so it is bound by memory latency: faster RAM (lower tCL, tRCD, tRP) helps directly, and a RAM overclock helps more." },
      { part: "bank", short: "Open rows", text: "The fill walks memory in order: with the open page policy the next element is often in the row that is already open (a row hit)." },
      { part: "bank", short: "Banks, two channels", text: "More banks keep more rows open at once, and two sticks on a dual-channel controller let two misses go out together." },
      { part: "cache", short: "Bigger D-cache, L2", text: "A bigger D-cache or an L2 keeps the second pass (the sum) from missing again." },
    ] },
  { id: "db", name: "In-memory index", cls: "db", template: "db.index", legacy: true,
    blurb: "Build a table of 256-byte records, one per page, then look them up all over.",
    stresses: ["how much RAM there is", "page faults (paged OS)", "TLB size", "DRAM banks and row conflicts"], footprint: "a 32K table at 0x10000 (64K to 512K at larger scales)",
    tips: [
      { part: "ram", short: "RAM past 96K", text: "It needs RAM that reaches past the table: with less than 96K installed it is refused at the port, and bigger tables need more." },
      { part: "os", short: "OS 1 is fastest", text: "The table is claimed one page at a time. On OS 1 that is free; under a paged OS each page is a page fault the kernel has to serve, so OS 1 finishes it fastest." },
      { part: "bank", short: "More banks", text: "The lookups are scattered: they land in different DRAM rows, so row conflicts are the rule. More banks keep more rows open, and a DDR4 or DDR5 stick has many more banks than SDRAM." },
      { part: "tlb", short: "Bigger TLB", text: "A bigger TLB (a CPU with 16 or 32 entries) keeps the lookups from walking the page table each time." },
      { part: "drive", short: "Needs an SSD", text: "It needs an OS and a SATA SSD or better, because the program is loaded from the spool on the drive." },
    ] },
  { id: "chase", name: "Pointer chase", cls: "scan", template: "mem.chase", level: 6, scale: 4, needs: [{ kind: "ram", minBytes: 24576 }],
    blurb: "Follow a ring of linked nodes: every address is the answer to the load before it.",
    stresses: ["RAM latency", "D-cache size"], footprint: "a ring of 8K at 0x4000",
    tips: [
      { part: "ram", short: "Lower RAM latency", text: "Every step waits for a load whose address is the load before it, so nothing overlaps: the time is the number of steps times the memory latency. Faster RAM (lower tCL, tRCD, tRP) or a RAM overclock cuts it directly." },
      { part: "cache", short: "Cache holds the ring", text: "The walk goes round the ring twice: a D-cache or an L2 big enough for it (and associative enough) turns the second lap into hits; one smaller than the ring misses at every step." },
      { part: "cpu", short: "Width does nothing", none: true, text: "A wider or out-of-order CPU has nothing to run ahead with, because each load needs the last: a higher clock is the only CPU help." },
    ] },
  { id: "stream", name: "Block copy", cls: "scan", template: "mem.stream", level: 6, scale: 4, needs: [{ kind: "ram", minBytes: 17408 }],
    blurb: "Fill a block, copy it to another, and hash the copy: every address is the next one along.",
    stresses: ["RAM bandwidth", "open rows"], footprint: "two blocks of 512 bytes at 0x4000",
    tips: [
      { part: "bank", short: "Open rows", text: "The copy walks memory in order, so with the open page policy nearly every read and write lands in a row that is already open." },
      { part: "bank", short: "Two channels", text: "Two sticks on a dual-channel CPU let a read and a write go out together instead of one after the other." },
      { part: "cache", short: "A bigger D-cache", text: "The copy is read once going in and once again by the hash: a D-cache that holds it saves the second trip to RAM." },
    ] },
  { id: "stencil", name: "Neighbour sum", cls: "scan", template: "mem.stencil", level: 7, scale: 4, needs: [{ kind: "ram", minBytes: 17408 }],
    blurb: "Each output is the sum of three neighbours: three loads for every store, most of them seen a moment ago.",
    stresses: ["D-cache", "CPU width"], footprint: "two arrays of 512 bytes at 0x4000",
    tips: [
      { part: "cache", short: "D-cache pays", text: "Each value is loaded three times in three different rounds: a D-cache that keeps the last lines turns two of the three loads into hits." },
      { part: "cpu", short: "A wider CPU", text: "The three loads of a round do not depend on each other: a 2-wide or out-of-order CPU overlaps them." },
      { part: "clock", short: "Higher CPU clock", text: "Between the loads there is little but additions: a higher clock shortens every round." },
    ] },
  { id: "transpose", name: "Transpose", cls: "scan", template: "mem.transpose", level: 7, scale: 1, needs: [{ kind: "ram", minBytes: 17408 }],
    blurb: "Turn rows into columns: read along a row, write down a column.",
    stresses: ["D-cache conflicts", "DRAM banks"], footprint: "two small matrices at 0x4000",
    tips: [
      { part: "cache", short: "Fewer conflicts", text: "The writes jump a whole row each time, so they land on the same few cache lines and push each other out: a bigger or 2-way D-cache (the memory branch of the CPU tree) keeps them." },
      { part: "bank", short: "More banks", text: "Each write lands in a different DRAM row: more banks keep more rows open." },
      { part: "ram", short: "Faster RAM timings", text: "Most of the writes miss, so memory latency counts: faster RAM shortens every one." },
    ] },
  { id: "sieve", name: "Prime sieve", cls: "scan", template: "mem.sieve", level: 8, scale: 2, needs: [{ kind: "ram", minBytes: 17408 }],
    blurb: "Count the primes below a number by crossing off multiples in a row of byte flags.",
    stresses: ["D-cache", "byte stores", "branches"], footprint: "one byte per number at 0x4000",
    tips: [
      { part: "cache", short: "Cache holds the flags", text: "The flags are read and written over and over: a D-cache that holds them hits every time after the first." },
      { part: "predictor", short: "Redirect speed", text: "The test of each number goes one way for a prime and the other for a composite, in a pattern that is hard to guess: a quick redirect helps." },
      { part: "ram", short: "RAM size no help", none: true, text: "The flags are tiny: more RAM changes nothing, only the cache in front of it." },
    ] },
  { id: "hashtab", name: "Hash table", cls: "db", template: "mem.hashtab", level: 8, scale: 1, needs: [{ kind: "os", min: 1 }, { kind: "ram", minBytes: 66560 }],
    blurb: "Put keys in a table in the big heap by a scattering hash, then look every one up.",
    stresses: ["RAM past 64K", "page faults (paged OS)", "TLB", "DRAM banks"], footprint: "a 1K table at 0x10000",
    tips: [
      { part: "ram", short: "RAM past 65K", text: "The table lives in the heap above 64K: with less RAM installed the job is refused at the port." },
      { part: "os", short: "OS 1 is fastest", text: "The heap is claimed a page at a time. On OS 1 that is free; under a paged OS each page is a page fault the kernel has to serve." },
      { part: "tlb", short: "A bigger TLB", text: "The keys scatter over the pages of the table: a bigger TLB keeps their translations instead of walking the page table." },
      { part: "bank", short: "More banks", text: "The slots land in different DRAM rows: more banks keep more rows open." },
    ] },
  { id: "page", name: "Web page", cls: "web", template: "web.page", level: 4, scale: 2, needs: [{ kind: "net", minTier: 1 }],
    blurb: "A client asks for a page: put the response together from its parts and send it back.",
    stresses: ["network plan", "router", "CPU clock"], footprint: "a response of a few hundred bytes at 0x4000",
    tips: [
      { part: "net", short: "Faster plan, router", text: "Most of the time is the wire: a faster plan and router shorten the download and the upload, and more client slots on the link run several jobs at once." },
      { part: "cache", short: "D-cache holds it", text: "The response is copied and then hashed: a D-cache that holds the copy saves the second trip to RAM." },
      { part: "clock", short: "Higher CPU clock", text: "The program itself is short: a higher CPU clock shortens the part that is not the wire." },
    ] },
  { id: "api", name: "API call", cls: "web", template: "web.api", level: 4, scale: 2, needs: [{ kind: "net", minTier: 1 }],
    blurb: "A client sends an order: add up a price times a quantity for each line and answer with the total.",
    stresses: ["network latency", "the multiplier"], footprint: "a few words in the program",
    tips: [
      { part: "net", short: "More client slots", text: "The request and the answer are tiny: what limits you is how many clients the link serves at once, so a router and a plan with more slots matter more than speed." },
      { part: "clock", short: "Faster multiply", text: "A multiply for every line: a higher CPU clock shortens each." },
      { part: "ram", short: "No memory use", none: true, text: "Two loads per line and nothing else: RAM and caches are irrelevant." },
    ] },
  { id: "dns", name: "Name lookup", cls: "web", template: "web.dns", level: 5, scale: 2, needs: [{ kind: "net", minTier: 1 }],
    blurb: "Look names up in a sorted table by halving it: tiny to send, quick to answer.",
    stresses: ["network latency", "branch predictor"], footprint: "a table of 128 bytes in the program",
    tips: [
      { part: "net", short: "More client slots", text: "Almost nothing crosses the wire: the number of clients the link serves at once decides how many lookups are answered." },
      { part: "predictor", short: "Redirect speed", text: "Each step goes left or right by the name asked for, so the branches are hard to guess: a quick redirect helps." },
      { part: "ram", short: "No memory use", none: true, text: "A table that fits in the cache after its first pass: RAM does not matter." },
    ] },
  { id: "form", name: "Form check", cls: "web", template: "web.form", level: 5, scale: 2, needs: [{ kind: "net", minTier: 1 }],
    blurb: "Check what a client typed into a form: count its digits and its capital letters.",
    stresses: ["network plan", "byte loads", "CPU clock"], footprint: "a text of about 64 bytes in the program",
    tips: [
      { part: "net", short: "Faster plan, router", text: "Most of the time is the wire: a faster plan and router shorten the download and the upload, and more client slots on the link run several jobs at once." },
      { part: "clock", short: "Higher CPU clock", text: "Twelve instructions per character and nothing to overlap: a higher clock helps most of the CPU side." },
      { part: "cpu", short: "A wider CPU", text: "The two range tests of a character do not depend on each other: a 2-wide or out-of-order CPU overlaps them." },
    ] },
  { id: "search", name: "Text search", cls: "web", template: "web.search", level: 6, scale: 2, needs: [{ kind: "net", minTier: 2 }],
    blurb: "Count where a pair of letters occurs in a block of text: a result of a few megabytes goes back.",
    stresses: ["network plan (upload)", "branches"], footprint: "a text of about 100 bytes in the program",
    tips: [
      { part: "net", short: "Cable plan or better", text: "The answer is bigger than a Basic DSL upload carries in a comfortable time: a faster upload (a Cable plan and up) shortens the last stretch of the job." },
      { part: "predictor", short: "Predictor", text: "The second compare happens only after the first matched, so the branch pattern follows the text: a quick redirect helps." },
      { part: "clock", short: "Higher CPU clock", text: "The program itself is short: a higher CPU clock shortens the part that is not the wire." },
    ] },
  { id: "upload", name: "Upload scan", cls: "web", template: "web.upload", level: 7, scale: 4, needs: [{ kind: "net", minTier: 2 }],
    blurb: "A client uploads a big file: scan it for words that carry a signature.",
    stresses: ["network plan (download)", "loads"], footprint: "a file of 512 bytes in the program",
    tips: [
      { part: "net", short: "Cable plan or better", text: "The file is big, and it all has to arrive before the scan starts: a faster download (a Cable plan and up) and a faster disk shorten it." },
      { part: "cache", short: "D-cache and RAM", text: "The scan reads the file once from start to end: it streams, so row hits and two channels help more than a bigger cache." },
      { part: "clock", short: "Higher CPU clock", text: "The program itself is short: a higher CPU clock shortens the part that is not the wire." },
    ] },
  { id: "image", name: "Image resize", cls: "web", template: "web.image", level: 8, scale: 2, needs: [{ kind: "net", minTier: 2 }],
    blurb: "Shrink an image to half size by averaging each 2 by 2 block, and send the small one back.",
    stresses: ["network plan", "byte loads", "CPU width"], footprint: "an image of 256 bytes in the program",
    tips: [
      { part: "net", short: "Faster plan, router", text: "Most of the time is the wire: a faster plan and router shorten the download and the upload, and more client slots on the link run several jobs at once." },
      { part: "cpu", short: "A wider CPU", text: "The four loads of a block do not depend on each other: a 2-wide or out-of-order CPU overlaps them." },
      { part: "cache", short: "D-cache lines", text: "A block reads two rows at once: a D-cache with enough lines to hold both keeps the second row from missing." },
    ] },
  { id: "video", name: "Video chunk", cls: "web", template: "web.video", level: 9, scale: 4, needs: [{ kind: "net", minTier: 3 }],
    blurb: "Filter every sample of a video chunk and stream the result: a small request, a huge answer.",
    stresses: ["network plan (upload)", "the multiplier"], footprint: "a chunk of 768 bytes in the program",
    tips: [
      { part: "net", short: "A Fibre plan", text: "The answer is hundreds of megabytes: only the upload of a Fibre plan (or the Business and Backbone ones) sends it in a reasonable time." },
      { part: "clock", short: "Faster multiply", text: "A multiply, an add and a shift per sample: a higher CPU clock shortens the filter." },
      { part: "cpu", short: "A wider CPU", text: "Samples do not depend on each other: a wider CPU overlaps their filters." },
    ] },
  { id: "secure", name: "Signed transaction", cls: "secure", template: "secure.sign", legacy: true,
    blurb: "Measure its data with the TPM, hash it in protected mode, seal the digest and unseal it.",
    stresses: ["TPM speed", "protected-mode surcharge", "ECC RAM"], footprint: "a few words of data, in protected memory",
    tips: [
      { part: "tpm", short: "TPM and ECC", text: "It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused." },
      { part: "clock", short: "Faster CPU", text: "Inside protected mode every RAM access pays an encryption surcharge, so the hashing is slower than a plain checksum: a faster CPU helps there." },
      { part: "tpm", short: "TPM clock is fixed", none: true, text: "The TPM itself runs on one slow clock: its measure and attest waits are fixed, whatever the CPU does." },
    ] },
  { id: "verify", name: "Integrity check", cls: "secure", template: "secure.verify", level: 9, scale: 2,
    blurb: "Measure blocks of data with the TPM and compare each with the digest that was promised for it.",
    stresses: ["TPM speed", "the TPM header"], footprint: "a few blocks of 32 bytes in the program",
    tips: [
      { part: "tpm", short: "A faster module", text: "Each block is one measure command and the module hashes it word by word on its own slow clock (4 module ticks a word on the Secure module, 1 on module 2): the faster module shortens it, whatever the CPU does." },
      { part: "tpm", short: "TPM and ECC", text: "It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused." },
      { part: "clock", short: "CPU speed barely helps", none: true, text: "The CPU only starts a command and waits for the answer: a faster CPU shortens the few instructions in between and nothing else." },
    ] },
  { id: "measure", name: "Measured boot", cls: "secure", template: "secure.measure", level: 10, scale: 2,
    blurb: "Measure several stages one after the other and fold each result into a chain, as a machine does when it boots.",
    stresses: ["TPM speed", "the TPM header"], footprint: "a few blocks of 32 bytes in the program",
    tips: [
      { part: "tpm", short: "A faster module", text: "Every stage is a measure command, so the time is the number of stages times the module hashing eight words: module 2 hashes each word four times faster." },
      { part: "tpm", short: "TPM and ECC", text: "It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused." },
      { part: "clock", short: "CPU speed barely helps", none: true, text: "Between the commands there is one shift, one add and one xor: the CPU waits on the module the rest of the time." },
    ] },
  { id: "encrypt", name: "Protected hash", cls: "secure", template: "secure.encrypt", level: 10, scale: 2,
    blurb: "Hash two buffers inside protected mode, where every memory access costs extra.",
    stresses: ["the protected-mode surcharge", "CPU clock"], footprint: "two buffers of 64 bytes in the program",
    tips: [
      { part: "tpm", short: "A lower surcharge", text: "Inside protected mode every RAM access pays extra cycles: +2 on the Secure module, +1 on module 2. This is the job where that difference counts most." },
      { part: "clock", short: "A faster CPU", text: "Only two commands go to the module: the rest is hashing, which a higher CPU clock shortens." },
      { part: "cache", short: "D-cache does not help", none: true, text: "The surcharge is charged on the access, not on the miss: a bigger D-cache does not avoid it." },
    ] },
  { id: "vault", name: "Key vault", cls: "secure", template: "secure.vault", level: 11, scale: 2,
    blurb: "Seal several secrets under their own handles, then unseal them all again.",
    stresses: ["the TPM header", "TPM seal time"], footprint: "a few words in the program",
    tips: [
      { part: "tpm", short: "Module 2 no faster", none: true, text: "Sealing and unsealing take the same time on both modules: the two trips over the header and the seal itself are fixed, so a second module does not help here." },
      { part: "tpm", short: "TPM and ECC", text: "It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused." },
      { part: "clock", short: "CPU speed no help", none: true, text: "The CPU sends a command and waits for it: nothing it does can be shorter than the header trip." },
    ] },
  { id: "rotate", name: "Key rotation", cls: "secure", template: "secure.rotate", level: 12, scale: 2,
    blurb: "Unseal a value, change it, seal it again, and do it round after round: each round needs the last one.",
    stresses: ["the TPM header", "the multiplier"], footprint: "a few words in the program",
    tips: [
      { part: "tpm", short: "Module 2 no faster", none: true, text: "Sealing and unsealing take the same time on both modules, and every round needs two of them one after the other: nothing can overlap." },
      { part: "tpm", short: "TPM and ECC", text: "It needs a TPM, and the TPM needs ECC memory on every stick: without both it is refused." },
      { part: "clock", short: "Faster CPU, a little", text: "Between the commands the CPU multiplies once: its speed shortens only that, and the trips over the header stay." },
    ] },
  { id: "attest", name: "Attestation burst", cls: "secure", template: "secure.attest", level: 13, scale: 2, needs: [{ kind: "tpm", minTier: 2 }, { kind: "ecc" }],
    blurb: "Answer a burst of attestation requests: each one is a quote the module works out on its own.",
    stresses: ["TPM attest time"], footprint: "a few words in the program",
    tips: [
      { part: "tpm", short: "Module 2 attests faster", text: "A quote takes 60 module ticks on the Secure module and 20 on module 2, and the job asks for a burst of them: it is the one job that needs the faster module." },
      { part: "tpm", short: "Needs module 2", text: "Clients only send it once a machine has the second module: with the first one it is refused at the port." },
      { part: "clock", short: "CPU speed no help", none: true, text: "The CPU starts a quote and waits: only the module decides how long it takes." },
    ] },
  { id: "vadd", name: "Array add", cls: "gpu", template: "gpu.vadd", level: 10, scale: 4, boost: "GPU: about 2x faster",
    blurb: "Add one array to twelve times another, element by element: the same simple step on every lane.",
    stresses: ["a GPU (lanes)", "CPU copy speed"], footprint: "two arrays of a few hundred bytes",
    tips: [
      { part: "gpu", short: "More lanes", text: "With a card the program copies the kernel and its data to the card and waits: more lanes finish the array faster, and the copy loop is the CPU's." },
      { part: "gpu", short: "No card, slow path", text: "Without a card the same work runs on the CPU, slower, for the same pay: a card is how you stop losing time on these." },
      { part: "gpu", short: "Card memory", text: "A card with too little memory for the arrays falls back to the CPU too." },
    ] },
  { id: "saxpy", name: "Scale and add", cls: "gpu", template: "gpu.saxpy", level: 10, scale: 4, boost: "GPU: about 2x faster",
    blurb: "Multiply one array by a number, then add twelve copies of it to another: a multiply and a chain of adds.",
    stresses: ["a GPU (lanes)", "the multiplier"], footprint: "two arrays of a few hundred bytes",
    tips: [
      { part: "gpu", short: "More lanes", text: "With a card the program copies the kernel and its data to the card and waits: more lanes finish the array faster, and the copy loop is the CPU's." },
      { part: "gpu", short: "No card, slow path", text: "Without a card the same work runs on the CPU, slower, for the same pay: a card is how you stop losing time on these." },
      { part: "clock", short: "CPU only copies", text: "On a card the CPU does nothing but copy the data in and wait: a faster CPU shortens only the copy." },
    ] },
  { id: "thresh", name: "Threshold", cls: "gpu", template: "gpu.thresh", level: 11, scale: 4, boost: "GPU: about 1.4x faster",
    blurb: "Turn each value into 100 if it is big enough and 0 if not: an if and an else on every element.",
    stresses: ["a GPU (lanes)", "branches"], footprint: "one array of a few hundred bytes",
    tips: [
      { part: "gpu", short: "Lanes take turns", text: "On a card the lanes that took the if run first and the others wait for the else, so half the lanes are idle at any moment: more lanes still help, but less than for a plain add." },
      { part: "gpu", short: "Little work to share", text: "There is so little arithmetic per element that the copy to the card is most of the time: the card helps least on this one (about 1.4 times)." },
      { part: "clock", short: "CPU copy speed", text: "The CPU copies the array in and starts the card: a faster CPU shortens that copy." },
    ] },
  { id: "blur3", name: "Blur", cls: "gpu", template: "gpu.blur3", level: 11, scale: 4, boost: "GPU: about 1.6x faster",
    blurb: "Replace every value by the average of its neighbours: three loads and a multiply for each one.",
    stresses: ["a GPU (lanes)", "card memory banks"], footprint: "one array of a few hundred bytes",
    tips: [
      { part: "gpu", short: "More lanes", text: "With a card the program copies the kernel and its data to the card and waits: more lanes finish the array faster, and the copy loop is the CPU's." },
      { part: "gpu", short: "Idle edge lanes", text: "The first and last elements are treated differently, so on a card the other lanes wait while the edge lanes run: a small cost that shrinks as the array grows." },
      { part: "bank", short: "Card memory banks", text: "Neighbouring lanes read neighbouring words: a card with more memory banks serves them in the same cycle." },
    ] },
  { id: "poly", name: "Polynomial", cls: "gpu", template: "gpu.poly", level: 12, scale: 4, boost: "GPU: about 2x faster",
    blurb: "Evaluate a polynomial of degree eight for each element: eight multiplies in a row, each needing the last.",
    stresses: ["a GPU (lanes)", "the multiplier"], footprint: "two arrays of a few hundred bytes",
    tips: [
      { part: "gpu", short: "More lanes", text: "With a card the program copies the kernel and its data to the card and waits: more lanes finish the array faster, and the copy loop is the CPU's." },
      { part: "gpu", short: "No card, slow path", text: "Without a card the same work runs on the CPU, slower, for the same pay: a card is how you stop losing time on these." },
      { part: "clock", short: "A higher card clock", text: "Every lane runs the same chain of multiplies: the card's own clock speeds the whole chain, and a card overclock pays here." },
    ] },
  { id: "mandel", name: "Mandelbrot", cls: "gpu", template: "gpu.mandel", level: 13, scale: 4, boost: "GPU: about 15x faster",
    blurb: "Count how long each point takes to escape: some points leave at once and some never do, so lanes finish at very different times.",
    stresses: ["a GPU (lanes)", "divergence"], footprint: "no input: the points come from the element number",
    tips: [
      { part: "gpu", short: "Card is a must", text: "Without a card this runs the whole loop on the CPU, about fifteen times slower: the clients will take it back long before it is done." },
      { part: "gpu", short: "More lanes", text: "Many points run at once, but a chunk of lanes waits for its slowest point: more lanes still finish the row sooner." },
      { part: "clock", short: "A higher card clock", text: "The card spends nearly all its time in the inner loop: its clock speeds that directly." },
    ] },
  { id: "sphere", name: "Spinning balls", cls: "gpu", template: "gpu.sphere", level: 14, scale: 4, boost: "GPU: about 7x faster",
    blurb: "Shade a row of four checkered balls, one point at a time: where each point sits on a ball decides how bright it is and which square it lands on. Every job has the balls turned a different way.",
    stresses: ["a GPU (lanes)", "the multiplier"], footprint: "no input: the picture comes from the element number",
    tips: [
      { part: "gpu", short: "More lanes", text: "Every point is shaded on its own with the same steps, so lanes never wait for each other: twice the lanes draws the picture in about half the time." },
      { part: "gpu", short: "Card is a must", text: "Without a card the CPU shades the points one after another, many times slower, for the same pay." },
      { part: "clock", short: "A higher card clock", text: "It is all multiplies and shifts, one after the other: the card's own clock speeds every step." },
    ] },
  { id: "spherewide", name: "Spinning balls, widescreen", cls: "gpu", template: "gpu.spherewide", level: 15, scale: 8, boost: "GPU: about 7x faster",
    blurb: "The same balls on a 16:9 picture, two rows of four. It is 9 KB of picture: more than the smallest card holds, so it wants a bigger card.",
    stresses: ["a GPU (card memory)", "the multiplier"], footprint: "no input: the picture comes from the element number",
    tips: [
      { part: "gpu", short: "A card with 16K", text: "The picture does not fit the 8K card's memory, so that card leaves the whole job to the CPU: a bigger card draws it, and shows the whole 16:9 picture on its display." },
      { part: "gpu", short: "More lanes", text: "Every point is shaded on its own with the same steps: twice the lanes draws the picture in about half the time." },
    ] },
  { id: "npu", name: "Inference", cls: "npu", template: "npu.infer", legacy: true,
    boost: "NPU: about 8x faster",
    blurb: "A few dense layers over a small batch with seeded weights.",
    stresses: ["an NPU (array size)", "else a GPU", "else the CPU"], footprint: "a few hundred bytes to a few K of weights",
    tips: [
      { part: "npu", short: "NPU, GPU, then CPU", text: "The program takes the best path it finds: the NPU, then a GPU (one launch per layer), then the CPU (a loop per layer). Each step down is much slower at the same pay." },
      { part: "npu", short: "Grid fits the batch", text: "An NPU's grid has to divide the batch size and its memory has to hold the weights, or the job falls through to the next path." },
    ] },
  { id: "perceptron", name: "Perceptron", cls: "npu", template: "npu.perceptron", level: 12, scale: 1, boost: "NPU: about 4x faster",
    blurb: "One dense layer over a small batch: 512 multiply-adds, the simplest thing a network does.",
    stresses: ["an NPU (array size)", "else a GPU", "else the CPU"], footprint: "a few hundred bytes of weights",
    tips: [
      { part: "npu", short: "NPU, GPU, then CPU", text: "The program takes the best path it finds: the NPU, then a GPU, then the CPU. A single layer is the job where the CPU path loses least (about four times slower than the NPU)." },
      { part: "npu", short: "Grid fits the batch", text: "An NPU grid has to divide the batch size and its memory has to hold the weights, or the job falls through to the next path." },
    ] },
  { id: "deep", name: "Deep network", cls: "npu", template: "npu.deep", level: 14, scale: 4, boost: "NPU: about 9x faster",
    blurb: "Six dense layers one after the other: each needs the last one's answer, so nothing can start early.",
    stresses: ["an NPU (array size)", "else a GPU", "else the CPU"], footprint: "a few K of weights",
    tips: [
      { part: "npu", short: "NPU, GPU, then CPU", text: "The program takes the best path it finds. Each step down is much slower at the same pay: about nine times for the NPU against the CPU on six layers." },
      { part: "gpu", short: "A launch per layer", text: "On a GPU every layer is a separate launch, with the copy and the wait that come with it: an NPU runs all six from one list of descriptors." },
      { part: "npu", short: "Grid fits the batch", text: "An NPU grid has to divide the batch size and its memory has to hold all six layers of weights, or the job falls through to the next path." },
    ] },
  { id: "hpc-reduce", name: "Parallel sum", cls: "hpc", template: "hpc.reduce", level: 14, scale: 8, needs: [{ kind: "cores", min: 2 }, { kind: "os", min: 4 }],
    blurb: "Add up a long list of numbers: each of two threads takes half and the two halves are added at the end.",
    stresses: ["cores", "memory bandwidth"], footprint: "one array of 64 words per unit of scale, split between the threads",
    tips: [
      { part: "cpu", short: "More cores", text: "Two threads share the list, so two cores finish in about half the time of one. A third core changes nothing: the job has two threads." },
      { part: "os", short: "Needs OS 4", text: "It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it." },
      { part: "cache", short: "Little to cache", text: "Every number is read once and multiplied by itself: a bigger cache helps only a little, and a faster core helps as much as it does anywhere." },
    ] },
  { id: "hpc-matmul", name: "Matrix product", cls: "hpc", template: "hpc.matmul", level: 14, scale: 8, needs: [{ kind: "cores", min: 2 }, { kind: "os", min: 4 }],
    blurb: "Multiply two small square matrices: the rows of the answer are split between two threads.",
    stresses: ["cores", "the multiplier"], footprint: "an 8-row matrix, a matrix of 8 columns and the answer, a few K at most",
    tips: [
      { part: "cpu", short: "More cores", text: "Each thread computes half the rows of the answer, so two cores finish in about half the time." },
      { part: "cpu", short: "The multiplier", text: "Almost all the time goes in multiplies: a core with a faster multiplier or a wider out-of-order engine shortens every row." },
      { part: "os", short: "Needs OS 4", text: "It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it." },
    ] },
  { id: "hpc-nbody", name: "N-body step", cls: "hpc", template: "hpc.nbody", level: 15, scale: 8, needs: [{ kind: "cores", min: 2 }, { kind: "os", min: 4 }],
    blurb: "Work out the pull of every body on every other, and move them one step: two threads each take half the bodies.",
    stresses: ["cores", "the multiplier", "cache"], footprint: "sixteen positions, twice (this step and the last)",
    tips: [
      { part: "cpu", short: "More cores", text: "Each thread moves half of the bodies, but both read every position and they wait for each other after every step: two cores finish in somewhat over half the time." },
      { part: "cache", short: "Shared reads", text: "Both threads read all the positions: a cache that holds them keeps the second core from waiting on memory." },
      { part: "os", short: "Needs OS 4", text: "It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it." },
    ] },
  { id: "hpc-montecarlo", name: "Monte Carlo", cls: "hpc", template: "hpc.montecarlo", level: 15, scale: 8, needs: [{ kind: "cores", min: 4 }, { kind: "os", min: 4 }],
    blurb: "Throw seeded random points and count how many land inside: four threads each throw a quarter and the counts are added.",
    stresses: ["cores", "single-thread speed"], footprint: "no table: each point comes from a hash of its number",
    tips: [
      { part: "cpu", short: "Four cores", text: "Four independent streams of work with almost no memory traffic, and a single wait at the end: it is the job that scales best with the number of cores, up to four." },
      { part: "cpu", short: "Threads on one core", text: "Two threads on one core (SMT or switch-on-miss) share its units: they help less than a second core, but they cost less." },
      { part: "os", short: "Needs OS 4", text: "It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it." },
    ] },
  { id: "hpc-sort", name: "Parallel sort", cls: "hpc", template: "hpc.sort", level: 16, scale: 8, needs: [{ kind: "cores", min: 4 }, { kind: "os", min: 4 }],
    blurb: "Sort a list: four threads sort a quarter each and then the sorted quarters are merged one after the other.",
    stresses: ["cores", "branch prediction", "cache"], footprint: "16 words per unit of scale, and the merged copy",
    tips: [
      { part: "cpu", short: "Four cores", text: "The four quarters are sorted at once; the merge at the end is one thread's work, so the job does not get four times faster." },
      { part: "predictor", short: "Branch predictor", text: "Every comparison is a branch that goes either way: a better predictor shortens the sorting of each quarter." },
      { part: "cache", short: "The copy", text: "The merge reads from every quarter and writes a copy: a bigger cache keeps both close." },
      { part: "os", short: "Needs OS 4", text: "It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it." },
    ] },
  { id: "hpc-bfs", name: "Graph search", cls: "hpc", template: "hpc.bfs", level: 17, scale: 8, needs: [{ kind: "cores", min: 8 }, { kind: "os", min: 4 }],
    blurb: "Find how far every point of a graph is from the first one, level by level: eight threads settle their own points each level and meet at a barrier before the next.",
    stresses: ["cores", "memory latency", "barriers"], footprint: "two in-edges per vertex, and the level of each vertex",
    tips: [
      { part: "cpu", short: "Eight cores", text: "Eight threads share every level: the job needs a CPU with eight logical cores, and on them it is several times faster than on two." },
      { part: "ram", short: "Scattered reads", text: "Each point looks up its two in-edges, which are all over the table: low memory latency matters more than bandwidth." },
      { part: "os", short: "Needs OS 4", text: "It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it." },
    ] },
  { id: "hpc-fft", name: "Fourier transform", cls: "hpc", template: "hpc.fft", level: 17, scale: 8, needs: [{ kind: "cores", min: 8 }, { kind: "os", min: 4 }],
    blurb: "Transform a signal stage by stage with butterflies (a sum and a difference of two values): eight threads take their share of each stage and wait for each other between stages.",
    stresses: ["cores", "barriers", "memory"], footprint: "one array of 64 to 256 words, updated in place",
    tips: [
      { part: "cpu", short: "Eight cores", text: "Eight threads share every stage: the job needs eight logical cores, and on them it is several times faster than on two." },
      { part: "cpu", short: "The barrier", text: "After each stage every thread waits for the slowest: one slow core holds up all of them." },
      { part: "os", short: "Needs OS 4", text: "It is a threaded program: only OS 4 starts the threads, one per logical core, and a CPU with fewer logical cores than the job has threads is not sent it." },
    ] },
];

/** The kind of job a generator template makes: the entry whose template it is (a key made from the mixed `cli` template has none until its program says which). */
export const taskOfTemplate = (template: string): DexEntry | undefined => JOB_DEX.find((e) => !e.planned && e.template === template);

/** The level the clients start sending a job, and what it needs: its own, else its class's. */
export const taskLevel = (e: DexEntry): number => e.level ?? jobClass(e.cls)?.firstLevel ?? 1;
export const taskNeeds = (e: DexEntry): Need[] => e.needs ?? jobClass(e.cls)?.needs ?? [];

/**
 * The job a class sends for a draw `seed` at `level`, from the ones that have arrived at that level (weighted), or undefined to send the class's own
 * template (while only legacy jobs have arrived, which keeps a game that has not got further playing as it always did).
 */
export function pickTask(cls: JobClassDef, level: number, seed: number, off?: ReadonlySet<string>): DexEntry | undefined {
  const open = JOB_DEX.filter((e) => e.cls === cls.id && !e.planned && taskLevel(e) <= level && !off?.has(e.id));
  // With kinds switched off (sandbox) the class's own template could send one of them, so a pick is always made from what is left.
  if (open.length === 0 || (!off?.size && open.every((e) => e.legacy))) return undefined;
  const total = open.reduce((n, e) => n + (e.weight ?? 1), 0);
  let x = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0) / 2 ** 32 * total;
  for (const e of open) {
    x -= e.weight ?? 1;
    if (x < 0) return e;
  }
  return open[open.length - 1];
}

/** True when the class has kinds at `level` and every one of them is in `off`: it has nothing left to send (sandbox). */
export function classBlocked(cls: JobClassDef, level: number, off: ReadonlySet<string>): boolean {
  const open = JOB_DEX.filter((e) => e.cls === cls.id && !e.planned && taskLevel(e) <= level);
  return open.length > 0 && open.every((e) => off.has(e.id));
}

/** The number of an entry in the collection (1, 2, ...): the order the groups show them in. */
export const dexNumber = (id: string): number => DEX_GROUPS.flatMap((g) => g.ids).indexOf(id) + 1;

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
  return { needs: taskNeeds(e).map((n) => describeNeed(n).long), firstLevel: taskLevel(e) };
}

/** What the class needs as chips: the kind (for an icon), the short label and the long phrase. */
export function needChips(e: DexEntry): Array<{ kind: string; short: string; long: string }> {
  return taskNeeds(e).map((n) => ({ kind: n.kind, ...describeNeed(n) }));
}
