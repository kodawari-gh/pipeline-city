// The NIC controller's die as a floorplan (docs/render/net.md "Inside the NIC and the router"). Pure geometry, no Pixi: `nicPlan(visual)` returns the blocks and the routed
// wires of one card's controller chip in plan units, (0, 0) the plan's north-west corner. The card itself is built in 3D, part by part (board/render/three/nic3d.ts); only
// the controller shows a floorplan, on its die under the lid, as the CPU's does. The renderer draws it (nicart.ts), the hover ids come from it (`<slot>.nic-<block>`) and the
// tests check it. A frame comes in from the PHY (the line side) to the MAC with the counters, into the receive queue, over the DMA engine and the PCIe core out to the host
// bus, and goes the other way for a frame to send; the heat sensor sits by the DMA engine and throttles the link.

import { col, leaf, row, type Node, type Spec, type WireSpec } from '../../../cpu/render/core/cpufloor';
import { layPlan, type Margins, type NetBlock, type NetLink, type NetPlan } from '../plan/netplan';

export type NicBlockKind = 'ctl' | 'phy' | 'mac' | 'stats' | 'rxq' | 'txq' | 'dma' | 'pcie' | 'temp';
export type NicLinkKind = 'line' | 'data' | 'host' | 'control';
export type NicBlock = NetBlock<NicBlockKind>;
export type NicLink = NetLink<NicLinkKind>;

/** What the die's floorplan depends on: which card it is (its tier), nothing else. */
export interface NicPlanInput {
  visual: string;
  /** The controller's marking (as nic3d's chip) and the standard its PHY speaks. */
  chip: string;
  std: string;
  /** The card's edge connector (x1, x4, x8) and the jacks on its bracket. */
  lanes: 1 | 4 | 8;
  ports: 1 | 2;
  /** Slots drawn in each queue's ring. */
  ring: number;
}
export type NicPlan = NetPlan<NicBlockKind, NicLinkKind, NicPlanInput>;

/** The three cards: the chip each carries, its standard, its edge, its jacks, its queues. The 3D card is built the same (`NIC_LANES` in niccopper.ts, `jacksOf` in nic3d.ts, `CTRL` there for the chip). */
export const NIC_LINK: Record<string, NicPlanInput> = {
  'nic-gbe': { visual: 'nic-gbe', chip: 'RL-N210', std: '1000BASE-T', lanes: 1, ports: 1, ring: 8 },
  'nic-10g': { visual: 'nic-10g', chip: 'RL-N510', std: '10GBASE-T', lanes: 4, ports: 1, ring: 12 },
  'nic-40g': { visual: 'nic-40g', chip: 'RL-N740', std: '40GBASE-T', lanes: 8, ports: 2, ring: 16 },
};
export const nicInput = (visual: string): NicPlanInput => NIC_LINK[visual] ?? NIC_LINK['nic-gbe']!;

/** The die's plan is this big (plan units): square, as a die is. The blocks are sized for it: a symbol fits a block of about 250 by 150. */
export const NIC_DIE = { w: 680, h: 680 };
const M: Margins = { x: 10, top: 10, bottom: 30 };

type K = NicBlockKind;
type N = Node<K>;
type Opt = Partial<Spec<K>> & { f?: number; px?: number };
const L = (id: string, kind: K, label: string, o: Opt = {}): N => leaf<K>(id, kind, label, o);

type W = [id: string, kind: NicLinkKind, from: string, to: string, lanes?: 1 | 2 | 3 | 4];
const wires = (a: W[]): WireSpec<NicLinkKind>[] => a.map(([id, kind, from, to, lanes]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}) }));

function build(i: NicPlanInput): { tree: N; specs: WireSpec<NicLinkKind>[] } {
  const ctl: Spec<K> = { id: 'ctl', kind: 'ctl', label: `${i.chip} CONTROLLER`, sub: i.std };
  const tree = col<K>([
    row<K>([
      L('phy', 'phy', 'PHY', { sub: `${i.std} line side`, f: 1.15 }),
      col<K>([
        L('mac', 'mac', 'MAC', { sub: 'frames, CRC, flow control', f: 1.5 }),
        L('stats', 'stats', 'STATISTICS', { sub: 'the port counters', f: 0.8 }),
      ], { f: 1 }),
    ], { f: 1.3 }),
    row<K>([
      L('rxq', 'rxq', 'RX QUEUE', { sub: 'frames in, downloads in flight', f: 1 }),
      L('txq', 'txq', 'TX QUEUE', { sub: 'frames out, uploads in flight', f: 1 }),
    ], { f: 0.95 }),
    row<K>([
      L('dma', 'dma', 'DMA', { sub: 'moves frames to and from RAM', f: 1.2 }),
      L('pcie', 'pcie', `PCIe x${i.lanes}`, { sub: 'the host link', f: 1 }),
      L('temp', 'temp', 'HEAT SENSOR', { sub: 'throttles the link', f: 0.8 }),
    ], { f: 0.75 }),
  ], { f: 1, frame: ctl, pad: 8, title: 22 });
  const specs: W[] = [
    ['phy-mac', 'data', 'phy', 'mac', 3],
    ['mac-rxq', 'data', 'mac', 'rxq', 2],
    ['mac-txq', 'data', 'mac', 'txq', 2],
    ['rxq-dma', 'data', 'rxq', 'dma', 2],
    ['txq-dma', 'data', 'txq', 'dma', 2],
    ['dma-pcie', 'host', 'dma', 'pcie', 3],
    ['stats-mac', 'control', 'stats', 'mac', 1],
    ['temp-dma', 'control', 'temp', 'dma', 1],
  ];
  return { tree, specs: wires(specs) };
}

/** The floorplan of a card's controller die. */
export function nicPlan(visual: string): NicPlan {
  const i = nicInput(visual), { tree, specs } = build(i);
  return layPlan<K, NicLinkKind, NicPlanInput>(`nicdie|${visual}`, i, NIC_DIE, M, tree, specs, 'nicplan');
}
