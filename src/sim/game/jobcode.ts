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
  scan: { template: "cli.scan", scales: [1, 2, 4, 8] },
  db: { template: "db.index", scales: [1, 2, 4, 8] },
  secure: { template: "secure.sign", scales: [1, 2, 4] },
  gpu: { template: "gpu.render", scales: [2, 4, 8] },
  npu: { template: "npu.infer", scales: [1, 2, 4] },
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
  gpu: {
    cpp: `// gpu.render: one of vadd, saxpy, blur3, mandel over an array (shown: saxpy on the CPU path)
#include <cstdint>
uint32_t render(const uint32_t* a, const uint32_t* b, uint32_t* out, int len, uint32_t k) {
    for (int i = 0; i < len; i++)
        out[i] = k * a[i] + b[i];                // with a card: the card does this loop, many elements at a time
    uint32_t sum = 0;
    for (int i = 0; i < len; i++) sum += out[i];
    return sum & 63;
}`,
    python: `# gpu.render: one of vadd, saxpy, blur3, mandel over an array (shown: saxpy on the CPU path)
def render(a, b, k):
    out = [(k * x + y) & 0xFFFFFFFF for x, y in zip(a, b)]   # with a card: the card does this loop
    return sum(out) & 63`,
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
};
