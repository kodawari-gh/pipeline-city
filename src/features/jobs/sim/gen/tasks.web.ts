// The network jobs: what a client asks of a server over the wire. The wire part (how much arrives and how much goes back, and so which plan is worth
// having) is data in net/specs.ts `jobSizes`; the part the machine runs is a small program for the work the request is about: assembling a response, adding
// up an order, looking a name up, checking a form, searching text, scanning an upload, filtering a video chunk, shrinking an image. Each prints `#NN label value OK`.

import { Builder, BUF_BASE, blankRows, emitStatic, layoutLine, pad2, renderLine, rowAddr, type Seg, type TemplateFn } from "./build";
import * as K from "./kernels";
import { k as defineKernel, type Kernel } from "./kernels";
import { copyBlock } from "./tasks.memory";

const pow2 = (scale: number): number => 2 ** Math.floor(Math.log2(Math.max(1, scale)));

function open(b: Builder, p: { row: number; jobId: number }, label: string) {
  const segs: Seg[] = [`#${pad2(p.jobId)} ${label}`, { dyn: 4 }, " OK"];
  const line = layoutLine(segs);
  b.emit(`li s0, ${rowAddr(p.row)}`);
  emitStatic(b, line, 0);
  return { segs, line };
}

function close(b: Builder, p: { row: number }, o: ReturnType<typeof open>, header: string, value: number) {
  b.emit("andi a1, a0, 1023", `addi a0, s0, ${o.line.fields[0]!.off}`, `call ${b.add(K.printDec(b.ns("print_dec"), 4))}`);
  return b.finish(header, blankRows(p.row) + renderLine(o.segs, [value & 1023]));
}

const words = (label: string, ws: number[]): string[] => [`${label}:`, ...ws.map((w) => `  .word ${w >>> 0}`)];

/** Pack bytes into little-endian words, four to a word. */
function pack(bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) out.push(((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16) | ((bytes[i + 3] ?? 0) << 24)) >>> 0);
  return out;
}

const hash5 = (h: number, w: number): number => (((h + (h << 5)) ^ w) >>> 0) | 0;

// ---------- page: put the response together ----------

const webPage: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 16 * p.scale, body = Array.from({ length: n }, () => rng.nextU32());
  let h = 5381;
  for (const w of body) h = hash5(h, w);
  const data = b.ns("body");
  const o = open(b, p, "page ");
  b.emit(`li a0, ${BUF_BASE}`, `la a1, ${data}`, `li a2, ${n}`, `call ${b.add(copyBlock(b.ns("copy")), 4 * n)}`);
  b.emit(`li a1, ${BUF_BASE}`, `li a2, ${n}`, `call ${b.add(K.checksum(b.ns("checksum")), 4 * n)}`);
  b.addData(words(data, body));
  return close(b, p, o, "web.page request", h);
};

// ---------- api: add up an order ----------

/** The sum of a[i] * b[i] over a2 pairs (a0 = a, a1 = b): the total of an order, price times quantity. */
const dotWords = (ns: string): Kernel => defineKernel("dot_words", ns, ["mem", "mul", "alu", "branch"], 0, [
  "li t0, 0",
  `${ns}_loop:`, "lw t1, 0(a0)", "lw t2, 0(a1)", "mul t1, t1, t2", "add t0, t0, t1", "addi a0, a0, 4", "addi a1, a1, 4", "addi a2, a2, -1", `bne a2, zero, ${ns}_loop`,
  "mv a0, t0", "ret",
]);

const webApi: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 4 * p.scale, price = Array.from({ length: n }, () => 1 + rng.nextInt(99)), qty = Array.from({ length: n }, () => 1 + rng.nextInt(9));
  const total = price.reduce((s, v, i) => s + v * qty[i]!, 0);
  const dA = b.ns("price"), dB = b.ns("qty");
  const o = open(b, p, "api total=");
  b.emit(`la a0, ${dA}`, `la a1, ${dB}`, `li a2, ${n}`, `call ${b.add(dotWords(b.ns("dot")), 8 * n)}`);
  b.addData([...words(dA, price), ...words(dB, qty)]);
  return close(b, p, o, "web.api request", total);
};

// ---------- dns: halve the table until the name is found ----------

