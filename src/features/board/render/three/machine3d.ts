// The machine in 3D (docs/render/three.md): the glass-side case, the motherboard with its sockets, every installed part, the
// fans the player fitted, the power cables and the wall cords. Shapes over the 2D layout (`layout.ts`, y flipped), z out of the wall.
// Each part is its shared builder's model (`boardModel`, `cpuModel`, `cardModel`...: the gallery and Build my PC show the same); the faces wear
// the 2D renderer's own art through one `ArtSet`, raised parts carry the art of their own rect on their top. Level of detail (`lod`): the textures sharpen tile by tile as the camera comes in, the
// cooler, the CPU's lid and a card's shroud fade away over the 2D bands (`DEVICE_LOD`) to show the die, and small parts stand up only up close.
// The dies run on their faces as in 2D (`Chips3D`, chips3d.ts).
// Rebuilt when the parts change (`machineKey`); a plug in or out rebuilds only its own cable (`syncCables`, `setCable`). Between rebuilds `frame`
// only moves the fans and eases the state looks.
import { Box3, Color, Frustum, Group, Mesh, MeshStandardMaterial, PointLight, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { DeviceSnap, Snapshot } from '@/worker/game/types';
import { BOARD_TIERS, getSpec, type CpuSpec, type FanSpec, type RamSpec, type StorageSpec } from '@/features/board/sim/specs';
import type { Shown } from '@/features/board/sim/buildspecs';
import { netPropsVisible } from '@/features/network/render/netvis';
import { DARK, lightJack, type LinkLevels } from '@/features/network/render/jackleds';
import type { JackLamps } from './rj45jack3d';
import { cardOrigin, tpmRect } from '@/core/render/accelart';
import { fanBank } from '@/core/render/fanmotor';
import { DEVICE_LOD, seenZoom, smooth } from '@/core/render/lod/lod';
import { builtinTheme } from '@/core/render/theme';
import { fadeTree, frustumOf, screenPx, type ArtSurface, type BakeQueue } from '@/core/render/three/artlod';
import { setCaseShade, type CasePass } from '@/core/render/three/caseshade';
import { lowDetail } from '@/core/render/three/detail';
import { SEG, disposeTree, post, rectBox, rounded, tornDown, type RectLike } from '@/core/render/three/geometry';
import type { RopeEnd, Plane as RopePlane, Solid as RopeSolid, V3 } from '@/core/render/three/rope';
import { PartSkin, mat, own, shareMaterials, type PartState } from '@/core/render/three/materials';
import type { Role } from '@/core/render/three/powerscale';
import { heatOf } from '@/core/render/three/thermal';
import { mergeSiblings, mergeSiblingsSteps } from '@/core/render/three/merge';
import { hexNum } from '../skins';
import { PartLod, type LodScope } from '@/core/render/three/partlod';
import { findById, seeThrough, tag, unseen } from '@/core/render/three/pick';
import { gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { npuGeo } from '@/features/npu/render/npulayout';
import { nicFaceRect, nicGeo } from '@/features/network/render/nic/niclayout';
import { routerFace } from '@/features/network/render/router/routerart';
import { routerGeo, routerRails } from '@/features/network/render/router/routerlayout';
import { driveBody, driveKindOf } from '@/features/storage/render/drives';
import { fanMounts, hubHeaders, radiatorSpan, type FanMount } from '@/features/room/render/desk/props/case';
import { BOARD_Z, CASE_FRONT as FRONT, CASE_Z, DESK_TOP, FAN_MAX, FAN_ZC, MONITOR_Z, REAR_ZC } from '@/features/room/render/three/roomplan';
import type { RoomGeo } from '@/features/room/render/shell/room';
import type { LightId } from '@/features/room/render/three/roomlights';
import {
  BD, CASE, CASE_GLASS, CASE_IN, COOLER, CPU_S, DIE, DIE_PLAN, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, FAN_HUB, FAN_SLOT, FOOT, GEO, M2_SLOTS, MONITOR,
  LAYOUT_CASE, ETH0_RECT, PCIE_RAILS, PKG, SOCKET_E, USB_PORT, VIDEO_Y, nicY, routerLan,
} from '../layout/layout';
import { fanHost } from '../../sim/board';
import { assignLeads } from '../../sim/cables';
import { radiatorFit, radiatorGrade } from '../cooler';
import { ACCENT } from '../devices';
import { fanCordPlans } from '../wiring/fancords';
import { isPcieKind } from '../wiring/routes';
import { ArtSet, LV_PART } from './artset3d';
import type { ArtBaker } from './bake';
import { routerFit } from './router3d';
import { LEVER_OPEN } from './boardhw3d';
import { boardModel } from './boardmodel3d';
import { CPU_Z, cpuModel } from './cpu3d';
import { HOSE_COLD, HOSE_HOT, LoopHoses, coolerFanBox, coolerFanLead, coolerFoot, coolerModel, hoseEnds, radiatorFlow, radiatorModel, type Model, type RadiatorAt, type RadiatorFlow } from './cooler3d';
import type { AirBody } from './air/plan';
import type { Room } from '@/core/render/three/camera';
import { caseFan, fanDepth, fanPart, type FanFit, type Spin } from './fans3d';
import { CARD_PLUG, standingPlug } from './cables3d';
import { HINGE_Z, cardModel, gpuVideoAt, nicJackAt, slotBlank, type Card3D } from './card3d';
import type { Rail } from '@/core/render/three/rails';
import type { Chips3D } from './chips3d';
import { caseModel, innerStrips, stripLight, type CaseModel } from './case3d';
import { GROMMETS, rearFanScrews, SLOT_BLANK } from './casedetail3d';
import { SINK_FAN_MID, sinkBody } from './sink3d';
import { DOOR_SECONDS, doorPose, stepDoor } from './casedoor';
import { CASE_KIND, type CaseKind } from '@/features/room/render/shell/casedecor';
import { stripModeOf, type StripMode } from '@/features/room/render/shell/exterior';
import { SHROUD, basementPlan, shroud } from './basement3d';
import { baseCagePlan, cageBox, cageGrommet, cagePlan, driveCage, onTray, trayAt, trayHit, traySpot, type CagePlan } from './drivecage3d';
import { footShade } from './footshade3d';
import { drivePlug, sataDriveModel } from './drive3d';
import { mainsInlet, mainsPlug, PLUG_TAIL, psuUnit } from './psu3d';
import { fanHub } from './fanhub3d';
import { isPanelId, leadCoil, panelRigs } from './casetray3d';
import {
  TRAY_Z, at, atxPlug, cableMesh, epsPlug, fanPlug, fromSlot, grommet, hangPts, hung, sataPlug, type Env, type GrommetStyle, type Look,
} from './wires3d';
import { KEY_LEAD } from '@/features/room/render/three/props3d';
import { monitorPlan, monitorSeats } from '@/features/room/render/three/monitor3d';
import { rigBuild, seatPlug, type CableRig, type Rest, type Seat } from './cablerig3d';
import { inFlowOrder, reversed, type CableRun, type RigPower } from './power/runs';
import { boardHdmi, boardRj45, hdmiPlug, hdmiReal, rj45Jack, rj45Plug, rj45Real, swissEngage, swissPlug, swissReal } from './plugs3d';
import { ROOM_SOCKET } from './swisssocket3d';
import { JACK_SINK, MM as WALL_MM, routerSolid, routerTier, type StageWall } from './studiowall3d';
import { sleeveOf } from '@/core/render/cable';
import { useModel } from '@/core/render/three/gltf';
import { modelOf } from './models3d';
import { slotRects } from './slots3d';
import { nvmeLook, nvmeStick } from './nvme3d';
import { tpmModel, TPM_Z } from './tpm3d';
import { RAM_LEAN, SLOT_H, ramStick } from './ram3d';
import { RamMap3D } from './rammap3d';

/** The network lead's light blue (a common patch-cable colour). */
export const LAN_LEAD = '#8cc3e0';
const grow =(r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
const union = (a: RectLike, b: RectLike): RectLike => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
/** The RAM band (`DEVICE_LOD.ram.show` on): the camera leans over its first part, the spreaders fade over the second. */
const RAM_IN = [DEVICE_LOD.ram.show, DEVICE_LOD.ram.show * 1.35] as const, RAM_FADE = [DEVICE_LOD.ram.show * 1.5, DEVICE_LOD.ram.show * 2.1] as const;
const idx = (slot: string) => Number(/\d+$/.exec(slot)?.[0] ?? 0);
/** The zoom (in parts of the board view's zoom, seen at the side) under which the side panel shuts again, and over which it opens. */
const DOOR_ZOOM = [0.82, 0.92] as const;
/** What a fan's ring of light is multiplied by while the power lens shows: it is a decoration, so it goes low (it would read as the fan's power). */
const RING_IN_LENS = 0.1;
/** How long `Machine3D.make` builds before the page has its turn (ms): a task is this long plus the longest step (the board's model, 0.1 s). */
const SLICE_MS = 30;
const HIT = Mesh.prototype.raycast, NO_HIT = () => {};
/**
 * Low's case shadow: how far inside the body its box sits, and what each face lets in (the top filter a fifth, steel none). The glass side
 * lets in 0.75, not all: the parts shade each other at High, and 0.75 is that mean (RAM L 0.036, High 0.037; drive cage 0.051, High 0.044).
 */
const SHADE_IN = 60, CASE_PASS: CasePass = { plus: [0, 0.2, 0.75], minus: [0, 0, 0] };
/**
 * Low's contact shade (`footShade`): how far out a skirt reaches and how dark it starts, as High's occlusion pass shades round the cooler on the
 * board (the board beside the pump's base L 0.035 at High, 0.052 at Low without it) and round a cage on its shelf.
 */
const COOLER_SHADE = { reach: 320, peak: 0.42 }, CAGE_SHADE = { reach: 240, peak: 0.3 };
/** A skirt on the board's face. */
const onBoard = (m: Mesh): Mesh => { m.position.z = BOARD_Z + 2; return m; };
/** A skirt on the floor a cage stands on (its bottom), the cage's footprint between the tray sheet and its front. */
const underCage = (c: CagePlan): Mesh => {
  const m = footShade({ x: c.x0, y: c.z0, w: c.x1 - c.x0, h: c.z1 - c.z0 }, CAGE_SHADE.reach, CAGE_SHADE.peak);
  m.rotation.x = -Math.PI / 2;
  m.position.y = -c.bottom + 2;
  return m;
};


/**
 * What forces a rebuild: the tier, the parts and where they sit. The cables and the key rebuild only themselves (`Machine3D.syncCables`).
 * `shown` (Build my PC's empty start): a bare case is keyed by its case tier alone; with nothing on the stage the key is the same whatever the game holds.
 */
export function machineKey(s: Snapshot | null, shown: Shown = 'machine'): string {
  if (!s) return 'none';
  const key = shown === 'nothing' ? 'nothing' : shown === 'case' ? `bare|${s.caseTier}` : [s.boardTier, s.caseTier, s.devices.map((d) => `${d.spec}@${d.slot}`).sort().join(',')].join('|');
  return lowDetail() ? `${key}|low` : key; // (High's key is what it was)
}

/** A device's state for its look: its power and a burn (a part that runs, runs hot or throttles looks as ever; the lenses show those). */
export function stateOf(s: Snapshot, d: DeviceSnap): PartState {
  return { powered: s.powered && !s.power.tripped, burnt: d.burnt };
}

type Fan = Spin & { speed: number };
type Reveal = { at: Vector3; apply: (z: number) => void; anywhere: boolean; area?: RectLike };

/** What one built part added to the machine's shared lists: a patch (`Machine3D.patch`) takes exactly this away, or adds it for a new part. */
interface Owned { id: string; kind: string; slot: string; roots: Object3D[]; reveals: Reveal[]; fades: Object3D[]; apart: Object3D[]; still: Object3D[]; fans: Fan[]; obstacles: Object3D[]; keep: Object3D[]; caseRoots: Object3D[]; rails: Rail[] }

const keyOf = (d: { spec: string; slot: string }): string => `${d.spec}@${d.slot}`;
/**
 * The parts a patch may add or take away: a stick, an M.2 drive, a card, the CPU, an air cooler, a VRM or memory heat sink, and a fan on one of those
 * (the host is built again with it). Not a liquid loop's pump (the hoses join it), a radiator, a case fan, a PSU, a cable or a case or board.
 */
const patchable = (d: DeviceSnap): boolean => {
  const spec = getSpec(d.spec) as { visual?: string; loop?: unknown } | undefined;
  switch (d.kind) {
    case 'ram': case 'gpu': case 'npu': case 'nic': case 'cpu': case 'vrm-sink': case 'ram-sink': return true;
    case 'cooler': return !spec?.loop;
    case 'fan': return fanHost(d.slot) !== null;
    case 'storage': return driveKindOf(spec?.visual ?? '') === 'ssd-nvme';
    default: return false;
  }
};
/** A patch that leaves this many hidden parts in the tree asks for a build instead (their geometry is freed by it). */
const GRAVE_MAX = 10;
/** How far the router's detailed-view panel stands off its front bezel (clear of the jacks' lights and the bezel's relief). */
const ROUTER_PANEL_Z = 30;
/** A part a patch took away answers to no id (`findById`, a pick, the outline): its host, built again, keeps the same id. */
export const untag = (root: Object3D): void => root.traverse((o) => { if (typeof o.userData.id === 'string') delete o.userData.id; });

/** What the video and LAN cables' PC ends depend on: the port each is in and the cards and display that offer ports (they are built again when these change). */
const netVisible = (s: Snapshot) => netPropsVisible({
  level: s.level.level, hasRouter: !!s.net?.router, hasIsp: !!s.net?.isp, routerInInventory: s.inventory.some((i) => i.kind === 'router'), lanConnected: !!s.cables.find((c) => c.id === 'lan')?.connected,
});
/**
 * The cables that stand: the sim lists a cable with the part it runs from fitted (or while it is plugged); `blocked` says that part is missing. A
 * cable never stands without its part: no PSU, no leads and no PC cord; no monitor, no video cable and no monitor cord.
 */
export const standing = (s: Snapshot): Snapshot['cables'] => s.cables.filter((c) => c.connected || !c.blocked);
const videoKey = (s: Snapshot, wall: StageWall | null = null) => `${netVisible(s)}|${wall ? routerTier(s.net?.router?.id) : ''}|${s.videoPort}|${s.net?.port.kind}${s.net?.port.deviceId ?? ''}|${s.devices.filter((d) => d.kind === 'gpu' || d.kind === 'display' || d.kind === 'nic').map((d) => `${d.id}@${d.slot}${d.burnt ? 'x' : ''}`).join(',')}`;

export class Machine3D {
  readonly root = new Group();
  private skins = new Map<string, PartSkin>();
  /** The sockets' rects by slot id (a model is fitted to its part's). */
  private rects = new Map<string, RectLike>();
  private fans: Fan[] = [];
  private rgb = new PointLight(0x8b5cff, 0, 9000, 0);
  /**
   * The RGB's light out through the glass, on the desk and the wall beside the case. No work light: the board reads by the room's lamps and
   * this RGB alone, at every zoom (`src/features/room/light.md`).
   */
  private spill = new PointLight(0x8b5cff, 0, 18000, 0);

  /** The RGB's lights in the scene by the lamp cap (`Room3D.liveLights`, `LIGHT_ORDER`: `case`, `spill`). Set once built and when the cap changes. */
  setLights(live: ReadonlySet<LightId>): void {
    this.rgb.visible = live.has('case');
    this.spill.visible = live.has('spill');
  }
  private leds: { on: MeshStandardMaterial; err: MeshStandardMaterial; disk: MeshStandardMaterial } | null = null;
  /** The two lights of each Ethernet jack the machine has, by port (`board`, or a network card's device id): the network's, set every frame (`frame`'s `net`). */
  private lan = new Map<string, JackLamps>();
  /** The RGB's one colour: the case's accent (`caseModel`), so the fans, the strips and the light out through the glass match its trim. */
  private accent = new Color(0x8b5cff);
  /** The art is always the dark theme's: the reference's black board under neon. */
  private readonly T = builtinTheme();
  /** The 2D art the parts wear, baked on the view's queue. */
  private readonly art: ArtSet;
  /** What changes with the camera: a point and what to do with the zoom seen there (`seenZoom`, the 2D bands' unit). */
  private reveals: Reveal[] = [];
  /** By `spec@slot`: what each part added (`patch`). */
  private readonly owned = new Map<string, Owned>();
  /** Parts a patch took away: hidden, not freed (the stand-ins of `partLod` know them by their hiding), freed with the machine. */
  private readonly graveyard: Object3D[] = [];
  /** The unseen box of each empty socket (a drop lands on it), and the plate over each empty PCIe slot, by socket id. */
  private readonly picks = new Map<string, Object3D>();
  private readonly blanks = new Map<string, Object3D>();
  /** The board's sockets by id (tagged while empty: a pick or a drop finds the socket). */
  private sockets = new Map<string, Object3D>();
  private pickBox: (r: RectLike, z0: number, z1: number, id: string) => void = () => {};
  /** The bare CPU socket's gold contacts (made by the board model, added while no CPU stands on the socket). */
  private contacts: (() => Group) | null = null;
  private bare: Group | null = null;
  private blankTone = 0;
  /** The memory map's reveal and rail, made again when the bank changes. */
  private ramBits: { reveal: Reveal; rail: Rail } | null = null;
  /** The router's detailed view in the room (`buildRouter`): its art and face, its reveal and its rails, made again when a router of another tier stands. */
  private routerBits: { tier: number; art: ArtBaker; surface: ArtSurface; reveal: Reveal; rails: Rail[] } | null = null;
  /** `tier|caseTier`: a patch keeps the board and the case, so these must be the same. */
  private tiers = '';
  private merged = true;
  private frustum = new Frustum();
  /** The radiator bolted on a side of the case (it takes that side's fan mounts) and the loop's tubes run to. */
  private rad: (RadiatorAt & { span: FanMount & { ids: string[] } }) | null = null;
  /** The installed sticks' bank: the camera leans over it up close (`lean`). */
  private ram: RectLike | null = null;
  /** The sticks (slot, size, the faces of their four data chips) and the live memory map painted on those faces. */
  private ramSticks: ConstructorParameters<typeof RamMap3D>[0] = [];
  private ramMap: RamMap3D | null = null;
  /** The cards by slot: their power leads plug into the top edge and fade with the cooler. */
  private cards = new Map<string, Card3D>();
  /** The basement under the shroud, the power supply's (`basementPlan`); the main drive cage over it and the basement's under it, their trays one a bay (`cagePlan`, `baseCagePlan`). */
  private readonly plan = basementPlan();
  private readonly cage = cagePlan();
  private readonly cages = [baseCagePlan(), this.cage];
  /** The parts the cables go round (their boxes, `caseEnv`); `userData` says which a cable may start in (`cooler`, `sink`, `radiator`). */
  private obstacles: Object3D[] = [];
  /** Their boxes, taken once as the parts stand (up close a card swings down flat: the cables still go round it standing). */
  private solids = new Map<Object3D, RopeSolid>();
  /** The cables, the cords out of the case and the key in the port: a cable come or gone rebuilds these (`setCables`), a plug in or out only its own cable (`syncCables`). */
  private wires = new Group();
  /** Stop a card fading its PCIe lead (by the lead's kind). */
  private unfade = new Map<string, () => void>();
  /** The draggable cables' rigs by kind, built with the cables; where each loose plug was dropped, kept until the parts change. */
  private rigs = new Map<string, CableRig>();
  /** The cables as the power lens follows them (`cableRuns`), by cable id: made as each cable is built, and a count that moves whenever one is built again. */
  private runs = new Map<string, CableRun>();
  private runsRev = 0;
  readonly rest = new Map<string, Rest>();
  /** Cables the stage keeps out of sight until it runs them out of their hole (Build my PC: a part's cables come out as it goes in): built hidden. */
  private readonly unrun = new Set<string>();
  /** The case's own pieces (the shell, the side panel, the fans on its mounts, the light strips): what a case swap lifts away (`buildmode3d.ts`). */
  readonly caseRoots: Object3D[] = [];
  /** The parts fitted: a heatsink and a radiator show the fans on their spots (`fansOf`). */
  private devs: readonly DeviceSnap[] = [];
  /** Each rig's tagged group, whether it stands seated, and how its card fades it while it is plugged in. */
  private built = new Map<string, { g: Group; seated: boolean; fade?: () => () => void }>();
  /** The cables built (their kinds), and the key in the port. */
  private cableIds = '';
  private videoKey = '';
  private key: { id: number; g: Group } | null = null;
  /** Is the CPU cooler a liquid loop's pump? With a radiator too, the loop's hoses join them (`hoses`). */
  private pump = false;
  /** The CPU cooler's group: in the room the loop's hoses join it (they fade, merge and stand in with it). */
  private cooler: Group | null = null;
  /** The loop's hoses (they fade with the cooler; Build my PC takes them off and puts them on, `buildmode3d.ts`), or null: no pump or no radiator, or the room (they join the cooler). */
  hoses: LoopHoses | null = null;
  /** Where the loop's hoses seat (the hot one first, the pump's end first): the airflow lens runs the coolant along them. Empty with no loop. */
  private hosePaths: V3[][] = [];
  loopPaths(): readonly (readonly V3[])[] { return this.hosePaths; }
  /** The radiator's lanes and ports as the model has them, for the lens's water (null with no radiator). */
  loopRadiator(): RadiatorFlow | null { return this.rad ? radiatorFlow(this.rad.fit) : null; }
  /**
   * The cables that carry power, as the power lens follows them (docs/render/power.md): each one's strands as the sleeves were made from them, in the order the
   * power goes, and whether its plug is in or a hand holds it. A snapshot of the machine as built: `cablesRev` moves when one of them is built again.
   */
  cableRuns(): CableRun[] {
    const held = this.heldCables();
    return [...this.runs.values()].map((r) => ({ ...r, held: held.has(r.id) }));
  }
  get cablesRev(): number { return this.runsRev; }
  private readonly heldSet = new Set<string>();
  /** The cables a hand holds now (the plug hides the built cable: the hand draws its own). The set is reused: read it at once. */
  heldCables(): ReadonlySet<string> {
    this.heldSet.clear();
    for (const [id, b] of this.built) for (const c of b.g.children) if (c.userData.rig && !c.visible) { this.heldSet.add(id); break; }
    return this.heldSet;
  }
  /** A part's box in the machine's space (its device id), or null: the power lens hangs its words over it. */
  partBox(id: string): { min: V3; max: V3 } | null {
    const o = findById(this.root, id);
    const b = o ? new Box3().setFromObject(o) : null;
    return b && !b.isEmpty() ? { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] } : null;
  }
  /** Each SATA drive's sockets on its end (world points): its data and power cables leave there. */
  private driveSockets = new Map<string, { data: V3; power: V3 }>();
  /** The case's front-panel leads, in `wires`: their plugs sit on the board's headers, so a board swap lifts them with it. */
  /**
   * The case's front-panel leads that are out of their headers (`panelRigs`): the stage's set, shared (`syncPanel`), so that a build of the cables again builds
   * them as they stand. Empty, as the game's machine has it: every lead is in its header.
   */
  panelOut: ReadonlySet<string> = new Set();
  /**
   * The case's side panel: how far open (`t`, 0 to 1 along `doorPose`), the zoom seen at the side and the board view's zoom on this screen, whether
   * the zoom has opened it (with a dead band), the player's last say (null: the zoom decides), a drag or target inside, any drag at all.
   */
  private door: { kind: CaseKind; cm: CaseModel; t: number; zoom: number; board: number; zoomOpen: boolean; manual: boolean | null; inside: boolean; busy: boolean } | null = null;
  /** How the case finishes the cable holes in its tray (`GROMMETS`). */
  private grommets: GrommetStyle = GROMMETS.gamer;
  /** The case's accent strip on the front rim, and whether the inside has RGB (`caseModel`). */
  private strip: MeshStandardMaterial | null = null;
  private caseRgb = true;
  /** What fades as the camera comes in (`fadeTree`): the lids, the coolers, the spreaders, the cards (`startPrograms`). */
  readonly fades: Object3D[] = [];
  /** The parts with a detailed view: where a double click flies the camera to them, head on (`rails.ts`, `focusPart`). A new part with a detailed view adds its own (`rail`). */
  readonly rails: Rail[] = [];
  /** What the merge and the share leave as it is (`share`): the side panel's screws (they turn out one by one), a part a glTF model replaces. */
  private keep: Object3D[] = [];
  /** What fades alone besides `fades` (a card's cooler and backplate): its materials stay its own (`share`). */
  readonly apart: Object3D[] = [];
  /** What does not fade but has stand-ins of its own for a distance (`lodScope`): a NIC's parts, inside a card whose tree the level of detail leaves out. */
  readonly still: Object3D[] = [];
  /** The board's small parts (`boardModel`): shown by the zoom, so their stand-ins are theirs (`lodScope`). */
  private small: Object3D | null = null;
  /** The small parts' stand-ins for a distance (PERF6, `partlod.ts`), or null: built without them. */
  partLod: PartLod | null = null;
  /** The wall socket's plate in the world (y up), the power lens's source plate: the studio's own, or the room's two-gang plate. */
  readonly outlet: { x: number; y: number; hx: number; hy: number };
  /** The case's box (the root's space): the distance LOD reads the zoom at its nearest point. */
  /** The case's body less half a wall: what its walls shade at Low (`setCaseShade`); the feet and the walls' outer faces stay out of it. */
  private readonly shadeBox = new Box3(new Vector3(CASE.x + SHADE_IN, -(CASE.y + CASE.h) + SHADE_IN, CASE_Z + SHADE_IN), new Vector3(CASE.x + CASE.w - SHADE_IN, -CASE.y - SHADE_IN, FRONT - SHADE_IN));
  private readonly caseBox = new Box3(new Vector3(CASE.x, -(CASE.y + CASE.h + FOOT), CASE_Z), new Vector3(CASE.x + CASE.w, -CASE.y, FRONT));

  /**
   * `chips`: the live dies (they outlive a rebuild); the CPU's and the cards' faces show them. `inRoom`: false on the Build my PC stage, which has
   * no router. `merge`: false builds it as it was before PERF22's merge and share (the tests compare the two). `lod`: false builds it
   * without the distance stand-ins (the tests compare the two). `defer`: leave the build to `make`, which runs it a slice at a time.
   * `shown` (Build my PC's empty start): `case` is the case alone, with no board in it, no part and no cable (`buildEmpty`); `nothing` is no case either, an empty root.
   * `wall` (Build my PC): the studio's wall, which the mains cords and the LAN lead go to, in place of the room's hidden socket and router (`buildWallCords`).
   */
  constructor(s: Snapshot | null, geo: RoomGeo, q: BakeQueue, private chips: Chips3D | null = null, private inRoom = true, merge = true, lod = merge, defer = false, readonly shown: Shown = 'machine', readonly wall: StageWall | null = null) {
    this.art = new ArtSet(q);
    const p = geo.socket.plate;
    this.outlet = wall ? wall.plan.plate : { x: p.x + p.w / 2, y: -(p.y + p.h / 2), hx: p.w / 2, hy: p.h / 2 };
    this.merged = merge;
    this.tiers = s ? `${s.boardTier}|${s.caseTier}` : '';
    chips?.setScene(s);
    const radDev = s?.devices.find((d) => d.kind === 'radiator'), span = radDev ? radiatorSpan(radDev.slot === 'rad-front' ? 'front' : 'top') : null;
    if (span) this.rad = { fit: radiatorFit(span, COOLER.x + COOLER.w / 2, radiatorGrade((getSpec(radDev!.spec) as { visual?: string } | undefined)?.visual ?? '')), count: span.ids.length, span };
    this.devs = s?.devices ?? [];
    if (!defer) { const run = this.assemble(s, geo, merge, lod); while (!run.next().done) {} }
  }

  /**
   * The machine built a slice at a time, as `Room3D.make` builds the room (docs/render/load.md "Build my PC, first open"): the steps are the
   * constructor's, and `slice` (a task of its own; the page answers in it) is awaited only when `budget` ms have passed since the last one.
   * `stop` ends the build (null): the caller no longer wants it. The machine is not in a scene while it builds.
   */
  static async make(
    s: Snapshot | null, geo: RoomGeo, q: BakeQueue, chips: Chips3D | null, inRoom: boolean,
    o: { merge?: boolean; lod?: boolean; slice?: () => Promise<void>; budget?: number; stop?: () => boolean; shown?: Shown; wall?: StageWall | null } = {},
  ): Promise<Machine3D | null> {
    const merge = o.merge ?? true, lod = o.lod ?? merge, slice = o.slice ?? (() => new Promise<void>((done) => setTimeout(done, 0))), budget = o.budget ?? SLICE_MS;
    const m = new Machine3D(s, geo, q, chips, inRoom, merge, lod, true, o.shown ?? 'machine', o.wall ?? null), run = m.assemble(s, geo, merge, lod);
    let from = performance.now();
    for (let step = run.next(); !step.done; step = run.next()) {
      if (performance.now() - from < budget) continue;
      await slice();
      if (o.stop?.()) return null;
      from = performance.now();
    }
    return m;
  }

  /** The build: a `yield` at each point where the page may have its turn (`make`); the constructor runs it to the end. */
  private *assemble(s: Snapshot | null, geo: RoomGeo, merge: boolean, lod: boolean): Generator<void> {
    if (this.shown !== 'nothing') this.buildCase();
    yield;
    if (this.shown === 'case') this.buildEmpty(); else if (this.shown === 'machine') this.buildBoard(s);
    yield;
    if (s && this.shown === 'machine') {
      this.rects = slotRects(s);
      for (const d of s.devices) { this.build(d); yield; }
      this.buildRamMap();
      this.root.updateMatrixWorld(true);
      for (const o of this.obstacles) {
        const b = new Box3().setFromObject(o);
        if (!b.isEmpty()) this.solids.set(o, { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
      }
      yield;
      // the loop's hoses, only with its pump and a radiator both fitted (`hasLoop`): stiff braided hoses arcing from the pump's ports to the
      // radiator's. The room never moves them: they join the cooler (its merges, its stand-ins, its fade). Build my PC poses them live, so
      // there they stay as they are (`keep`) and fade with the cooler.
      if (this.pump && this.rad) {
        const h = new LoopHoses(hoseEnds(this.rad.fit), this.caseEnv(this.obstacles.filter((o) => o.userData.cooler || o.userData.radiator)));
        this.hosePaths = h.paths();
        // (each hose's sleeve glows by its own water in the thermal view: the hot one first)
        h.skins.forEach((m, i) => this.thermalSkin(i ? HOSE_COLD : HOSE_HOT, m));
        if (this.inRoom && this.cooler) this.cooler.add(h.body);
        else {
          this.hoses = h;
          this.keep.push(h.root);
          this.fades.push(h.body);
          this.root.add(h.root);
        }
        yield;
      }
      this.root.add(this.wires);
      yield* this.cablesSteps(s, geo);
    }
    this.buildRouter(s);
    this.rgb.position.set(BD.x + BD.w / 2, -(BD.y + BD.h / 2), FRONT - 900);
    this.spill.position.set(BD.x + BD.w / 2, -(BD.y + BD.h * 0.7), FRONT + 2500);
    this.root.add(this.rgb, this.spill);
    if (merge) yield* this.share();
    yield;
    if (lod) this.partLod = new PartLod(this.root, () => this.lodScope());
  }

  /**
   * What the distance LOD must know (docs/render/lod.md "The machine's stand-ins"). Anchors: what a reveal shows, hides or fades as a whole
   * (each fade, a card's cooler, the board's small parts) and the cables (built again alone): their stand-ins are their children. Left out:
   * `keep`, the side panel (it swings), the key (built again alone), and a card's own tree (it swings down flat; its cooler is an anchor).
   */
  private lodScope(): LodScope {
    const cards = new Set<Object3D>([...this.cards.values()].map((c) => c.root));
    // (the loop's hoses fade but have no stand-ins: they are in `keep`, posed live)
    const anchors: Object3D[] = [this.wires, ...this.apart, ...this.still, ...this.fades.filter((o) => !cards.has(o) && o !== this.hoses?.body)];
    const skip: Object3D[] = [...this.keep, ...cards];
    if (this.small) anchors.push(this.small);
    if (this.door) skip.push(this.door.cm.door);
    if (this.key) skip.push(this.key.g);
    return { anchors, skip };
  }

  /**
   * Keep these parts in full detail whatever the distance (each with all under it), and every part from the zoom `ceil` in (screen pixels
   * per world unit): Build my PC holds what the player points at or what a step moves, and swaps nothing at its own view or closer.
   */
  holdDetail(held: readonly Object3D[], ceil = Infinity): void { this.partLod?.hold(held, ceil); }

  /**
   * Fewer draws and materials (PERF22, docs/render/three.md "Merges"): the still meshes of each parent as one palette mesh
   * (`mergeSiblings`), then equal materials as one in each part (`shareMaterials`). The cables (built again alone) and `keep` stay as they
   * are; each fade (`fades`, `apart`) keeps its materials. The state looks are `own`: the skins, the rings and strips, the case's LEDs.
   */
  private *share(): Generator<void> {
    const skip = [this.wires, ...this.keep], apart = [...this.fades, ...this.apart];
    yield* mergeSiblingsSteps(this.root, { skip, apart, pbr: true });
    // (at Low, equal materials of different parts become one too: PHONE-01; High keeps one set per part, as it was)
    shareMaterials(this.root, { skip, apart, across: lowDetail() });
  }

  // ------------------------------------------------------------------ case
  private buildCase() {
    // the case of this tier, one of four (case3d.ts): its body stays, its outer side panel and glass fade as the camera comes in
    const kind = CASE_KIND[LAYOUT_CASE] ?? 'gamer', cm = caseModel(kind, this.T), shell = cm.root;
    this.caseRgb = cm.rgb;
    this.accent.setHex(cm.accent);
    this.strip = cm.strip;
    for (const s of cm.spins) this.spin(s);
    // the basement's shroud (its panel over the power supply printed with the case maker's lockup, `basement3d.ts`); over it and under it the
    // drive cages with an empty tray in each free bay (a fitted drive's tray is its device's, `drivecage3d.ts`)
    const bays = new Set(this.devs.filter((d) => d.kind === 'storage' && d.slot.startsWith('sata')).map((d) => d.slot));
    shell.add(shroud(this.plan, cm.shroud, cm.rivet, cm.screw), ...this.cages.map((c) => driveCage(c, kind, bays)));
    if (lowDetail()) shell.add(...this.cages.map(underCage));
    // light strips along the inside of the top and the front (`innerStrips`)
    const strips = innerStrips(kind, cm);
    for (const m of strips.roots) this.root.add(m);
    this.caseRoots.push(...strips.roots);
    for (const l of strips.spins) this.spin(l);
    shell.add(fanHub());
    this.root.add(shell, cm.door);
    this.caseRoots.push(shell, cm.door);
    this.grommets = GROMMETS[kind];
    // the side panel opens (casedoor.ts) from the board view in, for a drag or a tutorial target inside, or on a click on it (`toggleDoor`)
    this.door = { kind, cm, t: 0, zoom: 0, board: 0.13, zoomOpen: false, manual: null, inside: false, busy: false };
    this.reveal(CASE_GLASS, FRONT, (z) => { this.door!.zoom = z; }, true);
    this.leds = cm.leds;
    for (const m of Object.values(cm.leds)) own(m);
    own(cm.strip);
    this.keep.push(...cm.screws);
  }

  /** The fans fitted on these spots, as their hosts build them. */
  private fanFits(on: (slot: string) => boolean): FanFit[] {
    return this.devs.filter((d) => d.kind === 'fan' && on(d.slot)).map((d) => ({ id: d.id, slot: d.slot, spec: getSpec(d.spec) as FanSpec }));
  }

  /** The unseen drop box of each free fan spot, as big as the fan it takes: a case mount's in the case (a radiator leaves its side's fans on their mounts); a heatsink's on its end or over its top. */
  private fanPicks(s: Snapshot, filled: ReadonlySet<string>, pickBox: (r: RectLike, z0: number, z1: number, id: string) => void) {
    for (const m of fanMounts()) {
      if (filled.has(m.id)) continue;
      const zc = m.side === 'rear' ? REAR_ZC : FAN_ZC, d = Math.min(m.side === 'top' ? m.rect.w : m.rect.h, FAN_MAX);
      pickBox(m.rect, zc - d / 2, zc + d / 2, m.id);
    }
    this.hostFanPicks(s, filled, pickBox);
  }

  /** The same for the free fan spots of the heatsinks (a patch makes these again when a host or its fan comes or goes). */
  private hostFanPicks(s: Snapshot, filled: ReadonlySet<string>, pickBox: (r: RectLike, z0: number, z1: number, id: string) => void) {
    for (const [id, r] of slotRects(s)) {
      const host = fanHost(id);
      if (!host || filled.has(id)) continue;
      const d = s.devices.find((x) => x.slot === host), visual = (getSpec(d?.spec ?? '') as { visual?: string } | undefined)?.visual ?? '';
      const box = d?.kind === 'cooler' ? coolerFanBox(visual, Number(id.slice(id.lastIndexOf('.fan') + 4))) : { r, z0: BOARD_Z + 180, z1: BOARD_Z + 560 };
      if (box) pickBox(box.r, box.z0, box.z1, id);
    }
  }

  /** The board's pieces: everything on the root that is not the case, the cables or a light (a board swap lifts these). */
  boardRoots(): Object3D[] {
    const skip = new Set<Object3D>([...this.caseRoots, this.wires, this.rgb, this.spill]);
    return this.root.children.filter((o) => !skip.has(o));
  }

  /** The cables (the leads, the cords out of the case): what Build my PC picks a plug in, with `boardRoots` for what stands in front of them. */
  cableRoots(): Object3D[] { return [this.wires]; }

  /** Let the live frame drive a fan or a light. */
  private spin(s: Spin) { s.rotor.userData.spin = true; if (s.ring) own(s.ring); this.fans.push({ ...s, speed: 0 }); }

  /** Add a built model to `g` and let the live frame drive its fans and lights. */
  private model(g: Group, m: Model): Model {
    g.add(m.root);
    for (const s of m.spins) this.spin(s);
    return m;
  }

  // ------------------------------------------------------------------ art
  /**
   * Run `apply` every frame with the zoom seen at the centre of `r` (depth `z`). `anywhere`: the camera zoom there, wherever the view centre is.
   * `area`: the zoom seen at the point of `r` nearest the view's centre instead (a long card: the view may hold only one end of it).
   */
  private reveal(r: RectLike, z: number, apply: (z: number) => void, anywhere = false, area = false): Reveal {
    const v: Reveal = { at: new Vector3(r.x + r.w / 2, -(r.y + r.h / 2), z), apply, anywhere, ...(area ? { area: r } : {}) };
    this.reveals.push(v);
    return v;
  }

  /** A part's detailed view: its face `r` at depth `z`, its detail all in from `zoom` (screen pixels per world unit: the end of its fade, so no lid
   * half covers it); a double click flies the view to it. */
  private rail(id: string, r: RectLike, z: number, zoom: number): Rail {
    const v: Rail = { id, rect: { x: r.x, y: r.y, w: r.w, h: r.h }, z, zoom };
    this.rails.push(v);
    return v;
  }

  /** `buildDevice`, noting what it added to the shared lists (`owned`). */
  private build(d: DeviceSnap): Owned | null {
    const n = { roots: this.root.children.length, reveals: this.reveals.length, fades: this.fades.length, apart: this.apart.length, still: this.still.length, fans: this.fans.length, obstacles: this.obstacles.length, keep: this.keep.length, caseRoots: this.caseRoots.length, rails: this.rails.length };
    this.buildDevice(d);
    const o: Owned = {
      id: d.id, kind: d.kind, slot: d.slot, roots: this.root.children.slice(n.roots), reveals: this.reveals.slice(n.reveals), fades: this.fades.slice(n.fades), apart: this.apart.slice(n.apart), still: this.still.slice(n.still),
      fans: this.fans.slice(n.fans), obstacles: this.obstacles.slice(n.obstacles), keep: this.keep.slice(n.keep), caseRoots: this.caseRoots.slice(n.caseRoots), rails: this.rails.slice(n.rails),
    };
    this.owned.set(keyOf(d), o);
    return o;
  }

  /**
   * The live memory map over the bank of sticks: it comes in as the spreaders go, and the bank is one detailed view a double click flies to.
   * Made again when a stick comes or goes (the old map's reveal and rail go).
   */
  private buildRamMap(): void {
    if (this.ramBits) {
      this.reveals.splice(this.reveals.indexOf(this.ramBits.reveal), 1);
      this.rails.splice(this.rails.indexOf(this.ramBits.rail), 1);
      this.ramBits = null;
    }
    this.ramMap?.dispose();
    this.ramMap = null;
    if (!this.ram || !this.ramSticks.length) return;
    const map = this.ramMap = new RamMap3D(this.ramSticks, this.T);
    this.ramBits = { reveal: this.reveal(this.ram, BOARD_Z + 200, (z) => map.show(smooth(RAM_FADE[0], RAM_FADE[1], z)), false, true), rail: this.rail('ram', this.ram, BOARD_Z + 200, RAM_IN[1]) };
  }

  /**
   * The router's detailed view (docs/render/net.md "Inside the NIC and the router"): its plan on a panel over its front bezel in the room, which the zoom fades in over the router as a
   * card's floorplan comes in over its cover. The panel and each of its blocks are a rail (a double click flies to them), and its live layer is a face (`Chips3D`). Made again when
   * the router of another tier stands (the room builds that router again, `Room3D.routerBuild`); none on the Build my PC stage, whose wall has a router of its own.
   */
  private buildRouter(s: Snapshot | null): void {
    const tier = this.inRoom && this.chips && this.shown === 'machine' ? routerTier(s?.net?.router?.id) : null;
    if (tier === (this.routerBits?.tier ?? null)) return;
    const old = this.routerBits;
    if (old) {
      this.reveals.splice(this.reveals.indexOf(old.reveal), 1);
      for (const r of old.rails) this.rails.splice(this.rails.indexOf(r), 1);
      this.art.drop(old.surface, old.art);
      this.routerBits = null;
    }
    if (tier === null || !this.chips) { this.chips?.setRouter(null); return; }
    const fit = routerFit(tier), geo = routerGeo(tier, fit.face), z = fit.front + ROUTER_PANEL_Z, band = DEVICE_LOD.router.fade;
    const art = this.art.baker(() => routerFace(this.T, geo)), surface = this.art.surface(this.root, art.bake, geo.face, z, LV_PART);
    surface.setOpacity(0);
    this.chips.setRouter(geo);
    this.chips.face(this.root, 'router', geo.face, z + 2);
    const reveal = this.reveal(geo.face, z, (zoom) => surface.setOpacity(smooth(band[0], band[1], zoom)), false, true);
    this.routerBits = { tier, art, surface, reveal, rails: routerRails(geo).map((r) => this.rail(r.id, r.rect, z, r.id === 'router' ? band[1] : DEVICE_LOD.router.detail)) };
  }

  /**
   * A NIC's detailed view (docs/render/net.md "Inside the NIC and the router"): once the card has turned over, the card and each of its parts is a flight (a double click) and can be pointed at; the
   * controller's die wears the floorplan, which its lid hides until the zoom takes the lid away (the live layer runs on the die's face, `Chips3D`). The lid fades alone, so its materials are its own.
   */
  private nicBits(d: DeviceSnap, c: Card3D, i: number, visual: string): void {
    const turn = DEVICE_LOD.nic.roll[1];
    this.rail(d.id, nicFaceRect(i, visual), HINGE_Z, turn);
    for (const b of c.bodies) if (!(c.die && b.id.endsWith('.nic-ctl'))) this.rail(b.id, b.rect, b.z, turn);
    // (the parts are a stand-in anchor of their own: the card's tree is left out of the distance level of detail, and three cards' parts would draw one by one at the overview)
    if (c.parts) this.still.push(c.parts);
    this.apart.push(...c.lids);
    if (!c.die) return;
    this.chips?.face(c.die.root, 'nic', c.die.rect, c.die.z, d.slot);
    this.reveal(c.die.at, c.die.zTop, c.lod);
    this.rail(`${d.slot}.nic-ctl`, c.die.at, c.die.zTop, DEVICE_LOD.die.fade[1] / c.die.scale);
  }

  /**
   * What a pick of `id` means: a part of a NIC (`pcie2.nic-xtal`) is the card itself until the card has turned over and shows its parts (a standing or a swinging card is hit on whatever
   * side it shows). The die's blocks (`pcie2.nic-mac`) are not asked: they are hit only through the live layer, once the lid is gone.
   */
  pickId(id: string | null): string | null {
    const m = id ? /^(pcie\d+)\.nic-(?:jack|edge|ctl|xtal|nvm|vreg|label)$/.exec(id) : null;
    const card = m && this.cards.get(m[1]!);
    return card && card.turned() < 0.9 ? this.devs.find((d) => d.slot === m![1])?.id ?? id : id;
  }

  /** The same for a built object: its box as seen from the glass, its face the box's front. */
  private railOf(id: string, o: Object3D, zoom: number) {
    const b = new Box3().setFromObject(o);
    if (!b.isEmpty()) this.rail(id, { x: b.min.x, y: -b.max.y, w: b.max.x - b.min.x, h: b.max.y - b.min.y }, b.max.z, zoom);
  }

  // ------------------------------------------------------------------ board
  private buildBoard(s: Snapshot | null) {
    // the board of this tier (boardmodel3d.ts: the same model the gallery shows); an empty socket is tagged for picking, its lights follow the power
    const filled = new Set(s?.devices.map((d) => d.slot) ?? []);
    const b = boardModel(this.art, this.T, GEO.tier, { filled, ...(s ? { feat: s.board.features } : {}) });
    this.sockets = b.sockets;
    this.contacts = b.contacts;
    if (b.lan) this.lan.set('board', b.lan); else this.lan.delete('board');
    for (const [id, o] of b.sockets) if (!filled.has(id)) tag(o, id);
    for (const l of b.lights) this.spin(l);
    this.root.add(b.root);
    // far out the flat drawing is enough: the small parts stand up only up close
    this.small = b.small;
    this.reveal(BD, BOARD_Z, (z) => { b.small.visible = z > DEVICE_LOD.labels.board; });
    // an empty memory socket, M.2 slot, header or seat is picked by an unseen box over its rect; the USB port by one in front of the cover, where a key is dropped
    const clear = mat(0, { transparent: true, opacity: 0, depthWrite: false });
    const pickBox = this.pickBox = (r: RectLike, z0: number, z1: number, id: string) => { const b = unseen(tag(rectBox(r, z0, z1, clear), id)); this.picks.set(id, b); this.root.add(b); };
    pickBox(grow(USB_PORT, 60), BOARD_Z, BOARD_Z + 1400, 'usb');
    GEO.dimm.forEach((d, i) => { if (!filled.has(`dimm${i}`)) pickBox(d.rect, BOARD_Z, BOARD_Z + SLOT_H, `dimm${i}`); });
    M2_SLOTS.forEach((m, i) => { if (!filled.has(`m2${i}`)) pickBox(m, BOARD_Z, BOARD_Z + 40, `m2${i}`); });
    if (s) for (const [id, r] of slotRects(s)) if (/^(tpm|cooler|vrm-sink|ram-sink)\d+$/.test(id) && !filled.has(id)) pickBox(r, BOARD_Z, BOARD_Z + 40, id); // (low: the cooler's seat is round the CPU socket, which stands above it and wins the ray)
    if (s) this.fanPicks(s, filled, pickBox);
    // the back wall's slot covers, where no card's bracket stands; an empty bay is picked by an unseen plate over its mouth
    const blank = SLOT_BLANK[CASE_KIND[LAYOUT_CASE] ?? 'gamer'];
    this.blankTone = blank;
    PCIE_RAILS.forEach((_, i) => { if (!filled.has(`pcie${i}`)) { const b = slotBlank(nicY(i), blank); this.blanks.set(`pcie${i}`, b); this.root.add(b); } });
    for (const t of this.cages.flatMap((c) => c.trays)) if (!filled.has(`sata${t.slot}`)) this.root.add(tag(trayHit(t), `sata${t.slot}`));
  }

  /**
   * The case with no board (`shown` `case`): the tray shows its standoffs, the front-panel leads lie coiled on it as a new case ships them (`leadCoil`, what
   * the shop's showcase shows), and the rear's slot covers stand in their openings. The coil and the covers are the case's own (`caseRoots`): a case
   * swap lifts them with it. There is no socket, pick box or part: nothing can be fitted until a board comes (`BuildStage.fit`).
   */
  private buildEmpty() {
    const coil = leadCoil();
    this.root.add(coil);
    this.caseRoots.push(coil);
    const blank = SLOT_BLANK[CASE_KIND[LAYOUT_CASE] ?? 'gamer'];
    this.blankTone = blank;
    PCIE_RAILS.forEach((_, i) => { const b = slotBlank(nicY(i), blank); this.blanks.set(`pcie${i}`, b); this.root.add(b); this.caseRoots.push(b); });
  }

  /** Is there no board in it: the case alone, or no case either (`shown`)? A board's patch, its cables and its parts do not apply to it. */
  private get noBoard(): boolean { return this.shown !== 'machine'; }

  /** The box of the case without its side panel: the parts, the cables and the mains cord stay in or near it (a picture of the machine frames this: `BuildStage.capture`). */
  bodyBox(): Box3 {
    const door = this.door?.cm.door, box = new Box3();
    this.root.updateMatrixWorld(true);
    for (const o of this.caseRoots) if (o !== door && o.visible) box.union(new Box3().setFromObject(o));
    return box;
  }

  /**
   * The boxes the air meets, in the machine's space (the airflow lens, air/plan.ts): the case's fixed bodies (the board, the basement, the drive cage, the
   * memory bank) and each part that stands in the way (cooler, cards, sinks, radiator), by device id. The parts' are the boxes the cables go round.
   */
  airBodies(): AirBody[] {
    const box = (r: RectLike, z0: number, z1: number) => ({ min: [r.x, -(r.y + r.h), z0] as V3, max: [r.x + r.w, -r.y, z1] as V3 });
    const out: AirBody[] = [{ id: 'board', kind: 'board', ...box(BD, CASE_Z, BOARD_Z) }, ...this.solidBodies()];
    if (this.ram) out.push({ id: 'ram', kind: 'ram', ...box(this.ram, BOARD_Z, BOARD_Z + 380) });
    for (const o of this.owned.values()) for (const ob of o.obstacles) {
      const b = this.solids.get(ob);
      if (b) out.push({ id: o.id, kind: o.kind, slot: o.slot, min: [...b.min] as V3, max: [...b.max] as V3 });
    }
    return out;
  }

  /** The case's solid bodies that no part and no zoom takes away: the basement (the shroud) and the drive cage. */
  private solidBodies(): AirBody[] {
    const box = (r: RectLike, z0: number, z1: number) => ({ min: [r.x, -(r.y + r.h), z0] as V3, max: [r.x + r.w, -r.y, z1] as V3 });
    return [
      { id: 'basement', kind: 'basement', ...box({ x: CASE_IN.x, y: this.plan.top, w: this.plan.east - CASE_IN.x, h: this.plan.floor - this.plan.top }, CASE_Z, FRONT) },
      { id: 'cage', kind: 'cage', ...cageBox(this.cage) },
    ];
  }

  /** The boxes a camera leaning over a part inside the case must not look through (`leanClear` in camera.ts): the case's solid bodies. */
  sightBlocks(): Room[] {
    return this.solidBodies().map((b) => ({ x0: b.min[0], x1: b.max[0], y0: b.min[1], y1: b.max[1], z0: b.min[2], z1: b.max[2] }));
  }

  /** Run `draw` with the side panel taken off: the picture of an open machine, whatever the panel's kind (a steel one hides the inside, a glass one tints it). */
  withoutDoor<T>(draw: () => T): T {
    const door = this.door?.cm.door, was = door?.visible ?? true;
    if (door) door.visible = false;
    try { return draw(); } finally { if (door) door.visible = was; }
  }

  /**
   * The airflow lens's thermal view (docs/render/air.md): each part with a skin glows by its temperature (`temps`, by device id; a part not in it is at the
   * scale's foot) on the thermal scale from `lo` to `hi`, and eases there. Null puts every part's own look back.
   */
  thermal(temps: ReadonlyMap<string, number> | null, lo = 25, hi = 60): void {
    for (const [id, sk] of this.skins) sk.thermal(temps ? heatOf(temps.get(id) ?? lo, lo, hi) : null);
  }

  /**
   * The power lens's view of the parts (docs/render/power.md): each power part (`roles`, by device id: a use, a hub or a source) glows by what it draws (`levels`, by
   * device id, 0 to 1 on the power scale) in its role's colour, red for the ids in `warn`. A part with no role (a heatsink, a radiator, a hose) keeps its own look, under
   * the veil. With no `roles` every part in `levels` is a use. Null puts every part's own look back. The basement's shroud is taken off while the lens shows: the
   * supply and the fan hub, two of its hubs, stand under it, and its top sheet hides them from above.
   */
  powerGlow(levels: ReadonlyMap<string, number> | null, warn: ReadonlySet<string> = new Set(), roles: ReadonlyMap<string, Role> | null = null): void {
    const each = (id: string, sk: PartSkin): void => {
      const role = roles ? roles.get(id) : levels?.has(id) ? 'use' : undefined;
      sk.electric(levels && role ? (levels.get(id) ?? 0) : null, warn.has(id), role);
    };
    this.splitParts(!!levels);
    for (const [id, sk] of this.skins) each(id, sk);
    for (const [id, sk] of this.powerSkins) each(id, sk);
    const cover = this.root.getObjectByName(SHROUD);
    if (cover) cover.visible = !levels;
    // (the fans' rings of light are a decoration: they go low, or they read as the power of the fan)
    this.ringK = levels ? RING_IN_LENS : 1;
  }

  /** What the fans' rings of light are multiplied by (1: their own, `RING_IN_LENS`: while the power lens shows). */
  private ringK = 1;

  /** The skins of the power lens alone: a part with no look of its own to follow in the other views (a fan, the module) that glows by its draw there and nowhere else. */
  private powerSkins = new Map<string, PartSkin>();
  /** The parts that have a power skin to make (a fan, the module), by id: the group each one stands in. */
  private powerRoots = new Map<string, Object3D>();
  /** Each mesh the lens gave a material of its own, and the shared one it had (the lens puts it back). */
  private powerWas = new Map<Mesh, MeshStandardMaterial>();
  /** Does the lens show (are the parts split)? */
  private powerOn = false;

  /**
   * Note a part that the power lens lights alone (`id`, standing in `root`). Its skin is made only while the lens shows: a material no other part shares costs a draw
   * for each part (a fan's frame is one material for every fan, and the build draws them together), so the other views keep the shared ones.
   */
  private powerSkin(id: string, root: Object3D): void {
    this.powerRoots.set(id, root);
    if (this.powerOn) this.splitPart(id, root);
  }

  /** The part tagged `id` inside `root` gets a copy of each of its materials that no other part shares, so the lens can light one fan alone. A glow of the part's own (a fan's ring of light) is left as it is. */
  private splitPart(id: string, root: Object3D): void {
    const part = findById(root, id);
    if (!part) return;
    const copies = new Map<MeshStandardMaterial, MeshStandardMaterial>();
    part.traverse((o) => {
      const m = o as Mesh, src = m.material;
      if (!m.isMesh || Array.isArray(src) || !(src instanceof MeshStandardMaterial) || src.emissive.getHex() !== 0) return;
      let c = copies.get(src);
      if (!c) copies.set(src, (c = src.clone()));
      this.powerWas.set(m, src);
      m.material = c;
    });
    if (copies.size) this.powerSkins.set(id, new PartSkin([...copies.values()]));
  }

  /** Give the lit parts their own materials while the lens shows (`on`), and the shared ones back when it goes. */
  private splitParts(on: boolean): void {
    if (on === this.powerOn) return;
    this.powerOn = on;
    if (on) { for (const [id, root] of this.powerRoots) this.splitPart(id, root); return; }
    const copies = new Set<MeshStandardMaterial>();
    for (const [m, was] of this.powerWas) { copies.add(m.material as MeshStandardMaterial); m.material = was; }
    for (const c of copies) c.dispose();
    this.powerWas.clear();
    this.powerSkins.clear();
  }

  // ------------------------------------------------------------------ parts
  private skin(id: string, ...mats: MeshStandardMaterial[]) { this.skins.set(id, new PartSkin(mats)); }
  /** The same with a soft glow: a part with wide faces keeps its own colours under the state's (`PartSkin` gain). */
  private softSkin(id: string, ...mats: MeshStandardMaterial[]) { this.skins.set(id, new PartSkin(mats, 0.3)); }
  /** A skin of the airflow lens alone: a part that has no state look of its own (a radiator, a heatsink, a hose) glows by its heat there and nowhere else. */
  private thermalSkin(id: string, ...mats: MeshStandardMaterial[]) { this.skins.set(id, new PartSkin(mats, 1, false)); }

  private buildDevice(d: DeviceSnap) {
    const spec = getSpec(d.spec);
    if (!spec) return;
    const visual = (spec as { visual?: string }).visual ?? '';
    const g = tag(new Group(), d.id);
    const T = this.T;
    switch (spec.kind) {
      case 'cpu': {
        // the package, its die and its lid (`cpuModel`); the live die runs on the die's face, in the die's own frame (the faces' views carry
        // their parent's transform, as a card's do); the lid fades away over the die view's band
        const c = cpuModel(this.art, T, spec as CpuSpec);
        g.add(c.root);
        this.chips?.face(c.die.root, 'die', DIE_PLAN, c.die.z);
        this.fades.push(c.lid);
        this.reveal(DIE, CPU_Z.top - 60, c.lod);
        this.rail(d.id, DIE, CPU_Z.die, DEVICE_LOD.die.fade[1] / CPU_S);
        this.skin(d.id, ...c.skin);
        break;
      }
      case 'cooler': {
        // the 2D cooler's look stood up (`coolerModel`); it fades out over the 2D band as the die comes in, and the loop's tubes cross the
        // board, so any close look fades them
        // (the zoom fades a group inside the part: `fadeTree` sets `visible` each frame, and Build my PC hides the part itself while it is off)
        const fade = new Group();
        g.add(fade);
        const hosted = this.fanFits((slot) => fanHost(slot) === d.slot), m = this.model(fade, coolerModel(visual, hosted));
        for (const f of hosted) this.powerSkin(f.id, fade);
        if (lowDetail()) { const f = coolerFoot(visual); fade.add(onBoard(footShade(f.r, COOLER_SHADE.reach, COOLER_SHADE.peak, f.round))); }
        this.fades.push(fade);
        this.pump = !!(spec as { loop?: unknown }).loop;
        this.cooler = fade;
        this.reveal(COOLER, BOARD_Z + 400, (z) => {
          const a = 1 - smooth(DEVICE_LOD.cooler.fade[0], DEVICE_LOD.cooler.fade[1], z);
          fadeTree(fade, a);
          if (this.hoses) fadeTree(this.hoses.body, a);
        }, this.pump);
        this.softSkin(d.id, ...m.skin);
        this.obstacles.push(m.root);
        m.root.userData.cooler = true;
        break;
      }
      case 'ram': {
        // the stick stands in its socket (`ramStick`); its spreader fades in the RAM band, as the camera leans to read the faces (board3d.ts)
        const i = idx(d.slot), r = { x: DIMM_X(i), y: DIMM_Y(i), w: DIMM_W, h: DIMM_H }, rs = spec as RamSpec;
        const st = ramStick(rs.visual, !!rs.ecc, r, rs.name);
        g.add(st.root);
        for (const s of st.spins) this.spin(s);
        this.fades.push(st.spreader);
        this.reveal(r, BOARD_Z + 200, (z) => fadeTree(st.spreader, 1 - smooth(RAM_FADE[0], RAM_FADE[1], z)));
        this.root.add(g, tag(st.hit, d.id));
        this.ram = this.ram ? union(this.ram, r) : r;
        this.ramSticks.push({ idx: i, bytes: rs.sizeBytes, faces: st.mapFaces });
        this.softSkin(d.id, ...st.skin);
        return;
      }
      case 'gpu': case 'npu': case 'nic': {
        // the card stands in its slot (`card3d`); up close its cooler fades and it swings down flat: a GPU shows the shop picture's art (the die with its
        // floorplan), an AI card its die without the lid (`npuFace`), and the dies run on them. A NIC then turns over and shows its parts in 3D (`nicBits`)
        const i = idx(d.slot), kind = spec.kind;
        const c = cardModel(this.art, T, kind, visual, i, (face, z) => { if (kind !== 'nic') this.chips?.face(face, kind, chipRect(kind, visual, i), z + 2, d.slot); }, d.slot);
        this.model(g, c);
        // standing until the camera says otherwise: the cables go round it standing
        c.pose(0);
        this.obstacles.push(c.root);
        this.fades.push(c.root);
        this.reveal(c.at, BOARD_Z + 300, c.pose, false, true);
        // (flat, the card's face lies on the hinge's plane)
        if (kind === 'nic') this.nicBits(d, c, i, visual);
        else this.rail(d.id, chipRect(kind, visual, i), HINGE_Z, DEVICE_LOD[kind].fade[1]);
        this.cards.set(d.slot, c);
        if (c.lan) this.lan.set(d.id, c.lan);
        this.apart.push(c.fades);
        this.softSkin(d.id, ...c.skin);
        break;
      }
      case 'tpm': {
        // the module on its header (tpm3d.ts); its die runs over its chip, its LED shows protected mode (chips3d.ts)
        if (tpmModel(g, visual, (top, r, z) => this.chips?.face(top, 'tpm', r, z + 2, d.slot))) this.rail(d.id, tpmRect(GEO.tier)!, TPM_Z.top, DEVICE_LOD.tpm.lid);
        this.powerSkin(d.id, g);
        break;
      }
      case 'psu': {
        // at the basement's back corner, by its mains inlet (`psuUnit`); the shroud's panel over it answers the click
        const u = psuUnit(this.plan, visual, (spec as { fan?: boolean }).fan !== false, (spec as { watts?: number }).watts ?? 0);
        g.add(u.root);
        tag(g, 'psu');
        this.softSkin(d.id, u.body);
        break;
      }
      case 'storage': {
        const kind = driveKindOf(visual), b = driveBody(kind, d.slot);
        // an M.2 stick lies on its socket and standoff; a SATA drive (drive3d.ts, at its real size) lies on its tray in its bay of the cage, the tray with it
        if (kind === 'ssd-nvme') { this.softSkin(d.id, nvmeStick(g, b, nvmeLook(spec as StorageSpec))); this.railOf(d.id, g, DEVICE_LOD.disk.fade[1]); break; }
        const spot = traySpot(this.cages, idx(d.slot));
        if (!spot) break;
        const hdd = kind === 'hdd', dm = sataDriveModel(hdd, { name: spec.name, capacityBytes: (spec as StorageSpec).capacityBytes }), o = onTray(hdd);
        const tray = trayAt(CASE_KIND[LAYOUT_CASE] ?? 'gamer', spot, hdd ? 'hdd' : 'ssd');
        dm.root.position.set(o.x, o.y, o.z);
        tray.add(dm.root);
        g.add(tray);
        this.skin(d.id, dm.body);
        this.railOf(d.id, tray, DEVICE_LOD.disk.fade[1]);
        // its receptacles at its back, toward the tray sheet: the cables plug in there (`setCables`)
        const w = (p: V3): V3 => [spot.x + o.x + p[0], spot.y + o.y + p[1], spot.z + o.z + p[2]];
        this.driveSockets.set(d.slot, { data: w(dm.data), power: w(dm.power) });
        break;
      }
      case 'vrm-sink': case 'ram-sink': {
        // as a real regulator sink (sink3d.ts); its fan sits in the housing over the fins, blowing down into them
        g.userData.sink = true;
        this.obstacles.push(g);
        const { spot, foot, skin } = sinkBody(g, T, spec.kind, visual);
        this.thermalSkin(d.id, ...skin);
        const fit = this.fanFits((slot) => fanHost(slot) === d.slot)[0];
        if (fit && spot) {
          const depth = fanDepth(fit.spec.size), fan = fanPart(fit.spec, spot.w, depth);
          fan.root.position.set(spot.x + spot.w / 2, -(spot.y + spot.h / 2), foot + depth / 2);
          g.add(tag(fan.root, fit.id));
          this.powerSkin(fit.id, g);
          this.spin({ ...fan.spin, needs: spec.kind === 'vrm-sink' ? 'vrmfan' : 'ramfan' });
        }
        break;
      }
      case 'radiator': {
        // bolted along the side the player chose, over that side's fan mounts; each fan fitted on them runs on its mount's cable
        if (this.rad) {
          const { fit, span } = this.rad, m = this.model(g, radiatorModel(fit, radiatorGrade(visual), span.ids));
          m.root.userData.radiator = true;
          this.obstacles.push(m.root);
          this.thermalSkin(d.id, ...m.skin);
        }
        break;
      }
      case 'fan': {
        // on a case mount (a radiator's side keeps its fans on their mounts); a heatsink builds the fans on its own spots
        const m = fanMounts().find((x) => x.id === d.slot);
        if (!m) return;
        const f = caseFan({ slot: d.slot, spec: spec as FanSpec }, m.side, m.rect, m.side === 'rear' ? REAR_ZC : FAN_ZC, FAN_MAX);
        g.add(f.root);
        if (m.side === 'rear') g.add(rearFanScrews());
        this.spin(this.caseRgb ? f.spin : { ...f.spin, gain: 0 }); // the plain cases' fans have no light
        this.powerSkin(d.id, g);
        this.caseRoots.push(g);
        break;
      }
      default: return; // the display is the room's (Room3D shows it)
    }
    // a part with a glTF model wears it over its slot's rect in place of the primitives built above
    const model = modelOf(visual, spec.kind), fit = model ? this.rects.get(d.slot) : undefined;
    if (model && fit) {
      this.keep.push(g); // (the model hides the children it replaces: they stay as they are)
      useModel(g, model.url, fit, BOARD_Z + 180, BOARD_Z + 580, [...g.children], () => !tornDown(g), model.stretch);
    }
    this.root.add(g);
  }

  // ------------------------------------------------------------------ cables
  /** What the cables inside the case keep clear of: the tray, the glass, the top, the shroud, the drive cage, the board, and the parts that stand in their way. */
  private caseEnv(skip: readonly Object3D[] = []): Env {
    const box = (r: RectLike, z0: number, z1: number): RopeSolid => ({ min: [r.x, -(r.y + r.h), z0], max: [r.x + r.w, -r.y, z1] });
    const solids: RopeSolid[] = [box(BD, CASE_Z, BOARD_Z), box({ x: CASE_IN.x, y: this.plan.top, w: this.plan.east - CASE_IN.x, h: this.plan.floor - this.plan.top }, CASE_Z, FRONT), cageBox(this.cage)];
    if (this.ram) solids.push(box(this.ram, BOARD_Z, BOARD_Z + 380));
    for (const [o, b] of this.solids) if (!skip.includes(o)) solids.push(b);
    return {
      planes: [{ n: [0, 0, 1], d: TRAY_Z }, { n: [0, 0, -1], d: -(FRONT - 50) }, { n: [0, -1, 0], d: CASE_IN.y }, { n: [1, 0, 0], d: CASE_IN.x }, { n: [-1, 0, 0], d: -(CASE_IN.x + CASE_IN.w) }],
      solids,
    };
  }

  /**
   * The cables, as real cables hanging under their weight (wires3d.ts): each power lead comes out of a grommet in the tray beside its socket (its
   * run from the power supply is behind the tray) as a comb of sleeved strands into its plug, or hangs loose with the plug at its end when it is
   * out. The PCIe leads (dealt to the cards as the sim deals them, `assignLeads`) plug into the cards' top edges; each drive's SATA cable runs
   * from its port into the gutter; the fans' cords run to their headers and the hub; the loop's hoses arc to the radiator. Out of the case the
   * video cable drapes over the desk to the monitor, the mains cords drop through the desk's grommet to the wall socket.
   */
  private *buildCables(s: Snapshot, geo: RoomGeo): Generator<void> {
    const alive = standing(s), has = (id: string) => alive.some((c) => c.id === id), on = (id: string) => alive.some((c) => c.id === id && c.connected);
    const env = this.caseEnv(), T = this.T, gx = BD.x + BD.w + 420, base = sleeveOf(T), deck: RopePlane = { n: [0, 0, 1], d: BOARD_Z };
    const lead = (kind: string, r = 24): Look => ({ r, base, accent: ACCENT(T, kind as 'atx') });
    // (a lead's run from the power supply is behind the tray: the power lens draws a stub of it going on into the grommet)
    const fed: RigPower = { fed: true };
    this.rigs.clear();
    // ---- the 24-pin: from a tall slot in the gutter into the right-angle socket on the board's east edge
    if (has('atx')) {
      const r = GEO.atx, slot = { x: gx + 200, y: r.y + r.h / 2 - 340, w: 60, h: 680 }, g = tag(new Group(), 'cable.atx');
      const look = lead('atx'), accent = ACCENT(T, 'atx'), fixed = fromSlot(slot, 12), o = { natural: true, stiff: 0.7, n: 20, lead: 90 };
      this.wires.add(grommet(slot, this.grommets));
      this.addRig(g, {
        id: 'atx', name: 'the 24-pin', target: 'atx', look, env, fixed, model: () => atxPlug(r, accent),
        seat: { at: [r.x + r.w, -(r.y + r.h / 2), BOARD_Z + 85], axis: [1, 0, 0] }, canSeat: true, engage: 140,
        seated: (ex) => ex.map((e, i) => hangPts(fixed[i]!, e, look, env, o)), deck, n: o.n, stiff: o.stiff, lead: o.lead, power: fed,
      }, on('atx'));
      this.wires.add(g);
      yield;
    }
    // ---- the CPU's 8-pin: from a slot in the tray over the board's top edge, down into the socket from the glass side
    if (has('cpu')) {
      const r = GEO.cpw, slot = { x: r.x - 60, y: BD.y - 270, w: r.w + 120, h: 60 }, g = tag(new Group(), 'cable.cpu');
      const look = lead('cpu'), accent = ACCENT(T, 'cpu'), fixed = fromSlot(slot, 4), o = { natural: true, stiff: 0.75, n: 22, lead: 110 };
      this.wires.add(grommet(slot, this.grommets));
      this.addRig(g, {
        id: 'cpu', name: 'the CPU 8-pin', target: 'cpw', look, env, fixed, model: () => epsPlug(r, accent),
        seat: { at: [r.x + r.w / 2, -(r.y + r.h / 2), BOARD_Z + 160], axis: [0, 0, 1] }, canSeat: true, engage: 110,
        seated: (ex) => ex.map((e, i) => hangPts(fixed[i]!, e, look, env, o)), deck, n: o.n, stiff: o.stiff, lead: o.lead, power: fed,
      }, on('cpu'));
      this.wires.add(g);
      yield;
    }
    // ---- the PCIe leads: each from its own grommet in the gutter up into a card's top edge, or loose
    const cards = s.devices.filter((d) => (d.kind === 'gpu' || d.kind === 'npu') && !d.burnt).map((d) => ({ slot: d.slot, loadW: getSpec(d.spec)!.loadW, visual: (getSpec(d.spec) as { visual: string }).visual }));
    const deals = assignLeads(cards);
    for (const [k, c] of alive.filter((x) => isPcieKind(x.id)).entries()) {
      const deal = deals.find((l) => l.lead === c.id), card = deal && this.cards.get(deal.slot), sock = card && deal ? card.sockets[deal.plug] : undefined;
      // (the slot lies along x, as the plug's pins do: the four strands run side by side and never turn over)
      const sy = sock ? sock.y + 240 : (PCIE_RAILS[0]?.y ?? 0) + 300 + k * 260, slot = { x: gx + 60 + k * 170, y: sy + (k % 2) * 90, w: 150, h: 60 };
      const g = tag(new Group(), 'cable.' + c.id), accent = ACCENT(T, c.id as 'pcie'), look = lead(c.id), fixed = fromSlot(slot, 4);
      // with no card to take it, its model is built at a stand-in seat over its grommet
      const at = sock ?? { x: slot.x + slot.w / 2, y: slot.y - 500, z: BOARD_Z + 300 }, top = at.z + 300, o = { natural: true, slack: 1.05, stiff: 0.6, n: 24 };
      this.wires.add(grommet(slot, this.grommets));
      this.addRig(g, {
        id: c.id, name: 'the card\'s power socket', target: (deal && s.devices.find((d) => d.slot === deal.slot)?.id) ?? null, look, env, fixed,
        model: () => ({ root: standingPlug(at, accent, top), strands: [0, 1, 2, 3].map((i): RopeEnd => ({ at: [at.x + (i - 1.5) * (CARD_PLUG.w / 4), -at.y, top + 2], dir: [0, 0, 1] })) }),
        seat: { at: [at.x, -at.y, at.z], axis: [0, 0, 1] }, canSeat: !!sock, engage: 110,
        seated: (ex) => ex.map((e, i) => hangPts(fixed[i]!, e, look, env, o)), deck, n: o.n, stiff: o.stiff, lead: look.r * 2.5, power: fed,
      }, c.connected, sock ? () => card!.alsoFade(g) : undefined);
      this.wires.add(g);
      yield;
    }
    // ---- SATA: each drive's data cable from its port on the board's edge into a slot in the gutter; at the drive, its data and power cables
    // leave the sockets on its end and go back through the cage
    const sataSlot = GEO.sata.length ? { x: gx - 30, y: GEO.sata[0]!.y - 60, w: 60, h: GEO.sata[GEO.sata.length - 1]!.y + GEO.sata[GEO.sata.length - 1]!.h - GEO.sata[0]!.y + 120 } : null;
    if (sataSlot) this.wires.add(grommet(sataSlot, this.grommets));
    const sataEnds = sataSlot ? fromSlot(sataSlot, GEO.sata.length) : [], data: Look = { r: 15, base: '#4e5360', accent: null }, black: Look = { r: 19, base: '#16171b', accent: null };
    for (const d of s.devices) {
      if (d.kind !== 'storage' || !d.slot.startsWith('sata')) continue;
      const i = idx(d.slot), port = GEO.sata[i], g = tag(new Group(), d.id);
      if (port && sataEnds[i]) { const p = sataPlug(port); g.add(p.root, hung(p.end, sataEnds[i]!, data, env, { natural: true, slack: 1.05, stiff: 0.7, n: 18 })); }
      const drive = this.driveSockets.get(d.slot), slot = cageGrommet(this.cages.find((c) => c.trays.some((t) => t.slot === i)) ?? this.cage);
      if (drive) for (const [sock, look, power] of [[drive.data, data, false], [drive.power, black, true]] as const) {
        // (the power cable is the supply's: with none fitted there is no such cable)
        if (power && !s.devices.some((x) => x.kind === 'psu')) continue;
        // its plug pushed into the receptacle, the cable back into the slot in the tray sheet behind its cage (`cageGrommet`)
        const p = drivePlug(power, sock, power ? 0x16171b : 0xb3262f);
        const back: RopeEnd = { at: [slot.x + slot.w * (power ? 0.62 : 0.38), Math.min(-(slot.y + 80), Math.max(-(slot.y + slot.h - 80), sock[1] - 260)), TRAY_Z - 30], dir: [0, 0, 1] };
        const pts = hangPts(p.end, back, look, { planes: [], solids: [] }, { slack: 1.15, extra: 60, stiff: 0.7, n: 16 });
        g.add(p.root, cableMesh(pts, look));
        // (the power cable is the lens's: from the slot behind the cage, where the supply's lead comes in, to the drive)
        if (power) this.runs.set(`${d.id}:power`, { id: `${d.id}:power`, strands: [reversed(pts)], r: look.r, seated: true, seat: { at: sock, axis: [-1, 0, 0] }, held: false, fed: true });
      }
      this.wires.add(g);
      yield;
    }
    // ---- the fans' cords: from the fan to its header; the case fans' from the slot in the tray over the hub to the hub's headers
    const fanLook: Look = { r: 11, base: '#14161c', accent: T.mul }, hubSlot = grommet(FAN_SLOT, this.grommets);
    this.wires.add(hubSlot);
    const hubEnds = fromSlot(FAN_SLOT, hubHeaders().length + 1);
    for (const p of fanCordPlans()) {
      if (!has(p.id)) continue;
      const g = tag(new Group(), 'cable.' + p.id), plugged = on(p.id);
      // (the power goes from the header, out to the fan)
      const cord = (fixed: RopeEnd, e: Env, o: { slack: number; extra: number; n: number }, rest: Pick<CableRig, 'model' | 'seat' | 'engage' | 'extra' | 'power'>): CableRig => ({
        id: p.id, name: 'its fan header', target: null, look: fanLook, env: e, fixed: [fixed], canSeat: true, deck,
        seated: (ex) => [hangPts(fixed, ex[0]!, fanLook, e, o)], n: o.n, stiff: 0.5, lead: fanLook.r * 2.5, ...rest, power: { out: true, ...rest.power },
      });
      // a fan's plug on its board header, pushed in from the glass side
      const header = (): Pick<CableRig, 'model' | 'seat' | 'engage'> => ({
        model: () => { const h = fanPlug(p.header, T.mul); return { root: h.root, strands: [h.end] }; },
        seat: { at: at(p.header.x + p.header.w / 2, p.header.y + p.header.h / 2, BOARD_Z + 150), axis: [0, 0, 1] }, engage: 70,
      });
      if (p.id.startsWith('fan:')) {
        // the hub's header on its top edge, the cord down to it from the slot
        const hx = p.seat[0], from = hubEnds[1 + hubHeaders().findIndex((h) => h.x === hx)] ?? hubEnds[0]!;
        this.addRig(g, cord(from, env, { slack: 1.2, extra: 80, n: 14 }, {
          model: () => ({ root: rectBox({ x: hx - 34, y: FAN_HUB.y - 70, w: 68, h: 70 }, CASE_Z + 206, CASE_Z + 276, mat(0x1d1e22, { roughness: 0.5 })), strands: [{ at: [hx, -(FAN_HUB.y - 70), CASE_Z + 240], dir: [0, 1, 0] }] }),
          seat: { at: [hx, -FAN_HUB.y, CASE_Z + 240], axis: [0, 1, 0] }, engage: 60,
        }), plugged);
      } else {
        // the fan's end: the cooler's west side, a heatsink fan's housing, the hub's input
        const cooler = s.devices.find((d) => d.kind === 'cooler'), coolerFans = s.devices.filter((d) => d.kind === 'fan' && cooler && fanHost(d.slot) === cooler.slot);
        const anchor: RopeEnd = p.id === 'cpufan' ? coolerFanLead((getSpec(cooler?.spec ?? '') as { visual?: string } | undefined)?.visual ?? '', coolerFans.map((d) => Number(d.slot.slice(d.slot.lastIndexOf('.fan') + 4))))
          : p.id === 'sysfan' ? { at: at(FAN_HUB.x + 90, FAN_HUB.y - 60, CASE_Z + 240), dir: [0, 1, 0] }
          : { at: at(p.anchor[0], p.anchor[1], SINK_FAN_MID), dir: [p.anchorDir[0], -p.anchorDir[1], 0] }; // (out of a sink fan's frame)
        const skip = p.id === 'cpufan' ? this.obstacles.filter((o) => o.userData.cooler) : this.obstacles.filter((o) => o.userData.sink);
        const fenv = this.caseEnv(skip);
        if (p.id === 'sysfan') {
          // under the board's bottom edge into the tray, and out of the hub slot into the hub's input
          const hole = { x: p.seat[0] - 40, y: BD.y + BD.h + 70, w: 80, h: 60 };
          this.wires.add(grommet(hole, this.grommets));
          const holeEnd = fromSlot(hole, 1)[0]!, hubRun = hangPts(hubEnds[0]!, anchor, fanLook, fenv, { slack: 1.2, extra: 80, n: 14 });
          this.addRig(g, cord(holeEnd, fenv, { slack: 1.25, extra: 120, n: 16 }, {
            ...header(), extra: () => cableMesh(hubRun, fanLook),
            // (the power goes on from the header, in at the hole, behind the tray to the hub's slot, out to the hub's input)
            power: { more: [hubRun] },
          }), plugged);
        } else this.addRig(g, cord(anchor, fenv, { slack: 1.3, extra: 160, n: 20 }, header()), plugged);
      }
      this.wires.add(g);
      yield;
    }
    // ---- the case's own front-panel leads, out of their hole under the board's south edge to the board's headers: rigs the stage's hand can run (not the game's cables)
    for (const rig of panelRigs(env)) {
      const g = tag(new Group(), 'cable.' + rig.id);
      this.addRig(g, rig, !this.panelOut.has(rig.id));
      this.wires.add(g);
    }
    yield;
    yield* this.buildRoomCords(s, geo);
  }

  /**
   * The cords out of the case, over the room: the video cable runs from the board's HDMI port through the desk and up behind the monitor's stand
   * into its back (never across the desk in front of the stand); the mains
   * cords (the PC's from the PSU's inlet in the case's rear wall, the monitor's from its back) drop through the desk's grommet to the wall
   * socket. A cord that is out lies loose from its device.
   */
  private *buildRoomCords(s: Snapshot, geo: RoomGeo): Generator<void> {
    const alive = standing(s), has = (id: string) => alive.some((c) => c.id === id), on = (id: string) => alive.some((c) => c.id === id && c.connected);
    const deskTop = -geo.ys, under = -(geo.ys + DESK_TOP), m = MONITOR, mz = MONITOR_Z;
    const box = (r: RectLike, z0: number, z1: number): RopeSolid => ({ min: [r.x, -(r.y + r.h), z0], max: [r.x + r.w, -r.y, z1] });
    const caseBox = box({ x: CASE.x, y: CASE.y, w: CASE.w, h: CASE.h + FOOT }, CASE_Z, FRONT);
    const mp = monitorPlan(m, geo.ys, mz), seats = monitorSeats(m, mz), monitor = [mp.panel, mp.hump, mp.boss].map((o) => box(o.r, o.z0, o.z1));
    const room: Env = { planes: [{ n: [0, 1, 0], d: deskTop }, { n: [0, 0, 1], d: 40 }], solids: [caseBox, ...monitor] }, deck = room.planes[0]!;
    // (a mains cord is a real IEC lead's, 6 mm thick)
    const cord: Look = { r: 70, base: '#18181b', accent: null }, video: Look = { r: 34, base: '#1d1f24', accent: null };
    // the desk's grommet the mains cords drop through, behind the case's west side
    const dg = { x: CASE.x - 900, z: 1300 }, w = this.wall;
    this.wires.add(post(dg.x, geo.ys, dg.z, 150, 14, mat(0x2a2d32, { roughness: 0.6, metalness: 0.3 }), SEG.bigDisc), post(dg.x, geo.ys - 1, dg.z, 112, 16, mat(0x050608, { roughness: 0.9 }), SEG.bigDisc));
    // (the studio's wall: its floor and its face are the cords' planes, the router and the case their solids)
    const stage: Env | null = w ? { planes: [{ n: [0, 1, 0], d: deskTop }, { n: [0, 0, 1], d: w.plan.face.z + 60 }], solids: [caseBox, routerSolid(w.plan, routerTier(s.net?.router?.id))] } : null;
    if (has('video')) {
      // combed out of sight: from the monitor's back (its plug is built in), behind the stand, down through the keyboard's grommet by the wall
      // (room3d.ts: the keyboard sits at MONITOR_Z + 3600), along under the top (over the tray) and up through the desk's grommet behind the
      // case. What the player moves is the PC end: from that grommet over the desk to the board's HDMI port on the case's west side, or to a
      // graphics card's display port (a graphics display only), as the 2D game.
      const g = tag(new Group(), 'cable.video'), y = VIDEO_Y, z = BOARD_Z + 520;
      const vz = dg.z + 80, kg = { x: m.x + m.w / 2 + KEY_LEAD[0] + 160, z: mz + 3600 + KEY_LEAD[1] - 150 }, low = under - 340;
      const run: V3[] = [[dg.x, deskTop, vz], [dg.x, low, vz], [dg.x - 500, low, vz], [dg.x - 1500, low, kg.z], [kg.x, low, kg.z], [kg.x, deskTop, kg.z]];
      // the stand's column and foot (monitor3d.ts): the cable runs behind them
      const stand: Env = { planes: room.planes, solids: [...room.solids, ...[mp.column, mp.foot].map((o) => box(o.r, o.z0, o.z1))] };
      const up: RopeEnd = { at: [kg.x, deskTop + 10, kg.z], dir: [0, 1, 0] }, o = { natural: true, handle: 0.4, stiff: 0.45, n: 34 };
      const monSeat: Seat = seats.video, mon = seatPlug(monSeat, hdmiPlug(hdmiReal(video.r)));
      g.add(mon.root, cableMesh([...rounded(run, 250), ...hangPts(up, mon.strands[0]!, video, stand, o)], video));
      // the PC end: where the sim has it (the board's port, or a card's), and the other ports it could go to
      // (a card's HDMI is on its bracket, inside the slot's opening: the plug reaches in through the case's back to its mouth)
      const at = (yy: number): V3 => [CASE.x, -yy, z];
      const gpuAt = (d: { spec: string; slot: string }): V3 => {
        const p = gpuVideoAt((getSpec(d.spec) as { visual?: string } | undefined)?.visual ?? '', idx(d.slot));
        return [p.x - 2, -p.y, p.z];
      };
      const gfx = !!(getSpec(s.devices.find((d) => d.kind === 'display')?.spec ?? '') as { graphics?: boolean } | undefined)?.graphics;
      const ports = [{ port: 'board', at: at(y) }, ...(gfx ? s.devices.filter((d) => d.kind === 'gpu' && !d.burnt).map((d) => ({ port: d.slot, at: gpuAt(d) })) : [])];
      const now = ports.find((p) => p.port === s.videoPort) ?? ports[0]!, axis: V3 = [-1, 0, 0];
      const seat: Seat = { at: now.at, axis }, grom: RopeEnd = { at: [dg.x, deskTop + 10, vz], dir: [0, 1, 0] };
      const env: Env = { planes: room.planes, solids: [caseBox] }, pc = { slack: 1.1, extra: 900, stiff: 0.35, n: 30 };
      // (each socket takes its plug, plugs3d.ts: a card's is real; the board's is cut to its rear I/O's smaller mouth, its keyed side toward the board)
      const plug = (port: string) => () => (port === 'board' ? seatPlug(seat, hdmiPlug(boardHdmi(video.r)), -Math.PI / 2) : seatPlug(seat, hdmiPlug(hdmiReal(video.r))));
      this.addRig(g, {
        id: 'video', name: 'the display port', target: 'io', look: video, env, fixed: [grom], model: plug(now.port), seat, canSeat: true, engage: 380,
        port: now.port === 'board' ? undefined : now.port, alts: ports.filter((p) => p !== now).map((p) => ({ ...p, model: plug(p.port) })),
        seated: (ex) => [hangPts(grom, ex[0]!, video, env, pc)], deck, n: pc.n, stiff: pc.stiff, lead: video.r * 2.5,
      }, on('video'));
      this.wires.add(g);
      yield;
    }
    const mains = (id: string, from: RopeEnd, socket: { x: number; y: number }, dx: number) => {
      if (!has(id)) return;
      // the cord runs from its device through the desk's grommet for good; what the player moves is the plug under the desk. It lies loose on the
      // floor by the wall socket (nothing to weave through the desk) and goes into its outlet, out of the wall
      const g = tag(new Group(), 'cable.' + id), hole: V3 = [dg.x + dx, deskTop + 10, dg.z], low: RopeEnd = { at: [dg.x + dx, under - 10, dg.z], dir: [0, -1, 0] };
      // (the room's plate is drawn small, swisssocket3d.ts `ROOM_SOCKET`: its Swiss plug is built at the same scale, upright, its earth pin down)
      const seat: Seat = { at: [socket.x, -socket.y, ROOM_SOCKET.face], axis: [0, 0, 1] }, o = { slack: 1.1, extra: 700, stiff: 0.4, n: 30 };
      const floor: Env = { planes: [{ n: [0, 1, 0], d: -geo.floor }, { n: [0, 0, 1], d: 40 }, { n: [0, -1, 0], d: -under }], solids: [] }, ground = floor.planes[0]!;
      const run = hangPts(from, { at: hole, dir: [0, 1, 0] }, cord, room, { slack: 1.1, extra: 500, stiff: 0.4, n: 30 });
      g.add(cableMesh(run, cord));
      // (a thin cord seen from afar is a pixel wide: an unseen sleeve three times as thick round it is what the pointer finds)
      const grab = cableMesh(run, { ...cord, r: cord.r * 3 });
      grab.material = mat(0, { transparent: true, opacity: 0, depthWrite: false });
      g.add(unseen(grab));
      this.addRig(g, {
        id, name: 'the wall socket', target: 'socket', look: cord, env: floor, fixed: [low], model: () => seatPlug(seat, swissPlug(swissReal(cord.r, hexNum(cord.base), ROOM_SOCKET.k))), seat, canSeat: true,
        engage: swissEngage(ROOM_SOCKET.k), seated: (ex) => [hangPts(low, ex[0]!, cord, floor, o)],
        deck: ground, n: o.n, stiff: o.stiff, lead: cord.r * 2.5,
        // (the power comes from the wall: out of the plug, up through the desk's hole and along the cord to its device)
        power: { out: true, beyond: [low.at, ...reversed(run)] },
      }, on(id));
      this.wires.add(g);
    };
    // (on the studio's wall the cord is one piece from its device to its plug in the outlet, a real Swiss type 12 plug in a real type 13 recess, turned as the
    // socket of the pinwheel it goes into: the power runs out of the plug)
    const wallMains = (id: string, from: RopeEnd) => {
      if (!has(id) || !w || !stage) return;
      const g = tag(new Group(), 'cable.' + id), at = w.plan.mains.outlet[id as 'pcmains' | 'monmains'], roll = w.plan.mains.turn[id as 'pcmains' | 'monmains'];
      if (!at) return;
      const seat: Seat = { at, axis: [0, 0, 1] }, o = { slack: 1.4, extra: 600, stiff: 0.4, n: 40 }, ground = stage.planes[0]!;
      this.addRig(g, {
        id, name: 'the wall socket', target: 'socket', look: cord, env: stage, fixed: [from], model: () => seatPlug(seat, swissPlug(swissReal(cord.r, hexNum(cord.base))), roll), seat, canSeat: true,
        engage: swissEngage(WALL_MM), seated: (ex) => [hangPts(from, ex[0]!, cord, stage, o)], deck: ground, n: o.n, stiff: o.stiff, lead: cord.r * 2.5, power: { out: true },
      }, on(id));
      this.wires.add(g);
    };
    if (has('lan') && (w || (netVisible(s) && this.inRoom))) {
      // the LAN lead: fixed at the router's port, its plug lies on the desk and goes into the network jack on the case's rear panel
      const g = tag(new Group(), 'cable.lan'), ly = ETH0_RECT.y + ETH0_RECT.h / 2, lz = BOARD_Z + 300, look: Look = { r: 40, base: LAN_LEAD, accent: null };
      // (its router end: a plug in the router's side jack, sunk in its mouth as in the board's, 20 behind the jack's face; the lead leaves its boot. On the studio's wall: the router's first LAN jack, in its front, a real plug in a real jack)
      const lan = routerLan();
      const fixed = w
        ? seatPlug({ at: [w.plan.router.lan[0], w.plan.router.lan[1], w.plan.router.lan[2] - JACK_SINK], axis: [0, 0, 1] }, rj45Plug(rj45Jack(WALL_MM, look.r, hexNum(LAN_LEAD))))
        : seatPlug({ at: [lan.x - 20, -lan.y, lan.z], axis: [1, 0, 0] }, rj45Plug(boardRj45(look.r, hexNum(LAN_LEAD))));
      g.add(fixed.root);
      const from: RopeEnd = fixed.strands[0]!;
      // (a card's jack is on its bracket, in the slot's opening: the plug goes into its mouth, nic3d's `mouthAt`)
      const nicAt = (d: { spec: string; slot: string }): V3 => {
        const p = nicJackAt((getSpec(d.spec) as { visual?: string } | undefined)?.visual ?? '', idx(d.slot));
        return [p.x - 2, -p.y, p.z];
      };
      // its ports: the board's jack, and each network card's (the 2D game's `eth0`, `eth1`...); the plug stands in the one the sim has it in
      const jacks = [...((BOARD_TIERS[s.boardTier]?.features.ethernetMbps ?? 0) > 0 && !s.board.burnt ? [{ port: 'board', at: [CASE.x, -ly, lz] as V3 }] : []), ...s.devices.filter((d) => d.kind === 'nic' && !d.burnt).map((d) => ({ port: d.id, at: nicAt(d) }))];
      // (no jack at all, a board without one and no card: the plug waits at the board's place, and nothing takes it)
      const now = (s.net?.port.kind === 'nic' && jacks.find((j) => j.port === s.net!.port.deviceId)) || jacks[0] || { port: 'board', at: [CASE.x, -ly, lz] as V3 };
      const seat: Seat = { at: now.at, axis: [-1, 0, 0] }, env: Env = stage ?? { planes: room.planes, solids: [caseBox] }, o = { slack: 1.1, extra: 600, stiff: 0.35, n: 30 };
      // (a card's jack is real, its latch slot up; the board's is cut to its rear I/O's smaller mouth, its latch notch down)
      const plug = (port: string) => () => (port === 'board' ? seatPlug(seat, rj45Plug(boardRj45(look.r, hexNum(LAN_LEAD)))) : seatPlug(seat, rj45Plug(rj45Real(look.r, hexNum(LAN_LEAD))), Math.PI));
      this.addRig(g, {
        id: 'lan', name: 'the network port', target: 'io', look, env, fixed: [from], model: plug(now.port), seat, canSeat: true, engage: 380,
        port: now.port, alts: jacks.filter((j) => j !== now).map((j) => ({ ...j, model: plug(j.port) })),
        seated: (ex) => [hangPts(from, ex[0]!, look, env, o)], deck, n: o.n, stiff: o.stiff, lead: look.r * 2.5,
      }, on('lan'));
      this.wires.add(g);
      yield;
    }
    // (the inlet is the power supply's: with no supply fitted there is nothing to hold the cord)
    const psu = s.devices.find((d) => d.kind === 'psu');
    if (psu) {
      // (the C13 plug sits in the supply's C14 inlet, `psu3d.ts`; the cord leaves its strain relief)
      const visual = (getSpec(psu.spec) as { visual?: string } | undefined)?.visual ?? 'psu-basic', inlet = mainsInlet(this.plan, visual);
      if (has('pcmains')) this.wires.add(mainsPlug(this.plan, visual));
      const from: RopeEnd = { at: [CASE.x - PLUG_TAIL, inlet[1], inlet[2]], dir: [-1, 0, 0] };
      if (w) wallMains('pcmains', from); else mains('pcmains', from, geo.socket.pc, 60);
      yield;
    }
    if (!w) mains('monmains', { at: seats.power.at, dir: seats.power.axis }, geo.socket.mon, -60);
    else if (w.monitor) wallMains('monmains', { at: w.monitor.at, dir: w.monitor.axis });
  }

  /** The key in the USB port (`id`), or none: only the key is built again. */
  private setKey(id: number | null) {
    if ((this.key?.id ?? null) === id) return;
    if (this.key) { this.wires.remove(this.key.g); disposeTree(this.key.g); this.key = null; }
    if (id === null) return;
    const g = tag(new Group(), 'key:' + id), y = USB_PORT.y + USB_PORT.h / 2, z = BOARD_Z + 600;
    g.add(rectBox({ x: USB_PORT.x - 760, y: y - 115, w: 560, h: 230 }, z - 60, z + 60, mat(0x2a2d32, { roughness: 0.45 })));
    g.add(rectBox({ x: USB_PORT.x - 200, y: y - 60, w: 200, h: 120 }, z - 40, z + 40, mat(0xb9babf, { metalness: 0.7, roughness: 0.3 })));
    this.wires.add(g);
    this.key = { id, g };
  }

  /** Keep a draggable cable's rig and add its cable as it stands (seated, or loose at its rest pose). `fade`: its card fades it while it is in. */
  private addRig(g: Group, rig: CableRig, seated: boolean, fade?: () => () => void) {
    this.rigs.set(rig.id, rig);
    this.built.set(rig.id, { g, seated, fade });
    this.placeRig(rig.id);
  }

  /** A draggable cable's rig (plughand3d.ts holds it live), or null. */
  rig(kind: string): CableRig | null { return this.rigs.get(kind) ?? null; }

  /** The group a cable's rig is built into (the hand hides its built cable while it holds it), or null. */
  cableGroup(kind: string): Object3D | null { return this.built.get(kind)?.g ?? null; }

  /** Keep these cables out of sight (they are built hidden too) until `letRun`: the stage runs them out of their hole once their part is in (`PlugHand.feed`). */
  holdBack(ids: Iterable<string>): void { for (const id of ids) { this.unrun.add(id); this.showRig(id); } }

  /** Show these cables again (as they stand). */
  letRun(ids: Iterable<string>): void { for (const id of ids) { this.unrun.delete(id); this.showRig(id); } }

  /** Is this cable kept out of sight (`holdBack`)? */
  isHeldBack(id: string): boolean { return this.unrun.has(id); }

  /** The case's front-panel leads this board has (`panelRigs`), west to east. */
  panelIds(): string[] { return [...this.rigs.keys()].filter(isPanelId); }

  /**
   * Bring the front-panel leads in line with the stage's say of which are out of their headers (`panelOut`, kept by reference): each stands as that says.
   * A lead built so already stays as it is (one the hand moved keeps its rest pose).
   */
  syncPanel(out: ReadonlySet<string>): void {
    this.panelOut = out;
    let changed = false;
    for (const [id, b] of this.built) if (isPanelId(id) && b.seated === out.has(id)) changed = this.placeRig(id, !out.has(id)) || changed;
    if (changed) this.partLod?.build(this.wires);
  }

  private showRig(id: string): void {
    const b = this.built.get(id);
    if (b) for (const c of b.g.children) if (c.userData.rig) c.visible = !this.unrun.has(id);
  }

  /** Build one draggable cable again as it stands (`seated`, default as it was; a dropped plug at its rest pose): the others stay as they are. */
  setCable(kind: string, seated?: boolean): void {
    // (the rig draws in the cables' stand-ins: they are made again with the new rig)
    if (this.placeRig(kind, seated)) this.partLod?.build(this.wires);
  }

  /** Put one draggable cable's rig in as it stands (`setCable`, less the stand-ins). False: no such cable. */
  private placeRig(kind: string, seated?: boolean): boolean {
    const rig = this.rigs.get(kind), b = this.built.get(kind);
    if (!rig || !b) return false;
    if (seated !== undefined) b.seated = seated;
    for (const c of [...b.g.children]) if (c.userData.rig) { b.g.remove(c); disposeTree(c); }
    const built = rigBuild(rig, b.seated, this.rest.get(kind));
    built.group.visible = !this.unrun.has(kind);
    b.g.add(built.group);
    // (the case's own lead is nothing to pick, and no run of the power lens: it carries no power)
    if (rig.inert) built.group.traverse(seeThrough);
    else {
      this.runs.set(kind, { id: kind, strands: inFlowOrder(built.strands, rig.power), r: rig.look.r, seated: built.seated, seat: rig.seat, held: false, fed: !!rig.power?.fed });
      this.runsRev++;
    }
    this.unfade.get(kind)?.();
    this.unfade.delete(kind);
    if (b.seated && b.fade) this.unfade.set(kind, b.fade());
    return true;
  }

  /** Build all the cables and the key again: the parts stay as they are. */
  setCables(s: Snapshot, geo: RoomGeo): void {
    if (this.noBoard) return;
    const run = this.cablesSteps(s, geo);
    while (!run.next().done) {}
  }

  /** `setCables`, with a `yield` after each cable's build (`assemble`: the page has its turn between them). */
  private *cablesSteps(s: Snapshot, geo: RoomGeo): Generator<void> {
    for (const u of this.unfade.values()) u();
    this.unfade.clear();
    this.built.clear();
    this.runs.clear();
    this.runsRev++;
    this.partLod?.drop(this.wires);
    disposeTree(this.wires);
    this.wires.clear();
    this.key = null;
    this.cableIds = standing(s).map((c) => c.id).join(',');
    this.videoKey = videoKey(s, this.wall);
    yield* this.buildCables(s, geo);
    // the still parts of each cable group (the lead's plugs, the cords' ends, the grommets) in a few draws; a draggable end is merged in `rigStatic`
    mergeSiblings(this.wires);
    this.partLod?.build(this.wires); // (the still parts of the new cables, their rigs too; the key stays out)
    this.setKey(s.plugged?.id ?? null);
  }

  /** Bring the cables in line with the sim: a plug in or out builds only its own cable, a key in or out only the key, a cable come or gone all. */
  syncCables(s: Snapshot, geo: RoomGeo): void {
    this.buildRouter(s); // (the router bought or replaced: its detailed view stands over it)
    if (this.noBoard) return; // (no board, no cable: the case's leads lie coiled on its tray)
    if (standing(s).map((c) => c.id).join(',') !== this.cableIds || videoKey(s, this.wall) !== this.videoKey) { this.setCables(s, geo); return; }
    for (const c of standing(s)) {
      const b = this.built.get(c.id);
      if (b && b.seated !== c.connected) this.setCable(c.id, c.connected);
    }
    this.setKey(s.plugged?.id ?? null);
  }

  // ------------------------------------------------------------------ patch
  /**
   * Bring the machine in line with a snapshot that differs from it by whole sticks, M.2 drives or cards (Build my PC: a fit or a removal builds no
   * new machine). A part that goes is hidden (the stand-ins of `partLod` know a part by its hiding) and its entries leave the shared lists; a part
   * that comes is built alone and merged alone, as the build does it; the sockets they take or free change their look; the cables hang again.
   * False, with nothing changed, when the change is more than that (another kind of part, a host's fans, a new board or case, a grave grown
   * too big): the caller builds the machine again.
   */
  patch(s: Snapshot, geo: RoomGeo): boolean {
    if (this.noBoard || this.tiers !== `${s.boardTier}|${s.caseTier}` || this.graveyard.length >= GRAVE_MAX) return false;
    const cur = new Map(this.devs.map((d) => [keyOf(d), d])), nxt = new Map(s.devices.map((d) => [keyOf(d), d]));
    const gone = [...cur].filter(([k]) => !nxt.has(k)).map(([, d]) => d), came = [...nxt].filter(([k]) => !cur.has(k)).map(([, d]) => d);
    // a fan on a heatsink is part of its host's model: the host is built again, with the fan or without it
    let hosts = false;
    for (const d of [...gone, ...came]) {
      const h = d.kind === 'fan' ? fanHost(d.slot) : null;
      if (h === null) continue;
      hosts = true;
      const was = this.devs.find((x) => x.slot === h), is = s.devices.find((x) => x.slot === h);
      if (was && !gone.includes(was)) gone.push(was);
      if (is && !came.includes(is)) came.push(is);
    }
    for (const d of [...gone, ...came]) if (!patchable(d)) return false;
    if (gone.some((d) => !this.owned.has(keyOf(d)))) return false;
    // ---- what goes
    const drop = <T>(list: T[], out: readonly T[]): void => { for (const x of out) { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); } };
    for (const d of gone) {
      const o = this.owned.get(keyOf(d))!;
      // (a hidden part answers to no id: a host built again keeps its id, and a lookup must find the new one, never the copy left here)
      for (const r of o.roots) { r.visible = false; untag(r); this.graveyard.push(r); }
      drop(this.reveals, o.reveals); drop(this.fades, o.fades); drop(this.apart, o.apart); drop(this.still, o.still); drop(this.fans, o.fans); drop(this.obstacles, o.obstacles);
      drop(this.keep, o.keep); drop(this.caseRoots, o.caseRoots); drop(this.rails, o.rails);
      for (const ob of o.obstacles) this.solids.delete(ob);
      this.skins.delete(o.id);
      this.powerSkins.delete(o.id);
      this.powerRoots.delete(o.id);
      if (d.kind === 'ram') this.ramSticks = this.ramSticks.filter((x) => x.idx !== idx(d.slot));
      this.cards.delete(d.slot);
      this.lan.delete(o.id);
      if (d.kind === 'cooler') { this.cooler = null; this.pump = false; }
      this.owned.delete(keyOf(d));
    }
    // (a part that stands as it was under a new id, a refit one: its look follows the new id)
    for (const [k, d] of nxt) {
      const o = this.owned.get(k);
      if (!o || o.id === d.id) continue;
      const sk = this.skins.get(o.id);
      if (sk) { this.skins.delete(o.id); this.skins.set(d.id, sk); }
      const ps = this.powerSkins.get(o.id);
      if (ps) { this.powerSkins.delete(o.id); this.powerSkins.set(d.id, ps); }
      const pr = this.powerRoots.get(o.id);
      if (pr) { this.powerRoots.delete(o.id); this.powerRoots.set(d.id, pr); }
      const lan = this.lan.get(o.id);
      if (lan) { this.lan.delete(o.id); this.lan.set(d.id, lan); }
      o.id = d.id;
    }
    this.ram = null;
    for (const x of this.ramSticks) { const r = { x: DIMM_X(x.idx), y: DIMM_Y(x.idx), w: DIMM_W, h: DIMM_H }; this.ram = this.ram ? union(this.ram, r) : r; }
    // ---- what comes
    this.devs = s.devices;
    this.rects = slotRects(s);
    const made = came.map((d) => this.build(d)!), added: Object3D[] = made.flatMap((o) => o.roots);
    for (const o of made) for (const ob of o.obstacles) {
      ob.updateWorldMatrix(true, true);
      const b = new Box3().setFromObject(ob);
      if (!b.isEmpty()) this.solids.set(ob, { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
    }
    if (gone.some((d) => d.kind === 'ram') || came.some((d) => d.kind === 'ram')) this.buildRamMap();
    for (const d of gone) this.fill(d.slot, false, added);
    for (const d of came) this.fill(d.slot, true, added);
    // (the free fan spots of the heatsinks: a host or a fan came or went)
    if (hosts || [...gone, ...came].some((d) => d.kind === 'cooler' || d.kind === 'vrm-sink' || d.kind === 'ram-sink')) {
      for (const [id, o] of this.picks) if (/\.fan\d+$/.test(id)) { o.removeFromParent(); o.traverse((x) => (x as Mesh).geometry?.dispose?.()); this.picks.delete(id); }
      this.hostFanPicks(s, new Set(s.devices.map((d) => d.slot)), this.pickBox);
    }
    // ---- the new pieces merge among themselves, as the build merges each part
    if (this.merged && added.length) {
      const holder = new Group(), skip = [...this.keep], apart = [...this.fades, ...this.apart];
      holder.add(...added);
      mergeSiblings(holder, { skip, apart, pbr: true });
      shareMaterials(holder, { skip, apart, across: lowDetail() });
      this.root.add(...holder.children);
    } else for (const o of added) if (o.parent !== this.root) this.root.add(o);
    this.setCables(s, geo);
    return true;
  }

  /** A socket takes a part or is freed: its latches, its drop box, its plate or its tag follow. New pieces go on `added`. */
  private fill(slot: string, filled: boolean, added: Object3D[]): void {
    const freeBox = (o: Object3D) => { o.removeFromParent(); o.traverse((x) => (x as Mesh).geometry?.dispose?.()); };
    if (slot === 'cpu0') {
      // the load lever is down on a CPU and lifted on a bare socket (as a memory socket's latches close on a stick and open without one)
      this.root.traverse((o) => { if (o.userData.leverOf === slot) o.rotation.y = filled ? 0 : LEVER_OPEN; });
      // the socket is merged into the board by now, so a bare one is picked by an unseen box over it; its gold contacts show
      const pick = this.picks.get(slot);
      if (filled && pick) { freeBox(pick); this.picks.delete(slot); }
      else if (!filled && !pick) this.pickBox(grow(PKG, SOCKET_E), BOARD_Z, BOARD_Z + 70, slot);
      if (filled && this.bare) { freeBox(this.bare); this.bare = null; }
      else if (!filled && !this.bare && this.contacts) { this.bare = this.contacts(); this.root.add(this.bare); }
      return;
    }
    if (/^(tpm|cooler|vrm-sink|ram-sink)\d+$/.test(slot)) {
      // the seat of a module, a cooler or a sink: an unseen box where it is bare (low: the cooler's seat is round the CPU socket, which wins the ray)
      const pick = this.picks.get(slot), r = this.rects.get(slot);
      if (filled && pick) { freeBox(pick); this.picks.delete(slot); }
      else if (!filled && !pick && r) this.pickBox(r, BOARD_Z, BOARD_Z + 40, slot);
      return;
    }
    const m = /^(dimm|m2|pcie)(\d+)$/.exec(slot);
    if (!m) return;
    const i = Number(m[2]), sock = this.sockets.get(slot), pick = this.picks.get(slot);
    if (sock) { if (filled) delete sock.userData.id; else tag(sock, slot); }
    if (m[1] === 'pcie') {
      const b = this.blanks.get(slot);
      if (filled && b) { freeBox(b); this.blanks.delete(slot); }
      else if (!filled && !b) { const n = slotBlank(nicY(i), this.blankTone); this.blanks.set(slot, n); this.root.add(n); added.push(n); }
      return;
    }
    if (m[1] === 'dimm') this.root.traverse((o) => { if (o.userData.dimm === slot) for (const p of o.children) p.rotation.x = ((p.userData.latchEnd as number | undefined) ?? 0) * (filled ? 0 : 0.5); });
    if (filled && pick) { freeBox(pick); this.picks.delete(slot); }
    else if (!filled && !pick) {
      if (m[1] === 'dimm') this.pickBox(GEO.dimm[i]!.rect, BOARD_Z, BOARD_Z + SLOT_H, slot);
      else this.pickBox(M2_SLOTS[i]!, BOARD_Z, BOARD_Z + 40, slot);
    }
  }

  // ------------------------------------------------------------------ live
  /**
   * `doorDt`: the side panel's own time, when it runs at another pace than the rest (Build my PC's steps at 2x: the panel keeps up with them). `net`: what the network gives
   * the jacks' lights this frame (`LinkLeds.step`): the PC end's go to the jack the cable is in, every other jack stays dark.
   */
  frame(s: Snapshot | null, dt: number, doorDt = dt, net: LinkLevels = DARK): void {
    const live = !!s && s.powered && !s.power.tripped && !s.board.burnt;
    const port = s?.net?.port, plugged = port?.kind === 'board' ? 'board' : port?.kind === 'nic' ? port.deviceId : null;
    for (const [id, j] of this.lan) lightJack(j, id === plugged ? net.pc : DARK.pc);
    this.ramMap?.update(s?.ram ?? null, performance.now());
    if (s) for (const d of s.devices) this.skins.get(d.id)?.set(stateOf(s, d));
    for (const sk of this.skins.values()) sk.frame(dt);
    for (const sk of this.powerSkins.values()) sk.frame(dt);
    const rgb = this.accent;
    const turning = new Map<string, number>();
    for (const f of this.fans) {
      const want = live && (!f.needs || !!s?.cables.some((c) => c.id === f.needs && c.connected)) ? 1 : 0;
      f.speed += (want - f.speed) * (1 - Math.pow(want ? 0.3 : 0.6, dt)); // spins up quicker than it coasts down
      const a = f.speed * 18 * dt;
      f.rotor.rotation.z -= a;
      if (f.ring) { if (f.fixed === undefined) f.ring.emissive.copy(rgb); else f.ring.emissive.setHex(f.fixed); f.ring.emissiveIntensity = (f.gain ?? (f.fixed === undefined ? 1.6 : 2.0)) * f.speed * this.ringK; }
      const bank = f.needs ? this.bankOf(f.needs) : null;
      if (bank) turning.set(bank, Math.max(turning.get(bank) ?? 0, f.speed));
    }
    // the speeds the airflow lens blows by: the air moves as fast as the fans on the screen turn
    for (const [bank, v] of turning) fanBank.setLevel(bank, v);
    this.rgb.color.copy(rgb);
    this.rgb.intensity = live && this.caseRgb ? 0.9 : 0;
    this.spill.color.copy(rgb);
    this.spill.intensity = this.rgb.intensity * 0.3;
    this.stripMode = stripModeOf(s);
    if (this.strip) stripLight(this.strip, this.stripMode, performance.now());
    if (this.door) this.swingDoor(doorDt);
    this.blink = live && s.storage.some((d) => d.busy);
    if (this.leds) {
      this.leds.on.emissiveIntensity = live ? 1.5 : 0;
      this.leds.err.emissiveIntensity = s?.phase === 'error' || s?.power.tripped ? 1.5 : 0;
      this.leds.disk.emissiveIntensity = this.blink && performance.now() % 240 < 150 ? 1.6 : 0;
    }
  }

  /** The id a fan's speed goes by in `fanBank` (docs/render/air.md), from the cable it runs on, as the plan of the air names its banks. */
  private bankOf(needs: string): string | null {
    if (needs === 'cpufan') return 'cooler';
    if (needs === 'vrmfan') return 'vrm';
    if (needs === 'ramfan') return 'ramvrm';
    const id = needs.startsWith('fan:') ? needs.slice(4) : '';
    return id && fanMounts().some((m) => m.id === id) ? `${this.rad?.span.ids.includes(id) ? 'radiator' : 'case'}:${id}` : null;
  }

  private stripMode: StripMode = 'off';
  private blink = false;

  /**
   * Something of the machine moves after the last `frame`: a fan turns or coasts, the side panel swings, the strip pulses or blinks, the disk LED
   * flickers, a part eases to its state's look. A frame drawn on demand (docs/render/load.md) keeps drawing meanwhile.
   */
  get moving(): boolean {
    if (this.fans.some((f) => f.speed > 1e-3)) return true;
    const d = this.door;
    if (d && d.t !== (this.doorOpen ? 1 : 0)) return true;
    if (this.strip && (this.stripMode === 'work' || this.stripMode === 'error')) return true;
    if (this.blink && this.leds) return true;
    for (const sk of this.skins.values()) if (sk.easing) return true;
    for (const sk of this.powerSkins.values()) if (sk.easing) return true;
    return false;
  }

  /**
   * Level of detail, per frame after the camera moved: each reveal gets the zoom seen at its point (screen pixels per unit there, less toward the
   * edge of the view: `seenZoom`, so the bands are the 2D ones), then each surface asks for the texture tiles it needs.
   */
  lod(cam: PerspectiveCamera, H: number, dpr: number): void {
    const now = performance.now();
    frustumOf(cam, this.frustum);
    cam.getWorldDirection(LOD_DIR);
    // the board view's zoom on this screen (`boardView` in board3d.ts: the inside of the case, fitted at 0.95)
    if (this.door) this.door.board = (H * 0.95) / Math.max(CASE_IN.h, CASE_IN.w / cam.aspect);
    for (const r of this.reveals) {
      const at = r.area ? nearestOn(r.area, r.at.z, cam.position, LOD_DIR) : r.at;
      const p = LOD_AT.copy(at).project(cam), focus = r.anywhere ? 1 : p.z > 1 ? 0 : Math.max(0, 1 - Math.hypot(p.x, p.y) / 1.2);
      r.apply(seenZoom(screenPx(cam.position.distanceTo(at), cam.fov, H), focus));
    }
    // the small parts as stand-ins from afar (after the reveals: a stand-in follows what they show and hide), by the zoom at the case's nearest point
    // Low: the case's shadow on the spot lights (`caseshade.ts`); the glass side lets the light in, the top filter a part of it
    if (lowDetail()) setCaseShade(this.shadeBox, this.root.matrixWorld, CASE_PASS);
    this.partLod?.update(screenPx(LOD_BOX.copy(this.caseBox).applyMatrix4(this.root.matrixWorld).distanceToPoint(cam.position), cam.fov, H));
    this.art.update(cam, this.frustum, H, dpr, now);
  }

  /**
   * The yaw the camera adds to read what stands at the view's target (layout x, y) at this zoom: the stick faces stand edge-on to the glass, so
   * over the RAM bank, in the RAM band, the camera leans to see them in a row. 0 elsewhere.
   */
  lean(x: number, y: number, zoom: number): number {
    const r = this.ram && grow(this.ram, 260);
    if (!r || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return 0;
    return RAM_LEAN * smooth(RAM_IN[0], RAM_IN[1], zoom);
  }

  /** Open the case's outer side whatever the zoom (a part or a cable is dragged, a tutorial target is inside), or let the zoom decide again. */
  setOpen(inside: boolean, busy = false): void {
    const d = this.door;
    if (!d) return;
    // (a panel a job held open stays open when the job lets go, as if the zoom had opened it: it shuts when the zoom falls under its band)
    if (d.inside && !inside && this.doorOpen) { d.manual = null; d.zoomOpen = true; }
    d.inside = inside;
    d.busy = busy;
  }

  /** Shut the side panel now, whatever held it open (the zoom decides again at its next crossing). */
  closeDoor(): void { const d = this.door; if (d) { d.inside = false; d.manual = false; } }

  /** The side panel as `from` (the machine this one replaces) had it: how far open, and what holds it, so a new build does not swing it again. */
  takeDoor(from: Machine3D): void {
    const a = from.door, b = this.door;
    if (!a || !b) return;
    b.t = a.t; b.zoom = a.zoom; b.board = a.board; b.zoomOpen = a.zoomOpen; b.manual = a.manual; b.inside = a.inside; b.busy = a.busy;
    this.swingDoor(0);
  }

  /** Open the side panel if it is shut (or opening), shut it if it is open: the player's say holds until the zoom crosses its band again. */
  toggleDoor(): void { const d = this.door; if (d) d.manual = !(d.manual ?? (d.zoomOpen || d.inside)); }

  /** Is the side panel open (or opening)? */
  get doorOpen(): boolean { const d = this.door; return !!d && (d.inside || (d.manual ?? d.zoomOpen)); }

  /** How far the side panel has really swung (0 shut, 1 open), as drawn: null when the case has no panel. A step waits for this, not for a clock (`BuildStage.door`). */
  get doorT(): number | null { return this.door ? this.door.t : null; }

  /**
   * Move the side panel toward open or shut at its kind's pace and set its pose (`doorPose`). The zoom opens it from the board view in and shuts
   * it again past a dead band under that, and a new crossing forgets the player's last click. Rays reach the plate that opens it only while it is shut.
   */
  private swingDoor(dt: number) {
    const d = this.door!, cm = d.cm, open = d.zoom > DOOR_ZOOM[1] * d.board, shut = d.zoom < DOOR_ZOOM[0] * d.board;
    if ((open && !d.zoomOpen) || (shut && d.zoomOpen)) { d.zoomOpen = open; d.manual = null; }
    // (at rest it stays: a step back and forth would jiggle it every frame)
    d.t = stepDoor(d.t, this.doorOpen ? 1 : 0, dt, DOOR_SECONDS[d.kind]);
    const p = doorPose(d.kind, d.t);
    cm.door.position.set(cm.px - p.slide, 0, FRONT + p.out);
    cm.door.rotation.y = p.swing;
    for (const sc of cm.screws) { sc.position.x = CASE.x - 24 - p.screws * 80; sc.rotation.x = p.screws * Math.PI * 8; }
    cm.hit.raycast = d.t < 0.01 && !d.busy ? HIT : NO_HIT;
  }

  /** Take it down: the meshes, the texture tiles, the bake jobs and the 2D art behind them. */
  dispose(): void {
    this.art.dispose();
    this.ramMap?.dispose();
    this.partLod?.dispose();
    disposeTree(this.root);
  }
}

/** What a card's detailed view flies to (`Chips3D` runs it): the GPU's body, the AI card's die, a little grown (the GPU's memory magnifier stands by its cell). */
function chipRect(kind: 'gpu' | 'npu', visual: string, i: number): RectLike {
  const o = cardOrigin(i, visual);
  return kind === 'gpu' ? grow(moveRect(gpuPlan(visual).body, o), 40) : grow(moveRect(npuGeo(visual).die, o), 30);
}

const LOD_AT = new Vector3(), LOD_DIR = new Vector3(), NEAREST = new Vector3(), LOD_BOX = new Box3();

/** Where the view's centre line meets the plane at depth `z`, held inside the layout rect `r`. */
function nearestOn(r: RectLike, z: number, eye: Vector3, dir: Vector3): Vector3 {
  const t = Math.abs(dir.z) > 1e-6 ? (z - eye.z) / dir.z : 0, x = eye.x + dir.x * t, y = eye.y + dir.y * t;
  return NEAREST.set(Math.max(r.x, Math.min(r.x + r.w, x)), Math.max(-(r.y + r.h), Math.min(-r.y, y)), z);
}
