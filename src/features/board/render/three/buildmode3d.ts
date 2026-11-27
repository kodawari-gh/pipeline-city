// BUILD MY PC (docs/PC_PARTS.md): the machine alone on a plain stage, away from the room, to build it, swap its parts and watch every part come out and go in.
// It runs a sandbox `Game` on the main thread (the real rules: `install`, `uninstall`, `connectCable`) and draws its snapshot with the game's own `Machine3D`.
// The game is the Build session's (`sim/buildsession.ts`): a removal or a fit runs there whole first, and the stage plays its script (`playScript`).
// What has to come out before what is the removal graph (`sim/removal.ts`); how each step looks is `buildmotion.ts`. A swap or a removal takes out
// every part that stands in the way (in the graph's order), does the job, then puts those parts back in reverse order.
// The case's shell and the board are one piece here: swapping either plays the whole machine lifting away (the parts in it come out first).
import { computed, effect, signal } from '@preact/signals';
import {
  AmbientLight,
  Box3,
  Vector3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  type Material,
  type Object3D,
} from 'three';
import { slotRects } from './slots3d';
import { effective, FrameGate } from '@/app/graphics';
import { airflowLens, powerLens } from '@/app/hover';
import { BakeQueue, TEXTURE_LEVELS } from '@/core/render/three/artlod';
import { ArtSet } from './artset3d';
import {
  applyView,
  distanceOf,
  fitRect,
  heightAt,
  LIMITS,
  panBy,
  retarget,
  settled,
  stepView,
  zoomAt,
  zoomOn,
  type Box,
  type OrbitView,
} from '@/core/render/three/camera';
import { BUILD_START, frameMachine } from '@/core/render/three/buildframe';
import { turnOf } from '@/core/render/three/gesture';
import { attachPad, type PadHost } from '@/core/render/three/pad';
import { DrawGate, STILL_PX, ViewWatch, frameDt } from '@/core/render/three/ondemand';
import { byProgram, rankMaterials } from '@/core/render/three/drawsort';
import { syncWorld } from '@/core/render/three/stillworld';
import { SEG, anisotropy, disposeTree, refilter } from '@/core/render/three/geometry';
import { lowDetail } from '@/core/render/three/detail';
import { BASE_EXPOSURE, createRenderContext, disposeRenderContext, restoreStudioEnv } from '@/core/render/three/init';
import { Eye } from '@/core/render/three/eye';
import { findById, idOf, ownerOf, pick, pickPoint, seeThrough, tag } from '@/core/render/three/pick';
import { Post } from '@/core/render/three/post';
import { roomGeo } from '@/features/room/render/shell/room';
import { CASE_KIND, type CaseKind } from '@/features/room/render/shell/casedecor';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import {
  buildGraph,
  BOARD,
  CASE,
  cableNode,
  devNode,
  hasLoop,
  HOSES,
  isCableNode,
  isDevNode,
  isPump,
  removalPlan,
  SIDE,
} from '@/features/board/sim/removal';
import {
  boardSlots,
  caseHolds,
  deviceSpec,
  fanHost,
  fittedRadiator,
  freeSlots,
  slotAccepts,
  slotFits,
  type Board,
  type InstalledDevice,
  type SlotInfo,
} from '@/features/board/sim/board';
import {
  WALL_CABLES,
  cableBlocked,
  cableNeeded,
  cablesLost,
  cablesOf,
  hotPluggable,
  type Cables,
} from '@/features/board/sim/cables';
import { BOARD_TIERS, CASE_TIERS, getSpec, specsOfKind, type DeviceKind } from '@/features/board/sim/specs';
import type { Snapshot } from '@/worker/protocol';
import type { Game } from '@/worker/game/game';
import type { CableSnap } from '@/worker/game/types';
import { freeBakePools, startBaker } from './bake';
import { deviceFor, fitSlots, screenRect, socketFor, type Rect } from './buildpick';
import { centred, fitFactor, pictureWindow, type Pt } from './buildshot';
import { sweepLabels } from '@/core/render/camera';
import { Monitor } from '@/features/room/render/three/props3d';
import { monitorSeats } from '@/features/room/render/three/monitor3d';
import type { V3 } from '@/core/render/three/rope';
import { CASE as CASE_RECT, DESK_Y, LAYOUT_CASE, LAYOUT_TIER, MONITOR, SCREEN, setLayoutTier } from '../layout/layout';
import { LEVER_OPEN } from './boardhw3d';
import { DOOR_SECONDS, DOOR_SEES, doorWait } from './casedoor';
import { PSU_BODY, PSU_COVER } from './basement3d';
import { latchOpen, motionFor, motionSeconds, placed, poseAt, solidAt, type Pose } from './buildmotion';
import { PartFade } from './partfade';
import { ProgramGate, startPrograms } from '@/core/render/three/compile';
import { warmLateModels } from '@/core/render/three/gltf';
import { Machine3D, machineKey } from './machine3d';
import { PANEL_IDS, isPanelId } from './casetray3d';
import { StudioWall, ispTier, routerTier, wallPlan, type StageWall, type WallNet, type WallPlan } from './studiowall3d';
import { PlugHand } from './plughand3d';
import { BoardLive3D } from './boardlive3d';
import { LIVE_LEVELS } from './chips3d';
import { Lens3D } from './lens3d';
import { worldPace } from '@/core/render/lod/lod';
import {
  DEFAULT_RUN_SPEED,
  MAX_TICKS_PER_FRAME,
  OFF,
  runState,
  sameRun,
  type RunSpeed,
  type RunState,
} from '@/features/board/sim/buildrun';
import type { BuildLayout, BuildPreset, Shown } from '@/features/board/sim/buildspecs';
import { OUTSIDE } from '@/features/board/sim/buildpreset';
import { BuildSession, isOutStep } from '@/features/board/sim/buildsession';
import type { Outcome, ScriptStep, SessionState } from '@/features/board/sim/buildscript';
import { netKindOf, netName, netState, type NetKind } from '@/features/board/sim/buildnet';
import { ISP_SPECS, ROUTER_SPECS } from '@/features/network/sim';
import { LinkLeds } from '@/features/network/render/jackleds';
import { OS_SPECS } from '@/features/os/sim';
import { buildAlerts, newAlerts, standing, type Alert } from '@/features/board/sim/buildalerts';
import type { Stop } from '@/features/sandbox/sim/pcbench';
import type { TaskResult } from '@/features/sandbox/sim/benchtasks';
import { playCue } from '@/app/audio/engine';
import type { CueId } from '@/app/audio/mixTokens';
import { studioMachine } from '@/app/audio/studio';

/** A part in the bin: what a player can fit (an OS, a router or an internet plan too: they are fitted to the room, not to a socket, `fitNet`). */
export interface BinPart {
  id: string;
  name: string;
  kind: DeviceKind | 'board' | 'case' | NetKind;
  tier: number;
}

/** How far the benchmark has got: the task that runs now (null while the benchmark's code loads) and its place among the tasks picked. */
export interface BenchProgress {
  id: string | null;
  n: number;
  total: number;
}

export interface BuildStatus {
  busy: boolean;
  /** The words for this moment of the animation. */
  step: string;
  /** What has been done, newest last. */
  log: string[];
  /** Counts up with every change of the machine (the UI reads it to redraw). */
  rev: number;
}

/** How long a refusal stays on the hint line, counted from the end of the job that raised it. */
const REFUSAL_MS = 6000;

type Way = Parameters<BuildSession['next']>[0];

/** What a swap took out, to put back. */
/** A part that came out, to put back. */
type Gone = { spec: string; slot: string; invId: string; clock?: number | undefined };
type Undo = { t: 'cable'; id: string } | { t: 'hoses' } | ({ t: 'dev' } & Gone);

/** The eye's key and range, as in the game's board view. */
const EYE_KEY = 0.04,
  EYE_RANGE = [0.3, 14] as const;
const START = BUILD_START;
/** How far west (units) the start view moves the picture of the case and the wall (the wall's own views, `wallView`). */
const WALL_SHIFT = 1400;
/** The z the Wall preset aims at: between the plates' faces and the router's front. */
const WALL_FOCUS_Z = 1800;
/** Where the stage's monitor stands (`syncMonitor`): its foot's middle this far west of the case's west face and in front of the board, turned this far to the camera. */
const MONITOR_AT = { dx: -5200, dz: 1800, yaw: 0.5, rootZ: 400 } as const;
/** Where the stage's monitor lets its power cord out, in the world, and the way the cord leaves it (`monitorSeats`, turned and moved as `syncMonitor` places the monitor). */
export function monitorPower(): { at: V3; axis: V3 } {
  const p = monitorSeats(MONITOR, 0).power,
    c = Math.cos(MONITOR_AT.yaw),
    s = Math.sin(MONITOR_AT.yaw);
  const turn = (v: V3): V3 => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  const [x, y, z] = turn([p.at[0] - (MONITOR.x + MONITOR.w / 2), p.at[1] + DESK_Y, p.at[2] + MONITOR_AT.rootZ]);
  return {
    at: [x + CASE_RECT.x + MONITOR_AT.dx, y - (CASE_RECT.y + CASE_RECT.h), z + BOARD_Z + MONITOR_AT.dz],
    axis: turn(p.axis),
  };
}
/**
 * The distance stand-ins (`partlod.ts`) draw only from this part of the stage's own zoom out: at its own view and closer, every part is itself.
 * Low has no such floor (PHONE-01): the small parts draw merged at any zoom, as the size rule says, and the whole machine is held while a
 * step moves parts (`frame`).
 */
export const LOD_CEIL = 0.8;
/** The settle after a part goes in: how long it lasts and how far (world units) the part dips past its seat. */
/** The speed of the parts in the way in a chain of more than two steps, and of a skip. */
const QUICK = 2.5,
  SKIP = 6;
/** A part this big on the screen (its larger side, or its share of the screen) is looked at, not carried: a mouse drag on it pans (a hold lifts it), as in the game. */
const BIG_SIDE = 0.7,
  BIG_AREA = 0.3;
/** The view's target stays this far (in heights of the start view) from the start view's, and the view shows at most this many times its height. */
const STAY = 0.6,
  FAR = 2.5;
/** A focused part fills this share of the stage's height (or of its width, for a wide one). */
const FOCUS_FILL = 0.5;
/**
 * How near (px) the pointer must be to a plug to mean it: a loose plug is small and lies among parts, a seated one is a few pixels (the game's `looseNear`).
 * A ray that meets the cable itself needs none of this.
 */
const GRAB_PX = 22,
  SEATED_PX = 12;
/** A cable in a chain (a fan's lead) is pulled this much faster again: it is the same small motion each time. */
const CABLE_QUICK = 1.8;
const SETTLE_SECONDS = 0.2,
  SETTLE_DEPTH = 40;
