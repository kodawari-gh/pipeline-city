// Sample snapshots of an AI card for the tests of the card view and its words (not used by the game).
import { NpuOp } from '../../sim/isa/memmap';
import type { NpuSnap } from '../../sim/game/types';
import type { NpuStep } from '../../sim/machine/npu';

/** A 4 x 4 card's view; override what a test needs. */
export const sampleView = (o: Partial<NpuSnap> = {}): NpuSnap => ({
  slot: 'pcie1', phase: 'idle', busy: false, error: false, done: false, fault: 0, grid: 4, memBytes: 8192, descAt: 0x1000, count: 0, cycles: 0, wait: 0, span: 0,
  run: 0, index: -1, stepWait: 0, stepSpan: 0, list: [], fill: new Array<number>(128).fill(0), hostWrites: 0, hostReads: 0, lastWrite: -1, lastRead: -1, tiles: [false, false, false, false], acc: new Array<number>(16).fill(0), launches: 0, descriptors: 0, log: [], ...o,
});

/** One logged step of launch `run`; override what a test needs. */
export const sampleStep = (seq: number, o: Partial<NpuStep> = {}): NpuStep => ({
  seq, run: 1, index: seq - 1, count: 3, op: NpuOp.Matmul, a: 0, b: 1, cost: 14, fault: false, reads: [], writes: [], acc: Array.from({ length: 16 }, (_, k) => k), ...o,
});

/** A launch of load, matmul, store as the card logs it. */
export const sampleRun = (run = 1, first = 1): NpuStep[] => [
  sampleStep(first, { run, index: 0, op: NpuOp.Load, a: 0, b: 0, cost: 5, reads: [[0, 64]], acc: new Array<number>(16).fill(0) }),
  sampleStep(first + 1, { run, index: 1, op: NpuOp.Matmul, a: 0, b: 1, cost: 14, acc: Array.from({ length: 16 }, (_, k) => k - 5) }),
  sampleStep(first + 2, { run, index: 2, op: NpuOp.Store, a: 0, b: 0x200, cost: 5, writes: [[0x200, 0x240]], acc: Array.from({ length: 16 }, (_, k) => k - 5) }),
];
