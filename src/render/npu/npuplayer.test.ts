import { describe, expect, it } from 'vitest';
import { GpuFaultCode, NpuOp } from '../../sim/isa/memmap';
import { sampleRun, sampleStep, sampleView } from './npusample';
import { liveShow, NpuPlayer, REPLAY_HOP_MS, REPLAY_QUEUE, replayLength, replayShow, replayStepMs } from './npuplayer';

describe('liveShow', () => {
  it('is how far through its hop, or through the descriptor on show, the card is', () => {
    expect(liveShow(sampleView({ phase: 'in', busy: true, wait: 2, span: 8 }), 0).progress).toBeCloseTo(0.75);
    const run = sampleRun();
    const v = sampleView({ phase: 'run', busy: true, run: 1, index: 1, stepWait: 7, stepSpan: 14, count: 3, log: run.slice(0, 2) });
    const s = liveShow(v, 0);
    expect(s.step).toMatchObject({ op: NpuOp.Matmul, progress: 0.5 });
    expect(s.prevAcc).toEqual(run[0]!.acc); // the accumulator before the product is the one the load left
    expect(liveShow(sampleView({ phase: 'run', busy: true, index: 0, run: 1, stepWait: 5, stepSpan: 5, log: run.slice(0, 1) }), 0).prevAcc.every((x) => x === 0)).toBe(true);
    expect(liveShow(sampleView(), 0)).toMatchObject({ step: null, progress: 1, replay: false });
  });
});

describe('replayShow', () => {
  it('walks in, each descriptor in turn, then out; the registers and the tiles follow the launch', () => {
    const steps = sampleRun(), v = sampleView(), at = (t: number) => replayShow(steps, v, t, 0);
    expect(at(10)).toMatchObject({ phase: 'in', index: -1, step: null, replay: true, count: 3 });
    const t0 = REPLAY_HOP_MS, len = steps.map(replayStepMs);
    expect(at(t0 + 10)).toMatchObject({ phase: 'run', index: 0, step: { op: NpuOp.Load } });
    expect(at(t0 + 10).tiles).toEqual([true, false, false, false]);
    const mid = at(t0 + len[0]! + len[1]! / 2);
    expect(mid).toMatchObject({ phase: 'run', index: 1, step: { op: NpuOp.Matmul, progress: 0.5 } });
    expect(mid.cycles).toBe(5 + 7);
    expect(mid.prevAcc).toEqual(steps[0]!.acc);
    expect(mid.acc).toEqual(steps[1]!.acc);
    const end = at(t0 + len.reduce((n, x) => n + x, 0) + 10);
    expect(end).toMatchObject({ phase: 'out', index: 2, done: true, error: false, cycles: 24 });
    expect(end.step!.writes).toEqual([[0x200, 0x240]]);
  });
  it('a launch that faulted ends in its fault', () => {
    const steps = [sampleStep(1, { index: 0, count: 1, op: NpuOp.Load, cost: 0, fault: true })];
    expect(replayLength(steps)).toBe(2 * REPLAY_HOP_MS + replayStepMs(steps[0]!));
    expect(replayShow(steps, sampleView(), replayLength(steps) - 10, 0)).toMatchObject({ phase: 'out', error: true, done: false, fault: GpuFaultCode.Kernel });
  });
  it('knows the size of a layer from the block it writes', () => {
    const steps = [sampleStep(1, { index: 0, count: 1, op: NpuOp.Layer, cost: 300, writes: [[0x800, 0x900]] })];
    expect(replayShow(steps, sampleView(), REPLAY_HOP_MS + 10, 0).step).toMatchObject({ op: NpuOp.Layer, n: 8 });
  });
});

describe('NpuPlayer', () => {
  it('replays nothing at first sight, then each launch that finishes, one after the other', () => {
    const p = new NpuPlayer();
    p.feed(sampleView({ log: sampleRun(1, 1) }));
    p.advance(100);
    expect(p.replaying).toBe(false);
    p.feed(sampleView({ log: [...sampleRun(1, 1), ...sampleRun(2, 4), ...sampleRun(3, 7)], launches: 3 }));
    expect(p.replaying).toBe(false);
    p.advance(10);
    expect(p.replaying).toBe(true);
    expect(p.show(0)).toMatchObject({ phase: 'in', replay: true });
    expect(p.token).toBe('r4');
    p.advance(replayLength(sampleRun()));
    p.advance(10);
    expect(p.token).toBe('r7');
    p.advance(replayLength(sampleRun()));
    expect(p.replaying).toBe(false);
    expect(p.token).toBe('l3');
  });
  it('shows a launch in flight live, does not replay it afterwards, and keeps only the newest few', () => {
    const p = new NpuPlayer();
    p.feed(sampleView());
    p.feed(sampleView({ phase: 'run', busy: true, run: 1, index: 0, stepWait: 3, stepSpan: 5, launches: 1, log: sampleRun(1, 1).slice(0, 1) }));
    p.advance(50);
    expect(p.show(0)).toMatchObject({ replay: false, phase: 'run' });
    p.feed(sampleView({ launches: 1, run: 1, done: true, log: sampleRun(1, 1) }));
    p.advance(50);
    expect(p.replaying).toBe(false);
    p.feed(sampleView({ launches: 9, log: Array.from({ length: 5 }, (_, k) => sampleRun(2 + k, 4 + 3 * k)).flat().slice(-15) }));
    let n = 0;
    while (p.replaying || n === 0) { p.advance(replayLength(sampleRun()) + 1); n++; if (n > 10) break; }
    expect(n).toBeLessThanOrEqual(REPLAY_QUEUE + 1);
    p.feed(undefined);
    expect(p.show(0)).toBeNull();
  });
});
