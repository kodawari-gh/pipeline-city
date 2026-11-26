// The 3D world's live layers (board3d.ts): the dies, the lenses, the board's traffic, the particles and the Ethernet jacks' lights.
import { warmLateModels } from '@/core/render/three/gltf';
import { startPrograms, startShadowPrograms } from '@/core/render/three/compile';
import { LinkLeds } from '@/features/network/render/jackleds';
import { Chips3D } from '../chips3d';
import { Lens3D } from '../lens3d';
import { BoardLive3D } from '../boardlive3d';
import { Particles3D } from '../particles3d';
import type { Held } from './held';
import type { Stage } from './stage';
import type { Core } from './world';

export interface Live {
  /** The dies alive: the 2D die views, kept across rebuilds (chips3d.ts). */
  chips: Chips3D;
  lens: Lens3D;
  boardLive: BoardLive3D;
  fx: Particles3D;
  /** The Ethernet jacks' lights (the board's and the cards', the router's in the room): they follow the frames the port carries (`network/render/jackleds.ts`). */
  leds: LinkLeds;
}

/** The live layers on the stage; a model that joins late links its own programs (`warmLateModels`). */
function createLive(stage: Stage, held: Held): Live {
  const { scene, renderer, camera } = stage;
  const chips = new Chips3D();
  const lens = new Lens3D(scene, renderer.domElement);
  const boardLive = new BoardLive3D(scene);
  const fx = new Particles3D(scene);
  const leds = new LinkLeds();
  // a model that joins after those programs have started (a slow network: the mouse, the hoodie, a part's) links its own while it is hidden (`joinModel`)
  warmLateModels(scene, (model) =>
    held.warmed
      ? [...startPrograms(renderer, model, camera, { scene }), ...startShadowPrograms(renderer, scene, camera, model)]
      : null,
  );
  return { chips, lens, boardLive, fx, leds };
}

/** What is built and the live layers on the stage: all the boot needs. */
export const openCore = (stage: Stage, held: Held): Core => ({ stage, held, live: createLive(stage, held) });
