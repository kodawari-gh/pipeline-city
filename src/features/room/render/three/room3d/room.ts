// The 3D room: a bedroom in a high-rise flat round the desk, modern and minimal, dark to sit with the game's interface (slate walls in one even
// plaster whose fine relief only raking light shows, `plasterMaps`; smoked oak,
// black-brown flat-pack furniture, cyan LED light at night; tones in `palette.ts`). A closed box at real sizes (`roomplan.ts`): a glass wall
// behind the desk, floor to ceiling, onto the city in 3D (`outside/view.ts`; the glass looks north and is tinted, so the day stays soft), the
// building's column in it, a stone bench along it; oak planks and a rug, the bed and its bedside drawer east of the desk, a bookcase and the door
// on the west wall (`furniture/`). On and over the desk: the monitor, keyboard, mouse, tea cup, architect lamp, the key stand; on the
// column: the digital clock, the router on its shelf, the letterbox and the wall plates (`props3d.ts`). x and y of the desk's things come from
// the 2D layout (`roomGeo`, `layout.ts`, y flipped), z is the distance out of the back wall. The lamps are real lamps (lumens, kelvin) and the
// evening turns them on in steps: the floor lantern and the shelves' strips at dusk, the bed's cyan strips, then the bedside lantern, the
// picture light and the door's sconce; the arc lamp stays on at every hour (the desk's overhead light, through the case's glass: the board
// reads by the room's light, a case needs none of its own); the desk lamp is the player's, the monitor's bias light is on with its screen. The
// lamps and the sun light directly, with their shadows; their bounce on the still meshes is baked (`npm run bake`, `LightmapMix`). The window
// (its sky, by day the sunlit city below it, at night the city's glow) is a wide light: the bake holds all of it on the still meshes, and the
// `key` stands in for it on what moves. The room's probe is the bounce on all that moves. No light fills from nowhere; the eye adapts to the
// dark (`localeye.ts`). The sim knows nothing of it.
// This module is the class: its parts are `parts.ts`, its build `build.ts`, its frame `frame.ts`.
import { makeAoPool } from '@/core/render/three/aopool';
import { takeBake } from './bake';
import { buildRoom } from './build';
import { frameRoom } from './frame';
import { setKeys } from './keys';
import { castersOf, lightGroups, mixLight } from './lights';
import { RoomParts } from './parts';
import { setRouterShell } from './fade';
import { disposeRoom, followDetail, redrawShadows, setCityDetail, setLights, setShadows } from './shadows';
import type {
  Ao,
  AoPool,
  Bake,
  CityDetail,
  KeySnap,
  Light,
  LightId,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Program,
  RoomFrame,
  RoomStep,
  Scene,
  SpotLight,
  Texture,
  WebGLRenderer,
} from './types';

/** A step of the build as `make` takes it: a promise to wait on, a named step for the boot screen, or a bare turn for the page. */
async function takeStep(
  v: RoomStep | Promise<unknown> | undefined,
  between: (label: string, share: number) => Promise<void>,
  slice: () => Promise<void>,
): Promise<void> {
  if (v instanceof Promise) {
    await v;
  } else if (v) {
    await between(v.label, v.share);
  } else {
    await slice();
  }
}

/** The build's steps one after another, from the next on, the page answering between them. */
async function runSteps(
  run: ReturnType<typeof buildRoom>,
  between: (label: string, share: number) => Promise<void>,
  slice: () => Promise<void>,
): Promise<void> {
  const step = run.next();
  if (step.done === true) {
    return;
  }
  await takeStep(step.value ?? undefined, between, slice);
  await runSteps(run, between, slice);
}

/**
 * How `make` slices the room's long step (the baked occlusion): `slice` runs between its finer slices and need not paint (by default a turn
 * for the page); `pool`: the workers that cast it (by default a new pool; null: on the page's thread).
 */
interface RoomSlices {
  slice?: () => Promise<void>;
  pool?: AoPool | null;
}

