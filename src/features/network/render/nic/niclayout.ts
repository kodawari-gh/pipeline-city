import { BD, NIC_LEN, nicJack, nicY, type Rect } from '../../../board/render/layout/layout';
import { tabOf } from '../../../board/render/three/pcie';
import { NIC_LINK, NIC_PLAN, nicPlan, type NicPlan } from './nicplan';

// The NIC card in board space (docs/render/net.md "Inside the NIC and the router"). The card lies flat when the camera is close (card3d.ts: its parts fade, it swings
// down), and then its face shows what is inside: the card's plan (nicplan.ts) drawn on the PCB, with the jack's profile out of the bracket at the west end. The face is
// taller than the 2D strip the shop tile and the old board art use (`nicRect`): it reaches as far below the slot's line as a graphics card does. Like `gpulayout`, the
// tooltip test enumerates the hover ids from here, so a part cannot be drawn without a description.

/** How far the face reaches above the slot's line (the 3D card's finger tab is 140 high, so the face hides it, as a GPU's 150 does) and below it (the card's body: a GPU's reaches 450 too, the next slot's card starts 250 beyond). */
export const NIC_FACE = { north: 150, south: 450 } as const;
/** How far below the slot's line the plan starts (the gold fingers and the bus to them run in that band). */
export const NIC_PLAN_TOP = 28;

/** The card's face, the area its art and its live layer cover (board space): from the jack's west end to the PCB's far end, from the tab's strip to the body's south edge. */
export const nicFaceRect = (slot: number, visual: string): Rect => {
  const j = nicJack(slot);
  return { x: j.x, y: nicY(slot) - NIC_FACE.north, w: BD.x - j.x + (NIC_LEN[visual] ?? 1500), h: NIC_FACE.north + NIC_FACE.south };
};

export interface NicGeo {
  visual: string;
  /** The face (`nicFaceRect`). */
  face: Rect;
  /** Where the plan's (0, 0) lies in board space; plan units are layout units. */
  origin: { x: number; y: number };
  plan: NicPlan;
  /** The controller's frame in board space: what a double click flies to. */
  chip: Rect;
}

const cache = new Map<string, NicGeo>();

/** The geometry of the card of look `visual` in PCIe slot `slot`. */
export function nicGeo(visual: string, slot: number): NicGeo {
  const key = `${visual}|${slot}|${BD.x}|${nicY(slot)}`, hit = cache.get(key);
  if (hit) return hit;
  const origin = { x: BD.x + NIC_PLAN.margin, y: nicY(slot) + NIC_PLAN_TOP };
  // the fingers' x range, in plan units, from the card's tab
  const tab = tabOf(slot, BD.x + (NIC_LEN[visual] ?? 1500), (NIC_LINK[visual] ?? NIC_LINK['nic-gbe']!).lanes), plan = nicPlan(visual, { x0: tab.x - origin.x, x1: tab.x + tab.w - origin.x });
  const ctl = plan.blocks.find((b) => b.id === 'ctl')!.rect;
  const geo: NicGeo = { visual, face: nicFaceRect(slot, visual), origin, plan, chip: { x: origin.x + ctl.x, y: origin.y + ctl.y, w: ctl.w, h: ctl.h } };
  cache.set(key, geo);
  return geo;
}

/** A block's rectangle in board space. */
export const moveBy = (r: Rect, o: { x: number; y: number }): Rect => ({ x: r.x + o.x, y: r.y + o.y, w: r.w, h: r.h });

/** A hoverable part: the id without its slot (`nic-mac`; the full id is `pcie2.nic-mac`) and its board rectangle. */
export interface NicPart { id: string; rect: Rect }

/** Every part with an id: the blocks and the controller's frame (the smallest rectangle under the pointer wins). */
export const nicParts = (g: NicGeo): NicPart[] => g.plan.blocks.map((b) => ({ id: `nic-${b.id}`, rect: moveBy(b.rect, g.origin) }));

/** The ids of every part of a card in PCIe slot `slot` (its id, e.g. `pcie2`), for the hover table and its test. */
export const nicIds = (visual: string, slotId: string, slot: number): string[] => nicParts(nicGeo(visual, slot)).map((p) => `${slotId}.${p.id}`);
