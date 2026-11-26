// The frame's view (board3d.ts): the title's sway or the game's start, the eye eased toward its goal and kept in the room, the flights that
// arrive, and the key the cards and the pointer line place themselves by.
import { cameraRev } from '@/app/interaction';
import { hover, viewInset } from '@/app/hover';
import { snapshot } from '@/app/store';
import type { Snapshot } from '@/worker/protocol';
import { applyView, keepWhole, settled, stepView } from '@/core/render/three/camera';
import { eyeRoom } from '@/features/room/render/three/roomplan';
import { flyToRoom } from './flights';
import { aspect, inRoom, keeping, menuView, overview } from './view';
import type { Scope } from './world';

/** The title shows (no game yet): the view turns over the room; the game's start flies it to the overview. */
const menuStep = (s: Scope, snap: Snapshot | null, now: number): void => {
  const { cam } = s;
  if (!snap) {
    cam.goal = menuView(s, now / 1000);
  } else if (cam.menu) {
    flyToRoom(s);
    cam.intro = true;
  }
  if (cam.menu !== !snap) {
    cam.menu = !snap;
    s.stage.canvas.style.pointerEvents = cam.menu ? 'none' : '';
  }
  if (cam.menu && hover.peek()) {
    hover.value = null;
  }
};

/** The eye eases toward its goal; a flight that has arrived says so. */
const ease = (s: Scope, dt: number): void => {
  const { cam } = s;
  const { goal, intro, atOverview } = cam;
  let { view } = cam;
  const eased = stepView(view, goal, dt);
  view =
    intro && atOverview && !(import.meta.env.DEV && cam.unclamped)
      ? keepWhole(eased, eyeRoom(), keeping(s, false), 0.6, goal.y)
      : inRoom(s, eased, false);
  cam.view = view;
  if (cam.intro && settled(view, goal)) {
    cam.intro = false;
  }
  if (cam.flying && settled(view, goal)) {
    cam.flying = false;
  }
  if (cam.pending && settled(view, goal)) {
    const p = cam.pending;
    cam.pending = null;
    p(true);
  }
};

/** What the cards and the pointer line place themselves by; the HUD's inset changed while the overview shows: fit it again to what is left free. */
const remeasure = (s: Scope): void => {
  const { cam, stage } = s,
    { view } = cam;
  const ins = viewInset.peek(),
    insKey = `${ins.left}|${ins.right}|${ins.top}|${ins.bottom}`;
  const plugged =
    snapshot
      .peek()
      ?.cables.map((c) => Number(c.connected))
      .join('') ?? '';
  const rk = `${view.x.toFixed(1)}|${view.y.toFixed(1)}|${view.z.toFixed(1)}|${view.height.toFixed(1)}|${view.yaw.toFixed(3)}|${view.pitch.toFixed(3)}|${stage.W}|${stage.H}|${insKey}|${s.held.machKey}|${plugged}`;
  if (cam.atOverview && !cam.revKey.includes(insKey)) {
    cam.goal = overview(s);
  }
  if (rk !== cam.revKey) {
    cam.revKey = rk;
    cameraRev.value += 1;
  }
};

/** The frame's view. (The camera goes where the player and the flights put it, nothing else: no part turns it.) */
export function viewStep(s: Scope, snap: Snapshot | null, p: { now: number; dt: number }): void {
  menuStep(s, snap, p.now);
  ease(s, p.dt);
  applyView(s.stage.camera, s.cam.view, aspect(s));
  remeasure(s);
}
