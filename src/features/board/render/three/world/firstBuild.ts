// The boot's first build (board3d.ts, docs/render/load.md): the city in the window first, then the room a slice at a time, then the machine.
import { bootStage } from '@/app/boot';
import { effective, isLow } from '@/app/graphics';
import type { loadBaked } from '@/core/render/three/baked';
import { setLowDetail } from '@/core/render/three/detail';
import { Room3D, prepareCity } from '@/features/room/render/three/room3d';
import { setLayoutTier } from '../../layout/layout';
import { current, roomAt } from './build';
import { nextPaint, turn } from './consts';
import { rebuild } from './rebuild';
import type { Core } from './world';

/**
 * The city in the window first: its programs link on the driver's threads while the room is built. The city builds a step at a time, a paint
 * between (nothing links yet); once its programs start, no paint is waited for (it would wait for them), only a turn for the page.
 */
export async function buildFirst(c: Core, baked: ReturnType<typeof loadBaked>): Promise<void> {
  bootStage('Building the world', 0.14);
  await nextPaint();
  // (the buildings need no texture: they build in slices while the baked ones load, and the first step that paints with them waits for them)
  await prepareCity(
    c.stage.renderer,
    effective.peek().shadows,
    async (label, share) => {
      bootStage(label, 0.14 + 0.14 * share);
      await nextPaint();
    },
    baked,
  );
  setLowDetail(isLow(effective.peek())); // (before the first machine: Low builds coarser heat pipes and labels)
  bootStage('Furnishing the room', 0.3);
  await turn();
  // (the room builds a slice at a time, a turn between, no paint: the city's programs link meanwhile and a paint would wait for them)
  const first = roomAt(current(c));
  setLayoutTier(first.tier, first.caseTier);
  const room = await Room3D.make(
    c.stage.studio,
    async (label, share) => {
      bootStage(label, 0.3 + 0.04 * share);
      await turn();
    },
    turn,
  );
  rebuild(c, true, { room, key: first.key });
  bootStage('Assembling the machine', 0.34);
  await turn();
  rebuild(c);
}
