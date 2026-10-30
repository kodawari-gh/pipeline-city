import { describe, expect, it } from 'vitest';
import { specsOfKind } from '../../sim/board/specs';
import { NpuOp } from '../../sim/isa/memmap';
import { npuIds } from '../../render/board/npulayout';
import { sampleRun, sampleView } from '../../render/npu/npusample';
import { describeId } from '../logic';
import { dev, snap } from '../testdata';
import { isNpuId } from './npudesc';

describe('the words for the AI card', () => {
  it('describes every part the board writes, with the card on and off', () => {
    for (const spec of specsOfKind('npu')) {
      const K = spec.npu!.grid, run = sampleRun();
      const s = snap({
        devices: [dev({ id: 'n1', spec: spec.id, kind: 'npu', slot: 'pcie1', tempC: 41 })],
        npus: [sampleView({ grid: K, memBytes: spec.npu!.memBytes, phase: 'run', busy: true, count: 3, index: 1, run: 1, list: run.map((e) => ({ op: e.op, a: e.a, b: e.b, c: 0 })), log: run, tiles: [true, false, false, false], acc: new Array<number>(K * K).fill(-3) })],
      });
      const ids = npuIds(spec.visual, 'pcie1');
      // every cell of the array, the four tiles, the rows of the queue, the seven blocks and the lid
      expect(ids.length, spec.id).toBe(K * K + 4 + 8 + 7 + 1);
      for (const id of ids) {
        expect(isNpuId(id), id).toBe(true);
        for (const d of [describeId(id, s), describeId(id)]) {
          expect(d, `${spec.id} ${id}`).not.toBeNull();
          expect(d!.title.length, `${id} title`).toBeGreaterThan(2);
          expect(d!.plain.length, `${id} plain`).toBeGreaterThan(10);
          expect(d!.nerd.length, `${id} nerd`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('says what the card is doing now, and leaves the graphics cards\' and other ids alone', () => {
    const run = sampleRun();
    const s = snap({ devices: [dev({ id: 'n1', spec: 'npu1', kind: 'npu', slot: 'pcie1' })], npus: [sampleView({ phase: 'run', busy: true, count: 3, index: 1, run: 1, list: run.map((e) => ({ op: e.op, a: e.a, b: e.b, c: 0 })), log: run, acc: Array.from({ length: 16 }, (_, k) => 100 + k) })] });
    expect(describeId('pcie1.mac2x3', s)!.nerd).toMatch(/sum 111 \| cell 11 of 16/);
    expect(describeId('pcie1.entry1', s)!.plain).toMatch(/matmul multiplies two tiles/);
    expect(describeId('pcie1.entry1', s)!.nerd).toMatch(/matmul.*14 ticks.*on it now/);
    expect(describeId('pcie1.entry0', s)!.nerd).toMatch(/done/);
    expect(describeId('pcie1.desc', s)!.nerd).toMatch(/running descriptor 2 of 3/);
    expect(describeId('pcie1.array')!.nerd).toMatch(/set-up/);
    expect(describeId('pcie1.mac0x0')!.plain).toMatch(/multiply/);
    expect(describeId('pcie1.nonsense', s)).toBeNull();
    expect(isNpuId('pcie1.lid')).toBe(true);
    expect(isNpuId('pcie1')).toBe(false);
    expect(isNpuId('pcie1.lane3')).toBe(false);
    expect(isNpuId('tpm0.regs')).toBe(false);
    // the graphics card's ids still go to the graphics card's words
    expect(describeId('pcie0.lane3')!.title).toMatch(/Lane 3/);
    expect(NpuOp.Layer).toBe(7);
  });
});
