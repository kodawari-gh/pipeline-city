// What the 3D world holds (board3d.ts): the room and the machine as built and their keys, a new machine whose programs still link, the
// programs of a new picture, Low's cheaper materials, and the room's probe and the metered eye.
import type { Object3D, WebGLCubeRenderTarget } from 'three';
import type { Program } from '@/core/render/three/compile';
import type { Cheap } from '@/core/render/three/cheapmaterials';
import type { Room } from '@/core/render/three/camera';
import type { Room3D } from '@/features/room/render/three/room3d';
import type { Machine3D } from '../machine3d';

export interface Held {
  room: Room3D | null;
  machine: Machine3D | null;
  roomKey: string;
  machKey: string;
  /** A new machine whose programs still link (`compile.ts`): the old one shows meanwhile, and the frame swaps them once they have linked. */
  next: { m: Machine3D; programs: Program[] } | null;
  /**
   * The programs of a new picture (the first, a new room, new graphics settings), started on its first frame (`warmed`): until they have
   * linked the frame draws nothing, and the canvas keeps its last picture.
   */
  linking: Program[] | null;
  warmed: boolean;
  /** The furniture the eye keeps out of (`eyeBlocks`), for the room as built. */
  blocks: Room[];
  /** Dev only (`__board.previewCase`): show this board and case tier, empty, whatever the game holds. */
  preview: { board: number; case: number } | null;
  /** Low's cheaper materials (`cheapMaterials`), by the root they were applied to: undone when the root goes or the tier leaves Low. */
  cheaps: Map<Object3D, Cheap>;
  // the room's own light, the window's and the lamps' as they bounce off its walls (probe.ts): captured again when that light changes, and
  // a few times over for a new room, as each capture holds the bounce of the one before; prefiltered, it is the scene's light at every zoom
  roomEnv: WebGLCubeRenderTarget | null;
  probeKey: string;
  probeAt: number;
  bounces: number;
  probed: boolean;
  // the metered eye: the meter's last reading, the exposure's factor it asks for, and where the eye stands on its way to it
  reading: number;
  metered: number;
  seen: number;
  /** The power lens darkens the picture on purpose: the metered eye holds where it stood, and drops the readings of the darkened frames that come after the lens ends. */
  heldReads: number;
}

/** Nothing built yet. */
export const newHeld = (): Held => ({
  room: null,
  machine: null,
  roomKey: '',
  machKey: '',
  next: null,
  linking: null,
  warmed: false,
  blocks: [],
  preview: null,
  cheaps: new Map<Object3D, Cheap>(),
  roomEnv: null,
  probeKey: '',
  probeAt: -Infinity,
  bounces: 0,
  probed: false,
  reading: 0,
  metered: 1,
  seen: 1,
  heldReads: 0,
});
