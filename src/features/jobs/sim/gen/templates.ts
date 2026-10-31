// Scenario templates: kernels + seeded parameters -> one assembly program.
//
// A template is `(rng, params) => Built`. Milestone 1 has the "CLI request" family (log / calc / checksum / scan,
// plus "cli" which picks a family from the seed). To add a scenario (web request, GPU render, secure execution, ...):
// write a TemplateFn, add it to TEMPLATES below, and document it in docs/GEN.md. Nothing else needs to change.

import { assembleGpu } from "@/features/gpu/sim/isa/asm";
import { Prng } from "@/core/sim/prng";
import { DISPLAY_COLS, DISPLAY_ROWS, GPU_MEM, GPU_REG, NPU_MEM, NPU_REG, TpmCmd } from "@/core/sim/memmap";
import * as K from "./kernels";
import {
  cpuLayer, GPU_NET_LAYOUT, gpuLayerCode, M as NET_M, makeNetwork, networkChecksum, NPU_LAYOUT, npuBytes, npuProgram,
} from "@/features/npu/sim/kernels";
import {
  copyWords, roundUp16, cpuKernel, GPU_KERNEL_NAMES, GPU_TASK_KERNELS, CPU_PARAM, framesOf, frameParams, PICTURE_LEN, type GpuKernelName, tpmCommand, gpuKernelExpected, gpuKernelSource, KERNEL_LAYOUT, outputChecksum, type GpuKernelParams,
} from "@/features/gpu/sim/kernels";
import { EVERYDAY_TEMPLATES } from "./tasks.everyday";
import { HPC_TEMPLATES } from "./tasks.hpc";
import { MEMORY_TEMPLATES } from "./tasks.memory";
import { TRUST_TEMPLATES } from "./tasks.trust";
import { WEB_TEMPLATES } from "./tasks.web";

import {
  BUF_BASE, BUF_LIMIT, Builder, MAX_CODE_BYTES, blankRows, emitStatic, layoutLine, pad2, renderLine, rowAddr,
  type Built, type GenParams, type GpuTarget, type NpuTarget, type ResolvedParams, type Seg, type TemplateFn,
} from "./build";

export { BUF_BASE, MAX_CODE_BYTES };
export type { Built, GenParams, GpuTarget, NpuTarget, ResolvedParams, TemplateFn };

// ---------- CLI request family ----------

const LOG_MESSAGES = ["user login", "disk sync", "cache warm", "mail queued", "backup done", "config reload", "index built", "queue drained"];

/** Log line request: wait for the display to be idle, then write status lines (one per unit of scale). */
const cliLog: TemplateFn = (rng, p) => {
  if (p.row + p.scale > DISPLAY_ROWS) throw new RangeError("scale does not fit on the display");
  const b = new Builder();
  const first = rng.nextInt(LOG_MESSAGES.length);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  b.emit(`call ${b.add(K.pollIdle(b.ns("poll_idle")))}`);
  const lines: string[] = [];
  for (let i = 0; i < p.scale; i++) {
    const msg = LOG_MESSAGES[(first + i) % LOG_MESSAGES.length]!;
    const text = `#${pad2(p.jobId)} ${msg} OK`;
    lines.push(text);
    emitStatic(b, layoutLine([text]), i * DISPLAY_COLS);
  }
  return b.finish("cli.log request", blankRows(p.row) + lines.join("\n"));
};

/** Compute request: a few rounds of x = x*m + a, shown as a two-digit result (low 6 bits). */
const cliCalc: TemplateFn = (rng, p) => {
  const b = new Builder();
  const x = 2 + rng.nextInt(8);
  const mulBy = [3, 5, 7, 9, 11][rng.nextInt(5)]!;
  const addBy = 1 + rng.nextInt(9);
  const rounds = (1 + rng.nextInt(2)) * p.scale;
  let v = x;
  for (let i = 0; i < rounds; i++) v = (Math.imul(v, mulBy) + addBy) | 0;
  const result = v & 63;
  const segs: Seg[] = [`#${pad2(p.jobId)} mul=`, { dyn: 2 }, " OK"];
  const line = layoutLine(segs);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  b.emit(`li a0, ${x}`, `li a1, ${rounds}`, `call ${b.add(K.mulLoop(b.ns("mul_loop"), mulBy, addBy))}`, "andi a1, a0, 63");
  b.emit(`addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 2))}`);
  return b.finish("cli.calc request", blankRows(p.row) + renderLine(segs, [result]));
};

