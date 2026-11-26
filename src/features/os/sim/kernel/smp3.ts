// The multicore OS 3: the big kernel lock and what the other logical cores run.

import {
  INTC_BASE,
  INTC_REG,
  IRQ,
  KERNEL_PVEC,
  KERNEL_TVEC,
  MMU_BASE,
  MMU_REG,
  TIMER_BASE,
  TIMER_REG,
} from '@/core/sim/memmap';
import {
  IDLEP,
  KSTK,
  KTBL,
  LOCK3,
  MAX_LCORES,
  PCORE,
  PCORE_BYTES,
  PC_CURP,
  PC_SCR,
  SLICE_CYCLES,
  SLICE_CYCLES_THR,
} from './layout';
import { roff } from './shared';

/** The per-core entry stubs and the interrupt bits of the other cores. */
const smp3Ctx = (thr: boolean) => {
  const ack = (1 << IRQ.TIMER) | (1 << IRQ.IPI);
  const stubs: string[] = [];
  for (let c = 0; c < MAX_LCORES; c++) {
    const blk = PCORE + c * PCORE_BYTES;
    stubs.push(
      `ktimer_c${c}:`, // save t0 and t1 in the running context's PCB, then the common handler
      `  sw t0, ${blk + PC_SCR}(zero)`,
      `  lw t0, ${blk + PC_CURP}(zero)`,
      `  sw t1, ${roff('t1')}(t0)`,
      `  lw t1, ${blk + PC_SCR}(zero)`,
      `  sw t1, ${roff('t0')}(t0)`,
      '  j ktimer',
      `kpf_c${c}:`, // the page-fault handler's block starts with the registers it borrows (t0 is the third)
      `  sw t0, ${blk + 8}(zero)`,
      `  li t0, ${blk}`,
      '  j kpf',
    );
  }
  return { thr, ack, stubs };
};
type Smp3Ctx = ReturnType<typeof smp3Ctx>;

/** `secondary3`: the code from `klk` on. */
const klkAsm = (): string[] => [
  // the big kernel lock for the scheduler: klk clobbers t1-t3, kuk t4
  'klk:',
  `  li t1, ${LOCK3}`,
  '  li t2, 1',
  'klks:',
  '  lw t3, 0(t1)', // read first: spinning with amoswap would flood the shared L2 port and starve the holder
  '  bne t3, zero, klks',
  '  amoswap t3, t2, (t1)',
  '  bne t3, zero, klks',
  '  ret',
  'kuk:',
  `  li t4, ${LOCK3}`,
  '  sw zero, 0(t4)',
  '  ret',
  // no context to run: back to the idle loop of this core
  'kpnone:',
  '  call kuk',
  `  slli t0, s0, 7`,
  `  addi t0, t0, ${IDLEP}`,
  `  sw t0, ${PCORE + PC_CURP}(s1)`,
  `  li t2, ${MMU_BASE}`,
  `  li t0, ${KTBL}`,
  `  sw t0, ${MMU_REG.TABLE}(t2)`,
  '  slli t0, s0, 8',
  `  li sp, ${KSTK}`,
  '  sub sp, sp, t0',
  `  li t2, ${INTC_BASE}`,
  '  la t0, kidlec',
  `  sw t0, ${INTC_REG.EPC}(t2)`,
  '  iret',
  // a woken core: its vectors, row, timer and translation (the kernel's own address space), then idle
  'k3entry:',
  `  li t1, ${INTC_BASE}`,
  `  lw s0, ${INTC_REG.CORE_ID}(t1)`,
  '  slli t0, s0, 8',
  `  li sp, ${KSTK}`,
  '  sub sp, sp, t0',
  `  sw s0, ${INTC_REG.ROW_BASE}(t1)`,
  '  slli t0, s0, 2',
  `  addi t2, t0, ${KERNEL_TVEC}`,
];

/** `secondary3`: the code from `kidlec` on. */
const kidlecAsm = (ctx: Smp3Ctx): string[] => {
  const { thr, ack, stubs } = ctx;
  return [
    `  sw t2, ${INTC_REG.VECTOR}(t1)`,
    `  li t3, ${MMU_BASE}`,
    `  addi t2, t0, ${KERNEL_PVEC}`,
    `  sw t2, ${MMU_REG.VECTOR}(t3)`,
    `  li t2, ${ack}`,
    `  sw t2, ${INTC_REG.MASK}(t1)`,
    '  slli t2, s0, 6',
    '  slli t0, s0, 7',
    `  addi t0, t0, ${IDLEP}`,
    `  sw t0, ${PCORE + PC_CURP}(t2)`,
    `  li t2, ${TIMER_BASE}`,
    `  li t0, ${thr ? SLICE_CYCLES_THR : SLICE_CYCLES}`,
    `  sw t0, ${TIMER_REG.INTERVAL}(t2)`,
    `  li t0, ${KTBL}`,
    `  sw t0, ${MMU_REG.TABLE}(t3)`,
    '  li t0, 1',
    `  sw t0, ${MMU_REG.CONTROL}(t3)`,
    `  li t0, ${1 << IRQ.IPI}`,
    `  sw t0, ${INTC_REG.ACK}(t1)`,
    '  li t0, 1',
    `  sw t0, ${INTC_REG.CTRL}(t1)`,
    'kidlec:',
    `  li t2, ${INTC_BASE}`,
    '  li t0, 1',
    `  sw t0, ${INTC_REG.PARK}(t2)`,
    '  j kidlec',
    ...stubs,
  ];
};

/**
 * The multicore OS 3 (docs/OS.md "Preemption on every core"): what the other logical cores run. Each core has its own timer, vectors and block of scratch words (`PCORE`);
 * the entry stubs below load the block's addresses, because an interrupt handler has no register to spare. A core without a context to run sits in `kidlec` parked and wakes
 * for its timer or an IPI to look again.
 */
export function secondary3(thr = false): string[] {
  const ctx = smp3Ctx(thr);
  return [...klkAsm(), ...kidlecAsm(ctx)];
}
