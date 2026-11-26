// The frame's light (board3d.ts): the room's probe, a face a frame; the shadow maps of the next frame; the frame meter, the auto tier, a new
// case framed again, and the boot screen gone once the room's light has settled.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { awayHeld, isLow, stepTier, tierRecord, watchFps } from '@/app/graphics';
import type { Graphics } from '@/app/graphics';
import type { Snapshot } from '@/worker/protocol';
import { probePlan } from '@/core/render/three/cheapmaterials';
import { PROBE_K } from '@/features/room/render/three/room3d';
import { LAYOUT_CASE, LAYOUT_TIER } from '../../layout/layout';
import { resetWatches } from './clock';
import { PROBE_MS, REVEAL_MS } from './consts';
import { flyToRoom } from './flights';
import type { World } from './world';

/** The probe takes a face a frame, between the draw and the shadows' scan, so it uses no shadow redraw of the next frame's. */
export const probeStep = (w: World, p: { now: number; draw: boolean; s: Snapshot | null; g: Graphics }): void => {
  const { held, stage } = w,
    { probe, scene } = stage,
    { room } = held;
  if (!(room && p.draw)) {
    return;
  }
  const key = `${room.lightKey}|${p.s?.powered === true}`;
  const plan = probePlan({
    low: isLow(p.g),
    probed: held.probed,
    busy: probe.busy,
    bounces: held.bounces,
    keyChanged: key !== held.probeKey,
    waited: p.now - held.probeAt > PROBE_MS,
  });
  held.bounces = plan.bounces;
  if (plan.request) {
    probe.request();
    held.probeKey = key;
    held.probeAt = p.now;
  }
  // one light for all: the machine and the dies' art take the room's probe as the room's own materials do (`RoomEnv`), at every zoom
  if (probe.step(stage.renderer, scene, held.machine?.root ?? null)) {
    const env = stage.pmrem.fromCubemap(probe.texture, held.roomEnv);
    held.roomEnv = env;
    scene.environment = env.texture;
    scene.environmentIntensity = PROBE_K;
    if (!held.probed) {
      room.setProbe(env.texture);
      held.probed = true;
    }
    stage.demand.ask();
  }
};

/**
 * The shadow maps of the next frame: the draw has just set every world matrix, so what the scan sees is this frame's (no light casts: no map is
 * drawn and the scan waits. The first scan after a map turns on sees every change made since). Then the frame meter, and the auto tier: one
 * decision from the first seconds of frames; manual mode never steps (only frames the renderer drew count: an idle frame is cheap on any
 * device; so is a frame the away limit holds down).
 */
export const tierStep = (
  w: World,
  p: { now: number; draw: boolean; g: Graphics; fps: number; rawDt: number; t0: number },
): void => {
  const { stage, clock } = w,
    { room } = w.held,
    { now, draw, g } = p;
  if (draw && room && room.scanShadows(stage.shadows, stage.scene, now)) {
    stage.demand.ask();
  }
  clock.meter.tick(now, stage.canvas.width, stage.canvas.height);
  if (draw && tierRecord.peek().mode === 'auto' && document.visibilityState === 'visible' && !awayHeld(p.fps, g.fps)) {
    const dir = clock.tierWatch.tick(p.rawDt, performance.now() - p.t0, now, watchFps(g, g.fps));
    if (dir !== null) {
      stepTier(dir);
    }
  }
};

/** A new case is a new room: frame it again. The boot screen goes once the room's light has settled (the probe's bounces), or at the latest `REVEAL_MS` after the link. */
export const revealStep = (w: World, now: number): void => {
  const { clock, held } = w;
  const tierNow = `${LAYOUT_TIER}|${LAYOUT_CASE}`;
  if (tierNow !== clock.wasTier) {
    clock.wasTier = tierNow;
    flyToRoom(w);
  }
  if (
    !clock.revealed &&
    ((held.probed && held.bounces === 0 && !w.stage.probe.busy) || now - clock.linkedAt > REVEAL_MS)
  ) {
    clock.revealed = true;
    resetWatches(clock, now);
    clock.onShown();
  }
};
