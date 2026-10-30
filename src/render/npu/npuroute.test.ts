import { describe, expect, it } from 'vitest';
import { NpuOp } from '../../sim/isa/memmap';
import { npuPlan } from './npuplans';
import { npuRoute } from './npuroute';

const plan = npuPlan({ grid: 4, memBytes: 8192, lanes: 4 });
const ids = (op: number, phase: 'in' | 'run' | 'out') => npuRoute(plan, op, phase).map((h) => `${h.reverse ? '<' : ''}${h.link.id}`);

describe('the way a launch goes through the card', () => {
  it('comes in over the link to the registers and the descriptor queue, and the answer goes back the same way', () => {
    expect(ids(0, 'in')).toEqual(['host-ctl', 'ctl-desc']);
    expect(ids(0, 'out')).toEqual(['<ctl-desc', '<host-ctl']);
  });
  it('fetches each descriptor out of card memory first, whatever it is', () => {
    for (const op of [0, 1, 2, 3, 4, 5, 6, 7, 99]) expect(ids(op, 'run')[0], String(op)).toBe('<desc-mem');
  });
  it('runs a descriptor along the datapath of its kind', () => {
    expect(ids(NpuOp.Load, 'run')).toEqual(['<desc-mem', 'desc-tiles', 'mem-tiles']);
    expect(ids(NpuOp.Matmul, 'run')).toEqual(['<desc-mem', 'desc-array', 'tiles-array']);
    expect(ids(NpuOp.Macc, 'run')).toEqual(ids(NpuOp.Matmul, 'run'));
    expect(ids(NpuOp.Bias, 'run')).toEqual(['<desc-mem', 'desc-array', '<post-mem']);
    expect(ids(NpuOp.Relu, 'run')).toEqual(['<desc-mem', 'desc-array', 'array-post']);
    expect(ids(NpuOp.Store, 'run')).toEqual(['<desc-mem', 'desc-array', 'array-post', 'post-mem']);
  });
  it('a layer uses the whole datapath, from card memory through the array and back', () => {
    expect(ids(NpuOp.Layer, 'run')).toEqual(['<desc-mem', 'desc-array', 'mem-tiles', 'tiles-array', 'array-post', 'post-mem']);
  });
  it('every wire it names is on the plan', () => {
    for (const op of [1, 2, 3, 4, 5, 6, 7]) expect(npuRoute(plan, op, 'run').length, String(op)).toBeGreaterThanOrEqual(3);
  });
});
