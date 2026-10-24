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
import { bayArt, caseBack, caseGlass, emptyCellHint, sataCablePath, sataLinkArt } from './case';
import { driveArt, driveBody, driveKindOf, osBadgeRect, slotRect, type DriveKind } from './drives';
import { cableArt, coolerArt, cpuArt, looseCableArt, monitorArt, plugRect, psuArt, ramArt, SCREEN_BG, vrmSinkArt, type Part } from './devices';
import { Interact, type CableInfo, type SceneInfo } from './interact';
import { drawStrip, exteriorArt, EXTERIOR_FRAME, stripModeOf } from './exterior';
import { box, clear, dashed, label } from './ink';
import {
  BAY, BD, BLOCKS, BR, CASE, CASE_IN, CASE_PANEL, COOLER, DIE, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, HDMI_PORT, HELD, MONITOR, PCIE_RAILS, PKG, PSU, PSU_PANEL,
  REGIONS, SCREEN, STAGES, TRAY, USB_PORT, VRM_SINK, WORLD, type Rect,
} from './layout';
import { drawPowerLeds, heldArt, pluggedKeyArt, powerArt, trayArt, urgencyOf, type PowerState, type PropObj, type PropsArt } from './props';
import { buildCables, laneRects, looseCable, movablePlug, type CableKind } from './routes';
import { Live, type DriveHook, type GlowTarget } from './live';
import { PipelineView } from './pipeline';
import { onThemeChange, readTheme, type Theme } from './theme';

interface Hit { id: string; rect: Rect; /** Extra rects (thin cable segments) that also hit. */ more?: Rect[]; /** Only hit when the zoom is within [min, max]. */ min?: number; max?: number; /** Only hit while this holds. */ cond?: () => boolean; /** Only hit while the exterior case covers the interior. */ extOnly?: boolean }

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
const PROPS_FRAME = new Rectangle(-7560, 280, 3500, 2950);

/**
 * Level of detail on the camera scale, as multiples of the fit zoom (the zoom of the default overview, `fits.z`).
 * At or above `LOD.fadeFrom` the interior shows as always; between `fadeFrom` and `fadeTo` the exterior case crossfades in over it;
 * at or below `fadeTo` only the exterior (and the always-external things) is drawn and updated. `minZoom` is how far the camera may
 * zoom out (it used to be 0.7). Tune these four numbers, nothing else depends on them.
 */
export const LOD = { fadeFrom: 0.7, fadeTo: 0.5, minZoom: 0.2 };
/** Ids that stay hit targets (and never force the interior open) at any zoom. Everything else is interior. */
const isExternalId = (id: string) => id === 'power' || id === 'usb' || id === 'monitor' || id === 'tray' || id === 'held' || id === 'case'
  || id === 'cable.video' || id.startsWith('key:') || id.startsWith('display');

/** The routed cables never change (geometry only); built once. */
const ALL_CABLES = buildCables();

/** The matching board connector for each cable (drop target). */
const CONNECTOR: Record<CableKind, Rect> = { atx: BR.atx, cpu: BR.cpw, pcie: BR.pciew, video: HDMI_PORT };

