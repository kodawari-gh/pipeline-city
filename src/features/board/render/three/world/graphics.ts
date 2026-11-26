// The graphics settings (app/graphics.ts) in the 3D world (board3d.ts): the detail, the passes, the lights, Low's materials, the live layers,
// the particles and the textures' filtering.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { effect } from '@preact/signals';
import { effective, isLow } from '@/app/graphics';
import type { Graphics } from '@/app/graphics';
import { setLowDetail } from '@/core/render/three/detail';
import { anisotropy, refilter } from '@/core/render/three/geometry';
import { LIVE_LEVELS } from '../chips3d';
import { cheap, uncheap } from './build';
import { PARTICLE_LEVELS } from './consts';
import { rebuild } from './rebuild';
import type { Core } from './world';

/** The room's and the machines' lights, and Low's cheaper materials: on for the room and the machines, off (originals back) when the tier leaves Low. */
const applyLooks = (c: Core, g: Graphics): void => {
  const { room, machine, next, cheaps } = c.held;
  room?.setShadows(g.shadows);
  room?.setLights(g.lights, g.lightShadows > 0);
  if (room) {
    for (const m of [machine, next?.m]) {
      m?.setLights(room.liveLights);
    }
  } // (the cap counts the machine's RGB too)
  if (isLow(g)) {
    for (const r of [room?.root, machine?.root, next?.m.root]) {
      if (r) {
        cheap(c, r);
      }
    }
  } else {
    // oxlint-disable-next-line unicorn/no-useless-spread -- `uncheap` deletes from the map: the loop walks a copy of its keys
    for (const root of [...cheaps.keys()]) {
      uncheap(c, root);
    }
  }
  for (const ch of cheaps.values()) {
    ch.sync();
  } // (the tier's program-level state; the live values need none)
};

const applyGraphics = (c: Core, g: Graphics): void => {
  const { stage, held, live } = c;
  // Low's coarser parts: crossing the Low line builds the machine again (`machineKey` carries it)
  if (setLowDetail(isLow(g))) {
    rebuild(c);
  }
  stage.post.apply(g, stage.renderer, stage.W, stage.H);
  applyLooks(c, g);
  // (a shadow map more or less makes every lit program again: the frame links them before it draws)
  held.warmed = false;
  stage.shadows.reset();
  const level = LIVE_LEVELS[g.live] ?? LIVE_LEVELS[2];
  live.boardLive.level = level;
  live.chips.live = level;
  live.fx.density = PARTICLE_LEVELS[g.particles] ?? 1;
  if (g.filtering !== anisotropy) {
    refilter(stage.scene, g.filtering);
  }
  stage.demand.ask();
};

/** The settings as they are, and each change of them. */
export function followGraphics(c: Core): void {
  effect(() => {
    applyGraphics(c, effective.value);
  });
}
