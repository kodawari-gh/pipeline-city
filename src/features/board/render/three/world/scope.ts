// The world's view at the boot (board3d.ts): the title's sway, the title or the game, the view it starts at, and the network lens's flight.
import { snapshot } from '@/app/store';
import type { OrbitView } from '@/core/render/three/camera';
import { MENU_SWAY } from './consts';
import { watchNetLens } from './netFlight';
import { menuView, overview } from './view';
import type { Cam, Core, Grip, Scope } from './world';

/** A view for the moment the camera is made: the real one needs the camera (`menuView` and `overview` read it), and replaces it at once. */
const BLANK: OrbitView = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 26, height: 1 };

/** The view of the built world: the title's (it turns over the room, no pointer) or the game's overview. */
export function openScope(c: Core): Scope {
  /** Before a game (the title over the live room): the overview, turning slowly a little way each side round its target. */
  const sway = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : MENU_SWAY;
  const menu = !snapshot.peek();
  c.stage.canvas.style.pointerEvents = menu ? 'none' : ''; // (the main menu's room is a picture: no hover, no click, no zoom)
  const cam: Cam = {
    unclamped: false,
    sway,
    menu,
    view: BLANK,
    goal: BLANK,
    flying: false,
    pending: null,
    atOverview: false,
    intro: false,
    netGoal: null,
    netBack: null,
    revKey: '',
  };
  const grip: Grip = {
    plugs: { at: -Infinity, key: '', list: [] },
    grabZ: undefined,
    pinchAt: undefined,
    turning: null,
  };
  const s: Scope = { ...c, cam, grip };
  const view = menu ? menuView(s, performance.now() / 1000) : overview(s);
  cam.view = view;
  cam.goal = view;
  watchNetLens(s);
  return s;
}
