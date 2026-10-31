import { describe, expect, it } from 'vitest';
import { gpuIds } from '../../features/gpu/render/gpulayout';
import { deviceOfPart } from './interact';

const devices = [{ id: 'dev-gpu', slot: 'pcie1' }, { id: 'dev-nic', slot: 'pcie0' }];

describe('a click on a part of a graphics card', () => {
  it('is a click on the card in that slot, for every part id the board writes', () => {
    for (const id of gpuIds('gpu-3', 'pcie1')) expect(deviceOfPart(id, devices), id).toBe('dev-gpu');
  });

  it('leaves every other id alone, and an id of an empty slot', () => {
    for (const id of ['pcie1', 'cpu.fetch', 'eth1', 'dimm0', 'inv:inv3', 'key:4', 'vrm.phases']) expect(deviceOfPart(id, devices), id).toBe(id);
    expect(deviceOfPart('pcie3.lane0', devices)).toBe('pcie3.lane0');
  });
});

describe('a click on a part of an AI card', () => {
  it('is a click on the card in its slot, whether a cell of the array, a tile, a row of the queue or a block', () => {
    const devs = [{ id: 'dev-npu', slot: 'pcie2' }, ...devices];
    for (const id of ['pcie2.mac3x7', 'pcie2.tile1', 'pcie2.entry4', 'pcie2.array', 'pcie2.cardmem', 'pcie2.lid']) expect(deviceOfPart(id, devs), id).toBe('dev-npu');
    expect(deviceOfPart('pcie3.mac0x0', devs)).toBe('pcie3.mac0x0');
  });
});

describe('a click on a part of the secure module', () => {
  it('is a click on the module in its header slot', () => {
    const devs = [{ id: 'dev-tpm', slot: 'tpm0' }, ...devices];
    for (const id of ['tpm0.regs', 'tpm0.hash', 'tpm0.lid']) expect(deviceOfPart(id, devs), id).toBe('dev-tpm');
    expect(deviceOfPart('tpm1.regs', devs)).toBe('tpm1.regs');
    expect(deviceOfPart('tpm0', devs)).toBe('tpm0');
  });
});
