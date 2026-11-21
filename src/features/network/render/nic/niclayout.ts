import { BD, NIC_LEN, nicJack, nicY, type Rect } from '../../../board/render/layout/layout';
import { NIC_DIE, nicPlan, type NicPlan } from './nicplan';

// The NIC card in board space (docs/render/net.md "Inside the NIC and the router"). The card is built in 3D, part by part (board/render/three/nic3d.ts). Up close it lies flat, then
// turns over to show its component side; only the controller's die wears a floorplan (nicplan.ts), under the lid that fades as the camera comes in, like the CPU's. The die's
// plan lives in a frame of its own, apart from the board's: each card has its band (`NIC_BAND` along x), so two cards in one machine never share a drawing. Like `gpulayout`,
// the tooltip test enumerates the hover ids from here, so a part cannot be drawn without a description.

/** How far the card's lying strip reaches above the slot's line (the 3D card's finger tab is 140 high) and below it (the card's body: a GPU's reaches 450 too, the next slot's card starts 250 beyond). */
export const NIC_FACE = { north: 150, south: 450 } as const;

/** The card's lying strip, the area its flat pose covers (board space): from the jack's west end to the PCB's far end, from the tab's strip to the body's south edge. */
export const nicFaceRect = (slot: number, visual: string): Rect => {
  const j = nicJack(slot);
  return { x: j.x, y: nicY(slot) - NIC_FACE.north, w: BD.x - j.x + (NIC_LEN[visual] ?? 1500), h: NIC_FACE.north + NIC_FACE.south };
};

/**
 * Where a part of the card lies once the card has turned over (it turns about the strip's middle line, the bracket staying west): its rectangle mirrored in y about that line.
 * `r` is the part's rectangle as the 3D card builds it, on the component side seen through the PCB (the lying pose before the turn).
 */
export const turned = (r: Rect, slot: number, visual: string): Rect => {
  const f = nicFaceRect(slot, visual), mid = f.y + f.h / 2;
  return { x: r.x, y: 2 * mid - (r.y + r.h), w: r.w, h: r.h };
};

/** The distance between two cards' bands in the die's frame (plan units): wider than a plan. */
export const NIC_BAND = 1000;

export interface NicGeo {
  visual: string;
  /** The card's lying strip (`nicFaceRect`). */
  face: Rect;
  /** Where the die's plan (0, 0) lies in its frame: the card's band. Plan units are the frame's units. */
  origin: { x: number; y: number };
  /** The die's rectangle in its frame: what the live layer and the baked floorplan cover. */
  die: Rect;
  plan: NicPlan;
}

const cache = new Map<string, NicGeo>();

/** The geometry of the controller of the card of look `visual` in PCIe slot `slot`. */
export function nicGeo(visual: string, slot: number): NicGeo {
  const key = `${visual}|${slot}`, hit = cache.get(key);
  if (hit) return hit;
  const origin = { x: slot * NIC_BAND, y: 0 }, geo: NicGeo = { visual, face: nicFaceRect(slot, visual), origin, die: { x: origin.x, y: origin.y, w: NIC_DIE.w, h: NIC_DIE.h }, plan: nicPlan(visual) };
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
