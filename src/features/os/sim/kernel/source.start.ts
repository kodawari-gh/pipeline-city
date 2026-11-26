// The kernel's source: the memory set up at boot, by OS tier (the frame map and the other cores, the second core of OS 2, the protection unit of OS 1).

import {
  INTC_BASE,
  INTC_REG,
  IRQ,
  KERNEL_PAGEFAULT,
  KERNEL_TIMER,
  MMU_BASE,
  MMU_REG,
  MPU_BASE,
  MPU_REG,
  OS_HEADER_BASE,
  PAGED_TABLES,
  PCH_REG,
  USER_BASE,
} from '@/core/sim/memmap';
import {
  ARENA1_END,
  ARENA_END,
  CURP,
  FMAP,
  FMAP_FIRST,
  FRAME_END,
  HINT,
  KTBL,
  KTBL_BYTES,
  NFRAMES,
  OS_FRAMES_END,
  PCB,
  PCBS,
  PCORE,
  PC_CURP,
  RESERVED_FRAME,
  SMPON,
  SMP_MIN_FRAMES,
  kdataEndFor,
} from './layout';
import type { SourceCtx } from './types';

/** `kernelSource`: the code from `knf` on. */
const knf3Asm = (): string[] => [
  // how many frames the machine has (the PCH knows the installed RAM), at most the 20-bit virtual space
  `  lw t0, ${PCH_REG.RAM_KB}(s0)`,
  '  slli t0, t0, 2',
  `  li t1, ${FRAME_END}`,
  '  blt t0, t1, knf',
  '  mv t0, t1',
  'knf:',
  `  sw t0, ${NFRAMES}(zero)`,
  `  li t1, ${FMAP_FIRST}`,
  `  sw t1, ${HINT}(zero)`,
  // the frame map: zero, then reserve the OS's frames and everything beyond the RAM
  `  li t0, ${FMAP}`,
  `  li t1, ${FMAP + 4 * FRAME_END}`,
  'kmz0:',
  '  sw zero, 0(t0)',
  '  addi t0, t0, 4',
  '  bne t0, t1, kmz0',
  `  li t3, ${RESERVED_FRAME}`,
  `  li t0, ${FMAP + 4 * (PAGED_TABLES >> 8)}`,
  `  li t1, ${FMAP + 4 * OS_FRAMES_END}`,
  'kmr0:',
  '  sw t3, 0(t0)',
  '  addi t0, t0, 4',
  '  bne t0, t1, kmr0',
  `  lw t2, ${NFRAMES}(zero)`,
  '  slli t0, t2, 2',
  `  li t4, ${FMAP}`,
  '  add t0, t0, t4',
  `  li t1, ${FMAP + 4 * FRAME_END}`,
  '  bge t0, t1, kmr1',
  'kmr2:',
  '  sw t3, 0(t0)',
  '  addi t0, t0, 4',
  '  bne t0, t1, kmr2',
  'kmr1:',
  // the kernel's own address space: all of RAM, identity, read write run. The kernel runs translated like every program, as one more context the timer switches to.
  `  li t0, ${KTBL}`,
  `  li t1, ${KTBL + KTBL_BYTES}`,
  'kz3:',
  '  sw zero, 0(t0)',
];

