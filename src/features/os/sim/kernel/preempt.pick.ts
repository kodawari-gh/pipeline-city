// The preemptive kernel: the timer handler and the scheduler (`ktimer`, `kpick`).

import { INTC_BASE, INTC_REG, IRQ, KSLOT, MMU_BASE, MMU_REG, PCH_RESULT_WORDS } from '@/core/sim/memmap';
import { CURP, JOB_ROW_ADDR, KMIGR, NIC_EV, PCB, PCBS, PCORE, PC_CURP, SCR, SLEEP } from './layout';
import { REGS, copy, roff } from './shared';
import type { PreemptCtx } from './types';

/** `preemptive`: the code from `kpick` on. */
const kpickSmpAsm = (ctx: PreemptCtx): string[] => {
  const { thr } = ctx;
  return [
    // Several cores: the scan runs under the big lock. A context belongs to one core at a time (PCB.CORE, the core number + 1), so a core only takes one that is
    // free; the one that just ran is looked at last. Nothing to run (the kernel is asleep or on another core): the core idles until its timer or an IPI.
    'kpick:',
    `  li t1, ${INTC_BASE}`,
    `  lw s0, ${INTC_REG.CORE_ID}(t1)`,
    '  slli s1, s0, 6', // s1 + PCORE = this core's block
    '  call klk',
    `  lw t0, ${PCORE + PC_CURP}(s1)`,
    `  li t1, ${PCBS}`,
    '  sub t0, t0, t1',
    '  srli t0, t0, 7',
    '  li t1, 9',
    '  blt t0, t1, kpr',
    '  li t0, 8', // an idle core scans from context 0
    '  j kps',
    'kpr:', // the context that ran gives up its claim (a finished job has already)
    '  slli t2, t0, 7',
    `  li t3, ${PCBS}`,
    '  add t2, t2, t3',
    `  lw t3, ${PCB.CORE}(t2)`,
    '  addi t4, s0, 1',
    '  bne t3, t4, kps',
    `  sw zero, ${PCB.CORE}(t2)`,
    'kps:',
    `  li s2, ${thr ? 18 : 9}`, // OS 4: two rounds, the first only takes a context this core ran last (or none has run)
    'kpn:',
    '  addi t0, t0, 1',
    '  li t1, 9',
    '  bne t0, t1, kpa',
    '  li t0, 0',
    'kpa:',
    '  addi s2, s2, -1',
    '  blt s2, zero, kpnone',
    '  slli t2, t0, 7',
    `  li t1, ${PCBS}`,
    '  add t2, t2, t1', // t2 = its PCB
    `  lw t3, ${PCB.CORE}(t2)`,
    '  bne t3, zero, kpn', // another core has it
    '  li t1, 8',
    '  bne t0, t1, kpj',
  ];
};

/** `preemptive`: the code from `kpj` on. */
const kpjAsm = (ctx: PreemptCtx): string[] => {
  const { thr, KD } = ctx;
  return [
    `  lw t3, ${SLEEP}(zero)`, // the kernel found nothing to do: it is skipped for a few rounds, so the programs get the processors
    '  beq t3, zero, kpgo',
    ...(thr ? ['  li t4, 9', '  bge s2, t4, kpn'] : []), // the sleep counts rounds of the scan, not passes
    '  addi t3, t3, -1',
    `  sw t3, ${SLEEP}(zero)`,
    '  j kpn',
    'kpj:',
    ...(thr
      ? [
          `  lw t3, ${PCB.SLOT}(t2)`, // a context belongs to a job, or is free
          '  beq t3, zero, kpn',
          `  lw t3, ${KSLOT.STATE}(t3)`,
          '  li t4, 3',
          '  bne t3, t4, kpn',
          '  li t4, 9',
          '  blt s2, t4, kpgo', // second round: any
          `  lw t3, ${PCB.LAST}(t2)`,
          '  beq t3, zero, kpgo',
          '  addi t4, s0, 1',
          '  bne t3, t4, kpn', // another core ran it last: it waits for its turn in the second round
        ]
      : [
          '  slli t3, t0, 6',
          `  li t1, ${KD}`,
          '  add t3, t3, t1',
          `  lw t3, ${KSLOT.STATE}(t3)`,
          '  li t4, 3',
          '  bne t3, t4, kpn',
        ]),
    'kpgo:',
    '  addi t3, s0, 1',
    `  sw t3, ${PCB.CORE}(t2)`, // claimed
    `  sw t2, ${PCORE + PC_CURP}(s1)`,
  ];
};

/** `preemptive`: the code from `kpg1` on. */
const kpg1Asm = (ctx: PreemptCtx): string[] => {
  const { thr } = ctx;
  return [
    ...(thr
      ? [
          '  li t4, 8',
          '  beq t0, t4, kpg2', // the kernel's context has no affinity
          `  lw t4, ${PCB.LAST}(t2)`,
          '  beq t4, zero, kpg1',
          '  beq t4, t3, kpg1',
          `  li t4, ${KMIGR}`, // a migration: another core ran it last
          '  lw a0, 0(t4)',
          '  addi a0, a0, 1',
          '  sw a0, 0(t4)',
          'kpg1:',
          `  sw t3, ${PCB.LAST}(t2)`,
          'kpg2:',
        ]
      : []),
    '  call kuk',
    '  mv t1, t2', // t1 = its PCB
    `  li t3, ${INTC_BASE}`,
    '  li t4, 8',
    '  bne t0, t4, kpq',
    `  sw zero, ${INTC_REG.ROW_BASE}(t3)`, // the kernel writes the status line at the top of the display
    '  j kpd',
    'kpq:',
    `  sw s0, ${INTC_REG.ROW_BASE}(t3)`, // a program's output row is its core's
    `  li t2, ${JOB_ROW_ADDR}`, // the program finds its output row as it left it
    `  addi t3, t1, ${PCB.ROW}`,
    `  addi t4, t3, ${4 * PCH_RESULT_WORDS}`,
    ...copy('ksl', ['t3', 't2', 't4', 'a0']),
    'kpd:',
  ];
};

