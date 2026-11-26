// The room's build, a step at a time (`Room3D.make`): the shell, the window and the bench, the furniture, the desk and what stands on it, the
// column's things, the light; then the baked occlusion and the merges. A `yield` with a name says what comes next and how far along the
// build is (0 to 1); a bare one only offers a turn to the page.
import { vertexAoPooled, vertexAoSteps } from '@/core/render/three/vertexao';
import { bed } from '../furniture/bed';
import { nightstand } from '../furniture/lanterns';
import { furnish } from './furnish';
import { finishRoom } from './settle';
import { buildDesk, buildShell } from './stages';
import { startBuild } from './start';
import type { Ao, RoomParts, RoomStep, Texture } from './types';

/** The room's geometry and lights, in steps (`env`: the studio's environment, the reflections' first; `ao`: the occlusion's pool, if any). */
export function* buildRoom(
  room: RoomParts,
  env: Texture | null,
  ao: Ao | null,
): Generator<RoomStep | Promise<unknown> | undefined> {
  const { b, built } = startBuild(room);
  buildShell(b);
  yield;
  const bd = bed(),
    ns = nightstand();
  yield;
  furnish(b, bd, ns);
  yield { label: 'Setting the desk', share: 0.2 };
  buildDesk(b, env);
  // the props' and the plants' baked occlusion (cast once here: 0.8 s on this thread a slice at a time, 0.3 s on a pool of workers that `make`
  // gives it, the page waiting), then the still scenery in few draws
  yield { label: 'Shading the corners', share: 0.4 };
  if (ao) {
    yield vertexAoPooled(room.root, ao.pool, ao.slice);
  } else {
    // a bare step (each of `vertexAoSteps`') only offers the page a turn
    const steps = vertexAoSteps(room.root);
    for (let s = steps.next(); s.done !== true; s = steps.next()) {
      yield;
    }
  }
  yield { label: 'Tidying the room', share: 0.95 };
  finishRoom(room);
  built();
}
