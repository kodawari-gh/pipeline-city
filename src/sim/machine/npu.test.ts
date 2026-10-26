import { describe, expect, it } from "vitest";
import { GPU_HOP_TICKS, GpuFaultCode, GpuStatus, NPU_BASE, NPU_DESC_WORDS, NPU_MEM, NPU_NO_BIAS, NPU_PORTS, NPU_REG, NPU_STRIDE, NpuOp } from "../isa/memmap";
import { Machine } from "./machine";
import { NpuCore, NpuPort } from "./npu";

const R = (r: number) => NPU_BASE + r;

type Desc = [number, number, number];
const D = {
  load: (slot: number, at: number): Desc => [NpuOp.Load, slot, at],
  matmul: (a: number, b: number): Desc => [NpuOp.Matmul, a, b],
  macc: (a: number, b: number): Desc => [NpuOp.Macc, a, b],
  bias: (at: number): Desc => [NpuOp.Bias, 0, at],
  relu: (): Desc => [NpuOp.Relu, 0, 0],
  store: (at: number): Desc => [NpuOp.Store, 0, at],
};

/** A machine with one NPU in npu0 at one card tick per base tick. */
function rig(grid = 4, memBytes = 8192) {
  const m = new Machine({ ramSize: 4096 });
  const port = new NpuPort("npu0", 0);
  m.addDevice(port);
  m.clock.setRate("npu0", { mul: 1, div: 1 });
  port.configure({ grid, memBytes });
  const put = (at: number, words: ArrayLike<number>) => { for (let k = 0; k < words.length; k++) m.bus.store32(NPU_BASE + NPU_MEM + at + 4 * k, words[k]!); };
  const get = (at: number, n: number) => Array.from({ length: n }, (_, k) => m.bus.load32(NPU_BASE + NPU_MEM + at + 4 * k) | 0);
  const status = () => m.bus.load32(R(NPU_REG.STATUS));
  const DESC_AT = 4096;
  /** Write the descriptor list and run it; returns the ticks. */
  const go = (list: Desc[]): number => {
    put(DESC_AT, list.flatMap(([op, a, b]) => [op, a, b, 0]));
    m.bus.store32(R(NPU_REG.DESC), DESC_AT);
    m.bus.store32(R(NPU_REG.COUNT), list.length);
    m.bus.store32(R(NPU_REG.CMD), 1);
    let n = 0;
    while (status() & GpuStatus.Busy) { m.advanceBaseTick(); if (++n > 1_000_000) throw new Error("npu never finished"); }
    return n;
  };
  return { m, port, put, get, status, go };
}

const mat = (rows: number, cols: number, f: (i: number, j: number) => number) => Array.from({ length: rows * cols }, (_, k) => f(Math.floor(k / cols), k % cols));
const mul = (a: number[], b: number[], n: number) => mat(n, n, (i, j) => { let s = 0; for (let k = 0; k < n; k++) s += a[i * n + k]! * b[k * n + j]!; return s; });

describe("NPU Layer command", () => {
  /** Run one n x n layer on a K grid; returns the output, the card cycles and the ticks. */
  function layer(K: number, n: number, bias: number | "none" = 0x900, relu = 1) {
    const { put, get, go, m } = rig(K, 16384);
    const w = mat(n, n, (i, j) => ((i * 5 + j * 3) % 7) - 3), x = mat(n, n, (i, j) => ((i + j * 2) % 5) - 2), bv = Array.from({ length: n }, (_, i) => 3 - i);
    put(0, w);
    put(0x400, x);
    put(0x900, bv);
    put(0xa00, [0x0, 0x400, 0x800, bias === "none" ? NPU_NO_BIAS : bias, n, relu]);
    const ticks = go([[NpuOp.Layer, 0xa00, 0]]);
    const want = mul(w, x, n).map((v, k) => { const r = v + (bias === "none" ? 0 : bv[Math.floor(k / n)]!); return relu === 1 ? Math.max(0, r) : r; });
    return { got: get(0x800, n * n), want, ticks, cycles: m.bus.load32(R(NPU_REG.CYCLES)) };
  }

  it("does a whole dense layer in one descriptor: W X + bias, relu, on a 4x4 and an 8x8 grid", () => {
    for (const K of [4, 8]) {
      const r = layer(K, 8);
      expect(r.got).toEqual(r.want);
      expect(r.want.some((v) => v === 0)).toBe(true); // relu clipped something
    }
  });

  it("no bias and no relu are honoured", () => {
    const a = layer(4, 8, "none", 0);
    expect(a.got).toEqual(a.want);
    expect(a.want.some((v) => v < 0)).toBe(true);
  });

  it("costs what the tile walk would: T x T tiles of T products and an output, so a bigger grid is much cheaper", () => {
    const k4 = layer(4, 8), k8 = layer(8, 8);
    expect(k4.cycles).toBe(4 * (2 * (2 + 12) + (2 + 4)));
    expect(k8.cycles).toBe(1 * (1 * (2 + 24) + (2 + 8)));
    expect(k4.ticks).toBe(2 * GPU_HOP_TICKS + k4.cycles);
    expect(k8.cycles).toBeLessThan(k4.cycles);
    expect(layer(4, 16).cycles).toBe(16 * (4 * 14 + 6)); // 16 x 16 on 4 x 4: sixteen output tiles of four products
  });

  it("faults on a size the grid cannot tile, a block or matrix outside card memory", () => {
    const r = rig(4, 8192);
    r.put(0xa00, [0, 0x400, 0x800, NPU_NO_BIAS, 6, 1]); // 6 is not a multiple of 4
    r.go([[NpuOp.Layer, 0xa00, 0]]);
    expect(r.m.bus.load32(R(NPU_REG.FAULT))).toBe(GpuFaultCode.Kernel);
    r.put(0xa00, [0, 0x400, 0x800, NPU_NO_BIAS, 20, 1]); // bigger than 16
    r.go([[NpuOp.Layer, 0xa00, 0]]);
    expect(r.m.bus.load32(R(NPU_REG.FAULT))).toBe(GpuFaultCode.Kernel);
    r.put(0xa00, [0, 0x400, 8000, NPU_NO_BIAS, 8, 1]); // output past the end of the card
    r.go([[NpuOp.Layer, 0xa00, 0]]);
    expect(r.m.bus.load32(R(NPU_REG.FAULT))).toBe(GpuFaultCode.Kernel);
    r.go([[NpuOp.Layer, 8190, 0]]); // block outside / misaligned
    expect(r.m.bus.load32(R(NPU_REG.FAULT))).toBe(GpuFaultCode.Kernel);
  });
});