/** Look the a3 keys at a2 up in the sorted table of `size` words at a0 by halving; returns the sum of the positions it found them at. Which way each step goes depends on the key. */
const bsearch = (ns: string, size: number): Kernel => defineKernel("bsearch", ns, ["mem", "alu", "branch"], 0, [
  "li a1, 0",
  `${ns}_key:`, "lw t0, 0(a2)", "li t1, 0", `li t2, ${size - 1}`,
  `${ns}_step:`, `blt t2, t1, ${ns}_next`, "add t3, t1, t2", "srli t3, t3, 1", "slli t4, t3, 2", "add t4, t4, a0", "lw t4, 0(t4)",
  `beq t4, t0, ${ns}_found`, `blt t4, t0, ${ns}_right`, "addi t2, t3, -1", `j ${ns}_step`,
  `${ns}_right:`, "addi t1, t3, 1", `j ${ns}_step`,
  `${ns}_found:`, "add a1, a1, t3",
  `${ns}_next:`, "addi a2, a2, 4", "addi a3, a3, -1", `bne a3, zero, ${ns}_key`, "mv a0, a1", "ret",
]);

const webDns: TemplateFn = (rng, p) => {
  const b = new Builder();
  const size = 16 * pow2(p.scale), names = 4 * p.scale;
  const table: number[] = [];
  let v = 10 + rng.nextInt(20);
  for (let i = 0; i < size; i++) { table.push(v); v += 3 + rng.nextInt(40); }
  const keys = Array.from({ length: names }, () => table[rng.nextInt(size)]!);
  let sum = 0;
  for (const key of keys) {
    let lo = 0, hi = size - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (table[mid] === key) { sum += mid; break; } if (table[mid]! < key) lo = mid + 1; else hi = mid - 1; }
  }
  const dT = b.ns("table"), dK = b.ns("keys");
  const o = open(b, p, "dns slot=");
  b.emit(`la a0, ${dT}`, `la a2, ${dK}`, `li a3, ${names}`, `call ${b.add(bsearch(b.ns("lookup"), size), 4 * size)}`);
  b.addData([...words(dT, table), ...words(dK, keys)]);
  return close(b, p, o, "web.dns request", sum);
};

// ---------- form: look at every character ----------

const FORM_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -";

/** Over a1 bytes from a0, the number of digits plus twice the number of capital letters: two range tests per byte with no branch but the loop's. */
const formCheck = (ns: string): Kernel => defineKernel("form_check", ns, ["mem", "alu", "branch"], 0, [
  "li t0, 0", "li t1, 0",
  `${ns}_loop:`, "lbu t2, 0(a0)", "addi t3, t2, -48", "sltiu t3, t3, 10", "add t0, t0, t3", "addi t3, t2, -65", "sltiu t3, t3, 26", "add t1, t1, t3",
  "addi a0, a0, 1", "addi a1, a1, -1", `bne a1, zero, ${ns}_loop`, "slli t1, t1, 1", "add a0, t0, t1", "ret",
]);

const webForm: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 32 * p.scale, text = Array.from({ length: n }, () => FORM_CHARS.charCodeAt(rng.nextInt(FORM_CHARS.length)));
  const digits = text.filter((c) => c >= 48 && c <= 57).length, caps = text.filter((c) => c >= 65 && c <= 90).length;
  const data = b.ns("form");
  const o = open(b, p, "form ok=");
  b.emit(`la a0, ${data}`, `li a1, ${n}`, `call ${b.add(formCheck(b.ns("check")), n)}`);
  b.addData(words(data, pack(text)));
  return close(b, p, o, "web.form request", digits + 2 * caps);
};

// ---------- search: look for a pair of letters ----------

/** Count the places in the a1 bytes at a0 where the byte pair (a2, a3) occurs: two compares per position, the second only when the first matched. */
const pairCount = (ns: string): Kernel => defineKernel("pair_count", ns, ["mem", "alu", "branch"], 0, [
  "li t0, 0",
  `${ns}_loop:`, "lbu t1, 0(a0)", `bne t1, a2, ${ns}_next`, "lbu t1, 1(a0)", `bne t1, a3, ${ns}_next`, "addi t0, t0, 1",
  `${ns}_next:`, "addi a0, a0, 1", "addi a1, a1, -1", `bne a1, zero, ${ns}_loop`, "mv a0, t0", "ret",
]);

const webSearch: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 48 * p.scale, text = Array.from({ length: n + 1 }, () => 97 + rng.nextInt(4));
  const c0 = 97 + rng.nextInt(4), c1 = 97 + rng.nextInt(4);
  let hits = 0;
  for (let i = 0; i < n; i++) if (text[i] === c0 && text[i + 1] === c1) hits++;
  const data = b.ns("text");
  const o = open(b, p, "find=");
  b.emit(`la a0, ${data}`, `li a1, ${n}`, `li a2, ${c0}`, `li a3, ${c1}`, `call ${b.add(pairCount(b.ns("find")), n + 1)}`);
  b.addData(words(data, pack(text)));
  return close(b, p, o, "web.search request", hits);
};

// ---------- upload: scan what arrived for a signature ----------

