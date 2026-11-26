import { assert, describe, expect, it } from 'vitest';
import { specsOfKind } from '../../board/sim/specs';
import { NpuOp } from '@/core/sim/memmap';
import { npuIds } from '../render/npulayout';
import { sampleRun, sampleView } from '../render/npusample';
import { describeId } from '@/core/ui/logic';
import { dev, snap } from '@/core/ui/testdata';
import { isNpuId } from './npudesc';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

describe('the words for the AI card', () => {
  it('describes every part the board writes, with the card on and off', () => {
    for (const spec of specsOfKind('npu')) {
      const K = must(spec.npu).grid,
        run = sampleRun();
      assert.exists(spec.npu);
      const s = snap({
        devices: [dev({ id: 'n1', spec: spec.id, kind: 'npu', slot: 'pcie1', tempC: 41 })],
        npus: [
          sampleView({
            grid: K,
            memBytes: spec.npu.memBytes,
            phase: 'run',
            busy: true,
            count: 3,
            index: 1,
            run: 1,
            list: run.map((e) => ({ op: e.op, a: e.a, b: e.b, c: 0 })),
            log: run,
            tiles: [true, false, false, false],
            acc: Array.from({ length: K * K }, () => -3),
          }),
        ],
      });
      const ids = npuIds(spec.visual, 'pcie1');
      // every cell of the array, the four tiles, the rows of the queue, the seven blocks and the lid
      expect(ids).toHaveLength(K * K + 4 + 8 + 7 + 1);
      for (const id of ids) {
        expect(isNpuId(id), `for ${id}`).toBe(true);
        for (const d of [describeId(id, s), describeId(id)]) {
          expect(d, `${spec.id} ${id}`).not.toBeNull();
          assert.exists(d);
          expect(d.title.length, `${id} title`).toBeGreaterThan(2);
          expect(d.plain.length, `${id} plain`).toBeGreaterThan(10);
          expect(d.nerd.length, `${id} nerd`).toBeGreaterThan(10);
        }
      }
    }
  });

  it("says what the card is doing now, and leaves the graphics cards' and other ids alone", () => {
    const run = sampleRun();
    const s = snap({
      devices: [dev({ id: 'n1', spec: 'npu1', kind: 'npu', slot: 'pcie1' })],
      npus: [
        sampleView({
          phase: 'run',
          busy: true,
          count: 3,
          index: 1,
          run: 1,
          list: run.map((e) => ({ op: e.op, a: e.a, b: e.b, c: 0 })),
          log: run,
          acc: Array.from({ length: 16 }, (_, k) => 100 + k),
        }),
      ],
    });
    const pcie1Mac2x3Info = describeId('pcie1.mac2x3', s);
    assert.exists(pcie1Mac2x3Info);
    expect(pcie1Mac2x3Info.nerd).toMatch(/sum 111 \| cell 11 of 16/u);
    const pcie1Entry1Info = describeId('pcie1.entry1', s);
    assert.exists(pcie1Entry1Info);
    expect(pcie1Entry1Info.plain).toMatch(/matmul multiplies two tiles/u);
    const pcie1Entry1Info2 = describeId('pcie1.entry1', s);
    assert.exists(pcie1Entry1Info2);
    expect(pcie1Entry1Info2.nerd).toMatch(/matmul.*14 ticks.*on it now/u);
    const pcie1Entry0Info = describeId('pcie1.entry0', s);
    assert.exists(pcie1Entry0Info);
    expect(pcie1Entry0Info.nerd).toMatch(/done/u);
    const pcie1DescInfo = describeId('pcie1.desc', s);
    assert.exists(pcie1DescInfo);
    expect(pcie1DescInfo.nerd).toMatch(/running descriptor 2 of 3/u);
    const pcie1ArrayInfo = describeId('pcie1.array');
    assert.exists(pcie1ArrayInfo);
    expect(pcie1ArrayInfo.nerd).toMatch(/set-up/u);
    const pcie1Mac0x0Info = describeId('pcie1.mac0x0');
    assert.exists(pcie1Mac0x0Info);
    expect(pcie1Mac0x0Info.plain).toMatch(/multiply/u);
    expect(describeId('pcie1.nonsense', s)).toBeNull();
    expect(isNpuId('pcie1.lid')).toBe(true);
    expect(isNpuId('pcie1')).toBe(false);
    expect(isNpuId('pcie1.lane3')).toBe(false);
    expect(isNpuId('tpm0.regs')).toBe(false);
    // the graphics card's ids still go to the graphics card's words
    const pcie0Lane3Info = describeId('pcie0.lane3');
    assert.exists(pcie0Lane3Info);
    expect(pcie0Lane3Info.title).toMatch(/Lane 3/u);
    expect(NpuOp.Layer).toBe(7);
  });
});
