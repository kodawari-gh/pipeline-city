// The machine's parts (`Machine3D`'s fields, machine3d.ts): `MachineCore` (core.ts) with the rest of what the machine keeps. Its builders fill
// them, its frame and its lenses set them, so they are not private. `MachineQueries` (queries.ts) is this with what it answers.
import { Box3, Group, Vector3 } from 'three';
import { CASE_FRONT as FRONT, CASE_Z } from '@/features/room/render/three/roomplan';
import { CASE, FOOT } from '../../layout/layout';
import { ArtSet } from '../artset3d';
import { GROMMETS } from '../casedetail3d';
import { buildBoard } from './board';
import { SHADE_IN } from './consts';
import { MachineCore } from './core';
import type {
  BakeQueue,
  CableRig,
  CableRun,
  CaseKind,
  CaseModel,
  Chips3D,
  DeviceSnap,
  GrommetStyle,
  LoopHoses,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PartLod,
  PartSkin,
  Rail,
  Rest,
  RoomGeo,
  RopeSolid,
  Shown,
  Snapshot,
  StageWall,
  StripMode,
  V3,
} from './types';

/** What the machine is made with: the view's bake queue, the room, the live dies, where it stands and what it shows (`Machine3D`'s constructor). */
export interface MachineInit {
  q: BakeQueue;
  geo: RoomGeo;
  chips: Chips3D | null;
  inRoom: boolean;
  shown: Shown;
  wall: StageWall | null;
}

/** The case's side panel's state (`door`). */
export interface Door {
  kind: CaseKind;
  cm: CaseModel;
  t: number;
  zoom: number;
  board: number;
  zoomOpen: boolean;
  manual: boolean | null;
  inside: boolean;
  busy: boolean;
}

/** A rig's tagged group, whether it stands seated, and how its card fades it while it is plugged in (`built`). */
export interface BuiltRig {
  g: Group;
  seated: boolean;
  fade?: (() => () => void) | undefined;
}

