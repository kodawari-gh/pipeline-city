// The options of the kernel's source and the places that follow from them. See source.ts.

import { KSLOT_BYTES, PAGED_TABLES } from '@/core/sim/memmap';
import { jobTableFor, kdataEndFor } from './layout';
import type { SourceCtx, SourceOpts } from './types';

/** The options of `kernelSource` and the places that follow from them. */
export const sourceCtx = (o: SourceOpts): SourceCtx => {
  const { pre, smp } = o;
  /** Where the job table is and where it ends: the tiers with a frame map (OS 3 and up) keep it above the frame map (`JT_BASE`), the others at `KDATA_BASE`. */
  const jt = jobTableFor(pre ? 3 : 1);
  const KEND = kdataEndFor(pre ? 3 : 2, smp);
  return {
    ...o,
    KD: jt.base,
    JT_END: jt.base + jt.slots * KSLOT_BYTES,
    TBL: PAGED_TABLES,
    KEND,
    KEND_PAGE: (KEND + 255) & ~255,
    smp2: smp && !pre, // core 1 of the multicore OS 2
  };
};
