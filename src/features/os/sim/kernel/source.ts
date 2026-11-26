// The kernel's source for each OS tier. Its code is in the source.*.ts files, in the order it is emitted.

import { kEntryAsm, kpollAsm } from './source.boot';
import { sourceCtx } from './source.ctx';
import { findSlotAsm, kflashAsm, kicopyAsm, kioutAsm } from './source.ingest';
import { krunAsm } from './source.run';
import type { SourceOpts } from './types';

/** The kernel's source: `paged` is OS 2, which gives each program an address space (docs/VM.md) instead of guarding the OS with the memory protection unit. */
export function kernelSource(o: SourceOpts): string {
  const ctx = sourceCtx(o);
  return [
    ...kEntryAsm(ctx),
    ...kpollAsm(ctx),
    ...krunAsm(ctx),
    ...kflashAsm(ctx),
    ...kicopyAsm(ctx),
    ...kioutAsm(ctx),
    ...findSlotAsm(ctx),
  ].join('\n');
}
