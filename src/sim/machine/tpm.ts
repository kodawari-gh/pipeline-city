// The TPM as a memory-mapped device on the board's header (docs/ACCEL.md "TPM"). A command goes in the registers (ARG0, ARG1, CMD),
// the CPU polls STATUS and reads RESULT. The module is slow on purpose: a command crosses the header in TPM_HOP_TICKS each way, and
// `measure` costs measureTicks per word read through the bus.
//
//   Measure    hash ARG1 words of RAM from ARG0 (the same word hash as the checksum kernel) -> RESULT
//   Attest     a quote: the machine PRNG's next word xor the nonce ARG0 -> RESULT (the PRNG is used for nothing else, so runs stay deterministic)
//   Seal       keep the value ARG1 under the key handle ARG0
//   Unseal     RESULT = the value sealed under ARG0 (FAULT NoSuchKey if none)
//   Protect    protected mode over the RAM byte range [ARG0, ARG0 + 4 * ARG1): any RAM access outside it is refused (reads give 0, writes
//              are dropped) and kills the job (`takeViolation`), and every RAM access inside it costs `surcharge` extra CPU cycles
//   Unprotect  leave protected mode

import { TPM_BASE, TPM_HOP_TICKS, TPM_REG, TPM_SEAL_TICKS, TPM_SIZE, TpmCmd, TpmFault, TpmStatus } from "../isa/memmap";
import type { Bus } from "./bus";
import type { Rate } from "./clock";
import type { Device } from "./device";
import type { Prng } from "./prng";

export interface TpmConfig {
  /** Module ticks per word measured. */
  measureTicks: number;
  /** Module ticks an attestation takes inside the module. */
  attestTicks: number;
  /** Extra CPU cycles per RAM access in protected mode. */
  surcharge: number;
}

/** The word hash of the checksum kernel (h = h * 33 ^ w, from 5381). */
export function wordHash(words: Iterable<number>): number {
  let h = 5381;
  for (const w of words) h = (((h + (h << 5)) ^ w) >>> 0) | 0;
  return h >>> 0;
}

type Phase = "idle" | "in" | "work" | "out";

/** Commands kept in the log the board view replays. */
export const TPM_LOG = 8;
/** Sealed values the view lists. */
export const TPM_KEYS_SHOWN = 8;

/** One finished (or refused) command, for the view. `ticks` is the module's work time (0 when it was refused at the door). */
export interface TpmLogEntry { seq: number; cmd: number; arg0: number; arg1: number; result: number; fault: number; ticks: number }

/** What the module shows from the outside (docs/ACCEL.md "TPM"): where a command is, the registers, protected mode, the sealed values and the last commands. */
export interface TpmView {
  phase: Phase;
  cmd: number;
  arg0: number;
  arg1: number;
  result: number;
  fault: number;
  busy: boolean;
  error: boolean;
  done: boolean;
  /** Ticks left in this phase of the command and how long the phase is. */
  wait: number;
  span: number;
  /** Protected mode: the RAM byte range [lo, hi) the job may touch, or null. */
  range: { lo: number; hi: number } | null;
  /** Words hashed so far and the running hash, while a `measure` is in its work phase (else 0). */
  hashed: number;
  partial: number;
  /** The sealed values, oldest first (at most TPM_KEYS_SHOWN). */
  sealed: { handle: number; value: number }[];
  /** The last commands, oldest first. */
  log: TpmLogEntry[];
  commands: number;
  measuredWords: number;
  guardedAccesses: number;
  lastViolation: number;
  measureTicks: number;
  attestTicks: number;
  surcharge: number;
  /** The RAM the guard's ruler stands for, in bytes. */
  ramBytes: number;
}

export class TpmPort implements Device {
  readonly name = "tpm";
  readonly base = TPM_BASE;
  readonly size = TPM_SIZE;
  /** Starts stopped; the game runs it on a fixed slow clock while a module is installed. */
  readonly clock: Rate = { mul: 0, div: 1 };

