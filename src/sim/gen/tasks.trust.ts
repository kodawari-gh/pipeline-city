// The trust jobs beyond the signed transaction: each uses the TPM in a different way (one measurement, a chain of them, a burst of quotes, sealing and
// unsealing, a hash inside protected mode, a value sealed again after every round), so the module's clock, its attest time and its protected-mode surcharge
// weigh differently in each. The reference interpreter runs them against an instant fake (machine/tpm.ts), so the answer printed never depends on the module.
// A quote itself is the machine's own random word, so it is counted and never shown.

import { TpmCmd } from "../isa/memmap";
import { Builder, BUF_BASE, blankRows, emitStatic, layoutLine, pad2, renderLine, rowAddr, type Seg, type TemplateFn } from "./build";
import { tpmCommand } from "./gpukernels";
import * as K from "./kernels";

function open(b: Builder, p: { row: number; jobId: number }, label: string) {
  const segs: Seg[] = [`#${pad2(p.jobId)} ${label}`, { dyn: 4 }, " OK"];
  const line = layoutLine(segs);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  return { segs, line };
}

/** The answer is in a0. */
function close(b: Builder, p: { row: number }, o: ReturnType<typeof open>, header: string, value: number) {
  b.emit("andi a1, a0, 1023", `addi a0, s0, ${o.line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 4))}`);
  return b.finish(header, blankRows(p.row) + renderLine(o.segs, [value & 1023]));
}

const words = (label: string, ws: number[]): string[] => [`${label}:`, ...ws.map((w) => `  .word ${w >>> 0}`)];

/** The word hash of the checksum kernel and of the TPM's measurement. */
function wordHash(ws: number[]): number {
  let h = 5381;
  for (const w of ws) h = (((h + (h << 5)) ^ w) >>> 0) | 0;
  return h >>> 0;
}

/** Protect the program's own range (from `main` up to the scratch buffer) in the same way the signed transaction does. */
function protect(b: Builder, cmd: string): void {
  b.emit("la a1, main", `li a2, ${BUF_BASE}`, "sub a2, a2, a1", "srli a2, a2, 2", `li a0, ${TpmCmd.Protect}`, `call ${cmd}`);
}

// ---------- verify: each block measured and compared with the digest that was promised for it ----------

const secureVerify: TemplateFn = (rng, p) => {
  const b = new Builder();
  const blocks = p.scale, W = 8, data = Array.from({ length: blocks * W }, () => rng.nextU32());
  const promised: number[] = [];
  let sum = 0;
  for (let i = 0; i < blocks; i++) {
    const digest = wordHash(data.slice(i * W, (i + 1) * W)), tampered = rng.nextInt(4) === 0;
    promised.push(tampered ? (digest ^ 0x5a5a5a5a) >>> 0 : digest);
    if (!tampered) sum = (sum + digest) | 0;
  }
  const dD = b.ns("data"), dP = b.ns("promised");
  const cmd = b.add(tpmCommand(b.ns("tpm")));
  const o = open(b, p, "verify ");
  b.emit("li s1, 0");
  for (let i = 0; i < blocks; i++) {
    const skip = b.ns("skip");
    b.emit(`li a0, ${TpmCmd.Measure}`, `la a1, ${dD}`, `addi a1, a1, ${4 * W * i}`, `li a2, ${W}`, `call ${cmd}`, `la t0, ${dP}`, `lw t1, ${4 * i}(t0)`, `bne a0, t1, ${skip}`, "add s1, s1, a0", `${skip}:`);
  }
  b.emit("mv a0, s1");
  b.addData([...words(dD, data), ...words(dP, promised)]);
  return close(b, p, o, "secure.verify request", sum >>> 0);
};

// ---------- measure: a chain of measurements, as at a measured boot ----------

const secureMeasure: TemplateFn = (rng, p) => {
  const b = new Builder();
  const blocks = 2 * p.scale, W = 8, data = Array.from({ length: blocks * W }, () => rng.nextU32());
  let chain = 5381;
  for (let i = 0; i < blocks; i++) chain = (((chain + (chain << 5)) ^ wordHash(data.slice(i * W, (i + 1) * W))) >>> 0) | 0;
  const dD = b.ns("data");
  const cmd = b.add(tpmCommand(b.ns("tpm")));
  const o = open(b, p, "boot ");
  b.emit("li s1, 5381");
  for (let i = 0; i < blocks; i++) {
    b.emit(`li a0, ${TpmCmd.Measure}`, `la a1, ${dD}`, `addi a1, a1, ${4 * W * i}`, `li a2, ${W}`, `call ${cmd}`, "slli t0, s1, 5", "add t0, s1, t0", "xor s1, t0, a0");
  }
  b.emit("mv a0, s1");
  b.addData(words(dD, data));
  return close(b, p, o, "secure.measure request", chain >>> 0);
};

