// The kernel's source: its title, the vectors, the boot (`kmain`) and the main loop (`kloop`, `kpoll`).

import {
  DISPLAY_BASE,
  KDATA_BASE,
  KERNEL_VEC_CORES,
  KSLOT,
  OS_HEADER_BASE,
  PCH_BASE,
  PCH_REG,
  PchPhase,
} from '@/core/sim/memmap';
import { status } from '../asmtext';
import { nicInit } from '../nicdriver';
import { C1BUSY, NIC_EV } from './layout';
import { bootMemoryAsm } from './source.start';
import type { SourceCtx } from './types';

/** `kernelSource`: a part of its code. */
const kernelTitle = (ctx: SourceCtx): string => {
  const { paged, pre, smp, thr } = ctx;
  if (pre) {
    if (thr) {
      return '# OS v4 kernel (preemptive on every core, threaded jobs)';
    }
    if (smp) {
      return '# OS v3 kernel (preemptive on every core)';
    }
    return '# OS v3 kernel (preemptive: several programs, each in its own address space)';
  }
  if (smp) {
    return '# OS v2 kernel (paged, two cores: one program per core)';
  }
  if (paged) {
    return '# OS v2 kernel (paged: one address space per program)';
  }
  return '# OS v1 kernel (single-task resident)';
};

/** `kernelSource`: the code from `k_entry` on. */
export const kEntryAsm = (ctx: SourceCtx): string[] => {
  const { pre, smp, KD, JT_END, KEND, smp2 } = ctx;
  return [
    kernelTitle(ctx),
    'k_entry:',
    '  j kmain',
    'k_done_vec:', // KERNEL_DONE = KERNEL_BASE + 4: the ROM epilogue lands here when a job ends
    '  j kdone',
    'k_fault_vec:', // KERNEL_FAULT = KERNEL_BASE + 8: the CPU is sent here when a job wrote to protected memory
    '  j kfault',
    'k_pf_vec:', // KERNEL_PAGEFAULT = KERNEL_BASE + 12: the MMU sends the CPU here on a page fault
    smp && pre ? '  j kpf_c0' : '  j kpf',
    ...(pre ? ['k_timer_vec:', smp ? '  j ktimer_c0' : '  j ktimer'] : []), // KERNEL_TIMER = KERNEL_BASE + 16
    ...(smp2 ? ['k_spare_vec:', '  j kfault', 'k_sec_vec:', '  j k2entry', 'k_pf1_vec:', '  j kpf1'] : []), // + 16 unused, KERNEL_SECONDARY = + 20, KERNEL_PAGEFAULT1 = + 24
    ...(smp && pre
      ? [
          'k_sec_vec:',
          '  j k3entry',
          'k_spare_vec:',
          '  j kfault',
          ...Array.from({ length: KERNEL_VEC_CORES }, (_, c) => [`k_tvec${c}:`, `  j ktimer_c${c}`]).flat(),
          ...Array.from({ length: KERNEL_VEC_CORES }, (_, c) => [`k_pvec${c}:`, `  j kpf_c${c}`]).flat(),
        ]
      : []), // KERNEL_SECONDARY = + 20, then each core's timer and page-fault entries
    'kmain:',
    '  li sp, 65536',
    `  li s0, ${PCH_BASE}`,
    `  li t0, ${KDATA_BASE}`,
    `  li t1, ${KEND}`,
    'kzero:',
    '  sw zero, 0(t0)',
    '  addi t0, t0, 4',
    '  bne t0, t1, kzero',
    ...(pre
      ? [`  li t0, ${KD}`, `  li t1, ${JT_END}`, 'kzjt:', '  sw zero, 0(t0)', '  addi t0, t0, 4', '  bne t0, t1, kzjt']
      : []),
    ...bootMemoryAsm(ctx),
    ...nicInit(pre), // the NIC gets its rings and is switched on (OS 3 and up: with its interrupts)
    'kloop:',
    `  li s0, ${PCH_BASE}`,
    `  li s3, ${OS_HEADER_BASE}`,
    `  lw s1, ${PCH_REG.BOOT_DEV}(s0)`,
  ];
};

/** `kernelSource`: the code from `kpoll` on. */
export const kpollAsm = (ctx: SourceCtx): string[] => {
  const { pre, smp2 } = ctx;
  return [
    // the network driver: segments that came in, results that go out. OS 3 and up (interrupts on) run it when the handler or the end of a network job has set the flag; the others poll on each pass.
    ...(pre
      ? [`  lw t0, ${NIC_EV}(zero)`, '  beq t0, zero, knoev', `  sw zero, ${NIC_EV}(zero)`, '  call knic', 'knoev:']
      : ['  call knic']),
    `  lw t0, ${PCH_REG.PHASE}(s0)`,
    `  li t1, ${PchPhase.OsIdle}`,
    '  beq t0, t1, kpoll',
    ...(pre ? ['  call kcnt', `  li t1, ${PchPhase.OsIdle}`, '  bne a0, zero, kpoll'] : []), // programs still running: the phase stays "running"
    ...(smp2 ? [`  lw t2, ${C1BUSY}(zero)`, '  bne t2, zero, kpoll'] : []), // core 1 still runs a job
    `  sw t1, ${PCH_REG.PHASE}(s0)`,
    `  li a3, ${DISPLAY_BASE}`,
    ...status('OS READY', 'a3'),
    'kpoll:',
    `  lw t0, ${PCH_REG.STATUS}(s0)`,
    '  andi t1, t0, 1',
    '  beq t1, zero, krun', // no key in the port
    '  andi t1, t0, 8',
    '  beq t1, zero, krun', // not enumerated yet
    `  lw a0, ${PCH_REG.KEY_ID}(s0)`,
    '  call find_slot',
    `  lw t0, ${PCH_REG.STATUS}(s0)`,
    '  beq a0, zero, knew',
    `  lw t1, ${KSLOT.STATE}(a0)`,
    '  li t2, 4',
    '  bne t1, t2, krun', // queued or running: nothing to do for this key
    '  andi t1, t0, 2',
    '  bne t1, zero, kfree', // the flash landed: the slot is free again
    '  andi t1, t0, 16',
    '  bne t1, zero, krun', // flash in progress
    '  call kflash',
    '  j kloop',
    'kfree:',
    `  sw zero, ${KSLOT.STATE}(a0)`,
    '  j kloop',
    'knew:',
    '  andi t1, t0, 2',
    '  bne t1, zero, krun', // the key already holds a result (not one of ours)
    '  call kingest',
    '  j kloop',
  ];
};
