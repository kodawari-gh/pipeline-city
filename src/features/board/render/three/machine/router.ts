// The router's detailed view in the room (machine3d.ts): its board, the die's art, its reveals and its rails, made again when a router of another
// tier stands.
import { FINISH } from '@/core/render/three/artlod';
import { routerDie } from '@/features/network/render/router/routerart';
import { routerGeo } from '@/features/network/render/router/routerlayout';
import { LV_DIE } from '../artset3d';
import { routerStand } from '../router3d';
import { routerBoard } from '../routerboard3d';
import { routerTier } from '../studiowall3d';
import { relist } from './list';
import type { ArtSurface, MachineParts, Snapshot } from './types';
import { dropRouter, placeBoard, routerLists } from './router-parts';

/**
 * The router's detailed view (docs/render/net.md "Inside the NIC and the router"): its board, built in 3D part by part, lies in the shell on the room's shelf (`routerboard3d.ts`). As the zoom
 * comes in the room fades the shell away (`onRouterShell`) and the board shows through, where it lies; the SoC's lid fades over the die's own band and the die's floorplan shows, live
 * (`Chips3D`). The board and each of its parts is a rail (a double click flies to it, looking down on it: `Rail.lie`). Made again when the router of another tier stands (the room builds that
 * router again, `Room3D.routerBuild`); none on the Build my PC stage, whose wall has a router of its own.
 */
export function buildRouter(m: MachineParts, s: Snapshot | null): void {
  const tier = m.inRoom && m.chips !== null && m.shown === 'machine' ? routerTier(s?.net?.router?.id) : null;
  if (tier === (m.routerBits?.tier ?? null)) {
    return;
  }
  dropRouter(m);
  if (tier === null || !m.chips) {
    m.chips?.setRouter(null);
    return;
  }
  const stand = routerStand(tier),
    geo = routerGeo(tier),
    art = m.art.baker(() => routerDie(m.T, tier)),
    held: { surface: ArtSurface | null } = { surface: null };
  const board = routerBoard(tier, stand, (frame, S) => {
    const surface = m.art.surface(frame, art.bake, geo.die, 1 / S, LV_DIE, FINISH.die);
    held.surface = surface;
    return { root: surface.root, z: 3 / S };
  });
  placeBoard(m, board, stand);
  m.chips.setRouter(geo);
  if (board.die) {
    m.chips.face(board.die.root, 'router', board.die.rect, board.die.z);
  }
  m.routerBits = { tier, board, art, surface: held.surface, ...routerLists(m, board, stand) };
  relist(m);
}