/** Tiny checksum job: hash `scale` data words embedded in the program, show the low 6 bits. */
const cliChecksum: TemplateFn = (rng, p) => {
  const b = new Builder();
  const words = p.scale;
  const vals: number[] = [];
  let h = 5381;
  for (let i = 0; i < words; i++) {
    const w = rng.nextU32();
    vals.push(w);
    h = (((h + (h << 5)) ^ w) >>> 0) | 0;
  }
  const result = h & 63;
  const segs: Seg[] = [`#${pad2(p.jobId)} sum=`, { dyn: 2 }, " OK"];
  const line = layoutLine(segs);
  const data = b.ns("data");
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  b.emit(`la a1, ${data}`, `li a2, ${words}`, `call ${b.add(K.checksum(b.ns("checksum")), 4 * words)}`, "andi a1, a0, 63");
  b.emit(`addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 2))}`);
  b.addData([`${data}:`, ...vals.map((w) => `  .word ${w}`)]);
  return b.finish("cli.checksum request", blankRows(p.row) + renderLine(segs, [result]));
};

/**
 * Scan job (heavier than the others, not part of the "cli" family; the economy mixes it in): fill a RAM table then sum it.
 * The stride is seeded, 64 B or 128 B: both are cache-hostile (every load of the sum loop misses the default 128 B
 * direct-mapped cache), so scan time is dominated by RAM latency, which is what makes RAM worth buying.
 */
const cliScan: TemplateFn = (rng, p) => {
  const b = new Builder();
  const stride = [64, 128][rng.nextInt(2)]!;
  const count = 4 * p.scale;
  const start = 1 + rng.nextInt(9);
  if (BUF_BASE + count * stride > BUF_LIMIT) throw new RangeError("scale too large for scan");
  let sum = 0;
  for (let i = 0; i < count; i++) sum += start + 3 * i;
  const result = sum & 1023;
  const segs: Seg[] = [`#${pad2(p.jobId)} scan ${count}x${stride}B `, { dyn: 4 }, " OK"];
  const line = layoutLine(segs);
  const region = count * stride;
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  b.emit(`li s1, ${BUF_BASE}`, "mv a0, s1", `li a1, ${count}`, `li a2, ${start}`, `call ${b.add(K.fillStride(b.ns("fill"), stride), region)}`);
  b.emit("mv a0, s1", `li a1, ${count}`, `call ${b.add(K.arraySum(b.ns("array_sum"), stride), region)}`, "andi a1, a0, 1023");
  b.emit(`addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 4))}`);
  return b.finish("cli.scan request", blankRows(p.row) + renderLine(segs, [result]));
};

/** Where a program keeps its big working memory: virtual 0x10000 up under the paged OSes (their "big heap"), the same physical addresses without one. */
export const HEAP_BASE = 0x10000;
/** The bytes the in-memory index job needs at a scale (a power of two, so the probes can mask): 32K, 64K, 128K, 256K, 512K for scale 1, 2-3, 4-7, 8-15, 16. */
export const indexBytes = (scale: number): number => 32 * 1024 * 2 ** Math.floor(Math.log2(Math.max(1, scale)));

/**
 * In-memory index (the database class, docs/JOBS.md): build a table of `indexBytes(scale)` bytes, one 256-byte record per page, then answer lookups that scatter over
 * all of it. It lives or dies by memory: the table has to fit in RAM, claiming it costs a page fault per page under a paged OS, and the scattered reads
 * are row conflicts and TLB misses.
 */
