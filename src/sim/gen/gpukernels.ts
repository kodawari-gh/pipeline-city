// Helpers the GPU jobs share (docs/ACCEL.md "GPU"). The picture kernels themselves (GPU assembly, CPU twin, JS reference) are in gpupicture.ts.

import { TPM_BASE, TPM_REG } from "../isa/memmap";
import type { Kernel } from "./kernels";

export * from "./gpupicture";

const kernel = (name: string, ns: string, mix: Kernel["mix"], body: string[]): Kernel =>
  ({ name, ns, mix, footprintBytes: 0, asm: [`${ns}:`, ...body.map((l) => `  ${l}`)].join("\n") });

/** tpm_cmd(cmd = a0, arg0 = a1, arg1 = a2): write the TPM registers, start the command, poll until it is done, return RESULT in a0. */
export function tpmCommand(ns: string): Kernel {
  return kernel("tpm_cmd", ns, ["io", "branch", "alu"], [
    `li t0, ${TPM_BASE}`, `sw a1, ${TPM_REG.ARG0}(t0)`, `sw a2, ${TPM_REG.ARG1}(t0)`, `sw a0, ${TPM_REG.CMD}(t0)`,
    `${ns}_poll:`, `lw t1, ${TPM_REG.STATUS}(t0)`, "andi t1, t1, 1", `bne t1, zero, ${ns}_poll`,
    `lw a0, ${TPM_REG.RESULT}(t0)`, "ret",
  ]);
}

/**
 * copy_words(dst = a0, src = a1, bytes = a2, a multiple of 16, >= 16): a word copy, four words a turn, used to fill card memory through
 * the bus window. Callers round the size up (`roundUp16`); the few extra bytes read and written are harmless.
 */
export function copyWords(ns: string): Kernel {
  return kernel("gpu_copy", ns, ["mem", "alu", "branch"], [
    `${ns}_loop:`, "lw t0, 0(a1)", "lw t1, 4(a1)", "lw t2, 8(a1)", "lw t3, 12(a1)", "sw t0, 0(a0)", "sw t1, 4(a0)", "sw t2, 8(a0)", "sw t3, 12(a0)",
    "addi a0, a0, 16", "addi a1, a1, 16", "addi a2, a2, -16", `bne a2, zero, ${ns}_loop`, "ret",
  ]);
}

/** Bytes rounded up to the 16 `copyWords` moves at a time. */
export const roundUp16 = (n: number): number => (n + 15) & ~15;
