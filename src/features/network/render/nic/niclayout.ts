import { BD, NIC_LEN, nicJack, nicY, type Rect } from '../../../board/render/layout/layout';
import { BOARD_LINK, BOARD_NIC, NIC_DIE, nicPlan, type NicPlan } from './nicplan';

// The NIC card in board space (docs/render/net.md "Inside the NIC and the router"). The card is built in 3D, part by part (board/render/three/nic3d.ts). It stands in its slot with its
// parts down, as every card does in a tower. Up close it folds down flat to the north, over its slot's line, its component side up: its fingers stay at its slot, its bracket west. Only
// the controller's die wears a floorplan (nicplan.ts), under the lid that fades as the camera comes in, like the CPU's. The die's
// plan lives in a frame of its own, apart from the board's: each card has its band (`NIC_BAND` along x), so two cards in one machine never share a drawing. Like `gpulayout`,
// the tooltip test enumerates the hover ids from here, so a part cannot be drawn without a description.

/** How far the card's flat strip reaches above the slot's line (over the card's body: the strip's width is a GPU's; the next slot's card starts 100 beyond) and below it (the 3D card's finger tab is 140 high). */
export const NIC_FACE = { north: 450, south: 150 } as const;

/** The card's flat strip, the area its flat pose covers (board space): from the jack's west end to the PCB's far end, from the body's north edge to the finger tab's south edge. */
export const nicFaceRect = (slot: number, visual: string): Rect => {
  const j = nicJack(slot);
  return { x: j.x, y: nicY(slot) - NIC_FACE.north, w: BD.x - j.x + (NIC_LEN[visual] ?? 1500), h: NIC_FACE.north + NIC_FACE.south };
};

/**
 * Where a part of the card lies once the card has folded flat (it turns over about its slot's line, the bracket staying west): its rectangle mirrored in y about that line.
 * `r` is the part's rectangle as the 3D card builds it, on the component side seen through the PCB (the card as it stands: its body south of the line, its parts under it).
 */
export const folded = (r: Rect, slot: number): Rect => ({ x: r.x, y: 2 * nicY(slot) - (r.y + r.h), w: r.w, h: r.h });

/** The flat strip as the 3D card builds it: the same strip turned over about the slot's line (its body south of the line, its finger tab north of it). */
export const nicBuildRect = (slot: number, visual: string): Rect => folded(nicFaceRect(slot, visual), slot);

/** The distance between two cards' bands in the die's frame (plan units): wider than a plan. */
export const NIC_BAND = 1000;

/** The band of the Ethernet chip on the motherboard (`BOARD_LINK`): past the four slots' cards, so it never shares a drawing with one. */
export const BOARD_BAND = 8;

export interface NicGeo {
  visual: string;
  /** The card's flat strip (`nicFaceRect`); null for the chip on the motherboard, which has no card. */
  face: Rect | null;
  /** Where the die's plan (0, 0) lies in its frame: the card's band. Plan units are the frame's units. */
  origin: { x: number; y: number };
  /** The die's rectangle in its frame: what the live layer and the baked floorplan cover. */
  die: Rect;
  plan: NicPlan;
}

const cache = new Map<string, NicGeo>();

/** The geometry of the controller of the card of look `visual` in PCIe slot `slot` (the chip on the motherboard: its look, `BOARD_BAND`). */
export function nicGeo(visual: string, slot: number): NicGeo {
  const key = `${visual}|${slot}`, hit = cache.get(key);
  if (hit) return hit;
  const origin = { x: slot * NIC_BAND, y: 0 }, geo: NicGeo = { visual, face: visual in BOARD_LINK ? null : nicFaceRect(slot, visual), origin, die: { x: origin.x, y: origin.y, w: NIC_DIE.w, h: NIC_DIE.h }, plan: nicPlan(visual) };
  cache.set(key, geo);
  return geo;
}

/** A block's rectangle in the die's frame. */
export const moveBy = (r: Rect, o: { x: number; y: number }): Rect => ({ x: r.x + o.x, y: r.y + o.y, w: r.w, h: r.h });

/** A hoverable part of the die: the id without its slot (`nic-mac`; the full id is `pcie2.nic-mac`) and its rectangle in the die's frame. */
export interface NicPart { id: string; rect: Rect }

/** Every block of the die with an id: the blocks and the controller's frame (the smallest rectangle under the pointer wins). */
export const nicParts = (g: NicGeo): NicPart[] => g.plan.blocks.map((b) => ({ id: `nic-${b.id}`, rect: moveBy(b.rect, g.origin) }));

/** The parts of the card that are 3D bodies, not blocks of the die (nic3d.ts): the ids their picks and flights carry. */
export const NIC_BODIES = ['nic-jack', 'nic-edge', 'nic-xtal', 'nic-nvm', 'nic-vreg', 'nic-label'] as const;

/** The ids of every part of a card in PCIe slot `slot` (its id, e.g. `pcie2`), for the hover table and its test: the 3D bodies and the die's blocks. */
export const nicIds = (visual: string, slotId: string, slot: number): string[] => [...NIC_BODIES, ...nicParts(nicGeo(visual, slot)).map((p) => p.id)].map((id) => `${slotId}.${id}`);

/** The ids of every part of the Ethernet chip on the motherboard of look `visual` (`board.nic-ctl` and the blocks of its die): the same, for the hover table and its test. */
export const boardNicIds = (visual: string): string[] => nicParts(nicGeo(visual, BOARD_BAND)).map((p) => `${BOARD_NIC}.${p.id}`);
