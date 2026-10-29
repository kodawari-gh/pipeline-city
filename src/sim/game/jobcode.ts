// The almanac's code view (docs/JOBS.md "Reading the code"): a job's real program as the machine runs it. The program the generator makes is run on the
// reference interpreter, counting what each instruction does, so the listing shows how often every line ran and the breakdown shows how much of the job is
// arithmetic, loads and stores, multiplies, branches. Pure: no sim state, nothing is changed by looking.

import { generate } from "../gen";
import { decode, disassemble, SPEC_BY_NAME } from "../isa";
import { RefCpu, RefMemory } from "../ref";

/** What an instruction does for the machine: the classes the die and the RAM view colour by. */
export type OpClass = "alu" | "mul" | "ld" | "st" | "br" | "sys";
export const OP_CLASSES: readonly OpClass[] = ["alu", "ld", "st", "mul", "br", "sys"];
export const OP_CLASS_NAME: Record<OpClass, string> = { alu: "arithmetic and logic", ld: "loads", st: "stores", mul: "multiplies", br: "branches and jumps", sys: "system" };

export function opClassOf(mnemonic: string): OpClass {
  if (mnemonic === "mul") return "mul";
  if (mnemonic === "lw" || mnemonic === "lb" || mnemonic === "lbu") return "ld";
  if (mnemonic === "sw" || mnemonic === "sb") return "st";
  if (mnemonic === "jal" || mnemonic === "jalr" || mnemonic[0] === "b") return "br";
  if (mnemonic === "ecall" || mnemonic === "iret") return "sys";
  return "alu";
}

/** One word of the program: where it is, what it is and how many times it ran. */
export interface CodeLine {
  addr: number;
  word: number;
  text: string;
  cls: OpClass;
  /** Times this instruction was executed (0 for data and dead code). */
  count: number;
  /** Labels that name this address (kernel and loop names from the assembler). */
  labels: string[];
}

export interface CodeProfile {
  template: string;
  scale: number;
  /** The assembly source the generator wrote (labels, comments). */
  asm: string;
  lines: CodeLine[];
  /** Instructions executed, by class. */
  mix: Record<OpClass, number>;
  /** Instructions in the program (code only: words that ran at least once), by class. */
  staticMix: Record<OpClass, number>;
  steps: number;
  codeWords: number;
  dataWords: number;
  /** Conditional branches executed and how many were taken. */
  branches: number;
  taken: number;
  /** Distinct 256-byte pages the loads and stores touched (device addresses excluded), and the bytes they moved. */
  pages: number;
  bytesMoved: number;
  /** The text the job leaves on the display. */
  display: string;
}

const zero = (): Record<OpClass, number> => ({ alu: 0, ld: 0, st: 0, mul: 0, br: 0, sys: 0 });
const MAX_STEPS = 3_000_000;
const DEVICE_BASE = 0x4000_0000;

const cache = new Map<string, CodeProfile>();

