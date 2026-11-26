// The frame's eye (board3d.ts): it adapts, as a camera's exposure does (`src/features/room/light.md`), set in the room's views and metered
// from the board view in; and the still of the room the next boot screen shows.
import type { Graphics } from '@/app/graphics';
import { saveStill } from '@/app/boot';
import { applyView, heightAt } from '@/core/render/three/camera';
import { HIGH_C, MID } from '@/core/render/three/localeye';
import { roomness } from '@/core/render/three/post';
import { daylight } from '@/features/room/render/three/roomplan';
import { LOOK_Z, NIGHT_EYE, NIGHT_HIGH, NIGHT_KEY, STILL_MS } from './consts';
import { aspect, overview } from './view';
import type { World } from './world';

/** The eye of a frame: the height shown at `LOOK_Z`, the power lens's dark, how near the eye is (0 in the room's views) and the daylight. */
export interface Eye {
  seenH: number;
  dark: boolean;
  near: number;
  day: number;
}

/**
 * (the local eye's night key is the room's: low-key, pools of lamp light. From the board view in it is the day's: the metered eye has
 * already put the board's mean where it reads, and the local eye lifts the parts in the case's shade round it, `BOARD_EYE`)
 */
const eyeAt = (w: World, nr: number, day: number): void => {
  w.stage.post.setEye(
    (NIGHT_EYE ** (1 - day)) ** (1 - nr) * w.held.seen ** nr,
    MID ** Math.max(day, nr) * NIGHT_KEY ** (1 - Math.max(day, nr)),
    HIGH_C + (NIGHT_HIGH - HIGH_C) * (1 - day),
  );
};

/** (How near the eye is, by the height shown at `LOOK_Z`: the same picture reads the same whatever its target.) */
export const eyeStep = (w: World, hour: number): Eye => {
  const { post } = w.stage;
  const seenH = heightAt(w.cam.view, LOOK_Z),
    { dark } = w.live.lens;
  // (the local eye is out while the power lens darkens the picture, or it would lift the dark back up)
  post.setDark(dark);
  post.setReach(seenH);
  // (the set eye and the metered one blend in log over the zoom; the metered one eases toward its reading over about half a second)
  const near = 1 - roomness(seenH);
  const day = daylight(hour);
  eyeAt(w, near, day);
  return { seenH, dark, near, day };
};

/**
 * A still of the room for the next boot screen: always from the overview's fixed angle, whatever the player looks at. A draw of its own, before
 * the frame's (which paints over it), in the same task: the buffer is not kept, so it is copied right after the draw.
 * (not while the power lens darkens the picture: the title would show the dark)
 */
export const stillStep = (w: World, p: { now: number; on: boolean; g: Graphics; eye: Eye }): void => {
  const { stage, clock, cam } = w,
    { now, eye } = p,
    { camera, renderer, scene, post } = stage;
  if (!(clock.revealed && p.on && !eye.dark && now - clock.stillAt > STILL_MS)) {
    return;
  }
  clock.stillAt = now;
  const ov = overview(w),
    h = heightAt(ov, LOOK_Z),
    nr = 1 - roomness(h);
  applyView(camera, ov, aspect(w));
  post.setReach(h);
  eyeAt(w, nr, eye.day);
  w.held.room?.drawOutside(renderer, scene, camera, p.g.msaa);
  post.render();
  saveStill(stage.canvas);
  applyView(camera, cam.view, aspect(w));
  post.setReach(eye.seenH);
  eyeAt(w, eye.near, eye.day);
};