/** The machine's parts: the builders and the frame read and set them. */
export class MachineParts extends MachineCore {
  /** The 2D art the parts wear, baked on the view's queue. */
  readonly art: ArtSet;
  /** The parts the cables go round (their boxes, `caseEnv`); `userData` says which a cable may start in (`cooler`, `sink`, `radiator`). */
  obstacles: Object3D[] = [];
  /** Their boxes, taken once as the parts stand (up close a card swings down flat: the cables still go round it standing). */
  solids = new Map<Object3D, RopeSolid>();
  /** The cables, the cords out of the case and the key in the port: a cable come or gone rebuilds these (`setCables`), a plug in or out only its own cable (`syncCables`). */
  wires = new Group();
  /** Stop a card fading its PCIe lead (by the lead's kind). */
  unfade = new Map<string, () => void>();
  /** The draggable cables' rigs by kind, built with the cables; where each loose plug was dropped, kept until the parts change. */
  rigs = new Map<string, CableRig>();
  /** The cables as the power lens follows them (`cableRuns`), by cable id: made as each cable is built, and a count that moves whenever one is built again. */
  runs = new Map<string, CableRun>();
  runsRev = 0;
  readonly rest = new Map<string, Rest>();
  /** Cables the stage keeps out of sight until it runs them out of their hole (Build my PC: a part's cables come out as it goes in): built hidden. */
  readonly unrun = new Set<string>();
  /** The case's own pieces (the shell, the side panel, the fans on its mounts, the light strips): what a case swap lifts away (`buildmode3d.ts`). */
  readonly caseRoots: Object3D[] = [];
  /** The parts fitted: a heatsink and a radiator show the fans on their spots (`fansOf`). */
  devs: readonly DeviceSnap[] = [];
  /** Each rig's tagged group, whether it stands seated, and how its card fades it while it is plugged in. */
  built = new Map<string, BuiltRig>();
  /** The cables built (their kinds), and the key in the port. */
  cableIds = '';
  videoKey = '';
  key: { id: number; g: Group } | null = null;
  /** Is the CPU cooler a liquid loop's pump? With a radiator too, the loop's hoses join them (`hoses`). */
  pump = false;
  /** The CPU cooler's group: in the room the loop's hoses join it (they fade, merge and stand in with it). */
  cooler: Group | null = null;
  /** The loop's hoses (they fade with the cooler; Build my PC takes them off and puts them on, `buildmode3d.ts`), or null: no pump or no radiator, or the room (they join the cooler). */
  hoses: LoopHoses | null = null;
  /** Where the loop's hoses seat (the hot one first, the pump's end first): the airflow lens runs the coolant along them. Empty with no loop. */
  hosePaths: V3[][] = [];
  readonly heldSet = new Set<string>();
  /** Each SATA drive's sockets on its end (world points): its data and power cables leave there. */
  driveSockets = new Map<string, { data: V3; power: V3 }>();
  /**
   * The case's front-panel leads that are out of their headers (`panelRigs`): the stage's set, shared (`syncPanel`), so that a build of the cables again builds
   * them as they stand. Empty, as the game's machine has it: every lead is in its header.
   */
  panelOut: ReadonlySet<string> = new Set();
  /**
   * The case's side panel: how far open (`t`, 0 to 1 along `doorPose`), the zoom seen at the side and the board view's zoom on this screen, whether
   * the zoom has opened it (with a dead band), the player's last say (null: the zoom decides), a drag or target inside, any drag at all.
   */
  door: Door | null = null;
  /** How the case finishes the cable holes in its tray (`GROMMETS`). */
  grommets: GrommetStyle = GROMMETS.gamer;
  /** The case's accent strip on the front rim, and whether the inside has RGB (`caseModel`). */
  strip: MeshStandardMaterial | null = null;
  caseRgb = true;
  /** What fades as the camera comes in (`fadeTree`): the lids, the coolers, the spreaders, the cards (`startPrograms`). */
  readonly fades: Object3D[] = [];
  /** The parts with a detailed view: where a double click flies the camera to them, head on (`rails.ts`, `focusPart`). A new part with a detailed view adds its own (`rail`). */
  readonly rails: Rail[] = [];
  /** What the merge and the share leave as it is (`share`): the side panel's screws (they turn out one by one), a part a glTF model replaces. */
  keep: Object3D[] = [];
  /** What fades alone besides `fades` (a card's cooler and backplate): its materials stay its own (`share`). */
  readonly apart: Object3D[] = [];
  /** What does not fade but has stand-ins of its own for a distance (`lodScope`): a NIC's parts, inside a card whose tree the level of detail leaves out. */
  readonly still: Object3D[] = [];
  /** The board's small parts (`boardModel`): shown by the zoom, so their stand-ins are theirs (`lodScope`). */
  small: Object3D | null = null;
  /** The small parts' stand-ins for a distance (PERF6, `partlod.ts`), or null: built without them. */
  partLod: PartLod | null = null;
  /** The wall socket's plate in the world (y up), the power lens's source plate: the studio's own, or the room's two-gang plate. */
  readonly outlet: { x: number; y: number; hx: number; hy: number };
  /** The case's body less half a wall: what its walls shade at Low (`setCaseShade`); the feet and the walls' outer faces stay out of it. */
  readonly shadeBox = new Box3(
    new Vector3(CASE.x + SHADE_IN, -(CASE.y + CASE.h) + SHADE_IN, CASE_Z + SHADE_IN),
    new Vector3(CASE.x + CASE.w - SHADE_IN, -CASE.y - SHADE_IN, FRONT - SHADE_IN),
  );
  /** The case's box (the root's space): the distance LOD reads the zoom at its nearest point. */
  readonly caseBox = new Box3(
    new Vector3(CASE.x, -(CASE.y + CASE.h + FOOT), CASE_Z),
    new Vector3(CASE.x + CASE.w, -CASE.y, FRONT),
  );
  /** What the fans' rings of light are multiplied by (1: their own, `RING_IN_LENS`: while the power lens shows). */
  ringK = 1;
  /** The skins of the power lens alone: a part with no look of its own to follow in the other views (a fan, the module) that glows by its draw there and nowhere else. */
  powerSkins = new Map<string, PartSkin>();
  /** The parts that have a power skin to make (a fan, the module), by id: the group each one stands in. */
  powerRoots = new Map<string, Object3D>();
  /** Each mesh the lens gave a material of its own, and the shared one it had (the lens puts it back). */
  powerWas = new Map<Mesh, MeshStandardMaterial>();
  /** Does the lens show (are the parts split)? */
  powerOn = false;
  stripMode: StripMode = 'off';
  blink = false;
  /** The live dies (they outlive a rebuild); the CPU's and the cards' faces show them. */
  chips: Chips3D | null;
  /** False on the Build my PC stage, which has no router. */
  inRoom: boolean;
  /** Build my PC's empty start: `case` is the case alone, `nothing` no case either. */
  readonly shown: Shown;
  /** Build my PC: the studio's wall, which the mains cords and the LAN lead go to. */
  readonly wall: StageWall | null;

  constructor(o: MachineInit) {
    super();
    this.chips = o.chips;
    this.inRoom = o.inRoom;
    this.shown = o.shown;
    this.wall = o.wall;
    this.art = new ArtSet(o.q);
    const p = o.geo.socket.plate;
    this.outlet = o.wall ? o.wall.plan.plate : { x: p.x + p.w / 2, y: -(p.y + p.h / 2), hx: p.w / 2, hy: p.h / 2 };
  }

  /** The board, its sockets and the parts' drop boxes (`buildBoard`, board.ts): a method, so a test can stand in for this step of the build. */
  buildBoard(s: Snapshot | null): void {
    buildBoard(this, s);
  }
}
