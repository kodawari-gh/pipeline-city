// The shapes Build my PC's stage (`buildstage.ts`) keeps: the bin's parts, its status, the undo history's steps and what a removal holds aside.
import type { Object3D, Vector3 } from 'three';
import type { NetKind } from '@/features/board/sim/buildnet';
import type { Shown } from '@/features/board/sim/buildspecs';
import type { InstalledDevice } from '@/features/board/sim/board';
import type { DeviceKind, DeviceSpec } from '@/features/board/sim/specs';
import type { Game } from '@/worker/game/game';
import type { Pose } from '../buildmotion';
import type { PartFade } from '../partfade';
import type { OrbitView } from '@/core/render/three/camera';
import type { PadHost } from '@/core/render/three/pad';

// The outside types the stage's layers name, given here so that a layer imports a module's values and its types from two places.
export type { RenderContext } from '@/core/render/three/init';
export type { Box, OrbitView } from '@/core/render/three/camera';
export type { DeviceSpec } from '@/features/board/sim/specs';
export type { Board, InstalledDevice, SlotInfo } from '@/features/board/sim/board';
export type { RunSpeed, RunState } from '@/features/board/sim/buildrun';
export type { Grab, PadHost } from '@/core/render/three/pad';
export type { Object3D, Scene, WebGLRenderer } from 'three';
export type { NetKind } from '@/features/board/sim/buildnet';
export type { Alert } from '@/features/board/sim/buildalerts';
export type { Rect } from '../buildpick';
export type { Pt, Win } from '../buildshot';
export type { LinkLevels } from '@/features/network/render/jackleds';
export type { Motion } from '../buildmotion';
export type { StageWall, WallNet, WallPlan } from '../studiowall3d';
export type { CaseKind } from '@/features/room/render/shell/casedecor';
export type { Game } from '@/worker/game/game';
export type { Snapshot } from '@/worker/protocol';
export type { CableId } from '@/features/board/sim/cables';
export type { HandSnap } from '../plughand3d';
export type { benchable, benchIssues, runBenchTasks } from '@/features/sandbox/sim/pcbench';

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

/** A part the step took out and could not put back (a fan whose heatsink went, a cooler whose CPU went): it stays out, and Undo brings it back after the part. */
export interface Along {
  spec: string;
  slot: string;
}
/** One step of the undo history: a part fitted or taken out, or the whole machine swapped for another (`swap`: the game it left, kept to come back to, and what stood on the stage for it: a machine, a bare case or nothing). */
export interface PartStep {
  t: 'fit' | 'remove';
  spec: string;
  slot: string;
  along?: Along[];
}
/** The OS, the router or the internet plan changed from one item to another (ids; null for none): Undo sets the one it was. */
interface NetStep {
  t: 'net';
  kind: NetKind;
  from: string | null;
  to: string | null;
}
export type Step = PartStep | NetStep | { t: 'swap'; game: Game; shown: Shown };

/** What a swap took out, to put back. */
/** A part that came out (`along`: the fans of a radiator, which came out with it as one assembly). */
export interface Gone {
  spec: string;
  slot: string;
  invId: string | null;
  clock?: number | undefined;
}
export type Undo = { t: 'cable'; id: string } | { t: 'hoses' } | ({ t: 'dev'; along?: Gone[] } & Gone);

/** A part a removal took out and keeps built: hidden at the far end of its way, with the place, the turns and the id it had. */
export interface Held {
  obj: Object3D;
  id: string;
  p: Vector3;
  z: number;
  y: number;
}

/**
 * The motion that plays now: its objects (each turns about `pivot`, the middle of them all in its parent's frame), or a `drive` that reads the pose
 * itself (the hoses) and an `end` that puts them away. `fade` draws them see-through at the far end of their way (`solidAt`).
 */
export interface Anim {
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
}

/** A part `fit` puts in a socket: the catalogue item, its spec, the socket, and the part in it now (it comes out first). */
export interface Aim {
  item: string;
  spec: DeviceSpec;
  slot: string;
  occupant: InstalledDevice | null;
}

/** A part a job put in (its new id, its kind and socket) and is yet to be seen going in (`asm`: a radiator's piece, with its fans). */
export interface Fitted {
  id: string;
  kind: string;
  slot: string;
  asm?: boolean;
}

/** A new case or board (`fitShell`): the item and its tier, and the stage it comes to (`held`: the one the stage holds aside; `bare`: no board; `none`: no case). */
export interface ShellJob {
  item: string;
  isCase: boolean;
  tier: number;
  held: boolean;
  bare: boolean;
  none: boolean;
  /** The case comes off (a new case, or a board too big for it). */
  newCase: boolean;
  /** The side panel is glass (it shuts for the board to lift out behind it). */
  glass: boolean;
}

/** A cable the player holds (`trackCable`): its pointer, where that pointer was last, and what takes the window's listeners off. */
export interface CableTrack {
  id: number;
  last: [number, number];
  off: (() => void)[];
}

/** The kind of gesture the pad begins (`PadHost.begin`). */
export type PadKind = Parameters<NonNullable<PadHost['begin']>>[0];

/** What a pan or a pinch took hold of (the depth of the surface under it; the point a pinch zooms about, null: none), and a turn's start, on one canvas. */
export interface Grip {
  el: HTMLCanvasElement;
  grabZ: number | undefined;
  pinchAt: Vector3 | null | undefined;
  turning: { base: OrbitView; yaw: number; pitch: number } | null;
}
