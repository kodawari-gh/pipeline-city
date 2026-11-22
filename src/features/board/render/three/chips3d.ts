// The chips alive in 3D (docs/render/three.md): the CPU's die, the graphics cards' and the AI cards' dies run as in 2D.
// The 2D views themselves run here (`DieView`, `GpuView`, `NpuCardView` in their bare mode: only what moves, the still die is the face's baked
// art), fed the same snapshots, the same eased clock, and the zoom and view of the camera. Each face shows them on a plane just over its baked art:
// the part of the face in view, drawn at the screen's density by the offscreen Pixi renderer (`drawLive`) at most 30 times a second, and only
// while the face shows (the lid has faded, the card has swung down).
import { AdditiveBlending, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type CanvasTexture, type Object3D, type PerspectiveCamera } from 'three';
import type { Container } from 'pixi.js';
import type { Snapshot } from '@/worker/protocol';
import { getSpec, type CpuSpec } from '@/features/board/sim/specs';
import { cardOrigin } from '@/core/render/accelart';
import { machineLive } from '@/core/render/fanmotor';
import { DEVICE_LOD, TierBudget, deviceLod, dieShow, seenZoom, smooth, type LodRect } from '@/core/render/lod/lod';
import { builtinTheme } from '@/core/render/theme';
import { DECODE_SRGB, rawSrgb, screenPx, shown, type Rect } from '@/core/render/three/artlod';
import { shareTex } from '@/core/render/three/geometry';
import { seeThrough } from '@/core/render/three/pick';
import { planOf } from '@/features/cpu/render/die/dieart';
import { gpuParts, gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { npuGeo, npuParts } from '@/features/npu/render/npulayout';
import { DieView } from '@/features/cpu/render/die/diemulti';
import { GpuView, type GpuCardScene } from '@/features/gpu/render/gpuview';
import { NpuCardView, type NpuScene } from '@/features/npu/render/npuview';
import { TpmView, type TpmScene } from '@/features/tpm/render/tpmview';
import { NicView, type NicScene } from '@/features/network/render/nic/nicview';
import { BOARD_BAND, nicGeo, nicParts } from '@/features/network/render/nic/niclayout';
import { BOARD_NIC, boardLook } from '@/features/network/render/nic/nicplan';
import { RouterView } from '@/features/network/render/router/routerview';
import { routerParts, type RouterGeo } from '@/features/network/render/router/routerlayout';
import { tpmGeo, tpmParts } from '@/features/tpm/render/tpmlayout';
import { headerRect, tpmHeader } from '@/core/render/accelart';
import { DIE_PLAN, LAYOUT_TIER } from '../layout/layout';
import { npuAccess, routeOnDie } from '../wiring/busmap';
import { drawLive } from './bake';
import { HINGE_Z } from './card3d';
import type { NicLanes } from './nicflow';
import { NicTraceView } from './nictrace';
import { busesOf } from './accelbus';

/** `nictrace`: a network card's copper, lit (nictrace.ts), on the card's component side; the others are dies. */
export type ChipKind = 'die' | 'gpu' | 'npu' | 'tpm' | 'nic' | 'router' | 'nictrace';

/** The finest density a live layer is drawn at (pixels per unit: the dies' finest baked level), its widest side (pixels), its least gap between two drawings (ms). */
const MAX_PX = 10, MAX_SIDE = 2048, FRAME_MS = 33;
/** The live faces at each level of the graphics settings: the least gap between two drawings (ms) and the finest density. Level 2 is the tuned look. */
export const LIVE_LEVELS = [{ ms: FRAME_MS * 2, px: MAX_PX / 2 }, { ms: FRAME_MS, px: MAX_PX / 2 }, { ms: FRAME_MS, px: MAX_PX }, { ms: FRAME_MS / 2, px: MAX_PX }] as const;
/** The view when the camera looks past the plane: everything is in it. */
const EVERYWHERE: LodRect = { x: -1e7, y: -1e7, w: 2e7, h: 2e7 };
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const;
const O = new Vector3(), D = new Vector3(), INV = new Matrix4();

/**
 * Where the camera's view meets the plane at depth `z` of a frame (`inv`: world to that frame; none: the world itself): the layout rect between
 * the corners' rays (null when one of them looks past the plane), and the zoom where the centre's ray meets it (screen pixels per unit, `screenPx`).
 */
export function viewOn(cam: PerspectiveCamera, H: number, z: number, inv?: Matrix4): { rect: LodRect | null; zoom: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, zoom = 0, miss = false;
  for (const [nx, ny] of CORNERS) {
    O.copy(cam.position);
    D.set(nx, ny, 0.5).unproject(cam);
    if (inv) { O.applyMatrix4(inv); D.applyMatrix4(inv); }
    D.sub(O);
    const t = (z - O.z) / D.z;
    if (!(t > 0) || !Number.isFinite(t)) { miss = true; continue; }
    if (nx === 0 && ny === 0) { zoom = screenPx(D.length() * t, cam.fov, H); continue; }
    const x = O.x + D.x * t, y = -(O.y + D.y * t);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { rect: miss ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, zoom };
}

/** The part of a face `r` to draw: the view grown by `margin` of its size each side (a short pan stays covered), inside the face; null when they do not meet. No view: all of it. */
export function liveCrop(r: Rect, view: LodRect | null, margin = 0.1): Rect | null {
  if (!view) return r;
  const mx = view.w * margin, my = view.h * margin;
  const x0 = Math.max(r.x, view.x - mx), y0 = Math.max(r.y, view.y - my), x1 = Math.min(r.x + r.w, view.x + view.w + mx), y1 = Math.min(r.y + r.h, view.y + view.h + my);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** The density to draw a crop at: the screen's (`need`, pixels per unit), no finer than `max` (`MAX_PX`), no side over `side` pixels (`MAX_SIDE`). */
export const livePx = (crop: Rect, need: number, max = MAX_PX, side = MAX_SIDE): number => Math.min(need, max, side / crop.w, side / crop.h);

interface Face {
  kind: ChipKind;
  /** A lit copper's fade-in band over the zoom (a card's, with its dies); the network card's by default. */
  band?: readonly [number, number];
  parent: Object3D;
  rect: Rect;
  z: number;
  mesh: Mesh;
  mat: MeshBasicMaterial;
  canvas: HTMLCanvasElement | null;
  tex: CanvasTexture | null;
  /** The card's slot (a card's face only). */
  slot?: string;
  /** The canvas size the texture was made for, and when the face was last drawn (ms). */
  size: string;
  at: number;
}

const idx = (slot: string) => Number(/\d+$/.exec(slot)?.[0] ?? 0);

export class Chips3D {
  /** The art is the dark theme's, as the machine's. */
  private readonly T = builtinTheme();
  private readonly die = new DieView(true);
  private readonly gpu = new GpuView(true);
  private readonly npu = new NpuCardView(true);
  private readonly tpm = new TpmView(true);
  private readonly nic = new NicView();
  /** The network cards' copper, lit: each frame the die's view launches runs the card's traces first (`traces`). */
  private readonly nicTrace = new NicTraceView();
  /** How much of each card's copper shows (its slot): it comes in once the card lies flat, component side up. */
  private readonly traceAlpha = new Map<string, number>();
  /** The router's plan over its front in the room (`setRouter`), and how much of it shows: the zoom's fade, as the die's. */
  private readonly router = new RouterView();
  private routerGeo: RouterGeo | null = null;
  private routerAlpha = 0;
  /** How much of each network card's die shows (its slot): the lid's fade, as the CPU's (`dieAlpha`). */
  private readonly nicAlpha = new Map<string, number>();
  private nics = new Map<string, { visual: string; index: number }>();
  private tpms = new Map<string, { visual: string; hdr: Rect }>();
  private faces: Face[] = [];
  private cpu = false;
  private cpuSpec: CpuSpec | null = null;
  private cards = new Map<string, { visual: string; origin: { x: number; y: number } }>();
  private snap: Snapshot | null | undefined = undefined;
  /** At most two cards show their counters, the ones nearest the centre (as in 2D). */
  private readonly budget = new TierBudget(2);
  private dieAlpha = 0;
  /** How often and how finely the faces draw: an entry of `LIVE_LEVELS` (the graphics settings, board3d.ts). */
  live: { ms: number; px: number } = LIVE_LEVELS[2];
  /** The chips' clock: game ms, eased by the zoom (board3d.ts). */
  private t = 0;

  constructor() {
    // a core's access shows on the die where it leaves, and in an AI card's window the word lands in its memory or its registers (the 2D's `Live`)
    this.die.onMemory = (e) => {
      const write = e.kind === 'store', hit = routeOnDie(this.die, e.addr, write, this.t), npu = hit?.kind === 'card' ? npuAccess(e.addr) : null;
      if (npu) this.npu.touch(npu.slot, write, npu.off);
    };
    // a frame leaves a card's way: its copper lights first, and the die's packets wait for it (nictrace.ts)
    this.nic.onLaunch = (slot, dir, at, total) => this.nicTrace.launch(slot, dir, at, total);
    // a graphics card's or an AI card's buses: the receive lines and the memory bus light with the words the die's view sends (accelbus.ts)
    const traffic = (slot: string, hops: Parameters<typeof busesOf>[0]) => { for (const [bus, dir] of busesOf(hops)) this.nicTrace.pulse(slot, bus, dir); };
    this.gpu.onTraffic = traffic;
    this.npu.onTraffic = traffic;
  }

  /** A new machine (machine3d.ts): the CPU's floorplan and the cards from its parts; the old faces go, the parts bring their new ones (`face`). */
  setScene(s: Snapshot | null): void {
    this.drop();
    const gpus: GpuCardScene[] = [], npus: NpuScene[] = [];
    let cpu: CpuSpec | null = null;
    for (const d of s?.devices ?? []) {
      const spec = getSpec(d.spec);
      if (spec?.kind === 'cpu') cpu = spec as CpuSpec;
      else if (spec?.kind === 'gpu' || spec?.kind === 'npu') {
        const visual = spec.visual;
        (spec.kind === 'gpu' ? gpus : npus).push({ slot: d.slot, visual, origin: cardOrigin(idx(d.slot), visual) });
      }
    }
    if (cpu) this.die.setPlan(this.T, planOf(cpu)); else this.die.clear();
    this.cpu = !!cpu;
    this.cpuSpec = cpu;
    this.cards = new Map([...gpus, ...npus].map((c) => [c.slot, { visual: c.visual, origin: c.origin }]));
    this.gpu.setScene(this.T, gpus);
    this.npu.setScene(this.T, npus);
    const hdr = tpmHeader(LAYOUT_TIER), mods: TpmScene[] = [];
    for (const d of s?.devices ?? []) { const spec = getSpec(d.spec); if (spec?.kind === 'tpm' && hdr) mods.push({ slot: d.slot, visual: spec.visual, hdr: headerRect(hdr) }); }
    this.tpms = new Map(mods.map((m) => [m.slot, { visual: m.visual, hdr: m.hdr }]));
    this.tpm.setScene(this.T, mods);
    const nics: NicScene[] = [];
    for (const d of s?.devices ?? []) { const spec = getSpec(d.spec); if (spec?.kind === 'nic') nics.push({ slot: d.slot, visual: spec.visual, index: idx(d.slot) }); }
    // (the Ethernet chip on the motherboard is one more die, in a band of its own past the slots': its parts' ids start with `board`)
    const mbps = s?.board.features.ethernetMbps ?? 0;
    if (mbps > 0) nics.push({ slot: BOARD_NIC, visual: boardLook(mbps), index: BOARD_BAND });
    this.nics = new Map(nics.map((n) => [n.slot, { visual: n.visual, index: n.index }]));
    this.nic.setScene(this.T, nics);
    this.nicTrace.setScene(this.T);
    this.traceAlpha.clear();
    // (the router is the room's, not the machine's: the machine brings it back with `setRouter`)
    this.routerGeo = null;
    this.router.setScene(this.T, null);
    this.snap = undefined;
    this.update(s);
  }

  /** The router SoC's die (machine3d.ts): its floorplan's live layer, or none (no router stands). The old router's face goes; the new one brings its own (`face`). */
  setRouter(geo: RouterGeo | null): void {
    this.faces = this.faces.filter((f) => {
      if (f.kind !== 'router') return true;
      this.free(f);
      return false;
    });
    this.routerGeo = geo;
    this.routerAlpha = 0;
    this.router.setScene(this.T, geo ? { tier: geo.tier } : null);
  }

  /**
   * A network card's copper (card3d.ts): its lit lanes on a plane over the card's component side, in `parent` (the frame the card's parts stand in; the lanes' drawing is layout's, y down)
   * at depth `z`. The frames the card's die view launches (`NicView.onLaunch`) run on them, in the colour of the way they go.
   */
  traces(parent: Object3D, slot: string, lanes: NicLanes, z: number, band?: readonly [number, number]): void {
    if (!lanes.media.length && !lanes.host.length) return;
    this.nicTrace.add(slot, lanes);
    this.face(parent, 'nictrace', lanes.rect, z, slot);
    if (band) this.faces[this.faces.length - 1]!.band = band;
  }

  /** Show the live layer of the `kind` view on the face `rect` (layout units) at depth `z` under `parent`: it shows, moves and turns with it. */
  face(parent: Object3D, kind: ChipKind, rect: Rect, z: number, slot?: string): void {
    // (the copper's light is added to the mask under it, as the board's traces are: `BoardLive3D`)
    const light = kind === 'nictrace' ? { blending: AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {};
    const mat = new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0, ...light });
    const mesh = seeThrough(new Mesh(new PlaneGeometry(1, 1), mat));
    mesh.visible = false;
    parent.add(mesh);
    this.faces.push({ kind, parent, rect, z, mesh, mat, canvas: null, tex: null, size: '', at: -Infinity, ...(slot ? { slot } : {}) });
  }

  /** A snapshot: each view's replay gets its part (the 2D's `Live.update` and `DieView.update`). */
  update(s: Snapshot | null): void {
    if (s === this.snap) return;
    this.snap = s;
    this.die.update(s, false, this.t);
    this.gpu.update(s?.gpus, s?.devices, machineLive(s));
    this.npu.update(s?.npus);
    this.tpm.update(s?.tpm);
    this.nic.update(s);
    this.router.update(s);
  }

  /**
   * Per frame, after the camera and the parts' poses (`Machine3D.lod`): the views' zoom and view from the camera and their replays on by `dt` (game
   * seconds, eased by the zoom), then each face that shows draws the part of it in view.
   */
  frame(cam: PerspectiveCamera, H: number, dt: number, paused: boolean, dpr: number): void {
    this.t += dt * 1000;
    cam.updateMatrixWorld();
    const now = performance.now();
    // the die: its zoom, and its tiles' and wash's by the view, as board.ts gives them, read in the die's own frame (its face's parent is drawn
    // at `CPU_S` of it)
    const dieFace = this.faces.find((f) => f.kind === 'die');
    if (this.cpu && dieFace) {
      dieFace.parent.updateWorldMatrix(true, false);
      const v = viewOn(cam, H, dieFace.z, INV.copy(dieFace.parent.matrixWorld).invert()), view = v.rect ?? EVERYWHERE, p = deviceLod(DIE_PLAN, view), seen = seenZoom(v.zoom, p.focus);
      this.dieAlpha = p.onScreen ? dieShow(seen, DIE_PLAN.w) : 0;
      this.die.setZoom(v.zoom, seen, view);
      this.die.frame(this.t, paused, this.dieAlpha > 0.01 && shown(dieFace.parent));
    }
    // the cards: read where they lie once they have swung down
    const v = viewOn(cam, H, HINGE_Z), view = v.rect ?? EVERYWHERE;
    const lod = { view, top: this.budget.assign([...this.gpu.candidates(view), ...this.npu.candidates(view), ...this.tpm.candidates(view)]) };
    this.gpu.setZoom(v.zoom);
    this.npu.setZoom(v.zoom);
    this.tpm.setZoom(v.zoom);
    // a network card's die: read in its own frame as the CPU's is (it folds down with its card, and its lid, which hides it, fades over the die view's band)
    this.nicAlpha.clear();
    for (const f of this.faces) {
      if (f.kind !== 'nic' || !f.slot) continue;
      f.parent.updateWorldMatrix(true, false);
      const nv = viewOn(cam, H, f.z, INV.copy(f.parent.matrixWorld).invert()), nview = nv.rect ?? EVERYWHERE, p = deviceLod(f.rect, nview);
      const alpha = p.onScreen ? dieShow(seenZoom(nv.zoom, p.focus), f.rect.w) : 0;
      this.nicAlpha.set(f.slot, alpha);
      this.nic.setSight(f.slot, { zoom: nv.zoom, view: nview, shown: alpha > 0.01 && shown(f.parent) });
    }
    // a network card's copper: it shows once the card lies flat, component side up (the card's parts band), read in the frame of its component side
    this.traceAlpha.clear();
    for (const f of this.faces) {
      if (f.kind !== 'nictrace' || !f.slot) continue;
      f.parent.updateWorldMatrix(true, false);
      const tv = viewOn(cam, H, f.z, INV.copy(f.parent.matrixWorld).invert()), alpha = shown(f.parent) ? smooth((f.band ?? DEVICE_LOD.nic.parts)[0], (f.band ?? DEVICE_LOD.nic.parts)[1], tv.zoom) : 0;
      this.traceAlpha.set(f.slot, alpha);
      this.nicTrace.setSight(f.slot, { zoom: tv.zoom, shown: alpha > 0.01 });
    }
    this.tpm.frame(dt, true, paused, lod);
    this.nic.frame(dt, true, paused);
    this.nicTrace.frame(this.nic.clock);
    this.gpu.frame(dt, true, paused, lod);
    this.npu.frame(dt, true, paused, lod);
    // the router SoC's die: read in its own frame as the NIC's is (it stands up with its board, and its lid, which hides it, fades over the die view's band)
    const rf = this.routerGeo ? this.faces.find((f) => f.kind === 'router') : undefined;
    if (this.routerGeo && rf) {
      rf.parent.updateWorldMatrix(true, false);
      const rv = viewOn(cam, H, rf.z, INV.copy(rf.parent.matrixWorld).invert()), rview = rv.rect ?? EVERYWHERE, p = deviceLod(rf.rect, rview);
      this.routerAlpha = p.onScreen ? dieShow(seenZoom(rv.zoom, p.focus), rf.rect.w) : 0;
      this.router.setSight({ zoom: rv.zoom, view: rview, shown: this.routerAlpha > 0.01 && shown(rf.parent) });
    }
    this.router.frame(dt, true, paused);
    for (const f of this.faces) this.draw(f, cam, H, dpr, now);
  }

  /**
   * The id of the part of a die the ray through the screen point (`nx`, `ny`: -1 to 1) meets, when the face shows and the zoom is past the part's
   * hover zoom (the 2D hits, `board.ts`): `cpu.<block>` on the CPU, `<slot>.<part>` on a card. The smallest rectangle wins. Null: none.
   */
  hitAt(cam: PerspectiveCamera, H: number, nx: number, ny: number): string | null {
    for (const f of this.faces) {
      if (!f.mesh.visible || f.mat.opacity < 0.5) continue;
      f.parent.updateWorldMatrix(true, false);
      const inv = INV.copy(f.parent.matrixWorld).invert();
      O.copy(cam.position).applyMatrix4(inv);
      D.set(nx, ny, 0.5).unproject(cam).applyMatrix4(inv).sub(O);
      const t = (f.z - O.z) / D.z;
      if (!(t > 0) || !Number.isFinite(t)) continue;
      const x = O.x + D.x * t, y = -(O.y + D.y * t), zoom = viewOn(cam, H, f.z, inv).zoom;
      let best: string | null = null, area = Infinity;
      for (const h of this.partsOf(f)) {
        if (zoom < h.min || x < h.rect.x || x > h.rect.x + h.rect.w || y < h.rect.y || y > h.rect.y + h.rect.h) continue;
        if (h.rect.w * h.rect.h < area) { area = h.rect.w * h.rect.h; best = h.id; }
      }
      if (best) return best;
    }
    return null;
  }

  /** The parts a face's hits can find: the die's blocks (a network card's, or the motherboard's Ethernet chip's: the blocks of its controller's plan, in the die's frame), a card's cells, the router's blocks. */
  private partsOf(f: Face): { id: string; rect: Rect; min: number }[] {
    if (f.kind === 'die') {
      if (!this.cpuSpec) return [];
      return planOf(this.cpuSpec).blocks.filter((b) => b.kind !== 'stage').map((b) => ({ id: 'cpu.' + b.kind, rect: b.rect, min: DEVICE_LOD.die.hover }));
    }
    if (f.kind === 'tpm') {
      const m = f.slot ? this.tpms.get(f.slot) : undefined;
      return m ? tpmParts(tpmGeo(m.visual, m.hdr)).map((p) => ({ id: `${f.slot}.${p.id}`, rect: p.rect, min: p.inner ? DEVICE_LOD.tpm.hover : DEVICE_LOD.tpm.lid })) : [];
    }
    if (f.kind === 'nic') {
      const n = f.slot ? this.nics.get(f.slot) : undefined;
      return n ? nicParts(nicGeo(n.visual, n.index)).map((p) => ({ id: `${f.slot}.${p.id}`, rect: p.rect, min: DEVICE_LOD.nic.hover })) : [];
    }
    if (f.kind === 'router') return this.routerGeo ? routerParts(this.routerGeo).map((p) => ({ id: p.id, rect: p.rect, min: DEVICE_LOD.router.hover })) : [];
    // (a card's lit copper has no parts to point at: it only lights)
    if (f.kind === 'nictrace') return [];
    const c = f.slot ? this.cards.get(f.slot) : undefined;
    if (!c) return [];
    if (f.kind === 'gpu') return gpuParts(gpuPlan(c.visual)).map((p) => ({ id: `${f.slot}.${p.id}`, rect: moveRect(p.rect, c.origin), min: p.inner ? DEVICE_LOD.gpu.hover : DEVICE_LOD.gpu.fan }));
    return npuParts(npuGeo(c.visual)).map((p) => ({ id: `${f.slot}.${p.id}`, rect: moveRect(p.rect, c.origin), min: p.fine ? DEVICE_LOD.npu.fine : p.inner ? DEVICE_LOD.npu.hover : DEVICE_LOD.npu.lid }));
  }

  private viewOf(kind: ChipKind): Container {
    return kind === 'die' ? this.die.root : kind === 'gpu' ? this.gpu.root : kind === 'tpm' ? this.tpm.root : kind === 'nic' ? this.nic.root : kind === 'router' ? this.router.root : kind === 'nictrace' ? this.nicTrace.root : this.npu.root;
  }

  /** Draw a face's live layer: the part of it in view (in its own frame: a card may still be turning), at the screen's density. */
  private draw(f: Face, cam: PerspectiveCamera, H: number, dpr: number, now: number): void {
    // (a card's copper is drawn only while a packet is on it: a quiet card has nothing lit to show)
    const a = f.kind === 'die' ? this.dieAlpha : f.kind === 'router' ? this.routerAlpha : f.kind === 'nic' ? this.nicAlpha.get(f.slot ?? '') ?? 0 : f.kind === 'nictrace' ? (this.nicTrace.busy(f.slot ?? '') ? this.traceAlpha.get(f.slot ?? '') ?? 0 : 0) : 1;
    if (a <= 0.01 || !shown(f.parent)) { f.mesh.visible = false; return; }
    if (now - f.at < this.live.ms) return;
    f.parent.updateWorldMatrix(true, false);
    const v = viewOn(cam, H, f.z, INV.copy(f.parent.matrixWorld).invert()), crop = liveCrop(f.rect, v.rect);
    if (!crop || v.zoom <= 0) { f.mesh.visible = false; return; }
    const canvas = (f.canvas ??= document.createElement('canvas')), got = drawLive(this.viewOf(f.kind), crop, livePx(crop, v.zoom * dpr, this.live.px), canvas);
    if (!got) { f.mesh.visible = false; return; }
    f.at = now;
    const size = `${canvas.width}x${canvas.height}`;
    if (!f.tex || f.size !== size) {
      f.tex?.dispose();
      f.tex = shareTex(rawSrgb(canvas));
      f.mat.map = f.tex;
      f.mat.defines = { ...DECODE_SRGB };
      f.mat.needsUpdate = true;
      f.size = size;
    }
    // the drawing fills the canvas's top left corner (the canvas grows in steps)
    f.tex.repeat.set(got.w / canvas.width, got.h / canvas.height);
    f.tex.offset.set(0, 1 - got.h / canvas.height);
    f.tex.needsUpdate = true;
    f.mesh.position.set(crop.x + crop.w / 2, -(crop.y + crop.h / 2), f.z);
    f.mesh.scale.set(crop.w, crop.h, 1);
    f.mat.opacity = a;
    f.mesh.visible = true;
  }

  private free(f: Face): void {
    f.mesh.removeFromParent();
    f.mesh.geometry.dispose();
    f.tex?.dispose();
    f.mat.dispose();
  }

  private drop(): void {
    for (const f of this.faces) this.free(f);
    this.faces = [];
  }

  dispose(): void {
    this.drop();
    this.die.clear();
    this.nicTrace.clear();
    this.router.setScene(this.T, null);
  }
}
