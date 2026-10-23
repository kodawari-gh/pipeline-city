import { Application, Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import { effect } from '@preact/signals';
import { hover, viewInset } from '../game/hover';
import { snapshot, speed } from '../game/store';
import { BOARD_TIERS, getSpec, type CoolerSpec, type CpuSpec, type PsuSpec, type RamSpec } from '../sim/board/specs';
import type { Snapshot } from '../sim/protocol';
import { buildBoard, type BoardArt } from './boardArt';
import { Camera, type View } from './camera';
import { cableArt, coolerArt, cpuArt, looseCableArt, monitorArt, plugRect, psuArt, ramArt, SCREEN_BG, type Part } from './devices';
import { Interact, type CableInfo, type SceneInfo } from './interact';
import { box, clear, dashed, label } from './ink';
import {
  BD, BLOCKS, BR, COOLER, CRATE, DIE, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, HDMI_PORT, MONITOR, PKG, PSU, PSU_PANEL, REGIONS, SCREEN, STAGES, TRAY,
  USB_PORT, WORLD, type Rect,
} from './layout';
import { crateArt, drawPowerLeds, pluggedKeyArt, powerArt, trayArt, urgencyOf, type PowerState, type PropObj, type PropsArt } from './props';
import { buildCables, laneRects, looseCable, movablePlug, type CableKind } from './routes';
import { Live, type GlowTarget } from './live';
import { PipelineView } from './pipeline';
import { onThemeChange, readTheme, type Theme } from './theme';

interface Hit { id: string; rect: Rect; /** Extra rects (thin cable segments) that also hit. */ more?: Rect[]; /** Only hit when the zoom is within [min, max]. */ min?: number; max?: number }

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Zoom above which the die is the thing being looked at (cooler faded, chips shown). */
const Z_DIE = 0.45;
/** Below this zoom the baked board texture replaces the vector board. */
const Z_BAKE = 0.2;
const BAKE_RES = 0.4;
/** Below this zoom the static devices, PSU, monitor and cables are one baked texture too. */
const Z_BAKE_DEV = 0.14;
const DEV_BAKE_RES = 0.25;
/** Below this zoom the crate, tray and power plate chrome (boxes, labels) is one baked texture. */
const Z_BAKE_PROPS = 0.2;
const PROPS_FRAME = new Rectangle(-7560, 280, 4130, 3320);

/** The routed cables never change (geometry only); built once. */
const ALL_CABLES = buildCables();

/** The matching board connector for each cable (drop target). */
const CONNECTOR: Record<CableKind, Rect> = { atx: BR.atx, cpu: BR.cpw, pcie: BR.pciew, video: HDMI_PORT };

/** View used by the camera keys and exported helpers. */
let cameraRef: Camera | null = null;
let interactRef: Interact | null = null;
export function flyToCpu() { cameraRef?.flyTo(cameraRef.fit({ x: DIE.x - 40, y: DIE.y - 40, w: DIE.w + 80, h: DIE.h + 80 }, 0.9)); }
export function flyToBoard() { cameraRef?.flyTo(cameraRef.fit(WORLD)); }
/**
 * Fly the camera to a world object by id (any id listed in docs/RENDER.md: slot ids, device ids, 'inv:<id>', 'key:<id>',
 * 'crate', 'tray', 'usb', 'power', 'monitor', 'psu', 'chipset', 'board', 'cable.atx|cpu|video'). Unknown ids do nothing.
 * Returns whether the id was found.
 */
export function flyTo(id: string): boolean {
  if (!interactRef) return false;
  const rs = interactRef.rectsFor(id);
  if (!rs.length) return false;
  interactRef.flyToId(id);
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
  const boardLayer = new Container();
  const deviceLayer = new Container();
  const coolerLayer = new Container();
  const deviceBakeLayer = new Container();
  const fanLayer = new Container();
  const cableLayer = new Container();
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
  const interact = new Interact(camera, app.canvas, (rs) => {
    const x0 = Math.min(...rs.map((r) => r.x)) - 900, y0 = Math.min(...rs.map((r) => r.y)) - 900;
    const x1 = Math.max(...rs.map((r) => r.x + r.w)) + 900, y1 = Math.max(...rs.map((r) => r.y + r.h)) + 900;
    const v = camera.fit({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 0.9);
    camera.flyTo({ ...v, z: Math.min(Math.max(v.z, camera.fit(WORLD).z), 0.3) });
  });
  interactRef = interact;
  interact.setTheme(T);
  world.addChild(boardLayer, deviceLayer, deviceBakeLayer, fanLayer, cableLayer, coolerLayer, pipeline.root, chromeBakeLayer, chromeLayer, propsLayer, live.root, interact.fx);
  app.stage.addChild(world, interact.hud);

  let boardArt: BoardArt | null = null;
  /** Far-out LOD: the whole static board baked once into a texture (rebuilt only with the scene). */
  let boardBake: Sprite | null = null;
  let deviceBake: Sprite | null = null;
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
  let lastSnap: Snapshot | null = null;
  let fits: View = { x: 0, y: 0, z: 0.15 };
  let held: CableKind | null = null;
  let propsArt: PropsArt[] = [];
  let powerArtRef: PropsArt | null = null;
  let powerState: PowerState = { powered: false, error: false, blocked: false };
  const mergeHits = () => { allHits = [...propHits, ...cableHits, ...mainHits]; };

  // ---- LOD driven by zoom ----
  const onZoom = () => {
    const z = camera.z;
    const labelsOn = z > 0.12, partLabels = z > 0.22;
    if (boardArt) boardArt.labels.visible = labelsOn;
    const baked = !!boardBake && z < Z_BAKE;
    if (boardBake) boardBake.visible = baked;
    if (boardArt) boardArt.root.visible = !baked;
    const dbaked = !!deviceBake && z < Z_BAKE_DEV;
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
      case 'dimm': return { x: DIMM_X(idx), y: DIMM_Y, w: DIMM_W, h: DIMM_H };
      case 'cooler': return COOLER;
      case 'display': return MONITOR;
      case 'atx': case 'atx-plus': return PSU;
      case 'pcie': return { x: -2850, y: idx === 0 ? 1030 : 2110, w: idx === 0 ? 3800 : 1800, h: 60 };
      default: return null;
    }
  };

  // ---- scene build: runs on theme change, board tier change, or an install/uninstall ----
  const keyOf = (s: Snapshot | null) =>
    `${T.dark}|${s?.boardTier ?? 0}|${s ? s.devices.map((d) => `${d.spec}@${d.slot}`).join(',') : ''}`;

  function build(s: Snapshot | null) {
    boardBake?.texture.destroy(true); deviceBake?.texture.destroy(true);
    boardBake = null; deviceBake = null;
    clear(boardLayer); clear(deviceLayer); clear(coolerLayer); clear(deviceBakeLayer); clear(fanLayer);
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

    const targets: GlowTarget[] = [];
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
        const p = ramArt(T, spec as RamSpec);
        p.root.position.set(DIMM_X(idx), DIMM_Y);
        deviceLayer.addChild(p.root); parts.push(p);
        const r = { x: DIMM_X(idx), y: DIMM_Y, w: DIMM_W, h: DIMM_H };
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
      } else if (spec.kind === 'display') {
        const p = monitorArt(T, true);
        deviceLayer.addChild(p.root); parts.push(p);
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
    empty('dimm', slots.dimm ?? 0, (i) => ({ x: DIMM_X(i), y: DIMM_Y, w: DIMM_W, h: DIMM_H }));
    empty('cpu', slots.cpu ?? 0, () => PKG);
    empty('cooler', slots.cooler ?? 0, () => COOLER);
    empty('display', slots.display ?? 0, () => MONITOR);
    empty('atx', slots.atx ?? 0, () => PSU);
    empty('atx-plus', slots['atx-plus'] ?? 0, () => PSU);
    empty('pcie', slots.pcie ?? 0, (i) => slotRectOf('pcie' + i)!);
    const emptyG = new Graphics();
    deviceLayer.addChildAt(emptyG, 0);
    for (const h of emptyHits) {
      if (h.id.startsWith('cpu') || h.id.startsWith('pcie') || h.id.startsWith('dimm')) continue; // already drawn by the board
      const r = h.rect;
      const pts: [number, number][] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h], [r.x, r.y]];
      dashed(emptyG, pts, 40, 30);
      emptyG.stroke({ width: 10, color: T.mute, alpha: 0.7 });
      if (h.id.startsWith('display')) {
        box(emptyG, SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h, 30, { fill: SCREEN_BG, fa: 0.4 });
        deviceLayer.addChild(label('NO SIGNAL', r.x + r.w / 2, r.y + r.h / 2, 200, T.mute, { anchor: [0.5, 0.5], head: true }));
      }
      if (h.id.startsWith('atx')) deviceLayer.addChild(label('PSU BAY', r.x + r.w / 2, r.y + r.h / 2, 200, T.mute, { anchor: [0.5, 0.5], head: true }));
    }
    scene.rects.set('board', BD); scene.rects.set('chipset', BR.chip); scene.interactive.add('chipset');
    scene.rects.set('usb', USB_PORT); scene.interactive.add('usb'); scene.usb = USB_PORT;
    scene.rects.set('crate', CRATE); scene.interactive.add('crate');
    scene.rects.set('tray', TRAY); scene.interactive.add('tray');

    mainHits = [...dieHits];
    if (hasPsu) mainHits.push({ id: 'psu.readout', rect: PSU_PANEL });
    if (coolerHit) mainHits.push(coolerHit);
    mainHits.push(...deviceHits, ...emptyHits, { id: 'chipset', rect: BR.chip }, ...REGIONS.filter((r) => r.id !== 'chipset').map((r) => ({ id: r.id, rect: r.rect })));
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

    const needsPcie = (s?.devices ?? []).some((d) => d.slot.startsWith('pcie'));
    const cables = ALL_CABLES.filter((c) => (c.kind === 'video' ? hasDisplay : hasPsu && (c.kind !== 'pcie' || needsPcie)));
    live.setScene(T, targets, boardArt.buses, cables, fans, dram, dimms, { psu: hasPsu, display: hasDisplay });
    pipeline.setTheme(T);
    sceneKey = keyOf(s);
    cableKey = ''; propsKey = '';
    syncCables(s, true);
    syncProps(s, true);
    onZoom();
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
    clear(cableLayer);
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
        cableLayer.addChild(p.root);
        const rs = laneRects(c.path, c.w / 2 + 10);
        cableHits.push({ id: 'cable.' + c.kind, rect: rs[0]!, more: [...rs.slice(1), plugRect(c.a), plugRect(c.b)] });
      } else if (state === 'loose') {
        const p = looseCableArt(T, c);
        cableLayer.addChild(p.root);
        const pad = (r: Rect, e = 30): Rect => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });
        const rs = laneRects(lo.path, c.w * 0.31 + 10);
        cableHits.push({ id: 'cable.' + c.kind, rect: pad(rest), more: [...rs, plugRect(c.kind === 'video' ? c.b : c.a)] });
      }
    }
    live.setConnected(connectedKinds);
    mergeHits();
  }

  // ---- props: crate, tray, power button, the key in the USB port ----
  function syncProps(s: Snapshot | null, force = false) {
    const powered = !!s?.powered, error = s?.phase === 'error' || !!s?.power.tripped;
    powerState = { powered, error, blocked: !!s?.noPowerReason };
    const key = [
      T.dark, s ? s.inventory.map((i) => i.id).join(',') : '', s ? s.tray.map((k) => `${k.id}${urgencyOf(k)}`).join(',') : '',
      s?.plugged ? `${s.plugged.id}${urgencyOf(s.plugged)}${s.plugged.done}` : '-', powered, error,
    ].join('|');
    if (!force && key === propsKey) return;
    propsKey = key;
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
    if (s?.plugged) add(pluggedKeyArt(T, s.plugged));
    add(trayArt(T, s?.tray ?? []));
    add(crateArt(T, s?.inventory ?? []));
    for (const a of propsArt) order.push(...a.objs);
    // hit order: power, plugged key, tray keys, crate parts, then the port, crate and tray bodies
    propHits = [
      ...order.map((o) => ({ id: o.id, rect: o.rect })),
      { id: 'usb', rect: { x: USB_PORT.x - 20, y: USB_PORT.y - 20, w: USB_PORT.w + 40, h: USB_PORT.h + 40 } },
      { id: 'crate', rect: CRATE }, { id: 'tray', rect: TRAY },
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
    camera.minZ = fits.z * 0.7;
    if (was) camera.set(fits); else camera.apply();
  };
  reframe(() => { camera.resize(app.screen.width, app.screen.height); camera.inset = { ...viewInset.peek() }; });
  camera.set(fits);
  app.renderer.on('resize', () => reframe(() => camera.resize(app.screen.width, app.screen.height)));
  effect(() => { const i = viewInset.value; reframe(() => { camera.inset = { ...i }; }); });
  camera.onKey = (k) => (k === 'cpu' ? flyToCpu() : flyToBoard());

  // ---- hit testing: hover and click write the shared signals ----
  const hitAt = (cx: number, cy: number): string | null => {
    const w = camera.toWorld(cx, cy), z = camera.z;
    for (const h of allHits) {
      if ((h.min !== undefined && z < h.min) || (h.max !== undefined && z >= h.max)) continue;
      for (const r of h.more ? [h.rect, ...h.more] : [h.rect]) if (w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h) return h.id;
    }
    return null;
  };
  interact.hitAt = hitAt;
  interact.onHeld = (k) => { held = k; if (lastSnap || k === null) syncCables(lastSnap, true); };
  camera.onHover = (p) => {
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
    live.update(lastSnap, performance.now());
    pipeline.update(lastSnap, true, performance.now());
  });

  // ---- snapshots ----
  effect(() => {
    const s = snapshot.value;
    const fast = speed.peek() >= 4;
    const now = performance.now();
    lastSnap = s;
    if (keyOf(s) !== sceneKey) build(s);
    else { syncCables(s); syncProps(s); }
    live.update(s, now);
    pipeline.update(s, fast, now);
  });

  // ---- frame loop ----
  let lastFrame = performance.now();
  app.ticker.add((tk) => {
    const now = performance.now();
    const dt = tk.deltaMS / 1000;
    camera.update(now);
    live.frame(dt, now);
    pipeline.frame(now);
    syncCables(lastSnap); // optimistic cable state expires on its own
    interact.frame(now, dt);
    if (powerArtRef) drawPowerLeds(T, powerArtRef.led, powerState, now);
    lastFrame = now;
  });
  void lastFrame;

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__board = { camera, app, flyToCpu, flyToBoard, flyTo, interact, scene };
  return app;
}
