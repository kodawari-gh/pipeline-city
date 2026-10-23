import { Application, Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import { effect } from '@preact/signals';
import { hover, selected, viewInset } from '../game/hover';
import { snapshot, speed } from '../game/store';
import { BOARD_TIERS, getSpec, type CoolerSpec, type CpuSpec, type PsuSpec, type RamSpec } from '../sim/board/specs';
import type { Snapshot } from '../sim/protocol';
import { buildBoard, type BoardArt } from './boardArt';
import { Camera, type View } from './camera';
import { cableArt, coolerArt, cpuArt, monitorArt, plugRect, psuArt, ramArt, SCREEN_BG, type Part } from './devices';
import { box, clear, dashed, label } from './ink';
import {
  BD, BLOCKS, COOLER, DIE, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, MONITOR, PKG, PSU, PSU_PANEL, REGIONS, SCREEN, STAGES, WORLD, type Rect,
} from './layout';
import { buildCables, laneRects } from './routes';
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

/** View used by the camera keys and exported helpers. */
let cameraRef: Camera | null = null;
export function flyToCpu() { cameraRef?.flyTo(cameraRef.fit({ x: DIE.x - 40, y: DIE.y - 40, w: DIE.w + 80, h: DIE.h + 80 }, 0.9)); }
export function flyToBoard() { cameraRef?.flyTo(cameraRef.fit(WORLD)); }

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
  const pipeline = new PipelineView();
  const live = new Live(app.renderer, T.dark);
  world.addChild(boardLayer, deviceLayer, deviceBakeLayer, fanLayer, coolerLayer, pipeline.root, live.root);
  app.stage.addChild(world);

  const camera = new Camera(world, app.canvas);
  cameraRef = camera;
  let boardArt: BoardArt | null = null;
  /** Far-out LOD: the whole static board baked once into a texture (rebuilt only with the scene). */
  let boardBake: Sprite | null = null;
  let deviceBake: Sprite | null = null;
  const parts: Part[] = [];
  let hits: Hit[] = [];
  let sceneKey = '';
  let lastSnap: Snapshot | null = null;
  let fits: View = { x: 0, y: 0, z: 0.15 };

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
    live.setZoom(z);
  };
  camera.onChange = onZoom;

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

    const newHits: Hit[] = [];
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

    for (const d of s?.devices ?? []) {
      const spec = getSpec(d.spec);
      if (!spec) continue;
      filled.add(d.slot);
      if (spec.kind === 'cpu') {
        const p = cpuArt(T, spec as CpuSpec);
        deviceLayer.addChild(p.root); parts.push(p);
        targets.push({ id: d.id, kind: 'cpu', spec: d.spec, rect: { x: PKG.x - 46, y: PKG.y - 46, w: PKG.w + 92, h: PKG.h + 92 } });
        deviceHits.push({ id: d.spec, rect: PKG, max: Z_DIE });
      } else if (spec.kind === 'ram') {
        const idx = Number(/\d+$/.exec(d.slot)?.[0] ?? 0);
        const p = ramArt(T, spec as RamSpec);
        p.root.position.set(DIMM_X(idx), DIMM_Y);
        deviceLayer.addChild(p.root); parts.push(p);
        const r = { x: DIMM_X(idx), y: DIMM_Y, w: DIMM_W, h: DIMM_H };
        dimms.push(idx);
        targets.push({ id: d.id, kind: 'ram', spec: d.spec, rect: r });
        deviceHits.push({ id: d.spec, rect: r });
        dram = dram.concat((p.chips ?? []).map((c) => ({ x: c.x + r.x, y: c.y + r.y, w: c.w, h: c.h })));
      } else if (spec.kind === 'psu') {
        const p = psuArt(T, spec as PsuSpec);
        deviceLayer.addChild(p.root); parts.push(p);
        if (p.fan) { fans.push({ c: p.fan, kind: 'psu' }); fanLayer.addChild(p.fan); }
        if (p.over) fanLayer.addChild(p.over);
        deviceHits.push({ id: d.spec, rect: PSU });
        hasPsu = true;
      } else if (spec.kind === 'cooler') {
        const p = coolerArt(T, spec as CoolerSpec);
        coolerLayer.addChild(p.root); parts.push(p);
        if (p.fan) fans.push({ c: p.fan, kind: 'cooler' });
        coolerHit = { id: d.spec, rect: COOLER, max: Z_DIE };
      } else if (spec.kind === 'display') {
        const p = monitorArt(T, true);
        deviceLayer.addChild(p.root); parts.push(p);
        targets.push({ id: d.id, kind: 'display', spec: d.spec, rect: MONITOR });
        deviceHits.push({ id: d.spec, rect: MONITOR });
        hasDisplay = true;
      }
    }
    // empty slots: visible sockets / bays, hit by slot id
    const emptyHits: Hit[] = [];
    const empty = (type: string, n: number, rectOf: (i: number) => Rect) => {
      for (let i = 0; i < n; i++) if (!filled.has(`${type}${i}`)) emptyHits.push({ id: `${type}${i}`, rect: rectOf(i) });
    };
    empty('dimm', slots.dimm ?? 0, (i) => ({ x: DIMM_X(i), y: DIMM_Y, w: DIMM_W, h: DIMM_H }));
    empty('cpu', slots.cpu ?? 0, () => PKG);
    empty('cooler', slots.cooler ?? 0, () => COOLER);
    empty('display', slots.display ?? 0, () => MONITOR);
    empty('atx', slots.atx ?? 0, () => PSU);
    empty('atx-plus', slots['atx-plus'] ?? 0, () => PSU);
    empty('pcie', slots.pcie ?? 0, (i) => ({ x: -2850, y: i === 0 ? 1030 : 2110, w: i === 0 ? 3800 : 1800, h: 60 }));
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

    // cables: PSU to the board connectors, board to the monitor. A cable exists only if both of its ends do.
    const cableHits: Hit[] = [];
    const needsPcie = (s?.devices ?? []).some((d) => d.slot.startsWith('pcie'));
    const cables = buildCables().filter((c) => (c.kind === 'video' ? hasDisplay : hasPsu && (c.kind !== 'pcie' || needsPcie)));
    for (const c of cables) {
      const p = cableArt(T, c);
      deviceLayer.addChild(p.root); parts.push(p);
      const rs = laneRects(c.path, c.w / 2 + 10);
      cableHits.push({ id: 'cable.' + c.kind, rect: rs[0]!, more: [...rs.slice(1), plugRect(c.a), plugRect(c.b)] });
    }
    if (hasPsu) cableHits.push({ id: 'psu.readout', rect: PSU_PANEL });

    newHits.push(...cableHits, ...dieHits);
    if (coolerHit) newHits.push(coolerHit);
    newHits.push(...deviceHits, ...emptyHits, ...REGIONS.map((r) => ({ id: r.id, rect: r.rect })));
    hits = newHits;

    // far-out LOD for everything static in the device layer (labels of the CPU and DIMMs stay out of the bake)
    for (const p of parts) if (p.labels) p.labels.visible = false;
    deviceLayer.visible = true;
    const wf = new Rectangle(WORLD.x, WORLD.y, WORLD.w, WORLD.h);
    deviceBake = new Sprite(app.renderer.generateTexture({ target: deviceLayer, frame: wf, resolution: DEV_BAKE_RES, antialias: true }));
    deviceBake.position.set(wf.x, wf.y);
    deviceBakeLayer.addChild(deviceBake);

    live.setScene(T, targets, boardArt.buses, cables, fans, dram, dimms, { psu: hasPsu, display: hasDisplay });
    pipeline.setTheme(T);
    sceneKey = keyOf(s);
    onZoom();
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
    for (const h of hits) {
      if ((h.min !== undefined && z < h.min) || (h.max !== undefined && z >= h.max)) continue;
      for (const r of h.more ? [h.rect, ...h.more] : [h.rect]) if (w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h) return h.id;
    }
    return null;
  };
  camera.onHover = (p) => {
    if (!p) { if (hover.peek()) hover.value = null; return; }
    const id = hitAt(p.x, p.y);
    if (id) hover.value = { id, x: p.x, y: p.y };
    else if (hover.peek()) hover.value = null;
  };
  camera.onClick = (cx, cy) => { selected.value = hitAt(cx, cy); };

  // ---- theme: react to data-theme / OS scheme changes ----
  onThemeChange(() => {
    T = readTheme();
    app.renderer.background.color = T.bg;
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
    live.update(s, now);
    pipeline.update(s, fast, now);
  });

  // ---- frame loop ----
  app.ticker.add((tk) => {
    const now = performance.now();
    camera.update(now);
    live.frame(tk.deltaMS / 1000, now);
    pipeline.frame(now);
  });

  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__board = { camera, app, flyToCpu, flyToBoard };
  return app;
}
