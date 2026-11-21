// The router's insides as a floorplan (docs/render/net.md "Inside the NIC and the router"). Pure geometry, no Pixi: `routerPlan(tier, size)` returns the blocks and the routed
// wires of one router in plan units (0, 0 the north-west corner), the way `nicPlan` does for a card. The renderer draws it (routerart.ts), the hover and flight ids come
// from it (`router.<block>`) and the tests check it. The router is the same machine in four sizes: a line comes in at the WAN jack (the magnetics, the PHY) to the SoC, whose
// forwarding engine finds the client it is for (the NAT table) and passes it to the LAN switch, which hands it to the LAN PHY, the magnetics and the LAN jack; the SoC's CPU
// runs the firmware, and the DRAM, the flash, the radio and the power input stand round the SoC and reach it by their own wires. The two rows follow the router's front: the
// jacks along the bottom, as the shared model has them (`router3d.ts`).

import { col, leaf, row, type Node, type Spec, type WireSpec } from '../../../cpu/render/core/cpufloor';
import { layPlan, type Margins, type NetBlock, type NetLink, type NetPlan } from '../plan/netplan';

export type RouterBlockKind = 'soc' | 'cpu' | 'pkt' | 'sw' | 'dram' | 'flash' | 'radio' | 'power' | 'wanjack' | 'wanmag' | 'wanphy' | 'lanphy' | 'lanmag' | 'lanjack' | 'stat';
export type RouterLinkKind = 'line' | 'data' | 'control' | 'memory' | 'power';
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
  /** The standard of the PHYs and the number of LAN jacks behind the switch (the WAN jack is one more). */
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
 * The four routers' parts, by tier (`ROUTER_SPECS` in network/sim/specs.ts: Home 100 Mbit, Gigabit, 10G switch-router, Core 40G). The names and sizes are what the parts are made of, in
 * words; the game's numbers for a router are its speed and its clients (`NetSnap.router`), which the live view shows as they are. The 3D router has the aerials the radio feeds
 * (tiers 1 and 2) and the rack ears of the core router (`router3d.ts`).
 */
export const ROUTER_PARTS: Record<number, RouterPlanInput> = {
  1: { tier: 1, soc: 'RL-R110', cores: 1, mhz: 400, engine: 'NAT ENGINE', std: '100BASE-TX', lan: 4, dram: { mb: 64, kind: 'DDR2', chips: 1 }, flash: { mb: 8, kind: 'SPI NOR' }, radio: { bands: '2.4 GHz', aerials: 2 }, inlet: 'DC 12 V jack' },
  2: { tier: 2, soc: 'RL-R210', cores: 2, mhz: 880, engine: 'NAT ENGINE', std: '1000BASE-T', lan: 4, dram: { mb: 256, kind: 'DDR3', chips: 2 }, flash: { mb: 16, kind: 'SPI NOR' }, radio: { bands: '2.4 + 5 GHz', aerials: 2 }, inlet: 'DC 12 V jack' },
  3: { tier: 3, soc: 'RL-R510', cores: 4, mhz: 1400, engine: 'FORWARDING ASIC', std: '10GBASE-T', lan: 4, dram: { mb: 1024, kind: 'DDR4', chips: 2 }, flash: { mb: 128, kind: 'NAND' }, radio: null, inlet: 'DC 19 V jack' },
  4: { tier: 4, soc: 'RL-R740', cores: 8, mhz: 2000, engine: 'FORWARDING ASIC', std: '40GBASE-T', lan: 4, dram: { mb: 8192, kind: 'DDR4 ECC', chips: 4 }, flash: { mb: 512, kind: 'NAND' }, radio: null, inlet: 'mains inlet' },
};
export const routerInput = (tier: number): RouterPlanInput => ROUTER_PARTS[tier] ?? ROUTER_PARTS[1]!;

/** The plan is always this wide (plan units) and as tall as the router's front is in proportion: its fixed-width blocks (the jacks, the PHYs) are sized for it, and the front is drawn over it at whatever scale fills it. */
export const ROUTER_PLAN_W = 2400;
const M: Margins = { x: 16, top: 16, bottom: 38 };

type K = RouterBlockKind;
type N = Node<K>;
type Opt = Partial<Spec<K>> & { f?: number; px?: number };
const L = (id: K, label: string, o: Opt = {}): N => leaf<K>(id, id, label, o);

