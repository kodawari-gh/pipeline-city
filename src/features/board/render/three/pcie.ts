// A PCIe card's edge as the CEM spec has it: the finger tab, its key, each pin's place along the tab, and both faces' pinouts. Pure geometry in
// layout units (23 a mm), shared by the cards' 3D (card3d.ts) and the NIC's routed copper (niccopper.ts).
//
// The pinout is named from the system board's side: side A's PER pairs are the system's receivers, so the card transmits on them (its AC
// coupling capacitors sit on those lines); side B's PET pairs are the system's transmitters, the card's receivers. Side B is the card's
// component side, side A its solder side.
import { PCIE_RAILS } from '../layout/layout';

const MM = 23;
/** How far the finger tab reaches below the slot's line, down into the slot. */
export const TAB = 140;
/** The key's notch along the tab from its bracket end (the short run carries the power pins), and its width. */
export const KEY = { at: 11.65 * MM, w: 1.9 * MM };
/** A gold finger: its width (1 mm pitch), its length, and how far in from the tab's edge it starts. */
export const FINGER = { w: 0.7 * MM, len: 4.2 * MM, from: 0.5 * MM };
/** The pins on each face of an edge `lanes` wide (the CEM spec: 18, 32, 49, 82). */
export const edgePins = (lanes: number) => (lanes <= 1 ? 18 : lanes <= 4 ? 32 : lanes <= 8 ? 49 : 82);
/** The tab's length for `lanes`: the 11 pins to the key, the key, the rest, half a pitch past the last. */
export const tabLen = (lanes: number) => KEY.at + KEY.w + (edgePins(lanes) - 10.5) * MM;
/**
 * A card's finger tab in slot `slot` (layout x: its bracket end and length): `lanes` wide, cut short where the card (to `x1`) or the slot ends
 * first (card3d's `pcieTab`; a NIC's copper is routed for it).
 */
export function tabOf(slot: number, x1: number, lanes: number): { x: number; w: number } {
  const rail = PCIE_RAILS[slot]!;
  return { x: rail.x + 20, w: Math.min(Math.min(rail.w, x1 - rail.x) - 40, tabLen(lanes)) };
}
/** Pin `p`'s middle along the tab from its bracket end (1 mm apart, the key between 11 and 12). */
export const pinAt = (p: number) => (p <= 11 ? (p - 0.5) * MM : KEY.at + KEY.w + (p - 11.5) * MM);
/** Side B's PETp pin of lane `k` (its PETn the next one). */
export const txPin = (k: number) => (k === 0 ? 14 : k < 4 ? 19 + 4 * (k - 1) : k < 8 ? 33 + 4 * (k - 4) : 50 + 4 * (k - 8));
/** Side A's PERp pin of lane `k` (its PERn the next one). */
export const rxPin = (k: number) => (k === 0 ? 16 : k < 4 ? 21 + 4 * (k - 1) : k < 8 ? 35 + 4 * (k - 4) : 52 + 4 * (k - 8));

const lane = (side: 'PER' | 'PET', k: number) => [`${side}${k}+`, `${side}${k}-`];
const G = 'GND';
/** Side A, pins 1 to 49 (an x8 edge; an x1 or x4 one stops at 18 or 32). */
export const SIDE_A: readonly string[] = [
  'PRSNT1#', '+12V', '+12V', G, 'TCK', 'TDI', 'TDO', 'TMS', '+3V3', '+3V3', 'PERST#', G, 'REFCLK+', 'REFCLK-', G, ...lane('PER', 0), G,
  'RSVD', G, ...lane('PER', 1), G, G, ...lane('PER', 2), G, G, ...lane('PER', 3), G, 'RSVD',
  'RSVD', G, ...lane('PER', 4), G, G, ...lane('PER', 5), G, G, ...lane('PER', 6), G, G, ...lane('PER', 7), G,
];
/** Side B, pins 1 to 49. */
export const SIDE_B: readonly string[] = [
  '+12V', '+12V', '+12V', G, 'SMCLK', 'SMDAT', G, '+3V3', 'TRST#', '+3VAUX', 'WAKE#', 'RSVD', G, ...lane('PET', 0), G, 'PRSNT2#', G,
  ...lane('PET', 1), G, G, ...lane('PET', 2), G, G, ...lane('PET', 3), G, 'RSVD', 'PRSNT2#', G,
  ...lane('PET', 4), G, G, ...lane('PET', 5), G, G, ...lane('PET', 6), G, G, ...lane('PET', 7), G, 'PRSNT2#', G,
];

/**
 * Pin `p`'s net on side `side` of an edge `lanes` wide. Only the last PRSNT2# is wired (PRSNT1# loops to it: the slot reads the card's width);
 * the others, the JTAG and SMBus pins and the reserved ones are left bare.
 */
export function edgeNet(side: 'A' | 'B', p: number, lanes: number): string {
  const n = (side === 'A' ? SIDE_A : SIDE_B)[p - 1] ?? 'NC';
  if (n === 'PRSNT2#') return p === edgePins(lanes) - 1 ? n : 'NC';
  return n;
}
