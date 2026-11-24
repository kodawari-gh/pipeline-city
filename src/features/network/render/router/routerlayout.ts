import type { Rect } from '../plan/netplan';
import { ROUTER_DIE, routerPlan, type RouterPlan } from './routerplan';

// The router's die in its frame (docs/render/net.md "Inside the NIC and the router"). The router is built in 3D, part by part (board/render/three/routerboard3d.ts); only the SoC wears a
// floorplan (routerplan.ts), on its die under the lid that fades as the camera comes in, like the CPU's and the NIC's. The plan lives in a frame of its own, apart from the board's, so
// no two drawings share one. Like `nicGeo`, the hover ids are enumerated from here, so a part cannot be drawn without a description.

/** The die's rectangle in its frame: what the live layer and the baked floorplan cover (the frame's origin is the plan's). */
export const ROUTER_DIE_RECT: Rect = { x: 0, y: 0, w: ROUTER_DIE.w, h: ROUTER_DIE.h };

export interface RouterGeo {
  tier: number;
  /** The die's rectangle in its frame. Plan units are the frame's units. */
  die: Rect;
  plan: RouterPlan;
}

const cache = new Map<number, RouterGeo>();

/** The geometry of the SoC of the router of `tier`. */
export function routerGeo(tier: number): RouterGeo {
  const hit = cache.get(tier);
  if (hit) return hit;
  const geo: RouterGeo = { tier, die: ROUTER_DIE_RECT, plan: routerPlan(tier) };
  cache.set(tier, geo);
  return geo;
}

/** A hoverable part of the die: the id (`router.pkt`) and its rectangle in the die's frame. */
export interface RouterPart {
  id: string;
  rect: Rect;
}

/** Every block of the die with an id: the blocks and the SoC's frame (the smallest rectangle under the pointer wins). */
export const routerParts = (g: RouterGeo): RouterPart[] =>
  g.plan.blocks.map((b) => ({ id: `router.${b.id}`, rect: b.rect }));

/** The parts of the router that are 3D bodies on its board, not blocks of the die (routerboard3d.ts): the ids their picks and flights carry. The radio is the home routers' only. */
export const ROUTER_BODIES = [
  'router.dram',
  'router.flash',
  'router.wanphy',
  'router.lanphy',
  'router.radio',
  'router.power',
  'router.label',
] as const;

/** The ids of every part of the router of `tier`, for the hover table and its test: the 3D bodies on its board (the radio on the tiers that have one) and the die's blocks. */
export const routerIds = (tier: number): string[] => [
  ...ROUTER_BODIES.filter((id) => id !== 'router.radio' || routerPlan(tier).input.radio !== null),
  ...routerPlan(tier).blocks.map((b) => `router.${b.id}`),
];
