// The preemptive part of the kernel (OS 3 and up). Its code is in the preempt.*.ts files, in the order it is emitted.

import { preemptCtx } from './preempt.ctx';
import { kdone3Asm, kfault3Asm } from './preempt.end';
import { kpf3Asm, kpkillAsm, kpz4Asm } from './preempt.fault';
import { kallocNlAsm, kc1Asm, kfl1Asm } from './preempt.free';
import { ktimerAsm } from './preempt.pick';
import { kstRunAsm } from './preempt.run';
import { kstFailAsm, kstRAsm, kstTAsm } from './preempt.start';
import type { PreemptOpts } from './types';

/**
 * The timer handler and scheduler, the page-fault handler that hands out frames, the job start that builds an address space, and the ends of a job. Contexts are
 * the job slots plus the kernel's own (index 8); the timer rotates through the ones that can run. See docs/OS.md "Preemption".
 */
export function preemptive(o: PreemptOpts): string[] {
  const ctx = preemptCtx(o);
  return [
    ...ktimerAsm(ctx),
    ...kdone3Asm(ctx),
    ...kfault3Asm(ctx),
    ...kfl1Asm(ctx),
    ...kc1Asm(ctx),
    ...kallocNlAsm(ctx),
    ...kstTAsm(ctx),
    ...kstFailAsm(ctx),
    ...kstRAsm(ctx),
    ...kstRunAsm(ctx),
    ...kpf3Asm(ctx),
    ...kpz4Asm(ctx),
    ...kpkillAsm(ctx),
  ];
}