/** The tile bakes' time in a tick that follows a drawn frame, and in one that follows none (ms); the drawn frames between two rank refreshes. */
const BAKE_MS = 6,
  BAKE_STILL_MS = 12,
  RANK_EVERY = 32;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The motion of a part in this slot: a fan on a case mount comes off its own wall first (the mount's id starts with its side), a heatsink's fan lifts off it;
 *  a SATA drive comes out on its cage's tray (`tray`), an M.2 stick off its socket, a loop's pump head twists free (`pump`). */
export const motionOf = (kind: string, slot: string, board?: Board): string =>
  kind === 'fan' && /^(vrm|ram)-sink/.test(fanHost(slot) ?? '')
    ? 'fan-sink'
    : kind === 'fan' && !fanHost(slot)
      ? board && fittedRadiator(board)?.mounts.includes(slot)
        ? 'fan-rad'
        : `fan-${slot.replace(/\d+$/, '')}`
      : kind === 'storage' && slot.startsWith('sata')
        ? 'tray'
        : kind === 'cooler' && board?.devices.some((d) => d.slot === slot && isPump(d))
          ? 'pump'
          : kind;

/** The rope's steps for a frame of `dt` seconds (the hoses, `LoopHoses.pose`): about 240 a second, as the cable hand's. */
const ropeSteps = (dt: number): number => Math.max(2, Math.min(24, Math.round(dt * 240)));

/** A game's snapshot, kept until the game changes (PERF19): `game.snapshot()` builds the inventory and copies the board through JSON, about 8 % of
 *  an idle phone frame when each frame asked for it. Call `drop` after every change to the game; another game object starts over by itself. */
export class SnapCache {
  private game: Game | null = null;
  private snap: Snapshot | null = null;
  of(game: Game): Snapshot {
    if (game !== this.game || !this.snap) {
      this.game = game;
      this.snap = game.snapshot();
    }
    return this.snap;
  }
  /** (the game goes too: a closed stage keeps no game through its cache) */
  drop(): void {
    this.snap = null;
    this.game = null;
  }
}

/** The bin: every case, board and part kind that has a 3D model in the machine. */
export function binParts(): BinPart[] {
  const out: BinPart[] = CASE_TIERS.map((c) => ({ id: `case${c.tier}`, name: c.name, kind: 'case', tier: c.tier }));
  for (const b of BOARD_TIERS) {
    out.push({ id: `board${b.tier}`, name: `${b.name} board`, kind: 'board', tier: b.tier });
  }
  for (const k of [
    'cpu',
    'cooler',
    'radiator',
    'fan',
    'ram',
    'vrm-sink',
    'ram-sink',
    'storage',
    'gpu',
    'npu',
    'nic',
    'tpm',
    'psu',
  ] as const) {
    for (const s of specsOfKind(k)) {
      out.push({ id: s.id, name: s.name, kind: k, tier: s.tier });
    }
  }
  // (the network: an OS goes on a drive, a router stands by the wall, a plan comes in by the wall jack; an OS the game lists as later is not for sale)
  for (const s of OS_SPECS) {
    if (!s.later) {
      out.push({ id: s.id, name: s.name, kind: 'os', tier: s.tier });
    }
  }
  for (const s of ROUTER_SPECS) {
    out.push({ id: s.id, name: s.name, kind: 'router', tier: s.tier });
  }
  for (const s of ISP_SPECS) {
    out.push({ id: s.id, name: s.name, kind: 'isp', tier: s.tier });
  }
  return out;
}

export class BuildStage {
  readonly status = signal<BuildStatus>({ busy: false, step: '', log: [], rev: 0 });
  /**
   * What stands on the stage (`Shown`). The "Empty" start is `nothing`: no case at all, until the player brings one in from the shelf; that case is `case`, bare,
   * with no motherboard in it, and nothing else can be fitted until a board comes (`fit`); a board lowered into it makes it the `machine`. The sim game always
   * has a case and a board with no part on it; the stage holds them aside while they are not shown.
   */
  readonly shown = signal<Shown>('machine');
  /** Is there no board in the case (a bare case, or no case yet)? The parts have no socket then. */
  readonly bare = computed(() => this.shown.value !== 'machine');
  /** The last refusal (a part that fits no socket, a removal that cannot be done): the hint line shows it for a few seconds, whatever the log (for `?debug`) holds. */
  readonly refusal = signal<{ text: string; n: number } | null>(null);
  private refusalTimer: ReturnType<typeof setTimeout> | undefined;
  private refusals = 0;
  /** What the benchmark has scored on the machine as it stands, by task id (any change to the machine empties it), and how far a run has got (null: none runs). */
  readonly bench = signal<Readonly<Record<string, TaskResult>>>({});
  /** The scores of the machine before the last change that had any: the screen shows the change from them. */
  readonly benchWas = signal<Readonly<Record<string, TaskResult>>>({});
  readonly benching = signal<BenchProgress | null>(null);
  private benchStop: Stop = { aborted: false };
  /** The benchmark's code carries the game's whole sim: it loads when the benchmark screen opens (`loadBench`), not with the stage. */
  private benchMod: typeof import('@/features/sandbox/sim/pcbench') | null = null;
  private readonly benchLoaded = signal(false);
  /** Why each benchmark task cannot run on the machine as it stands (null: it can), by task id; null until `loadBench` has loaded the code. */
  readonly benchIssues = computed((): ReadonlyMap<string, string | null> | null => {
    void this.status.value.rev; // (every change of the machine ends in a new `rev`)
    return this.benchLoaded.value && this.benchMod && !this.dead ? this.benchMod.benchIssues(this.game) : null;
  });
  /** Playback speed: 1 is the animations' own time. */
  readonly speed = signal(1);
  /** A long chain of steps plays its parts in the way faster (`QUICK`), and a press of Space or Escape fast-forwards what is left of a job. */
  private pace = 1;
  private skipping = false;
  private rate(): number {
    return this.speed.peek() * this.pace * (this.skipping ? SKIP : 1);
  }
  /** Fast-forward the job that runs now (its steps all play, quicker). */
  skip(): void {
    if (this.status.peek().busy) this.skipping = true;
  }
  // ------------------------------------------------------------------ the running machine
  /** What the machine is doing (`runState`): off, or on in this phase. It changes with the phase, not with every tick. */
  readonly state = signal<RunState>(OFF);
  /** Counts up with each batch of ticks the game ran: what shows live numbers (the OS sheet) draws again on it. */
  readonly ticks = signal(0);
  /** How fast the machine runs while it is on, in base ticks a second (`RUN_SPEEDS`; the game's 1x is one a second). */
  readonly simSpeed = signal<RunSpeed>(DEFAULT_RUN_SPEED);
  /** Ticks owed: time that passed at the machine's speed and has not been run yet. */
  private owed = 0;
  /** The base ticks the machine has run on the stage (a second each at 1x): the OS sheet's graphs take a sample for each. */
  private ran = 0;
  get simulated(): number {
    return this.ran;
  }
  /** The Ethernet jacks' lights: they follow the frames the port carries, on the game's clock (`network/render/jackleds.ts`). */
  private readonly leds = new LinkLeds();
  /** Counts up with every change to the game: what memoizes on the machine as it stands (`alerts`) keys on it, as a running game gives a new snapshot every tick. */
  private editRev = 0;

  /**
   * The sandbox game, owned by the Build session (`sim/buildsession.ts`). Change it only through `edit` or a session command (or put a new game here,
   * which starts a new session): the stage keeps its snapshot until then.
   */
  get game(): Game {
    return this.alive(this._game);
  }
  set game(g: Game) {
    this.session = new BuildSession(g);
    this.newGame();
  }
  /** Another game stands on the stage: nothing kept of the one before holds. */
  private newGame(): void {
    this.owed = 0;
    this.editRev++;
    this.snaps.drop();
    this.syncRun();
    this.benchChanged();
  }
  private session: BuildSession | null = null;
  private get buildSession(): BuildSession {
    return this.alive(this.session);
  }
  private get _game(): Game | null {
    return this.session?.game ?? null;
  }
  private set _game(g: Game | null) {
    this.session = g ? new BuildSession(g) : null;
  }
  private readonly snaps = new SnapCache();
  private _machine: Machine3D | null = null;
  private get machine(): Machine3D {
    return this.alive(this._machine);
  }
  /**
   * A closed stage lets go of its machine and its game (PERF12): the UI's last render can keep a closure that holds the stage until the next
   * open. A job that wakes after the close (a timer) stops here, and `job` drops the error.
   */
  private alive<T>(x: T | null): T {
    if (this.dead || !x) throw new Error('Build my PC is closed');
    return x;
  }
  private readonly bakes = new BakeQueue();
  private readonly ctx;
  private readonly post: Post;
  private readonly gate = new FrameGate();
  /** Drawn on demand (docs/render/load.md): a still machine draws no frame; a change, a motion or a camera move draws. */
  private readonly demand = new DrawGate();
  private readonly moved = new ViewWatch();
  /** The power and airflow lenses (the `powerLens` / `airflowLens` signals), over the machine as in the game. */
  private readonly lens: Lens3D;
  /** The board's live layer and the monitor's screen, drawn by the game's own `Live` while the machine is on (`screen`). */
  private readonly live: BoardLive3D;
  private readonly hand: PlugHand;
  private readonly host: HTMLElement;
  private view: OrbitView;
  private goal: OrbitView;
  /** A flight runs (`fly`: a preset, a focus, the start view): the first touch of the view catches it where it is. */
  private flying = false;
  private W: number;
  private H: number;
  private raf = 0;
  private dead = false;
  private last = performance.now();
  /** The player's Side panel button holds the panel open. */
  private wantOpen = false;
  /** A job holds the panel open from its first step that needs the inside; at its end the panel is the zoom's again (`Machine3D.setOpen`). */
  private jobOpen = false;
  /**
   * The motion that plays now: its objects (each turns about `pivot`, the middle of them all in its parent's frame), or a `drive` that reads the pose
   * itself (the hoses) and an `end` that puts them away. `fade` draws them see-through at the far end of their way (`solidAt`).
   */
  private anim: {
    objs: {
      o: Object3D;
      base: [number, number, number];
      baseTurn: number;
      baseTilt: number;
      pivot: [number, number];
    }[];
    kind: string;
    dir: 'out' | 'in';
    t: number;
    latches: Object3D[];
    done: () => void;
    drive?: (p: Pose, steps: number) => void;
    end?: () => void;
    fade?: PartFade;
  } | null = null;
  /** A new build: the see-through programs of its parts' fades start to link after the next draw (`PartFade`). */
  private warm = false;
  /**
   * The first picture waits for its programs (docs/render/load.md "Build my PC's first open"). They start to link before the first draw, and the
   * page runs on while the driver links them, as the game's first frame does (`board3d.ts`). Drawn unlinked, the 60 and more programs of the
   * machine and the passes link at that draw and hold the page for about 2 s. The machine's, the see-through variants of its fades, the passes'.
   */
  private readonly programs = new ProgramGate(() => {
    const { scene, camera, renderer } = this.ctx;
    this.warm = false; // (the fades' programs are in that batch)
    return [
      ...startPrograms(renderer, scene, camera, {
        fades: [this.machine.root, ...(this.monitor ? [this.monitor] : [])],
      }),
      ...this.post.startPrograms(renderer),
    ];
  });
  private pictured = false;
  private onPicture: () => void = () => {};
  /** Resolves with the first picture, or at the stage's disposal: `open` waits for it, and the skeleton stays up. */
  private readonly picture = new Promise<void>((done) => {
    this.onPicture = done;
  });
  /** The loop's hoses are off their fittings (a step took them off, or a part just made the loop): a build keeps them hidden until they go on. */
  private hosesOff = false;
  private readonly was: [number, number] = [LAYOUT_TIER, LAYOUT_CASE];
  private readonly cleanup: (() => void)[] = [];
  private tierKey = '';
  private readonly eye = new Eye(EYE_KEY / BASE_EXPOSURE, EYE_RANGE);
  /** The last tick drew a frame; the drawn frames' count (`RANK_EVERY`). */
  private drew = true;
  private frames = 0;
  /** A press on a part inside the open case (no busy job) hands the device id and the press here: the UI drags it. */
  onGrab: ((device: string, e: PointerEvent) => void) | null = null;
  /** What the pointer is over, as in the game (`hover`, app/hover.ts): a fitted device, an empty socket or the case's side panel, and where the pointer is. */
  readonly hover = signal<{ id: string; x: number; y: number } | null>(null);
  /** The fitted device the player picked (its id): outlined, and the card's subject. A job that moves parts lets go of it (`job`). */
  readonly selected = signal<string | null>(null);
  /** Counts up when the camera moves or the stage resizes: what is placed by a part's screen box measures it again (`anchorOf`). */
  readonly viewRev = signal(0);
  /** Is the side panel open (or opening)? `insideOpen`, as a signal for the toolbar. */
  readonly open = signal(false);
  /** What the UI drags now (a catalogue item off the shelf, a fitted device out of the machine), and the part it points at without a drag (a row it hovers). */
  private carried: { item: string } | { device: string } | null = null;
  private glowing: string | null = null;
  private outlineKey = '';
  private viewKey = '';
  private hoverTime = 0;
  /** The free window the UI leaves round the machine (CSS px from each edge). The machine is framed in it. */
  /** The tab boxes the UI measured (CSS px in the stage): the machine is framed in the free window they leave. */
  private tabs: Box[] = [];
  /** Tab boxes the UI measured and this stage has not framed yet: a drag in progress holds them (`applyTabs`). */
  private wantTabs: Box[] | null = null;

  private constructor(host: HTMLElement) {
    this.host = host;
    this.ctx = createRenderContext(host, '#49484a');
    const { scene, camera, renderer } = this.ctx;
    this.W = Math.max(1, host.clientWidth);
    this.H = Math.max(1, host.clientHeight);
    scene.environmentIntensity = 0.45;
    scene.add(new AmbientLight(0xffffff, 0.12), new HemisphereLight(0xbfd0ff, 0x1a1410, 0.3));
    const key = new DirectionalLight(0xfff0dc, 0.9);
    key.position.set(-6000, 9000, 14000);
    const rim = new DirectionalLight(0x8fb0ff, 0.45);
    rim.position.set(9000, 3000, -4000);
    const lamp = new PointLight(0xfff1dd, 1, 0, 0);
    lamp.position.set(0, 4000, 9000);
    scene.add(key, rim, lamp);
    // the frame's cuts (docs/render/case.md "Build my PC's frame"): the still parts' matrices stay (`syncWorld` in `frame`), and the opaque
    // draws go in program order
    scene.matrixWorldAutoUpdate = false;
    renderer.setOpaqueSort(byProgram);
    this.post = new Post(renderer, scene, camera, this.W, this.H);
    // (a model that joins after the first picture's programs have started, a slow network, links its own while it is hidden: `joinModel`; its parts fade)
    warmLateModels(scene, (model) =>
      this.programs.started ? startPrograms(renderer, model, camera, { scene, fades: [model] }) : null,
    );
    this.lens = new Lens3D(scene, renderer.domElement);
    this.live = new BoardLive3D(scene);
    // the hand that pulls a cable's plug out and pushes it in: by itself in a job (plughand3d.ts `pullOut`, `plugIn`), under the player's pointer otherwise
    // (`beginCable`), on this stage's own game (the case's front-panel leads are not the game's cables: the stage keeps which are plugged, `panelOut`, and shows
    // them to the hand as cables)
    this.hand = new PlugHand(
      {
        machine: () => this._machine,
        snapshot: () => this.handSnapshot(),
        toast: (t) => this.refuse(t),
        connect: (id, port) => {
          if (isPanelId(id)) {
            this.plugPanelLead(id, true);
          } else if (this.playing) {
            this.handMoved(id, true);
          } else {
            this.cableChanged(
              this.edit(() => this.buildSession.connectCable(id, port)),
              'plug it in',
              'cable_connect',
            );
          }
        },
        disconnect: (id) => {
          if (isPanelId(id)) {
            this.plugPanelLead(id, false);
          } else if (this.playing) {
            this.handMoved(id, false);
          } else {
            this.cableChanged(
              this.edit(() => this.buildSession.disconnectCable(id)),
              'pull it out',
              'cable_disconnect',
            );
          }
        },
      },
      renderer.domElement,
    );
    scene.add(this.hand.root);
    // the graphics settings, now and on every change while the stage is open (the frame limit is in `frame`)
    this.cleanup.push(
      effect(() => {
        const g = effective.value;
        this.post.apply(g, renderer, this.W, this.H);
        this.live.level = LIVE_LEVELS[g.live] ?? LIVE_LEVELS[2];
        if (g.filtering !== anisotropy) refilter(scene, g.filtering);
        this.demand.ask();
      }),
    );
    this.view = this.goal = this.frameView();
    this.listen(renderer.domElement);
    const ro = new ResizeObserver(() => {
      this.W = Math.max(1, host.clientWidth);
      this.H = Math.max(1, host.clientHeight);
      renderer.setSize(this.W, this.H);
      this.post.setSize(this.W, this.H);
      this.demand.ask(); // (a new size clears the canvas)
    });
    ro.observe(host);
    this.cleanup.push(() => ro.disconnect());
    // Space or Escape fast-forwards the step that plays (a long chain is a lot to watch twice)
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.key === 'Escape') && this.status.peek().busy) {
        this.skip();
        e.preventDefault();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', onKey);
      this.cleanup.push(() => document.removeEventListener('keydown', onKey));
    }
    // a restored context lost the studio's environment map (a render target's picture): made again, then a frame
    const restored = () => {
      restoreStudioEnv(scene, this.ctx.pmrem);
      this.demand.ask();
    };
    renderer.domElement.addEventListener('webglcontextrestored', restored);
    this.cleanup.push(() => renderer.domElement.removeEventListener('webglcontextrestored', restored));
  }

  /**
   * Open the stage in `host` (a sized element) with a fresh sandbox game that holds the biggest machine. It resolves with the first picture. A
   * `signal` that aborts before that frees the stage and ends the wait (the stage comes back closed).
   */
  static async open(host: HTMLElement, signal?: AbortSignal): Promise<BuildStage> {
    const { Game } = await import('@/worker/game/game');
    startBaker();
    const s = new BuildStage(host);
    if (signal?.aborted) s.dispose();
    else signal?.addEventListener('abort', () => s.dispose(), { once: true });
    if (s.dead) return s;
    s.game = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true, looseFit: true });
    // (the machine builds a slice at a time: the page answers meanwhile, and a player who leaves frees the stage at once)
    await s.buildFirst();
    if (s.dead) return s;
    if (import.meta.env.DEV) (window as unknown as { __build?: BuildStage }).__build = s;
    s.last = performance.now();
    s.raf = requestAnimationFrame(s.frame);
    // (the skeleton stays up until the first picture: its programs link meanwhile, the page alive)
    await s.picture;
    return s;
  }

  /** The machine as it stands: one snapshot per change of the game, not one per frame. */
  get snapshot(): Snapshot {
    return this.playing?.snapshot ?? this.snaps.of(this.game);
  }
  get board(): Board {
    return this.playing?.board ?? this.game.board;
  }
  get cables(): Cables {
    return this.playing?.cables ?? this.game.cables;
  }
  /**
   * While a script plays (`playScript`), the machine as the step that plays leaves it: the game holds the end of the job already. `over`: the plugs
   * the hand moved in this step, as the hand reads them (`handSnapshot`); the step's own state takes their place when it ends.
   */
  private playing: (SessionState & { over: Map<string, boolean> }) | null = null;
  /** Every change to the stage's game goes through here (install, uninstall, purchase, a cable): it drops the kept snapshot. */
  private edit<T>(change: (g: Game) => T): T {
    try {
      return change(this.game);
    } finally {
      this.changed();
    }
  }

  /** The game changed: the kept snapshot goes, and what was worked out for the machine as it stood. */
  private changed(): void {
    this.snaps.drop();
    this.editRev++;
    this.benchChanged();
    this.demand.ask();
    // (a cord pulled from a running machine, or a change that stops it: the chip follows at once, not at the next tick)
    if (this._game && this._game.powered !== this.state.peek().on) {
      this.syncRun();
    }
  }

  /** The OS follows its drive (`Game.keepOs`): when a job ends, the OS that left with a drive that came out is put on the drive that went back in, or the first one that holds it. */
  private keepOs(): void {
    const was = this.game.os;
    this.game.keepOs();
    if (this.game.os !== was) {
      this.snaps.drop();
      this.editRev++;
      this.benchChanged();
    }
  }

  /** What the chip says: the game's power and phase, set when they change (a tick, a power button, a cord pulled). */
  private syncRun(): void {
    if (!this._game) return;
    const s = this.snapshot,
      next = runState(s.powered, s.phase, s.phaseReason);
    if (!sameRun(this.state.peek(), next)) this.state.value = next;
    // (the hum follows this machine: its power and fans, each tick)
    studioMachine.value = { powered: s.powered === true, devices: s.devices ?? [] };
  }

  /**
   * The power button (the toolbar's, or a click on the case's own). Off to on starts the machine, which then runs at `simSpeed`; on to off is a hard power-off, as
   * in the game (a job in flight is lost). A machine that cannot start says why on the hint line.
   */
  power(): void {
    if (this.dead || !this._machine || this.status.peek().busy || this.shown.peek() !== 'machine') return;
    const r = this.game.powerButton();
    this.snaps.drop();
    this.editRev++;
    this.owed = 0;
    this.demand.ask();
    this.syncRun();
    if (!r.ok) {
      this.refuse(r.reason.startsWith('no power: ') ? `Cannot power on: ${r.reason.slice(10)}` : r.reason);
      return;
    }
    this.clearRefusal();
    playCue(r.powered ? 'power_on' : 'power_off');
    this.note(r.powered ? 'Powered on' : 'Powered off');
    this.bump();
  }

  /**
   * The machine runs: while the game is powered it ticks at the chosen speed (as the worker's host does: whole ticks, a cap on a frame, the backlog beyond it dropped),
   * the snapshot is made again after the ticks, and the chip follows. A job that moves parts powers the machine off first (`job`), so nothing runs under a step.
   */
  private simulate(dt: number): void {
    const g = this._game;
    // (a benchmark run takes the page's time for its own copy of the machine: this one waits, as it does under a step)
    if (!g || !g.powered || this.status.peek().busy || this.benching.peek()) {
      this.owed = 0;
      return;
    }
    this.owed += Math.min(dt, 0.1) * this.simSpeed.peek();
    const n = Math.min(Math.floor(this.owed), MAX_TICKS_PER_FRAME);
    this.owed -= Math.floor(this.owed);
    if (n <= 0) return;
    this.ran += n;
    try {
      for (let i = 0; i < n; i++) g.advanceBaseTick();
    } catch (e) {
      // (a fault in the sim: the machine is switched off and the stage goes on; the page keeps the error for a report)
      console.error(e);
      try {
        g.powerButton();
      } catch {
        /* already down */
      }
      this.refuse('The machine stopped: the simulation hit an error (see the console).');
    }
    this.snaps.drop();
    this.ticks.value++;
    this.syncRun();
    this.demand.ask();
  }

  /** The machine changed: the scores no longer describe it (they stay as the ones to compare with), and a run on its old copy ends. */
  private benchChanged(): void {
    this.benchStop.aborted = true;
    const now = this.bench.peek();
    if (Object.keys(now).length) {
      this.benchWas.value = now;
      this.bench.value = {};
    }
  }

  // ------------------------------------------------------------------ drawing
  /** The case alone: the machine. The wall's plates and router stand behind it and may leave the frame (the Wall preset shows them). */
  private frameView(): OrbitView {
    // the machine fills the free window the tabs leave, and its middle sits at the window's middle (`frameMachine`, `core/render/three/buildframe.ts`)
    const c = CASE_RECT;
    return frameMachine({ x: 0, y: 0, w: this.W, h: this.H }, this.tabs, {
      centre: { x: c.x + c.w / 2, y: -(c.y + c.h / 2), z: BOARD_Z },
      size: { x: c.w, y: c.h, z: 0 },
    });
  }

  /** The tab boxes the UI measured (CSS px in the stage): the machine is framed in the free window they leave. A drag in progress holds the framing until it ends. */
  setTabs(tabs: Box[]): void {
    this.wantTabs = tabs;
    this.applyTabs();
  }

  /** Frame the machine in the window the UI last measured, once no drag is in progress; the view eases there (`goal`). */
  private applyTabs(): void {
    const t = this.wantTabs;
    if (!t || this.carried || this.hand.kind) return;
    this.wantTabs = null;
    if (JSON.stringify(t) === JSON.stringify(this.tabs)) return;
    this.tabs = t;
    this.goal = this.frameView();
    this.demand.ask();
  }

  /** The wall's plates, the router and the cords between (the Wall preset): seen nearly head on, a little from the east, the target a little west for the free window. */
  private wallView(): OrbitView {
    const f = (this.wall?.plan ?? this.wallPlanNow()).frame,
      h = f.y1 - f.y0,
      w = f.x1 - f.x0;
    return fitRect(
      { x: f.x0 - WALL_SHIFT / 3, y: -f.y1, w, h },
      WALL_FOCUS_Z,
      this.W / this.H,
      { yaw: 0.2, pitch: 0.1, fov: 30 },
      0.54,
    );
  }

  /** What the machine builds cost since the stage opened (a swap's cost, read by the bench through `window.__build` in dev; `docs/render/load.md`). */
  readonly cost = { builds: 0, buildMs: 0, skipped: 0, patches: 0, patchMs: 0 };
  /** What the machine on the stage was built from (`machineKey`): a redraw of the same parts builds nothing (cables and the key sync themselves). */
  private builtKey = '';

  private rebuild(): void {
    if (this.dead) return;
    this.snaps.drop();
    const shown = this.shown.peek(),
      key = machineKey(this.snapshot, shown);
    this.syncWall(); // (the router and the plan are the game's: a change of either leaves the machine as it was)
    if (this._machine && key === this.builtKey) {
      // the same tiers, parts and sockets: the machine stands as it is (the end of a job after a step that built it already, a cable the hand moved)
      this.cost.skipped++;
      // (a cable plugged in or out by the game's answer, not by the hand: it hangs as the game says)
      this._machine.syncCables(this.snapshot, roomGeo());
      this._machine.syncPanel(this.panelOut);
      this.holdReeled();
      const st = this.status.peek();
      this.status.value = { ...st, rev: st.rev + 1 };
      this.demand.ask();
      return;
    }
    const t0 = performance.now();
    // a part more or less that a patch can make (a stick, an M.2 drive, a card): the machine stays, only that part is built or hidden
    // (a case that gains or loses its board, or a stage that gains or loses its case, is built again: a patch keeps the board it has)
    if (this._machine && this._machine.shown === shown && this._machine.patch(this.snapshot, roomGeo())) {
      this.builtKey = key;
      this.held.clear();
      this.warm = true;
      this._machine.syncPanel(this.panelOut);
      this.holdReeled();
      this.cost.patches++;
      this.cost.patchMs += performance.now() - t0;
      this.bump();
      this.demand.ask();
      return;
    }
    try {
      this.rebuildNow();
      this.builtKey = key;
    } finally {
      this.cost.builds++;
      this.cost.buildMs += performance.now() - t0;
    }
  }

  /** The machine built again whatever its key says: a swap lifted the old one away, so a skipped build (the same tiers) or a patch would leave the stage empty. */
  private rebuildAll(): void {
    if (this.dead) return;
    const t0 = performance.now();
    try {
      this.rebuildNow();
      this.builtKey = machineKey(this.snapshot, this.shown.peek());
    } finally {
      this.cost.builds++;
      this.cost.buildMs += performance.now() - t0;
    }
  }

  /** The stage's first machine, built a slice at a time (`Machine3D.make`; a machine built in one task held the page for 0.9 s): `rebuild` for a stage with none. */
  private async buildFirst(): Promise<void> {
    const t0 = performance.now();
    this.snaps.drop();
    const s = this.snapshot,
      shown = this.shown.peek(),
      key = machineKey(s, shown),
      tier = s.boardTier;
    setLayoutTier(tier, Math.max(tier, s.caseTier));
    const made = await Machine3D.make(s, roomGeo(), this.bakes, null, false, {
      stop: () => this.dead,
      shown,
      wall: this.stageWall(s),
    });
    if (this.dead) {
      made?.dispose();
      return;
    }
    try {
      this.rebuildNow(made ?? undefined);
      this.builtKey = key;
    } finally {
      this.cost.builds++;
      this.cost.buildMs += performance.now() - t0;
    }
  }

  /** The machine for the snapshot, now. `made`: one built already (`buildFirst`), in place of building it here. */
  private rebuildNow(made?: Machine3D): void {
    this.held.clear();
    // (the redraw always reads the game as it is now)
    this.snaps.drop();
    const s = this.snapshot,
      tier = s.boardTier,
      caseTier = Math.max(tier, s.caseTier);
    const refit = !this._machine || `${tier}|${caseTier}` !== this.tierKey;
    this.tierKey = `${tier}|${caseTier}`;
    setLayoutTier(tier, caseTier);
    const { scene } = this.ctx;
    const old = this._machine;
    if (old) {
      scene.remove(old.root);
      old.dispose();
    }
    this._machine =
      made ??
      new Machine3D(s, roomGeo(), this.bakes, null, false, true, true, false, this.shown.peek(), this.stageWall(s));
    if (old) this._machine.takeDoor(old);
    if (this._machine.hoses) this._machine.hoses.root.visible = !this.hosesOff;
    scene.add(this._machine.root);
    this._machine.syncPanel(this.panelOut);
    this.holdReeled();
    this.warm = true;
    this.stage(caseTier);
    this.syncWall();
    this.syncMonitor(s.devices.some((d) => d.kind === 'display'));
    if (refit) this.view = this.goal = this.frameView();
    const st = this.status.peek();
    this.status.value = { ...st, rev: st.rev + 1 };
    this.demand.ask();
  }

  private marker: Mesh | null = null;
  private markerAt = '';
  /** The snap preview: a glowing box over the socket a dragged part would fit in (`dropTarget`); null hides it. A socket with no place of its own (a case fan) shows none. */
  showTarget(slot: string | null): void {
    this.demand.ask();
    const rect = slot && this.machine.doorOpen ? slotRects(this.snapshot).get(slot) : undefined;
    if (!rect) {
      if (this.marker) this.marker.visible = false;
      this.markerAt = '';
      return;
    }
    if (!this.marker) {
      this.marker = seeThrough(
        new Mesh(
          new PlaneGeometry(1, 1),
          new MeshBasicMaterial({
            color: 0x3be3ff,
            transparent: true,
            opacity: 0.3,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
      );
      this.marker.renderOrder = 999;
      this.ctx.scene.add(this.marker);
    }
    const key = `${slot}`;
    if (key !== this.markerAt) {
      this.markerAt = key;
      this.marker.position.set(rect.x + rect.w / 2, -(rect.y + rect.h / 2), BOARD_Z + 250);
      this.marker.scale.set(rect.w, rect.h, 1);
    }
    this.marker.visible = true;
  }

  private monitor: Group | null = null;
  /** The room's monitor as the stage drives it (`screen`). */
  private mon: Monitor | null = null;
  /**
   * The room's own monitor (`Monitor`, props3d.ts) on the stage when the machine has one, tagged for the animation. It works as the room's does (`screen`): on
   * standby while the PC is off, the game's own screen (boot text, the OS) while it runs, dark with its cord out.
   */
  private syncMonitor(on: boolean): void {
    const { scene } = this.ctx;
    if (this.monitor) {
      scene.remove(this.monitor);
      disposeTree(this.monitor, true);
      this.monitor = null;
      this.mon = null;
    }
    if (!on) return;
    // (built where the room puts it, then moved so its foot's middle stands on the stage's origin, beside the case and turned to the camera)
    const g = tag(new Group(), 'monitor'),
      m = new Monitor(MONITOR, SCREEN, DESK_Y, 0);
    m.set({ installed: true, powered: !!this.snapshot.monitorPowered, live: false, text: '' }, 12);
    m.root.position.set(-(MONITOR.x + MONITOR.w / 2), DESK_Y, MONITOR_AT.rootZ);
    g.add(m.root);
    g.position.set(CASE_RECT.x + MONITOR_AT.dx, -(CASE_RECT.y + CASE_RECT.h), BOARD_Z + MONITOR_AT.dz);
    g.rotation.y = MONITOR_AT.yaw;
    scene.add(g);
    this.monitor = g;
    this.mon = m;
  }

  /**
   * One frame of the screen, as the game's does (`board3d.ts`): the board's live layer runs at the world's pace for the machine's speed while it is on (its packets,
   * lights and replay: `BoardLive3D`) and draws the monitor's picture; the monitor shows it when the cord is in and the PC drives it, and its standby card otherwise.
   */
  private screen(s: Snapshot, dt: number): void {
    const on = s.powered,
      pace = on ? this.simSpeed.peek() : 1;
    this.live.frame(this.ctx.camera, this.H, s, dt * worldPace(pace), !on, this.ctx.renderer.getPixelRatio(), on);
    const m = this.mon;
    if (!m) return;
    m.set(
      {
        installed: true,
        powered: !!s.monitorPowered,
        live: !!s.monitorLive && !!s.monitorPowered && on && !!s.display,
        text: s.display ?? '',
      },
      12,
    );
    m.useLive(this.live.screen);
  }

  private wall: StudioWall | null = null;
  /** The wall's plan for the case as the layout has it now: placed by the case's west face and top, over the floor under it. */
  private wallPlanNow(): WallPlan {
    return wallPlan({
      caseX: CASE_RECT.x,
      caseTop: -CASE_RECT.y,
      caseW: CASE_RECT.w,
      floorY: -(CASE_RECT.y + CASE_RECT.h) - 140,
    });
  }
  /** What the machine's cords need of the wall (the machine is built with it: `Machine3D`'s `wall`). */
  private stageWall(s: Snapshot): StageWall {
    return { plan: this.wallPlanNow(), monitor: s.devices.some((d) => d.kind === 'display') ? monitorPower() : null };
  }
  /** What the wall shows of the game's network (its jacks' lights come from the frames: `frame`). */
  private wallNet(s: Snapshot): WallNet {
    return { router: routerTier(s.net?.router?.id), isp: ispTier(s.net?.isp?.id) };
  }
  /** The studio's wall as the case and the game's network have it: built, moved when the case's size moves it, its router, lights and lead set. */
  private syncWall(): void {
    const { scene } = this.ctx,
      plan = this.wallPlanNow(),
      net = this.wallNet(this.snapshot);
    if (this.wall && this.wall.plan.key !== plan.key) {
      scene.remove(this.wall.root);
      this.wall.dispose();
      this.wall = null;
    }
    if (this.wall) this.wall.set(net);
    else {
      this.wall = new StudioWall(plan, net, new ArtSet(this.bakes));
      scene.add(this.wall.root);
    }
    this.demand.ask();
  }

  private floor: Mesh | null = null;
  /** The plain floor under the case. */
  private stage(_caseTier: number): void {
    const { scene } = this.ctx;
    if (!this.floor) {
      this.floor = new Mesh(
        new CircleGeometry(1, SEG.fineRing).rotateX(-Math.PI / 2),
        new MeshStandardMaterial({ color: new Color(0x1c1c1e), roughness: 0.55, metalness: 0.25 }),
      );
      this.floor.receiveShadow = true;
      scene.add(this.floor);
    }
    this.floor.scale.setScalar(CASE_RECT.w * 1.4);
    this.floor.position.set(CASE_RECT.x + CASE_RECT.w / 2, -(CASE_RECT.y + CASE_RECT.h) - 140, BOARD_Z + 1800);
  }

  private frame = (now: number): void => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.gate.ready(now, effective.peek().fps)) return;
    const dt = frameDt(now, this.last);
    this.last = now;
    const { scene, camera, renderer } = this.ctx;
    this.applyTabs();
    const arrived = settled(this.view, this.goal);
    if (arrived) this.flying = false;
    this.view = arrived ? this.goal : stepView(this.view, this.goal, dt);
    applyView(camera, this.view, this.W / this.H);
    const vk = `${this.view.x}|${this.view.y}|${this.view.z}|${this.view.yaw}|${this.view.pitch}|${this.view.height}|${this.W}|${this.H}`;
    if (vk !== this.viewKey) {
      this.viewKey = vk;
      this.viewRev.value++;
    }
    // the machine runs while it is on (the game ticks at `simSpeed`); the snapshot below is the one after those ticks
    this.simulate(dt);
    // (a plug the player holds that goes into the case opens the side panel, as a drag does in the game; a cord outside it does not)
    const handIn = !!this.hand.kind && !OUTSIDE.has(this.hand.kind) && !this.status.peek().busy;
    // (busy: the shut side panel's plate takes a ray only while no step plays, so a click on it opens it: `idAt`)
    this.machine.setOpen(this.wantOpen || this.jobOpen || handIn, this.status.peek().busy || !!this.anim || handIn);
    const inside = this.insideOpen;
    if (inside !== this.open.peek()) this.open.value = inside;
    const snap = this.snapshot;
    // the Ethernet jacks' lights follow the frames the port carries, on the game's clock (still while paused or off); the wall's router and the machine's jacks take the same levels
    const net = this.leds.step(snap, snap.powered ? dt * worldPace(this.simSpeed.peek()) : 0);
    this.wall?.lights(net);
    // (the panel keeps the pace of the steps: at 2x it opens in half the time, as the wait for it (`door`) is half)
    this.machine.frame(snap, dt, this.status.peek().busy ? dt * this.rate() : dt, net);
    this.hand.frame(Math.min(dt, 0.05) * this.rate(), camera);
    this.screen(snap, dt);
    // no stand-in (partlod.ts) from this stage's own zoom in; the wheel limit stays inside it at every aspect (machine3d.test.ts), so nothing else is held.
    // Low: the stand-ins draw by the size rule at every zoom (the Low phone's own view: 585 draws to 223), and the whole machine is held while a step runs
    if (lowDetail()) this.machine.holdDetail(this.anim || this.status.peek().busy ? [this.machine.root] : []);
    else this.machine.holdDetail([], (LOD_CEIL * this.H) / this.frameView().height);
    // (the art's density follows the `textures` setting as the board's view does: Low draws it at half what the screen needs)
    const dpr = renderer.getPixelRatio() * (TEXTURE_LEVELS[effective.peek().textures] ?? 1);
    this.machine.lod(camera, this.H, dpr);
    // (the wall's router: its shell fades for the zoom and its board shows, as the room's does)
    this.wall?.lod(camera, this.H, dpr);
    this.step(dt * this.rate());
    this.syncOutline();
    // (a tick that drew no frame has the time for more tiles: the tiles' frames come in batches, `DrawGate.want`)
    this.bakes.run(this.drew ? BAKE_MS : BAKE_STILL_MS);
    if (this.marker?.visible) (this.marker.material as MeshBasicMaterial).opacity = 0.22 + 0.14 * Math.sin(now / 160);
    this.lens.frame(camera, this.H, snap, dt, renderer.getPixelRatio(), this.machine);
    // (the power lens darkens the picture on purpose: the eye holds where it stood, and the local eye is out, or both would lift the dark back up)
    const dark = !!this.lens.dark;
    this.post.setDark(dark);
    this.eye.hold(dark);
    this.post.setReach(heightAt(this.view, BOARD_Z));
    // the eye adapts as in the game (`board3d.ts`): a cream case and a black one both read
    // (the meter's reading comes a frame or more after its draw: a tick with no draw takes the last frame's too)
    this.eye.read(this.post.metered());
    this.post.setEye(this.eye.step(dt));
    // drawn on demand: a part's motion, a fan or a panel, a lens, the snap preview's pulse, the eye on its way, or a camera move
    const D = distanceOf(this.view),
      w = renderer.domElement.width,
      h = renderer.domElement.height;
    const busy =
      !!this.anim ||
      !!this.hand.kind ||
      this.status.peek().busy ||
      this.machine.moving ||
      powerLens.peek() ||
      airflowLens.peek() ||
      !!this.marker?.visible ||
      !!this._game?.powered ||
      net.moving ||
      this.eye.moving ||
      this.moved.shift(camera, w, h, D / 4, D * 4) >= STILL_PX;
    // (tiles still in the queue: their frames come in batches, docs/render/case.md "Build my PC's frame")
    this.drew = this.demand.want(now, busy, this.bakes.size > 0);
    // (a still view adds jittered frames to its picture until its edges are smooth: `Post.refine`)
    if (!this.drew) {
      this.post.refine();
      return;
    }
    // (the first picture: its programs link first; the ticks until then draw nothing, give the tiles their time and ask again)
    if (!this.pictured && !this.programs.ready()) {
      this.drew = false;
      this.demand.ask();
      return;
    }
    syncWorld(scene);
    this.post.render();
    if (!this.pictured) {
      this.pictured = true;
      this.onPicture();
    }
    // (after the draw: the fades' see-through variants link on the driver's threads while the player looks, not at the first fade)
    if (this.warm) {
      this.warm = false;
      startPrograms(renderer, scene, camera, { fades: [this.machine.root, ...(this.monitor ? [this.monitor] : [])] });
    }
    this.moved.mark(camera, w, h);
    // (a frame with a change may have new materials or programs; the others refresh the ranks now and then)
    if (this.demand.forced || !(++this.frames % RANK_EVERY)) rankMaterials(scene, this.programOf);
    this.eye.read(this.post.meter());
  };

  private readonly programOf = (m: Material): number =>
    (this.ctx.renderer.properties.get(m) as { currentProgram?: { id: number } }).currentProgram?.id ?? 0;

  private step(dt: number): void {
    const a = this.anim;
    if (!a) return;
    a.t += dt;
    const m = motionFor(a.kind),
      p = poseAt(m, a.t, a.dir);
    for (const x of a.objs) {
      x.o.position.set(...placed(x.base, x.pivot, p.turn, p.offset));
      x.o.rotation.z = x.baseTurn + p.turn;
      x.o.rotation.y = x.baseTilt + p.tilt; // (a card tips about y; a fan on a side mount is built with its own quarter turn about y, which the motion keeps)
    }
    a.drive?.(p, ropeSteps(dt));
    a.fade?.set(solidAt(m, a.t, a.dir));
    this.setStep(p.label);
    const open = latchOpen(m, a.t, a.dir);
    for (const l of a.latches) {
      if (l.userData['leverOf'])
        l.rotation.y = LEVER_OPEN * open; // (the load lever lifts about its long side)
      else l.rotation.x = (l.userData['latchEnd'] ?? 0) * 0.5 * open;
    }
    if (a.t >= motionSeconds(m)) {
      // a part going in settles: it dips a little past its seat along the way it came, then comes back (a damped spring, 0.3 s)
      if (a.dir === 'in' && !a.drive && a.t < motionSeconds(m) + SETTLE_SECONDS) {
        const u = (a.t - motionSeconds(m)) / SETTLE_SECONDS,
          far = m.keys[m.keys.length - 1]!.at,
          reach = Math.hypot(...far) || 1;
        const k = (-SETTLE_DEPTH * Math.exp(-5 * u) * Math.sin(u * Math.PI * 3)) / reach;
        for (const x of a.objs)
          x.o.position.set(x.base[0] + far[0] * k, x.base[1] + far[1] * k, x.base[2] + far[2] * k);
        return;
      }
      // a part that went in is at its seat; a part that came out has faded where its way ended and is hidden there. This frame draws before the
      // job goes on (`done` resumes it after the draw): a part put back at its seat here showed there for a frame, then vanished. The fade's
      // copies go after the hide, or the part would show solid for a frame.
      if (a.dir === 'in')
        for (const x of a.objs) {
          x.o.position.set(x.base[0], x.base[1], x.base[2]);
          x.o.rotation.z = x.baseTurn;
          x.o.rotation.y = x.baseTilt;
        }
      else for (const x of a.objs) x.o.visible = false;
      a.end?.();
      a.fade?.end();
      this.anim = null;
      a.done();
    }
  }

  private setStep(step: string): void {
    const st = this.status.peek();
    if (st.step !== step) this.status.value = { ...st, step };
  }

  private note(line: string): void {
    const st = this.status.peek();
    this.status.value = { ...st, log: [...st.log.slice(-39), line] };
  }

  /** A refusal goes in the log like any step, and is raised for the hint line too (the player does not see the log). */
  private refuse(line: string): void {
    this.note(line);
    this.refusal.value = { text: line, n: ++this.refusals };
    this.holdRefusal();
  }

  /** The refusal goes after a few seconds, counted from the end of the job that raised it (while a job runs the hint line says its steps). */
  private holdRefusal(): void {
    clearTimeout(this.refusalTimer);
    if (this.refusal.peek() && !this.status.peek().busy)
      this.refusalTimer = setTimeout(() => {
        this.refusal.value = null;
      }, REFUSAL_MS);
  }

  /** Let the refusal go at once (the player dismissed it, or a new job or machine made it stale). */
  clearRefusal(): void {
    clearTimeout(this.refusalTimer);
    if (this.refusal.peek()) this.refusal.value = null;
  }

  /**
   * What is wrong with the machine as it stands (`buildAlerts`): a supply too small, a card with no lead, a part too hot. One run per change of the machine (the
   * heat is a dry run of the thermal model, some milliseconds), and none while a job runs: the machine is half taken apart then, and the list stays as it was.
   */
  get alerts(): readonly Alert[] {
    if (this.alertMemo && this.status.peek().busy) return this.alertMemo.list;
    // (keyed on the game's changes and on what has burnt, not on its snapshot: a machine that runs gives a new snapshot every tick, and its parts and cables have not changed)
    const rev = `${this.editRev}|${this.board.burnt ? 'b' : ''}${this.board.devices
        .filter((d) => d.burnt)
        .map((d) => d.id)
        .join(',')}`,
      shown = this.shown.peek();
    if (!this.alertMemo || this.alertMemo.rev !== rev || this.alertMemo.shown !== shown)
      this.alertMemo = { rev, shown, list: buildAlerts(this.board, this.cables, shown, this.game.fanPower()) };
    return this.alertMemo.list;
  }
  private alertMemo: { rev: string; shown: Shown; list: readonly Alert[] } | null = null;

  /**
   * The machine takes any part that fits its socket and answers as it would in real life, so a change that leaves it with a problem it did not have, or a worse
   * one (a supply too small, a card with no lead, a CPU too hot: `newAlerts`) must not pass in silence: the hint line says it, amber, as it does a refusal. The
   * pill and the list say it too, for as long as it holds; this is for the player who is looking at the parts. A refusal of the same job is the news, and stays.
   * `had`: what the machine had before the job (`standing`).
   */
  private caution(had: ReadonlyMap<string, number>): void {
    if (this.refusal.peek()) return;
    const news = newAlerts(this.alerts, this.board, had)[0];
    if (news) this.refuse(`${news.title}: ${news.text}`);
  }

  // ------------------------------------------------------------------ the camera
  /** Fly to `v`: it is the goal, and the flight is marked (the first touch of the view catches it). */
  private fly(v: OrbitView): void {
    this.goal = v;
    this.flying = true;
  }

  /**
   * The nearest surface under a client point (world) among the machine, the wall and the monitor, or null: a zoom and a pan go at its depth. The plate that takes a click on
   * the shut glass side (`case.side`) is no surface: the ray goes through it to the board behind (at the glass's depth the board would pan slower than the pointer).
   */
  private surfaceAt(x: number, y: number): Vector3 | null {
    if (this.dead || !this._machine) return null;
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    return pickPoint(
      [this.machine.root, ...(this.wall ? [this.wall.root] : []), ...(this.monitor ? [this.monitor] : [])],
      this.ctx.camera,
      ((x - r.left) / r.width) * 2 - 1,
      -(((y - r.top) / r.height) * 2 - 1),
      (o) => idOf(o) === 'case.side',
    );
  }

  /** A part this big on the screen is looked at, not carried (`BIG_SIDE`, `BIG_AREA`). */
  private big(device: string): boolean {
    const a = this.anchorOf(device);
    return !!a && (Math.max(a.w, a.h) > BIG_SIDE * Math.min(this.W, this.H) || a.w * a.h > BIG_AREA * this.W * this.H);
  }

  /** `v` kept on the stage: its target within reach of the start view's (the machine and the wall cannot be lost), and not out past `FAR` times its height. */
  private onStage(v: OrbitView): OrbitView {
    const h = this.frameView(),
      gx = h.height * (this.W / this.H) * STAY,
      gy = h.height * STAY,
      c = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
    return {
      ...v,
      x: c(v.x, h.x - gx, h.x + gx),
      y: c(v.y, h.y - gy, h.y + gy),
      z: c(v.z, h.z - h.height, h.z + h.height),
      height: Math.min(v.height, h.height * FAR),
    };
  }

  /**
   * The pointers, as in the game (`board3d.ts`) and the Gallery's viewer (`core/render/three/pad.ts`): drag pans, right drag or shift turns, the wheel zooms
   * toward the surface under the pointer; on touch one finger pans, two fingers pinch and turn. A press on a part or a plug lifts it (the UI's drag, the hand).
   */
  private listen(el: HTMLCanvasElement): void {
    // what a pan or a pinch took hold of (the depth of the surface under it; the point a pinch zooms about, null: none), and a turn's start
    let grabZ: number | undefined,
      pinchAt: Vector3 | null | undefined,
      turning: { base: OrbitView; yaw: number; pitch: number } | null = null;
    /** The pointer is the hand's or the UI's now (their listeners are on the window): the canvas lets it go. */
    const give = (e: PointerEvent) => {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    const clampTo = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
    const gestures: PadHost = {
      press: (at, e) => {
        if (this.status.peek().busy || this.hand.kind) return null;
        // a cable's plug lifts as the pointer moves (a press that does not move is a click); a refused lift (a lead that carries power) goes on as a pan
        const cable = this.cableAt(at.x, at.y, true);
        if (cable)
          return {
            eager: true,
            lift: (ev) => {
              this.beginCable(cable, ev);
              const held = !!this.hand.kind;
              if (held) give(ev);
              return held;
            },
          };
        // a part (the UI's drag takes it): a mouse drag on a small one lifts it. On a finger, and on a part that fills the screen, a drag pans over it and a hold lifts it
        const id = this.onGrab ? this.partAt(at.x, at.y) : null;
        if (id)
          return {
            eager: e.pointerType === 'mouse' && !this.big(id),
            lift: () => {
              give(e);
              this.onGrab?.(id, e);
              return true;
            },
          };
        return null;
      },
      begin: (kind, at) => {
        // (a drag clears the hover; a flight in the air is caught where it is)
        if (this.hover.peek()) {
          this.hover.value = null;
          el.style.cursor = '';
        }
        if (this.flying) {
          this.flying = false;
          this.goal = this.view;
        }
        if (kind === 'turn') {
          // the view turns about the surface under the middle of the stage
          const r = el.getBoundingClientRect(),
            m = this.surfaceAt(r.left + r.width / 2, r.top + r.height / 2);
          if (m) {
            this.goal = retarget(this.goal, m.z);
            this.view = retarget(this.view, m.z);
          }
          turning = { base: this.goal, yaw: this.goal.yaw, pitch: this.goal.pitch };
          return;
        }
        const p = this.surfaceAt(at.x, at.y);
        grabZ = p?.z;
        pinchAt = kind === 'pinch' ? p : undefined;
      },
      pan: (dx, dy) => {
        // the grabbed surface follows the pointer: the pan goes at its depth, and the view goes with it at once
        const k = (grabZ === undefined ? this.view.height : heightAt(this.view, grabZ)) / this.H,
          was = this.goal;
        this.goal = this.onStage(panBy(this.goal, -dx * k, dy * k));
        this.view = {
          ...this.view,
          x: this.view.x + this.goal.x - was.x,
          y: this.view.y + this.goal.y - was.y,
          z: this.view.z + this.goal.z - was.z,
        };
      },
      turn: (dx, dy) => {
        const t = turnOf(dx, dy, this.H);
        turning ??= { base: this.goal, yaw: this.goal.yaw, pitch: this.goal.pitch };
        turning.yaw = clampTo(turning.yaw + t.yaw, -LIMITS.yaw, LIMITS.yaw);
        turning.pitch = clampTo(turning.pitch + t.pitch, LIMITS.pitchMin, LIMITS.pitchMax);
        this.goal = { ...turning.base, yaw: turning.yaw, pitch: turning.pitch };
      },
      zoom: (k, at) => {
        if (this.flying) {
          this.flying = false;
          this.goal = this.view;
        }
        const r = el.getBoundingClientRect(),
          p = pinchAt === undefined ? this.surfaceAt(at.x, at.y) : pinchAt;
        const nx = ((at.x - r.left) / r.width) * 2 - 1,
          ny = -(((at.y - r.top) / r.height) * 2 - 1);
        this.goal = this.onStage(p ? zoomOn(this.goal, p, k) : zoomAt(this.goal, k, nx, ny, this.W / this.H));
      },
      twist: (rad) => {
        this.goal = { ...this.goal, yaw: clampTo(this.goal.yaw + rad, -LIMITS.yaw, LIMITS.yaw) };
      },
      end: () => {
        grabZ = pinchAt = undefined;
        turning = null;
      },
      // (a press that did not move: a click on a part picks it, as the UI's drag does when it does not move; the side panel opens, empty space lets go of the picked part)
      tap: (at) => {
        const id = this.status.peek().busy || this.hand.kind || !this.onGrab ? null : this.partAt(at.x, at.y);
        if (id) this.select(id);
        else this.click(at.x, at.y);
      },
      // (a double click on a part flies to it; on anything else it frames the machine again)
      focus: (at) => {
        const d = deviceFor(this.idAt(at.x, at.y), this.board);
        if (d) this.focusDevice(d.id);
        else this.resetView();
      },
    };
    const pad = attachPad(el, gestures);
    const move = (e: PointerEvent) => {
      if (!pad.core.busy) this.pointerOver(e.clientX, e.clientY, el);
    };
    const leave = () => {
      if (!pad.core.busy) {
        this.hover.value = null;
        el.style.cursor = '';
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    this.cleanup.push(() => {
      pad.dispose();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    });
  }

  resetView(): void {
    this.fly(this.frameView());
  }

  /** A camera preset: the whole machine seen from the front, three-quarter (the start), the side, or from above; or the wall with its power plate and network jack. */
  preset(name: 'front' | 'angle' | 'side' | 'top' | 'wall'): void {
    if (name === 'wall') {
      this.fly(this.wallView());
      return;
    }
    const at = {
      front: { yaw: 0, pitch: 0.08 },
      angle: { yaw: START.yaw, pitch: START.pitch },
      side: { yaw: 1.05, pitch: 0.12 },
      top: { yaw: 0.2, pitch: 0.75 },
    }[name];
    this.fly({ ...this.frameView(), ...at });
  }

  /**
   * A picture of the machine as it stands: the whole case seen from the start view with its side panel off, `w` x `h` pixels, as a data URL (null while a
   * step plays). The baked pictures of the Start list (`tools/buildstills.mjs`) and the thumbnails of the saved builds are these. The view comes back as it was.
   */
  async capture(w: number, h: number, type = 'image/webp', quality = 0.85): Promise<string | null> {
    if (this.dead || this.status.peek().busy || this.shown.peek() === 'nothing') return null; // (an empty stage has no machine to frame)
    // (the first picture links the programs, and the parts' art comes in over a few frames)
    for (let i = 0; i < 160 && (!this.pictured || this.bakes.size > 0); i++) await sleep(50);
    if (this.dead || this.status.peek().busy) return null;
    const { scene, camera, renderer } = this.ctx,
      canvas = renderer.domElement,
      cw = canvas.width,
      ch = canvas.height,
      m = this.machine;
    const win = pictureWindow(cw, ch, w / h),
      body = m.bodyBox(),
      size = body.getSize(new Vector3()),
      mid = body.getCenter(new Vector3());
    const v = new Vector3(),
      project = (): Pt[] => {
        camera.updateMatrixWorld(true);
        const out: Pt[] = [];
        for (const x of [body.min.x, body.max.x])
          for (const y of [body.min.y, body.max.y])
            for (const z of [body.min.z, body.max.z]) {
              v.set(x, y, z).project(camera);
              out.push({ x: ((v.x + 1) / 2) * cw, y: ((1 - v.y) / 2) * ch });
            }
        return out;
      };
    // the start view on the middle of the machine, drawn in or out until the machine fills its share of the window (its box moves as the height changes: a few passes)
    let view: OrbitView = { ...this.frameView(), x: mid.x, y: mid.y, z: mid.z, height: Math.max(size.x, size.y) * 1.5 };
    for (let i = 0; i < 4; i++) {
      applyView(camera, view, cw / ch);
      view = { ...view, height: view.height * fitFactor(project(), win) };
    }
    applyView(camera, view, cw / ch);
    const crop = centred(project(), win, cw, ch),
      density = renderer.getPixelRatio() * (TEXTURE_LEVELS[effective.peek().textures] ?? 1);
    const monitor = this.monitor,
      monitorWas = monitor?.visible ?? false,
      wall = this.wall,
      wallWas = wall?.root.visible ?? false;
    if (monitor) monitor.visible = false;
    if (wall) wall.root.visible = false; // (the picture is of the machine: no wall behind it)
    try {
      return m.withoutDoor(() => {
        m.holdDetail([m.root]);
        m.lod(camera, this.H, density);
        this.post.setReach(heightAt(view, BOARD_Z));
        syncWorld(scene);
        this.post.render();
        // (read at once: the canvas keeps its picture only until the task ends)
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const g = out.getContext('2d')!;
        g.imageSmoothingQuality = 'high';
        g.drawImage(canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
        return out.toDataURL(type, quality);
      });
    } finally {
      if (monitor) monitor.visible = monitorWas;
      if (wall) wall.root.visible = wallWas;
      applyView(camera, this.view, this.W / this.H);
      this.demand.ask();
    }
  }

  /**
   * Fly the camera to a fitted part (its device id): in the middle of the window the panels leave free, the part filling `FOCUS_FILL` of its
   * larger side (a tall stick by its height, a wide card by its width). Head on, but for a part whose face does not look at the glass: a card stands on edge, its face looks up, so the
   * flight looks down on it as far as the camera tilts (as the game's `focusPart` does); a stick's faces look east, so it turns to read them. Nothing else turns the camera: this is the
   * player's own flight. False when it has no model.
   */
  focusDevice(id: string): boolean {
    const o = this.objectOf(devNode(id));
    if (!o) return false;
    o.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(o),
      c = box.getCenter(new Vector3()),
      s = box.getSize(new Vector3()),
      aspect = this.W / this.H;
    const rail = this.machine.rails.find((r) => r.id === id),
      turned =
        getSpec(this.board.devices.find((d) => d.id === id)?.spec ?? '')?.kind === 'ram'
          ? this.machine.rails.find((r) => r.id === 'ram')
          : undefined;
    // (the free window's middle is a little east of the screen's: the start view's shift, the same share of the view's width)
    const shiftOf = (height: number) => WALL_SHIFT * (height / this.frameView().height);
    if (rail?.lie) {
      const l = rail.lie,
        eff = l.d * Math.sin(LIMITS.pitchMax),
        v = fitRect(
          { x: rail.rect.x, y: -l.y - eff / 2, w: rail.rect.w, h: eff },
          rail.z,
          aspect,
          { yaw: 0, pitch: LIMITS.pitchMax, fov: this.goal.fov },
          FOCUS_FILL,
        );
      this.fly({ ...v, x: v.x - shiftOf(v.height) });
      return true;
    }
    const height = Math.max(s.y, s.x / aspect, 150) / FOCUS_FILL;
    this.fly({
      ...this.goal,
      x: c.x - shiftOf(height),
      y: c.y,
      z: turned ? turned.z : c.z,
      yaw: turned?.angle?.yaw ?? 0,
      pitch: turned?.angle?.pitch ?? 0,
      height,
    });
    return true;
  }

  /** The socket a part would be fitted in when dropped at a client point (or by a click when `x` is not given): what `fit` picks. Null when none takes it. */
  dropTarget(item: string, x?: number, y?: number): string | null {
    // (a case or a board lands on the PC itself; with no case on the stage a board has nothing to land on)
    if (/^(case|board)\d$/.test(item)) return this.shown.peek() === 'nothing' && item.startsWith('board') ? null : item;
    // (an OS, a router and a plan fit the room, not a socket: any drop on the stage takes them)
    if (netKindOf(item)) return item;
    const spec = getSpec(item);
    if (!spec || this.bare.peek()) return null; // (a bare case has no socket)
    const fits = (s: SlotInfo) => slotAccepts(s.type, spec.slot) && slotFits(s, spec);
    const at = x === undefined || y === undefined ? null : this.slotAt(x, y);
    if (at && boardSlots(this.board).some((s) => s.id === at && fits(s))) return at;
    return (
      freeSlots(this.board, spec.slot, spec)[0]?.id ??
      boardSlots(this.board).find((s) => fits(s) && this.board.devices.some((d) => d.slot === s.id))?.id ??
      null
    );
  }

  // ------------------------------------------------------------------ undo, redo and swaps: the history is the session's (`sim/buildhistory.ts`); the stage plays what a command returns
  /** Does an Undo or Redo play? Its parts go in with no cue: the cue is for a step the player makes. */
  private replaying = false;
  get canUndo(): boolean {
    return this.session?.canUndo ?? false;
  }
  get canRedo(): boolean {
    return this.session?.canRedo ?? false;
  }
  /** How many times the machine was swapped for another (a preset, a saved build, Undo of one): the UI tells a swap it just made from a later one by it. */
  get swaps(): number {
    return this.session?.swaps ?? 0;
  }
  /** Is the last step of the history a swap? Then Undo brings back the machine that was on the stage before. */
  get lastWasSwap(): boolean {
    return this.session?.lastWasSwap ?? false;
  }
  async undo(): Promise<void> {
    await this.replay('undo');
  }
  async redo(): Promise<void> {
    await this.replay('redo');
  }

  /** Undo or Redo: a part plays as a job; a swap, and an OS, router or plan change, happen at once. Ignored while a job plays. */
  private async replay(way: Way): Promise<void> {
    const { session } = this,
      next = session?.next(way);
    if (session === null || next === undefined || this.status.peek().busy) return;
    if (next === 'swap') {
      const wasSteel = this.steel;
      this.showSwap(session[way](this.shown.peek()), wasSteel);
    } else if (next === 'net') {
      const { refusal } = this.edit(() => session[way](this.shown.peek()));
      if (refusal !== null) this.refuse(refusal);
    } else {
      // (Undo of a fit, and Redo of a removal, take the part out first)
      const takesOut = (next === 'fit') === (way === 'undo');
      await this.job(async () => this.replayParts(session, way, takesOut));
    }
    this.bump();
  }

  /**
   * The session does the whole Undo or Redo of a part on the game first: one job for the part (a removal when `takesOut`), and one fit for each part
   * that comes back after it. The stage then plays them in turn, each as `remove` or `fit` plays it.
   */
  private async replayParts(session: BuildSession, way: Way, takesOut: boolean): Promise<void> {
    const { jobs } = session[way](this.shown.peek());
    if (jobs.some((j) => j.script.length > 0)) this.changed();
    this.replaying = true;
    try {
      await this.replayJobs(jobs, takesOut);
    } finally {
      this.replaying = false;
      // (a last job the game refused has no step to play: the stage goes to the game)
      if (this.playing !== null) {
        this.playing = null;
        this.panelRev++;
        this.snaps.drop();
      }
    }
  }

  /** The jobs of an Undo or Redo, one after the other, each as `remove` plays it (`removal`: the first one only) or as `fit` does. */
  private async replayJobs([job, ...rest]: Outcome[], removal: boolean): Promise<void> {
    if (job === undefined || this.dead) return;
    const [after] = rest,
      outs = job.script.filter(isOutStep).length,
      // (a refused removal is not played)
      plays = job.script.length > 0 && !(removal && job.refusal !== null);
    if (plays) await this.playScript(job, outs > 2 ? QUICK : 1);
    if (this.dead) return;
    // (the game stands at the end of the last job already: until the next one plays, the stage shows the machine as this one leaves it)
    if (after !== undefined) {
      this.playing = { ...after.before, over: new Map() };
      this.snaps.drop();
    }
    if (job.refusal !== null) this.refuse(job.refusal);
    else if (removal) this.noteDone(outs);
    if (!removal) await this.runLoose();
    if (after !== undefined) {
      this.putDown();
      this.reeled.clear();
      this.rebuild();
    }
    await this.replayJobs(rest, false);
  }

  /** The session put another game in the place of its own: show it. What was picked, lit or scored belonged to the machine that left (`wasSteel`: its side panel). */
  private showSwap({ script: [step] }: Outcome, wasSteel: boolean): void {
    if (step === undefined) return;
    const shown = step.shown ?? 'machine';
    this.clearRefusal();
    this.shown.value = shown; // (before the build: it draws the machine as it is now)
    this.newGame(); // (the scores of the old machine become the ones to compare with: `benchChanged`)
    this.panelOut.clear(); // (the machine that comes has its leads in their headers)
    this.panelRev++;
    this.select(null);
    this.glow(null);
    this.status.value = { busy: false, step: '', log: [step.line ?? ''], rev: this.status.peek().rev };
    this.rebuild();
    // (a steel panel opens for the new machine, there is nothing to see shut; a glass one is left to the zoom, as it was; with no case there is no panel)
    if (shown === 'nothing') this.wantOpen = false;
    else if (this.steel) this.wantOpen = true;
    else if (wasSteel) this.wantOpen = false;
  }
  private bump(): void {
    const st = this.status.peek();
    this.status.value = { ...st, rev: st.rev + 1 };
  }

  /** Is the side panel open (or opening)? The case hides what is inside it, so parts and sockets answer only then. */
  get insideOpen(): boolean {
    return this.wantOpen || this.jobOpen || this.machine.doorOpen;
  }
  openInside(open: boolean): void {
    if (this.shown.peek() === 'nothing') return; // (no case, no side panel)
    this.wantOpen = open;
    if (!open) {
      this.jobOpen = false;
      this.machine.closeDoor();
    }
    this.demand.ask();
  }

  /** The id under a client point, from the board's own pieces (the case is left out: it hides what is inside). */
  private hitId(x: number, y: number): string | null {
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    const o = pick(
      this.machine.boardRoots(),
      this.ctx.camera,
      ((x - r.left) / r.width) * 2 - 1,
      -(((y - r.top) / r.height) * 2 - 1),
    );
    return idOf(o);
  }

  /** The device under a client point (its id), when the side panel is open; else null. */
  partAt(x: number, y: number): string | null {
    if (this.dead || !this._machine || !this.machine.doorOpen) return null; // (a pointer event can land after the close, or before the machine is built)
    return deviceFor(this.hitId(x, y), this.board)?.id ?? null;
  }

  /** The socket under a client point: a part's slot, or an empty socket's id; null off the board or with the panel shut. */
  slotAt(x: number, y: number): string | null {
    if (this.dead || !this._machine || !this.machine.doorOpen) return null;
    const id = this.hitId(x, y);
    return deviceFor(id, this.board)?.slot ?? socketFor(id, this.board);
  }

  // ------------------------------------------------------------------ the pointer, as in the game (board3d.ts): outline, name, pick, open
  /** The nearest surface's id under a client point among what the pointer can mean: with the side panel open the board's pieces and the cables; shut, the case and the cords outside it. */
  private topId(x: number, y: number): string | null {
    const m = this.machine,
      r = this.ctx.renderer.domElement.getBoundingClientRect();
    return idOf(
      pick(
        m.doorOpen ? [...m.boardRoots(), ...m.cableRoots()] : [...m.caseRoots, ...m.cableRoots()],
        this.ctx.camera,
        ((x - r.left) / r.width) * 2 - 1,
        -(((y - r.top) / r.height) * 2 - 1),
      ),
    );
  }

  /**
   * The cable a client point means (its kind), or null: the one the ray meets, or (`reach`) the plug nearest the pointer within a thumb's reach (`plugNear`). Inside the
   * case only with the side panel open; a cord outside it (the PC's and the monitor's mains, the video cable, the LAN lead) at any time. The case's own leads are
   * inert (nothing to pick).
   */
  private cableAt(x: number, y: number, reach = false, top: string | null = this.topId(x, y)): string | null {
    if (this.dead || !this._machine || this.shown.peek() !== 'machine') return null;
    const open = this.machine.doorOpen,
      ray = top?.startsWith('cable.') ? top.slice(6) : null;
    const kind = (reach ? this.plugNear(x, y, ray ? SEATED_PX : GRAB_PX, open) : null) ?? ray;
    return kind && (open || OUTSIDE.has(kind)) && !isPanelId(kind) ? kind : null;
  }

  /** Each cable's plug as the screen has it (a loose plug's middle; the seat of a seated one, which has a smaller reach), measured again after a moment (they fall and the camera moves). */
  private plugs: { at: number; key: string; list: { id: string; x: number; y: number; reach: number }[] } = {
    at: -Infinity,
    key: '',
    list: [],
  };

  /** The cable whose plug is nearest a client point and within `maxPx` of it, or null (`board3d.ts` `looseNear`). With the side panel shut only the cords outside the case count. */
  private plugNear(x: number, y: number, maxPx: number, open: boolean): string | null {
    const m = this._machine;
    if (!m) return null;
    const now = performance.now(),
      key = `${this.viewKey}|${this.status.peek().rev}|${open}|${this.hand.kind ?? ''}`;
    if (now - this.plugs.at > 120 || this.plugs.key !== key) {
      const r = this.ctx.renderer.domElement.getBoundingClientRect(),
        cam = this.ctx.camera,
        list: { id: string; x: number; y: number; reach: number }[] = [];
      cam.updateMatrixWorld();
      for (const c of this.snapshot.cables) {
        const rig = m.rig(c.id);
        if (!rig || m.isHeldBack(c.id) || (!open && !OUTSIDE.has(c.id))) continue;
        let p: Vector3 | null = null,
          reach = GRAB_PX;
        if (c.connected) {
          p = new Vector3(...rig.seat.at);
          reach = SEATED_PX;
        } else {
          const g = m.cableGroup(c.id);
          let plug: Object3D | null = null;
          g?.traverse((o) => {
            if (!plug && o.userData['plug']) plug = o;
          });
          const o: Object3D | null = plug ?? g;
          if (o) {
            o.updateWorldMatrix(true, true);
            p = new Box3().setFromObject(o).getCenter(new Vector3());
          }
        }
        if (!p) continue;
        p.project(cam);
        if (p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1)
          list.push({ id: c.id, x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, reach });
      }
      this.plugs = { at: now, key, list };
    }
    let best: string | null = null,
      d = maxPx;
    for (const p of this.plugs.list) {
      const k = Math.hypot(p.x - x, p.y - y);
      if (k <= Math.min(d, p.reach)) {
        d = k;
        best = p.id;
      }
    }
    return best;
  }

  /** Is the case's own power button under a client point? (A ray at the case's pieces: the side panel's and the shell's, with the button on the front.) */
  private powerAt(x: number, y: number): boolean {
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    return (
      idOf(
        pick(
          this.machine.caseRoots,
          this.ctx.camera,
          ((x - r.left) / r.width) * 2 - 1,
          -(((y - r.top) / r.height) * 2 - 1),
        ),
      ) === 'power'
    );
  }

  /**
   * What the pointer means at a client point: a fitted device (its id), an empty socket (its id), a cable (`cable.` and its kind), the case's power button
   * (`power`), or the shut case's side panel (`case.side`); null for the rest.
   */
  idAt(x: number, y: number): string | null {
    if (this.dead || !this._machine) return null;
    const top = this.topId(x, y);
    if (!this.machine.doorOpen) {
      // (the case hides what is inside it: its side panel answers, and a click on it opens it; so does its power button)
      if (top === 'case.side' || top === 'power') return top;
      const c = this.cableAt(x, y, true, top);
      return c ? `cable.${c}` : null;
    }
    const c = this.cableAt(x, y, true, top);
    if (c) return `cable.${c}`;
    const id = this.hitId(x, y);
    return deviceFor(id, this.board)?.id ?? socketFor(id, this.board) ?? (this.powerAt(x, y) ? 'power' : null);
  }

  /** The pointer moved over the canvas with no button down: name what it is over (the ray at most every 30 ms: the pointer outruns the draws). */
  private pointerOver(x: number, y: number, el: HTMLElement): void {
    if (this.dead || !this._machine) return;
    if (this.carried || this.hand.kind || this.status.peek().busy) {
      if (this.hover.peek()) this.hover.value = null;
      return;
    }
    const now = performance.now(),
      was = this.hover.peek();
    if (now - this.hoverTime < 30) {
      if (was) this.hover.value = { ...was, x, y };
      return;
    }
    this.hoverTime = now;
    const id = this.idAt(x, y);
    this.hover.value = id ? { id, x, y } : null;
    el.style.cursor = id ? (id.startsWith('cable.') ? 'grab' : 'pointer') : '';
  }

  /** A click on the canvas that picked no part: the power button powers the machine on or off, the side panel opens or shuts; anywhere else lets go of the picked part. */
  private click(x: number, y: number): void {
    if (this.status.peek().busy) return;
    const id = this.idAt(x, y);
    if (id === 'power') {
      this.power();
      this.hover.value = null;
      return;
    }
    if (id === 'case.side') {
      this.openInside(!this.insideOpen);
      this.hover.value = null;
      return;
    }
    this.select(null);
  }

  // ------------------------------------------------------------------ the player's hand on a cable
  /** Ends the cable the player holds (the pointer's events on the window come off); null when none is held. */
  private cableDrop: ((cancelled: boolean) => void) | null = null;
  /** What the held plug would do at the pointer ("Plug into the CPU power socket", "Let go to plug into …") and where the pointer is: the toolbar draws it by the pointer. */
  readonly cableTip = signal<{ text: string; ok: boolean; x: number; y: number } | null>(null);

  /**
   * The player takes hold of a cable's plug (`down` found it, and the pointer moved): a seated plug is pulled out against its latch, a loose one lifted. The hand
   * holds it until the pointer is let go: over its socket it slides in and clicks (the game's rule: a cable other than the hot-pluggable ones needs the machine
   * off), anywhere else it falls on its cable and stays where it lands. Escape lets go and drops it.
   */
  private beginCable(kind: string, e: PointerEvent): void {
    if (this.dead || this.status.peek().busy || this.hand.kind) return;
    if (this.snapshot.powered && !hotPluggable(kind)) {
      this.refuse('Power the machine off first: the PSU cables carry live power.');
      return;
    }
    this.clearRefusal();
    if (!this.hand.grab(kind, e.clientX, e.clientY)) {
      this.refuse('This lead cannot be moved.');
      return;
    }
    this.hover.value = null;
    this.trackCable(e.pointerId, e.clientX, e.clientY);
  }

  /** Follow the pointer for the hand until it lets go (a release, a cancel, Escape, the window losing focus). */
  private trackCable(id: number, cx: number, cy: number): void {
    const el = this.ctx.renderer.domElement;
    let last: [number, number] = [cx, cy];
    const tip = (x: number, y: number): void => {
      const l = this.hand.label();
      this.cableTip.value = l ? { ...l, x, y } : null;
    };
    const onMove = (m: PointerEvent): void => {
      if (m.pointerId !== id) return;
      last = [m.clientX, m.clientY];
      this.hand.move(m.clientX, m.clientY, this.rawIdAt(m.clientX, m.clientY));
      tip(m.clientX, m.clientY);
      this.demand.ask();
    };
    const onUp = (m: PointerEvent): void => {
      if (m.pointerId === id) end(false, m.clientX, m.clientY);
    };
    const onCancel = (m: PointerEvent): void => {
      if (m.pointerId === id) end(true, m.clientX, m.clientY);
    };
    const onKey = (k: KeyboardEvent): void => {
      if (k.key === 'Escape') {
        k.stopPropagation();
        end(true, ...last);
      }
    };
    const onBlur = (): void => end(true, ...last);
    const end = (cancelled: boolean, x: number, y: number): void => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      this.cableDrop = null;
      this.cableTip.value = null;
      el.style.cursor = '';
      if (!this.dead) this.hand.release(x, y, cancelled);
      this.demand.ask();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    this.cableDrop = (cancelled) => end(cancelled, ...last);
    el.style.cursor = 'grabbing';
    this.hand.move(cx, cy, this.rawIdAt(cx, cy));
    tip(cx, cy);
  }

  /** The id of whatever stands under a client point, the backdrops too (the case, the wall's sockets): a held plug that is over its socket's id snaps to it. */
  private rawIdAt(x: number, y: number): string | null {
    if (this.dead || !this._machine) return null;
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    return idOf(
      pick(
        [this.machine.root, ...(this.wall ? [this.wall.root] : [])],
        this.ctx.camera,
        ((x - r.left) / r.width) * 2 - 1,
        -(((y - r.top) / r.height) * 2 - 1),
      ),
    );
  }

  /** Pick a fitted device by its id (null lets go): it is outlined, and the UI's card is about it. */
  select(id: string | null): void {
    const known = id !== null && this.board.devices.some((d) => d.id === id);
    const next = known ? id : null;
    if (this.selected.peek() !== next) this.selected.value = next;
    this.demand.ask();
  }

  /** The UI starts (or ends, with null) a drag: a shelf part's sockets are outlined while it is held, a machine part's own outline stays. */
  carry(c: { item: string } | { device: string } | null): void {
    this.carried = c;
    if (c) this.hover.value = null;
    this.ctx.renderer.domElement.style.cursor = c ? 'grabbing' : '';
    this.demand.ask();
  }

  /** Point at a fitted device without the pointer (the machine's list under the cursor outlines its part); null stops. */
  glow(id: string | null): void {
    if (this.glowing === id) return;
    this.glowing = id;
    this.demand.ask();
  }

  /** The scene object to outline for an id: a device's own, or an empty socket's (or the side panel's) box. */
  private outlineOf(id: string): Object3D | null {
    if (this.board.devices.some((d) => d.id === id)) return this.objectOf(devNode(id));
    // (the wall's sockets take a held cord: they are the stage's, not the machine's)
    const o = findById(this.machine.root, id) ?? (this.wall ? findById(this.wall.root, id) : null);
    return o ? ownerOf(o) : null;
  }

  /** The ids to outline now, as the game draws them (board3d.ts): the hovered part, the picked one, the socket a held plug fits, and while a shelf part is held every socket that takes it. */
  private outlineIds(): string[] {
    if (this.status.peek().busy || this.anim) return [];
    const c = this.carried;
    if (c && 'item' in c) {
      const f = fitSlots(this.board, c.item);
      return [...f.free, ...f.swap].map((s) => this.board.devices.find((d) => d.slot === s)?.id ?? s);
    }
    if (c) return [c.device];
    return [
      ...new Set(
        [this.hover.peek()?.id, this.selected.peek(), this.glowing, ...this.hand.targets()].filter(
          (x): x is string => !!x,
        ),
      ),
    ];
  }

  /** Hand the pass the outlined objects, when the ids or the machine changed. */
  private syncOutline(): void {
    const sel = this.selected.peek();
    if (sel && !this.board.devices.some((d) => d.id === sel)) this.selected.value = null;
    const ids = this.outlineIds(),
      key = `${this.status.peek().rev}|${ids.join(',')}`;
    if (key === this.outlineKey) return;
    this.outlineKey = key;
    const objs: Object3D[] = [];
    for (const id of ids) {
      const o = this.outlineOf(id);
      if (o) objs.push(o);
    }
    this.post.setOutlined(objs);
    this.demand.ask();
  }

  /** The client rectangle of a fitted device or a socket as drawn now, for what is placed by it (the card); null when it is not on the screen. */
  anchorOf(id: string): Rect | null {
    if (this.dead || !this._machine) return null;
    const o = this.outlineOf(id);
    if (!o) return null;
    const { camera, renderer } = this.ctx,
      r = renderer.domElement.getBoundingClientRect();
    camera.updateMatrixWorld(true);
    o.updateWorldMatrix(true, true);
    return screenRect(new Box3().setFromObject(o), camera, { x: r.left, y: r.top, w: r.width, h: r.height });
  }

  /** Dev and checks: put the camera exactly here (the flicker check nudges it a pixel at a time). */
  jump(v: Partial<OrbitView>): void {
    this.view = this.goal = { ...this.view, ...v };
  }
  get orbit(): OrbitView {
    return this.view;
  }
  /** Dev aid (close-up reviews): turn the camera to a node's part and fill the view with it. */
  focus(node: string, yaw = 0.3, pitch = 0.35, fill = 2.2): boolean {
    const o = this.objectOf(node);
    if (!o) return false;
    o.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(o),
      c = box.getCenter(new Vector3()),
      s = box.getSize(new Vector3());
    this.jump({ x: c.x, y: c.y, z: c.z, yaw, pitch, height: Math.max(s.x, s.y, s.z) * fill });
    return true;
  }

  // ------------------------------------------------------------------ the steps
  /** The scene object that stands for a node, or null (the monitor stands in the room, not in the machine). */
  private objectOf(node: string): Object3D | null {
    const root = this.machine.root;
    if (isCableNode(node)) return findById(root, `cable.${node.slice(6)}`);
    if (isDevNode(node)) {
      const d = this.board.devices.find((x) => devNode(x.id) === node);
      if (!d) return null;
      if (deviceSpec(d).kind === 'display') return this.monitor;
      // (the shroud's cover also answers to 'psu': the supply's own group holds the unit)
      return (
        findById(root, d.id) ?? (deviceSpec(d).kind === 'psu' ? (root.getObjectByName(PSU_BODY)?.parent ?? null) : null)
      );
    }
    return null;
  }

  /** The part comes out: a power supply's shroud cover comes off first, and stays off until the rebuild that follows. */
  private async unseat(node: string, kind: string): Promise<void> {
    const cover = kind === 'psu' ? this.machine.root.getObjectByName(PSU_COVER) : null;
    if (cover) await this.playAll([cover], 'shroud', 'out');
    await this.play(node, kind, 'out');
  }

  /** The part goes in, right after the rebuild that made it: a power supply with its shroud's cover held off, which then goes back on. */
  private async seat(node: string, kind: string): Promise<void> {
    const cover = kind === 'psu' ? this.machine.root.getObjectByName(PSU_COVER) : null,
      far = poseAt(motionFor('shroud'), 0, 'in').offset;
    // (the cover is out of sight while the supply goes in: it fades in on its own way back)
    if (cover) {
      cover.position.set(cover.position.x + far[0], cover.position.y + far[1], cover.position.z + far[2]);
      cover.visible = false;
    }
    await this.play(node, kind, 'in');
    if (cover) {
      cover.position.set(cover.position.x - far[0], cover.position.y - far[1], cover.position.z - far[2]);
      cover.visible = true;
      await this.playAll([cover], 'shroud', 'in');
    }
  }

  /** After the rebuild that took a power supply away: its shroud's cover, rebuilt in place, comes back from where it was left. */
  private coverBack(kind: string): Promise<void> {
    const cover = kind === 'psu' ? this.machine.root.getObjectByName(PSU_COVER) : null;
    return cover ? this.playAll([cover], 'shroud', 'in') : Promise.resolve();
  }

  /** Play a motion on some objects together. Without any (the monitor of a part that is not built) the time still passes, so the log reads right. */
  private playAll(objs: Object3D[], kind: string, dir: 'out' | 'in', slot = ''): Promise<void> {
    const m = motionFor(kind),
      p = poseAt(m, 0, dir);
    // (a stick's socket latches swing with it: the ones of its own slot)
    const latches: Object3D[] = [];
    if (slot)
      this.machine.root.traverse((o) => {
        if (kind === 'ram' && o.userData['dimm'] === slot) latches.push(...o.children);
        else if (kind === 'cpu' && o.userData['leverOf'] === slot) latches.push(o);
      });
    // (the parts turn about their common middle: they are built at the machine's origin, so their own origin is far off; only a motion that turns needs it)
    const box = new Box3();
    if (m.keys.some((x) => x.hold || x.turn))
      for (const o of objs) {
        o.updateWorldMatrix(true, true);
        box.expandByObject(o);
      }
    const mid = box.isEmpty() ? null : box.getCenter(new Vector3());
    return new Promise((done) => {
      const list = objs.map((o) => {
        const c = mid && o.parent ? o.parent.worldToLocal(mid.clone()) : o.position;
        return {
          o,
          base: [o.position.x, o.position.y, o.position.z] as [number, number, number],
          baseTurn: o.rotation.z,
          baseTilt: o.rotation.y,
          pivot: [c.x, c.y] as [number, number],
        };
      });
      const fade = objs.length ? new PartFade(objs) : undefined;
      fade?.set(solidAt(m, 0, dir));
      this.anim = { objs: list, kind, dir, t: 0, latches, done, ...(fade ? { fade } : {}) };
      for (const x of list) {
        x.o.position.set(...placed(x.base, x.pivot, p.turn, p.offset));
        x.o.rotation.z = x.baseTurn + p.turn;
        x.o.rotation.y = x.baseTilt + p.tilt;
      }
    });
  }

  /**
   * The loop's hoses (`LoopHoses`) come off or go on: the compression rings, then the ends slide along their fittings, then the pair is carried on its
   * own weight (a live rope). They stay hidden while off (`hosesOff`). Without built hoses the time still passes, so the log reads right.
   */
  private async playHoses(dir: 'out' | 'in'): Promise<void> {
    const h = this.machine.hoses;
    if (!h) {
      await this.playAll([], 'hoses', dir);
      this.hosesOff = dir === 'out';
      return;
    }
    const m = motionFor('hoses'),
      p = poseAt(m, 0, dir),
      fade = new PartFade([h.root]);
    h.root.visible = true;
    h.pose(p.slide, p.offset, 2);
    fade.set(solidAt(m, 0, dir));
    await new Promise<void>((done) => {
      this.anim = {
        objs: [],
        kind: 'hoses',
        dir,
        t: 0,
        latches: [],
        done,
        fade,
        drive: (q, steps) => h.pose(q.slide, q.offset, steps),
        end: () => {
          h.rest();
          h.root.visible = dir === 'in';
        },
      };
    });
    this.hosesOff = dir === 'out';
    this.demand.ask();
  }

  /** The loop's hoses go on, when the machine has a loop and they are off. */
  private async connectHoses(): Promise<void> {
    if (!this.hosesOff || !hasLoop(this.board)) return;
    this.note(this.labelOf(HOSES, 'Put back'));
    await this.playHoses('in');
  }

  /** Play a node's motion on its object. */
  private play(node: string, kind: string, dir: 'out' | 'in'): Promise<void> {
    const obj = this.objectOf(node);
    const slot = this.board.devices.find((x) => devNode(x.id) === node)?.slot ?? '';
    return this.playAll(obj ? [obj] : [], kind, dir, slot);
  }

  /** The kind of the case on the stage: its side panel's look and pace (`casedoor.ts`). */
  private get caseKind(): CaseKind {
    return CASE_KIND[LAYOUT_CASE] ?? 'gamer';
  }
  /** Does the shut side panel hide the inside (a steel one, or a window over the upper part only)? A step behind it cannot be seen: it plays with the panel open. */
  private get steel(): boolean {
    return !DOOR_SEES[this.caseKind];
  }

  /**
   * The side panel for a step: it opens once, for the first step that needs the inside, and not at all when it stands open already (a click, the
   * zoom, the step before). The job holds it open to its end; then the zoom has it (`Machine3D.setOpen`), or the player when the panel is steel
   * (`job`). Only a new case or board shuts it. `settle`: wait for the whole swing (the case is about to lift: it must stand shut first).
   */
  private async door(open: boolean, settle = false): Promise<void> {
    const was = this.machine.doorOpen,
      kind = this.caseKind;
    if (open) {
      if (this.jobOpen) return;
      this.jobOpen = true;
      // (the zoom opened it a moment ago and it still swings: the step waits for it as well)
      if (was) {
        await this.swung(doorWait(kind), true);
        return;
      }
    } else {
      this.jobOpen = false;
      this.wantOpen = false;
      if (!was) return;
      this.machine.closeDoor();
    }
    this.setStep(open ? 'Undo the side panel' : 'Close the side panel');
    // (the work starts while the panel is still swinging: it is clear of the inside once it has swung far enough, `doorWait`)
    await sleep((DOOR_SECONDS[kind] * 1000 * (settle ? 1 : doorWait(kind))) / this.rate() + (settle ? 60 : 0));
    if (open) await this.swung(doorWait(kind), true);
    else if (settle) await this.swung(0, false);
  }

  /**
   * Wait until the side panel itself has swung to `to` (0 shut .. 1 open): at least that far when `open`, at most when shut. The clock's wait in `door` is the pace of a
   * steady frame rate; a slow frame counts for at most a tenth of a second (`frameDt`), so the panel can lag behind the clock, and a part must not move through a panel
   * that is still in its way. No panel (or a stage with no drawing loop) leaves the clock's wait; the longest it waits is a few times a full swing.
   */
  private async swung(to: number, open: boolean): Promise<void> {
    const until = Date.now() + (DOOR_SECONDS[this.caseKind] * 3000) / Math.max(0.25, this.rate()) + 300;
    for (;;) {
      const t = this._machine?.doorT;
      if (this.dead || t === undefined || t === null || (open ? t >= to - 0.01 : t <= to + 0.01) || Date.now() > until)
        return;
      await sleep(16);
    }
  }

  private labelOf(node: string, verb: 'Take out' | 'Put back'): string {
    if (node === SIDE) return verb === 'Take out' ? 'Open the side panel' : 'Close the side panel';
    if (node === HOSES) return verb === 'Take out' ? 'Disconnect the loop hoses' : 'Connect the loop hoses';
    if (isCableNode(node))
      return `${verb === 'Take out' ? 'Unplug' : 'Plug in'} ${this.snapshot.cables.find((c) => c.id === node.slice(6))?.name ?? node.slice(6)}`;
    const d = this.board.devices.find((x) => devNode(x.id) === node);
    return `${verb} ${d ? deviceSpec(d).name : node}`;
  }

  /** Take one node out of the machine, with its animation; what it was goes on `undo` (the target itself is left off it). */
  private async takeOut(node: string, undo: Undo[] | null): Promise<string | null> {
    if (node === SIDE) {
      await this.door(true);
      this.note(this.labelOf(node, 'Take out'));
      return null;
    }
    this.note(this.labelOf(node, 'Take out'));
    if (node === HOSES) {
      await this.door(true);
      await this.playHoses('out');
      undo?.push({ t: 'hoses' });
      return null;
    }
    if (isCableNode(node)) {
      const id = node.slice(6);
      if (!OUTSIDE.has(id)) await this.door(true);
      // the plug comes out as a player's hand pulls it: against its latch, free, lifted, then it falls on its cable (the built cable is hidden meanwhile)
      this.setStep('Pull the plug out of its socket');
      if (await this.hand.pullOut(id, this.pace > 1 ? CABLE_QUICK : 1)) {
        undo?.push({ t: 'cable', id });
        this.bump();
        return null;
      }
      await this.play(node, 'cable', 'out');
      this.edit(() => this.buildSession.disconnectCable(id));
      undo?.push({ t: 'cable', id });
      this.rebuild();
      return null;
    }
    const d = this.board.devices.find((x) => devNode(x.id) === node);
    if (!d) return null;
    const kind = deviceSpec(d).kind;
    // the cables that go with the part (a supply's leads and cord, a monitor's cables) are taken back into their hole first
    for (const id of cablesLost(this.board, d.id)) await this.reelIn(id);
    await this.unseat(node, motionOf(kind, d.slot, this.board));
    const r = this.edit((g) => g.uninstall(d.id));
    if (!r.ok) {
      this.refuse(`Cannot take it out: ${r.reason}`);
      this.rebuild();
      return null;
    }
    undo?.push({ t: 'dev', spec: d.spec, slot: d.slot, invId: r.invId!, clock: d.clock });
    this.rebuild();
    await this.coverBack(kind);
    return r.invId;
  }

  /** A held part goes back under the id the game gave it, at its place, shown. */
  private refit(kept: { obj: Object3D; id: string; p: Vector3; z: number; y: number }, id: string): void {
    kept.obj.traverse((o) => {
      const i = o.userData['id'];
      if (typeof i === 'string' && (i === kept.id || i.startsWith(`${kept.id}.`)))
        o.userData['id'] = id + i.slice(kept.id.length);
    });
    kept.obj.position.copy(kept.p);
    kept.obj.rotation.z = kept.z;
    kept.obj.rotation.y = kept.y;
    kept.obj.visible = true;
  }

  /** Parts a script took out and keeps built, by `spec@slot`: hidden at the far end of their way, with the place, the turns and the id they had. */
  private readonly held = new Map<string, { obj: Object3D; id: string; p: Vector3; z: number; y: number }>();

  private async putBack(u: Undo): Promise<void> {
    if (u.t === 'hoses') {
      await this.connectHoses();
      return;
    }
    if (u.t === 'cable') {
      if (this.cables[u.id] || !cableNeeded(this.board, u.id as never) || cableBlocked(this.board, u.id as never))
        return;
      // (the PC's cord goes into the supply's inlet: with the supply out it stays unplugged)
      if (u.id === 'pcmains' && !this.board.devices.some((d) => deviceSpec(d).kind === 'psu')) return;
      this.note(`Plug in ${this.snapshot.cables.find((c) => c.id === u.id)?.name ?? u.id}`);
      // a cable that came with its part runs out of its hole to its socket and is pushed in; the plug of one that lies loose is carried
      if (this.reeled.has(u.id)) {
        this.setStep('Run the cable to its socket');
        if (await this.runOut(u.id, true)) {
          this.bump();
          return;
        }
        if (this.dead) return;
      }
      // the loose plug is carried to its socket and pushed in; a cable with no rig (or one the game refuses) is connected at once
      this.setStep('Push the plug home');
      if (await this.hand.plugIn(u.id, this.pace > 1 ? CABLE_QUICK : 1)) {
        this.bump();
        return;
      }
      if (this.dead) return;
      this.edit(() => this.buildSession.connectCable(u.id));
      this.rebuild();
      await this.play(cableNode(u.id), 'cable', 'in');
      return;
    }
    const r = this.edit((g) => g.install(u.invId, u.slot));
    // (a fan the new heatsink or case has no spot for stays out, as the game sends it to the inventory)
    if (!r.ok) {
      this.refuse(
        getSpec(u.spec)?.kind === 'fan'
          ? `${getSpec(u.spec)!.name} no longer fits: it stays out`
          : `Cannot put ${getSpec(u.spec)?.name ?? u.spec} back: ${r.reason}`,
      );
      return;
    }
    this.note(`Put back ${getSpec(u.spec)?.name ?? u.spec}`);
    this.rebuild();
    const node = devNode(r.deviceId ?? '');
    await this.seat(
      node,
      motionOf(deviceSpec(this.board.devices.find((x) => x.id === r.deviceId)!).kind, u.slot, this.board),
    );
  }

  /**
   * Plug in the cables a part just fitted needs. The cords from the wall go in too (the game counted them plugged before the stage showed it; the video
   * cable and the LAN lead stay out: they are the player's).
   */
  private async plugNeeded(): Promise<void> {
    for (const c of cablesOf(this.board)) {
      if (
        (OUTSIDE.has(c.id) && !WALL_CABLES.includes(c.id as never)) ||
        this.cables[c.id] ||
        !cableNeeded(this.board, c.id) ||
        cableBlocked(this.board, c.id)
      )
        continue;
      await this.putBack({ t: 'cable', id: c.id });
    }
  }

  /** Cables the job keeps out of sight until it runs them out of their hole (a part just fitted brings its cables) and after it took them back into it. */
  private readonly reeled = new Set<string>();

  /** The machine just built (or patched) hides the cables the job holds back. */
  private holdReeled(): void {
    if (this.reeled.size) this._machine?.holdBack(this.reeled);
  }

  /** The job is over (or a new one begins): every cable shows as it stands. */
  private releaseReeled(): void {
    if (this.reeled.size) this._machine?.letRun(this.reeled);
    this.reeled.clear();
  }

  /** The cable runs out of its hole: pushed home at its socket (`plug`), or to where it lies. False when there is nothing to run (the built cable shows as it stands). */
  private async runOut(id: string, plug: boolean): Promise<boolean> {
    if (!this.reeled.delete(id)) return false;
    const ok = await this.hand.feed(id, plug, this.pace > 1 ? CABLE_QUICK : 1);
    if (!ok && !this.dead) this._machine?.letRun([id]);
    return ok;
  }

  /** A cable that goes with the part that is leaving is taken back into its hole along the way it lies (one still plugged is pulled out first), and stays out of sight. */
  private async reelIn(id: string): Promise<void> {
    const speed = this.pace > 1 ? CABLE_QUICK : 1;
    if (!this.machine.rig(id)) return;
    if ((isPanelId(id) ? !this.panelOut.has(id) : !!this.cables[id]) && !(await this.hand.pullOut(id, speed))) return;
    if (this.dead) return;
    this.setStep('Take the cable back into its hole');
    if (await this.hand.stow(id, speed)) this.reeled.add(id);
  }

  /**
   * The case's front-panel leads that are out of their headers (the board is out, or going in: `fitShell`). The machine shares the set (`syncPanel`).
   * They are the case's, not the game's cables: the sim has no such cable and a machine the game builds has every lead in.
   */
  private readonly panelOut = new Set<string>();
  private panelRev = 0;
  private panelSnap: { src: Snapshot; m: Machine3D; rev: number; out: Snapshot } | null = null;

  /** The snapshot as the hand reads it: the game's, and each front-panel lead of the machine as a cable (plugged unless it is out). */
  private handSnapshot(): Snapshot {
    const s = this.snapshot,
      m = this._machine,
      c = this.panelSnap;
    if (!m) return s;
    if (c && c.src === s && c.m === m && c.rev === this.panelRev) return c.out;
    // (an id the sim has no word for: the hand only reads it back)
    const leads = m.panelIds().map((id): CableSnap => ({
      id: id as CableSnap['id'],
      name: m.rig(id)!.name,
      connected: !this.panelOut.has(id),
    }));
    // (a script plays: a plug the hand moved in this step is as the hand left it)
    const over = this.playing?.over ?? new Map<string, boolean>(),
      own = s.cables.map((cable) => {
        const plugged = over.get(cable.id);
        return plugged === undefined ? cable : { ...cable, connected: plugged };
      });
    const out: Snapshot = { ...s, cables: [...own, ...leads] };
    this.panelSnap = { src: s, m, rev: this.panelRev, out };
    return out;
  }

  /** The hand pushed a plug in or pulled it out while a script plays: the game holds the job's end already, so only the hand's reading changes. */
  private handMoved(id: string, plugged: boolean): void {
    this.playing?.over.set(id, plugged);
    this.panelRev++;
    playCue(plugged ? 'cable_connect' : 'cable_disconnect');
  }

  /** The hand pushed a front-panel lead into its header or pulled it out: the stage says so and plays the cable cue, as for the game's cables (the machine's built lead follows the hand: `PlugHand`). */
  private plugPanelLead(id: string, plugged: boolean): void {
    if (plugged) this.panelOut.delete(id);
    else this.panelOut.add(id);
    this.panelRev++;
    playCue(plugged ? 'cable_connect' : 'cable_disconnect');
  }

  /**
   * The game's answer to a plug in or out. A refusal is said on the hint line. A cable moved by the player (no job runs) brings the machine in line with the game:
   * the wall's lights (the LAN lead), the chip, the alerts. A job does that at its end.
   */
  private cableChanged(r: ReturnType<BuildSession['connectCable']>, what: string, cue: CueId): void {
    if (!r.ok) {
      this.refuse(`Cannot ${what}: ${r.reason ?? 'refused'}`);
      return;
    }
    playCue(cue);
    if (!this.status.peek().busy) this.rebuild();
  }

  /** Every front-panel lead is in its header (a job is over; a machine the game built): the leads as the machine builds them. */
  private panelHome(): void {
    if (!this.panelOut.size) return;
    this.panelOut.clear();
    this.panelRev++;
    this._machine?.syncPanel(this.panelOut);
  }

  /** The board that goes in brings its leads along: they wait out of their headers, out of sight in their hole (`plugPanel` runs them out once the board is in). */
  private holdPanel(): void {
    for (const id of PANEL_IDS) {
      this.panelOut.add(id);
      this.reeled.add(id);
    }
    this.panelRev++;
  }

  /** The board is in: the hand runs each lead out of its hole to its header and pushes the plug home. */
  private async plugPanel(): Promise<void> {
    const ids = this.machine.panelIds().filter((id) => this.reeled.has(id));
    if (!ids.length) return;
    this.note('Plug in the front-panel leads');
    for (const id of ids) {
      this.setStep('Run the lead to its header');
      await this.runOut(id, true);
      if (this.dead) return;
    }
  }

  /** The board is to come out: the hand pulls each front-panel lead off its header and takes it back into its hole (the case keeps them: they come out again with the next board). */
  private async unplugPanel(): Promise<void> {
    const ids = this.machine.panelIds().filter((id) => !this.reeled.has(id));
    if (!ids.length) return;
    this.note('Unplug the front-panel leads');
    for (const id of ids) {
      await this.reelIn(id);
      if (this.dead) return;
    }
  }

  /** The cables a part brought that nobody plugs (the video cable) run out and lie where they fall. */
  private async runLoose(): Promise<void> {
    const left = new Set<string>(this.snapshot.cables.filter((c) => c.connected || !c.blocked).map((c) => c.id));
    for (const id of [...this.reeled]) {
      if (!left.has(id)) {
        this.reeled.delete(id);
        continue;
      }
      this.setStep('Lay the cable out');
      await this.runOut(id, false);
    }
  }

  private async job(work: () => Promise<void>): Promise<void> {
    if (this.status.peek().busy || this.dead) return;
    this.clearRefusal(); // (what was refused before is stale once the player tries again)
    // (parts and the supply's cables only move while the machine is off: a job switches it off first, as a player would)
    if (this._game?.powered) {
      this.game.powerButton();
      this.snaps.drop();
      this.editRev++;
      this.owed = 0;
      this.syncRun();
      this.note('Powered off: parts only move while the machine is off');
    }
    // (the picked part is the one in its socket after the job: a part that came out and went back in has a new id)
    const sel = this.selected.peek(),
      was = sel ? this.board.devices.find((d) => d.id === sel) : undefined;
    const had = standing(this.alerts, this.board);
    this.reeled.clear();
    this.hover.value = null;
    this.status.value = { ...this.status.peek(), busy: true, step: '' };
    this.pace = 1;
    this.skipping = false;
    try {
      await work();
    } catch (e) {
      if (!this.dead) throw e;
    } finally {
      // (a close in the middle of a job: the stage is gone, nothing to put back)
      if (!this.dead) {
        this.putDown();
        this.status.value = { ...this.status.peek(), busy: false, step: '' };
        this.holdRefusal(); // (a refusal the job raised: its seconds count from now)
        this.keepOs();
        this.caution(had);
        this.rebuild();
        this.selected.value = was
          ? (this.board.devices.find((d) => d.slot === was.slot && d.spec === was.spec)?.id ?? null)
          : null;
      }
    }
  }

  /** After a script: the hand is empty, and the case and the hoses are as between two jobs. */
  private putDown(): void {
    // (a cable still held back shows as it stands)
    this.hand.cancel();
    this.releaseReeled();
    this.panelHome();
    // (the side panel is the zoom's again: it stays while the view is on the board; a loop's hoses are never left off.
    // A steel panel shows nothing shut, so what the job did stays in view: the panel stays open until the player shuts it)
    this.jobOpen = false;
    if (this.steel && this.machine.doorOpen) this.wantOpen = true;
    this.pace = 1;
    this.skipping = false;
    this.hosesOff = false;
    const h = this._machine?.hoses;
    if (h && !h.root.visible) {
      h.rest();
      h.root.visible = true;
      this.demand.ask();
    }
  }

  /** The nodes to take out for a target, in order (the target last). */
  plan(node: string): string[] {
    return this.dead ? [] : removalPlan(buildGraph(this.board, this.cables), node);
  }

  /** Take a part out with everything in its way, then put the others back. The part goes to the bin (the game's inventory). */
  async remove(node: string): Promise<void> {
    return this.job(async () => this.removeSteps(node));
  }

  /** The session does the whole removal on the game first (`BuildSession.remove`); the stage then plays its script. */
  private async removeSteps(node: string): Promise<void> {
    const { session } = this;
    if (session === null) {
      return;
    }
    const job = this.edit(() => session.remove(node));
    if (job.refusal !== null) {
      this.refuse(job.refusal);
      return;
    }
    // (a part's removal is a step the player made: its cue. A cable's has its own)
    if (job.before.board.devices.some((d) => devNode(d.id) === node)) playCue('uninstall');
    const outs = job.script.filter(isOutStep).length;
    await this.playScript(job, outs > 2 ? QUICK : 1);
    this.noteDone(outs);
  }

  private noteDone(outs: number): void {
    this.note(`Done: ${outs} step${outs === 1 ? '' : 's'}`);
  }

  /**
   * Play a session's script: each step's motion on the machine as it stood before the step, then the step's state takes its place. The hand moves plugs
   * on the step's state (`handMoved`), never on the game. Parts that come out stay built and hidden; a part that goes back is shown again under its new id
   * (the step's `ids`). `quick`: the pace of the steps that are not the target.
   */
  private async playScript(job: Outcome, quick: number): Promise<void> {
    this.playing = { ...job.before, over: new Map() };
    this.snaps.drop();
    try {
      // (a new part goes in with the put-back steps right behind it, as one: `playPartIn`)
      const from = job.script.findIndex((s) => s.kind === 'part-in'),
        end = job.script.findIndex((s, i) => i > from && s.kind !== 'put-back'),
        group = from === -1 ? [] : job.script.slice(from, end === -1 ? job.script.length : end);
      let others = quick;
      for (const s of job.script) {
        if (this.dead) {
          return;
        }
        if (s === group[0]) {
          // oxlint-disable-next-line no-await-in-loop -- one step after the other: each plays on the state the one before left
          await this.playPartIn(job, group);
          // (the hoses and the cables after the new part go at full pace)
          others = 1;
        } else if (!group.includes(s)) {
          this.pace = s.target ? 1 : others;
          // oxlint-disable-next-line no-await-in-loop -- one step after the other: each plays on the state the one before left
          await this.playStep(s);
        }
      }
      for (const r of job.refusals) {
        this.refuse(r);
      }
    } finally {
      this.pace = 1;
      this.playing = null;
      this.panelRev++;
      this.snaps.drop();
    }
  }

  /** The step's state takes the place of the one before: what the step changed is now the machine as the stage reads it. */
  private reach(s: ScriptStep): void {
    this.playing = { snapshot: s.snapshot, board: s.board, cables: s.cables, over: new Map() };
    this.panelRev++;
    this.snaps.drop();
    this.demand.ask();
  }

  private async playStep(s: ScriptStep): Promise<void> {
    for (const r of s.refusals) {
      this.refuse(r);
    }
    switch (s.kind) {
      case 'door-open': {
        await this.door(true);
        this.note(this.labelOf(SIDE, 'Take out'));
        break;
      }
      case 'hoses-out': {
        this.note(this.labelOf(HOSES, 'Take out'));
        await this.door(true);
        await this.playHoses('out');
        break;
      }
      case 'hoses-on': {
        if (this.hosesOff) {
          this.note(this.labelOf(HOSES, 'Put back'));
          await this.playHoses('in');
        }
        break;
      }
      case 'cable-out': {
        await this.playCableOut(s);
        return;
      }
      case 'cable-in': {
        await this.playCableIn(s);
        return;
      }
      case 'part-out': {
        await this.playPartOut(s);
        return;
      }
      case 'put-back': {
        await this.playPutBack(s);
        return;
      }
      case 'shell-in': {
        // (a case or board fitted: `fitShell` plays that on its own)
        return;
      }
      case 'cable-run': {
        // (a cable the new part brought and no step plugged in: it runs out of its hole and lies loose)
        const id = s.node.slice(6);
        if (this.reeled.has(id)) {
          this.setStep('Lay the cable out');
          await this.runOut(id, false);
        }
        break;
      }
      // (a new part is played with the parts behind it, by `playPartIn`; a swap has no motion: `showSwap`)
      case 'swap':
      case 'part-in': {
        return;
      }
      // no default
    }
    this.reach(s);
  }

  /** The plug comes out as a player's hand pulls it: against its latch, free, lifted, then it falls on its cable (the built cable is hidden meanwhile). */
  private async playCableOut(s: ScriptStep): Promise<void> {
    const id = s.node.slice(6);
    this.note(this.labelOf(s.node, 'Take out'));
    if (!OUTSIDE.has(id)) {
      await this.door(true);
    }
    this.setStep('Pull the plug out of its socket');
    if (await this.hand.pullOut(id, this.pace > 1 ? CABLE_QUICK : 1)) {
      this.reach(s);
      this.bump();
      return;
    }
    await this.play(s.node, 'cable', 'out');
    this.reach(s);
    this.rebuild();
  }

  /** A cable that came with its part runs out of its hole to its socket and is pushed in; the plug of one that lies loose is carried. */
  private async playCableIn(s: ScriptStep): Promise<void> {
    const id = s.node.slice(6);
    this.note(`Plug in ${this.snapshot.cables.find((c) => c.id === id)?.name ?? id}`);
    if (this.reeled.has(id)) {
      this.setStep('Run the cable to its socket');
      if (await this.runOut(id, true)) {
        this.reach(s);
        this.bump();
        return;
      }
      if (this.dead) {
        return;
      }
    }
    this.setStep('Push the plug home');
    if (await this.hand.plugIn(id, this.pace > 1 ? CABLE_QUICK : 1)) {
      this.reach(s);
      this.bump();
      return;
    }
    if (this.dead) {
      return;
    }
    this.reach(s);
    this.rebuild();
    await this.play(s.node, 'cable', 'in');
  }

  /** A part comes out (a radiator with the fans on it, as one piece). It stays built, hidden where its way ends, kept by its id until it goes back. */
  private async playPartOut(s: ScriptStep): Promise<void> {
    const { node } = s,
      d = this.board.devices.find((x) => devNode(x.id) === node);
    this.note(this.labelOf(node, 'Take out'));
    if (d === undefined) {
      this.reach(s);
      return;
    }
    if (s.with !== undefined && (await this.playAssemblyOut(s, d, s.with))) {
      return;
    }
    const { kind } = deviceSpec(d),
      obj = kind !== 'display' && kind !== 'psu' ? this.objectOf(node) : null;
    if (obj) {
      this.keep(obj, d);
    }
    // the cables that go with the part (a supply's leads and cord, a monitor's cables) are taken back into their hole first
    for (const id of cablesLost(this.board, d.id)) {
      // oxlint-disable-next-line no-await-in-loop -- each cable goes back into its hole in turn
      await this.reelIn(id);
    }
    await this.unseat(node, motionOf(kind, d.slot, this.board));
    if (this.dead) {
      return;
    }
    this.reach(s);
    if (obj) {
      obj.visible = false;
      this.bump();
      return;
    }
    this.rebuild();
    await this.coverBack(kind);
  }

  /** Keep a part that came out built, by `spec@slot` as a fit finds it again; a part that goes back finds its own by the old id (`takeHeld`). */
  private keep(obj: Object3D, x: InstalledDevice): void {
    this.held.set(`${x.spec}@${x.slot}`, {
      obj,
      id: x.id,
      p: obj.position.clone(),
      z: obj.rotation.z,
      y: obj.rotation.y,
    });
  }

  /** A radiator comes out with the fans on it as one piece; false when one of them is not built (the part then comes out alone). */
  private async playAssemblyOut(s: ScriptStep, d: InstalledDevice, fans: string[]): Promise<boolean> {
    const parts: { x: InstalledDevice; obj: Object3D }[] = [];
    for (const n of [s.node, ...fans]) {
      const x = this.board.devices.find((dev) => devNode(dev.id) === n),
        obj = x === undefined ? null : this.objectOf(n);
      if (x === undefined || !obj) {
        return false;
      }
      parts.push({ x, obj });
    }
    this.note(`Take out ${deviceSpec(d).name} with its ${fans.length} fan${fans.length === 1 ? '' : 's'}`);
    for (const p of parts) {
      this.keep(p.obj, p.x);
    }
    const objs = parts.map((p) => p.obj);
    await this.playAll(objs, 'assembly', 'out');
    if (this.dead) {
      return true;
    }
    this.reach(s);
    for (const o of objs) {
      o.visible = false;
    }
    this.bump();
    return true;
  }

  /** The part kept built for this old id (a step's id change), taken off the list; null when it is not built. */
  private takeHeld(id: string): { obj: Object3D; id: string; p: Vector3; z: number; y: number } | null {
    for (const [key, kept] of this.held) {
      if (kept.id === id) {
        this.held.delete(key);
        return kept;
      }
    }
    return null;
  }

  /** A part goes back (a radiator with its fans): the object kept for its old id is shown again under the new one, or built again. */
  private async playPutBack(s: ScriptStep): Promise<void> {
    const name = getSpec(s.spec ?? '')?.name ?? s.spec ?? s.node;
    this.reach(s);
    if (s.with !== undefined && s.with.length > 0) {
      this.note(`Put back ${name}${s.ids.size > 1 ? ' with its fans' : ''}`);
      const held = [...this.held.values()];
      if (![...s.ids.keys()].every((from) => held.some((k) => k.id === from))) {
        this.builtKey = '';
        this.rebuild();
      }
      const objs: Object3D[] = [];
      for (const [from, to] of s.ids) {
        const kept = this.takeHeld(from);
        if (kept) {
          this.refit(kept, to);
          objs.push(kept.obj);
        } else {
          const o = this.objectOf(devNode(to));
          if (o) {
            objs.push(o);
          }
        }
      }
      this.snaps.drop();
      this.bump();
      await this.playAll(objs, 'assembly', 'in');
      return;
    }
    const [change] = s.ids;
    if (change === undefined) {
      return;
    }
    const [from, to] = change;
    this.note(`Put back ${name}`);
    const kind = motionOf(getSpec(s.spec ?? '')?.kind ?? '', s.slot ?? '', this.board),
      kept = this.takeHeld(from);
    if (kept) {
      // the part that came out is still built: it goes back where it was, under the id the game gave it
      this.refit(kept, to);
      this.bump();
    } else {
      this.rebuild();
    }
    await this.seat(devNode(to), kind);
  }

  /** Fit a catalogue part (its id; the shelf is unlimited, there is no inventory here). `drop`: the socket it was dropped on
   *  (`slotAt`). The session does the whole fit on the game first (`BuildSession.fit`, which picks the socket); the stage then plays its script. */
  fit(item: string, drop?: string): Promise<void> {
    return this.job(async () => {
      if (/^(case|board)\d$/.test(item)) {
        return this.fitShell(item);
      }
      if (netKindOf(item)) {
        return this.fitNet(item);
      }
      return this.fitSteps(item, drop);
    });
  }

  private async fitSteps(item: string, drop: string | undefined): Promise<void> {
    const { session } = this;
    if (session === null) {
      return;
    }
    const job = session.fit(item, drop, this.shown.peek());
    // (a refused fit moved nothing and has no step: the kept snapshot and the scores stand)
    if (job.script.length > 0) {
      this.changed();
      await this.playScript(job, job.script.filter(isOutStep).length > 2 ? QUICK : 1);
    }
    if (job.refusal !== null) {
      this.refuse(job.refusal);
    }
    // (a cable taken back into its hole that no step ran out, as the video cable, lies where it falls)
    await this.runLoose();
  }

  /**
   * The new part goes in, with the parts that go back after it (`group`: the part-in step and the put-back steps behind it). One build shows them all,
   * hidden; each is then seated in turn (a radiator with its fans as one piece). A part with an object kept for its old id keeps that object.
   */
  private async playPartIn(job: Outcome, group: ScriptStep[]): Promise<void> {
    const [put] = group,
      last = group.at(-1);
    if (put === undefined || last === undefined) {
      return;
    }
    for (const s of group) {
      for (const r of s.refusals) {
        this.refuse(r);
      }
      // (before the build: a patch or a build drops what is kept)
      for (const [from, to] of s.ids) {
        const kept = this.takeHeld(from);
        if (kept) {
          this.refit(kept, to);
        }
      }
    }
    // (a part an earlier job took out may stand built yet, as for the Undo of its removal: it goes back in)
    const key = `${put.spec ?? ''}@${put.slot ?? ''}`,
      same = this.held.get(key);
    if (same) {
      this.held.delete(key);
      this.refit(same, put.node.slice(4));
    }
    this.reach(last);
    // a part that just made the loop is built with its hoses off: they go on last
    if (job.script.some((s) => s.kind === 'hoses-on')) {
      this.hosesOff = true;
    }
    // what the new part brought (a supply's leads and cord, a monitor's cables) stays out of sight until the part is in: then it runs out of its hole
    for (const s of job.script) {
      if (s.kind === 'cable-run') {
        this.reeled.add(s.node.slice(6));
      }
    }
    this.rebuild();
    const sets = group.map((s) => {
      const nodes = s.kind === 'part-in' ? [s.node] : Array.from(s.ids.values(), (id) => devNode(id));
      return { s, nodes, objs: nodes.map((n) => this.objectOf(n)).filter((o): o is Object3D => !!o) };
    });
    for (const o of sets.flatMap((x) => x.objs)) {
      o.visible = false;
    }
    this.note(`Fit ${getSpec(put.spec ?? '')?.name ?? put.spec ?? put.node} in ${put.slot ?? ''}`);
    // (a fit the player made: the cue of the part that left its slot, then of the new one)
    if (!this.replaying) {
      if (job.before.board.devices.some((d) => d.slot === put.slot)) playCue('uninstall');
      playCue('install');
    }
    for (const n of sets.slice(1).flatMap((x) => x.nodes)) {
      const d = this.board.devices.find((x) => devNode(x.id) === n);
      if (d !== undefined) {
        this.note(`Put back ${deviceSpec(d).name}`);
      }
    }
    const many = sets.flatMap((x) => x.nodes).length >= 3;
    for (const [i, { s, nodes, objs }] of sets.entries()) {
      if (this.dead) {
        return;
      }
      this.pace = i > 0 && many ? QUICK : 1;
      for (const o of objs) {
        o.visible = true;
      }
      if (s.with !== undefined && s.with.length > 0) {
        // oxlint-disable-next-line no-await-in-loop -- one part after the other goes in
        await this.playAll(objs, 'assembly', 'in');
      } else {
        const motion = motionOf(getSpec(s.spec ?? '')?.kind ?? '', s.slot ?? '', this.board);
        // oxlint-disable-next-line no-await-in-loop -- one part after the other goes in
        await this.seat(nodes[0] ?? s.node, motion);
      }
    }
    this.pace = 1;
  }

  /** Put an OS, a router or an internet plan in its place (`id`), or take it out (`id` null): the session's answer, and it records the step. */
  private setNetItem(kind: NetKind, id: string | null): ReturnType<BuildSession['setNet']> {
    const r = this.edit(() => this.buildSession.setNet(kind, id));
    if (r.ok) {
      playCue(id === null ? 'uninstall' : 'install');
      this.bump();
    }
    return r;
  }

  /**
   * An OS, a router or an internet plan from the shelf. They fit the room, not a socket: the OS goes on the first drive that holds it (the one it
   * replaces comes off), the router stands by the wall and is cabled to the machine's jack, and the plan comes in by the wall jack. Each replaces
   * the one of its kind; the same item again is refused. Undo sets the item that was there.
   */
  private async fitNet(itemId: string): Promise<void> {
    const r = this.setNetItem(netKindOf(itemId)!, itemId);
    if (!r.ok) {
      if (r.reason !== undefined) {
        this.refuse(r.reason);
      }
      return;
    }
    this.note(`Fit ${netName(itemId)}`);
  }

  /**
   * One change from the OS sheet's disk page (a drive formatted, a drive's spool slots, the dataset reserve): the game's own method on the stage's machine. A refusal
   * says why on the hint line. The scores no longer describe the machine, as after any change to it.
   */
  osDo(what: string, change: (g: Game) => { ok: boolean; reason?: string }): void {
    if (this.dead || !this._game || this.status.peek().busy) return;
    const refusal = this.edit(() => this.buildSession.osDo(what, change));
    this.bump();
    if (refusal !== null) {
      this.refuse(refusal);
    }
  }

  /** The processor's cores as the OS sees them (`hardware` cores, `logical` ones), for the OS sheet: what each OS would do with them. */
  get cpuCores(): { hardware: number; logical: number } {
    return { hardware: this.game.cpuCores(), logical: this.game.cpuLogicalCores() };
  }

  /** Take the OS, the router or the internet plan out (what the right panel's row does). Undo puts it back. */
  removeNet(kind: NetKind): Promise<void> {
    return this.job(async () => {
      const was = netState(this.game)[kind];
      if (!was) return;
      const r = this.setNetItem(kind, null);
      if (!r.ok) {
        if (r.reason !== undefined) {
          this.refuse(r.reason);
        }
        return;
      }
      this.note(`Took out ${netName(was)}`);
    });
  }

  /**
   * A new board or case: every part comes out first, the machine is swapped as one piece, then the parts go back (what no longer fits stays in the bin).
   * A bare case has no board and no part to lift: a new case is set down, and a board is lowered into it (the machine then stands as any other). With no
   * case on the stage (`nothing`) the first case is brought in, with nothing to take away. Each is a step Undo takes back, to the bare case or the empty
   * stage it left (a machine's own new case or board ends the history).
   */
  private async fitShell(itemId: string): Promise<void> {
    const isCase = itemId.startsWith('case'),
      tier = Number(itemId.slice(-1)),
      shown = this.shown.peek(),
      bare = shown !== 'machine',
      none = shown === 'nothing';
    // (what the game holds for a bare case or an empty stage is only held aside: a board of its tier, or a case of its tier on an empty stage, is not "already fitted")
    const held = isCase ? none && tier === this.board.caseTier : bare && tier === this.board.tier;
    // (asked of the session before anything moves: a case it refuses is not lifted off for nothing, and a refusal keeps the history)
    const why = this.buildSession.shellRefusal(itemId, shown, held);
    if (why) {
      this.refuse(why);
      return;
    }
    // (the bare case or the empty stage as it stands is a step to come back to)
    if (bare) await this.alive(this.session).bareStep(shown);
    else this.alive(this.session).forget(); // (a new case or board is not a step to undo: the history ends here)
    if (this.dead) return;
    playCue('install');
    // the case comes off when it is the new part, and when the new board is too big for it (the sandbox lets the case follow the board: `Game.install`)
    const newCase = isCase || !caseHolds(this.board, tier),
      glass = !this.steel;
    const steps = bare ? [] : removalPlan(buildGraph(this.board, this.cables), newCase ? CASE : BOARD);
    const undo: Undo[] = [];
    for (const n of steps) {
      if (n === BOARD || n === CASE) break;
      await this.takeOut(n, undo);
    }
    // the case's front-panel leads come off the board's headers and go back into their hole: the board lifts out bare
    if (!bare) await this.unplugPanel();
    // a glass panel shuts now: the board lifts out behind it. A steel one shows nothing shut, so it stands open for the board and shuts for the case
    if (!none) await this.door(!glass);
    // the board first (on a case swap too: the case cannot lift off with it inside), then the case
    if (!bare) {
      this.note('Undo the board screws and lift the board out');
      await this.playAll(this.machine.boardRoots(), 'board', 'out');
    }
    if (newCase && !none) {
      if (!glass) await this.door(false, true); // (the case lifts with its panel: it must stand shut)
      this.note('Take the old case away');
      await this.playAll(this.machine.caseRoots, 'case', 'out');
    }
    // (the board a bare case holds aside, of the tier asked for, is the one that goes in: the game has nothing to change. The same for the first case of an empty stage)
    // (the session fits it on the machine as it stands: the parts this loop took out come back below, the others moved with it)
    const job = this.edit(() => this.buildSession.fitShell(itemId, held));
    const fitted = { ok: job.refusal === null };
    for (const r of [...job.script.flatMap((s) => s.refusals), ...job.refusals]) {
      this.refuse(r);
    }
    if (job.refusal !== null) {
      this.refuse(job.refusal);
    }
    // (a case on an empty stage is a bare case now; a board in the case makes it a machine that stands as any other)
    else if (isCase) {
      if (none) this.shown.value = 'case';
    } else this.shown.value = 'machine';
    // (a board that goes in brings the case's leads: they wait out of sight in their hole until it is down)
    if (fitted.ok && this.shown.peek() === 'machine') this.holdPanel();
    this.rebuildAll();
    if (fitted.ok) {
      const board = this.machine.boardRoots(),
        far = poseAt(motionFor('board'), 0, 'in').offset,
        seen = board.map((o) => o.visible);
      if (newCase) {
        // the new case comes down first, the board still held over it (out of sight: it fades in on its own way down)
        for (const o of board) {
          o.position.set(o.position.x + far[0], o.position.y + far[1], o.position.z + far[2]);
          o.visible = false;
        }
        this.note(`Set the ${CASE_TIERS[this.board.caseTier]!.name} down`);
        await this.playAll(this.machine.caseRoots, 'case', 'in');
      }
      // (a steel panel opens for the board to go in, and for the parts that follow it; the board waits out of sight meanwhile)
      if (this.steel) await this.door(true);
      if (newCase)
        board.forEach((o, i) => {
          o.position.set(o.position.x - far[0], o.position.y - far[1], o.position.z - far[2]);
          o.visible = seen[i]!;
        });
      // (a case set down bare has no board to lower)
      if (!this.bare.peek()) {
        this.note(`Lower the ${isCase ? 'board' : `${BOARD_TIERS[tier]!.name} board`} onto its standoffs`);
        await this.playAll(board, 'board', 'in');
        // the case's front-panel leads run out of their hole to the board's headers and go in
        await this.plugPanel();
      }
    }
    for (const u of undo.reverse()) await this.putBack(u);
    if (!this.bare.peek()) await this.plugNeeded();
  }

  /** A swap by the session (one step Undo takes back), then the stage shows the game that came. */
  private async swap(command: (session: BuildSession, left: Shown) => Promise<Outcome>): Promise<void> {
    const { session } = this;
    if (session === null || this.status.peek().busy) return;
    const wasSteel = this.steel,
      done = await command(session, this.shown.peek());
    if (!this.dead) this.showSwap(done, wasSteel);
  }

  /** A ready-made machine, built at once (no animation): `level` 0..1 picks how high a tier of each part; `ram`, `storage`, `gpus` and `npus` how many
   *  of each to fit. Parts that fit nowhere are skipped. */
  async buildPreset(p: BuildPreset): Promise<void> {
    await this.swap(async (s, left) => s.buildPreset(p, left));
  }

  /** Load the benchmark's code (once): `benchIssues` has an answer after it. */
  async loadBench(): Promise<void> {
    if (this.benchMod || this.dead) return;
    this.benchMod = await import('@/features/sandbox/sim/pcbench');
    if (!this.dead) this.benchLoaded.value = true;
  }

  /**
   * Run the benchmark's tasks (`ids`; every task this machine can run when omitted) on copies of the machine as it stands, one after the other (the stage's game
   * is not changed). Each result lands in `bench` as it comes. A change to the machine or `stopBenchmark` ends the run: the task in progress has no result.
   */
  async runBenchmark(ids?: readonly string[]): Promise<void> {
    if (this.dead || this.benching.peek() || this.status.peek().busy) return;
    const stop: Stop = (this.benchStop = { aborted: false });
    playCue('ui_confirm');
    this.benching.value = { id: null, n: 0, total: 0 };
    try {
      await this.loadBench();
      if (this.dead || stop.aborted || !this.benchMod) return;
      const { benchable, runBenchTasks } = this.benchMod;
      const list = benchable(this.game, ids).map((t) => t.id);
      await runBenchTasks(this.game, list, {
        stop,
        onStart: (t, i, n) => {
          this.benching.value = { id: t.id, n: i + 1, total: n };
        },
        onResult: (r) => {
          this.bench.value = { ...this.bench.peek(), [r.id]: r };
        },
      });
      if (!stop.aborted) playCue('job_fulfilled');
    } finally {
      this.benching.value = null;
    }
  }

  /** End the benchmark that runs now (the task in progress has no result). */
  stopBenchmark(): void {
    this.benchStop.aborted = true;
  }

  /** What is in the machine now, to save under a name (`loadLayout` builds it again). */
  get layout(): BuildLayout {
    const g = this.game;
    return {
      caseTier: this.board.caseTier,
      boardTier: this.board.tier,
      parts: this.board.devices.map((d) => ({ spec: d.spec, slot: d.slot })),
      os: this.snapshot.os?.tier ?? 0,
      router: g.routerTier,
      isp: g.ispTier,
    };
  }

  /** Build a saved layout at once (no animation). Parts that no longer fit are skipped. */
  async loadLayout(l: BuildLayout, name: string): Promise<void> {
    await this.swap(async (s, left) => s.loadLayout(l, name, left));
  }

  /** A new sandbox machine: the biggest rig, as at the start. */
  async reset(): Promise<void> {
    await this.swap(async (s, left) => s.reset(left));
  }

  /** Nothing on the stage, not even a case: build up from nothing, the case first (from the shelf), then the board, then the parts. */
  async clear(): Promise<void> {
    await this.swap(async (s, left) => s.clear(left));
  }

  /**
   * Frees all that the stage owns (PERF12), once. The WebGL context, the renderer and the post chain's targets go at once. The machine with
   * its baked art, the monitor with its textures and the stage's own meshes go in a second task (`FREE_LATER_MS`): all in one task held a
   * phone's frame longer than the close did before. The room's shared caches (`roomGeo`, shared materials) stay.
   */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    studioMachine.value = null;
    this.onPicture(); // (an `open` that still waits for the first picture ends)
    this.benchStop.aborted = true; // (a run holds the game: it lets go at its next tick)
    clearTimeout(this.refusalTimer);
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) f();
    this.cleanup.length = 0;
    this.anim = null;
    this.cableDrop?.(true); // (a plug the player holds: the window's pointer events come off)
    this.hand.cancel();
    this.onGrab = null;
    setLayoutTier(...this.was);
    if (import.meta.env.DEV) {
      const w = window as unknown as { __build?: BuildStage };
      if (w.__build === this) delete w.__build;
    }
    disposeRenderContext(this.ctx);
    this.post.dispose();
    setTimeout(() => this.freeScene(), FREE_LATER_MS);
  }

  /** The second half of `dispose`: the meshes and materials (cheap with the context lost), and what Pixi kept for their art. */
  private freeScene(): void {
    this.lens.dispose();
    this.live.dispose();
    const { scene } = this.ctx;
    if (this._machine) {
      scene.remove(this._machine.root);
      this._machine.dispose();
    }
    if (this.monitor) {
      scene.remove(this.monitor);
      disposeTree(this.monitor, true);
      this.monitor = null;
      this.mon = null;
    }
    if (this.wall) {
      scene.remove(this.wall.root);
      this.wall.dispose();
      this.wall = null;
    }
    // the art is gone: what Pixi pooled for it, and its labels in the size rule
    freeBakePools();
    sweepLabels();
    // (a material shared with the room keeps this renderer's listener until its dispose)
    disposeTree(scene);
    scene.clear();
    this._machine = null;
    this.session = null;
    this.snaps.drop();
    this.bakes.drop(''); // (a job's closure holds the art it bakes)
    this.marker = this.floor = null;
    void this.host;
  }
}

/** How long after a close the stage frees its meshes: a frame or so after its context (`BuildStage.dispose`). */
const FREE_LATER_MS = 20;
