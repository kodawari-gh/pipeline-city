// What the board shows and the machine in its place (board3d.ts): Low's cheaper materials on a root, a new machine put in the scene, the
// snapshot as the board shows it, and the room's tiers for it.
import type { Object3D } from 'three';
import { effective, isLow } from '@/app/graphics';
import { snapshot } from '@/app/store';
import { cheapMaterials } from '@/core/render/three/cheapmaterials';
import { caseShaded } from '@/core/render/three/caseshade';
import { lowDetail } from '@/core/render/three/detail';
import type { Machine3D } from '../machine3d';
import type { Core } from './world';

// (a machine keeps High's materials: its metal reads by reflection and the GPU time is the same, 5.2 ms a board frame at 2560 x 1355.
// It takes the case's shadow on its spot lights in place of the shadow maps Low does not draw, `caseshade.ts`)
export const cheap = ({ held }: Core, root: Object3D): void => {
  if (!isLow(effective.peek()) || held.cheaps.has(root)) {
    return;
  }
  held.cheaps.set(root, root === held.room?.root ? cheapMaterials(root) : caseShaded(root));
};
export const uncheap = ({ held }: Core, root: Object3D): void => {
  held.cheaps.get(root)?.undo();
  held.cheaps.delete(root);
};
/** Puts `m` in the scene in the machine's place. */
export const install = (c: Core, m: Machine3D): void => {
  const { held, stage } = c;
  if (held.machine) {
    held.machine.onRouterShell = null;
    uncheap(c, held.machine.root);
    stage.scene.remove(held.machine.root);
    held.machine.dispose();
  }
  held.machine = m;
  // (the zoom takes the router's shell away to show its board: the room owns the shell)
  m.onRouterShell = (a) => held.room?.setRouterShell(a);
  stage.scene.add(m.root);
  cheap(c, m.root);
  stage.demand.ask();
};
/** What the board shows: the game's snapshot, or the dev preview's board and case in its place. */
export const current = ({ held }: Core): ReturnType<typeof snapshot.peek> => {
  const live = snapshot.peek(),
    { preview } = held;
  return preview && live
    ? { ...live, boardTier: preview.board, caseTier: preview.case, devices: [], cables: [], plugged: null }
    : live;
};
/** The tiers the room stands at for a snapshot, and its key. */
export const roomAt = (s: ReturnType<typeof current>): { tier: number; caseTier: number; key: string } => {
  const tier = s?.boardTier ?? 0,
    caseTier = Math.max(tier, s?.caseTier ?? tier);
  // (the room's parts are built coarser at Low and merged there: a tier change across the Low line rebuilds it, as the machine's key does)
  return { tier, caseTier, key: `${tier}|${caseTier}|${lowDetail() ? 'low' : 'high'}` };
};
