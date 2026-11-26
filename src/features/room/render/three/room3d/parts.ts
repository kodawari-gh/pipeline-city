// The room's parts: every mesh, light and setting the room keeps, which its builders fill (`buildRoom`) and its frame sets (`frameRoom`).
// `Room3D` is this with its public methods.
import { Group, PointLight, RectAreaLight, SpotLight } from 'three';
import { roomGeo } from '../../shell/room';
import { arcLamp, sconce } from '../furniture/lamps';
import { shelfStrips } from '../furniture/strips';
import { pictureLight } from '../furniture/walls';
import { LANTERN, NEON_WASH, kelvin } from '../palette';
import { chooseLights } from '../roomlights';
import { DESK_D } from '../roomplan';
import { KEY_DECAY, PRINT } from './consts';
import type {
  Bake,
  BoxEnv,
  CanvasTexture,
  CityDetail,
  Cup,
  DigitalClock,
  JackLamps,
  Lamp,
  Lantern,
  LightmapMix,
  LinkLevels,
  Material,
  Mesh,
  MeshStandardMaterial,
  Monitor,
  Object3D,
  OutsideView,
  RoomEnv,
  RoomGeo,
  Screen,
} from './types';

/** A step of `Room3D.make`: what comes next, and how far along the build is (0 to 1). */
export interface RoomStep {
  label: string;
  share: number;
}

export interface RoomFrame {
  hour: number;
  lamp: boolean;
  blind: boolean;
  screen: Screen;
  /** The tier of the router on its spot (1 to 4), or 0 for none. */
  router: number;
  /** The ISP plan's tier (0 to 5), and whether an upload waits or goes out (the letterbox's light). */
  isp: number;
  ispName: string;
  mail: boolean;
  t: number;
  /** The lights of the router's jacks, from the link's frames (`network/render/jackleds.ts`): the side jack the lead's cord goes into, and the WAN jack. All out when missing. */
  net?: LinkLevels | undefined;
}

/** A letter on its way to the key stand: the key's group, the envelope and its flap, their materials, the key's place, when it set out. */
export interface Arrival {
  g: Group;
  env: Group;
  flap: Mesh;
  mats: MeshStandardMaterial[];
  rest: { x: number; y: number };
  t0: number;
}

