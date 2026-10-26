import { Application, Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import { effect } from '@preact/signals';
import { hover, viewInset, type Inset } from '../game/hover';
import { cameraRev, dragging, highlight } from '../game/interaction';
import { snapshot, speed } from '../game/store';
import { BOARD_TIERS, getSpec, type CoolerSpec, type CpuSpec, type PsuSpec, type RamSpec } from '../sim/board/specs';
import type { StorageSnap } from '../sim/game/game';
import type { Snapshot } from '../sim/protocol';
import { buildBoard, type BoardArt } from './boardArt';
import { Camera, type FlyOpts, type View } from './camera';
import { EdgeFan, bayArt, caseBack, caseGlass, cpuFanCableArt, emptyCellHint, sinkFanCableArt, fanTrunkArt, frontFanRects, sataCablePath, sataLinkArt, sataPowerArt } from './case';
import { driveArt, driveBody, driveKindOf, osBadgeRect, slotIndex, slotRect, type DriveKind } from './drives';
import { cableArt, coolerArt, cpuArt, looseCableArt, monitorArt, plugRect, psuArt, ramArt, SCREEN_BG, vrmSinkArt, type Part } from './devices';
import { Interact, type CableInfo, type SceneInfo } from './interact';
import { NetView, nicArt } from './net';
import { drawStrip, exteriorArt, exteriorFrame, stripModeOf } from './exterior';
import { box, clear, dashed, label } from './ink';
import {
  BAY, BD, BLOCKS, boardBakeFrame, BR, CASE, OUTBOX, CASE_IN, CASE_PANEL, COOLER, DIE, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, HDMI_PORT, MONITOR, PCIE_RAILS, PKG, PSU, PSU_PANEL,
  LAYOUT_CASE, LAYOUT_TIER, OVERVIEW_MARGIN, RAM_SINK, WALL_PLATE, REAR_FAN, REAR_FAN_FITTED, REGIONS, SCREEN, STAGES, TOP_FANS, TRAY, USB_PORT, VRM_SINK, WORLD, dimmFlip, nicJack, nicRect, setLayoutTier, type Rect,
} from './layout';
import { buildLetter, carryAx, keyPose, letterPose, mailOutStage, mailStage, MAIL_OUT_S, MAIL_S, outboxSlot, POSTING_FROM, outKeyPose, outLetterPose, setLetter, swayAngle, swayStep, type Letter, type SwayState } from './mail';
import { drawKeyCue, drawPowerLeds, pluggedKeyArt, powerArt, trayArt, trayHook, urgencyOf, type PowerState, type PropObj, type PropsArt, type TrayMode } from './props';
import { buildCables, laneRects, looseCable, movablePlug, type CableKind } from './routes';
import { Live, type DriveHook, type GlowTarget } from './live';
import { PipelineView } from './pipeline';
import { RoomView, roomBox, roomDebug, roomState, type RoomHit } from './room';
import { focusAt } from './light';
import { captureShape } from './capture';
import { lazyShape, movedShape, pick, rectShape, unionRect, type Shape } from './shape';
import { onThemeChange, readTheme, type Theme } from './theme';
import { initThumbs } from './thumbs';

interface Hit { id: string; rect: Rect; /** Extra rects (thin cable segments) that also hit. */ more?: Rect[]; /** Only hit when the zoom is within [min, max]. */ min?: number; max?: number; /** Only hit while this holds. */ cond?: () => boolean; /** Only hit while the exterior case covers the interior. */ extOnly?: boolean;
  /** The silhouette (the lamp, a key, the power button): the pointer picks what is drawn, not the box round it. */ shape?: Shape;
  /** A backdrop (the board, the case): it answers only where nothing else is, near or on. */ base?: boolean;
  /** False: the hover ring is not traced along the silhouette (a cable's ring stays on its plug, the part that is grabbed). */ ring?: false }

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Zoom above which the die is the thing being looked at (cooler faded, chips shown). */
const Z_DIE = 0.45;
/** Below this zoom the baked board texture replaces the vector board. */
const Z_BAKE = 0.2;
const BAKE_RES = 0.4;
/** Below this zoom the static devices, PSU, monitor and cables are one baked texture too. */
const Z_BAKE_DEV = 0.14;
const DEV_BAKE_RES = 0.25;
/** Below this zoom the tray and power plate chrome (boxes, labels) is one baked texture. */
const Z_BAKE_PROPS = 0.2;
const propsFrame = () => new Rectangle(TRAY.x - 100, TRAY.y - 100, TRAY.w + 200, TRAY.h + 200);

/**
 * Level of detail on the camera scale, as multiples of the fit zoom (the zoom of the default overview, `fits.z`).
 * At or above `LOD.fadeFrom` the interior shows as always; between `fadeFrom` and `fadeTo` the exterior case crossfades in over it;
 * at or below `fadeTo` only the exterior (and the always-external things) is drawn and updated. The zoom-out is capped by the room
 * (`capZoom`), never short of `fadeTo`. Tune `fadeFrom` and `fadeTo`.
 */
export const LOD = { fadeFrom: 0.92, fadeTo: 0.8 };
/** The overview shows the machine with some of the room around it: the fit margin (the machine alone would fill the screen at 0.96). */
const ROOM_MARGIN = 0.84;
/** Ids that stay hit targets (and never force the interior open) at any zoom. Everything else is interior. */
const isExternalId = (id: string) => id === 'power' || id === 'usb' || id === 'monitor' || id === 'tray' || id === 'case'
  || id === 'cable.video' || id.startsWith('key:') || id.startsWith('display')
  // the network props are external: the router, the wall plate, the ethernet cable and the jacks on the rear plate
  || id === 'router' || id === 'wall' || id === 'cable.lan' || /^eth\d+$/.test(id)
  // the room's props (the lamp and the blind) answer a click at any zoom
  || id === 'lamp' || id === 'blind';

/** The routed cables of the current board tier (geometry only): rebuilt with the scene. */
let ALL_CABLES = buildCables();

/** The matching board connector for each cable (drop target); follows the tier. */
const connectorOf = (k: CableKind): Rect => (k === 'atx' ? BR.atx : k === 'cpu' ? BR.cpw : k === 'pcie' ? BR.pciew : HDMI_PORT);

/** View used by the camera keys and exported helpers. */
let cameraRef: Camera | null = null;
let interactRef: Interact | null = null;
/** 0..1 how much the exterior case covers the interior (set by applyLod). Interior ids are hidden above 0.5, as in hit testing. */
let exteriorCover = 0;
export function flyToCpu() { cameraRef?.flyTo(cameraRef.fit({ x: DIE.x - 40, y: DIE.y - 40, w: DIE.w + 80, h: DIE.h + 80 }, 0.9)); }
/** The overview: the whole scene fitted to the free area (`WORLD`, `OVERVIEW_MARGIN`). */
/** What the overview frames: the machine and the monitor (`WORLD`), down to the foot of the wall plate under the desk (it shows the internet plan and is where the cable goes), which the HUD's bottom pills would otherwise cover. */
const overviewRect = (): Rect => ({ x: WORLD.x, y: WORLD.y, w: WORLD.w, h: Math.max(WORLD.h, WALL_PLATE.y + WALL_PLATE.h + 200 - WORLD.y) });
const overviewFit = (c: Camera): View => c.clampView(c.fit(overviewRect(), c.w < 600 ? 0.95 : Math.min(OVERVIEW_MARGIN, ROOM_MARGIN)));
/** How far the camera may zoom out: where the room box (`roomBox`: the desk, a little wall beyond it, from just above the clock to just under the desk) fills the free area, but never short of the full exterior view (`LOD.fadeTo` of the overview), so a wide or tall screen still gets there (the wall and the desk run on past the box). */
const capZoom = (c: Camera, overview: View): number => {
  const aw = Math.max(50, c.w - c.inset.left - c.inset.right), ah = Math.max(50, c.h - c.inset.top - c.inset.bottom), box = c.bounds ?? roomBox();
  return Math.min(overview.z * LOD.fadeTo, Math.max(aw / box.w, ah / box.h));
};
export function flyToBoard() { if (cameraRef) cameraRef.flyTo(overviewFit(cameraRef)); }
/** Screen rectangle of a world object, for popups and tutorial pointers (see `anchorOf`). */
export interface Anchor { x: number; y: number; w: number; h: number; visible: boolean }
/**
 * Live screen rectangle of a world id (any id in the RENDER.md table: slot ids, device ids, `psu`, `monitor`, `case`,
 * `bay`, `power`, `usb`, `tray`, `held`, `os`, `vrm`, `key:<id>`, `cable.*`, `chipset`, `board`). Client px (relative to
 * the viewport, canvas offset included). The stage is in CSS px (autoDensity), so no device-pixel-ratio factor is needed.
 * Same rects as hit testing. `visible` is false when the rect does not meet the free area (the canvas minus `viewInset`),
 * or when the far-zoom exterior hides it (an interior id at far zoom). Returns null for unknown ids and inventory ids.
 * Recompute when `cameraRev` (src/game/interaction.ts) changes.
 */
export function anchorOf(id: string): Anchor | null {
  if (!interactRef || !cameraRef) return null;
  const r = interactRef.rectsFor(id)[0];
  if (!r) return null;
  const s = cameraRef.screenRect(r), f = cameraRef.freeRect();
  const hidden = exteriorCover > 0.5 && !isExternalId(id);
  const onScreen = s.x < f.x + f.w && s.x + s.w > f.x && s.y < f.y + f.h && s.y + s.h > f.y;
  return { x: s.x, y: s.y, w: s.w, h: s.h, visible: !hidden && onScreen };
}
/**
 * Start dragging an inventory part from a DOM pointerdown that happened outside the canvas (the inventory menu).
 * Ghost, pulsing targets, install on drop, snap back with a message on failure. Escape or a release outside the canvas cancels.
 */
export function beginPartDrag(inventoryId: string, event: PointerEvent): void { interactRef?.beginPartDrag(inventoryId, event); }
/**
 * Fly the camera to a world object by id (any id listed in docs/RENDER.md: slot ids, device ids, 'key:<id>',
 * 'tray', 'usb', 'power', 'monitor', 'psu', 'chipset', 'board', 'cable.atx|cpu|video'). Unknown ids do nothing.
 * Returns whether the id was found (synchronously; `opts.onDone(false)` is then called too). Defaults and the
 * `onDone` contract are in docs/RENDER.md ("Flights"). A press, wheel, pinch or another flight cancels it.
 */
export function flyTo(id: string, opts: FlyOpts = {}): boolean {
  if (!interactRef || !interactRef.rectsFor(id).length) { opts.onDone?.(false); return false; }
  interactRef.flyToId(id, opts);
  return true;
}
/** Does the world currently have an object with this id (so `flyTo` / `highlight` can find it)? */
export function hasTarget(id: string): boolean { return !!interactRef && interactRef.rectsFor(id).length > 0; }

export async function mountBoard(host: HTMLElement) {
  let T: Theme = readTheme();
  const app = new Application();
  await app.init({
    resizeTo: host, background: T.bg, antialias: true, autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  host.appendChild(app.canvas);
  initThumbs(app.renderer);

  // ---- scene graph ----
  const world = new Container();
  /** The bedroom behind everything: wall, window, desk and what is on it (docs/RENDER.md "The room"). */
  const roomLayer = new Container();
  /** What stands in front of the video cable: the mug and its steam (the room's `over`). */
  const roomOverLayer = new Container();
  /** The room's light: above the monitor, the props and the case's shell, below the mail and the highlights. */
  const lightLayer = new Container();
  let screenOn = false;
  let roomView: RoomView | null = null;
  let roomHits: Hit[] = [];
  const caseLayer = new Container();
  const sataLayer = new Container();
  const driveLayer = new Container();
  const glassLayer = new Container();
  const boardLayer = new Container();
  const deviceLayer = new Container();
  const coolerLayer = new Container();
  const deviceBakeLayer = new Container();
  const fanLayer = new Container();
  /** Internal cables (ATX, CPU, ...), inside the interior group; the video cable runs outside the case and has its own layer. */
  const cableLayer = new Container();
  const cableExtLayer = new Container();
  /** Router, wall plate, ethernet cable, jack LEDs and traffic pulses: external, drawn at every zoom. */
  const net = new NetView();
  net.silhouette = (art, rect) => liveShape(art, rect);
  /** The monitor (external: stays at any zoom) and the far-zoom exterior case. */
  const monitorLayer = new Container();
  const interior = new Container();
  const exteriorLayer = new Container();
  const stripG = new Graphics();
  let exteriorSprite: Sprite | null = null;
  let extDrives: { slot: string }[] = [];
  let monitorCached = false;
  const propsLayer = new Container();
  const chromeLayer = new Container();
  const chromeBakeLayer = new Container();
  let chromeBake: Sprite | null = null;
  /** Hover-animated props: vector art close up, one small baked sprite far out. */
  let propBakes: { vec: Container; cached: boolean }[] = [];
  const pipeline = new PipelineView();
  const live = new Live(app.renderer, T.dark);
  const camera = new Camera(world, app.canvas);
  cameraRef = camera;
  const interact = new Interact(camera, app.canvas, (rs, opts) => {
    // A steady "medium" view: a window of fixed size around the target (bigger when the target itself is bigger), moved back
    // inside the world, so every guided flight shows a part in its surroundings at about the same zoom and never a half-empty screen.
    const bx0 = Math.min(...rs.map((r) => r.x)), by0 = Math.min(...rs.map((r) => r.y));
    const bx1 = Math.max(...rs.map((r) => r.x + r.w)), by1 = Math.max(...rs.map((r) => r.y + r.h));
    const aw = Math.max(50, camera.w - camera.inset.left - camera.inset.right), ah = Math.max(50, camera.h - camera.inset.top - camera.inset.bottom);
    let cw = Math.max(9500, bx1 - bx0 + 2200), ch = cw * ah / aw;
    if (ch < by1 - by0 + 1800) { ch = by1 - by0 + 1800; cw = ch * aw / ah; }
    cw = Math.min(cw, WORLD.w); ch = Math.min(ch, WORLD.h);
    const cx = Math.min(Math.max((bx0 + bx1) / 2, WORLD.x + cw / 2), WORLD.x + WORLD.w - cw / 2);
    const cy = Math.min(Math.max((by0 + by1) / 2, WORLD.y + ch / 2), WORLD.y + WORLD.h - ch / 2);
    const v = camera.fit({ x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch }, 1);
    const z = opts.zoom ?? Math.max(v.z, overviewFit(camera).z);
    camera.flyTo({ x: v.x, y: v.y, z }, opts.smooth === false ? 0 : 1400, opts.onDone, !!opts.hold);
  });
  interactRef = interact;
  interact.setTheme(T);
  interior.addChild(caseLayer, boardLayer, deviceLayer, deviceBakeLayer, sataLayer, driveLayer, fanLayer, cableLayer, glassLayer, coolerLayer, pipeline.root, live.root);
  exteriorLayer.addChild(stripG);
  const keyFx = new Container(); // a key sliding out of the port after its removal (outlives the props rebuild)
  let mailSlow = 1; // dev only: window.__board.mailSlow(0.1) plays the arrivals in slow motion
  const outLedG = new Graphics();
  const mailBack = new Container(), mailMid = new Container(), mailFront = new Container(); // the letters: the inside of the envelope under the keys, a finished key on its way into one, its pocket and flap over them
  world.addChild(roomLayer, interior, exteriorLayer, monitorLayer, cableExtLayer, roomOverLayer, net.root, chromeBakeLayer, chromeLayer, mailBack, mailMid, propsLayer, lightLayer, mailFront, outLedG, keyFx, live.ext, interact.fx);
  app.stage.addChild(world, interact.hud);

  let boardArt: BoardArt | null = null;
  /** Far-out LOD: the whole static board baked once into a texture (rebuilt only with the scene). */
  let boardBake: Sprite | null = null;
  let deviceBake: Sprite | null = null;
  /** The case chassis (vector close up, one baked texture far out) and drive slide-in animations. */
  let caseVec: Container | null = null;
  let caseBake: Sprite | null = null;
  let builtOnce = false;
  /** True once the first scene exists (the camera is framed then). */
  let sceneReady = false;
  let atOverviewNow = () => false;
  const driveSlotsSeen = new Set<string>();
  const slotKind = new Map<string, DriveKind>();
  /** The OS badge on the host drive (id 'os'); its rect follows the snapshot, so the hit entry reads it live. */
  let osRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const applyBadge = (s: Snapshot | null) => {
    const slot = s?.os?.slot, kind = slot ? slotKind.get(slot) : undefined;
    if (!s?.os || !slot || !kind || !s.storage.some((d) => d.slot === slot)) {
      scene.rects.delete('os'); scene.interactive.delete('os'); live.setOsBadge(null, 'off');
    } else {
      osRect = osBadgeRect(kind, slot);
      scene.rects.set('os', osRect); scene.interactive.add('os');
      live.setOsBadge(osRect, s.phase);
    }
    const bk = JSON.stringify(scene.rects.get('os') ?? null);
    if (bk !== badgeKey) { badgeKey = bk; sceneDirty = true; }
  };
  const slides: { node: Container; t0: number }[] = [];
  // A key slides into the USB port when it is plugged and out of it (fading) when it is removed, slowly enough to be seen.
  const KEY_MS = 1500, KEY_TRAVEL = 560;
  const keyAnims: { node: Container; baseX: number; t0: number; dir: 1 | -1 }[] = [];
  let keyPlugged: Snapshot['plugged'] = null, keyInId = -1, keyInAt = 0, keySeen = false;
  // ---- the rack: a new key arrives in a letter and is hung on its hook, a key that shifts to another hook glides there, and every hanging key sways ----
  interface Mail { id: number; t: number; letter: Letter | null }
  const mails: Mail[] = [];
  /** A finished key leaving in a letter: the ghost of the key that was in the port, and the envelope it goes into. */
  interface MailOut { t: number; letter: Letter | null; ghost: Container; node: Container; from: { x: number; y: number }; clip: Graphics[] }
  const outs: MailOut[] = [];
  let outLed = 0; // the letterbox's lamp, lit for a moment when a letter has gone in
  const sway = new Map<number, SwayState>();
  const glides = new Map<number, { fx: number; fy: number; t: number }>();
  const knownKeys = new Set<number>();
  let knownInit = false, lastBaseTick = -1, lastTray: number[] = [], lastRest = new Map<number, { x: number; y: number }>(), trayOn = false;
  const swayOf = (id: number) => { let st = sway.get(id); if (!st) { st = { a: 0, w: 0, ph: (id * 2.399963) % (2 * Math.PI) }; sway.set(id, st); } return st; };
  const propObjs = () => propsArt.flatMap((a) => a.objs);
  /** Nudge the keys hanging near (x, y): away from it, harder the closer they are. */
  const nudgeNear = (x: number, y: number, amp: number, skip = -1) => {
    for (const o of propObjs()) {
      if (!o.swing) continue;
      const id = Number(o.id.slice(4));
      if (id === skip) continue;
      const dx = o.base.x - x, d = Math.hypot(dx, o.base.y - y);
      if (d < 1300) swayOf(id).w += (dx >= 0 ? 1 : -1) * amp * (1 - d / 1300);
    }
  };
  const dropMail = (m: Mail) => { m.letter?.back.destroy({ children: true }); m.letter?.front.destroy({ children: true }); const i = mails.indexOf(m); if (i >= 0) mails.splice(i, 1); };
  /** The silhouette of a prop: plain geometry (`shape`), or its art read once (`sil`, one reading for every key of a kind), placed on the prop. Nothing is read until the pointer comes near. */
  const silhouettes = new Map<string, Shape>();
  const propShape = (o: PropObj): Shape | undefined => {
    if (o.shape) return o.shape;
    const sil = o.sil;
    if (!sil) return undefined;
    const bx = o.base.x, by = o.base.y, local: Rect = { x: o.rect.x - bx, y: o.rect.y - by, w: o.rect.w, h: o.rect.h };
    return lazyShape(o.rect, () => {
      let s = silhouettes.get(sil.key);
      if (!s) {
        const art = sil.make();
        s = captureShape(app.renderer, art, local) ?? rectShape(local);
        art.destroy({ children: true });
        silhouettes.set(sil.key, s);
      }
      return movedShape(s, bx, by);
    });
  };
  /**
   * The silhouette of a piece of live art (a part, a drive, the monitor, a cable), read from its own pixels the first time the pointer comes near. The art is read in its
   * own space (the position it has now is taken off the rect), a little beyond the rect so a bracket or a fin that sticks out is part of it; `threshold` is the alpha that
   * counts (a cable's soft shadow is under it).
   */
  const liveShape = (art: Container, rect: Rect, threshold = 90): Shape => {
    const ox = art.position.x, oy = art.position.y, m = 40;
    const local: Rect = { x: rect.x - ox - m, y: rect.y - oy - m, w: rect.w + 2 * m, h: rect.h + 2 * m };
    return lazyShape(rect, () => { const s = captureShape(app.renderer, art, local, { threshold }); return s ? (ox || oy ? movedShape(s, ox, oy) : s) : rectShape(rect); });
  };
  /** A hit for a piece of art: its rect, and its silhouette read from the art itself (`extra`: the zoom range, the ring, and so on). Every part, drive, monitor and cable registers through this. */
  const partHit = (id: string, art: Container, rect: Rect, extra: Partial<Hit> = {}): Hit => ({ id, rect, shape: liveShape(art, rect), ...extra });
  const rebuildPropHits = () => {
    const hide = new Set(mails.map((m) => 'key:' + m.id));
    propHits = [
      ...propObjs().filter((o) => !hide.has(o.id)).map((o) => ({ id: o.id, rect: o.rect, shape: propShape(o) })),
      { id: 'usb', rect: { x: USB_PORT.x - 20, y: USB_PORT.y - 20, w: USB_PORT.w + 40, h: USB_PORT.h + 40 } },
      ...(trayOn ? [{ id: 'tray', rect: TRAY }] : []),
    ];
    mergeHits();
  };
  const parts: Part[] = [];
  let mainHits: Hit[] = [];
  let cableHits: Hit[] = [];
  let propHits: Hit[] = [];
  let allHits: Hit[] = [];
  const scene: SceneInfo = interact.scene;
  let sceneKey = '';
  let cableKey = '';
  let propsKey = '';
  /** Anchors: set when the layout changed (build, cables, props, OS badge); the frame loop turns it into one cameraRev bump. */
  let sceneDirty = true;
  let badgeKey = '';
  let lastViewKey = '';
  let lastSnap: Snapshot | null = null;
  /** Game clock (ms): drives fans, bus pulses, LED blinks, chip tweens and every other sim-driven animation. */
  let gt = 0;
  const timeScale = () => { const sp = speed.peek(); return sp <= 0 ? 0 : sp >= 16 ? 3 : sp >= 4 ? 2 : 1; };
  let fits: View = { x: 0, y: 0, z: 0.15 };
  let held: CableKind | null = null;
  let propsArt: PropsArt[] = [];
  let powerArtRef: PropsArt | null = null;
  let powerState: PowerState = { powered: false, down: false, error: false, blocked: false };
  let netHits: Hit[] = [];
  const mergeHits = () => {
    allHits = [...propHits, ...netHits, ...cableHits, ...mainHits, ...roomHits];
    scene.shapes.clear();
    for (const h of allHits) if (h.shape && h.ring !== false && !scene.shapes.has(h.id)) scene.shapes.set(h.id, h.shape);
    warmShapes();
  };
  // The silhouettes are read from the art the first time the pointer comes near (`lazyShape`, a few milliseconds each); so that the first hover never hitches, they are
  // read one at a time in the idle moments after the hits change, and not while a gesture is running.
  const warmed = new WeakSet<Shape>();
  let warmTimer = 0;
  const warmShapes = () => {
    clearTimeout(warmTimer);
    const todo = allHits.filter((h) => h.shape && !warmed.has(h.shape));
    const step = () => {
      if (interact.busy) { warmTimer = window.setTimeout(step, 400); return; }
      const h = todo.shift();
      if (!h) return;
      warmed.add(h.shape!);
      const b = h.shape!.bounds;
      h.shape!.dist(b.x + b.w / 2, b.y + b.h / 2); // inside the box: it builds
      warmTimer = window.setTimeout(step, 90);
    };
    warmTimer = window.setTimeout(step, 600);
  };

  // ---- LOD driven by zoom ----
  /** 0..1: how much the exterior case covers the interior (zoom crossfade, pulled back to 0 while a drag or a highlight needs the inside). */
  let extA = 0;
  /** 0..1: the interior is being revealed regardless of zoom (dragging a part or cable, highlighting an internal id). */
  let reveal = 0;
  const applyLod = () => {
    const f = fits.z > 0 ? fits.z : 0.1;
    extA = smooth(LOD.fadeFrom, LOD.fadeTo, camera.z / f) * (1 - reveal);
    exteriorCover = extA;
    exteriorLayer.alpha = extA;
    exteriorLayer.visible = extA > 0.004;
    interior.visible = extA < 0.996;
    live.setInterior(interior.visible);
    // the monitor is one cached texture far out
    const want = camera.z < Z_BAKE_DEV;
    if (want !== monitorCached) { monitorCached = want; monitorLayer.cacheAsTexture(want ? { resolution: 0.4, antialias: true } : false); }
  };
  // the room bakes its static art far out, and is not drawn at all while the view lies inside the case
  const syncRoom = () => {
    const z = camera.z, left = camera.x - camera.cx / z, top = camera.y - camera.cy / z;
    const view = { x: left, y: top, w: camera.w / z, h: camera.h / z };
    roomView?.setView(view, z, app.renderer.resolution, interior.visible && extA < 0.004 ? CASE : null);
    roomView?.setFocus(focusAt(view, CASE));
  };
  const onZoom = () => {
    const z = camera.z;
    applyLod();
    syncRoom();
    const labelsOn = z > 0.12, partLabels = z > 0.22;
    if (boardArt) boardArt.labels.visible = labelsOn;
    const baked = !!boardBake && z < Z_BAKE;
    if (boardBake) boardBake.visible = baked;
    if (boardArt) boardArt.root.visible = !baked;
    const dbaked = !!deviceBake && z < Z_BAKE_DEV;
    if (caseBake) caseBake.visible = dbaked;
    if (caseVec) caseVec.visible = !dbaked;
    if (deviceBake) deviceBake.visible = dbaked;
    deviceLayer.visible = !dbaked;
    for (const p of parts) if (p.labels) p.labels.visible = partLabels;
    coolerLayer.alpha = 1 - smooth(0.3, 0.5, z);
    coolerLayer.visible = coolerLayer.alpha > 0.01;
    pipeline.root.alpha = smooth(0.42, 0.58, z);
    pipeline.root.visible = pipeline.root.alpha > 0.01;
    for (const pb of propBakes) {
      const want = z < Z_BAKE_PROPS;
      if (want !== pb.cached) { pb.cached = want; pb.vec.cacheAsTexture(want ? { resolution: 0.5, antialias: true } : false); }
    }
    chromeLayer.visible = !chromeBake || z >= Z_BAKE_PROPS;
    chromeBakeLayer.visible = !!chromeBake && z < Z_BAKE_PROPS;
    live.setZoom(z);
  };
  camera.onChange = onZoom;

  const slotRectOf = (id: string): Rect | null => {
    const type = id.replace(/\d+$/, ''), idx = Number(/\d+$/.exec(id)?.[0] ?? 0);
    switch (type) {
      case 'cpu': return PKG;
      case 'dimm': return { x: DIMM_X(idx), y: DIMM_Y(idx), w: DIMM_W, h: DIMM_H };
      case 'cooler': return COOLER;
      case 'display': return MONITOR;
      case 'atx': case 'atx-plus': return PSU;
      case 'pcie': { const r = PCIE_RAILS[idx]; return r ? { x: r.x, y: r.y - 20, w: r.w, h: r.h + 40 } : null; }
      case 'vrm-sink': return VRM_SINK;
      case 'ram-sink': return RAM_SINK;
      default: return null;
    }
  };

  // ---- scene build: runs on theme change, board tier change, or an install/uninstall ----
  const keyOf = (s: Snapshot | null) =>
    `${T.dark}|${s?.boardTier ?? 0}|${s?.caseTier ?? 0}|${s ? s.devices.map((d) => `${d.spec}@${d.slot}`).join(',') : ''}`;

  function build(s: Snapshot | null) {
    boardBake?.texture.destroy(true); deviceBake?.texture.destroy(true); caseBake?.texture.destroy(true);
    boardBake = null; deviceBake = null; caseBake = null; caseVec = null;
    clear(caseLayer); clear(sataLayer); clear(driveLayer); clear(glassLayer); slides.length = 0;
    clear(boardLayer); clear(deviceLayer); clear(coolerLayer); clear(deviceBakeLayer); clear(fanLayer);
    monitorLayer.cacheAsTexture(false); monitorCached = false; clear(monitorLayer);
    exteriorSprite?.texture.destroy(true); exteriorSprite?.destroy(); exteriorSprite = null;
    parts.length = 0;
    const tier = s?.boardTier ?? 0;
    // a new board tier is a new case, a new world: remember whether the player was looking at the whole scene, to follow it
    const caseTier = Math.max(tier, s?.caseTier ?? tier);
    const tierChanged = sceneReady && (tier !== LAYOUT_TIER || caseTier !== LAYOUT_CASE), wasOverview = tierChanged && atOverviewNow();
    setLayoutTier(tier, caseTier);
    // the room follows the case (the desk top is where its feet stand) and the theme
    net.behind.parent?.removeChild(net.behind); // (it survives the room it was in: the ISP lead runs behind the desk, so it lives in the room's back layer)
    clear(roomLayer);
    roomView?.dispose();
    roomView = new RoomView(T, undefined, app.renderer);
    roomView.setScreen(screenOn);
    roomLayer.addChild(roomView.root);
    clear(lightLayer); lightLayer.addChild(roomView.light);
    clear(roomOverLayer); roomOverLayer.addChild(roomView.over);
    roomView.behind.addChild(net.behind);
    camera.bounds = roomBox(roomView.geo);
    ALL_CABLES = buildCables();
    boardArt = buildBoard(T, tier);
    boardLayer.addChild(boardArt.root);
    boardArt.labels.visible = false;
    const bf = boardBakeFrame(BD, BR.io), frame = new Rectangle(bf.x, bf.y, bf.w, bf.h); // the board and its rear I/O plate
    const tex = app.renderer.generateTexture({ target: boardArt.root, frame, resolution: BAKE_RES, antialias: true });
    boardBake = new Sprite(tex);
    boardBake.position.set(frame.x, frame.y);
    boardLayer.addChild(boardBake);

    // the case: chassis behind the board (baked far out), glass over it
    caseVec = caseBack(T);
    caseLayer.addChild(caseVec);
    const cf = new Rectangle(CASE.x - 80, CASE.y - 60, CASE.w + 160, CASE.h + 220);
    caseBake = new Sprite(app.renderer.generateTexture({ target: caseVec, frame: cf, resolution: 0.2, antialias: true }));
    caseBake.position.set(cf.x, cf.y);
    caseLayer.addChild(caseBake);
    glassLayer.addChild(caseGlass(T));

    const targets: GlowTarget[] = [];
    const storageDevs: { id: string; spec: string; slot: string }[] = [];
    const fans: { c: Container; kind: string }[] = [];
    // the case's own fans (front, rear, top): the blades and light strips are live, the frames are in the baked case
    for (const r of [...frontFanRects(), ...(REAR_FAN_FITTED ? [REAR_FAN] : []), ...TOP_FANS]) { const f = new EdgeFan(r, T); fans.push({ c: f, kind: 'case' }); fanLayer.addChild(f); }
    let dram: Rect[] = [];
    const slots = BOARD_TIERS[tier]?.slots ?? {};
    const filled = new Set<string>();
    const dieHits: Hit[] = [...STAGES, ...BLOCKS].map((t) => ({ id: 'cpu.' + t.id, rect: t, min: Z_DIE }));
    let coolerHit: Hit | null = null;
    const deviceHits: Hit[] = [];
    let hasPsu = false, hasDisplay = false;
    const dimms: number[] = [];
    scene.rects.clear(); scene.interactive.clear(); scene.slots.clear();
    roomHits = roomView.hits.map((h: RoomHit) => ({ id: h.id, rect: h.rect, shape: h.shape }));
    for (const h of roomView.hits) { scene.rects.set(h.id, h.rect); scene.interactive.add(h.id); }

    for (const d of s?.devices ?? []) {
      const spec = getSpec(d.spec);
      if (!spec) continue;
      filled.add(d.slot);
      scene.interactive.add(d.id);
      if (spec.kind === 'cpu') {
        const p = cpuArt(T, spec as CpuSpec);
        deviceLayer.addChild(p.root); parts.push(p);
        targets.push({ id: d.id, kind: 'cpu', spec: d.spec, rect: { x: PKG.x - 46, y: PKG.y - 46, w: PKG.w + 92, h: PKG.h + 92 } });
        // the package (the CPU) is hit everywhere; the cooler sits over it and is hit first below the die zoom (coolerHit), so
        // the exposed package ring picks the CPU and the cooler body picks the cooler
        deviceHits.push(partHit(d.id, p.root, PKG));
        scene.rects.set(d.id, PKG);
      } else if (spec.kind === 'ram') {
        const idx = Number(/\d+$/.exec(d.slot)?.[0] ?? 0);
        const p = ramArt(T, spec as RamSpec, dimmFlip(idx));
        p.root.position.set(DIMM_X(idx), DIMM_Y(idx));
        deviceLayer.addChild(p.root); parts.push(p);
        const r = { x: DIMM_X(idx), y: DIMM_Y(idx), w: DIMM_W, h: DIMM_H };
        dimms.push(idx);
        targets.push({ id: d.id, kind: 'ram', spec: d.spec, rect: r });
        deviceHits.push(partHit(d.id, p.root, r));
        scene.rects.set(d.id, r);
        dram = dram.concat((p.chips ?? []).map((c) => ({ x: c.x + r.x, y: c.y + r.y, w: c.w, h: c.h })));
      } else if (spec.kind === 'psu') {
        const p = psuArt(T, spec as PsuSpec);
        deviceLayer.addChild(p.root); parts.push(p);
        if (p.fan) { fans.push({ c: p.fan, kind: 'psu' }); fanLayer.addChild(p.fan); }
        if (p.over) fanLayer.addChild(p.over);
        deviceHits.push(partHit('psu', p.root, PSU));
        scene.rects.set(d.id, PSU); scene.rects.set('psu', PSU);
        scene.interactive.add('psu');
        hasPsu = true;
      } else if (spec.kind === 'cooler') {
        const p = coolerArt(T, spec as CoolerSpec);
        coolerLayer.addChild(p.root); parts.push(p);
        if (p.fan) fans.push({ c: p.fan, kind: 'cooler' });
        sataLayer.addChild(cpuFanCableArt(T)); // its fan cable to the CPU_FAN header
        coolerHit = partHit(d.id, p.root, COOLER, { max: Z_DIE });
        scene.rects.set(d.id, COOLER);
      } else if (spec.kind === 'vrm-sink') {
        const p = vrmSinkArt(T, spec.visual);
        deviceLayer.addChild(p.root); parts.push(p);
        if (p.fan) { fans.push({ c: p.fan, kind: 'vrm' }); fanLayer.addChild(p.fan); sataLayer.addChild(sinkFanCableArt(T, 'vrm')); }
        if (p.over) fanLayer.addChild(p.over);
        deviceHits.push(partHit(d.id, p.root, VRM_SINK));
        scene.rects.set(d.id, VRM_SINK);
      } else if (spec.kind === 'ram-sink') {
        const p = vrmSinkArt(T, spec.visual, RAM_SINK);
        deviceLayer.addChild(p.root); parts.push(p);
        if (p.fan) { fans.push({ c: p.fan, kind: 'ramvrm' }); fanLayer.addChild(p.fan); sataLayer.addChild(sinkFanCableArt(T, 'ram')); }
        if (p.over) fanLayer.addChild(p.over);
        deviceHits.push(partHit(d.id, p.root, RAM_SINK));
        scene.rects.set(d.id, RAM_SINK);
      } else if (spec.kind === 'nic') {
        const idx = Number(/\d+$/.exec(d.slot)?.[0] ?? 0);
        const p = nicArt(T, spec.visual, idx);
        deviceLayer.addChild(p);
        const r = nicRect(idx, spec.visual);
        targets.push({ id: d.id, kind: 'nic', spec: d.spec, rect: r });
        deviceHits.push(partHit(d.id, p, r));
        scene.rects.set(d.id, r);
      } else if (spec.kind === 'storage') {
        storageDevs.push({ id: d.id, spec: d.spec, slot: d.slot });
      } else if (spec.kind === 'display') {
        const p = monitorArt(T, true);
        monitorLayer.addChild(p.root);
        targets.push({ id: d.id, kind: 'display', spec: d.spec, rect: MONITOR });
        deviceHits.push(partHit('monitor', p.root, MONITOR));
        scene.rects.set(d.id, MONITOR); scene.rects.set('monitor', MONITOR);
        scene.interactive.add('monitor');
        hasDisplay = true;
      }
    }
    if (!hasPsu) scene.rects.set('psu', PSU);
    if (!hasDisplay) scene.rects.set('monitor', MONITOR);
    // empty slots: visible sockets / bays, hit by slot id
    const emptyHits: Hit[] = [];
    const empty = (type: string, n: number, rectOf: (i: number) => Rect) => {
      for (let i = 0; i < n; i++) {
        const id = `${type}${i}`;
        scene.slots.set(id, rectOf(i)); scene.rects.set(id, rectOf(i));
        if (!filled.has(id)) { emptyHits.push({ id, rect: rectOf(i) }); scene.interactive.add(id); }
      }
    };
    empty('dimm', slots.dimm ?? 0, (i) => ({ x: DIMM_X(i), y: DIMM_Y(i), w: DIMM_W, h: DIMM_H }));
    empty('cpu', slots.cpu ?? 0, () => PKG);
    empty('cooler', slots.cooler ?? 0, () => COOLER);
    empty('display', slots.display ?? 0, () => MONITOR);
    empty('atx', slots.atx ?? 0, () => PSU);
    empty('atx-plus', slots['atx-plus'] ?? 0, () => PSU);
    empty('pcie', slots.pcie ?? 0, (i) => slotRectOf('pcie' + i)!);
    empty('vrm-sink', slots['vrm-sink'] ?? 0, () => VRM_SINK);
    empty('ram-sink', slots['ram-sink'] ?? 0, () => RAM_SINK);
    // storage slots: the bay cells and the M.2 slot are drop targets whether empty or filled (an OS goes onto an installed drive)
    const nSata = slots.sata ?? 0, nM2 = slots.m2 ?? 0;
    const driveSlots = [...Array.from({ length: nSata }, (_, i) => `sata${i}`), ...Array.from({ length: nM2 }, (_, i) => `m2${i}`)];
    for (const id of driveSlots) {
      const r = slotRect(id);
      scene.slots.set(id, r); scene.rects.set(id, r);
      if (!filled.has(id)) { emptyHits.push({ id, rect: r }); scene.interactive.add(id); }
    }
    const bay = bayArt(T, nSata);
    deviceLayer.addChild(bay);
    const hooks: DriveHook[] = [];
    const now0 = performance.now();
    for (const sd of storageDevs) {
      const spec = getSpec(sd.spec) as { visual: string; name: string; capacityBytes?: number } | undefined;
      if (!spec) continue;
      const kind: DriveKind = driveKindOf(spec.visual), body = driveBody(kind, sd.slot);
      slotKind.set(sd.slot, kind);
      const node = new Container(), lg = new Graphics();
      node.addChild(driveArt(T, kind, sd.slot, spec.name, `${Math.round((spec.capacityBytes ?? 0) / 1024)}K`), lg);
      driveLayer.addChild(node);
      if (builtOnce && !driveSlotsSeen.has(sd.slot)) slides.push({ node, t0: now0 });
      const idx = slotIndex(sd.slot);
      if (kind !== 'ssd-nvme') sataLayer.addChild(sataLinkArt(T, idx));
      hooks.push({ slot: sd.slot, kind, g: lg, lane: kind === 'ssd-nvme' ? null : sataCablePath(idx) });
      scene.rects.set(sd.id, body); scene.interactive.add(sd.id);
      deviceHits.push(partHit(sd.id, node, body));
    }
    sataLayer.addChild(fanTrunkArt(T)); // the fan hub's control cable (the hub is part of the case)
    // one power lead for the cage, with a plug on every installed SATA drive
    if (hasPsu) sataLayer.addChild(sataPowerArt(T, storageDevs.filter((d) => d.slot.startsWith('sata')).map((d) => slotIndex(d.slot))));
    driveSlotsSeen.clear();
    for (const k of [...slotKind.keys()]) if (!storageDevs.some((d) => d.slot === k)) slotKind.delete(k);
    for (const sd of storageDevs) driveSlotsSeen.add(sd.slot);
    builtOnce = true;
    const emptyG = new Graphics();
    deviceLayer.addChildAt(emptyG, 0);
    // the empty cooler slot sits over the package: its outline goes in the cooler layer (above the CPU), so it stays visible
    // and reads as the drop target; that layer fades out with the cooler when the die is in view
    const coolerG = new Graphics();
    coolerLayer.addChild(coolerG);
    for (const h of emptyHits) {
      if (h.id.startsWith('cpu') || h.id.startsWith('pcie') || h.id.startsWith('dimm') || h.id.startsWith('sata')) continue; // already drawn by the board / the bay
      const r = h.rect;
      if (h.id.startsWith('m2')) {
        const pts: [number, number][] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y]];
        dashed(emptyG, pts, 40, 30);
        emptyG.stroke({ width: 10, color: T.mul, alpha: 0.7 });
        continue;
      }
      const pts: [number, number][] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y]];
      if (h.id.startsWith('display')) {
        // no monitor installed: a dashed bay outside the case (not a NO SIGNAL screen; that needs a monitor and power)
        const mg = new Graphics();
        dashed(mg, pts, 40, 30); mg.stroke({ width: 10, color: T.mute, alpha: 0.7 });
        box(mg, SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h, 30, T.dark ? { fill: SCREEN_BG, fa: 0.4 } : { fill: T.sub, fa: 0.55 });
        monitorLayer.addChild(mg, label('MONITOR BAY', r.x + r.w / 2, r.y + r.h / 2, 300, T.mute, { anchor: [0.5, 0.5], head: true }));
        continue;
      }
      if (h.id.startsWith('cooler')) {
        dashed(coolerG, pts, 40, 30);
        coolerG.stroke({ width: 12, color: T.mute, alpha: 0.85 });
        continue;
      }
      dashed(emptyG, pts, 40, 30);
      emptyG.stroke({ width: 10, color: T.mute, alpha: 0.7 });
      if (h.id.startsWith('atx')) deviceLayer.addChild(label('PSU BAY', r.x + r.w / 2, r.y + r.h / 2, 200, T.mute, { anchor: [0.5, 0.5], head: true }));
    }
    scene.rects.set('board', BD); scene.rects.set('chipset', BR.chip); scene.interactive.add('chipset');
    scene.rects.set('vrm', BR.vrm); scene.interactive.add('vrm');
    scene.rects.set('usb', USB_PORT); scene.interactive.add('usb'); scene.usb = USB_PORT;
    scene.rects.set('tray', TRAY); scene.interactive.add('tray');
    scene.rects.set('bay', BAY); scene.interactive.add('bay');
    scene.rects.set('case', CASE); scene.interactive.add('case');

    mainHits = [{ id: 'os', get rect() { return osRect; }, cond: () => !!lastSnap?.os }, ...dieHits];
    if (hasPsu) mainHits.push({ id: 'psu.readout', rect: PSU_PANEL });
    if (coolerHit) mainHits.push(coolerHit);
    mainHits.push({ id: 'case', rect: CASE, extOnly: true, base: true }, ...deviceHits, ...emptyHits, { id: 'chipset', rect: BR.chip }, ...REGIONS.filter((r) => r.id !== 'chipset').map((r) => ({ id: r.id, rect: r.rect })),
      { id: 'bay', rect: BAY },
      // the chassis frame (panel, side walls, floor) is the case; the glass area stays free so the board is not outlined by accident
      { id: 'case', rect: CASE_PANEL, base: true, more: [
        { x: CASE.x, y: CASE.y, w: CASE_IN.x - CASE.x, h: CASE.h }, { x: CASE_IN.x + CASE_IN.w, y: CASE.y, w: CASE.x + CASE.w - CASE_IN.x - CASE_IN.w, h: CASE.h },
        { x: CASE.x, y: CASE_IN.y + CASE_IN.h, w: CASE.w, h: CASE.y + CASE.h - CASE_IN.y - CASE_IN.h },
      ] });
    // the motherboard itself: the last hit, so devices, slots, regions and cables always win over it; an empty area of the board
    // selects `board` (the board picker)
    mainHits.push({ id: 'board', rect: BD, base: true });
    if (hasPsu) scene.interactive.add('psu.readout');
    scene.rects.set('psu.readout', PSU);
    mergeHits();

    // far-out LOD for everything static in the device layer (labels of the CPU and DIMMs stay out of the bake)
    for (const p of parts) if (p.labels) p.labels.visible = false;
    deviceLayer.visible = true;
    const wf = new Rectangle(WORLD.x, WORLD.y, WORLD.w, WORLD.h);
    deviceBake = new Sprite(app.renderer.generateTexture({ target: deviceLayer, frame: wf, resolution: DEV_BAKE_RES, antialias: true }));
    deviceBake.position.set(wf.x, wf.y);
    deviceBakeLayer.addChild(deviceBake);

    // the far-zoom exterior: built once per scene, baked to one texture; only the accent strip is live
    {
      const bt = BOARD_TIERS[tier];
      const ext = exteriorArt(T, {
        nSata: slots.sata ?? 0,
        drives: storageDevs.map((d) => ({ slot: d.slot, kind: slotKind.get(d.slot) ?? 'hdd' })).filter((d) => d.kind !== 'ssd-nvme'),
        features: bt?.features ?? { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 },
        nics: (s?.devices ?? []).filter((d) => d.kind === 'nic').map((d) => Number(/\d+$/.exec(d.slot)?.[0] ?? 0)),
      });
      const EF = exteriorFrame();
      const tx = app.renderer.generateTexture({ target: ext, frame: new Rectangle(EF.x, EF.y, EF.w, EF.h), resolution: 0.35, antialias: true });
      ext.destroy({ children: true });
      exteriorSprite = new Sprite(tx);
      exteriorSprite.position.set(EF.x, EF.y);
      exteriorLayer.addChildAt(exteriorSprite, 0);
      extDrives = storageDevs.filter((d) => slotKind.get(d.slot) !== 'ssd-nvme').map((d) => ({ slot: d.slot }));
    }

    const needsPcie = (s?.devices ?? []).some((d) => d.slot.startsWith('pcie') && d.kind !== 'nic');
    const cables = ALL_CABLES.filter((c) => (c.kind === 'video' ? hasDisplay : hasPsu && (c.kind !== 'pcie' || needsPcie)));
    live.setScene(T, targets, boardArt.buses, cables, fans, dram, dimms, { psu: hasPsu, display: hasDisplay }, hooks);
    pipeline.setTheme(T);
    sceneKey = keyOf(s);
    cableKey = ''; propsKey = '';
    syncCables(s, true);
    syncNet(s, true);
    syncProps(s, true);
    applyBadge(s);
    onZoom();
    sceneDirty = true;
    if (tierChanged) {
      fits = overviewFit(camera); camera.minZ = capZoom(camera, fits);
      if (wasOverview) camera.flyTo(fits, 900); else camera.apply();
    }
    sceneReady = true;
  }

  // ---- cables: connected (routed), loose (plug resting by the PSU / monitor), held (in the player's hand) ----
  function syncCables(s: Snapshot | null, force = false) {
    const now = performance.now();
    const hasPsu = !!s?.devices.some((d) => d.kind === 'psu'), hasDisplay = !!s?.devices.some((d) => d.kind === 'display');
    const needsPcie = (s?.devices ?? []).some((d) => d.slot.startsWith('pcie') && d.kind !== 'nic');
    const cables = ALL_CABLES.filter((c) => (c.kind === 'video' ? hasDisplay : hasPsu && (c.kind !== 'pcie' || needsPcie)));
    const states = cables.map((c) => {
      const snapC = s?.cables.find((x) => x.id === c.kind);
      const connected = snapC ? interact.cableStateOf(c.kind, snapC.connected, now) : true;
      return { c, state: held === c.kind ? 'held' as const : connected ? 'connected' as const : 'loose' as const };
    });
    const key = `${T.dark}|` + states.map((x) => x.c.kind + ':' + x.state).join(',');
    if (!force && key === cableKey) return;
    cableKey = key;
    sceneDirty = true;
    clear(cableLayer); clear(cableExtLayer);
    cableHits = [];
    scene.cables.clear();
    for (const k of ['atx', 'cpu', 'video', 'pcie'] as const) { scene.interactive.delete('cable.' + k); scene.rects.delete('cable.' + k); }
    const connectedKinds = new Set<CableKind>();
    for (const { c, state } of states) {
      const lo = looseCable(c);
      const seated = plugRect(movablePlug(c)), rest = plugRect(lo.plug);
      const info: CableInfo = { kind: c.kind, cable: c, loose: lo, plug: state === 'connected' ? seated : rest, connector: connectorOf(c.kind), state };
      scene.cables.set(c.kind, info);
      scene.interactive.add('cable.' + c.kind);
      scene.rects.set('cable.' + c.kind, info.plug);
      if (state === 'connected') {
        connectedKinds.add(c.kind);
        const p = cableArt(T, c);
        (c.kind === 'video' ? cableExtLayer : cableLayer).addChild(p.root);
        const rs = laneRects(c.path, c.w / 2 + 10);
        const parts = [...rs, plugRect(c.a), plugRect(c.b)];
        cableHits.push(partHit('cable.' + c.kind, p.root, unionRect(parts), { more: parts.slice(1), ring: false }));
      } else if (state === 'loose') {
        const p = looseCableArt(T, c);
        (c.kind === 'video' ? cableExtLayer : cableLayer).addChild(p.root);
        const pad = (r: Rect, e = 30): Rect => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
        const rs = laneRects(lo.path, c.w * 0.31 + 10);
        const parts = [pad(rest), ...rs, plugRect(c.kind === 'video' ? c.b : c.a)];
        cableHits.push(partHit('cable.' + c.kind, p.root, unionRect(parts), { more: parts.slice(1), ring: false }));
      }
    }
    live.setConnected(connectedKinds);
    mergeHits();
  }

  // ---- network: router, wall plate, ethernet cable, jack LEDs (net.ts); the plug state is the same optimistic scheme as the other cables ----
  let lanHeld = false;
  function syncNet(s: Snapshot | null, force = false) {
    const snapConn = !!s?.cables.find((c) => c.id === 'lan')?.connected;
    const conn = interact.cableStateOf('lan', snapConn, performance.now());
    const state = lanHeld ? 'held' as const : conn ? 'connected' as const : 'loose' as const;
    if (net.sync(s, T, scene, state, interact.forced.get('lan')?.port ?? null, force)) {
      netHits = net.hits.map((h) => ({ id: h.id, rect: h.rect, more: h.more, shape: h.shape }));
      sceneDirty = true;
      mergeHits();
    }
  }

  // ---- props: tray, power button, the key in the USB port ----
  /** The timers of the keys on the rack and in the port follow the sim's ticks (the sticks themselves are rebuilt only when something else changes). */
  const refreshTimers = (s: Snapshot | null) => {
    if (!s) return;
    for (const o of propObjs()) {
      if (!o.retime) continue;
      const id = Number(o.id.slice(4)), k = s.plugged?.id === id ? s.plugged : s.tray.find((q) => q.id === id);
      if (k) o.retime(k);
    }
  };
  function syncProps(s: Snapshot | null, force = false) {
    refreshTimers(s);
    const powered = !!s?.powered, down = !!s?.power.tripped || !!s?.board?.burnt, error = s?.phase === 'error' || down;
    const notRead = !!s?.keyIgnored;
    // No key tray while the machine is being built: it appears once the PC can be powered on (and stays once it ever was).
    const trayShown = !!s && (s.sandbox || s.progress.poweredOn || s.noPowerReason === null);
    if (trayShown) { scene.rects.set('tray', TRAY); scene.interactive.add('tray'); } else { scene.rects.delete('tray'); scene.interactive.delete('tray'); }
    powerState = { powered, down, error, blocked: !!s?.noPowerReason };
    screenOn = powered && !!s?.devices.some((d) => d.kind === 'display');
    roomView?.setScreen(screenOn);
    const key = [
      T.dark, trayShown, s ? s.tray.map((k) => `${k.id}${urgencyOf(k)}${k.stage}`).join(',') : '',
      s?.plugged ? `${s.plugged.id}${urgencyOf(s.plugged)}${s.plugged.done}${s.plugged.stage}${notRead ? 'ign' : ''}` : '-', powered, error,
      s?.net?.usbFallback.state ?? 'off',
    ].join('|');
    if (!force && key === propsKey) return;
    propsKey = key;
    sceneDirty = true;
    chromeBake?.texture.destroy(true); chromeBake = null;
    propBakes = [];
    clear(propsLayer); clear(chromeLayer); clear(chromeBakeLayer);
    propsArt = [];
    propHits = [];
    for (const id of [...scene.props.keys()]) { scene.interactive.delete(id); scene.rects.delete(id); }
    scene.props.clear();
    const add = (a: PropsArt) => {
      propsLayer.addChild(a.root); propsArt.push(a);
      if (a.chrome) chromeLayer.addChild(a.chrome);
      for (const o of a.objs) {
        const vec = o.vec;
        propBakes.push({ vec, cached: false });
      }
      for (const o of a.objs) { scene.props.set(o.id, o); scene.rects.set(o.id, o.rect); scene.interactive.add(o.id); }
    };
    const order: PropObj[] = [];
    powerArtRef = powerArt(T, powerState);
    add(powerArtRef);
    // a finished key (stage done) gets the remove cue: TAKE ME on a no-OS machine, REMOVE once the OS has flashed it
    if (s?.plugged) {
      const art = pluggedKeyArt(T, s.plugged, notRead, s.autoEject ? null : s.os ? 'REMOVE' : 'TAKE ME');
      add(art);
      const o = art.objs[0]!;
      const now = performance.now();
      if (keySeen && s.plugged.id !== keyInId) { keyInId = s.plugged.id; keyInAt = now; }
      if (now - keyInAt < KEY_MS) keyAnims.push({ node: o.node, baseX: o.base.x, t0: keyInAt, dir: 1 });
    }
    if (s) {
      // the key that was in the port and is not any more leaves slowly (a ghost on its own layer: the props are rebuilt around it)
      if (keySeen && keyPlugged && s.plugged?.id !== keyPlugged.id) {
        const ghost = pluggedKeyArt(T, { ...keyPlugged, stage: keyPlugged.stage === 'done' ? 'done' : keyPlugged.stage }, false, null);
        const o = ghost.objs[0]!;
        if ((keyPlugged.done || keyPlugged.stage === 'done') && outs.length < 2) {
          // a finished key does not just fade: it goes into an envelope that is sent off (the cut at the port's mouth is not needed any more)
          if (o.vec.parent) o.vec.parent.mask = null;
          for (const c of [...ghost.root.children]) if (c !== o.node) c.destroy();
          mailMid.addChild(ghost.root);
          outs.push({ t: 0, letter: null, ghost: ghost.root, node: o.node, from: { x: o.base.x, y: o.base.y }, clip: [] });
        } else {
          keyFx.addChild(ghost.root);
          keyAnims.push({ node: o.node, baseX: o.base.x, t0: performance.now(), dir: -1 });
        }
      }
      keyPlugged = s.plugged ?? null;
      if (!s.plugged) keyInId = -1;
      keySeen = true;
    }
    trayOn = trayShown;
    if (s) {
      // a key the rack has not seen comes in a letter (the keys of a loaded game, and a key put back, just hang there)
      if (s.baseTick < lastBaseTick) { knownKeys.clear(); knownInit = false; for (const m of [...mails]) dropMail(m); }
      lastBaseTick = s.baseTick;
      const ids = s.tray.map((k) => k.id);
      for (const k of s.tray) {
        if (knownKeys.has(k.id)) continue;
        knownKeys.add(k.id);
        if (!knownInit || !trayShown) continue;
        if (mails.length < 3 && s.net?.usbFallback.state !== 'retired') mails.push({ id: k.id, t: 0, letter: null });
        else swayOf(k.id).w += 0.5; // too many letters at once (or the link is up): it just hangs there, swinging
      }
      if (s.plugged) knownKeys.add(s.plugged.id);
      for (const m of [...mails]) if (!ids.includes(m.id)) dropMail(m);
      // a key that left the tray rocks its neighbours; the ones after it shift down a hook (they glide, below)
      lastTray.forEach((id, i) => { if (!ids.includes(id)) { const h = trayHook(i); nudgeNear(h.x, h.y, 0.3); } });
      lastTray = ids;
      for (const id of [...sway.keys()]) if (!ids.includes(id)) sway.delete(id);
      knownInit = true;
    }
    if (trayShown) {
      const tray = trayArt(T, s?.tray ?? [], (s?.net?.usbFallback.state ?? 'off') as TrayMode);
      add(tray);
      const rest = new Map<number, { x: number; y: number }>();
      for (const o of tray.objs) {
        const id = Number(o.id.slice(4)), was = lastRest.get(id);
        rest.set(id, { x: o.base.x, y: o.base.y });
        if (mails.some((m) => m.id === id)) o.node.visible = false; // still in its letter
        else if (was && (Math.abs(was.x - o.base.x) > 1 || Math.abs(was.y - o.base.y) > 1) && !glides.has(id)) glides.set(id, { fx: was.x, fy: was.y, t: 0 });
      }
      lastRest = rest;
    } else lastRest = new Map();
    // hit order: power, plugged key, tray keys (but not one still in its letter), then the port and tray bodies
    rebuildPropHits();
    chromeLayer.visible = true;
    chromeBake = new Sprite(app.renderer.generateTexture({ target: chromeLayer, frame: propsFrame(), resolution: 0.3, antialias: true }));
    chromeBake.position.set(TRAY.x - 100, TRAY.y - 100);
    chromeBakeLayer.addChild(chromeBake);
    onZoom();
    refreshTimers(s);
    if (s) live.setPlugged(!!s.plugged);
  }

  build(null);

  // ---- camera setup ----
  // Anything that changes the free screen area (window size, UI panels) re-frames the board if the player is
  // looking at the whole of it; a view they have panned or zoomed is left alone.
  const atOverview = () => {
    const f = overviewFit(camera);
    return Math.abs(camera.z / f.z - 1) < 0.02 && Math.abs(camera.x - f.x) < 20 && Math.abs(camera.y - f.y) < 20;
  };
  atOverviewNow = atOverview;
  const reframe = (change: () => void) => {
    const was = atOverview();
    change();
    fits = overviewFit(camera);
    camera.minZ = capZoom(camera, fits);
    if (was) camera.set(fits); else camera.apply();
  };
  camera.resize(app.screen.width, app.screen.height);
  camera.snapInset({ ...viewInset.peek() });
  camera.bounds = roomBox();
  fits = overviewFit(camera); camera.minZ = capZoom(camera, fits);
  camera.set(fits);
  app.renderer.on('resize', () => reframe(() => camera.resize(app.screen.width, app.screen.height)));
  // UI inset (viewInset): the new value is taken in the frame loop, and only when no gesture or part drag is running, so the
  // view never re-frames under the pointer. At the overview the board glides to its new fit; elsewhere the view centre
  // glides with the camera's eased inset (Camera.update).
  let pendingInset: Inset | null = null;
  effect(() => { pendingInset = { ...viewInset.value }; });
  const applyInset = (i: Inset) => {
    const c = camera.inset;
    if (c.top === i.top && c.right === i.right && c.bottom === i.bottom && c.left === i.left) return;
    // "at the overview" is judged on where the camera is heading (a flight in progress counts), not where it is this frame:
    // a change that lands during an overview flight used to be missed and left the board under the UI
    const t = camera.targetView, o = fits;
    const toOverview = !camera.holdAt && Math.abs(t.z / o.z - 1) < 0.02 && Math.abs(t.x - o.x) < 20 && Math.abs(t.y - o.y) < 20;
    camera.inset = { ...i };
    fits = overviewFit(camera); camera.minZ = capZoom(camera, fits);
    if (toOverview) camera.flyTo(fits, 450); else camera.apply();
  };
  camera.onKey = (k) => (k === 'cpu' ? flyToCpu() : flyToBoard());

  // ---- hit testing: hover and click write the shared signals ----
  // A target is what is drawn (its silhouette), and a small or thin one is grown on screen to a size a finger or a mouse can find (`pick`, shape.ts)
  const hitAt = (cx: number, cy: number): string | null => {
    const w = camera.toWorld(cx, cy), z = camera.z;
    const ext = extA > 0.5; // the exterior covers the interior: only the always-external ids (and the whole case) can be hit
    return pick(allHits, w.x, w.y, z, (h) => (ext ? !isExternalId(h.id) : !!h.extOnly) || (h.min !== undefined && z < h.min) || (h.max !== undefined && z >= h.max) || (!!h.cond && !h.cond()));
  };
  interact.hitAt = hitAt;
  interact.onHeld = (k) => { held = k; if (lastSnap || k === null) syncCables(lastSnap, true); };
  interact.onLanHeld = (h) => { lanHeld = h; syncNet(lastSnap, true); };
  camera.onHover = (p) => {
    if (interact.busy) { if (hover.peek()) hover.value = null; return; }
    if (!p) { if (hover.peek()) hover.value = null; interact.setHover(null); return; }
    const id = hitAt(p.x, p.y);
    interact.setHover(id);
    if (id) hover.value = { id, x: p.x, y: p.y };
    else if (hover.peek()) hover.value = null;
  };
  camera.onClick = (cx, cy) => interact.click(hitAt(cx, cy), cx, cy);

  // ---- theme: react to data-theme / OS scheme changes ----
  onThemeChange(() => {
    T = readTheme();
    app.renderer.background.color = T.bg;
    interact.setTheme(T);
    build(lastSnap);
    live.update(lastSnap, gt);
    pipeline.update(lastSnap, true, gt);
  });

  // ---- snapshots ----
  effect(() => {
    const s = snapshot.value;
    const fast = speed.peek() >= 4;
    const now = gt;
    lastSnap = s;
    if (keyOf(s) !== sceneKey) build(s);
    else { syncCables(s); syncNet(s); syncProps(s); }
    applyBadge(s);
    live.update(s, now);
    pipeline.update(s, fast, now);
  });

  // ---- far-zoom exterior: reveal on demand, accent strip ----
  /** True while something the player is doing needs the inside: a part or an internal cable is dragged, or an internal id is highlighted. */
  const needsInterior = () => {
    const d = dragging.peek();
    if (d && (d.kind === 'part' || (d.kind === 'cable' && d.id !== 'cable.video' && d.id !== 'cable.lan'))) return true;
    for (const id of highlight.peek()) if (!isExternalId(id) && interact.rectsFor(id).length > 0) return true;
    return false;
  };
  const lodFrame = (dt: number) => {
    const target = needsInterior() ? 1 : 0;
    if (reveal !== target) {
      reveal += (target - reveal) * (1 - Math.exp(-dt * 9));
      if (Math.abs(target - reveal) < 0.004) reveal = target;
      applyLod();
    }
    if (exteriorLayer.visible) drawStrip(stripG, T, stripModeOf(lastSnap), gt, live.diskLevel, extDrives, performance.now());
  };

  // ---- the rack's keys, per frame: the letters, the glides to a new hook, the sway ----
  const keysFrame = (gdt: number, gtMs: number) => {
    const stage = mailStage(), flying = new Set<number>();
    for (let i = 0; i < mails.length; i++) {
      const m = mails[i]!, ahead = mails[i - 1];
      if (!m.letter && ahead && ahead.t < MAIL_S * 0.8) continue; // one letter at a time on the stage: the next one comes when the one ahead is on its way
      if (!m.letter) { m.letter = buildLetter(T); mailBack.addChild(m.letter.back); mailFront.addChild(m.letter.front); }
      m.t += gdt * mailSlow;
      const u = Math.min(1, m.t / MAIL_S);
      setLetter(m.letter, letterPose(u, stage));
      const o = scene.props.get('key:' + m.id);
      if (!o?.swing || !o.lan) { if (u >= 1) { dropMail(m); i--; } continue; }
      const kp = keyPose(u, stage, o.base), st = swayOf(m.id);
      flying.add(m.id);
      o.node.visible = kp.phase !== 'wait';
      o.node.position.set(kp.x, kp.y);
      o.lan.scale.y = Math.max(0.001, kp.cordK);
      const par = o.node.parent;
      if (par && par.children[par.children.length - 1] !== o.node) par.addChild(o.node); // in front of the keys it passes
      if (kp.phase === 'carry') swayStep(st, gdt, carryAx(u, stage, o.base));
      else if (kp.phase === 'settle') swayStep(st, gdt);
      else { st.a = 0; st.w = 0; }
      o.swing.rotation = swayAngle(st, gtMs);
      if (u >= 1) {
        // hung up: it takes the catch's jolt, and its neighbours feel it
        o.node.position.set(o.base.x, o.base.y); o.lan.scale.y = 1;
        st.w -= 0.35; nudgeNear(o.base.x, o.base.y - 860, 0.22, m.id);
        dropMail(m); i--; flying.delete(m.id);
        rebuildPropHits();
      }
    }
    const outStage = mailOutStage();
    for (let i = outs.length - 1; i >= 0; i--) {
      const m = outs[i]!;
      if (!m.letter) { m.letter = buildLetter(T); mailBack.addChild(m.letter.back); mailFront.addChild(m.letter.front); }
      m.t += gdt * mailSlow;
      const u = Math.min(1, m.t / MAIL_OUT_S);
      setLetter(m.letter, outLetterPose(u, outStage));
      const kp = outKeyPose(u, m.from, outStage);
      m.node.visible = kp.visible;
      m.node.position.set(kp.x, kp.y); m.node.rotation = kp.rot; m.node.scale.set(kp.scale);
      // going into the slot: everything below the slot's line is hidden (a mask each for the two layers of the envelope, in world space)
      if (u >= POSTING_FROM && !m.clip.length) {
        const slot = outboxSlot();
        for (const c of [m.letter.back, m.letter.front]) {
          const mk = new Graphics().rect(slot.x - 2000, slot.y - 6000, 4000, 6000 + 6).fill({ color: '#ffffff' });
          (c === m.letter.back ? mailBack : mailFront).addChild(mk);
          c.mask = mk; m.clip.push(mk);
        }
      }
      if (u >= 1) {
        outLed = 1;
        for (const c of [m.letter.back, m.letter.front]) c.mask = null;
        for (const mk of m.clip) mk.destroy();
        m.letter.back.destroy({ children: true }); m.letter.front.destroy({ children: true }); m.ghost.destroy({ children: true }); outs.splice(i, 1);
      }
    }
    if (outLed > 0 || outLedG.visible) {
      outLed = Math.max(0, outLed - gdt * mailSlow / 1.6);
      outLedG.clear();
      if (outLed > 0) { const cx = OUTBOX.x + OUTBOX.w - 130, cy = OUTBOX.y + OUTBOX.h - 100; outLedG.circle(cx, cy, 120 * outLed).fill({ color: T.st, alpha: 0.25 * outLed }).circle(cx, cy, 22).fill({ color: T.st, alpha: 0.4 + 0.6 * outLed }); }
      outLedG.visible = outLed > 0;
    }
    for (const [id, g] of glides) {
      const o = scene.props.get('key:' + id);
      if (!o) { glides.delete(id); continue; }
      g.t += gdt;
      const u = Math.min(1, g.t / 0.6), e = u * u * (3 - 2 * u);
      o.node.position.set(o.base.x + (g.fx - o.base.x) * (1 - e), o.base.y + (g.fy - o.base.y) * (1 - e) - 140 * Math.sin(Math.PI * u));
      if (u >= 1) { glides.delete(id); swayOf(id).w += (g.fx > o.base.x ? -1 : 1) * 0.3; }
    }
    for (const o of propObjs()) {
      if (!o.swing) continue;
      const id = Number(o.id.slice(4));
      if (flying.has(id)) continue;
      const st = swayOf(id);
      swayStep(st, gdt);
      o.swing.rotation = swayAngle(st, gtMs);
    }
  };

  // ---- frame loop ----
  app.ticker.add((tk) => {
    const now = performance.now();
    const dt = tk.deltaMS / 1000;
    // game time: advances only while the sim runs (pause = speed 0 stops it), so every world animation freezes with it
    const gdt = dt * timeScale();
    gt += gdt * 1000;
    if (pendingInset && !camera.gesturing && !interact.busy) { const i = pendingInset; pendingInset = null; applyInset(i); }
    camera.update(now);
    lodFrame(dt);
    live.frame(gdt, gt);
    roomView?.frame(gt, tk.deltaMS);
    pipeline.frame(gt);
    syncCables(lastSnap); // optimistic cable state expires on its own
    syncNet(lastSnap);
    net.frame(gt, gdt);
    // the remove cue on a finished key: game clock, scaled up as the camera moves out so it stays readable
    const cueK = Math.min(2.6, Math.max(1, fits.z / Math.max(1e-6, camera.z)));
    for (const a of propsArt) if (a.cue) drawKeyCue(a.cue, T, gt, cueK);
    interact.frame(now, dt, gt);
    if (powerArtRef) drawPowerLeds(T, powerArtRef.led, powerState, gt, live.diskLevel);
    keysFrame(gdt, gt);
    for (let i = keyAnims.length - 1; i >= 0; i--) {
      const ka = keyAnims[i]!, u = Math.min(1, (now - ka.t0) / KEY_MS), e = u * u * (3 - 2 * u);
      if (ka.node.destroyed) { keyAnims.splice(i, 1); continue; }
      if (ka.dir === 1) { ka.node.position.x = ka.baseX - KEY_TRAVEL * (1 - e); ka.node.alpha = Math.min(1, 0.25 + u * 2); }
      else { ka.node.position.x = ka.baseX - KEY_TRAVEL * e; ka.node.alpha = 1 - e; }
      if (u >= 1) {
        keyAnims.splice(i, 1);
        if (ka.dir === -1) { keyFx.removeChildren().forEach((c) => c.destroy({ children: true })); }
        else ka.node.position.x = ka.baseX;
      }
    }
    for (let i = slides.length - 1; i >= 0; i--) {
      const sl = slides[i]!, u = Math.min(1, (now - sl.t0) / 650), e = 1 - Math.pow(1 - u, 3);
      sl.node.position.x = 300 * (1 - e); sl.node.alpha = Math.min(1, u * 3);
      if (u >= 1) slides.splice(i, 1);
    }
    // anchors: one cameraRev bump per frame, and only when the view (incl. canvas offset and inset as drawn) or the layout changed
    const fr = camera.freeRect();
    const vk = [camera.x, camera.y, camera.z, camera.cx, camera.cy, camera.w, camera.h, fr.x, fr.y, fr.w, fr.h, exteriorCover > 0.5].join('|');
    if (sceneDirty || vk !== lastViewKey) { sceneDirty = false; lastViewKey = vk; cameraRev.value += 1; }
  });

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__board = { net, camera, hitAt, hitList: () => allHits.map((h) => ({ id: h.id, rect: h.rect, more: h.more, shape: h.shape, ring: h.ring })), app, flyToCpu, flyToBoard, flyTo, anchorOf, cameraRev, hover, interact, scene, beginPartDrag, LOD, mailSlow: (k: number) => { mailSlow = k; }, room: { debug: roomDebug, state: roomState }, lod: () => ({ extA, reveal, interior: interior.visible }) };
  return app;
}
