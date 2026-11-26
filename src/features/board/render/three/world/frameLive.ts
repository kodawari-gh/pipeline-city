// The frame's live layers (board3d.ts): the machine's detail, the dies' replay at the game's pace, the particles, the lenses, the board's
// traffic, the tutorial's cues, the bakes, and the room at its hour.
import { speed, zoomSlowOn, zoomSlowdown } from '@/app/store';
import type { Graphics } from '@/app/graphics';
import type { Snapshot } from '@/worker/protocol';
import { worldPace, zoomSlow } from '@/core/render/lod/lod';
import { TEXTURE_LEVELS } from '@/core/render/three/artlod';
import { CYCLES_PER_SEC } from '@/features/cpu/render/die/diemotion';
import { hourAt, roomDebug, roomState } from '@/features/room/render/shell/room';
import type { World } from './world';

/** What a step of the frame reads: the snapshot, the step (s), the pixel ratio and the settings. */
export interface Step {
  s: Snapshot | null;
  dt: number;
  ratio: number;
  g: Graphics;
}

/** The dies' replay: at the game's pace, slower as the camera comes in so a block can be followed (as board.ts); the HUD says so. */
const layersStep = (w: World, { s, dt, ratio, g }: Step): void => {
  const { stage, held, live, cam } = w,
    { camera, H } = stage;
  held.machine?.lod(camera, H, ratio * (TEXTURE_LEVELS[g.textures] ?? 1));
  const scale = worldPace(speed.peek()),
    pace = zoomSlowOn.peek() ? zoomSlow(H / cam.view.height, CYCLES_PER_SEC, scale) : scale,
    note = scale > 0 ? Math.round((pace / scale) * 100) / 100 : 1;
  if (zoomSlowdown.peek() !== note) {
    zoomSlowdown.value = note;
  }
  live.chips.frame(camera, H, dt * pace, speed.peek() <= 0, ratio);
  live.fx.frame(s, dt * worldPace(speed.peek()));
  live.lens.frame(camera, H, s, dt * worldPace(speed.peek()), ratio, held.machine);
  live.boardLive.frame(camera, H, s, dt * pace, speed.peek() <= 0, ratio, held.machine !== null);
  held.room?.setScreenImage(live.boardLive.screen);
  w.hands.cues.frame(cam.menu ? null : s);
  stage.bakes.run(6);
};

/** The monitor's screen as the room shows it. */
const screenOf = (s: Snapshot | null) => ({
  installed: s?.devices.some((d) => d.kind === 'display') === true,
  powered: s?.monitorPowered === true,
  live: s?.monitorLive === true && s.monitorPowered && s.powered && Boolean(s.display),
  text: s?.display ?? '',
});

/** The network as the room shows it: the router's and the plan's tiers, the plan's name, and mail on its way out. */
const netOf = (s: Snapshot | null) => ({
  router: s ? Number(/\d+$/u.exec(s.net?.router?.id ?? '')?.[0] ?? 0) : 1,
  isp: Number(/\d+$/u.exec(s?.net?.isp?.id ?? '')?.[0] ?? 0),
  ispName: s?.net?.isp?.name ?? '',
  mail: s !== null && Boolean(s.net) && (s.net.uploadsWaiting > 0 || s.net.transfers.some((t) => t.dir === 'up')),
});

/** The room at its hour (on the game's clock: it holds while paused); the Ethernet jacks' lights as they stand (`LinkLeds.step`). */
const roomStep = (w: World, { s, dt }: Step): { hour: number; net: ReturnType<World['live']['leds']['step']> } => {
  const hour = roomDebug.hour ?? hourAt(w.clock.gt);
  const net = w.live.leds.step(s, dt * worldPace(speed.peek()));
  w.held.room?.frame(
    {
      hour,
      lamp: roomState.lamp,
      blind: roomState.blind,
      screen: screenOf(s),
      ...netOf(s),
      t: w.clock.gt / 1000,
      net,
    },
    dt,
  );
  return { hour, net };
};

/** The live layers and the room; the room's hour and the jacks' lights, for the eye and the machine. */
export const liveStep = (w: World, p: Step): ReturnType<typeof roomStep> => {
  layersStep(w, p);
  return roomStep(w, p);
};
