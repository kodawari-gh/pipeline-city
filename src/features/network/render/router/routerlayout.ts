import type { Rect } from '../plan/netplan';
import { ROUTER_PLAN_W, routerPlan, type RouterPlan } from './routerplan';

// The router in world space (docs/render/net.md "Inside the NIC and the router"). The router stands on its shelf in the room, its front toward the viewer; its detailed view lies over
// that front: the router's plan (routerplan.ts) drawn on a panel the size of the front bezel, `ROUTER_PLAN_W` plan units across (a plan unit is about one world unit). The front's rectangle comes from the
// 3D model's own placement (`routerFit` in board/render/three/router3d.ts, the one `room3d.ts` uses), so this file knows no 3D: the tests build the geometry from any rectangle. Like
// `nicGeo`, the hover and flight ids are enumerated from here, so a part cannot be drawn without a description.

export interface RouterGeo {
  tier: number;
  /** The panel, the area the art and the live layer cover (world, layout units: x east, y down): the front bezel. */
  face: Rect;
  /** Where the plan's (0, 0) lies in the world, and how many world units a plan unit is (about 1). */
  origin: { x: number; y: number };
  scale: number;
  plan: RouterPlan;
}

const cache = new Map<string, RouterGeo>();

/** The geometry of the router of `tier` whose front bezel is `front` (world). */
export function routerGeo(tier: number, front: Rect): RouterGeo {
  const key = `${tier}|${front.x}|${front.y}|${front.w}|${front.h}`, hit = cache.get(key);
  if (hit) return hit;
  const S = front.w / ROUTER_PLAN_W, size = { w: ROUTER_PLAN_W, h: Math.round(front.h / S) };
  const geo: RouterGeo = { tier, face: { x: front.x, y: front.y, w: front.w, h: size.h * S }, origin: { x: front.x, y: front.y }, scale: S, plan: routerPlan(tier, size) };
  cache.set(key, geo);
  return geo;
}

/** A plan rectangle in the world. */
export const worldRect = (g: Pick<RouterGeo, 'origin' | 'scale'>, r: Rect): Rect => ({ x: g.origin.x + r.x * g.scale, y: g.origin.y + r.y * g.scale, w: r.w * g.scale, h: r.h * g.scale });

/** A hoverable part: its id (`router.soc`) and its world rectangle. */
export interface RouterPart { id: string; rect: Rect }

/** Every part with an id: the blocks and the SoC's frame (the smallest rectangle under the pointer wins). */
export const routerParts = (g: RouterGeo): RouterPart[] => g.plan.blocks.map((b) => ({ id: `router.${b.id}`, rect: worldRect(g, b.rect) }));

/** What a double click flies to: the whole panel (`router`) and each part. */
export const routerRails = (g: RouterGeo): RouterPart[] => [{ id: 'router', rect: g.face }, ...routerParts(g)];

/** The ids of every part of the router of `tier`, for the hover table and its test. */
export const routerIds = (tier: number): string[] => routerPlan(tier, { w: ROUTER_PLAN_W, h: 460 }).blocks.map((b) => `router.${b.id}`);