/** `preemptive`: the code from `kpick` on. */
const kpickOneAsm = (ctx: PreemptCtx): string[] => {
  const { KD } = ctx;
  return [
    'kpick:',
    `  lw t0, ${CURP}(zero)`,
    `  li t1, ${PCBS}`,
    '  sub t0, t0, t1',
    '  srli t0, t0, 7',
    'kpn:',
    '  addi t0, t0, 1',
    '  li t1, 9',
    '  bne t0, t1, kpa',
    '  li t0, 0',
    'kpa:',
    '  li t1, 8',
    '  bne t0, t1, kpj',
    `  lw t2, ${SLEEP}(zero)`, // the kernel found nothing to do: it is skipped for a few rounds, so the programs get the processor
    '  beq t2, zero, kpgo',
    '  addi t2, t2, -1',
    `  sw t2, ${SLEEP}(zero)`,
    '  j kpn',
    'kpj:',
    '  slli t2, t0, 6',
    `  li t1, ${KD}`,
    '  add t2, t2, t1',
    `  lw t3, ${KSLOT.STATE}(t2)`,
    '  li t4, 3',
    '  bne t3, t4, kpn',
    'kpgo:',
    '  slli t1, t0, 7',
    `  li t2, ${PCBS}`,
    '  add t1, t1, t2', // t1 = its PCB
    '  li t2, 8',
    '  beq t0, t2, kpd',
    `  li t2, ${JOB_ROW_ADDR}`, // the program finds its output row as it left it
    `  addi t3, t1, ${PCB.ROW}`,
    `  addi t4, t3, ${4 * PCH_RESULT_WORDS}`,
    ...copy('ksl', ['t3', 't2', 't4', 'a0']),
    'kpd:',
    `  sw t1, ${CURP}(zero)`,
  ];
};

/** `preemptive`: the code from `ktimer` on. */
export const ktimerAsm = (ctx: PreemptCtx): string[] => {
  const { smp, thr, ackBits, rowSave } = ctx;
  return [
    // ---- the timer: save the running context, then pick the next ----
    'ktimer:',
    ...(smp ? [] : [`  sw t0, ${SCR}(zero)`, `  lw t0, ${CURP}(zero)`]), // multicore: the core's own stub has saved t0 and t1 and loaded t0 with the PCB
    ...REGS.filter((r) => r !== 't0' && (!smp || r !== 't1')).map((r) => `  sw ${r}, ${roff(r)}(t0)`),
    ...(smp ? [] : [`  lw t1, ${SCR}(zero)`, `  sw t1, ${roff('t0')}(t0)`]),
    `  li t1, ${INTC_BASE}`,
    `  lw t2, ${INTC_REG.EPC}(t1)`,
    `  sw t2, ${PCB.PC}(t0)`,
    `  li t2, ${ackBits}`,
    `  sw t2, ${INTC_REG.ACK}(t1)`,
    // the NIC's line (core 0 takes it): acknowledge it only when it is seen pending here (one that rises after is taken again), note that the NIC wants service and wake the kernel's context,
    // which runs the driver (the bottom half). The nonzero value of the masked bit is the flag.
    `  lw t2, ${INTC_REG.PENDING}(t1)`,
    `  andi t2, t2, ${1 << IRQ.NIC}`,
    '  beq t2, zero, ktnic',
    `  sw t2, ${INTC_REG.ACK}(t1)`,
    `  sw t2, ${NIC_EV}(zero)`,
    `  sw zero, ${SLEEP}(zero)`,
    'ktnic:',
    `  lw t1, ${PCB.SLOT}(t0)`,
    '  beq t1, zero, kpick', // the kernel (and an idle core) has no output row
    ...(thr ? [`  lw t2, ${KSLOT.DEAD}(t1)`, '  bne t2, zero, kthrdead'] : []), // a thread of a job that was killed ends here
    ...rowSave,
    // falls into kpick

    // ---- kpick: run the next context after the current one that can run (single core: the kernel always can) ----
    ...(smp ? [...kpickSmpAsm(ctx), ...kpjAsm(ctx), ...kpg1Asm(ctx)] : kpickOneAsm(ctx)),
    `  li t2, ${MMU_BASE}`,
    `  lw t3, ${PCB.TABLE}(t1)`,
    `  sw t3, ${MMU_REG.TABLE}(t2)`, // its address space (the TLB is emptied)
    `  li t2, ${INTC_BASE}`,
    `  lw t3, ${PCB.PC}(t1)`,
    `  sw t3, ${INTC_REG.EPC}(t2)`,
    ...REGS.filter((r) => r !== 't1').map((r) => `  lw ${r}, ${roff(r)}(t1)`),
    `  lw t1, ${roff('t1')}(t1)`,
    '  iret',
  ];
};
