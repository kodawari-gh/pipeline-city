// The shapes of the almanac's code view (docs/JOBS.md "Reading the code"): an instruction's class, a listed word, a run's profile, the high-level source.

/** What an instruction does for the machine: the classes the die and the RAM view colour by. */
export type OpClass = 'alu' | 'mul' | 'ld' | 'st' | 'br' | 'sys';

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

/** The same job as a person would write it, in C++ and in Python. */
export interface HighLevel {
  cpp: string;
  python: string;
}
