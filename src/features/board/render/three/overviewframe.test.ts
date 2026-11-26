// The room's overview under a tall card (ticket #44: the tutorial's 360 px tab, at 1920 x 1080 the card and the dock take 369 px of the bottom). `inFree` moves the overview's
// target down by the HUD's inset; a target a little under the desk's top has the desk's slab between it and the eye, and `keepInside` then shrinks the view to a sliver
// (the first frame was a view 1,600 units high, the underside of the desk and the blind, where the room shows 44,000). This runs the real room's furniture and walls.
import { describe, expect, it } from 'vitest';
import * as camera from '@/core/render/three/camera';
import { roomGeo } from '@/features/room/render/shell/room';
import { eyeBlocks, eyeRoom } from '@/features/room/render/three/roomplan';

// the overview's own: the room's angle, the target's depth at the back wall, and how far behind it a target may lie (`board3d.ts`: ROOM_ANGLE, LOOK_Z, TARGET_Z0)
const ROOM_ANGLE = { yaw: 0, pitch: 0.09, fov: 26 },
  LOOK_Z = 5000,
  TARGET_Z0 = -3000;
const room = eyeRoom(),
  blocks = eyeBlocks(roomGeo());
const opts = { targetZ0: TARGET_Z0, fovBase: ROOM_ANGLE.fov, restore: true, blocks };

/** The overview's view before the room has its say: the middle of the room's window at the wall, taller than the eye can reach (the free band is a third of the screen). */
const centred: camera.OrbitView = { ...ROOM_ANGLE, x: -12_165, y: 2070, z: LOOK_Z, height: 48_000 };
/** The view with its target moved down by `px` screen pixels of a 1080 px screen: the inset's pan (`inFree`; half of the bottom inset less the top one: 153 px at 1920 x 1080). */
const moved = (px: number): camera.OrbitView => camera.panBy(centred, 0, (-px * centred.height) / 1080);

const whole = (v: camera.OrbitView) => camera.keepInside(v, room, { ...opts, blocks: [] }).height;

describe('the overview under a card at the bottom', () => {
  const sweep = Array.from({ length: 125 }, (_, i) => i * 2); // pans of 0 to 250 px: the tutorial's card gives 153 at 1920 x 1080, 204 at 2560 x 1440

  it('has a target the desk shadows: keepInside shrinks the view to a sliver there', () => {
    const slivers = sweep.filter((px) => camera.keepInside(moved(px), room, opts).height < whole(moved(px)) * 0.2);
    expect(
      slivers.length,
      "no pan puts the target in the desk's shadow: the room changed, move this test to where it does",
    ).toBeGreaterThan(0);
  });

  function assert_keeps_its_height_whatever_the_inset_moves_the_ta(): void {
    for (const px of sweep) {
      const v = moved(px);
      expect(camera.keepWhole(v, room, opts).height, `the target ${px} px down`).toBeGreaterThan(whole(v) * 0.6);
    }
  }

  it('keeps its height whatever the inset moves the target by', () => {
    expect.hasAssertions();
    assert_keeps_its_height_whatever_the_inset_moves_the_ta();
  });

  function assert_moves_the_target_a_little_under_a_twentieth_of_t(): void {
    for (const px of sweep) {
      const v = moved(px),
        k = camera.keepWhole(v, room, opts);
      expect(Math.abs(k.y - v.y), `the target ${px} px down`).toBeLessThan(k.height / 20);
      expect([k.x, k.yaw, k.pitch]).toStrictEqual([v.x, v.yaw, v.pitch]);
    }
  }

  it('moves the target a little (under a twentieth of the picture), not into another place', () => {
    expect.hasAssertions();
    assert_moves_the_target_a_little_under_a_twentieth_of_t();
  });
});
