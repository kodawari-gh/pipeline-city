// The almanac's code view (docs/JOBS.md "Reading the code"): a job's real program as the machine runs it. The program the generator makes is run on the
// reference interpreter, counting what each instruction does, so the listing shows how often every line ran and the breakdown shows how much of the job is
// arithmetic, loads and stores, multiplies, branches. Pure: no sim state, nothing is changed by looking.

import { generate } from '../gen';
// oxlint-disable-next-line eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own
import type { Generated } from '../gen';
import { decode, disassemble, SPEC_BY_NAME } from '../../../cpu/sim/isa';
import { RefCpu, RefMemory } from '../../../cpu/sim/ref';
import { OP_CLASSES, opClassOf } from './opClass';
import type { CodeLine, CodeProfile, OpClass } from './types';

const zero = (): Record<OpClass, number> => ({ alu: 0, ld: 0, st: 0, mul: 0, br: 0, sys: 0 });
const MAX_STEPS = 3_000_000;
const DEVICE_BASE = 0x40_00_00_00;

const cache = new Map<string, CodeProfile>();

/** What one run of the program did: the times each word ran, the executed mix, the branches, the memory traffic and the display text. */
interface Run {
  counts: Uint32Array;
  mix: Record<OpClass, number>;
  pages: Set<number>;
  branches: number;
  taken: number;
  bytes: number;
  steps: number;
  display: string;
}

/** The text the job leaves on the display, without its blank lines. */
const shownText = (cpu: RefCpu): string =>
  cpu.mem
    .displayText()
    .split('\n')
    .filter((l) => l.trim())
    .join('\n');

/** Run the program on the reference interpreter (at most `MAX_STEPS` steps), counting what each instruction does. */
function run(g: Generated): Run {
  const cpu = new RefCpu(new RefMemory(1024 * 1024));
  cpu.load(g.program);
  const r: Run = {
    counts: new Uint32Array(g.program.length),
    mix: zero(),
    pages: new Set<number>(),
    branches: 0,
    taken: 0,
    bytes: 0,
    steps: 0,
    display: '',
  };
  let guard = 0;
  while (!cpu.halted && guard++ < MAX_STEPS) {
    const { pc } = cpu;
    const i = decode(cpu.mem.load32(pc));
    if (!i) {
      break;
    }
    const k = pc >>> 2;
    if (k < r.counts.length) {
      r.counts[k] = (r.counts[k] ?? 0) + 1;
    }
    const cls = opClassOf(i.name);
    r.mix[cls]++;
    let addr = -1;
    if (cls === 'ld' || cls === 'st') {
      addr = ((cpu.regs[i.rs1] ?? 0) + i.imm) >>> 0;
      const w = i.name === 'lw' || i.name === 'sw' ? 4 : 1;
      if (addr < DEVICE_BASE) {
        r.pages.add(addr >>> 8);
        r.bytes += w;
      }
    }
    cpu.step();
    if (cls === 'br' && i.name.startsWith('b')) {
      r.branches++;
      if (cpu.pc !== (pc + 4) >>> 0) {
        r.taken++;
      }
    }
  }
  r.steps = guard;
  r.display = shownText(cpu);
  return r;
}

/** The program as a listing: every word disassembled, with its class, how many times it ran and the labels at its address. */
function listing(
  g: Generated,
  counts: Uint32Array,
): { lines: CodeLine[]; staticMix: Record<OpClass, number>; codeWords: number } {
  const labels = new Map<number, string[]>();
  for (const [name, a] of g.symbols) {
    const l = labels.get(a) ?? [];
    l.push(name);
    labels.set(a, l);
  }
  const lines: CodeLine[] = [],
    staticMix = zero();
  let codeWords = 0;
  for (const [k, word] of g.program.entries()) {
    const text = disassemble(word),
      mn = text.split(' ')[0] ?? '';
    const known = SPEC_BY_NAME.has(mn);
    const cls = known ? opClassOf(mn) : 'alu';
    const count = counts[k] ?? 0;
    if (count > 0) {
      codeWords++;
      staticMix[cls]++;
    }
    lines.push({ addr: 4 * k, word: word >>> 0, text, cls, count, labels: labels.get(4 * k) ?? [] });
  }
  return { lines, staticMix, codeWords };
}

/** Generate the job's program for `template` and `scale` (seed 1) and run it, counting what it does. */
export function profileOf(template: string, scale: number, seed = 1): CodeProfile {
  const key = `${template}|${scale}|${seed}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const g = generate(template, seed, { scale, hosted: false });
  const r = run(g);
  const { lines, staticMix, codeWords } = listing(g, r.counts);
  const out: CodeProfile = {
    template,
    scale,
    asm: g.asm,
    lines,
    mix: r.mix,
    staticMix,
    steps: r.steps,
    codeWords,
    dataWords: g.program.length - codeWords,
    branches: r.branches,
    taken: r.taken,
    pages: r.pages.size,
    bytesMoved: r.bytes,
    display: r.display,
  };
  cache.set(key, out);
  return out;
}

/** The share of the executed instructions that is each class, 0..1. */
export function mixShares(p: CodeProfile): Record<OpClass, number> {
  const n = Math.max(1, p.steps);
  const out = zero();
  for (const c of OP_CLASSES) {
    out[c] = p.mix[c] / n;
  }
  return out;
}

/**
 * How much the job leans on each part of the machine, from what it executed: arithmetic (the ALU and multiplier), memory (loads and stores) and control
 * (branches), as shares of the instructions that did something; plus how memory-heavy it is in bytes per instruction.
 */
export function reliance(p: CodeProfile): { compute: number; memory: number; control: number; bytesPerInstr: number } {
  const s = mixShares(p),
    useful = Math.max(1e-9, 1 - s.sys);
  return {
    compute: (s.alu + s.mul) / useful,
    memory: (s.ld + s.st) / useful,
    control: s.br / useful,
    bytesPerInstr: p.bytesMoved / Math.max(1, p.steps),
  };
}
