// The pieces of the router's detailed view (machine3d.ts): taking the old one down, merging its board, and its reveals and rails in the lists.
import { DEVICE_LOD, dieZoom, smooth } from '@/core/render/lod/lod';
import { disposeTree } from '@/core/render/three/geometry';
import { mergeSiblings } from '@/core/render/three/merge';
import { shareMaterials } from '@/core/render/three/materials';
import { lowDetail } from '@/core/render/three/detail';
import { lieAt, revealAt, revealOver } from '../parts';
import { relist } from './list';
import type { MachineParts, RouterBoard, RouterStand } from './types';

/** Take the old router's board away: its tree, its die's art, and the room's shell back whole. */
export function dropRouter(m: MachineParts): void {
  const old = m.routerBits;
  if (!old) {
    return;
  }
  old.board.root.removeFromParent();
  disposeTree(old.board.root);
  if (old.surface) {
    m.art.drop(old.surface, old.art);
  }
  m.onRouterShell?.(1);
  m.routerBits = null;
  relist(m);
}

/** The router's board as it lies in the shell, hidden until the shell is going, merged as the build merged the rest if it ran already. */
export function placeBoard(m: MachineParts, board: RouterBoard, stand: RouterStand): void {
  board.root.position.set(stand.ox, -stand.oy, stand.front);
  board.root.scale.setScalar(stand.k);
  // (hidden until the shell is going: no stand-in is made for it, and it draws nothing from afar)
  board.root.visible = false;
  m.root.add(board.root);
  if (m.merged && m.shared) {
    const skip = [...m.keep],
      apart = [...m.fades, ...m.apart, board.root, board.lid];
    mergeSiblings(board.root, { skip, apart, pbr: true });
    shareMaterials(board.root, { skip, apart, across: lowDetail() });
  }
}

/** The router's reveals (the shell fades and the board shows; the die's lid) and its rails (the board, each part, the die). */
export function routerLists(
  m: MachineParts,
  board: RouterBoard,
  stand: RouterStand,
): Pick<NonNullable<MachineParts['routerBits']>, 'reveals' | 'rails'> {
  const { fade } = DEVICE_LOD.router;
  const reveals = [
    revealOver(stand.face, stand.front, (zoom) => {
      const f = smooth(fade[0], fade[1], zoom);
      board.root.visible = f > 0.01;
      board.show(f);
      m.onRouterShell?.(1 - f);
    }),
  ];
  const rails = [lieAt('router', board.face, fade[1])];
  for (const b of board.bodies) {
    if (!(board.die && b.id === 'router.soc')) {
      rails.push(lieAt(b.id, b, DEVICE_LOD.router.detail));
    }
  }
  if (board.die) {
    const { at } = board.die;
    reveals.push(revealAt({ x: at.x, y: -at.y, w: at.w, h: 0 }, at.z, board.lod));
    rails.push(lieAt('router.soc', at, dieZoom(board.die.scale * board.die.rect.w)));
  }
  return { reveals, rails };
}
