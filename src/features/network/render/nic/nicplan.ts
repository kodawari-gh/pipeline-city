// The NIC controller's die as a floorplan (docs/render/net.md "Inside the NIC and the router"). Pure geometry, no Pixi: `nicPlan(visual)` returns the blocks and the routed
// wires of one card's controller chip in plan units, (0, 0) the plan's north-west corner. The card itself is built in 3D, part by part (board/render/three/nic3d.ts); only
// the controller shows a floorplan, on its die under the lid, as the CPU's does. The Ethernet chip soldered on the motherboard has the same die in two looks (`BOARD_LINK`): a Fast
// Ethernet one and a Gigabit one, with no heat sensor (the sim has no temperature for it). The renderer draws it (nicart.ts), the hover ids come from it (`<slot>.nic-<block>`) and the
// tests check it. A frame comes in from the PHY (the line side) to the MAC with the counters, into the receive queue, over the DMA engine and the PCIe core out to the host
// bus, and goes the other way for a frame to send; the heat sensor sits by the DMA engine and throttles the link.

import * as cpufloor from '../../../cpu/render/core/cpufloor';
import { NIC_FIFO } from '../../sim/specs';
import * as netplan from '../plan/netplan';

export type NicBlockKind = 'ctl' | 'phy' | 'mac' | 'stats' | 'rxq' | 'txq' | 'dma' | 'pcie' | 'temp';
export type NicLinkKind = 'line' | 'data' | 'host' | 'control';
export type NicBlock = netplan.NetBlock<NicBlockKind>;
export type NicLink = netplan.NetLink<NicLinkKind>;

/** What the die's floorplan depends on: which card it is (its tier), nothing else. */
export interface NicPlanInput {
  visual: string;
  /** The controller's marking (as nic3d's chip) and the standard its PHY speaks. */
  chip: string;
  std: string;
  /** The card's edge connector (x1, x4, x8) and the ports on its bracket. */
  lanes: 1 | 4 | 8;
  ports: 1 | 2;
  /** What the ports are: RJ45 jacks on twisted pairs, or QSFP+ cages on four lanes of twinax (the 40G card's). */
  port: 'rj45' | 'qsfp';
  /** The rows the PHY draws: the wire pairs the line standard uses (100BASE-TX runs on two, one to send and one to receive, the other copper ones on four), or the four lanes of a QSFP+ port. */
  pairs: 2 | 4;
  /** The segments the chip's input FIFO holds (the sim's `NIC_FIFO`: the board's jack 2, a card 4, 8 or 16). The receive queue draws a cell for each; the rings have the kernel's slots, the same on every chip (`NIC_RX_SLOTS`, `NIC_TX_SLOTS`). */
  fifo: number;
  /** The chip has a heat sensor the sim reads (a card's controller has: the card throttles). */
  heat: boolean;
  /** What the host link goes to (the second line of its block). */
  host: string;
}
export type NicPlan = netplan.NetPlan<NicBlockKind, NicLinkKind, NicPlanInput>;

/** The three cards: the chip each carries, its standard, its edge, its jacks, its queues. The 3D card is built the same (`NIC_LANES` in niccopper.ts, `jacksOf` in nic3d.ts, `CTRL` there for the chip). */
export const NIC_LINK: Record<string, NicPlanInput> = {
  'nic-gbe': {
    visual: 'nic-gbe',
    chip: 'RL-N210',
    std: '1000BASE-T',
    lanes: 1,
    pairs: 4,
    ports: 1,
    port: 'rj45',
    fifo: NIC_FIFO['nic1']!,
    heat: true,
    host: 'the host link',
  },
  'nic-10g': {
    visual: 'nic-10g',
    chip: 'RL-N510',
    std: '10GBASE-T',
    lanes: 4,
    pairs: 4,
    ports: 1,
    port: 'rj45',
    fifo: NIC_FIFO['nic2']!,
    heat: true,
    host: 'the host link',
  },
  // (40G is never sold on copper pairs: the card has two QSFP+ cages, and a 40GBASE-CR4 lead, direct attach twinax, is the module in the cage)
  'nic-40g': {
    visual: 'nic-40g',
    chip: 'RL-N740',
    std: '40GBASE-CR4',
    lanes: 8,
    pairs: 4,
    ports: 2,
    port: 'qsfp',
    fifo: NIC_FIFO['nic3']!,
    heat: true,
    host: 'the host link',
  },
};

/**
 * The Ethernet chip on the motherboard (the 2D board's PHY, `GEO.phy`): one chip with the line side, the MAC and the host link, as a real board's LAN chip is. Its look follows the board's
 * port speed (`BOARD_TIERS`: 100 Mbit on the Basic and Mainstream boards, 1000 on the Enthusiast board). It talks to the I/O hub over one lane. No heat sensor: the sim keeps no temperature for it.
 */
