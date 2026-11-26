// What an instruction does for the machine (docs/JOBS.md "Reading the code"): the classes the listing, the die and the RAM view colour by.

import type { OpClass } from './types';

export const OP_CLASSES: readonly OpClass[] = ['alu', 'ld', 'st', 'mul', 'br', 'sys'];

export function opClassOf(mnemonic: string): OpClass {
  if (mnemonic === 'mul') {
    return 'mul';
  }
  if (mnemonic === 'lw' || mnemonic === 'lb' || mnemonic === 'lbu') {
    return 'ld';
  }
  if (mnemonic === 'sw' || mnemonic === 'sb') {
    return 'st';
  }
  if (mnemonic === 'jal' || mnemonic === 'jalr' || mnemonic.startsWith('b')) {
    return 'br';
  }
  if (mnemonic === 'ecall' || mnemonic === 'iret') {
    return 'sys';
  }
  return 'alu';
}