type W = [id: string, kind: RouterLinkKind, from: string, to: string, lanes?: 1 | 2 | 3 | 4];
const wires = (a: W[]): WireSpec<RouterLinkKind>[] => a.map(([id, kind, from, to, lanes]) => ({ id, kind, from, to, ...(lanes ? { lanes } : {}) }));

/** A memory size in words: 64 MB, 1 GB. */
export const fmtSize = (mb: number): string => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

function build(i: RouterPlanInput): { tree: N; specs: WireSpec<RouterLinkKind>[] } {
  const soc: Spec<K> = { id: 'soc', kind: 'soc', label: `${i.soc} SoC`, sub: `${i.cores} core${i.cores === 1 ? '' : 's'} · ${i.mhz} MHz` };
  const radio = i.radio !== null, wide = radio ? 1 : 1.4;
  const top: N[] = [
    ...(i.radio ? [L('radio', 'WI-FI RADIO', { sub: i.radio.bands, f: 1 })] : []),
    L('dram', 'DRAM', { sub: `${fmtSize(i.dram.mb)} ${i.dram.kind}`, f: 1.1 * wide }),
    row<K>([
      L('cpu', 'CPU', { sub: 'runs the firmware', f: 1 }),
      L('pkt', i.engine, { sub: 'routes frames and keeps the NAT table', f: 1.15 }),
      L('sw', 'LAN SWITCH', { sub: `${i.lan} ports, ${i.std}`, f: 1 }),
    ], { f: radio ? 3.6 : 4.1, frame: soc, pad: 8, title: 22 }),
    L('flash', 'FLASH', { sub: `${fmtSize(i.flash.mb)} ${i.flash.kind}`, f: 0.9 * wide }),
    L('power', 'POWER', { sub: i.inlet, f: 1 * wide }),
  ];
  const bottom: N[] = [
    L('wanjack', 'WAN JACK', { sub: 'to the ISP', px: 210 }),
    L('wanmag', 'MAGNETICS', { sub: 'isolate the line', px: 140 }),
    L('wanphy', 'WAN PHY', { sub: i.std, px: 170 }),
    L('stat', 'TRAFFIC', { sub: 'what the router carries now', f: 1 }),
    L('lanphy', 'LAN PHY', { sub: i.std, px: 170 }),
    L('lanmag', 'MAGNETICS', { sub: 'isolate the line', px: 140 }),
    L('lanjack', 'LAN JACKS', { sub: `${i.lan} ports, one cable`, px: 210 }),
  ];
  // the channel between the rows is wide: five wires cross it
  const tree = col<K>([row<K>(top, { f: 57 }), row<K>(bottom, { f: 43 })], { f: 1, gap: 36 });
  const specs: W[] = [
    ['wan-mag', 'line', 'wanjack', 'wanmag', 4],
    ['wan-phy', 'line', 'wanmag', 'wanphy', 4],
    ['wan-pkt', 'data', 'wanphy', 'pkt', 3],
    ['pkt-sw', 'data', 'pkt', 'sw', 3],
    ['sw-lan', 'data', 'sw', 'lanphy', 3],
    ['lan-mag', 'line', 'lanphy', 'lanmag', 4],
    ['lan-jack', 'line', 'lanmag', 'lanjack', 4],
    ['cpu-pkt', 'control', 'cpu', 'pkt', 2],
    ['dram-soc', 'memory', 'dram', 'soc', 3],
    ['flash-soc', 'control', 'flash', 'soc', 2],
    ...(radio ? ([['radio-soc', 'data', 'radio', 'soc', 2]] as W[]) : []),
    ['power-soc', 'power', 'power', 'soc', 2],
    ['stat-pkt', 'control', 'stat', 'pkt', 1],
  ];
  return { tree, specs: wires(specs) };
}

/** The floorplan of the router of `tier` in an area of `size` plan units (`ROUTER_PLAN_W` wide: the router's front over its scale). */
export function routerPlan(tier: number, size: { w: number; h: number }): RouterPlan {
  const i = routerInput(tier), { tree, specs } = build(i);
  return layPlan<K, RouterLinkKind, RouterPlanInput>(`router|${i.tier}|${size.w}|${size.h}`, i, size, M, tree, specs, 'routerplan');
}
