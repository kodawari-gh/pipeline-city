import type * as specsTypes from './specs';

/**
 * How many PCIe slots further down the row a card in a slot covers: a GPU's or an NPU's cooler stands less than a finger's width from the next
 * slot's card, so that card's latch cannot be reached; a NIC's small sink leaves room. Checked against the 3D cards in render/three/fit.test.ts.
 */
export const COVERS: Readonly<Partial<Record<specsTypes.DeviceKind, number>>> = { gpu: 1, npu: 1 };

/**
 * The M.2 sockets a card's cooler stands over, by spec id and the PCIe slot it stands in: its stick cannot come out under it. Checked against the
 * 3D cards on every board in render/three/fit.test.ts (a socket a board lacks is never covered).
 */
const OVER_M2: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  gpu1: { pcie0: ['m20'], pcie1: ['m21'], pcie2: ['m22'] },
  gpu2: { pcie0: ['m20'], pcie1: ['m21', 'm22'] },
  gpu3: { pcie0: ['m20'] },
  npu1: { pcie0: ['m20'], pcie1: ['m21'], pcie2: ['m22'] },
  npu2: { pcie0: ['m20'], pcie1: ['m21'], pcie2: ['m22'] },
};
/**
 * The CPU coolers a card's cooler stands over, by spec id and the PCIe slot it stands in: the cooler cannot lift away under it (the card comes out
 * first). Found with `npm run clip:check` on the biggest machine; a smaller card or cooler leaves room.
 */
const OVER_COOLER: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  gpu3: { pcie0: ['cooler2'] },
};
/** Whether a card (spec `spec` in PCIe slot `pcie`) stands over a CPU cooler of spec `cooler`. */
export const overCooler = (spec: string, pcie: string, cooler: string): boolean =>
  OVER_COOLER[spec]?.[pcie]?.includes(cooler) === true;
/** Whether a card (spec `spec` in PCIe slot `pcie`) stands over M.2 socket `m2`. */
export const overM2 = (spec: string, pcie: string, m2: string): boolean => OVER_M2[spec]?.[pcie]?.includes(m2) === true;

export const slotNo = (slot: string): number => Number(slot.replace(/^(?:m2|\D+)/u, ''));