const dbIndex: TemplateFn = (rng, p) => {
  const b = new Builder();
  const bytes = indexBytes(p.scale), lines = bytes / 256, probes = lines / 2;
  const mult = 2 * rng.nextInt(2000) + 40503; // odd
  let sum = 0;
  for (let j = 0; j < probes; j++) sum = (sum + (((Math.imul(j, mult) & (lines - 1)) * 7 + 3) | 0)) | 0;
  const result = sum & 1023;
  const segs: Seg[] = [`#${pad2(p.jobId)} index ${Math.round(bytes / 1024)}K `, { dyn: 4 }, " OK"];
  const line = layoutLine(segs);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  b.emit(`li a0, ${HEAP_BASE}`, `li a1, ${lines}`, `call ${b.add(K.indexFill(b.ns("fill")), bytes)}`);
  b.emit(`li a0, ${HEAP_BASE}`, `li a1, ${lines}`, `li a2, ${probes}`, `li a3, ${mult}`, `call ${b.add(K.indexProbe(b.ns("probe")), bytes)}`, "andi a1, a0, 1023");
  b.emit(`addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 4))}`);
  return b.finish("db.index request", blankRows(p.row) + renderLine(segs, [result]));
};

/**
 * GPU picture job (docs/ACCEL.md "Job classes"): one of the kernels vadd (brightness), saxpy (contrast), blur3, mandel over a 64 x 40 picture, a few frames of
 * it, printing the sum of the last picture. With a card the CPU copies the kernel into card memory, then per frame writes the frame's two parameter words,
 * launches and polls; without one it runs the same work in a loop on the CPU. Both print the same line (the seed alone picks the answer, never the hardware).
 */
const gpuRender: TemplateFn = (rng, p) => gpuJob(rng, p, GPU_KERNEL_NAMES[rng.nextInt(GPU_KERNEL_NAMES.length)]!, "gpu.render request");

/** The GPU job for one named kernel (the mixed job above picks it from the seed; the single-kernel jobs `gpu.<kernel>` fix it). */
function gpuJob(rng: Prng, p: ResolvedParams, name: GpuKernelName, header: string): Built {
  const b = new Builder();
  const { len, kp, frames } = gpuPlan(rng, p.scale, name);
  const expected = outputChecksum(gpuKernelExpected(name, { ...kp, ...frames[frames.length - 1]! }));
  const segs: Seg[] = [`#${pad2(p.jobId)} ${name} `, { dyn: 2 }, " OK"];
  const line = layoutLine(segs);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  const gpu = p.gpu;
  const L = KERNEL_LAYOUT;
  const onCard = gpu && len % gpu.lanes === 0 && gpu.lanes <= 32 && gpu.memBytes >= L.out + 4 * len + 4;
  const setParams = (base: number, f: { phase: number; level: number }) => [`li t0, ${base}`, `li t1, ${f.phase}`, "sw t1, 0(t0)", `li t1, ${f.level}`, "sw t1, 4(t0)"];
  let sumAt: number;
  if (onCard) {
    const code = assembleGpu(gpuKernelSource(name, { ...kp, lanes: gpu.lanes })).program;
    if (code.length * 4 > L.param - 4) throw new RangeError("gpu kernel too large");
    const kData = b.ns("kernel");
    const win = gpu.base + GPU_MEM;
    const copy = b.add(copyWords(b.ns("copy")), 0);
    b.emit(`li a0, ${win + L.code}`, `la a1, ${kData}`, `li a2, ${roundUp16(code.length * 4)}`, `call ${copy}`);
    frames.forEach((f, k) => {
      const poll = b.ns(`poll${k}`);
      b.emit(...setParams(win + L.param, f));
      b.emit(`li t0, ${gpu.base}`, `sw zero, ${GPU_REG.KERNEL}(t0)`, `sw zero, ${GPU_REG.LANES}(t0)`, "li t1, 1", `sw t1, ${GPU_REG.CMD}(t0)`);
      b.emit(`${poll}:`, `lw t1, ${GPU_REG.STATUS}(t0)`, "andi t1, t1, 1", `bne t1, zero, ${poll}`);
    });
    sumAt = win + L.out;
    b.addData([`${kData}:`, ...Array.from(code, (w) => `  .word ${w}`)]);
  } else {
    const kern = b.add(cpuKernel(name, b.ns("cpu"), kp), 4 * len);
    sumAt = BUF_BASE;
    for (const f of frames) b.emit(...setParams(CPU_PARAM, f), `li a0, ${BUF_BASE}`, `call ${kern}`);
  }
  b.emit(`li a0, ${sumAt}`, `li a1, ${len}`, `call ${b.add(K.arraySum(b.ns("array_sum"), 4), 4 * len)}`, "andi a1, a0, 63");
  b.emit(`addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 2))}`);
  return b.finish(header, blankRows(p.row) + renderLine(segs, [expected]));
}

