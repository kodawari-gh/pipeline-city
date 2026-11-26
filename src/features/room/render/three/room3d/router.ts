// The router on its shelf: its tier's model (`router3d.ts`) with the LAN jack on its east side (`jack.ts`), built again when the tier
// changes; its shell fades in `fade.ts`.
import { Group } from 'three';
import { disposeTree } from '@/core/render/three/geometry';
import { lowDetail } from '@/core/render/three/detail';
import { glows, mergeStatic, mergeWithin } from '@/core/render/three/merge';
import { tag } from '@/core/render/three/pick';
import { ROUTER_SPOT } from '@/features/board/render/layout/layout';
import { routerModel, routerStand } from '@/features/board/render/three/router3d';
import { routerKit, sideJack } from './jack';
import { shellGlowsOf } from './fade';
import type { Object3D, RoomParts, RouterKit } from './types';

/** The old router out, and freed. */
function clearRouter(router: Group): void {
  for (let c = router.children.at(0); c; c = router.children.at(0)) {
    router.remove(c);
    disposeTree(c);
  }
}

/** Is `o` in the shell? */
function inShell(o: Object3D, shell: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) {
    if (p === shell) {
      return true;
    }
  }
  return false;
}

/**
 * The router of `tier`: its tier's look is the shared model's (`router3d.ts`, as the gallery and the studio's wall show it), in the router's
 * spot at one scale (the tier's box fits it), its east end and feet on the shelf, its front 1400 out.
 */
function buildRouter(kit: RouterKit, tier: number): void {
  const { room, router } = kit;
  clearRouter(router);
  const { k, front, depth, ox, oy } = routerStand(tier, ROUTER_SPOT);
  // (the wall hides its back, so it has none. The lead's cord goes into the side jack, the patch lead into the WAN jack: those two have lights, the other four jacks have no cable)
  const m = routerModel(tier, { depth, fine: !lowDetail(), rear: false, drive: [4] });
  m.root.position.set(ox, -oy, front);
  m.root.scale.setScalar(k);
  router.add(m.root);
  // (the shell fades away to show the board: its own materials, its own palette merges, no shadow once it is thin)
  room.routerShell = m.shell;
  room.routerAlpha = 1;
  room.shellCasters = [];
  const { side, look } = sideJack(tier, kit);
  router.add(side);
  // (the frames light them: `frame`)
  room.routerLamps = { lan: look, wan: m.jacks[4] ?? null };
  mergeWithin(router, { twin: room.envTwin, apart: [m.shell] }); // (the router's plates, vents and jacks in a few draws, every tier; the shell keeps palette materials of its own, for its fade)
  // (Low: its status lights and its jacks' lenses in one draw a colour, where each light was a draw; CITY-06. The shell's lights merge within the shell: they fade with it)
  if (lowDetail()) {
    mergeStatic(m.shell, { ok: glows });
    mergeStatic(router, { own: true, ok: (x) => glows(x) && !inShell(x, m.shell) });
  }
  room.shellGlows = shellGlowsOf(m.shell);
}

/**
 * The router: black, as the other things on the wall, at tier 1 until the frame asks for another (`routerBuild`). Its tiers: the home router
 * with its two aerials and four lights; the gigabit one, with stouter aerials and a row of lights; the 10G switch-router: no aerials, fins and
 * a lit bar; the edge router: a rack unit with its ears, a row of cages and two rows of lights.
 */
export function makeRouter(room: RoomParts): Group {
  const router = tag(new Group(), 'router');
  // (its baked occlusion, 3 cm out: the antennas' hinges, its foot on the shelf; `vertexao.ts`)
  router.userData['ao'] = 560;
  const kit = routerKit(room, router);
  room.routerBuild = (tier) => {
    if (tier !== room.routerTier) {
      room.routerTier = tier;
      buildRouter(kit, tier);
    }
  };
  room.routerBuild(1);
  return router;
}
