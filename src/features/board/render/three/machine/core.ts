// The first half of the machine's parts (machine3d.ts): its root and lights, the parts' lists and skins, the sockets and the pick boxes, the
// bank and the router's detailed view, the cards and the bays. `MachineParts` (state.ts) is this with the rest.
import { Color, Frustum, Group, PointLight } from 'three';
import { builtinTheme } from '@/core/render/theme';
import { basementPlan } from '../basement3d';
import { baseCagePlan, cagePlan } from '../drivecage3d';
import { emptyLists } from '../parts';
import type {
  ArtBaker,
  ArtSurface,
  Card3D,
  Fan,
  FanMount,
  JackLamps,
  Lists,
  MeshStandardMaterial,
  Object3D,
  PartBuild,
  PartSkin,
  PickBox,
  RadiatorAt,
  Rail,
  RamMap3D,
  RectLike,
  Reveal,
  RouterBoard,
  Spin,
} from './types';

/** The router's detailed view in the room (`routerBits`). */
export interface RouterBits {
  tier: number;
  board: RouterBoard;
  art: ArtBaker;
  surface: ArtSurface | null;
  reveals: Reveal[];
  rails: Rail[];
}

const noPick: PickBox = () => {
  // (no board yet: there is no socket to pick)
};

/** The machine's parts, the first half: the builders and the frame read and set them. */
export class MachineCore {
  readonly root = new Group();
  skins = new Map<string, PartSkin>();
  /** The sockets' rects by slot id (a model is fitted to its part's). */
  rects = new Map<string, RectLike>();
  readonly fans: Fan[] = [];
  rgb = new PointLight(0x8b_5c_ff, 0, 9000, 0);
  /**
   * The RGB's light out through the glass, on the desk and the wall beside the case. No work light: the board reads by the room's lamps and
   * this RGB alone, at every zoom (`src/features/room/light.md`).
   */
  spill = new PointLight(0x8b_5c_ff, 0, 18_000, 0);
  leds: { on: MeshStandardMaterial; err: MeshStandardMaterial; disk: MeshStandardMaterial } | null = null;
  /** The two lights of each Ethernet jack the machine has, by port (`board`, or a network card's device id): the network's, set every frame (`frame`'s `net`). */
  lan = new Map<string, JackLamps>();
  /** The RGB's one colour: the case's accent (`caseModel`), so the fans, the strips and the light out through the glass match its trim. */
  accent = new Color(0x8b_5c_ff);
  /** The art is always the dark theme's: the reference's black board under neon. */
  readonly T = builtinTheme();
  /** What changes with the camera: a point and what to do with the zoom seen there (`seenZoom`, the 2D bands' unit). */
  readonly reveals: Reveal[] = [];
  /**
   * By `spec@slot`: what each part added (`buildPart`), the only per-part state. The lists, the skins, the cards, the bank and the cooler are
   * computed from these and the machine's own pieces (`relist`); a patch drops a part's entry.
   */
  readonly parts = new Map<string, PartBuild>();
  /** The machine's own pieces in the lists (the case, the board): before the parts. */
  readonly head: Lists = emptyLists();
  /** The board's Ethernet jack's lamps, if it has one. */
  boardLan: JackLamps | null = null;
  /** The loop's hoses' skins (the airflow lens). */
  hoseSkins: [string, PartSkin][] = [];
  /** Each spin's live entry (its speed), made once. */
  readonly fanOf = new WeakMap<Spin, Fan>();
  /** Parts a patch took away: hidden, not freed (the stand-ins of `partLod` know them by their hiding), freed with the machine. */
  readonly graveyard: Object3D[] = [];
  /** The unseen box of each empty socket (a drop lands on it), and the plate over each empty PCIe slot, by socket id. */
  readonly picks = new Map<string, Object3D>();
  readonly blanks = new Map<string, Object3D>();
  /** The board's sockets by id (tagged while empty: a pick or a drop finds the socket). */
  sockets = new Map<string, Object3D>();
  pickBox: PickBox = noPick;
  /** The bare CPU socket's gold contacts (made by the board model, added while no CPU stands on the socket). */
  contacts: (() => Group) | null = null;
  bare: Group | null = null;
  blankTone = 0;
  /** The memory map's reveal and rail, made again when the bank changes. */
  ramBits: { reveal: Reveal; rail: Rail } | null = null;
  /** The router's detailed view in the room (`buildRouter`): its board, the die's art, its reveals and its rails, made again when a router of another tier stands. */
  routerBits: RouterBits | null = null;
  /** Hears how much of the router's shell is left (1 whole, 0 gone) as the zoom takes it away to show the board (`Room3D.setRouterShell`). */
  onRouterShell: ((alpha: number) => void) | null = null;
  /** Has the build's merge run (`share`)? A router's board made after it merges itself. */
  shared = false;
  /** `tier|caseTier`: a patch keeps the board and the case, so these must be the same. */
  tiers = '';
  merged = true;
  frustum = new Frustum();
  /** The radiator bolted on a side of the case (it takes that side's fan mounts) and the loop's tubes run to. */
  rad: (RadiatorAt & { span: FanMount & { ids: string[] } }) | null = null;
  /** The installed sticks' bank: the memory map's reveal and its flight (a double click) are read over it. */
  ram: RectLike | null = null;
  /** The sticks (slot, size, the faces of their four data chips) and the live memory map painted on those faces. */
  ramSticks: ConstructorParameters<typeof RamMap3D>[0] = [];
  ramMap: RamMap3D | null = null;
  /** The cards by slot: their power leads plug into the top edge and fade with the cooler. */
  cards = new Map<string, Card3D>();
  /** The basement under the shroud, the power supply's (`basementPlan`); the main drive cage over it and the basement's under it, their trays one a bay (`cagePlan`, `baseCagePlan`). */
  readonly plan = basementPlan();
  readonly cage = cagePlan();
  readonly cages = [baseCagePlan(), this.cage];
}
