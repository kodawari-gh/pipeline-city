// The board of a router lying in its shell, for the places that have no room to run it: the gallery's turntable and the Build my PC stage's wall (the room's router runs the same board in
// `Machine3D.buildRouter`, whose zoom reveals it live). As the camera comes in the shell fades away and the board shows through; then the SoC's lid fades over the die and its floorplan shows.
// The shell and the board share the router's own frame, so the board goes where the shell goes.
import { Object3D, type Group } from 'three';
import { DEVICE_LOD, smooth } from '@/core/render/lod/lod';
import { FINISH, fadeTree } from '@/core/render/three/artlod';
import type { Theme } from '@/core/render/theme';
import { routerDie } from '@/features/network/render/router/routerart';
import { routerGeo } from '@/features/network/render/router/routerlayout';
import { LV_DIE, type ArtSet } from './artset3d';
import { ROUTER_BODY, ROUTER_SIZE, ROUTER_UNDER, type RouterModel } from './router3d';
import { routerBoard } from './routerboard3d';

/**
 * Put the board of the router of `tier` in the frame the router model `m` stands in (`parent`, the router's own frame at scale 1, built to `ROUTER_BODY` deep). `art`: the set that bakes the die
 * and runs the reveals. Returns what takes it away again (its reveals, its die's face and its baker).
 */
export function routerInsides(art: ArtSet, T: Theme, tier: number, parent: Group, m: RouterModel): () => void {
  const geo = routerGeo(tier),
    die = art.baker(() => routerDie(T, tier)),
    held: { surface: ReturnType<ArtSet['surface']> | null } = { surface: null };
  const board = routerBoard(
    tier,
    { k: 1, front: 0, face: { x: 0, y: 0, w: 0, h: 0 }, depth: m.size.depth || ROUTER_BODY, ox: 0, oy: 0 },
    (frame, S) => {
      held.surface = art.surface(frame, die.bake, geo.die, 1 / S, LV_DIE, FINISH.die);
      return { root: held.surface.root, z: 3 / S };
    },
  );
  // (hidden until the shell is going)
  board.root.visible = false;
  parent.add(board.root);
  const over = (l: { x: number; w: number; y: number; z: number }): Object3D => {
    const o = new Object3D();
    o.position.set(l.x + l.w / 2, l.y, l.z);
    parent.add(o);
    return o;
  };
  // (the shell's zoom is read at its front bezel's middle, as the room reads it: the router's own front face is z = 0 in its frame)
  const size = ROUTER_SIZE[tier] ?? ROUTER_SIZE[1]!,
    [a, b] = DEVICE_LOD.router.fade,
    marks = [over({ x: -size.w / 2, w: 0, y: ROUTER_UNDER + (size.h - ROUTER_UNDER) / 2, z: 0 })],
    undo = [
      art.reveal(marks[0]!, (zoom) => {
        const f = smooth(a, b, zoom);
        board.root.visible = f > 0.01;
        board.show(f);
        fadeTree(m.shell, 1 - f);
      }),
    ];
  if (board.die) {
    marks.push(over(board.die.at));
    undo.push(art.reveal(marks[1]!, board.lod));
  }
  return () => {
    for (const u of undo) u();
    for (const o of marks) o.removeFromParent();
    board.root.removeFromParent();
    if (held.surface) art.drop(held.surface, die);
  };
}