export const BOARD_LINK: Record<string, NicPlanInput> = {
  'board-fe': {
    visual: 'board-fe',
    chip: 'RL-E100',
    std: '100BASE-TX',
    lanes: 1,
    pairs: 2,
    ports: 1,
    port: 'rj45',
    fifo: NIC_FIFO['board']!,
    heat: false,
    host: 'to the I/O hub',
  },
  'board-ge': {
    visual: 'board-ge',
    chip: 'RL-E111',
    std: '1000BASE-T',
    lanes: 1,
    pairs: 4,
    ports: 1,
    port: 'rj45',
    fifo: NIC_FIFO['board']!,
    heat: false,
    host: 'to the I/O hub',
  },
};
/** The slot id the onboard chip's parts carry (`board.nic-mac`), as a card's carry the slot's (`pcie2.nic-mac`). */
export const BOARD_NIC = 'board';
/** The look of the onboard chip for a port speed in Mbit/s (a board with a faster port than Fast Ethernet has the Gigabit chip). */
export const boardLook = (mbps: number): string => (mbps > 100 ? 'board-ge' : 'board-fe');
export const nicInput = (visual: string): NicPlanInput =>
  NIC_LINK[visual] ?? BOARD_LINK[visual] ?? NIC_LINK['nic-gbe']!;

/** The die's plan is this big (plan units): square, as a die is. The blocks are sized for it: a symbol fits a block of about 250 by 150. */
export const NIC_DIE = { w: 680, h: 680 };
/** The Ethernet chip on the motherboard (`BOARD_LINK`) is a taller package (220 x 260 board units), so its die has the package's shape: the floorplan fills the chip, no bare package round it. */
export const BOARD_DIE = { w: 680, h: 810 };
/** The size of the die's plan of look `visual`. */
export const nicDieSize = (visual: string): { w: number; h: number } => (visual in BOARD_LINK ? BOARD_DIE : NIC_DIE);
const M: netplan.Margins = { x: 10, top: 10, bottom: 30 };

type K = NicBlockKind;
type N = cpufloor.Node<K>;
type Opt = Partial<cpufloor.Spec<K>> & { f?: number; px?: number };
const L = (id: string, kind: K, label: string, o: Opt = {}): N => cpufloor.leaf<K>(id, kind, label, o);

type W = [id: string, kind: NicLinkKind, from: string, to: string, lanes?: 1 | 2 | 3 | 4];
const wires = (a: W[]): cpufloor.WireSpec<NicLinkKind>[] =>
  a.map(([id, kind, from, to, lanes]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}) }));

function build(i: NicPlanInput): { tree: N; specs: cpufloor.WireSpec<NicLinkKind>[] } {
  const ctl: cpufloor.Spec<K> = { id: 'ctl', kind: 'ctl', label: `${i.chip} CONTROLLER`, sub: i.std };
  const tree = cpufloor.col<K>(
    [
      cpufloor.row<K>(
        [
          L('phy', 'phy', 'PHY', { sub: `${i.std} line side`, f: 1.15 }),
          cpufloor.col<K>(
            [
              L('mac', 'mac', 'MAC', { sub: 'frames, CRC, flow control', f: 1.5 }),
              L('stats', 'stats', 'STATISTICS', { sub: 'the port counters', f: 0.8 }),
            ],
            { f: 1 },
          ),
        ],
        { f: 1.3 },
      ),
      cpufloor.row<K>(
        [
          L('rxq', 'rxq', 'RX QUEUE', { sub: 'frames in, downloads in flight', f: 1 }),
          L('txq', 'txq', 'TX QUEUE', { sub: 'frames out, uploads in flight', f: 1 }),
        ],
        { f: 0.95 },
      ),
      cpufloor.row<K>(
        [
          L('dma', 'dma', 'DMA', { sub: 'moves frames to and from RAM', f: 1.2 }),
          L('pcie', 'pcie', `PCIe x${i.lanes}`, { sub: i.host, f: 1 }),
          ...(i.heat ? [L('temp', 'temp', 'HEAT SENSOR', { sub: 'throttles the link', f: 0.8 })] : []),
        ],
        { f: 0.75 },
      ),
    ],
    { f: 1, frame: ctl, pad: 8, title: 22 },
  );
  const specs: W[] = [
    ['phy-mac', 'data', 'phy', 'mac', 3],
    ['mac-rxq', 'data', 'mac', 'rxq', 2],
    ['mac-txq', 'data', 'mac', 'txq', 2],
    ['rxq-dma', 'data', 'rxq', 'dma', 2],
    ['txq-dma', 'data', 'txq', 'dma', 2],
    ['dma-pcie', 'host', 'dma', 'pcie', 3],
    ['stats-mac', 'control', 'stats', 'mac', 1],
    ...(i.heat ? [['temp-dma', 'control', 'temp', 'dma', 1] as W] : []),
  ];
  return { tree, specs: wires(specs) };
}

/** The floorplan of a card's controller die. */
export function nicPlan(visual: string): NicPlan {
  const i = nicInput(visual),
    { tree, specs } = build(i);
  return netplan.layPlan<K, NicLinkKind, NicPlanInput>(
    `nicdie|${visual}`,
    i,
    nicDieSize(visual),
    M,
    tree,
    specs,
    'nicplan',
  );
}