/** `kernelSource`: the code from `kt3` on. */
const kt3Asm = (ctx: SourceCtx): string[] => {
  const { smp } = ctx;
  return [
    '  addi t0, t0, 4',
    '  bne t0, t1, kz3',
    `  li t0, ${KTBL + 0x1_00}`,
    '  li t1, 7',
    '  li t3, 0',
    'kt3:',
    '  sw t1, 0(t0)',
    '  addi t0, t0, 4',
    '  addi t1, t1, 256',
    '  addi t3, t3, 1',
    '  bne t3, t2, kt3',
    '  addi t3, t2, 63',
    '  srli t3, t3, 6',
    `  li t0, ${KTBL}`,
    `  li t1, ${KTBL + 0x1_00 + 1}`,
    'kl3:',
    '  sw t1, 0(t0)',
    '  addi t0, t0, 4',
    '  addi t1, t1, 256',
    '  addi t3, t3, -1',
    '  bne t3, zero, kl3',
    `  li t0, ${PCBS + 8 * PCB.BYTES}`,
    `  sw t0, ${smp ? PCORE + PC_CURP : CURP}(zero)`,
    `  li t1, ${KTBL}`,
    `  sw t1, ${PCB.TABLE}(t0)`,
    ...(smp ? ['  li t3, 1', `  sw t3, ${PCB.CORE}(t0)`] : []), // core 0 runs the kernel's context
    `  li t2, ${MMU_BASE}`,
    `  li t0, ${KERNEL_PAGEFAULT}`,
    `  sw t0, ${MMU_REG.VECTOR}(t2)`,
    `  sw t1, ${MMU_REG.TABLE}(t2)`,
    '  li t1, 1',
    `  sw t1, ${MMU_REG.CONTROL}(t2)`,
    `  li t2, ${INTC_BASE}`,
    `  li t0, ${KERNEL_TIMER}`,
    `  sw t0, ${INTC_REG.VECTOR}(t2)`,
    `  li t0, ${(1 << IRQ.TIMER) | (1 << IRQ.NIC)}`,
    `  sw t0, ${INTC_REG.MASK}(t2)`, // the timer and the NIC (core 0 takes the NIC's line)
    `  sw t1, ${INTC_REG.CTRL}(t2)`, // interrupts on: the timer only fires while a program runs, the NIC's line whenever it has something
  ];
};

/** `kernelSource`: a part of its code. */
const wakeCoresAsm = (ctx: SourceCtx): string[] => {
  const { smp } = ctx;
  return smp
    ? [
        `  lw t3, ${INTC_REG.CORES}(t2)`,
        '  li t4, 1',
        '  sll t4, t4, t3',
        '  addi t4, t4, -2',
        `  sw t4, ${INTC_REG.IPI}(t2)`,
      ]
    : [];
};

/** `kernelSource`: the code from `knf` on. */
export const bootMemoryAsm = (ctx: SourceCtx): string[] => {
  const { paged, pre, smp } = ctx;
  if (pre) {
    return [...knf3Asm(), ...kt3Asm(ctx), ...wakeCoresAsm(ctx)];
  }
  if (paged) {
    return [
      `  lw t0, ${PCH_REG.RAM_KB}(s0)`,
      '  slli t0, t0, 2',
      `  li t1, ${FRAME_END}`,
      '  blt t0, t1, knf',
      '  mv t0, t1',
      'knf:',
      `  sw t0, ${NFRAMES}(zero)`,
      ...(smp
        ? [
            // a second core and the RAM for its arena: jobs go to core 1 when it is free
            `  li t2, ${INTC_BASE}`,
            `  lw t1, ${INTC_REG.CORES}(t2)`,
            '  li t2, 2',
            '  blt t1, t2, ksm',
            `  li t2, ${SMP_MIN_FRAMES}`,
            '  blt t0, t2, ksm',
            '  li t1, 1',
            `  sw t1, ${SMPON}(zero)`,
            `  li t1, ${ARENA1_END}`,
            `  sw t1, ${ARENA_END}(zero)`,
            'ksm:',
          ]
        : []),
      // the MMU sends page faults to kpf
      `  li t2, ${MMU_BASE}`,
      `  li t0, ${KERNEL_PAGEFAULT}`,
      `  sw t0, ${MMU_REG.VECTOR}(t2)`,
    ];
  }
  return [
    // memory protection: the boot ROM, and the OS's own header, kernel and job table, are not the jobs' to write
    `  li t2, ${MPU_BASE}`,
    `  li t0, ${USER_BASE}`,
    `  sw zero, ${MPU_REG.R0_LO}(t2)`,
    `  sw t0, ${MPU_REG.R0_HI}(t2)`,
    `  li t0, ${OS_HEADER_BASE}`,
    `  sw t0, ${MPU_REG.R1_LO}(t2)`,
    `  li t0, ${kdataEndFor(1)}`,
    `  sw t0, ${MPU_REG.R1_HI}(t2)`,
  ];
};
