import { Container, Graphics } from 'pixi.js';
import type { Snapshot } from '../../../worker/protocol';
import type { KeyActivity } from '../../../worker/game/game';
import type { Theme } from '../theme';
import { TierBudget } from '../lod/lod';
import { RamView, GpuView, DiskView, TpmView, NpuCardView, FrameView, ScreenView, BusFlow } from './features';
import { fillPanelFan, makeBadge, makeNoSignal, makePsuTexts, makeScreenText, placePsuTexts } from './texts';
import type {
  Bus,
  BusKind,
  CableKind,
  Chain,
  ChipLeg,
  DriveLive,
  FanLive,
  FrameHold,
  FrameModel,
  Glow,
  Lane,
  LegHit,
  Lit,
  LitCable,
  LodRect,
  MonitorInput,
  PsuTexts,
  Rect,
  Renderer,
  Sprite,
  Text,
  Texture,
} from './types';

/**
 * Everything the live layer holds between snapshots and frames (see `docs/render/live.md`). `Live` owns one; the modules of this
 * folder read and write it: `scene.ts` builds it, `update.ts` fills it from each snapshot, `frame.ts` animates it.
 */
export class LiveState {
  /** Interior art on top of the board (buses, cable glow, PSU readout, drives, OS badge). Hidden with the interior at far zoom. */
  readonly root = new Container();
  /** External things that stay at any zoom: the monitor screen content, the USB port LED, the monitor LED, the video cable glow. */
  readonly ext = new Container();
  readonly extG = new Graphics();
  /** Packets on the board's data buses (in `root`) and on the video cable outside the case (in `ext`), and the video cable's lit stretch. */
  readonly busFlow: BusFlow;
  readonly extFlow: BusFlow;
  /** The message buses of the board (the first of each kind), the chains that stream right now (re-armed by every snapshot) and when each may send again. */
  readonly flowBuses = new Map<BusKind, Bus>();
  readonly streams = new Map<string, Chain>();
  readonly chainAt = new Map<string, number>();
  /** The pings of a POST in progress, sent one per `PROBE_MS` in turn by `frame` (empty outside POST). */
  probes: Chain[] = [];
  /** The slots with a part in them and whether a real key is in the USB port, for the CPU's accesses to device windows (`touchDevice`). */
  installed = new Set<string>();
  tpmFitted = false;
  keyIn = false;
  /** The video cable's PC end is on the board's HDMI port (not on a card). */
  boardVideo = true;
  /** The last snapshot, and the drive that last moved data (the disk interrupt comes from it). */
  snap: Snapshot | null = null;
  lastDrive: string | null = null;
  /** Game time until which a message is on a path that crosses the chipset (it glows for that long). */
  pchUntil = -1e9;
  /** The legs of the chipset that packets reach or leave, with the game time each flashes at; and the leg each lane lands on (found once). */
  pchHits: LegHit[] = [];
  readonly legOf = new WeakMap<Lane, ChipLeg | null>();
  /** What the last snapshot showed, to tell a change from a state: power, the CPU's clock and throttle, the boot progress. */
  wasPowered: boolean | null = null;
  lastClock = 0;
  lastThrottle = 1;
  lastProgress = 0;
  videoLane: Lane | null = null;
  videoW = 10;
  /** The machine moves no data now (off, tripped, dead, halted, error, cold-boot wait): no new packet starts. */
  quiet = true;
  interior = true;
  pchDrawn = false;
  /** The VRM's power-good light, steady (vrmG: the phases do not glow and a crash does not flash); the dead-board dimming and scorch (deadG). */
  readonly vrmG = new Graphics();
  readonly deadG = new Graphics();
  vrm: Snapshot['board']['vrm'] | null = null;
  dead = false;
  deadDrawn = false;
  /** The colour the power-good light was drawn in ('' for dark; null: draw it again). A steady light is redrawn only when this changes. */
  pgoodDrawn: string | null = null;
  readonly glows = new Map<string, Glow>();
  fans: FanLive[] = [];
  dots: Sprite[] = [];
  readonly dotTex: Texture;
  readonly lit = new Map<BusKind, Lit>();
  /** The memory bus is one bundle per DIMM: each lights only when the CPU talks to that stick (key: the slot number). */
  readonly memLit = new Map<number, Lit>();
  gt = 0;
  cables: LitCable[] = [];
  readonly badge: Text;
  readonly screenText: Text;
  readonly gauge = new Graphics();
  readonly psuTexts: PsuTexts;
  readonly panelFan = new Container();
  readonly dramFlash = new Graphics();
  /** The memory sticks as a map of RAM: what each byte holds, whose it is, and what the CPU touches (docs/DIE.md "Memory"). */
  readonly ram = new RamView();
  /** The graphics cards: spinning fans and the lanes, registers and banks under the shroud (board/gpuview.ts). */
  readonly gpu = new GpuView();
  /** The drives' insides: capacity map, architecture, counters (board/diskview.ts). */
  readonly disk = new DiskView();
  /** The secure module: its lid fades into the die at zoom, and commands run along the die's wires (board/tpmview.ts). */
  readonly tpm = new TpmView();
  /** The AI cards: their lid fades into the die at zoom, and descriptors run along the die's wires (board/npuview.ts). */
  readonly npu = new NpuCardView();
  dimmIdx: number[] = [];
  phase = 0;
  lastText = '';
  cpuHeat = 0;
  clockRatio = 1;
  shownText = '\u0000';
  zoom = 0.1;
  view: LodRect | null = null;
  readonly detail = new TierBudget(2);
  hasPsu = false;
  psuTemp = 25;
  psuRatio = 0;
  psuOff = true;
  psuTripped = false;
  psuW = 0;
  psuBudget = 0;
  connected = new Set<CableKind>();
  plugged = false;
  bootPhase: Snapshot['phase'] = 'off';
  bootProgress = 0;
  monitorLive = false;
  monitorPowered = true;
  powered = false;
  /** Machine switched on AND the power path is healthy (PSU not tripped, board not dead): fans spin, lights glow, buses move data. */
  liveOn = false;
  hasDisplay = false;
  /** The installed display is the graphics display (`display1`): its screen shows the dashboard, and what a GPU draws. */
  gfxDisplay = false;
  /** The graphics display's dashboard, and what it remembers between snapshots (IPC samples, when each program was first seen running). */
  readonly dash = new ScreenView();
  dashIpc: number[] = [];
  dashPrev: Record<string, number> | null = null;
  readonly dashStarted = new Map<number, number>();
  /** What a GPU draws, when the graphics display's cable is on the card, and how long it stays up (`holdFrame`). */
  readonly frameV = new FrameView();
  frameHold: FrameHold = { seq: 0, at: -Infinity };
  frameOn = false;
  /** The card's picture for this snapshot (null when the frame is not up), shown by `updateDash`. */
  frameM: FrameModel | null = null;
  /** PCH, USB LED, monitor LED and boot bar: redrawn every frame while something is active. */
  readonly bootG = new Graphics();
  readonly noSignal: Text;
  /** The blank screen's look (`standbyLook`): dim glass with the brand's mark, and `STANDBY` while the machine is off. */
  readonly standby = new Container();
  standbyCap: Text | null = null;
  blank: MonitorInput | null = null;
  pchLevel = 0;
  /** The theme of the current scene (set by `setScene` before any update or frame). */
  T!: Theme;
  /** Drives (activity, platter, LEDs) and their SATA cable pulses, keyed by slot id. */
  readonly drives = new Map<string, DriveLive>();
  /** 0..1: how lit the case's disk activity LED is (read by board.ts every frame). */
  diskLevel = 0;
  keyActivity: KeyActivity = 'none';
  readonly osRows: Text[] = [];
  /** The monitor screen's contents (text, OS screen), in design units; scaled and placed in `setScene`. */
  readonly scr = new Container();
  readonly badgeG = new Graphics();
  badgeText: Text | null = null;
  badgeRect: Rect | null = null;
  badgePhase: Snapshot['phase'] | 'off' = 'off';
  readonly osG = new Graphics();
  osSig = '';
  osOn = false;
  /** The row of the running job on the OS screen (the progress cue sits under it). */
  osBarRow = 3;
  osJob: 'none' | 'run' | 'ingest' | 'flash' = 'none';
  osUpTick: number | null = null;

  constructor(renderer: Renderer) {
    this.busFlow = new BusFlow();
    this.extFlow = new BusFlow();
    const dg = new Graphics().setFillStyle({ color: '#ffffff' }).circle(0, 0, 16).fill();
    this.dotTex = renderer.generateTexture(dg);
    dg.destroy();
    this.badge = makeBadge();
    this.screenText = makeScreenText();
    this.noSignal = makeNoSignal();
    this.psuTexts = makePsuTexts();
    fillPanelFan(this.panelFan);
    placePsuTexts(this.psuTexts, this.panelFan);
  }
}