/** View used by the camera keys and exported helpers. */
let cameraRef: Camera | null = null;
let interactRef: Interact | null = null;
/** 0..1 how much the exterior case covers the interior (set by applyLod). Interior ids are hidden above 0.5, as in hit testing. */
let exteriorCover = 0;
export function flyToCpu() { cameraRef?.flyTo(cameraRef.fit({ x: DIE.x - 40, y: DIE.y - 40, w: DIE.w + 80, h: DIE.h + 80 }, 0.9)); }
export function flyToBoard() { cameraRef?.flyTo(cameraRef.fit(WORLD)); }
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

  // ---- scene graph ----
  const world = new Container();
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
    const x0 = Math.min(...rs.map((r) => r.x)) - 900, y0 = Math.min(...rs.map((r) => r.y)) - 900;
    const x1 = Math.max(...rs.map((r) => r.x + r.w)) + 900, y1 = Math.max(...rs.map((r) => r.y + r.h)) + 900;
    const v = camera.fit({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 0.9);
    const z = opts.zoom ?? Math.min(Math.max(v.z, camera.fit(WORLD).z), 0.3);
    camera.flyTo({ x: v.x, y: v.y, z }, opts.smooth === false ? 0 : 1400, opts.onDone, !!opts.hold);
  });
  interactRef = interact;
  interact.setTheme(T);
  interior.addChild(caseLayer, boardLayer, deviceLayer, deviceBakeLayer, sataLayer, driveLayer, fanLayer, cableLayer, glassLayer, coolerLayer, pipeline.root, live.root);
  exteriorLayer.addChild(stripG);
  world.addChild(interior, exteriorLayer, monitorLayer, cableExtLayer, chromeBakeLayer, chromeLayer, propsLayer, live.ext, interact.fx);
  app.stage.addChild(world, interact.hud);

  let boardArt: BoardArt | null = null;
  /** Far-out LOD: the whole static board baked once into a texture (rebuilt only with the scene). */
  let boardBake: Sprite | null = null;
  let deviceBake: Sprite | null = null;
  /** The case chassis (vector close up, one baked texture far out) and drive slide-in animations. */
  let caseVec: Container | null = null;
  let caseBake: Sprite | null = null;
  let builtOnce = false;
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
  const parts: Part[] = [];
  let mainHits: Hit[] = [];
  let cableHits: Hit[] = [];
  let propHits: Hit[] = [];
  let allHits: Hit[] = [];
  const scene: SceneInfo = interact.scene;
  /** Hover/selected alias: the installed PSU and monitor are written as 'psu' / 'monitor' on click, but hover keeps the device id. */
  const hoverAlias = new Map<string, string>();
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
  const mergeHits = () => { allHits = [...propHits, ...cableHits, ...mainHits]; };

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
  const onZoom = () => {
    const z = camera.z;
    applyLod();
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
      default: return null;
    }
  };

  // ---- scene build: runs on theme change, board tier change, or an install/uninstall ----
  const keyOf = (s: Snapshot | null) =>
    `${T.dark}|${s?.boardTier ?? 0}|${s ? s.devices.map((d) => `${d.spec}@${d.slot}`).join(',') : ''}`;

  function build(s: Snapshot | null) {
    boardBake?.texture.destroy(true); deviceBake?.texture.destroy(true); caseBake?.texture.destroy(true);
    boardBake = null; deviceBake = null; caseBake = null; caseVec = null;
    clear(caseLayer); clear(sataLayer); clear(driveLayer); clear(glassLayer); slides.length = 0;
    clear(boardLayer); clear(deviceLayer); clear(coolerLayer); clear(deviceBakeLayer); clear(fanLayer);
    monitorLayer.cacheAsTexture(false); monitorCached = false; clear(monitorLayer);
    exteriorSprite?.texture.destroy(true); exteriorSprite?.destroy(); exteriorSprite = null;
    parts.length = 0;
    const tier = s?.boardTier ?? 0;
    boardArt = buildBoard(T, tier);
    boardLayer.addChild(boardArt.root);
    boardArt.labels.visible = false;
    const frame = new Rectangle(BD.x - 40, BD.y - 40, BD.w + 80, BD.h + 80);
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
    let dram: Rect[] = [];
    const slots = BOARD_TIERS[tier]?.slots ?? {};
    const filled = new Set<string>();
    const dieHits: Hit[] = [...STAGES, ...BLOCKS].map((t) => ({ id: 'cpu.' + t.id, rect: t, min: Z_DIE }));
    let coolerHit: Hit | null = null;
    const deviceHits: Hit[] = [];
    let hasPsu = false, hasDisplay = false;
    const dimms: number[] = [];
    hoverAlias.clear();
    scene.rects.clear(); scene.interactive.clear(); scene.slots.clear();

    for (const d of s?.devices ?? []) {
      const spec = getSpec(d.spec);
      if (!spec) continue;
      filled.add(d.slot);
      scene.interactive.add(d.id);
      if (spec.kind === 'cpu') {
        const p = cpuArt(T, spec as CpuSpec);
        deviceLayer.addChild(p.root); parts.push(p);
        targets.push({ id: d.id, kind: 'cpu', spec: d.spec, rect: { x: PKG.x - 46, y: PKG.y - 46, w: PKG.w + 92, h: PKG.h + 92 } });
        deviceHits.push({ id: d.id, rect: PKG, max: Z_DIE });
        scene.rects.set(d.id, PKG);
      } else if (spec.kind === 'ram') {
        const idx = Number(/\d+$/.exec(d.slot)?.[0] ?? 0);
        const p = ramArt(T, spec as RamSpec, idx >= 4);
        p.root.position.set(DIMM_X(idx), DIMM_Y(idx));
        deviceLayer.addChild(p.root); parts.push(p);
        const r = { x: DIMM_X(idx), y: DIMM_Y(idx), w: DIMM_W, h: DIMM_H };
        dimms.push(idx);
        targets.push({ id: d.id, kind: 'ram', spec: d.spec, rect: r });
        deviceHits.push({ id: d.id, rect: r });
        scene.rects.set(d.id, r);
        dram = dram.concat((p.chips ?? []).map((c) => ({ x: c.x + r.x, y: c.y + r.y, w: c.w, h: c.h })));
      } else if (spec.kind === 'psu') {
        const p = psuArt(T, spec as PsuSpec);
        deviceLayer.addChild(p.root); parts.push(p);
        if (p.fan) { fans.push({ c: p.fan, kind: 'psu' }); fanLayer.addChild(p.fan); }
        if (p.over) fanLayer.addChild(p.over);
        deviceHits.push({ id: 'psu', rect: PSU });
        scene.rects.set(d.id, PSU); scene.rects.set('psu', PSU);
        scene.interactive.add('psu'); hoverAlias.set('psu', d.id);
        hasPsu = true;
      } else if (spec.kind === 'cooler') {
        const p = coolerArt(T, spec as CoolerSpec);
        coolerLayer.addChild(p.root); parts.push(p);
        if (p.fan) fans.push({ c: p.fan, kind: 'cooler' });
        coolerHit = { id: d.id, rect: COOLER, max: Z_DIE };
        scene.rects.set(d.id, COOLER);
      } else if (spec.kind === 'vrm-sink') {
        const p = vrmSinkArt(T, spec.visual);
        deviceLayer.addChild(p.root); parts.push(p);
        if (p.fan) { fans.push({ c: p.fan, kind: 'vrm' }); fanLayer.addChild(p.fan); }
        if (p.over) fanLayer.addChild(p.over);
        deviceHits.push({ id: d.id, rect: VRM_SINK });
        scene.rects.set(d.id, VRM_SINK);
      } else if (spec.kind === 'storage') {
        storageDevs.push({ id: d.id, spec: d.spec, slot: d.slot });
      } else if (spec.kind === 'display') {
        const p = monitorArt(T, true);
        monitorLayer.addChild(p.root);
        targets.push({ id: d.id, kind: 'display', spec: d.spec, rect: MONITOR });
        deviceHits.push({ id: 'monitor', rect: MONITOR });
        scene.rects.set(d.id, MONITOR); scene.rects.set('monitor', MONITOR);
        scene.interactive.add('monitor'); hoverAlias.set('monitor', d.id);
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
    // storage slots: the bay cells and the M.2 slot are drop targets whether empty or filled (an OS goes onto an installed drive)
    const nSata = slots.sata ?? 0, nM2 = slots.m2 ?? 0;
    const driveSlots = [...['sata0', 'sata1'].slice(0, nSata), ...(nM2 ? ['m20'] : [])];
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
      const idx = sd.slot === 'sata1' ? 1 : 0;
      if (kind !== 'ssd-nvme') sataLayer.addChild(sataLinkArt(T, idx as 0 | 1, hasPsu));
      hooks.push({ slot: sd.slot, kind, g: lg, lane: kind === 'ssd-nvme' ? null : sataCablePath(idx as 0 | 1) });
      scene.rects.set(sd.id, body); scene.interactive.add(sd.id);
      deviceHits.push({ id: sd.id, rect: body });
    }
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
      if (h.id === 'm20') {
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
        box(mg, SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h, 30, { fill: SCREEN_BG, fa: 0.4 });
        monitorLayer.addChild(mg, label('MONITOR BAY', r.x + r.w / 2, r.y + r.h / 2, 200, T.mute, { anchor: [0.5, 0.5], head: true }));
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
    scene.rects.set('held', HELD); scene.interactive.add('held');

    mainHits = [{ id: 'os', get rect() { return osRect; }, cond: () => !!lastSnap?.os }, ...dieHits];
    if (hasPsu) mainHits.push({ id: 'psu.readout', rect: PSU_PANEL });
    if (coolerHit) mainHits.push(coolerHit);
    mainHits.push({ id: 'case', rect: CASE, extOnly: true }, ...deviceHits, ...emptyHits, { id: 'chipset', rect: BR.chip }, ...REGIONS.filter((r) => r.id !== 'chipset').map((r) => ({ id: r.id, rect: r.rect })),
      { id: 'bay', rect: BAY },
      // the chassis frame (panel, side walls, floor) is the case; the glass area stays free so the board is not outlined by accident
      { id: 'case', rect: CASE_PANEL, more: [
        { x: CASE.x, y: CASE.y, w: CASE_IN.x - CASE.x, h: CASE.h }, { x: CASE_IN.x + CASE_IN.w, y: CASE.y, w: CASE.x + CASE.w - CASE_IN.x - CASE_IN.w, h: CASE.h },
        { x: CASE.x, y: CASE_IN.y + CASE_IN.h, w: CASE.w, h: CASE.y + CASE.h - CASE_IN.y - CASE_IN.h },
      ] });
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
      });
      const tx = app.renderer.generateTexture({ target: ext, frame: new Rectangle(EXTERIOR_FRAME.x, EXTERIOR_FRAME.y, EXTERIOR_FRAME.w, EXTERIOR_FRAME.h), resolution: 0.35, antialias: true });
      ext.destroy({ children: true });
      exteriorSprite = new Sprite(tx);
      exteriorSprite.position.set(EXTERIOR_FRAME.x, EXTERIOR_FRAME.y);
      exteriorLayer.addChildAt(exteriorSprite, 0);
      extDrives = storageDevs.filter((d) => slotKind.get(d.slot) !== 'ssd-nvme').map((d) => ({ slot: d.slot }));
    }

    const needsPcie = (s?.devices ?? []).some((d) => d.slot.startsWith('pcie'));
    const cables = ALL_CABLES.filter((c) => (c.kind === 'video' ? hasDisplay : hasPsu && (c.kind !== 'pcie' || needsPcie)));
    live.setScene(T, targets, boardArt.buses, cables, fans, dram, dimms, { psu: hasPsu, display: hasDisplay }, hooks);
    pipeline.setTheme(T);
    sceneKey = keyOf(s);
    cableKey = ''; propsKey = '';
    syncCables(s, true);
    syncProps(s, true);
    applyBadge(s);
    onZoom();
    sceneDirty = true;
  }

  // ---- cables: connected (routed), loose (plug resting by the PSU / monitor), held (in the player's hand) ----
  function syncCables(s: Snapshot | null, force = false) {
    const now = performance.now();
    const hasPsu = !!s?.devices.some((d) => d.kind === 'psu'), hasDisplay = !!s?.devices.some((d) => d.kind === 'display');
    const needsPcie = (s?.devices ?? []).some((d) => d.slot.startsWith('pcie'));
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
      const info: CableInfo = { kind: c.kind, cable: c, loose: lo, plug: state === 'connected' ? seated : rest, connector: CONNECTOR[c.kind], state };
      scene.cables.set(c.kind, info);
      scene.interactive.add('cable.' + c.kind);
      scene.rects.set('cable.' + c.kind, info.plug);
      if (state === 'connected') {
        connectedKinds.add(c.kind);
        const p = cableArt(T, c);
        (c.kind === 'video' ? cableExtLayer : cableLayer).addChild(p.root);
        const rs = laneRects(c.path, c.w / 2 + 10);
        cableHits.push({ id: 'cable.' + c.kind, rect: rs[0]!, more: [...rs.slice(1), plugRect(c.a), plugRect(c.b)] });
      } else if (state === 'loose') {
        const p = looseCableArt(T, c);
        (c.kind === 'video' ? cableExtLayer : cableLayer).addChild(p.root);
        const pad = (r: Rect, e = 30): Rect => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
        const rs = laneRects(lo.path, c.w * 0.31 + 10);
        cableHits.push({ id: 'cable.' + c.kind, rect: pad(rest), more: [...rs, plugRect(c.kind === 'video' ? c.b : c.a)] });
      }
    }
    live.setConnected(connectedKinds);
    mergeHits();
  }

  // ---- props: tray, power button, the key in the USB port ----
  function syncProps(s: Snapshot | null, force = false) {
    const powered = !!s?.powered, down = !!s?.power.tripped || !!s?.board?.burnt, error = s?.phase === 'error' || down;
    const notRead = !!s?.keyIgnored;
    powerState = { powered, down, error, blocked: !!s?.noPowerReason };
    const key = [
      T.dark, s ? s.tray.map((k) => `${k.id}${urgencyOf(k)}${k.stage}`).join(',') : '',
      s?.plugged ? `${s.plugged.id}${urgencyOf(s.plugged)}${s.plugged.done}${s.plugged.stage}${notRead ? 'ign' : ''}` : '-', powered, error,
      s ? (s.held ?? []).map((k) => `${k.id}${k.stage}`).join(',') : '',
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
    if (s?.plugged) add(pluggedKeyArt(T, s.plugged, notRead));
    add(trayArt(T, s?.tray ?? []));
    add(heldArt(T, s?.held ?? []));
    for (const a of propsArt) order.push(...a.objs);
    // hit order: power, plugged key, tray keys, then the port and tray bodies
    propHits = [
      ...order.map((o) => ({ id: o.id, rect: o.rect })),
      { id: 'usb', rect: { x: USB_PORT.x - 20, y: USB_PORT.y - 20, w: USB_PORT.w + 40, h: USB_PORT.h + 40 } },
      { id: 'held', rect: HELD },
      { id: 'tray', rect: TRAY },
    ];
    chromeLayer.visible = true;
    chromeBake = new Sprite(app.renderer.generateTexture({ target: chromeLayer, frame: PROPS_FRAME, resolution: 0.3, antialias: true }));
    chromeBake.position.set(PROPS_FRAME.x, PROPS_FRAME.y);
    chromeBakeLayer.addChild(chromeBake);
    onZoom();
    mergeHits();
    if (s) live.setPlugged(!!s.plugged);
  }

  build(null);

  // ---- camera setup ----
  // Anything that changes the free screen area (window size, UI panels) re-frames the board if the player is
  // looking at the whole of it; a view they have panned or zoomed is left alone.
  const atOverview = () => {
    const f = camera.fit(WORLD);
    return Math.abs(camera.z / f.z - 1) < 0.02 && Math.abs(camera.x - f.x) < 20 && Math.abs(camera.y - f.y) < 20;
  };
  const reframe = (change: () => void) => {
    const was = atOverview();
    change();
    fits = camera.fit(WORLD);
    camera.minZ = fits.z * LOD.minZoom;
    if (was) camera.set(fits); else camera.apply();
  };
  camera.resize(app.screen.width, app.screen.height);
  camera.snapInset({ ...viewInset.peek() });
  fits = camera.fit(WORLD); camera.minZ = fits.z * LOD.minZoom;
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
    const was = atOverview() && !camera.holdAt;
    camera.inset = { ...i };
    fits = camera.fit(WORLD); camera.minZ = fits.z * LOD.minZoom;
    if (was) camera.flyTo(fits, 450); else camera.apply();
  };
  camera.onKey = (k) => (k === 'cpu' ? flyToCpu() : flyToBoard());

  // ---- hit testing: hover and click write the shared signals ----
  const hitAt = (cx: number, cy: number): string | null => {
    const w = camera.toWorld(cx, cy), z = camera.z;
    const ext = extA > 0.5; // the exterior covers the interior: only the always-external ids (and the whole case) can be hit
    for (const h of allHits) {
      if (ext ? !isExternalId(h.id) : h.extOnly) continue;
      if ((h.min !== undefined && z < h.min) || (h.max !== undefined && z >= h.max) || (h.cond && !h.cond())) continue;
      for (const r of h.more ? [h.rect, ...h.more] : [h.rect]) if (w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h) return h.id;
    }
    return null;
  };
  interact.hitAt = hitAt;
  interact.onHeld = (k) => { held = k; if (lastSnap || k === null) syncCables(lastSnap, true); };
  camera.onHover = (p) => {
    if (interact.busy) { if (hover.peek()) hover.value = null; return; }
    if (!p) { if (hover.peek()) hover.value = null; interact.setHover(null); return; }
    const id = hitAt(p.x, p.y);
    interact.setHover(id);
    if (id) hover.value = { id: hoverAlias.get(id) ?? id, x: p.x, y: p.y };
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
    else { syncCables(s); syncProps(s); }
    applyBadge(s);
    live.update(s, now);
    pipeline.update(s, fast, now);
  });

  // ---- far-zoom exterior: reveal on demand, accent strip ----
  /** True while something the player is doing needs the inside: a part or an internal cable is dragged, or an internal id is highlighted. */
  const needsInterior = () => {
    const d = dragging.peek();
    if (d && (d.kind === 'part' || (d.kind === 'cable' && d.id !== 'cable.video'))) return true;
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
    if (exteriorLayer.visible) drawStrip(stripG, T, stripModeOf(lastSnap), gt, live.diskLevel, extDrives);
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
    pipeline.frame(gt);
    syncCables(lastSnap); // optimistic cable state expires on its own
    interact.frame(now, dt, gt);
    if (powerArtRef) drawPowerLeds(T, powerArtRef.led, powerState, gt, live.diskLevel);
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

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__board = { camera, app, flyToCpu, flyToBoard, flyTo, anchorOf, cameraRev, hover, interact, scene, beginPartDrag, LOD, lod: () => ({ extA, reveal, interior: interior.visible }) };
  return app;
}
