// The 3D world's mount (board3d.ts, docs/render/load.md): the boot in its order, from the renderer to the boot screen's end.
import { newClock } from './clock';
import { followPage } from './effects';
import { buildFirst } from './firstBuild';
import { followGraphics } from './graphics';
import { openHands } from './hands';
import { listenKeys } from './keys';
import { runWorld } from './run';
import { openScope } from './scope';
import { startWorld } from './start';
import type { World } from './world';

/**
 * Mounts the 3D world behind the boot screen (docs/render/load.md): it builds the room and the machine, waits for the room's light bake, links
 * every program on the driver's threads while the page still draws, lets the room's light settle, then ends the boot screen.
 */
export async function mountBoard3d(host: HTMLElement): Promise<void> {
  const { core, baked } = await startWorld(host);
  await buildFirst(core, baked);
  const scope = openScope(core);
  const hands = openHands(scope);
  listenKeys(scope);
  followPage(core);
  followGraphics(core);
  const w: World = { ...scope, hands, clock: newClock() };
  await runWorld(w);
}