  private cfg: TpmConfig | null = null;
  private phase: Phase = "idle";
  private wait = 0;
  private span = 0;
  private worked = 0;
  private measured: number[] = [];
  private seq = 0;
  private log: TpmLogEntry[] = [];
  private cmd = 0;
  private arg0 = 0;
  private arg1 = 0;
  private result = 0;
  private fault: number = TpmFault.None;
  private done = false;
  private error = false;
  private readonly sealed = new Map<number, number>();
  private range: { lo: number; hi: number } | null = null;
  private violated = false;
  /** The address space that wrote the command now running: protected mode guards that one only (`Bus.guardSpace`). */
  private cmdSpace = -1;
  /** The RAM address of the last refused access (for the tests and the log). */
  lastViolation = -1;
  /** Totals since power-on, for the stats and the tests. */
  commands = 0;
  measuredWords = 0;
  guardedAccesses = 0;

  /** `instant`: commands finish at once, with no hop, work time or bus guard (the reference interpreter's fake TPM). */
  constructor(private readonly bus: Bus | null, private readonly ram: Uint8Array, private readonly prng: Prng, readonly instant = false) {}

  /** Put a module on the header (or take it out with null). */
  configure(cfg: TpmConfig | null): void {
    if (cfg === this.cfg) return;
    const same = cfg && this.cfg && cfg.measureTicks === this.cfg.measureTicks && cfg.attestTicks === this.cfg.attestTicks && cfg.surcharge === this.cfg.surcharge;
    if (same) return;
    this.cfg = cfg;
    if (!cfg) this.sealed.clear();
    this.reset();
  }

  /** Power-on reset: no command in flight, protected mode off. Sealed values survive (they live in the module). */
  reset(): void {
    this.phase = "idle";
    this.wait = this.span = this.worked = 0;
    this.measured = [];
    this.log = [];
    this.cmd = this.arg0 = this.arg1 = this.result = 0;
    this.fault = TpmFault.None;
    this.done = this.error = this.violated = false;
    this.leaveProtected();
  }

  /** The module as the board view draws it, or null without a module. */
  view(): TpmView | null {
    const cfg = this.cfg;
    if (!cfg) return null;
    const work = this.phase === "work" && this.cmd === TpmCmd.Measure;
    // the hash so far: the words the module has read at `measureTicks` a word
    const hashed = work ? Math.min(this.measured.length, Math.floor((this.span - this.wait) / Math.max(1, cfg.measureTicks))) : 0;
    return {
      phase: this.phase, cmd: this.cmd, arg0: this.arg0, arg1: this.arg1, result: this.result, fault: this.fault,
      busy: this.phase !== "idle", error: this.error, done: this.done, wait: this.wait, span: this.span,
      range: this.range ? { ...this.range } : null,
      hashed, partial: hashed > 0 ? wordHash(this.measured.slice(0, hashed)) : 0,
      sealed: [...this.sealed].slice(-TPM_KEYS_SHOWN).map(([handle, value]) => ({ handle, value })),
      log: this.log.map((e) => ({ ...e })),
      commands: this.commands, measuredWords: this.measuredWords, guardedAccesses: this.guardedAccesses, lastViolation: this.lastViolation,
      measureTicks: cfg.measureTicks, attestTicks: cfg.attestTicks, surcharge: cfg.surcharge, ramBytes: this.ram.length,
    };
  }

  private note(ticks: number, cmd = this.cmd): void {
    this.log.push({ seq: ++this.seq, cmd, arg0: this.arg0, arg1: this.arg1, result: this.result, fault: this.fault, ticks });
    if (this.log.length > TPM_LOG) this.log.shift();
  }

  get present(): boolean {
    return this.cfg !== null;
  }

  get isBusy(): boolean {
    return this.phase !== "idle";
  }

  get isProtected(): boolean {
    return this.range !== null;
  }

  /** True once if protected mode refused an access since the last call: the job must die. */
  takeViolation(): boolean {
    const v = this.violated;
    this.violated = false;
    return v;
  }

  private leaveProtected(): void {
    this.range = null;
    if (this.bus?.guard === this.guard) this.bus.guard = null;
  }

  private readonly guard = (addr: number): number => {
    const r = this.range;
    if (!r) return 0;
    if (addr >= r.lo && addr < r.hi) {
      this.guardedAccesses++;
      return this.cfg?.surcharge ?? 0;
    }
    this.violated = true;
    this.lastViolation = addr;
    this.error = true;
    this.fault = TpmFault.Violation;
    return -1;
  };