/** Count the a1 words at a0 whose bits under the mask a2 equal a3: one load, one and, one compare for each. */
const sigScan = (ns: string): Kernel => defineKernel("sig_scan", ns, ["mem", "alu", "branch"], 0, [
  "li t0, 0",
  `${ns}_loop:`, "lw t1, 0(a0)", "and t1, t1, a2", `bne t1, a3, ${ns}_next`, "addi t0, t0, 1",
  `${ns}_next:`, "addi a0, a0, 4", "addi a1, a1, -1", `bne a1, zero, ${ns}_loop`, "mv a0, t0", "ret",
]);

const webUpload: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 32 * p.scale, file = Array.from({ length: n }, () => rng.nextU32()), mask = 7, sig = rng.nextInt(8);
  const hits = file.filter((w) => (w & mask) === sig).length;
  const data = b.ns("file");
  const o = open(b, p, "scan=");
  b.emit(`la a0, ${data}`, `li a1, ${n}`, `li a2, ${mask}`, `li a3, ${sig}`, `call ${b.add(sigScan(b.ns("scan")), 4 * n)}`);
  b.addData(words(data, file));
  return close(b, p, o, "web.upload request", hits);
};

// ---------- video: filter every sample of a chunk ----------

/** The sum over a1 words from a0 of (3 * w + 1) / 2: a multiply, an add and a shift for every sample. */
const mapSum = (ns: string): Kernel => defineKernel("map_sum", ns, ["mem", "mul", "alu", "branch"], 0, [
  "li t0, 0", "li t3, 3",
  `${ns}_loop:`, "lw t1, 0(a0)", "mul t1, t1, t3", "addi t1, t1, 1", "srli t1, t1, 1", "add t0, t0, t1", "addi a0, a0, 4", "addi a1, a1, -1", `bne a1, zero, ${ns}_loop`,
  "mv a0, t0", "ret",
]);

const webVideo: TemplateFn = (rng, p) => {
  const b = new Builder();
  const n = 48 * p.scale, chunk = Array.from({ length: n }, () => rng.nextInt(4096));
  const sum = chunk.reduce((s, w) => s + ((Math.imul(w, 3) + 1) >>> 1), 0);
  const data = b.ns("chunk");
  const o = open(b, p, "video ");
  b.emit(`la a0, ${data}`, `li a1, ${n}`, `call ${b.add(mapSum(b.ns("filter")), 4 * n)}`);
  b.addData(words(data, chunk));
  return close(b, p, o, "web.video request", sum);
};

// ---------- image: shrink by averaging 2 x 2 ----------

/** Shrink the a1 x a1 byte image at a0 to half the size, averaging each 2 x 2 block, and return the sum of the new pixels. Byte loads, adds and a shift. */
const downsample = (ns: string): Kernel => defineKernel("downsample", ns, ["mem", "alu", "branch"], 0, [
  "srli t0, a1, 1", "li a3, 0",
  `${ns}_row:`, "add t2, a0, a1", "mv t3, a0",
  `${ns}_col:`, "lbu a2, 0(t3)", "lbu t4, 1(t3)", "add a2, a2, t4", "add t1, t3, a1", "lbu t4, 0(t1)", "add a2, a2, t4", "lbu t4, 1(t1)", "add a2, a2, t4",
  "srli a2, a2, 2", "add a3, a3, a2", "addi t3, t3, 2", `bne t3, t2, ${ns}_col`,
  "slli t1, a1, 1", "add a0, a0, t1", "addi t0, t0, -1", `bne t0, zero, ${ns}_row`, "mv a0, a3", "ret",
]);

const webImage: TemplateFn = (rng, p) => {
  const b = new Builder();
  const w = 8 * pow2(p.scale), px = Array.from({ length: w * w }, () => rng.nextInt(256));
  let sum = 0;
  for (let r = 0; r < w; r += 2) for (let c = 0; c < w; c += 2) sum += (px[r * w + c]! + px[r * w + c + 1]! + px[(r + 1) * w + c]! + px[(r + 1) * w + c + 1]!) >> 2;
  const data = b.ns("image");
  const o = open(b, p, "image ");
  b.emit(`la a0, ${data}`, `li a1, ${w}`, `call ${b.add(downsample(b.ns("down")), w * w)}`);
  b.addData(words(data, pack(px)));
  return close(b, p, o, "web.image request", sum);
};

export const WEB_TEMPLATES: Record<string, TemplateFn> = {
  "web.page": webPage,
  "web.api": webApi,
  "web.dns": webDns,
  "web.form": webForm,
  "web.search": webSearch,
  "web.upload": webUpload,
  "web.video": webVideo,
  "web.image": webImage,
};
