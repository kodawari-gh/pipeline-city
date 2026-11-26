// The types of the kernel's build contexts: the options of the preemptive part and of the whole source, and what follows from them.

/** What `preemptive` builds: the page above the kernel's data, the multicore and threaded variants, and where the job table is. */
export interface PreemptOpts {
  kendPage: number;
  smp: boolean;
  thr: boolean;
  KD: number;
}

/** The options of `preemptive` and the code helpers that depend on them (`preemptCtx`). */
export interface PreemptCtx extends PreemptOpts {
  /** kstart's scratch words. */
  K: number;
  /** The PCB of the context running on this core, into `rd` (`tmp` is clobbered; they may be the same register). */
  curp: (rd: string, tmp: string) => string[];
  /** The page-fault handler's scratch word `off`. */
  pf: (off: number) => string;
  /** The big kernel lock taken inline (clobbers the three registers). */
  lockIn: (tag: string, regs: readonly [string, string, string]) => string[];
  /** The big kernel lock given back (clobbers `a`). */
  unlockIn: (a: string) => string[];
  /** The interrupt lines the timer handler acknowledges. */
  ackBits: number;
  /** Tells the NIC driver when the job that ended is a network job. */
  nicKick: (tag: string) => string[];
  /** Saves the output row of the context in t0 into its PCB. */
  rowSave: readonly string[];
}

/** The kernel to build: `paged` is OS 2, `pre` OS 3 (preemptive), `smp` the multicore image, `thr` OS 4 (threaded jobs). */
export interface SourceOpts {
  paged: boolean;
  pre: boolean;
  smp: boolean;
  thr: boolean;
}

/** The options of `kernelSource` and the places that follow from them (`sourceCtx`). */
export interface SourceCtx extends SourceOpts {
  /** Where the job table is and where it ends. */
  KD: number;
  JT_END: number;
  /** OS 2's page tables. */
  TBL: number;
  /** The end of the kernel's data, and the page above it. */
  KEND: number;
  KEND_PAGE: number;
  /** Core 1 of the multicore OS 2. */
  smp2: boolean;
}
