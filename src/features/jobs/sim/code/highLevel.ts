// The same job as a person would write it (docs/JOBS.md "Reading the code"): what the assembly does, in C++ and in Python, by almanac entry.

import { ACCEL_HIGH_LEVEL } from './highLevel.accel';
import { EVERYDAY_HIGH_LEVEL } from './highLevel.everyday';
import { HPC_HIGH_LEVEL } from './highLevel.hpc';
import { MEMORY_HIGH_LEVEL } from './highLevel.memory';
import { NETWORK_HIGH_LEVEL } from './highLevel.network';
import { TRUST_HIGH_LEVEL } from './highLevel.trust';
import type { HighLevel } from './types';

/** The same job as a person would write it: what the assembly above does, in C++ and in Python (shown for the keen). */
export const HIGH_LEVEL: Record<string, HighLevel> = {
  ...EVERYDAY_HIGH_LEVEL,
  ...MEMORY_HIGH_LEVEL,
  ...NETWORK_HIGH_LEVEL,
  ...TRUST_HIGH_LEVEL,
  ...ACCEL_HIGH_LEVEL,
  ...HPC_HIGH_LEVEL,
  // The web class runs the calculation program for now, so it reads as the calculation does.
  web: EVERYDAY_HIGH_LEVEL.calc,
};