/** Generate the job's program for `template` and `scale` (seed 1) and run it, counting what it does. */
export function profileOf(template: string, scale: number, seed = 1): CodeProfile {
  const key = `${template}|${scale}|${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = generate(template, seed, { scale, hosted: false });
  const cpu = new RefCpu(new RefMemory(1024 * 1024));
  cpu.load(g.program);
  const counts = new Uint32Array(g.program.length);
  const mix = zero();
  const pages = new Set<number>();
  let branches = 0, taken = 0, bytes = 0, guard = 0;
  while (!cpu.halted && guard++ < MAX_STEPS) {
    const pc = cpu.pc, i = decode(cpu.mem.load32(pc));
    if (!i) break;
    const k = pc >>> 2;
    if (k < counts.length) counts[k]!++;
    const cls = opClassOf(i.name);
    mix[cls]++;
    let addr = -1;
    if (cls === "ld" || cls === "st") {
      addr = (cpu.regs[i.rs1]! + i.imm) >>> 0;
      const w = i.name === "lw" || i.name === "sw" ? 4 : 1;
      if (addr < DEVICE_BASE) { pages.add(addr >>> 8); bytes += w; }
    }
    cpu.step();
    if (cls === "br" && i.name[0] === "b") { branches++; if (cpu.pc !== ((pc + 4) >>> 0)) taken++; }
  }
  const labels = new Map<number, string[]>();
  for (const [name, a] of g.symbols) { const l = labels.get(a) ?? []; l.push(name); labels.set(a, l); }
  const lines: CodeLine[] = [], staticMix = zero();
  let codeWords = 0;
  g.program.forEach((word, k) => {
    const text = disassemble(word), mn = text.split(" ")[0]!;
    const known = SPEC_BY_NAME.has(mn);
    const cls = known ? opClassOf(mn) : "alu";
    const count = counts[k] ?? 0;
    if (count > 0) { codeWords++; staticMix[cls]++; }
    lines.push({ addr: 4 * k, word: word >>> 0, text, cls, count, labels: labels.get(4 * k) ?? [] });
  });
  const out: CodeProfile = {
    template, scale, asm: g.asm, lines, mix, staticMix, steps: guard, codeWords, dataWords: g.program.length - codeWords,
    branches, taken, pages: pages.size, bytesMoved: bytes, display: cpu.mem.displayText().split("\n").filter((l) => l.trim()).join("\n"),
  };
  cache.set(key, out);
  return out;
}

/** The share of the executed instructions that is each class, 0..1. */
export function mixShares(p: CodeProfile): Record<OpClass, number> {
  const n = Math.max(1, p.steps);
  const out = zero();
  for (const c of OP_CLASSES) out[c] = p.mix[c] / n;
  return out;
}

/**
 * How much the job leans on each part of the machine, from what it executed: arithmetic (the ALU and multiplier), memory (loads and stores) and control
 * (branches), as shares of the instructions that did something; plus how memory-heavy it is in bytes per instruction.
 */
export function reliance(p: CodeProfile): { compute: number; memory: number; control: number; bytesPerInstr: number } {
  const s = mixShares(p), useful = Math.max(1e-9, 1 - s.sys);
  return { compute: (s.alu + s.mul) / useful, memory: (s.ld + s.st) / useful, control: s.br / useful, bytesPerInstr: p.bytesMoved / Math.max(1, p.steps) };
}

/** The almanac entry -> the generator template that makes its program, and the scales worth looking at. */
export const CODE_SOURCE: Record<string, { template: string; scales: number[] }> = {
  log: { template: "cli.log", scales: [1, 2, 4] },
  calc: { template: "cli.calc", scales: [1, 2, 4] },
  checksum: { template: "cli.checksum", scales: [1, 2, 4] },
  fib: { template: "cli.fib", scales: [1, 2, 4] },
  reverse: { template: "cli.reverse", scales: [1, 2, 3] },
  gcd: { template: "cli.gcd", scales: [1, 2, 4] },
  popcount: { template: "cli.popcount", scales: [1, 2, 4] },
  sort: { template: "cli.sort", scales: [1, 2, 4] },
  matmul: { template: "cli.matmul", scales: [1, 2, 4] },
  crc: { template: "cli.crc", scales: [1, 2, 4] },
  scan: { template: "cli.scan", scales: [1, 2, 4, 8] },
  db: { template: "db.index", scales: [1, 2, 4, 8] },
  chase: { template: "mem.chase", scales: [1, 2, 4] },
  stream: { template: "mem.stream", scales: [1, 2, 4] },
  stencil: { template: "mem.stencil", scales: [1, 2, 4] },
  transpose: { template: "mem.transpose", scales: [1, 2] },
  sieve: { template: "mem.sieve", scales: [1, 2, 4] },
  hashtab: { template: "mem.hashtab", scales: [1, 2, 4] },
  secure: { template: "secure.sign", scales: [1, 2, 4] },
  verify: { template: "secure.verify", scales: [1, 2, 4] },
  measure: { template: "secure.measure", scales: [1, 2, 4] },
  encrypt: { template: "secure.encrypt", scales: [1, 2, 4] },
  vault: { template: "secure.vault", scales: [1, 2, 4] },
  rotate: { template: "secure.rotate", scales: [1, 2, 4] },
  attest: { template: "secure.attest", scales: [1, 2, 4] },
  vadd: { template: "gpu.vadd", scales: [2, 4, 8] },
  saxpy: { template: "gpu.saxpy", scales: [2, 4, 8] },
  thresh: { template: "gpu.thresh", scales: [2, 4, 8] },
  blur3: { template: "gpu.blur3", scales: [2, 4, 8] },
  poly: { template: "gpu.poly", scales: [2, 4, 8] },
  mandel: { template: "gpu.mandel", scales: [2, 4, 8] },
  sphere: { template: "gpu.sphere", scales: [2, 4] },
  spherewide: { template: "gpu.spherewide", scales: [8] },
  perceptron: { template: "npu.perceptron", scales: [1, 2] },
  npu: { template: "npu.infer", scales: [1, 2, 4] },
  deep: { template: "npu.deep", scales: [1, 2, 4] },
  page: { template: "web.page", scales: [1, 2, 4] },
  api: { template: "web.api", scales: [1, 2, 4] },
  dns: { template: "web.dns", scales: [1, 2, 4] },
  form: { template: "web.form", scales: [1, 2, 4] },
  search: { template: "web.search", scales: [1, 2, 4] },
  upload: { template: "web.upload", scales: [1, 2, 4] },
  image: { template: "web.image", scales: [1, 2, 4] },
  video: { template: "web.video", scales: [1, 2, 4] },
  "hpc-reduce": { template: "hpc.reduce", scales: [1, 2, 4] },
  "hpc-matmul": { template: "hpc.matmul", scales: [1, 2] },
  "hpc-nbody": { template: "hpc.nbody", scales: [1, 2, 4] },
  "hpc-montecarlo": { template: "hpc.montecarlo", scales: [1, 2, 4] },
  "hpc-sort": { template: "hpc.sort", scales: [1, 2, 4] },
  "hpc-bfs": { template: "hpc.bfs", scales: [1, 2, 4] },
  "hpc-fft": { template: "hpc.fft", scales: [1, 2, 4] },
};

export interface HighLevel { cpp: string; python: string }

/** The same job as a person would write it: what the assembly above does, in C++ and in Python (shown for the keen). */
export const HIGH_LEVEL: Record<string, HighLevel> = {
  log: {
    cpp: `// cli.log: wait for the display, then write one status line per unit of scale
#include <cstdint>
extern volatile uint8_t display[16][64];     // memory-mapped text display
extern volatile uint32_t display_busy;        // reads 1 while the display is writing

void log_job(const char* const* lines, int scale, int row) {
    while (display_busy) { }                  // poll_idle: spin until the display is free
    for (int i = 0; i < scale; i++)           // one line per unit of scale
        for (int c = 0; lines[i][c]; c++)
            display[row + i][c] = lines[i][c]; // each store waits on the display
}`,
    python: `# cli.log: wait for the display, then write one status line per unit of scale
def log_job(display, lines, scale, row):
    while display.busy():                 # poll_idle: spin until the display is free
        pass
    for i in range(scale):                # one line per unit of scale
        for c, ch in enumerate(lines[i]):
            display[row + i][c] = ch      # each store waits on the display`,
  },
  calc: {
    cpp: `// cli.calc: x = x * m + a, repeated; show the low 6 bits
#include <cstdint>
uint32_t calc(uint32_t x, int rounds, uint32_t m, uint32_t a) {
    for (int i = 0; i < rounds; i++)
        x = x * m + a;                        // mul, then addi: each round needs the last result
    return x & 63;                            // andi, then print_dec
}`,
    python: `# cli.calc: x = x * m + a, repeated; show the low 6 bits
def calc(x, rounds, m, a):
    for _ in range(rounds):
        x = (x * m + a) & 0xFFFFFFFF      # mul, then addi: each round needs the last result
    return x & 63                         # andi, then print_dec`,
  },
  checksum: {
    cpp: `// cli.checksum: hash the data words that travel inside the program
#include <cstdint>
uint32_t checksum(const uint32_t* data, int words) {
    uint32_t h = 5381;
    for (int i = 0; i < words; i++)
        h = ((h + (h << 5)) ^ data[i]);       // lw, slli, add, xor: a load every round
    return h & 63;
}`,
    python: `# cli.checksum: hash the data words that travel inside the program
def checksum(data):
    h = 5381
    for w in data:
        h = ((h + (h << 5)) ^ w) & 0xFFFFFFFF   # lw, slli, add, xor: a load every round
    return h & 63`,
  },
  fib: {
    cpp: `// cli.fib: add the last two numbers, again and again
#include <cstdint>
uint32_t fib(uint32_t x, uint32_t y, int steps) {
    for (int i = 0; i < steps; i++) {
        uint32_t t = x + y;                   // add: needs both of the last two
        x = y; y = t;                         // two mv, no work of their own
    }
    return x & 63;
}`,
    python: `# cli.fib: add the last two numbers, again and again
def fib(x, y, steps):
    for _ in range(steps):
        x, y = y, (x + y) & 0xFFFFFFFF        # add: needs both of the last two
    return x & 63`,
  },
  reverse: {
    cpp: `// cli.reverse: write each word to the display backwards
#include <cstdint>
extern volatile uint8_t display[16][64];
void reverse(const char* word, int n, int row, int col) {
    for (int i = 0; i < n; i++)
        display[row][col + n - 1 - i] = word[i];   // lbu, then sb to the display
}`,
    python: `# cli.reverse: write each word to the display backwards
def reverse(display, word, row, col):
    for i, ch in enumerate(word):
        display[row][col + len(word) - 1 - i] = ch   # lbu, then sb to the display`,
  },
  gcd: {
    cpp: `// cli.gcd: the greatest common divisor of each pair, by subtraction, added up
#include <cstdint>
uint32_t gcd_sum(const uint32_t* pairs, int n) {
    uint32_t sum = 0;
    for (int i = 0; i < n; i++) {
        uint32_t a = pairs[2 * i], b = pairs[2 * i + 1];
        while (a != b) {                      // beq: leave when they meet
            if (a < b) b -= a; else a -= b;   // blt: which way depends on the data
        }
        sum += a;
    }
    return sum & 63;
}`,
    python: `# cli.gcd: the greatest common divisor of each pair, by subtraction, added up
def gcd_sum(pairs):
    total = 0
    for a, b in pairs:
        while a != b:                         # beq: leave when they meet
            if a < b: b -= a                  # blt: which way depends on the data
            else: a -= b
        total += a
    return total & 63`,
  },
  popcount: {
    cpp: `// cli.popcount: count the 1 bits of each word, one shift at a time
#include <cstdint>
uint32_t pop_count(const uint32_t* data, int words) {
    uint32_t bits = 0;
    for (int i = 0; i < words; i++)
        for (uint32_t w = data[i]; w; w >>= 1)   // beq: stop when the word is empty
            bits += w & 1;                       // andi, add, srli: per bit
    return bits & 63;
}`,
    python: `# cli.popcount: count the 1 bits of each word, one shift at a time
def pop_count(data):
    bits = 0
    for w in data:
        while w:                              # beq: stop when the word is empty
            bits += w & 1                     # andi, add, srli: per bit
            w >>= 1
    return bits & 63`,
  },
  sort: {
    cpp: `// cli.sort: insertion sort in memory, then a checksum that needs every number in place
#include <cstdint>
uint32_t sort_check(uint32_t* a, const uint32_t* src, int n) {
    for (int i = 0; i < n; i++) a[i] = src[i];        // the copy: lw, sw
    for (int i = 1; i < n; i++) {
        uint32_t key = a[i]; int j = i;
        while (j > 0 && a[j - 1] > key) { a[j] = a[j - 1]; j--; }   // lw, compare, sw: data decides how far
        a[j] = key;
    }
    uint32_t sum = 0;
    for (int i = 0; i < n; i++) sum += (i + 1) * a[i]; // mul: position times value
    return sum & 1023;
}`,
    python: `# cli.sort: insertion sort in memory, then a checksum that needs every number in place
def sort_check(src):
    a = list(src)                             # the copy: lw, sw
    for i in range(1, len(a)):
        key, j = a[i], i
        while j > 0 and a[j - 1] > key:       # lw, compare, sw: data decides how far
            a[j] = a[j - 1]; j -= 1
        a[j] = key
    return sum((i + 1) * v for i, v in enumerate(a)) & 1023   # mul: position times value`,
  },
  matmul: {
    cpp: `// cli.matmul: the sum of the elements of A x B, element by element
#include <cstdint>
uint32_t mat_mul(const uint32_t* A, const uint32_t* B, int n) {
    uint32_t total = 0;
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            for (int k = 0; k < n; k++)
                total += A[i * n + k] * B[k * n + j];   // two index multiplies, two loads, one product
    return total & 1023;
}`,
    python: `# cli.matmul: the sum of the elements of A x B, element by element
def mat_mul(A, B, n):
    total = 0
    for i in range(n):
        for j in range(n):
            for k in range(n):
                total += A[i * n + k] * B[k * n + j]    # two index multiplies, two loads, one product
    return total & 1023`,
  },
  crc: {
    cpp: `// cli.crc: CRC-32 (reflected, 0xEDB88320) of each word, a bit at a time
#include <cstdint>
uint32_t crc32(const uint32_t* data, int words) {
    uint32_t crc = 0xFFFFFFFF;
    for (int i = 0; i < words; i++) {
        crc ^= data[i];
        for (int bit = 0; bit < 32; bit++)
            crc = (crc & 1) ? (crc >> 1) ^ 0xEDB88320 : crc >> 1;   // beq on the low bit: half go each way
    }
    return ~crc & 1023;
}`,
    python: `# cli.crc: CRC-32 (reflected, 0xEDB88320) of each word, a bit at a time
def crc32(data):
    crc = 0xFFFFFFFF
    for w in data:
        crc ^= w
        for _ in range(32):
            crc = (crc >> 1) ^ 0xEDB88320 if crc & 1 else crc >> 1   # beq on the low bit: half go each way
    return ~crc & 1023`,
  },
  scan: {
    cpp: `// cli.scan: fill a buffer at a stride, then sum it
#include <cstdint>
uint32_t scan(uint8_t* buf, int count, int stride_bytes, uint32_t start) {
    uint8_t* p = buf;
    for (int i = 0; i < count; i++, p += stride_bytes)
        *(uint32_t*)p = start + 3 * i;       // fill_stride: one store per element, each on a new cache line
    uint32_t sum = 0;
    p = buf;
    for (int i = 0; i < count; i++, p += stride_bytes)
        sum += *(uint32_t*)p;                // array_sum: one load per element
    return sum & 1023;
}`,
    python: `# cli.scan: fill a buffer at a stride, then sum it
def scan(mem, buf, count, stride, start):
    for i in range(count):
        mem.store32(buf + i * stride, start + 3 * i)   # fill_stride: each on a new cache line
    total = 0
    for i in range(count):
        total += mem.load32(buf + i * stride)          # array_sum
    return total & 1023`,
  },
  chase: {
    cpp: `// mem.chase: build a ring of 64-byte nodes, then follow it
#include <cstdint>
uint32_t chase(uint8_t* base, int nodes, int steps) {
    for (int i = 0; i < nodes; i++)
        *(uint32_t*)(base + 64 * i) = (uint32_t)(base + 64 * ((5 * i + 1) & (nodes - 1)));   // chase_build: store the next address
    uint32_t p = (uint32_t)base;
    for (int s = 0; s < steps; s++)
        p = *(uint32_t*)p;                       // chase_walk: one load, and the next one needs its answer
    return ((p - (uint32_t)base) >> 6) & 1023;
}`,
    python: `# mem.chase: build a ring of 64-byte nodes, then follow it
def chase(mem, base, nodes, steps):
    for i in range(nodes):
        mem.store32(base + 64 * i, base + 64 * ((5 * i + 1) & (nodes - 1)))   # chase_build: store the next address
    p = base
    for _ in range(steps):
        p = mem.load32(p)                        # chase_walk: one load, and the next one needs its answer
    return ((p - base) >> 6) & 1023`,
  },
  stream: {
    cpp: `// mem.stream: fill a block, copy it, hash the copy
#include <cstdint>
uint32_t stream(uint32_t* src, uint32_t* dst, int words, uint32_t start) {
    for (int i = 0; i < words; i++) src[i] = start + 3 * i;     // fill_stride: in order
    for (int i = 0; i < words; i++) dst[i] = src[i];            // copy_block: lw, sw, each the next address
    uint32_t h = 5381;
    for (int i = 0; i < words; i++) h = (h + (h << 5)) ^ dst[i]; // checksum over the copy
    return h & 1023;
}`,
    python: `# mem.stream: fill a block, copy it, hash the copy
def stream(mem, src, dst, words, start):
    for i in range(words):
        mem.store32(src + 4 * i, start + 3 * i)                 # fill_stride: in order
    for i in range(words):
        mem.store32(dst + 4 * i, mem.load32(src + 4 * i))       # copy_block: lw, sw, each the next address
    h = 5381
    for i in range(words):
        h = ((h + (h << 5)) ^ mem.load32(dst + 4 * i)) & 0xFFFFFFFF   # checksum over the copy
    return h & 1023`,
  },
  stencil: {
    cpp: `// mem.stencil: each output is the sum of three neighbours
#include <cstdint>
uint32_t stencil(const uint32_t* a, uint32_t* out, int n) {
    uint32_t sum = 0;
    for (int i = 1; i < n - 1; i++) {
        out[i] = a[i - 1] + a[i] + a[i + 1];     // three loads, two adds, one store: most of the loads were seen last round
        sum += out[i];
    }
    return sum & 1023;
}`,
    python: `# mem.stencil: each output is the sum of three neighbours
def stencil(a, out):
    total = 0
    for i in range(1, len(a) - 1):
        out[i] = a[i - 1] + a[i] + a[i + 1]      # three loads, two adds, one store: most of the loads were seen last round
        total += out[i]
    return total & 1023`,
  },
  transpose: {
    cpp: `// mem.transpose: read along the rows, write down the columns
#include <cstdint>
uint32_t transpose(const uint32_t* src, uint32_t* dst, int n) {
    for (int i = 0; i < n; i++)
        for (int j = 0; j < n; j++)
            dst[j * n + i] = src[i * n + j];     // the load walks in order, the store jumps a whole row
    uint32_t sum = 0;
    for (int k = 0; k < n * n; k++) sum += dst[k] * ((k & 7) + 1);   // weighted_sum: wrong only if a word moved
    return sum & 1023;
}`,
    python: `# mem.transpose: read along the rows, write down the columns
def transpose(src, n):
    dst = [0] * (n * n)
    for i in range(n):
        for j in range(n):
            dst[j * n + i] = src[i * n + j]      # the load walks in order, the store jumps a whole row
    return sum(v * ((k & 7) + 1) for k, v in enumerate(dst)) & 1023   # weighted_sum`,
  },
  sieve: {
    cpp: `// mem.sieve: count the primes below n with a byte of flags each
#include <cstdint>
uint32_t sieve(uint8_t* flags, int n) {
    for (int i = 0; i < n; i++) flags[i] = 0;    // clear the flags
    uint32_t primes = 0;
    for (int i = 2; i < n; i++) {
        if (flags[i]) continue;                  // lbu, bne: a composite already
        primes++;
        for (int j = i * i; j < n; j += i) flags[j] = 1;   // sb: cross off the multiples
    }
    return primes & 1023;
}`,
    python: `# mem.sieve: count the primes below n with a byte of flags each
def sieve(n):
    flags = bytearray(n)                         # clear the flags
    primes = 0
    for i in range(2, n):
        if flags[i]:
            continue                             # lbu, bne: a composite already
        primes += 1
        for j in range(i * i, n, i):
            flags[j] = 1                         # sb: cross off the multiples
    return primes & 1023`,
  },
  hashtab: {
    cpp: `// mem.hashtab: put keys in a 256-slot table in the heap, then look them all up
#include <cstdint>
const uintptr_t HEAP = 0x10000;                  // the big heap, as for the index job
uint32_t hashtab(const uint32_t* keys, int n) {
    uint32_t* table = (uint32_t*)HEAP;
    for (int i = 0; i < 256; i++) table[i] = 0;  // zero_words
    for (int i = 0; i < n; i++) {
        uint32_t s = (keys[i] * 2654435761u) >> 24;          // mul, srli: the slot, scattered over the table
        while (table[s]) s = (s + 1) & 255;                  // a clash steps to the next slot
        table[s] = keys[i];
    }
    uint32_t looked = 0;
    for (int i = 0; i < n; i++) {
        uint32_t s = (keys[i] * 2654435761u) >> 24;
        looked++;
        while (table[s] != keys[i]) { s = (s + 1) & 255; looked++; }
    }
    return looked & 1023;
}`,
    python: `# mem.hashtab: put keys in a 256-slot table in the heap, then look them all up
def hashtab(mem, keys, heap=0x10000):
    for i in range(256):
        mem.store32(heap + 4 * i, 0)             # zero_words
    for k in keys:
        s = ((k * 2654435761) & 0xFFFFFFFF) >> 24            # mul, srli: the slot, scattered over the table
        while mem.load32(heap + 4 * s):
            s = (s + 1) & 255                    # a clash steps to the next slot
        mem.store32(heap + 4 * s, k)
    looked = 0
    for k in keys:
        s = ((k * 2654435761) & 0xFFFFFFFF) >> 24
        looked += 1
        while mem.load32(heap + 4 * s) != k:
            s = (s + 1) & 255
            looked += 1
    return looked & 1023`,
  },
  db: {
    cpp: `// db.index: build a table of 256-byte records, then answer scattered lookups
#include <cstdint>
const uintptr_t HEAP = 0x10000;                // the big heap: virtual 0x10000 up on every OS
uint32_t index_job(int rows, uint32_t mult) {  // rows is a power of two
    for (int i = 0; i < rows; i++)
        *(uint32_t*)(HEAP + 256 * i) = 7 * i + 3;   // index_fill: touches every page once
    uint32_t sum = 0;
    for (int j = 0; j < rows / 2; j++) {
        uint32_t row = (j * mult) & (rows - 1);     // index_probe: a multiply, a mask...
        sum += *(uint32_t*)(HEAP + 256 * row);      // ...and a load that lands anywhere in the table
    }
    return sum & 1023;
}`,
    python: `# db.index: build a table of 256-byte records, then answer scattered lookups
HEAP = 0x10000                                 # the big heap: virtual 0x10000 up on every OS
def index_job(mem, rows, mult):                # rows is a power of two
    for i in range(rows):
        mem.store32(HEAP + 256 * i, 7 * i + 3)         # index_fill: touches every page once
    total = 0
    for j in range(rows // 2):
        row = (j * mult) & (rows - 1)                  # index_probe: a multiply, a mask...
        total += mem.load32(HEAP + 256 * row)          # ...and a load that lands anywhere
    return total & 1023`,
  },
  page: {
    cpp: `// web.page: put the response together from its parts, then hash it
#include <cstdint>
uint32_t page(const uint32_t* body, uint32_t* out, int n) {
    for (int i = 0; i < n; i++) out[i] = body[i];          // copy_block: lw, sw
    uint32_t h = 5381;
    for (int i = 0; i < n; i++) h = (h + (h << 5)) ^ out[i]; // checksum of what is sent
    return h & 1023;
}`,
    python: `# web.page: put the response together from its parts, then hash it
def page(body):
    out = list(body)                                       # copy_block: lw, sw
    h = 5381
    for w in out:
        h = ((h + (h << 5)) ^ w) & 0xFFFFFFFF              # checksum of what is sent
    return h & 1023`,
  },
  api: {
    cpp: `// web.api: the total of an order, price times quantity for each line
#include <cstdint>
uint32_t api_total(const uint32_t* price, const uint32_t* qty, int lines) {
    uint32_t total = 0;
    for (int i = 0; i < lines; i++)
        total += price[i] * qty[i];                        // two loads and a mul for every line
    return total & 1023;
}`,
    python: `# web.api: the total of an order, price times quantity for each line
def api_total(price, qty):
    return sum(p * q for p, q in zip(price, qty)) & 1023   # two loads and a mul for every line`,
  },
  dns: {
    cpp: `// web.dns: look each name up in a sorted table by halving it
#include <cstdint>
uint32_t dns(const uint32_t* table, int size, const uint32_t* names, int n) {
    uint32_t sum = 0;
    for (int k = 0; k < n; k++) {
        int lo = 0, hi = size - 1;
        while (lo <= hi) {                                 // blt: stop when the range is empty
            int mid = (lo + hi) >> 1;
            if (table[mid] == names[k]) { sum += mid; break; }
            if (table[mid] < names[k]) lo = mid + 1; else hi = mid - 1;   // which way depends on the name
        }
    }
    return sum & 1023;
}`,
    python: `# web.dns: look each name up in a sorted table by halving it
def dns(table, names):
    total = 0
    for name in names:
        lo, hi = 0, len(table) - 1
        while lo <= hi:                                    # blt: stop when the range is empty
            mid = (lo + hi) >> 1
            if table[mid] == name:
                total += mid
                break
            if table[mid] < name: lo = mid + 1             # which way depends on the name
            else: hi = mid - 1
    return total & 1023`,
  },
  form: {
    cpp: `// web.form: count the digits and the capital letters of what was typed
#include <cstdint>
uint32_t form_check(const uint8_t* text, int n) {
    uint32_t digits = 0, caps = 0;
    for (int i = 0; i < n; i++) {
        digits += (uint8_t)(text[i] - '0') < 10;           // addi, sltiu: a range test with no branch
        caps   += (uint8_t)(text[i] - 'A') < 26;
    }
    return (digits + 2 * caps) & 1023;
}`,
    python: `# web.form: count the digits and the capital letters of what was typed
def form_check(text):
    digits = sum(1 for c in text if 48 <= c <= 57)         # addi, sltiu: a range test with no branch
    caps = sum(1 for c in text if 65 <= c <= 90)
    return (digits + 2 * caps) & 1023`,
  },
  search: {
    cpp: `// web.search: count where a pair of letters occurs in the text
#include <cstdint>
uint32_t search(const uint8_t* text, int n, uint8_t c0, uint8_t c1) {
    uint32_t hits = 0;
    for (int i = 0; i < n; i++)
        if (text[i] == c0 && text[i + 1] == c1)            // the second load only when the first matched
            hits++;
    return hits & 1023;
}`,
    python: `# web.search: count where a pair of letters occurs in the text
def search(text, c0, c1):
    return sum(1 for i in range(len(text) - 1)
               if text[i] == c0 and text[i + 1] == c1) & 1023   # the second load only when the first matched`,
  },
  upload: {
    cpp: `// web.upload: scan the file that arrived for words that carry a signature
#include <cstdint>
uint32_t upload_scan(const uint32_t* file, int n, uint32_t mask, uint32_t sig) {
    uint32_t hits = 0;
    for (int i = 0; i < n; i++)
        if ((file[i] & mask) == sig) hits++;               // lw, and, bne for every word
    return hits & 1023;
}`,
    python: `# web.upload: scan the file that arrived for words that carry a signature
def upload_scan(file, mask, sig):
    return sum(1 for w in file if (w & mask) == sig) & 1023   # lw, and, bne for every word`,
  },
  video: {
    cpp: `// web.video: filter every sample of a chunk
#include <cstdint>
uint32_t video(const uint32_t* chunk, int n) {
    uint32_t sum = 0;
    for (int i = 0; i < n; i++)
        sum += (chunk[i] * 3 + 1) >> 1;                    // a mul, an add and a shift for every sample
    return sum & 1023;
}`,
    python: `# web.video: filter every sample of a chunk
def video(chunk):
    return sum(((w * 3 + 1) & 0xFFFFFFFF) >> 1 for w in chunk) & 1023   # a mul, an add and a shift for every sample`,
  },
  image: {
    cpp: `// web.image: shrink a square byte image to half size by averaging 2 x 2
#include <cstdint>
uint32_t image(const uint8_t* px, int w) {
    uint32_t sum = 0;
    for (int r = 0; r < w; r += 2)
        for (int c = 0; c < w; c += 2)
            sum += (px[r * w + c] + px[r * w + c + 1] + px[(r + 1) * w + c] + px[(r + 1) * w + c + 1]) >> 2;   // four lbu, three adds, a shift
    return sum & 1023;
}`,
    python: `# web.image: shrink a square byte image to half size by averaging 2 x 2
def image(px, w):
    total = 0
    for r in range(0, w, 2):
        for c in range(0, w, 2):
            total += (px[r*w + c] + px[r*w + c + 1] + px[(r+1)*w + c] + px[(r+1)*w + c + 1]) >> 2   # four lbu, three adds, a shift
    return total & 1023`,
  },
  secure: {
    cpp: `// secure.sign: measure, attest, hash in protected mode, seal, unseal
#include <cstdint>
uint32_t sign(Tpm& tpm, const uint32_t* data, int words, uint32_t handle) {
    uint32_t m = tpm.measure(data, words);       // the TPM hashes the data (a fixed, slow wait)
    tpm.attest(m);                               // a quote binding it
    tpm.protect(program_start, scratch_base);    // from here every RAM access pays the encryption surcharge
    uint32_t h = 5381;
    for (int i = 0; i < words; i++) h = ((h + (h << 5)) ^ data[i]);   // the same loop as the checksum, but slower
    tpm.unprotect();
    tpm.seal(handle, h);
    return tpm.unseal(handle) & 63;
}`,
    python: `# secure.sign: measure, attest, hash in protected mode, seal, unseal
def sign(tpm, data, handle):
    m = tpm.measure(data)               # the TPM hashes the data (a fixed, slow wait)
    tpm.attest(m)                       # a quote binding it
    tpm.protect()                       # from here every RAM access pays the encryption surcharge
    h = 5381
    for w in data:
        h = ((h + (h << 5)) ^ w) & 0xFFFFFFFF   # the same loop as the checksum, but slower
    tpm.unprotect()
    tpm.seal(handle, h)
    return tpm.unseal(handle) & 63`,
  },
  verify: {
    cpp: `// secure.verify: measure each block with the TPM and compare it with the digest promised for it
#include <cstdint>
extern uint32_t tpm_measure(const uint32_t* p, int words);   // writes ARG0, ARG1, CMD, polls STATUS, reads RESULT
uint32_t verify(const uint32_t* data, const uint32_t* promised, int blocks) {
    uint32_t sum = 0;
    for (int i = 0; i < blocks; i++) {
        uint32_t m = tpm_measure(data + 8 * i, 8);   // the module hashes it word by word on its own slow clock
        if (m == promised[i]) sum += m;              // bne: a block that was changed adds nothing
    }
    return sum & 1023;
}`,
    python: `# secure.verify: measure each block with the TPM and compare it with the digest promised for it
def verify(tpm, data, promised):
    total = 0
    for i, want in enumerate(promised):
        m = tpm.measure(data[8 * i: 8 * i + 8])      # the module hashes it word by word on its own slow clock
        if m == want:                                # bne: a block that was changed adds nothing
            total += m
    return total & 1023`,
  },
  measure: {
    cpp: `// secure.measure: a chain of measurements, as at a measured boot
#include <cstdint>
extern uint32_t tpm_measure(const uint32_t* p, int words);
uint32_t measured_boot(const uint32_t* stage, int blocks) {
    uint32_t chain = 5381;
    for (int i = 0; i < blocks; i++)
        chain = (chain + (chain << 5)) ^ tpm_measure(stage + 8 * i, 8);   // each stage is measured, then folded into the chain
    return chain & 1023;
}`,
    python: `# secure.measure: a chain of measurements, as at a measured boot
def measured_boot(tpm, stage, blocks):
    chain = 5381
    for i in range(blocks):
        m = tpm.measure(stage[8 * i: 8 * i + 8])
        chain = ((chain + (chain << 5)) ^ m) & 0xFFFFFFFF   # each stage is measured, then folded into the chain
    return chain & 1023`,
  },
  encrypt: {
    cpp: `// secure.encrypt: hash two buffers inside protected mode
#include <cstdint>
extern void tpm_protect(const void* lo, const void* hi);   // RAM outside the range is refused, and every access inside it costs extra
extern void tpm_unprotect();
uint32_t protected_hash(const uint32_t* a, const uint32_t* c, int n) {
    tpm_protect(program_start, scratch_buffer);
    uint32_t ha = 5381, hc = 5381;
    for (int i = 0; i < n; i++) ha = (ha + (ha << 5)) ^ a[i];   // every load pays the surcharge
    for (int i = 0; i < n; i++) hc = (hc + (hc << 5)) ^ c[i];
    tpm_unprotect();
    return (ha ^ hc) & 1023;
}`,
    python: `# secure.encrypt: hash two buffers inside protected mode
def protected_hash(tpm, a, c):
    tpm.protect()                                    # RAM outside the range is refused, and every access inside it costs extra
    ha = hc = 5381
    for w in a:
        ha = ((ha + (ha << 5)) ^ w) & 0xFFFFFFFF     # every load pays the surcharge
    for w in c:
        hc = ((hc + (hc << 5)) ^ w) & 0xFFFFFFFF
    tpm.unprotect()
    return (ha ^ hc) & 1023`,
  },
  vault: {
    cpp: `// secure.vault: seal several values under their own handles, then unseal them all
#include <cstdint>
extern void tpm_seal(uint32_t handle, uint32_t value);
extern uint32_t tpm_unseal(uint32_t handle);
uint32_t vault(const uint32_t* secrets, int n, uint32_t first_handle) {
    for (int i = 0; i < n; i++) tpm_seal(first_handle + i, secrets[i]);   // each command crosses the header and back
    uint32_t sum = 0;
    for (int i = 0; i < n; i++) sum += tpm_unseal(first_handle + i);
    return sum & 1023;
}`,
    python: `# secure.vault: seal several values under their own handles, then unseal them all
def vault(tpm, secrets, first_handle):
    for i, s in enumerate(secrets):
        tpm.seal(first_handle + i, s)                # each command crosses the header and back
    return sum(tpm.unseal(first_handle + i) for i in range(len(secrets))) & 1023`,
  },
  rotate: {
    cpp: `// secure.rotate: unseal a value, change it, seal it again, round after round
#include <cstdint>
extern void tpm_seal(uint32_t handle, uint32_t value);
extern uint32_t tpm_unseal(uint32_t handle);
uint32_t rotate(uint32_t handle, uint32_t v0, int rounds, uint32_t m, uint32_t a) {
    tpm_seal(handle, v0);
    for (int i = 0; i < rounds; i++) {
        uint32_t v = tpm_unseal(handle);             // the next round needs the last one's answer
        tpm_seal(handle, v * m + a);                 // mul, addi, then the module again
    }
    return tpm_unseal(handle) & 1023;
}`,
    python: `# secure.rotate: unseal a value, change it, seal it again, round after round
def rotate(tpm, handle, v0, rounds, m, a):
    tpm.seal(handle, v0)
    for _ in range(rounds):
        v = tpm.unseal(handle)                       # the next round needs the last one's answer
        tpm.seal(handle, (v * m + a) & 0xFFFFFFFF)   # mul, addi, then the module again
    return tpm.unseal(handle) & 1023`,
  },
  attest: {
    cpp: `// secure.attest: a burst of quotes, counted (a quote is the machine's own random word: never shown)
#include <cstdint>
extern uint32_t tpm_attest(uint32_t nonce);
uint32_t attest_burst(uint32_t nonce, int quotes) {
    for (int i = 0; i < quotes; i++)
        tpm_attest(nonce);                           // the module works out each quote on its own slow clock
    return quotes & 1023;
}`,
    python: `# secure.attest: a burst of quotes, counted (a quote is the machine's own random word: never shown)
def attest_burst(tpm, nonce, quotes):
    for _ in range(quotes):
        tpm.attest(nonce)                            # the module works out each quote on its own slow clock
    return quotes & 1023`,
  },
  vadd: {
    cpp: `// gpu.vadd: out[i] = a[i] + 12 * b[i], twelve rounds of the add for every element
#include <cstdint>
void vadd(const int32_t* a, const int32_t* b, int32_t* out, int len) {
    for (int i = 0; i < len; i++) {                  // on the card: one element per lane, lanes elements at a time
        int32_t x = a[i];
        for (int r = 0; r < 12; r++) x += b[i];      // unrolled: twelve adds in a row
        out[i] = x;
    }
}`,
    python: `# gpu.vadd: out[i] = a[i] + 12 * b[i], twelve rounds of the add for every element
def vadd(a, b):
    return [(x + 12 * y) & 0xFFFFFFFF for x, y in zip(a, b)]   # on the card: one element per lane`,
  },
  saxpy: {
    cpp: `// gpu.saxpy: out[i] = b[i] + 12 * (scale * a[i])
#include <cstdint>
void saxpy(const int32_t* a, const int32_t* b, int32_t* out, int len, int32_t scale) {
    for (int i = 0; i < len; i++) {
        int32_t t = scale * a[i];                    // one multiply per element
        int32_t x = b[i];
        for (int r = 0; r < 12; r++) x += t;         // then twelve adds
        out[i] = x;
    }
}`,
    python: `# gpu.saxpy: out[i] = b[i] + 12 * (scale * a[i])
def saxpy(a, b, scale):
    return [(y + 12 * (scale * x)) & 0xFFFFFFFF for x, y in zip(a, b)]   # one multiply, twelve adds`,
  },
  thresh: {
    cpp: `// gpu.thresh: out[i] = a[i] >= 500 ? 100 : 0
#include <cstdint>
void thresh(const int32_t* a, int32_t* out, int len) {
    for (int i = 0; i < len; i++)
        out[i] = a[i] >= 500 ? 100 : 0;              // on the card: an if and an else under the lane mask, so lanes take turns
}`,
    python: `# gpu.thresh: out[i] = a[i] >= 500 ? 100 : 0
def thresh(a):
    return [100 if x >= 500 else 0 for x in a]       # on the card: an if and an else under the lane mask, so lanes take turns`,
  },
  blur3: {
    cpp: `// gpu.blur3: out[i] = (a[i-1] + a[i] + a[i+1]) / 3, the first and last element reusing their own value
#include <cstdint>
void blur3(const int32_t* a, int32_t* out, int len) {
    for (int i = 0; i < len; i++) {
        int32_t l = i == 0 ? a[i] : a[i - 1];        // on the card: the edge lanes sit idle while these run
        int32_t r = i == len - 1 ? a[i] : a[i + 1];
        out[i] = (uint32_t)((l + a[i] + r) * 21846) >> 16;   // a multiply by 1/3 in fixed point
    }
}`,
    python: `# gpu.blur3: out[i] = (a[i-1] + a[i] + a[i+1]) / 3, the first and last element reusing their own value
def blur3(a):
    n = len(a)
    return [((a[max(i-1, 0)] + a[i] + a[min(i+1, n-1)]) * 21846 & 0xFFFFFFFF) >> 16 for i in range(n)]   # a multiply by 1/3 in fixed point`,
  },
  poly: {
    cpp: `// gpu.poly: out[i] = b + a * (b + a * (...)), eight times: each multiply needs the one before
#include <cstdint>
void poly(const int32_t* a, const int32_t* b, int32_t* out, int len) {
    for (int i = 0; i < len; i++) {
        int32_t r = b[i];
        for (int k = 0; k < 8; k++) r = r * a[i] + b[i];   // a chain of eight multiply-adds
        out[i] = r;
    }
}`,
    python: `# gpu.poly: out[i] = b + a * (b + a * (...)), eight times: each multiply needs the one before
def poly(a, b):
    out = []
    for x, y in zip(a, b):
        r = y
        for _ in range(8):
            r = (r * x + y) & 0xFFFFFFFF             # a chain of eight multiply-adds
        out.append(r)
    return out`,
  },
  mandel: {
    cpp: `// gpu.mandel: how long each point of a picture takes to escape (at most 16 rounds)
#include <cstdint>
int mandel_point(int32_t cx, int32_t cy) {            // Q12 fixed point
    int32_t zr = 0, zi = 0; int count = 0;
    while (count < 16) {
        int32_t zr2 = (zr * zr) >> 12, zi2 = (zi * zi) >> 12;
        if (((zr2 + zi2) >> 14) != 0) break;           // escaped: lanes leave the loop at different times
        zi = ((zr * zi) >> 11) + cy;
        zr = zr2 - zi2 + cx;
        count++;
    }
    return count;
}`,
    python: `# gpu.mandel: how long each point of a picture takes to escape (at most 16 rounds)
def mandel_point(cx, cy):                              # Q12 fixed point
    zr = zi = count = 0
    while count < 16:
        zr2, zi2 = (zr * zr) >> 12, (zi * zi) >> 12
        if (zr2 + zi2) >> 14:                          # escaped: lanes leave the loop at different times
            break
        zi = ((zr * zi) >> 11) + cy
        zr = zr2 - zi2 + cx
        count += 1
    return count`,
  },
  sphere: {
    cpp: `// gpu.sphere: one point of a row of four checkered balls (16 columns each), lit from the upper left
#include <cstdint>
int ball_pixel(int col, int row, int rows, int phase) {
    int x = 2 * (col & 15) - 15, y = (2 * row - (rows - 1)) * (16 / rows);   // the point's place on its ball
    int d2 = x * x + y * y, h = 225 - d2;
    if (h <= 0) return 0;                              // off the ball: dark
    int s = x + ((x * d2) >> 8) + phase + (col >> 4) * 21;   // the checker slides faster toward the rim, and each ball is turned differently
    int chk = ((s >> 3) ^ (y >> 3)) & 1;
    return 40 + 36 * chk - x - y + (h >> 2);           // square colour, the light from the corner, brightest at the middle
}`,
    python: `# gpu.sphere: one point of a row of four checkered balls (16 columns each), lit from the upper left
def ball_pixel(col, row, rows, phase):
    x, y = 2 * (col & 15) - 15, (2 * row - (rows - 1)) * (16 // rows)   # the point's place on its ball
    d2 = x * x + y * y
    h = 225 - d2
    if h <= 0:
        return 0                                       # off the ball: dark
    s = x + ((x * d2) >> 8) + phase + (col >> 4) * 21  # the checker slides faster toward the rim, and each ball is turned differently
    chk = ((s >> 3) ^ (y >> 3)) & 1
    return 40 + 36 * chk - x - y + (h >> 2)            # square colour, the light from the corner, brightest at the middle`,
  },
  perceptron: {
    cpp: `// npu.perceptron: one dense layer, X <- relu(W X + b), over an 8x8 batch
#include <cstdint>
void layer(const int32_t W[8][8], const int32_t b[8], const int32_t X[8][8], int32_t out[8][8]) {
    for (int s = 0; s < 8; s++)                       // each sample of the batch
        for (int o = 0; o < 8; o++) {
            int32_t acc = b[o];
            for (int i = 0; i < 8; i++) acc += W[o][i] * X[s][i];   // 512 multiply-adds in all: the NPU does a grid of them at once
            out[s][o] = acc > 0 ? acc : 0;             // relu
        }
}`,
    python: `# npu.perceptron: one dense layer, X <- relu(W X + b), over an 8x8 batch
def layer(W, b, X):
    return [[max(0, b[o] + sum(W[o][i] * x[i] for i in range(8))) for o in range(8)] for x in X]   # the NPU does a grid of multiply-adds at once`,
  },
  deep: {
    cpp: `// npu.deep: six dense layers one after the other, each on the last one's output
#include <cstdint>
void layer(const int32_t W[8][8], const int32_t b[8], const int32_t X[8][8], int32_t out[8][8]);   // as in the perceptron
void deep(const int32_t W[6][8][8], const int32_t b[6][8], int32_t X[8][8], int32_t scratch[8][8]) {
    for (int l = 0; l < 6; l++) {                      // a layer needs the one before it: six launches on a GPU, one descriptor list on an NPU
        layer(W[l], b[l], X, scratch);
        for (int s = 0; s < 8; s++) for (int o = 0; o < 8; o++) X[s][o] = scratch[s][o];
    }
}`,
    python: `# npu.deep: six dense layers one after the other, each on the last one's output
def deep(layers, X):
    for W, b in layers:                                # a layer needs the one before it: six launches on a GPU, one descriptor list on an NPU
        X = [[max(0, b[o] + sum(W[o][i] * x[i] for i in range(8))) for o in range(8)] for x in X]
    return X`,
  },
  npu: {
    cpp: `// npu.infer: dense layers X <- relu(W X + b) over an 8x8 batch (shown: the CPU path)
#include <cstdint>
void layer(const int32_t* W, const int32_t* X, int32_t* Y, const int32_t* b) {
    for (int r = 0; r < 8; r++)
        for (int c = 0; c < 8; c++) {
            int32_t acc = b[r];
            for (int k = 0; k < 8; k++) acc += W[r * 8 + k] * X[k * 8 + c];   // 512 multiplies a layer
            Y[r * 8 + c] = acc > 0 ? acc : 0;                                  // relu
        }
}`,
    python: `# npu.infer: dense layers X <- relu(W X + b) over an 8x8 batch (shown: the CPU path)
def layer(W, X, b):
    return [[max(0, b[r] + sum(W[r][k] * X[k][c] for k in range(8)))   # 512 multiplies a layer
             for c in range(8)] for r in range(8)]`,
  },
  "hpc-reduce": {
    cpp: `// hpc.reduce: each thread folds its share of the array; the partial sums are added into one total
#include <atomic>
#include <cstdint>
std::atomic<int32_t> total;
void worker(const int32_t* a, int n, int k, int T) {
    int32_t part = 0;
    for (int i = k * n / T; i < (k + 1) * n / T; i++)
        part += a[i] * a[i] + (a[i] >> 3);
    total += part;                                   // amoadd
}`,
    python: `# hpc.reduce: each thread folds its share of the list; the partial sums are added into one total
def worker(a, k, T, total):
    n = len(a)
    part = sum(x * x + (x >> 3) for x in a[k * n // T:(k + 1) * n // T])
    total.add(part)                                  # an atomic add`,
  },
  "hpc-matmul": {
    cpp: `// hpc.matmul: C = A x B (8 x K by K x 8); each thread computes its rows of C and adds them up
void worker(const int32_t* A, const int32_t* B, int K, int k, int T, std::atomic<int32_t>& total) {
    int32_t part = 0;
    for (int i = k * 8 / T; i < (k + 1) * 8 / T; i++)
        for (int j = 0; j < 8; j++)
            for (int x = 0; x < K; x++)
                part += A[i * K + x] * B[x * 8 + j];   // a multiply each
    total += part;
}`,
    python: `# hpc.matmul: C = A x B (8 x K by K x 8); each thread computes its rows of C and adds them up
def worker(A, B, K, k, T, total):
    rows = range(k * 8 // T, (k + 1) * 8 // T)
    total.add(sum(A[i][x] * B[x][j] for i in rows for j in range(8) for x in range(K)))`,
  },
  "hpc-nbody": {
    cpp: `// hpc.nbody: every body moves by the pull of all the others, from the positions of the step before; a barrier ends each step
void worker(int32_t* pos[2], const int32_t* mass, int steps, int k, int T, Barrier& bar) {
    for (int s = 0; s < steps; s++) {
        const int32_t* now = pos[s & 1]; int32_t* next = pos[(s & 1) ^ 1];
        for (int i = k * 16 / T; i < (k + 1) * 16 / T; i++) {
            int32_t pull = 0;
            for (int j = 0; j < 16; j++) pull += (now[j] - now[i]) * mass[j];
            next[i] = now[i] + (pull >> 8);
        }
        bar.wait();                                    // nobody starts the next step early
    }
}`,
    python: `# hpc.nbody: every body moves by the pull of all the others, from the positions of the step before; a barrier ends each step
def worker(pos, mass, steps, k, T, barrier):
    for s in range(steps):
        now, nxt = pos[s & 1], pos[(s & 1) ^ 1]
        for i in range(k * 16 // T, (k + 1) * 16 // T):
            pull = sum((now[j] - now[i]) * mass[j] for j in range(16))
            nxt[i] = now[i] + (pull >> 8)
        barrier.wait()`,
  },
  "hpc-montecarlo": {
    cpp: `// hpc.montecarlo: a point is a hash of its number; count the ones inside the quarter circle
void worker(int n, int k, int T, std::atomic<int32_t>& hits) {
    int32_t mine = 0;
    for (int i = k * n / T; i < (k + 1) * n / T; i++) {
        uint32_t h = (uint32_t)(i + 1) * 0x9e3779b1u;
        uint32_t x = h >> 24, y = (h >> 16) & 255;
        if (x * x + y * y < 65536) mine++;
    }
    hits += mine;
}`,
    python: `# hpc.montecarlo: a point is a hash of its number; count the ones inside the quarter circle
def worker(n, k, T, hits):
    mine = 0
    for i in range(k * n // T, (k + 1) * n // T):
        h = ((i + 1) * 0x9e3779b1) & 0xffffffff
        x, y = h >> 24, (h >> 16) & 255
        mine += x * x + y * y < 65536
    hits.add(mine)`,
  },
  "hpc-sort": {
    cpp: `// hpc.sort: each thread sorts its run (bubble sort), then thread 0 merges the runs and adds up value x position
void worker(int32_t* a, int n, int k, int T, Barrier& bar) {
    int lo = k * n / T, hi = (k + 1) * n / T;
    for (int end = hi - 1; end > lo; end--)
        for (int i = lo; i < end; i++)
            if (a[i + 1] < a[i]) std::swap(a[i], a[i + 1]);
    bar.wait();
    if (k == 0) { /* merge the T sorted runs into one, then sum a[i] * (i + 1) */ }
}`,
    python: `# hpc.sort: each thread sorts its run, then thread 0 merges the runs and adds up value x position
def worker(a, k, T, barrier):
    n = len(a)
    a[k * n // T:(k + 1) * n // T] = sorted(a[k * n // T:(k + 1) * n // T])
    barrier.wait()
    if k == 0:
        merged = sorted(a)                           # the merge of the sorted runs
        return sum(v * (i + 1) for i, v in enumerate(merged))`,
  },
  "hpc-bfs": {
    cpp: `// hpc.bfs: level by level, every thread settles its own points whose in-edge was settled on the level before; a barrier ends each level
void worker(const int* in1, const int* in2, int* dist, int n, int k, int T, Barrier& bar) {
    for (int level = 1; level < n; level++) {
        for (int v = k * n / T; v < (k + 1) * n / T; v++)
            if (dist[v] < 0 && (dist[in1[v]] == level - 1 || dist[in2[v]] == level - 1))
                dist[v] = level;
        bar.wait();
    }
}`,
    python: `# hpc.bfs: level by level, every thread settles its own points whose in-edge was settled on the level before; a barrier ends each level
def worker(in1, in2, dist, k, T, barrier):
    n = len(dist)
    for level in range(1, n):
        for v in range(k * n // T, (k + 1) * n // T):
            if dist[v] < 0 and level - 1 in (dist[in1[v]], dist[in2[v]]):
                dist[v] = level
        barrier.wait()`,
  },
  "hpc-fft": {
    cpp: `// hpc.fft: butterflies (a sum and a difference) stage by stage, in place; the threads share each stage and wait for each other after it
void worker(int32_t* x, int n, int k, int T, Barrier& bar) {
    for (int s = 0; (1 << s) < n; s++) {
        for (int bf = k * (n / 2) / T; bf < (k + 1) * (n / 2) / T; bf++) {
            int i = ((bf >> s) << (s + 1)) | (bf & ((1 << s) - 1)), j = i + (1 << s);
            int32_t u = x[i], v = x[j];
            x[i] = u + v; x[j] = u - v;
        }
        bar.wait();
    }
}`,
    python: `# hpc.fft: butterflies (a sum and a difference) stage by stage, in place; the threads share each stage and wait for each other after it
def worker(x, k, T, barrier):
    n, s = len(x), 0
    while (1 << s) < n:
        for bf in range(k * (n // 2) // T, (k + 1) * (n // 2) // T):
            i = ((bf >> s) << (s + 1)) | (bf & ((1 << s) - 1))
            j = i + (1 << s)
            x[i], x[j] = x[i] + x[j], x[i] - x[j]
        barrier.wait()
        s += 1`,
  },
};
HIGH_LEVEL.spherewide = {
  cpp: `// gpu.spherewide: one point of a 64 x 36 picture, two bands of four checkered balls (18 rows each)
#include <cstdint>
int ball_pixel(int col, int row, int phase) {
    int band = (row * 57) >> 10, r = row - 18 * band;          // which band: row / 18 without a divide
    int x = 2 * (col & 15) - 15, y = ((2 * r - 17) * 228) >> 8;   // the point's place on its ball
    int d2 = x * x + y * y, h = 225 - d2;
    if (h <= 0) return 0;                              // off the ball: dark
    int s = x + ((x * d2) >> 8) + phase + ((col >> 4) + 2 * band) * 21;   // each ball is turned differently
    int chk = ((s >> 3) ^ (y >> 3)) & 1;
    return 40 + 36 * chk - x - y + (h >> 2);           // square colour, the light from the corner
}`,
  python: `# gpu.spherewide: one point of a 64 x 36 picture, two bands of four checkered balls (18 rows each)
def ball_pixel(col, row, phase):
    band = (row * 57) >> 10                            # row // 18 without a divide
    r = row - 18 * band
    x, y = 2 * (col & 15) - 15, ((2 * r - 17) * 228) >> 8   # the point's place on its ball
    d2 = x * x + y * y
    h = 225 - d2
    if h <= 0:
        return 0                                       # off the ball: dark
    s = x + ((x * d2) >> 8) + phase + ((col >> 4) + 2 * band) * 21   # each ball is turned differently
    chk = ((s >> 3) ^ (y >> 3)) & 1
    return 40 + 36 * chk - x - y + (h >> 2)            # square colour, the light from the corner`,
};
// The web class runs the calculation program for now, so it reads as the calculation does.
HIGH_LEVEL.web = HIGH_LEVEL.calc!;