/** What the seed decides about a GPU job: where its scene starts and the frames (phase and level of each). The program is built from it and the almanac draws the frames (`gpuPicture`). */
function gpuPlan(rng: Prng, jobScale: number, name: GpuKernelName) {
  const phase0 = rng.nextInt(64);
  const n = framesOf(jobScale);
  const frames = Array.from({ length: n }, (_, k) => frameParams(name, phase0, k, n));
  const kp: GpuKernelParams = { lanes: 1, len: PICTURE_LEN }; // results do not depend on the lane count
  return { len: PICTURE_LEN, kp, frames };
}

/** The pictures a GPU job leaves in the card's output region for a seed, frame by frame (what a display on the card shows): the almanac's preview of the job. */
export function gpuPicture(template: string, seed: number, jobScale: number): number[][] | null {
  const name = GPU_TASK_KERNELS.find((k) => template === `gpu.${k}`);
  if (!name) return null;
  const rng = new Prng(seed);
  rng.nextInt(100); // the job number, as `generate` draws it first
  const { kp, frames } = gpuPlan(rng, jobScale, name);
  return frames.map((f) => gpuKernelExpected(name, { ...kp, ...f }));
}

/**
 * Signed transaction (docs/ACCEL.md "Job classes"): measure the job's own data with the TPM, attest the measurement, hash the data
 * in protected mode (RAM outside the program is off limits and every access pays the encryption surcharge), seal the digest, unseal
 * it and print its low 6 bits. Needs a TPM; the reference interpreter runs it against an instant fake.
 */
const secureSign: TemplateFn = (rng, p) => {
  const b = new Builder();
  const words = 4 * p.scale;
  const vals: number[] = [];
  let h = 5381;
  for (let i = 0; i < words; i++) {
    const w = rng.nextU32();
    vals.push(w);
    h = (((h + (h << 5)) ^ w) >>> 0) | 0;
  }
  const segs: Seg[] = [`#${pad2(p.jobId)} secure `, { dyn: 2 }, " OK"];
  const line = layoutLine(segs);
  const data = b.ns("data");
  const cmd = b.add(tpmCommand(b.ns("tpm")));
  const hash = b.add(K.checksum(b.ns("checksum")), 4 * words);
  const handle = p.jobId + 1;
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  b.emit(`li a0, ${TpmCmd.Measure}`, `la a1, ${data}`, `li a2, ${words}`, `call ${cmd}`, "mv s1, a0"); // the measurement
  b.emit(`li a0, ${TpmCmd.Attest}`, "mv a1, s1", "li a2, 0", `call ${cmd}`); // a quote binding it (not shown: it depends on the machine)
  // Protect everything from the program's own start (0x1000 hosted, 0 standalone) up to the scratch buffer.
  b.emit("la a1, main", `li a2, ${BUF_BASE}`, "sub a2, a2, a1", "srli a2, a2, 2", `li a0, ${TpmCmd.Protect}`, `call ${cmd}`);
  b.emit(`la a1, ${data}`, `li a2, ${words}`, `call ${hash}`, "mv s2, a0"); // the digest, in protected mode
  b.emit(`li a0, ${TpmCmd.Unprotect}`, "li a1, 0", "li a2, 0", `call ${cmd}`);
  b.emit(`li a0, ${TpmCmd.Seal}`, `li a1, ${handle}`, "mv a2, s2", `call ${cmd}`);
  b.emit(`li a0, ${TpmCmd.Unseal}`, `li a1, ${handle}`, "li a2, 0", `call ${cmd}`, "andi a1, a0, 63");
  b.emit(`addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 2))}`);
  b.addData([`${data}:`, ...vals.map((w) => `  .word ${w}`)]);
  return b.finish("secure.sign request", blankRows(p.row) + renderLine(segs, [h & 63]));
};

