// The router SoC's die as a floorplan (docs/render/net.md "Inside the NIC and the router"). Pure geometry, no Pixi: `routerPlan(tier)` returns the blocks and the routed wires of one
// router's SoC in plan units, (0, 0) the plan's north-west corner, the way `nicPlan` does for a card. The router itself is built in 3D, part by part (board/render/three/routerboard3d.ts):
// the board, the DRAM, the flash, the PHYs, the radio and the power input are bodies on it. Only the SoC shows a floorplan, on its die under the lid, as the CPU's does. The renderer draws it
// (routerart.ts), the hover ids come from it (`router.<block>`) and the tests check it. A frame comes in from the WAN jack through the PHY to the WAN MAC of the SoC, into the forwarding
// engine, which finds the client it is for (the NAT table), and on through the LAN switch, whose ports leave the chip for the LAN PHY; a frame to send goes the other way. The CPU runs the
// firmware (DHCP, the firewall, a new connection's entry in the engine) and the memory controller feeds the DRAM chips beside the SoC.

import { col, leaf, row, type Node, type Spec, type WireSpec } from '../../../cpu/render/core/cpufloor';
import { layPlan, type Margins, type NetBlock, type NetLink, type NetPlan } from '../plan/netplan';

export type RouterBlockKind = 'soc' | 'cpu' | 'mem' | 'wanmac' | 'pkt' | 'sw' | 'stat';
export type RouterLinkKind = 'data' | 'control' | 'memory';
export type RouterBlock = NetBlock<RouterBlockKind>;
export type RouterLink = NetLink<RouterLinkKind>;

/** What the router's floorplan depends on: which router it is (its tier) and the parts that tier is built from. */
export interface RouterPlanInput {
  tier: number;
  /** The SoC's marking, its cores and clock. */
  soc: string;
  cores: number;
  mhz: number;
  /** The forwarding engine's name: the home routers do it in a NAT engine, the faster ones in an ASIC. */
  engine: string;
  /** The standard of the PHYs and the number of LAN ports behind the switch (the WAN port is one more). They are RJ45 jacks, but on the edge router (40GBASE-CR4) QSFP+ cages, all five. */
  std: string;
  lan: number;
  /** The memory: size in MB, its kind and the number of chips on the board. */
  dram: { mb: number; kind: string; chips: number };
  flash: { mb: number; kind: string };
  /** The radio of the home routers (null: none, the faster ones are wired only) and the aerials it feeds. */
  radio: { bands: string; aerials: number } | null;
  /** The power input. */
  inlet: string;
}
export type RouterPlan = NetPlan<RouterBlockKind, RouterLinkKind, RouterPlanInput>;

/**
 * The four routers' parts, by tier (`ROUTER_SPECS` in network/sim/specs.ts: Home 100 Mbit, Gigabit, 10G switch-router, Edge 40G). The names and sizes are what the parts are made of, in
 * words; the game's numbers for a router are its speed and its clients (`NetSnap.router`), which the live view shows as they are. The 3D router has the aerials the radio feeds
 * (tiers 1 and 2) and the rack ears of the edge router (`router3d.ts`); its board carries the rest (`routerboard3d.ts`).
 */