/** One cell of a job's picture: the kind of instruction it is and how often it ran (0 = never, 1 = the busiest word). */
export interface SpriteCell { cls: OpClass; heat: number }

/** A job's program drawn as a picture: one cell per instruction word, in order, wrapped into rows. */
export interface Sprite { cols: number; rows: number; cells: SpriteCell[] }

/**
 * The picture of a program (the almanac's sprite for the job): every word that ran, coloured by what the instruction does and as bright as it was busy.
 * Two jobs look different at a glance (a tight loop of multiplies against a long run of loads and stores), and it is the program itself, not a drawing.
 */
export function spriteOf(p: CodeProfile, maxCells = 400): Sprite {
  let last = -1;
  p.lines.forEach((l, i) => { if (l.count > 0) last = i; });
  const lines = p.lines.slice(0, last + 1).slice(0, maxCells);
  const lg = Math.log(Math.max(...lines.map((l) => l.count), 1) + 1);
  const cells = lines.map((l): SpriteCell => ({ cls: l.cls, heat: l.count > 0 ? Math.max(0.18, Math.log(l.count + 1) / lg) : 0 }));
  const cols = Math.max(6, Math.min(32, Math.ceil(Math.sqrt(Math.max(1, cells.length) * 2.2))));
  return { cols, rows: Math.max(1, Math.ceil(cells.length / cols)), cells };
}
