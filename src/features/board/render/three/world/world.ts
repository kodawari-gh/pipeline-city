// The 3D world's state (board3d.ts), by part: what is built (`Core`), the view (`Cam`), a gesture's hold (`Grip`), the hands and the pointers
// (`Hands`), and the frame's clock (`Clock`). Each module takes the parts it reads.
import type { OrbitView } from '@/core/render/three/camera';
import type { FrameGate, FrameMeter, SlowWatch, TierWatch } from '@/app/graphics';
import type { attachPad } from '@/core/render/three/pad';
import type { PlugHand } from '../plughand3d';
import type { Drag3D } from '../drag3d';
import type { Cues3D } from '../cues3d';
import type { Held } from './held';
import type { Live } from './live';
import type { Stage } from './stage';

/** The renderer, what is built and the live layers: all the boot needs. */
export interface Core {
  stage: Stage;
  held: Held;
  live: Live;
}

/** The view: where the eye is and where it goes, and what holds or moves it. */
export interface Cam {
  /** Dev only: while the shot tool holds its eye (`unclamped`), the view is as given; the prod build has no such branch. */
  unclamped: boolean;
  /** How far the title's view turns each side (0: the player asked for reduced motion). */
  sway: number;
  /** The title shows (no game yet): the view turns over the room (`menuView`); the game's start flies it to the overview. */
  menu: boolean;
  view: OrbitView;
  goal: OrbitView;
  /** A flight runs (`flyTo`): the first touch of the view catches it where it is. */
  flying: boolean;
  /** The flight the tutorial asked for (`flyToId`): told whether the view arrived, or was cut short by the player or another flight. */
  pending: ((arrived: boolean) => void) | null;
  /** The view is the overview the player has not moved off: it fits itself again when the HUD's inset changes. */
  atOverview: boolean;
  /** The game's first flight, from the title's view to the overview: on its way the view does not shrink in the desk's shadow either (`keepWhole`), or the first frames would flash its underside. */
  intro: boolean;
  /**
   * The network lens brings the camera in to its window when the view is farther out than that (a view already as close, in the case or at the board, stays as the
   * player has it). `netGoal` is the view it flew to and `netBack` where it came from: when the lens ends and the player has not moved the view since, the camera goes back.
   */
  netGoal: OrbitView | null;
  netBack: { view: OrbitView; overview: boolean } | null;
  /** What the cards and the pointer line place themselves by: they measure again when this changes (`cameraRev`). */
  revKey: string;
}

/** The view a turn starts from and the angles it has reached. */
export interface Turning {
  base: OrbitView;
  ref: number;
  yaw: number;
  pitch: number;
}

/**
 * A gesture's hold: the loose plugs' screen centres (measured again after a moment: they fall and the camera moves); the depth of the surface a
 * pan or a pinch took hold of (the pan goes at it, so it stays under the fingers), the point a pinch zooms about (null: no surface under it), and a
 * turn's start: the view it turns from, and the angles it has reached (a turn that runs into a wall or a piece of furniture comes back to the
 * player's own height when it turns away again).
 */
export interface Grip {
  plugs: { at: number; key: string; list: { id: string; x: number; y: number; reach?: number }[] };
  grabZ: number | undefined;
  pinchAt: { x: number; y: number; z: number } | null | undefined;
  turning: Turning | null;
}

/** What the view functions read: the core, the view and the gesture's hold. */
export interface Scope extends Core {
  cam: Cam;
  grip: Grip;
}

/** A cable's plug held in the scene (plughand3d.ts), the parts dragged in or lifted off (drag3d.ts), the tutorial's cues and the pad. */
export interface Hands {
  hand: PlugHand;
  lift: Drag3D;
  cues: Cues3D;
  pointers: ReturnType<typeof attachPad>;
}

/** The frame's watches: the frame rate's gate and meter, the slow-frames watch (auto-adjust) and the tier's. */
export interface Watches {
  gate: FrameGate;
  meter: FrameMeter;
  watch: SlowWatch;
  tierWatch: TierWatch;
}

/** The frame's clock and its marks. */
export interface Clock extends Watches {
  /** The game's time of day (ms) and the last frame's time. */
  gt: number;
  last: number;
  /** The layout's tier and case as last framed: a new case is a new room. */
  wasTier: string;
  /** The boot screen has gone (`onShown` ends the mount's wait); when the last programs linked; when the last still was saved. */
  revealed: boolean;
  linkedAt: number;
  stillAt: number;
  onShown: () => void;
  shown: Promise<void>;
  /** The stage covered the room on the last tick (the first tick back draws); the outline's parts as last drawn. */
  wasCovered: boolean;
  outlineKey: string;
}

/** The whole world, once the boot has built it. */
export interface World extends Scope {
  hands: Hands;
  clock: Clock;
}