  read(off: number): number {
    let w = 0;
    switch (off & ~3) {
      case TPM_REG.STATUS:
        w = (this.phase !== "idle" ? TpmStatus.Busy : 0) | (this.error ? TpmStatus.Error : 0) | (this.cfg ? TpmStatus.Present : 0)
          | (this.done ? TpmStatus.Done : 0) | (this.range ? TpmStatus.Protected : 0);
        break;
      case TPM_REG.ARG0: w = this.arg0; break;
      case TPM_REG.ARG1: w = this.arg1; break;
      case TPM_REG.RESULT: w = this.result; break;
      case TPM_REG.FAULT: w = this.fault; break;
    }
    return (w >>> (8 * (off & 3))) & 0xff;
  }

  write(off: number, val: number): void {
    const reg = off & ~3, sh = 8 * (off & 3);
    const put = (old: number): number => ((old & ~(0xff << sh)) | ((val & 0xff) << sh)) >>> 0;
    if (reg === TPM_REG.ARG0) this.arg0 = put(this.arg0);
    else if (reg === TPM_REG.ARG1) this.arg1 = put(this.arg1);
    else if (reg === TPM_REG.CMD && off === reg) this.start(val & 0xff); // fires on the low byte, after the arguments have landed
  }

  private start(cmd: number): void {
    if (!this.cfg || this.phase !== "idle" || cmd < TpmCmd.Measure || cmd > TpmCmd.Unprotect) return this.refuse(TpmFault.BadCommand, cmd);
    if (cmd === TpmCmd.Measure || cmd === TpmCmd.Protect) {
      const bytes = this.arg1 * 4;
      if (this.arg0 % 4 !== 0 || this.arg1 === 0 || this.arg0 + bytes > this.ram.length) return this.refuse(TpmFault.BadRange, cmd);
    }
    this.error = this.done = false;
    this.fault = TpmFault.None;
    this.cmd = cmd;
    this.cmdSpace = this.bus?.space() ?? -1;
    this.commands++;
    if (this.instant) {
      this.execute();
      this.done = true;
      return;
    }
    this.phase = "in";
    this.wait = this.span = TPM_HOP_TICKS;
  }

  private refuse(code: number, cmd: number): void {
    this.error = true;
    this.fault = code;
    if (this.cfg && !this.instant) this.note(0, cmd);
  }

  /** The command's effect. Returns the module ticks it takes. */
  private execute(): number {
    const cfg = this.cfg!;
    switch (this.cmd) {
      case TpmCmd.Measure: {
        const words: number[] = [];
        for (let k = 0; k < this.arg1; k++) words.push(this.wordAt(this.arg0 + 4 * k));
        this.result = wordHash(words);
        this.measured = words;
        this.measuredWords += this.arg1;
        return cfg.measureTicks * this.arg1;
      }
      case TpmCmd.Attest:
        this.result = (this.prng.nextU32() ^ this.arg0) >>> 0;
        return cfg.attestTicks;
      case TpmCmd.Seal:
        this.sealed.set(this.arg0, this.arg1);
        return TPM_SEAL_TICKS;
      case TpmCmd.Unseal: {
        const v = this.sealed.get(this.arg0);
        if (v === undefined) { this.error = true; this.fault = TpmFault.NoSuchKey; }
        else this.result = v;
        return TPM_SEAL_TICKS;
      }
      case TpmCmd.Protect:
        this.range = { lo: this.arg0, hi: this.arg0 + 4 * this.arg1 };
        if (!this.instant && this.bus) { this.bus.guardSpace = this.cmdSpace; this.bus.guard = this.guard; }
        return 1;
      default: // Unprotect
        this.leaveProtected();
        return 1;
    }
  }

  private wordAt(addr: number): number {
    return (this.ram[addr]! | (this.ram[addr + 1]! << 8) | (this.ram[addr + 2]! << 16) | (this.ram[addr + 3]! << 24)) >>> 0;
  }

  tick(): void {
    switch (this.phase) {
      case "in":
        if (--this.wait <= 0) {
          this.worked = this.execute();
          this.wait = this.span = Math.max(1, this.worked);
          this.phase = "work";
        }
        break;
      case "work":
        if (--this.wait <= 0) {
          this.phase = "out";
          this.wait = this.span = TPM_HOP_TICKS;
        }
        break;
      case "out":
        if (--this.wait <= 0) {
          this.phase = "idle";
          this.done = true;
          this.wait = this.span = 0;
          this.note(this.worked);
        }
        break;
    }
  }
}