/**
 * Inference job (docs/ACCEL.md "Job classes"): a few dense layers, X <- relu(W X + b), over an 8 x 8 batch with seeded weights, printing the
 * sum of the final activations. The fallback chain is the NPU (descriptors in card memory), then a GPU (one kernel launch per layer),
 * then the CPU (a loop per layer): the same line and the same pay on every path, and the speed gap down the chain is what a card sells.
 */
const npuInfer: TemplateFn = (rng, p) => npuJob(rng, p, Math.min(6, 1 + p.scale), "npu.infer request");

/** The inference job for a given depth (the jobs `npu.perceptron`, `npu.infer` and `npu.deep` differ only in how many layers they run). */
function npuJob(rng: Prng, p: ResolvedParams, layers: number, header: string): Built {
  const b = new Builder();
  const net = makeNetwork(rng, layers);
  const segs: Seg[] = [`#${pad2(p.jobId)} ${header.replace(/^npu\./, "").replace(/ request$/, "")} `, { dyn: 2 }, " OK"];
  const line = layoutLine(segs);
  const flat = (rows: number[][]) => rows.flat();
  const dX = b.ns("x"), dW = b.ns("w"), dB = b.ns("b");
  const words = (label: string, ws: number[]) => b.addData([`${label}:`, ...ws.map((w) => `  .word ${w}`)]);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  const npu = p.npu, gpu = p.gpu;
  const useNpu = !!npu && NET_M % npu.grid === 0 && npu.memBytes >= npuBytes(net);
  const useGpu = !useNpu && !!gpu && (NET_M * NET_M) % gpu.lanes === 0 && gpu.lanes <= 32 && gpu.memBytes >= GPU_NET_LAYOUT.b + layers * NET_M * 4;
  const copy = useNpu || useGpu ? b.add(copyWords(b.ns("copy"))) : "";
  const poll = (reg: number, base: number, name: string) => {
    b.emit(`${name}:`, `lw t1, ${reg}(t0)`, "andi t1, t1, 1", `bne t1, zero, ${name}`);
    void base;
  };
  let sumAt: number;
  if (useNpu) {
    const win = npu.base + NPU_MEM;
    const d = npuProgram(net), dD = b.ns("desc");
    b.emit(`li a0, ${win + NPU_LAYOUT.x[0]}`, `la a1, ${dX}`, `li a2, ${NET_M * NET_M * 4}`, `call ${copy}`);
    b.emit(`li a0, ${win + NPU_LAYOUT.w}`, `la a1, ${dW}`, `li a2, ${layers * NET_M * NET_M * 4}`, `call ${copy}`);
    b.emit(`li a0, ${win + NPU_LAYOUT.b}`, `la a1, ${dB}`, `li a2, ${layers * NET_M * 4}`, `call ${copy}`);
    b.emit(`li a0, ${win + NPU_LAYOUT.desc}`, `la a1, ${dD}`, `li a2, ${roundUp16(d.words.length * 4)}`, `call ${copy}`);
    b.emit(`li t0, ${npu.base}`, `li t1, ${NPU_LAYOUT.desc}`, `sw t1, ${NPU_REG.DESC}(t0)`, `li t1, ${d.count}`, `sw t1, ${NPU_REG.COUNT}(t0)`, "li t1, 1", `sw t1, ${NPU_REG.CMD}(t0)`);
    poll(NPU_REG.STATUS, npu.base, b.ns("poll"));
    sumAt = win + d.finalAt;
    words(dX, net.x0);
    words(dW, flat(net.w));
    words(dB, flat(net.b));
    words(dD, d.words);
  } else if (useGpu) {
    const win = gpu.base + GPU_MEM, L = GPU_NET_LAYOUT, code = gpuLayerCode(gpu.lanes), dK = b.ns("kernel");
    b.emit(`li a0, ${win}`, `la a1, ${dK}`, `li a2, ${roundUp16(code.length * 4)}`, `call ${copy}`);
    b.emit(`li a0, ${win + L.x[0]}`, `la a1, ${dX}`, `li a2, ${NET_M * NET_M * 4}`, `call ${copy}`);
    b.emit(`li a0, ${win + L.w}`, `la a1, ${dW}`, `li a2, ${layers * NET_M * NET_M * 4}`, `call ${copy}`);
    b.emit(`li a0, ${win + L.b}`, `la a1, ${dB}`, `li a2, ${layers * NET_M * 4}`, `call ${copy}`);
    for (let l = 0; l < layers; l++) {
      const args = [L.w + l * NET_M * NET_M * 4, L.x[l % 2]!, L.x[(l + 1) % 2]!, L.b + l * NET_M * 4];
      b.emit(`li t0, ${win}`);
      args.forEach((v, k) => b.emit(`li t1, ${v}`, `sw t1, ${L.args + 4 * k}(t0)`));
      b.emit(`li t0, ${gpu.base}`, `sw zero, ${GPU_REG.KERNEL}(t0)`, `sw zero, ${GPU_REG.LANES}(t0)`, "li t1, 1", `sw t1, ${GPU_REG.CMD}(t0)`);
      poll(GPU_REG.STATUS, gpu.base, b.ns("poll"));
    }
    sumAt = win + L.x[layers % 2]!;
    b.addData([`${dK}:`, ...Array.from(code, (w) => `  .word ${w}`)]);
    words(dX, net.x0);
    words(dW, flat(net.w));
    words(dB, flat(net.b));
  } else {
    const layer = b.add(cpuLayer(b.ns("layer")), 3 * 256);
    const buf = [BUF_BASE, BUF_BASE + 256];
    for (let l = 0; l < layers; l++) {
      b.emit(`la a0, ${dW}`, `addi a0, a0, ${l * NET_M * NET_M * 4}`);
      if (l === 0) b.emit(`la a1, ${dX}`);
      else b.emit(`li a1, ${buf[(l - 1) % 2]}`);
      b.emit(`li a2, ${buf[l % 2]}`, `la a3, ${dB}`, `addi a3, a3, ${l * NET_M * 4}`, `call ${layer}`);
    }
    sumAt = buf[(layers - 1) % 2]!;
    words(dX, net.x0);
    words(dW, flat(net.w));
    words(dB, flat(net.b));
  }
  b.emit(`li a0, ${sumAt}`, `li a1, ${NET_M * NET_M}`, `call ${b.add(K.arraySum(b.ns("array_sum"), 4), 4 * NET_M * NET_M)}`, "andi a1, a0, 63");
  b.emit(`addi a0, s0, ${line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 2))}`);
  return b.finish(header, blankRows(p.row) + renderLine(segs, [networkChecksum(net)]));
}

