import { drawBoot } from './boot';
import { drawBadge, drawPowerGood } from './draw';
import { frameBuses, frameCables, frameCards, frameDrives, frameFans, frameGlows } from './frame';
import { drawOsBar } from './osScreen';
import { framePsu } from './psu';
import { frameStandby } from './screen';
import type { LiveState } from './state';

/** Per-frame animation. dt in seconds; `now` is game time in ms. */
export function tick(s: LiveState, dt: number, at: { now: number; paused: boolean }): void {
  const { now, paused } = at;
  s.gt = now;
  const inner = s.interior;
  frameStandby(s);
  s.phase += dt * 260 * s.clockRatio;
  frameFans(s, dt);
  if (s.hasPsu && inner) {
    framePsu(s, dt);
  }
  if (inner) {
    frameGlows(s, now);
  }
  // ---- buses and cables ----
  frameBuses(s, dt, now);
  let k = frameCables(s, dt);
  frameDrives(s, dt, now);
  while (k < s.dots.length) {
    const sp = s.dots[k++];
    if (sp) {
      sp.visible = false;
    }
  }
  s.busFlow.frame(now, s.zoom, inner);
  s.extFlow.frame(now, s.zoom, true);
  drawOsBar(s, now);
  if (inner) {
    drawBadge(s, now);
    drawPowerGood(s);
  }
  drawBoot(s, now, dt);
  frameCards(s, dt, paused);
  // (the chips no longer flash at random: the memory map lights the line the CPU touches, and only that stick's bus lights)
  s.dramFlash.clear();
}
