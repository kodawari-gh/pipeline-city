// The 3D world's start (board3d.ts): the renderer on the page, the light maps loading, the debug overlay behind its flag, the stage and the live layers.
import { bootStage } from '@/app/boot';
import { whenDebug } from '@/app/debugflag';
import { readTheme } from '@/core/render/theme';
import { loadBaked } from '@/core/render/three/baked';
import { createRenderContext } from '@/core/render/three/init';
import { cityLayers, cityMesh, preloadRoomBake } from '@/features/room/render/three/room3d';
import { nextPaint } from './consts';
import { newHeld } from './held';
import { openCore } from './live';
import { createStage } from './stage';

/** The renderer in `host`, and the KTX2 maps loading (`public/tex/`: they load while the page sets up, and the first build waits for them). */
export async function startWorld(
  host: HTMLElement,
): Promise<{ core: ReturnType<typeof openCore>; baked: ReturnType<typeof loadBaked> }> {
  bootStage('Starting the renderer', 0.1);
  await nextPaint();
  const T = readTheme();
  const ctx = createRenderContext(host, T.bg);
  const { renderer, canvas } = ctx;
  preloadRoomBake(renderer); // (the light maps come as KTX2 in the formats of this GPU; the files load while the page sets up)
  const baked = loadBaked(renderer);
  const held = newHeld();
  void whenDebug(location.search, async () => import('@/app/debug/overlay'), {
    renderer,
    canvas,
    roots: () => ({ city: cityMesh(), machine: held.machine?.root ?? null, layers: cityLayers() }),
  });
  const core = openCore(createStage(ctx, host), held);
  return { core, baked };
}
