import { describe, expect, it } from 'vitest';
import { gpuIds } from './board/gpulayout';
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