/** The room's parts (`Room3D`'s fields): the builders and the frame read and set them, so they are not private. */
export class RoomParts {
  readonly root = new Group();
  readonly geo: RoomGeo;
  keys = new Group();
  /** The mouse: its stand-in shell hides once the model loads, so the palette merge leaves it alone. */
  mouse!: Group;
  sun = new SpotLight(0xff_f0_d8, 0, 0, 0.17, 0.35, 0);
  /** The sky's light through the window: a wide soft spot out behind it, so the wall's shadow lets it in by the opening only. */
  key = new SpotLight(0xd4_e2_ff, 0, 0, 1.05, 0.9, KEY_DECAY);
  /** The window's light at the desk from the sky and from the lit city, and the sun's that comes in (the bake's levels: `mixLight`). */
  skyK = 0;
  cityK = 0;
  sunK = 0;
  hour = 12;
  /** The baked bounce once its files are in, and the light it was last summed for. */
  lightmap: LightmapMix | null = null;
  bake: Bake | null = null;
  mixKey = '';
  gone = false;
  lampLight = new SpotLight(kelvin(3000), 0, 0, 0.6, 0.7, 2);
  bedLight = new PointLight(LANTERN, 0, 0, 2);
  /** The screen's glow on the keyboard and the desk: an area light on its face, lighting only what is in front of it. */
  screenLight = new RectAreaLight(0xa8_cf_ff, 0, 1, 1);
  outside!: OutsideView;
  /** The detail of the city in the window (`setCityDetail`). */
  cityDetail: CityDetail = 'high';
  window!: Group;
  blinds: Mesh[] = [];
  blindK = 0;
  sunKey = -1;
  keysKey = '';
  lamp!: Lamp;
  monitor!: Monitor;
  monitorSpot!: Mesh;
  routerBody!: Group;
  routerTier = 0;
  /** The router's shell, which the zoom fades away to show the board inside it (`setRouterShell`), how much of it is left, and the shell's meshes that cast a shadow while it is whole. */
  routerShell: Group | null = null;
  routerAlpha = 1;
  shellCasters: Object3D[] = [];
  /** The shell's lit materials and how bright each is whole: a light dims with its shell (an emissive light does not follow the opacity far: it would float, bright, over a clear shell). */
  shellGlows: { m: MeshStandardMaterial; i: number }[] = [];
  /** The lights of the router's two jacks that carry a cable: the side jack (the lead's cord) and the WAN jack (the line). Built with the router, lit by `frame`. */
  routerLamps: { lan: JackLamps; wan: JackLamps | null } | null = null;
  readonly ispDots: MeshStandardMaterial[] = [];
  mailLed!: MeshStandardMaterial;
  ispText: { cv: HTMLCanvasElement; tex: CanvasTexture; shown: string } | null = null;
  routerBuild!: (tier: number) => void;
  routerSpot!: Mesh;
  clock!: DigitalClock;
  cup!: Cup;
  shade!: MeshStandardMaterial;
  bulbGlow!: MeshStandardMaterial;
  /** The tall paper lantern by the bookcase, and its bulb's light (it comes on at dusk). */
  floorLamp!: Lantern;
  floorLight = new PointLight(LANTERN, 0, 0, 2);
  /** The warm strips under the bookcase's boards and the east shelf (`shelfStrips`): their lines and their lights. */
  strips = shelfStrips();
  /** The picture light over the print and the sconce by the door (they come on as night falls). */
  picture = pictureLight(PRINT, 0);
  sconce = sconce();
  /** The arc lamp over the desk east of the case: an overhead cozy light (on at every hour: `ARC_LM`). */
  arc = arcLamp();
  /** The bed's LED strips, and the area lights they stand for (the floor round the bed, the wall over the headboard). */
  ledGlow!: MeshStandardMaterial;
  ledUnder!: RectAreaLight;
  ledHalo!: RectAreaLight;
  /** The LED strip under the desk's front edge, the same light. */
  deskLed = new RectAreaLight(NEON_WASH, 0, 1, 1);
  /** The room's materials that take the environment's reflections: the studio's, dimmed at night, until the probe has the room's own. */
  envs!: RoomEnv;
  /** What a Low merge tells the reflections' register of a palette material (the register exists once the room is built). */
  readonly envTwin = (src: Material, copy: Material): void => {
    (this.envs as RoomEnv | undefined)?.twin(src, copy);
  };
  probe = false;
  /** The room's box for the probe's reflections (boxenv.ts): on once the probe holds the room. */
  box!: BoxEnv;
  /** Where the room's probe sees from (world): over the desk's front, in the room's middle height. */
  readonly probeAt: [number, number, number];
  /**
   * Resolves once the bake's lightmap is on the meshes (or there is none): it changes their programs, so they are linked after it
   * (`docs/render/load.md`). The bake's files load once a page. Set when the room is built (`assemble`).
   */
  ready!: Promise<void>;
  /** What the room's light depends on, coarsely: a new value asks for a new capture of the probe. */
  lightKey = '';
  /** The graphics settings' shadow level and choice of lights, as last set. */
  shadowLevel = 3;
  choice = chooseLights(0, true);
  /** The shadow scan's turn: the next light to ask, and when one last asked (`redrawShadows`). */
  shadowTurn = 0;
  shadowAt = 0;

  /** The keys that have been on the rack (a key not in it is new mail), and the new ones still arriving: a letter drifts in, opens, the key rises out and is carried to its hook (the 2D's `mail.ts` poses). */
  known: Set<number> | null = null;
  arrivals: Arrival[] = [];

  constructor() {
    const g = roomGeo();
    this.geo = g;
    this.probeAt = [(g.desk.x0 + g.desk.x1) / 2, -g.ys + 3500, DESK_D + 5000];
  }
}