// ---------- encrypt: a hash inside protected mode, twice ----------

const secureEncrypt: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 16 * p.scale, a = Array.from({ length: n }, () => rng.nextU32()), c = Array.from({ length: n }, () => rng.nextU32());
  const result = (wordHash(a) ^ wordHash(c)) >>> 0;
  const dA = b.ns("a"), dC = b.ns("c");
  const cmd = b.add(tpmCommand(b.ns("tpm")));
  const o = open(b, p, "crypt ");
  protect(b, cmd);
  b.emit(`la a1, ${dA}`, `li a2, ${n}`, `call ${b.add(K.checksum(b.ns("checksum")), 4 * n)}`, "mv s1, a0");
  b.emit(`la a1, ${dC}`, `li a2, ${n}`, `call ${b.add(K.checksum(b.ns("checksum2")), 4 * n)}`, "xor s1, s1, a0");
  b.emit(`li a0, ${TpmCmd.Unprotect}`, "li a1, 0", "li a2, 0", `call ${cmd}`, "mv a0, s1");
  b.addData([...words(dA, a), ...words(dC, c)]);
  return close(b, p, o, "secure.encrypt request", result);
};

// ---------- vault: seal several values, then unseal them all ----------

const secureVault: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 2 * p.scale, vals = Array.from({ length: n }, () => rng.nextU32());
  const cmd = b.add(tpmCommand(b.ns("tpm")));
  const o = open(b, p, "vault ");
  for (let i = 0; i < n; i++) b.emit(`li a0, ${TpmCmd.Seal}`, `li a1, ${p.jobId + 1 + i}`, `li a2, ${vals[i]! >>> 0}`, `call ${cmd}`);
  b.emit("li s1, 0");
  for (let i = 0; i < n; i++) b.emit(`li a0, ${TpmCmd.Unseal}`, `li a1, ${p.jobId + 1 + i}`, "li a2, 0", `call ${cmd}`, "add s1, s1, a0");
  b.emit("mv a0, s1");
  return close(b, p, o, "secure.vault request", vals.reduce((s, v) => (s + v) | 0, 0) >>> 0);
};

// ---------- rotate: unseal, change, seal again, round after round ----------

const secureRotate: TemplateFn = (rng, p) => {
  const b = new Builder();
  const rounds = 2 * p.scale, mul = [3, 5, 7, 9][rng.nextInt(4)]!, add = 1 + rng.nextInt(9), v0 = 2 + rng.nextInt(8), handle = p.jobId + 1;
  let v = v0;
  for (let i = 0; i < rounds; i++) v = (Math.imul(v, mul) + add) | 0;
  const cmd = b.add(tpmCommand(b.ns("tpm")));
  const o = open(b, p, "rotate ");
  b.emit(`li a0, ${TpmCmd.Seal}`, `li a1, ${handle}`, `li a2, ${v0}`, `call ${cmd}`);
  for (let i = 0; i < rounds; i++) {
    b.emit(`li a0, ${TpmCmd.Unseal}`, `li a1, ${handle}`, "li a2, 0", `call ${cmd}`, `li t0, ${mul}`, "mul a2, a0, t0", `addi a2, a2, ${add}`, `li a0, ${TpmCmd.Seal}`, `li a1, ${handle}`, `call ${cmd}`);
  }
  b.emit(`li a0, ${TpmCmd.Unseal}`, `li a1, ${handle}`, "li a2, 0", `call ${cmd}`);
  return close(b, p, o, "secure.rotate request", v >>> 0);
};

// ---------- attest: a burst of quotes ----------

const secureAttest: TemplateFn = (rng, p) => {
  const b = new Builder();
  const quotes = 4 * p.scale, nonce = rng.nextU32();
  const loop = b.ns("loop");
  const cmd = b.add(tpmCommand(b.ns("tpm")));
  const o = open(b, p, "quotes=");
  b.emit(`li s1, ${quotes}`, `${loop}:`, `li a0, ${TpmCmd.Attest}`, `li a1, ${nonce}`, "li a2, 0", `call ${cmd}`, "addi s1, s1, -1", `bne s1, zero, ${loop}`, `li a0, ${quotes}`);
  return close(b, p, o, "secure.attest request", quotes);
};

export const TRUST_TEMPLATES: Record<string, TemplateFn> = {
  "secure.verify": secureVerify,
  "secure.measure": secureMeasure,
  "secure.encrypt": secureEncrypt,
  "secure.vault": secureVault,
  "secure.rotate": secureRotate,
  "secure.attest": secureAttest,
};
