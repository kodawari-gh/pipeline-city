// The NIC card as a floorplan (docs/render/net.md "Inside the NIC and the router"). Pure geometry, no Pixi: `nicPlan(visual)` returns the blocks and the routed wires
// of one card in plan units (1 a layout unit), (0, 0) the plan's north-west corner. The renderer draws it (nicart.ts), the hover ids come from it (`<slot>.nic-<block>`)
// and the tests check it. The data runs west to east, the way a frame comes in: the RJ45 jack, the magnetics, then the controller (its PHY, its MAC with the counters,
// the receive and transmit queues, the DMA engine and the PCIe core), and the host bus runs out to the gold fingers along the card's north edge; the small parts the
// card needs (the flash with the address, the crystal, the regulator, the heat sensor) stand in a column on the east and reach the controller by their own wires.

import { col, leaf, row, type Node, type Spec, type WireSpec } from '../../../cpu/render/core/cpufloor';
import { NIC_LEN } from '../../../board/render/layout/layout';
import { layPlan, type Margins, type NetBlock, type NetLink, type NetPlan } from '../plan/netplan';

export type NicBlockKind = 'ctl' | 'jack' | 'mag' | 'phy' | 'mac' | 'stats' | 'rxq' | 'txq' | 'dma' | 'pcie' | 'nvm' | 'xtal' | 'vreg' | 'temp';
export type NicLinkKind = 'line' | 'data' | 'host' | 'control' | 'clock' | 'power';
export type NicBlock = NetBlock<NicBlockKind>;
export type NicLink = NetLink<NicLinkKind>;

/** What the card's floorplan depends on: which card it is (its tier), nothing else. */
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

/** The plan's area: it stops short of the card's two ends (the bracket's side and the far end), and its south margin carries the title and the legend. */
export const NIC_PLAN = { margin: 56, h: 398 };
const M: Margins = { x: 16, top: 16, bottom: 38 };

/** The plan's width for a card: its length less the end margins. */
export const nicPlanWidth = (visual: string): number => (NIC_LEN[visual] ?? 2645) - 2 * NIC_PLAN.margin;

type K = NicBlockKind;
type N = Node<K>;
type Opt = Partial<Spec<K>> & { f?: number; px?: number };
const L = (id: string, kind: K, label: string, o: Opt = {}): N => leaf<K>(id, kind, label, o);

type W = [id: string, kind: NicLinkKind, from: string, to: string, lanes?: 1 | 2 | 3 | 4];
const wires = (a: W[]): WireSpec<NicLinkKind>[] => a.map(([id, kind, from, to, lanes]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}) }));

function build(i: NicPlanInput): { tree: N; specs: WireSpec<NicLinkKind>[] } {
  const ctl: Spec<K> = { id: 'ctl', kind: 'ctl', label: `${i.chip} CONTROLLER`, sub: i.std };
  const tree = row<K>([
    L('jack', 'jack', i.ports > 1 ? 'RJ45 PORTS' : 'RJ45 PORT', { sub: i.ports > 1 ? 'two jacks, one cable' : 'to the cable', px: 300 }),
    L('mag', 'mag', 'MAGNETICS', { sub: 'isolate the line', px: 210 }),
    row<K>([
      L('phy', 'phy', 'PHY', { sub: `${i.std} line side`, f: 26 }),
      col<K>([
        L('mac', 'mac', 'MAC', { sub: 'frames, CRC, flow control', f: 58 }),
        L('stats', 'stats', 'STATISTICS', { sub: 'the port counters', f: 42 }),
      ], { f: 27 }),
      col<K>([
        L('rxq', 'rxq', 'RX QUEUE', { sub: 'frames in, downloads in flight', f: 1 }),
        L('txq', 'txq', 'TX QUEUE', { sub: 'frames out, uploads in flight', f: 1 }),
      ], { f: 29 }),
      L('dma', 'dma', 'DMA', { sub: 'moves frames to and from RAM', f: 17 }),
      L('pcie', 'pcie', `PCIe x${i.lanes}`, { sub: 'the host link', f: 17 }),
    ], { f: 1, frame: ctl, pad: 8, title: 22 }),
    col<K>([
      L('nvm', 'nvm', 'FLASH', { sub: 'firmware and MAC address', f: 1.3 }),
      L('xtal', 'xtal', 'CRYSTAL', { sub: '25 MHz clock', f: 0.8 }),
      L('vreg', 'vreg', 'REGULATOR', { sub: 'the core rail', f: 1 }),
      L('temp', 'temp', 'HEAT SENSOR', { sub: 'throttles the link', f: 1 }),
    ], { px: 330 }),
  ], { f: 1 });
  const specs: W[] = [
    ['jack-mag', 'line', 'jack', 'mag', 4],
    ['mag-phy', 'line', 'mag', 'phy', 4],
    ['phy-mac', 'data', 'phy', 'mac', 3],
    ['mac-rxq', 'data', 'mac', 'rxq', 2],
    ['mac-txq', 'data', 'mac', 'txq', 2],
    ['rxq-dma', 'data', 'rxq', 'dma', 2],
    ['txq-dma', 'data', 'txq', 'dma', 2],
    ['dma-pcie', 'host', 'dma', 'pcie', 3],
    ['stats-mac', 'control', 'stats', 'mac', 1],
    ['nvm-ctl', 'control', 'nvm', 'ctl', 1],
    ['xtal-ctl', 'clock', 'xtal', 'ctl', 1],
    ['vreg-ctl', 'power', 'vreg', 'ctl', 2],
    ['temp-ctl', 'control', 'temp', 'ctl', 1],
  ];
  return { tree, specs: wires(specs) };
}

/** Where the host bus meets the card's edge connector (plan units): the fingers' x range (from the card's tab) and how far above the plan's top the bus runs. */
export interface NicEdge { x0: number; x1: number }

/**
 * The floorplan of a card. `edge` is the gold fingers' x range in plan units (the card's tab: `niclayout.ts` knows where it is): the host bus runs from the PCIe core
 * along the plan's north margin to them, one pair a lane up to four.
 */
export function nicPlan(visual: string, edge: NicEdge): NicPlan {
  const i = nicInput(visual), size = { w: nicPlanWidth(visual), h: NIC_PLAN.h }, { tree, specs } = build(i);
  return layPlan<K, NicLinkKind, NicPlanInput>(`${visual}|${edge.x0}|${edge.x1}`, i, size, M, tree, specs, 'nicplan', (blocks: NetBlock<K>[]): NicLink[] => {
    const p = blocks.find((b) => b.id === 'pcie')!, bx = p.rect.x + p.rect.w / 2, x = (edge.x0 + edge.x1) / 2;
    // out of the core's north edge, up into the margin, west along it, up to the fingers
    return [{ id: 'pcie-host', kind: 'host', from: 'pcie', to: 'edge', pts: [[bx, p.rect.y], [bx, -8], [x, -8], [x, -16]], lanes: 4 }];
  });
}