export const ROUTER_PARTS: Record<number, RouterPlanInput> = {
  1: {
    tier: 1,
    soc: 'RL-R110',
    cores: 1,
    mhz: 400,
    engine: 'NAT ENGINE',
    std: '100BASE-TX',
    lan: 4,
    dram: { mb: 64, kind: 'DDR2', chips: 1 },
    flash: { mb: 8, kind: 'SPI NOR' },
    radio: { bands: '2.4 GHz', aerials: 2 },
    inlet: 'DC 12 V jack',
  },
  2: {
    tier: 2,
    soc: 'RL-R210',
    cores: 2,
    mhz: 880,
    engine: 'NAT ENGINE',
    std: '1000BASE-T',
    lan: 4,
    dram: { mb: 256, kind: 'DDR3', chips: 2 },
    flash: { mb: 16, kind: 'SPI NOR' },
    radio: { bands: '2.4 + 5 GHz', aerials: 2 },
    inlet: 'DC 12 V jack',
  },
  3: {
    tier: 3,
    soc: 'RL-R510',
    cores: 4,
    mhz: 1400,
    engine: 'FORWARDING ASIC',
    std: '10GBASE-T',
    lan: 4,
    dram: { mb: 1024, kind: 'DDR4', chips: 2 },
    flash: { mb: 128, kind: 'NAND' },
    radio: null,
    inlet: 'DC 19 V jack',
  },
  4: {
    tier: 4,
    soc: 'RL-R740',
    cores: 8,
    mhz: 2000,
    engine: 'FORWARDING ASIC',
    std: '40GBASE-CR4',
    lan: 4,
    dram: { mb: 8192, kind: 'DDR4 ECC', chips: 4 },
    flash: { mb: 512, kind: 'NAND' },
    radio: null,
    inlet: 'mains inlet',
  },
};
export const routerInput = (tier: number): RouterPlanInput => ROUTER_PARTS[tier] ?? ROUTER_PARTS[1]!;

/** The die's plan is this big (plan units): square, as a die is. The blocks are sized for it: a symbol fits a block of about 200 by 150. */
export const ROUTER_DIE = { w: 680, h: 680 };
const M: Margins = { x: 10, top: 10, bottom: 30 };

type K = RouterBlockKind;
type N = Node<K>;
type Opt = Partial<Spec<K>> & { f?: number; px?: number };
const L = (id: K, label: string, o: Opt = {}): N => leaf<K>(id, id, label, o);

type W = [id: string, kind: RouterLinkKind, from: string, to: string, lanes?: 1 | 2 | 3 | 4];
const wires = (a: W[]): WireSpec<RouterLinkKind>[] =>
  a.map(([id, kind, from, to, lanes]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}) }));

/** A memory size in words: 64 MB, 1 GB. */
export const fmtSize = (mb: number): string => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

function build(i: RouterPlanInput): { tree: N; specs: WireSpec<RouterLinkKind>[] } {
  const soc: Spec<K> = {
    id: 'soc',
    kind: 'soc',
    label: `${i.soc} SoC`,
    sub: `${i.cores} core${i.cores === 1 ? '' : 's'} · ${i.mhz} MHz`,
  };
  const tree = col<K>(
    [
      row<K>(
        [
          L('wanmac', 'WAN MAC', { sub: "the line side: the plan's address", f: 1 }),
          L('cpu', 'CPU', { sub: 'runs the firmware', f: 1.15 }),
          L('mem', 'MEMORY CTRL', { sub: `${fmtSize(i.dram.mb)} ${i.dram.kind}`, f: 0.95 }),
        ],
        { f: 1 },
      ),
      row<K>([L('pkt', i.engine, { sub: 'finds the client of each frame: the NAT table', f: 1 })], { f: 1.5 }),
      row<K>(
        [
          L('sw', 'LAN SWITCH', { sub: `${i.lan} ports, ${i.std}`, f: 1.25 }),
          L('stat', 'TRAFFIC', { sub: 'what the router carries now', f: 1 }),
        ],
        { f: 1 },
      ),
    ],
    { f: 1, frame: soc, pad: 8, title: 22 },
  );
  const specs: W[] = [
    ['wanmac-pkt', 'data', 'wanmac', 'pkt', 3],
    ['cpu-pkt', 'control', 'cpu', 'pkt', 2],
    ['mem-pkt', 'memory', 'mem', 'pkt', 3],
    ['cpu-mem', 'memory', 'cpu', 'mem', 2],
    ['pkt-sw', 'data', 'pkt', 'sw', 3],
    ['pkt-stat', 'control', 'pkt', 'stat', 1],
  ];
  return { tree, specs: wires(specs) };
}

/** The floorplan of the SoC of the router of `tier`. */
export function routerPlan(tier: number): RouterPlan {
  const i = routerInput(tier),
    { tree, specs } = build(i);
  return layPlan<K, RouterLinkKind, RouterPlanInput>(
    `routerdie|${i.tier}`,
    i,
    ROUTER_DIE,
    M,
    tree,
    specs,
    'routerplan',
  );
}
