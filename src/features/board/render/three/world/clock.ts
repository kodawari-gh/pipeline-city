// The 3D world's clock (board3d.ts): the frame's watches, the game's time of day, and the marks the frame keeps (the boot screen gone, the
// last link, the last still).
import { effect } from '@preact/signals';
import { debugOverride, FrameGate, FrameMeter, graphics, SlowWatch, TierWatch } from '@/app/graphics';
import { DAY_S, START_HOUR } from '@/features/room/render/shell/room';
import { START_HOUR_3D } from '@/features/room/render/three/roomplan';
import { LAYOUT_CASE, LAYOUT_TIER } from '../../layout/layout';
import type { Clock, Watches } from './world';

/** The slow-frames watch and the tier's start over. */
export const resetWatches = (w: Watches, now: number): void => {
  w.watch.reset(now);
  w.tierWatch.reset(now);
};

/** The clock at the boot. */
export function newClock(): Clock {
  const watches: Watches = {
    gate: new FrameGate(),
    meter: new FrameMeter(),
    watch: new SlowWatch(),
    tierWatch: new TierWatch(),
  };
  // a new choice of the player's starts the watch over, as a new picture bakes and compiles its way in
  effect(() => {
    void graphics.value;
    void debugOverride.value;
    resetWatches(watches, performance.now());
  });
  const gt = (((START_HOUR_3D - START_HOUR + 24) % 24) / 24) * DAY_S * 1000,
    last = performance.now(),
    wasTier = `${LAYOUT_TIER}|${LAYOUT_CASE}`;
  const box: { done?: () => void } = {};
  const shown = new Promise<void>((resolve) => {
    box.done = resolve;
  });
  return {
    ...watches,
    gt,
    last,
    wasTier,
    revealed: false,
    linkedAt: 0,
    stillAt: 0,
    onShown: () => box.done?.(),
    shown,
    wasCovered: false,
    outlineKey: '',
  };
}
