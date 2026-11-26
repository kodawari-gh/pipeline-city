// Job classes and what they need from the machine (docs/PROGRESSION.md). Balance numbers for JOB_CLASSES live here.

/** What a job needs from the machine to run. Met when the device is installed and working when the job would be picked. */
export type Need =
  | { kind: 'os'; min: number }
  | { kind: 'storage'; minTier: number }
  | { kind: 'net'; minTier?: number }
  | { kind: 'tpm'; minTier?: number }
  | { kind: 'ecc' }
  | { kind: 'gpu'; minTier: number }
  | { kind: 'npu' }
  | { kind: 'cores'; min: number }
  | { kind: 'ram'; minBytes: number }
  /** A mounted, clean drive under an OS whose filesystem tier is at least `min`, with `freeBytes` free on it (docs/OS.md, contracts). */
  | { kind: 'fs'; min: number; freeBytes?: number };

export type JobClassId = 'cli' | 'scan' | 'db' | 'web' | 'secure' | 'gpu' | 'npu' | 'hpc' | 'cloud';

export interface JobClassDef {
  id: JobClassId;
  /** Generator template the job's program comes from ("cli" picks log/calc/checksum by seed). */
  template: string;
  scale: number;
  /** Payout multiplier for this class (heavier work pays more per instruction). */
  payMul: number;
  needs: Need[];
  /** The level that introduces the class: its share ramps in from there. */
  firstLevel: number;
  /** Ticks the share takes to ramp from 0 to its table value after `firstLevel` is reached. */
  rampTicks: number;
  /** Heavy classes arrive more with a good reputation and less with a bad one (docs/PROGRESSION.md "Shift with reputation"). */
  heavy: boolean;
  /** PLACEHOLDER: the class has no generator template or device of its own yet. Its jobs borrow `template`, arrive and expire. */
  placeholder?: boolean;
  /**
   * Latency SLA (docs/NETWORK.md "Web jobs"): ticks after arrival, at 1x patience, within which the job pays in full. Later the
   * pay falls in a line to the late factor at the deadline. Scaled by the level's patience like the deadline. Absent: no SLA.
   */
  slaTicks?: number;
  /** Opt-in contracts (src/sim/game/contracts.ts): never arrives as a key, never in the mix. The player accepts offers from the log. */
  contract?: true;
}

export const JOB_CLASSES: readonly JobClassDef[] = [
  { id: 'cli', template: 'cli', scale: 1, payMul: 1, needs: [], firstLevel: 1, rampTicks: 0, heavy: false },
  { id: 'scan', template: 'cli.scan', scale: 4, payMul: 2, needs: [], firstLevel: 5, rampTicks: 300, heavy: false },
  // The in-memory index: a 32K table at virtual 0x10000, so it needs RAM that reaches past it (96K), an OS and a SATA SSD or better.
  {
    id: 'db',
    template: 'db.index',
    scale: 1,
    payMul: 2,
    needs: [
      { kind: 'os', min: 1 },
      { kind: 'storage', minTier: 1 },
      { kind: 'ram', minBytes: 0x1_00_00 + 32 * 1024 },
    ],
    firstLevel: 5,
    rampTicks: 600,
    heavy: true,
  },
  // PLACEHOLDERS below: they need devices that do not exist yet, so they are never runnable today (they arrive and expire).
  // The network jobs: what a client asks of a server. Each kind sets its own plan tier (docs/JOBS.md); the class need is a link of any plan.
  {
    id: 'web',
    template: 'web.page',
    scale: 2,
    payMul: 2,
    needs: [{ kind: 'net' }],
    firstLevel: 4,
    rampTicks: 600,
    heavy: true,
    slaTicks: 120,
  },
  {
    id: 'secure',
    template: 'secure.sign',
    scale: 4,
    payMul: 3,
    needs: [{ kind: 'tpm' }, { kind: 'ecc' }],
    firstLevel: 9,
    rampTicks: 600,
    heavy: true,
  },
  // The GPU batch job (template gpu.render) needs no card: with one the program offloads its kernel, without one it runs the same work on the CPU, slower and at the same pay (docs/ACCEL.md).
  { id: 'gpu', template: 'gpu.render', scale: 4, payMul: 3, needs: [], firstLevel: 10, rampTicks: 600, heavy: true },
  // The inference job needs no card: NPU, then GPU, then CPU, slower down the chain at the same pay (docs/ACCEL.md).
  { id: 'npu', template: 'npu.infer', scale: 4, payMul: 4, needs: [], firstLevel: 12, rampTicks: 600, heavy: true },
  // The high-performance compute jobs (src/sim/gen/tasks.hpc.ts): threaded programs, so they need the multicore OS 4 and as many logical cores as the kind has threads (2, 4 or 8; the kinds say which).
  {
    id: 'hpc',
    template: 'hpc.reduce',
    scale: 8,
    payMul: 5,
    needs: [
      { kind: 'cores', min: 2 },
      { kind: 'os', min: 4 },
    ],
    firstLevel: 14,
    rampTicks: 600,
    heavy: true,
  },
  // Cloud-storage contracts (docs/JOBS.md "Contracts"): opt-in offers from the first level after the SATA SSD (level 3). They hold a client's dataset on a drive, so they need a filesystem that allocates (os2+).
  {
    id: 'cloud',
    template: 'cli.log',
    scale: 1,
    payMul: 1,
    needs: [{ kind: 'fs', min: 2 }],
    firstLevel: 4,
    rampTicks: 0,
    heavy: false,
    contract: true,
  },
];

export function jobClass(id: string): JobClassDef | undefined {
  return JOB_CLASSES.find((c) => c.id === id);
}

const TEMPLATE_CLASS: Record<string, JobClassId> = {
  'cli.scan': 'scan',
  'db.index': 'db',
};

/** The class of a job made from a plain generator template (a sandbox key, the guided first key, an old save). */
export function classOfTemplate(template: string): JobClassId {
  return TEMPLATE_CLASS[template] ?? 'cli';
}
