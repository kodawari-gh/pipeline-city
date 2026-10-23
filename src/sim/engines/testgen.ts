// Seeded random program generator for tests only: straight-line code, counted loops, loads/stores to a small data
// region, forward branches and a call/ret. Always terminates with ecall. Output is assembly text.

import { Prng } from "../machine/prng";

export const DATA_BASE = 0x1000;
export const DATA_SIZE = 256;

const GEN_REGS = ["a0", "a1", "a2", "a3", "t0", "t1", "t2", "t3", "t4", "s0"]; // freely written
const SRC_EXTRA = ["zero", "ra", "s1", "s2"];
const R_OPS = ["add", "sub", "and", "or", "xor", "sll", "srl", "sra", "slt", "sltu", "mul"];
const I_OPS = ["addi", "andi", "ori", "xori", "slti", "sltiu"];
const SH_OPS = ["slli", "srli", "srai"];
const BR_OPS = ["beq", "bne", "blt", "bge", "bltu", "bgeu"];

class Gen {
  readonly lines: string[] = [];
  private labels = 0;
  private recent: string[] = ["a0"];
  constructor(private readonly r: Prng) {}

  private pick<T>(a: readonly T[]): T { return a[this.r.nextInt(a.length)]!; }
  private chance(p: number): boolean { return this.r.next() < p; }
  private dst(): string { return this.pick(GEN_REGS); }
  /** Source register, biased towards recently written ones to create RAW hazards. */
  private src(): string {
    if (this.chance(0.6)) return this.pick(this.recent);
    return this.chance(0.8) ? this.pick(GEN_REGS) : this.pick(SRC_EXTRA);
  }
  private wrote(rd: string): void {
    this.recent.push(rd);
    if (this.recent.length > 3) this.recent.shift();
  }
  private emit(s: string): void { this.lines.push("  " + s); }
  private label(): string { return `L${this.labels++}`; }
  private imm(): number { return this.r.nextInt(2001) - 1000; }

  /** One non-control-flow instruction. */
  alu(): void {
    const rd = this.dst();
    const k = this.r.nextInt(14);
    if (k < 4) this.emit(`${this.pick(R_OPS)} ${rd}, ${this.src()}, ${this.src()}`);
    else if (k < 7) this.emit(`${this.pick(I_OPS)} ${rd}, ${this.src()}, ${this.imm()}`);
    else if (k < 8) this.emit(`${this.pick(SH_OPS)} ${rd}, ${this.src()}, ${this.r.nextInt(32)}`);
    else if (k < 9) this.emit(`lui ${rd}, ${this.r.nextInt(1 << 20)}`);
    else if (k < 10) this.emit(`auipc ${rd}, ${this.r.nextInt(64)}`);
    else if (k < 12) { this.load(rd); return; }
    else { this.store(); return; }
    this.wrote(rd);
  }

  private load(rd: string): void {
    const k = this.r.nextInt(3);
    if (k === 0) this.emit(`lw ${rd}, ${4 * this.r.nextInt(DATA_SIZE / 4)}(s3)`);
    else this.emit(`${k === 1 ? "lb" : "lbu"} ${rd}, ${this.r.nextInt(DATA_SIZE)}(s3)`);
    this.wrote(rd);
  }

  private store(): void {
    if (this.chance(0.6)) this.emit(`sw ${this.src()}, ${4 * this.r.nextInt(DATA_SIZE / 4)}(s3)`);
    else this.emit(`sb ${this.src()}, ${this.r.nextInt(DATA_SIZE)}(s3)`);
  }

  private block(n: number, depth: number): void {
    for (let i = 0; i < n; i++) {
      const k = this.r.nextInt(10);
      if (k === 0 && depth < 2) this.loop(depth);
      else if (k === 1 || k === 2) this.forwardBranch();
      else if (k === 3 && depth === 0) this.emit("call sub");
      else this.alu();
    }
  }

  private loop(depth: number): void {
    const cnt = depth === 0 ? "s1" : "s2";
    const top = this.label();
    this.emit(`li ${cnt}, ${2 + this.r.nextInt(4)}`);
    this.lines.push(`${top}:`);
    this.block(2 + this.r.nextInt(5), depth + 1);
    this.emit(`addi ${cnt}, ${cnt}, -1`);
    this.emit(`bne ${cnt}, zero, ${top}`);
  }

  private forwardBranch(): void {
    const skip = this.label();
    this.emit(`${this.pick(BR_OPS)} ${this.src()}, ${this.src()}, ${skip}`);
    const n = 1 + this.r.nextInt(3);
    for (let i = 0; i < n; i++) this.alu();
    this.lines.push(`${skip}:`);
  }

  program(size: number): string {
    this.emit(`li s3, ${DATA_BASE}`);
    for (const r of GEN_REGS) this.emit(`li ${r}, ${this.imm()}`);
    this.block(size, 0);
    this.emit("ecall");
    // Subroutine (straight-line), reached through `call sub`.
    this.lines.push("sub:");
    const n = 1 + this.r.nextInt(5);
    for (let i = 0; i < n; i++) this.alu();
    this.emit("ret");
    return this.lines.join("\n") + "\n";
  }
}

/** Assembly source for the program with this seed (deterministic). */
export function genProgram(seed: number, size = 30): string {
  return new Gen(new Prng(seed)).program(size);
}

/** Pseudo-random initial contents for the data region (deterministic). */
export function genData(seed: number): Uint8Array {
  const r = new Prng(seed ^ 0x9e3779b9);
  const d = new Uint8Array(DATA_SIZE);
  for (let i = 0; i < d.length; i++) d[i] = r.nextInt(256);
  return d;
}