/** What the window's view is drawn for (`drawOutside`): this frame's camera, and the scene target's multisampling. */
interface OutsideFrame {
  camera: PerspectiveCamera;
  samples: number;
}

/** A turn for the page: the next task. */
const nextTurn = async (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

export class Room3D extends RoomParts {
  /**
   * `defer`: build the fields only; the caller runs `assemble` (`make` does, a step at a time, so the page can answer between them). Without
   * it the room is built at once, which holds the page for 1.2 to 1.6 s (docs/render/load.md).
   */
  constructor(env: Texture | null = null, defer = false) {
    super();
    if (!defer) {
      const run = this.assemble(env);
      while (run.next().done !== true) {
        /* every step in a row */
      }
    }
  }

  /**
   * The room built a step at a time: `between` runs before each (told its name and how far along the build is, 0 to 1), so the boot screen can
   * say it and the page can paint; `slice` runs between the finer slices of a long step (the baked occlusion) and need not paint. The same
   * room as `new Room3D(env)`.
   */
  static async make(
    env: Texture | null,
    between: (label: string, share: number) => Promise<void>,
    { slice = nextTurn, pool = makeAoPool() }: RoomSlices = {},
  ): Promise<Room3D> {
    const room = new Room3D(env, true),
      run = room.assemble(env, pool && { pool, slice });
    try {
      await runSteps(run, between, slice);
    } finally {
      pool?.dispose();
    }
    return room;
  }

  /** The room's geometry and lights, in steps (`buildRoom`). The constructor runs them in a row. */
  private assemble(env: Texture | null, ao: Ao | null = null): ReturnType<typeof buildRoom> {
    return buildRoom(this, env, ao);
  }

  /**
   * Starts linking the programs the window's view draws with (`compile.ts`), and the bake's mix: the room's own come with the scene it stands
   * in. Call it after a first `frame`, so its lights stand as they will be drawn.
   */
  startPrograms(r: WebGLRenderer, scene: Scene): Program[] {
    return [...this.outside.startPrograms(r, scene), ...(this.lightmap?.startPrograms(r) ?? [])];
  }

  /**
   * The baked bounce's light groups: the lights the room scales by one value (a switch, a step of the evening). `tools/bake/` bakes each at
   * its lights' full power, and the mix scales it by its first light's intensity over the one baked.
   */
  lightGroups(): { id: string; lights: Light[] }[] {
    return lightGroups(this);
  }

  /** The bake's lightmap on the meshes it knows. The others keep the probe; the dev build names them (the bake is older than the room). */
  takeBake(b: Bake): void {
    takeBake(this, b);
  }

  /**
   * The room's own light for its materials' ambient light and reflections, in place of the studio's: a `Probe` of the room, which holds the day
   * and the night as they fall in it, so it is not dimmed by the hour.
   */
  setProbe(t: Texture): void {
    this.probe = true;
    this.box.on.value = 1;
    this.envs.setMap(t);
  }

  /** Does any light of the room cast a shadow? With none, no map is drawn and the shadow scan has nothing to serve. */
  get casting(): boolean {
    return this.casters.some((l) => l.castShadow);
  }

  /** The lights that cast shadows, in `SHADOW_LEVELS`' order. */
  get casters(): (SpotLight | PointLight)[] {
    return castersOf(this);
  }

  /** The scene's real-time lights at the cap last set (`setLights`), the machine's included: the board hands them on to the machine. */
  get liveLights(): ReadonlySet<LightId> {
    return this.choice.live;
  }

  /**
   * At most `cap` real-time lights in the scene (0: all of them), the machine's two included, and whether the lamps cast shadows
   * (`chooseLights`). A capped light leaves the scene (the renderer counts a light at 0), so the lit programs are made again: call it when
   * the setting changes, never by the frame. Its fixture still glows and its baked light stands in (`mixLight`); the frame still sets its
   * level. The machine takes its share from `liveLights`.
   */
  setLights(cap: number, lampShadows: boolean): void {
    setLights(this, cap, lampShadows);
  }

  /**
   * The shadow maps at `level` of the graphics settings, for the lights that may cast (`setLights`). A new map is drawn on the next frame; no
   * shadows frees them.
   */
  setShadows(level: number): void {
    setShadows(this, level);
  }

  /**
   * Swaps the city in the window for the one of `d`: the old view is freed at once, the new one is built now (it takes seconds). The swap
   * is synchronous, so the window shows no old picture while the new one waits for its first draw.
   */
  setCityDetail(d: CityDetail): void {
    setCityDetail(this, d);
  }

  /**
   * The window's view for this frame's camera, and the baked bounce for this frame's light (before the frame's draw); `scene`: the one the room
   * stands in; `samples`: the scene target's multisampling.
   */
  drawOutside(renderer: WebGLRenderer, scene: Scene, { camera, samples }: OutsideFrame): void {
    followDetail(this);
    mixLight(this, renderer);
    this.outside.draw(renderer, scene, camera, samples);
  }

  /**
   * The room's slow motion is due a frame: the city's beat (`OutsideView.due`, each few ticks), which also carries the cup's steam, the clock
   * and the hour's light as it turns. A frame drawn on demand (docs/render/load.md) draws on it.
   */
  get ambientDue(): boolean {
    return this.outside.due;
  }

  /** Free what is not under the root: the baked bounce's target. The city stays for the next room: call it before the root is freed. */
  dispose(): void {
    disposeRoom(this);
  }

  /**
   * The lights hold still (the sun moves a step a few times a game hour), so a shadow map holds until a caster moves. Every light asks to catch
   * up (`catchUp`) for the next frame when one moved (`ShadowCache.scan`, which then redraws only the movers), else one light per turn asks:
   * a map redraws only if a caster in its light's range changed since its last draw (a fan's rotor turned), so a still room draws no shadow
   * map. A light at 0 draws none until it is lit (`ShadowCache`).
   */
  redrawShadows(moved: boolean, now: number): void {
    redrawShadows(this, moved, now);
  }

  /**
   * The frame's shadow scan (`ShadowCache.scan`) and the redraw it asks for. With no light casting it does not scan: it returns false, and the
   * frame asks for nothing (a deferred map is not owed until a light casts again). Else it returns whether a caster moved, or a map is still
   * owed (`pending`).
   */
  scanShadows(
    cache: { scan: (scene: Object3D, now: number) => boolean; pending?: boolean },
    scene: Object3D,
    now: number,
  ): boolean {
    if (!this.casting) {
      return false;
    }
    const cast = cache.scan(scene, now);
    this.redrawShadows(cast, now);
    return cast || Boolean(cache.pending);
  }

  /** The keys on the rack: a white stick on its lanyard per hook. A key that arrives drops in from the mailbox. */
  setKeys(tray: readonly KeySnap[]): void {
    setKeys(this, tray);
  }

  /** The monitor's screen as the 2D game's `Live` draws it, or null for the plain picture (props3d.ts `Monitor.useLive`). */
  setScreenImage(img: { canvas: HTMLCanvasElement; w: number; h: number; rev?: number } | null): void {
    this.monitor.useLive(img);
  }

  /**
   * The zoom takes the router's shell away to show the board inside it (`Machine3D.onRouterShell`): `a` is how much of the shell is left, 1 whole to 0 gone. Its jacks, its plinth and its feet stay.
   * A shell that is mostly gone casts no shadow on the board (a shadow map ignores opacity).
   */
  setRouterShell(a: number): void {
    setRouterShell(this, a);
  }

  /** The room at frame `f`, `dt` seconds after the last: the mail, the hour's light, the blinds, the lamps, the screen, the router, the clock. */
  frame(f: RoomFrame, dt: number): void {
    frameRoom(this, f, dt);
  }
}