describe("NPU on the bus", () => {
  it("reports what it is, at a fixed window per PCIe slot", () => {
    const { m, status } = rig(4, 8192);
    expect(status()).toBe(GpuStatus.Present);
    expect(m.bus.load32(R(NPU_REG.GRID))).toBe(4);
    expect(m.bus.load32(R(NPU_REG.MEM_BYTES))).toBe(8192);
    expect(NPU_PORTS).toEqual(["npu0", "npu1", "npu2", "npu3"]);
    expect(new NpuPort("npu3", 3).base).toBe(NPU_BASE + 3 * NPU_STRIDE);
  });

  it("multiplies a tile pair, adds the bias per row, applies relu and stores the result", () => {
    const { put, get, go } = rig(4);
    const a = mat(4, 4, (i, j) => i - j), b = mat(4, 4, (i, j) => i + 2 * j);
    put(0, a);
    put(64, b);
    put(128, [10, -100, 5, 0]);
    go([D.load(0, 0), D.load(1, 64), D.matmul(0, 1), D.bias(128), D.relu(), D.store(256)]);
    const want = mul(a, b, 4).map((v, k) => Math.max(0, v + [10, -100, 5, 0][Math.floor(k / 4)]!));
    expect(get(256, 16)).toEqual(want);
    expect(want.some((v) => v === 0)).toBe(true); // relu clipped something
  });

  it("macc adds a second product to the accumulator; matmul starts over", () => {
    const { put, get, go } = rig(4);
    const a = mat(4, 4, (i, j) => i + j + 1), b = mat(4, 4, (i, j) => (i === j ? 2 : 0));
    put(0, a);
    put(64, b);
    go([D.load(0, 0), D.load(1, 64), D.matmul(0, 1), D.macc(0, 1), D.store(256), D.matmul(0, 1), D.store(512)]);
    expect(get(256, 16)).toEqual(mul(a, b, 4).map((v) => 2 * v));
    expect(get(512, 16)).toEqual(mul(a, b, 4));
  });

  it("takes the cost model's ticks: setup, fill, rows and drain, plus a PCIe hop each way", () => {
    const K = 4;
    const { go, put } = rig(K);
    put(0, mat(4, 4, () => 1));
    const list = [D.load(0, 0), D.load(1, 0), D.matmul(0, 1), D.bias(0), D.relu(), D.store(256)];
    const cycles = 2 * (1 + K) + (2 + 3 * K) + (1 + K) + 2 + (1 + K);
    expect(go(list)).toBe(2 * GPU_HOP_TICKS + cycles);
  });

  it("a bigger grid does a matrix product in fewer descriptors and fewer ticks, with the same answer", () => {
    const n = 8;
    const a = mat(n, n, (i, j) => ((i * 3 + j) % 7) - 3), b = mat(n, n, (i, j) => ((i + 2 * j) % 5) - 2);
    const want = mul(a, b, n);
    /** C = A x B with K x K tiles: tile-major copies of A, B in card memory, K = grid. */
    const run = (K: number) => {
      const { put, get, go, m } = rig(K, 16384);
      const T = n / K, tw = K * K * 4; // tile bytes
      const A0 = 0, B0 = 2048, C0 = 4096;
      const tile = (mm: number[], bi: number, bj: number) => mat(K, K, (i, j) => mm[(bi * K + i) * n + bj * K + j]!);
      for (let bi = 0; bi < T; bi++) for (let bj = 0; bj < T; bj++) {
        put(A0 + (bi * T + bj) * tw, tile(a, bi, bj));
        put(B0 + (bi * T + bj) * tw, tile(b, bi, bj));
      }
      const list: Desc[] = [];
      for (let bi = 0; bi < T; bi++) for (let bj = 0; bj < T; bj++) {
        for (let bk = 0; bk < T; bk++) list.push(D.load(0, A0 + (bi * T + bk) * tw), D.load(1, B0 + (bk * T + bj) * tw), bk === 0 ? D.matmul(0, 1) : D.macc(0, 1));
        list.push(D.store(C0 + (bi * T + bj) * tw));
      }
      const ticks = go(list);
      const c = mat(n, n, () => 0);
      for (let bi = 0; bi < T; bi++) for (let bj = 0; bj < T; bj++) {
        const t = get(C0 + (bi * T + bj) * tw, K * K);
        for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) c[(bi * K + i) * n + bj * K + j] = t[i * K + j]!;
      }
      void m;
      return { c, ticks, descriptors: list.length };
    };
    const small = run(4), big = run(8);
    expect(small.c).toEqual(want);
    expect(big.c).toEqual(want);
    expect(big.descriptors).toBeLessThan(small.descriptors);
    expect(big.ticks).toBeLessThan(small.ticks);
  });

  it("matches the functional core on the same list (the port only adds time)", () => {
    const { port, put, go } = rig(4);
    put(0, mat(4, 4, (i, j) => i * j));
    put(64, mat(4, 4, (i, j) => i - j));
    const list = [D.load(0, 0), D.load(1, 64), D.matmul(0, 1), D.relu(), D.store(256)];
    go(list);
    const core = new NpuCore({ grid: 4, memBytes: 8192 });
    core.mem.set(port.memory!.subarray(0, 32));
    list.forEach(([op, a, b], k) => { const w = 1024 + k * NPU_DESC_WORDS; core.mem.set([op, a, b, 0], w); });
    const cycles = core.run(4096, list.length);
    expect(Array.from(core.mem.subarray(64, 80))).toEqual(Array.from(port.memory!.subarray(64, 80)));
    expect(cycles).toBe(2 * 5 + 14 + 2 + 5);
  });

  it("flags a bad launch or a bad descriptor instead of hanging", () => {
    const r = rig(4);
    r.m.bus.store32(R(NPU_REG.CMD), 1); // nothing to run
    expect(r.status() & GpuStatus.Error).toBeTruthy();
    expect(r.m.bus.load32(R(NPU_REG.FAULT))).toBe(GpuFaultCode.BadLaunch);
    r.go([[99, 0, 0]]); // unknown op
    expect(r.status()).toBe(GpuStatus.Present | GpuStatus.Error | GpuStatus.Done);
    expect(r.m.bus.load32(R(NPU_REG.FAULT))).toBe(GpuFaultCode.Kernel);
    r.go([D.load(7, 0)]); // no such tile register
    expect(r.m.bus.load32(R(NPU_REG.FAULT))).toBe(GpuFaultCode.Kernel);
    r.go([D.load(0, 8160)]); // a 4 x 4 tile does not fit at the end of 8K
    expect(r.m.bus.load32(R(NPU_REG.FAULT))).toBe(GpuFaultCode.Kernel);
    r.go([D.relu()]); // the card recovers
    expect(r.status()).toBe(GpuStatus.Present | GpuStatus.Done);
    r.m.bus.store32(R(NPU_REG.DESC), 2); // misaligned
    r.m.bus.store32(R(NPU_REG.COUNT), 1);
    r.m.bus.store32(R(NPU_REG.CMD), 1);
    expect(r.m.bus.load32(R(NPU_REG.FAULT))).toBe(GpuFaultCode.BadLaunch);
  });

  it("card memory is volatile; takeActivity follows a run; no card reads as empty", () => {
    const r = rig(4);
    r.put(0, [1, 2, 3]);
    expect(r.port.takeActivity()).toBe(false);
    r.put(4096, [NpuOp.Relu, 0, 0, 0]);
    r.go([D.relu()]);
    expect(r.port.takeActivity()).toBe(true);
    expect(r.port.takeActivity()).toBe(false);
    r.port.reset();
    expect(r.get(0, 3)).toEqual([0, 0, 0]);
    r.port.configure(null);
    expect(r.status()).toBe(0);
  });
});