const CLI_FAMILIES = [cliLog, cliCalc, cliChecksum];

/** Default CLI request: family picked from the seed. */
const cli: TemplateFn = (rng, p) => CLI_FAMILIES[rng.nextInt(CLI_FAMILIES.length)]!(rng, p);

/** Template registry. Add new scenarios here. */
export const TEMPLATES: Record<string, TemplateFn> = {
  cli,
  "cli.log": cliLog,
  "cli.calc": cliCalc,
  "cli.checksum": cliChecksum,
  "cli.scan": cliScan,
  "db.index": dbIndex,
  "gpu.render": gpuRender,
  "secure.sign": secureSign,
  "npu.infer": npuInfer,
  ...EVERYDAY_TEMPLATES,
  ...MEMORY_TEMPLATES,
  ...WEB_TEMPLATES,
  ...HPC_TEMPLATES,
  ...TRUST_TEMPLATES,
  // The accelerator jobs, one per kernel and one per depth of network (docs/JOBS.md).
  ...Object.fromEntries(GPU_TASK_KERNELS.map((k) => [`gpu.${k}`, ((rng, p) => gpuJob(rng, p, k, `gpu.${k} request`)) as TemplateFn])),
  "npu.perceptron": (rng, p) => npuJob(rng, p, Math.min(2, p.scale), "npu.perceptron request"),
  "npu.deep": (rng, p) => npuJob(rng, p, Math.min(6, 1 + 2 * p.scale), "npu.deep request"),
  // Later: "web", "gpu.render", "secure" (see docs/GEN.md "Adding a template").
};
