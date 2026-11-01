// The chips alive in 3D (docs/GRAPHICS_3D_OVERHAUL.md "Inside the case"): the CPU's die, the graphics cards' and the AI cards' dies run as in 2D.
// The 2D views themselves run here (`DieView`, `GpuView`, `NpuCardView` in their bare mode: only what moves, the still die is the face's baked
// art), fed the same snapshots, the same eased clock, and the zoom and view of the camera. Each face shows them on a plane just over its baked art:
// the part of the face in view, drawn at the screen's density by the offscreen Pixi renderer (`drawLive`) at most 30 times a second, and only
// while the face shows (the lid has faded, the card has swung down).
import { CanvasTexture, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import type { Container } from 'pixi.js';
import type { Snapshot } from '@/worker/protocol';
import { getSpec, type CpuSpec } from '@/features/board/sim/specs';
import { cardOrigin } from '@/core/render/accelart';
import { machineLive } from '@/core/render/fanmotor';
import { DEVICE_LOD, TierBudget, deviceLod, seenZoom, smooth, type LodRect } from '@/core/render/lod/lod';
import { builtinTheme } from '@/core/render/theme';
import { screenPx, shown, type Rect } from '@/core/render/three/artlod';
import { seeThrough } from '@/core/render/three/pick';
import { planOf } from '@/features/cpu/render/die/dieart';
import { gpuParts, gpuPlan, moveRect } from '@/features/gpu/render/gpulayout';
import { npuGeo, npuParts } from '@/features/npu/render/npulayout';
import { DieView } from '@/features/cpu/render/die/diemulti';
import { GpuView, type GpuCardScene } from '@/features/gpu/render/gpuview';
import { NpuCardView, type NpuScene } from '@/features/npu/render/npuview';
import { TpmView, type TpmScene } from '@/features/tpm/render/tpmview';
import { tpmGeo, tpmParts } from '@/features/tpm/render/tpmlayout';
import { headerRect, tpmHeader } from '@/core/render/accelart';
import { DIE_PLAN, LAYOUT_TIER } from '../layout/layout';
import { npuAccess, routeOnDie } from '../wiring/busmap';
import { drawLive } from './bake';
import { HINGE_Z } from './card3d';

export type ChipKind = 'die' | 'gpu' | 'npu' | 'tpm';

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

/** The density to draw a crop at: the screen's (`need`, pixels per unit), no finer than `MAX_PX`, no side over `MAX_SIDE` pixels. */
export const livePx = (crop: Rect, need: number, max = MAX_PX): number => Math.min(need, max, MAX_SIDE / crop.w, MAX_SIDE / crop.h);

interface Face {
  kind: ChipKind;
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
  private readonly T = builtinTheme(true);
  private readonly die = new DieView(true);
  private readonly gpu = new GpuView(true);
  private readonly npu = new NpuCardView(true);
  private readonly tpm = new TpmView();
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
    this.snap = undefined;
    this.update(s);
  }

  /** Show the live layer of the `kind` view on the face `rect` (layout units) at depth `z` under `parent`: it shows, moves and turns with it. */
  face(parent: Object3D, kind: ChipKind, rect: Rect, z: number, slot?: string): void {
    const mat = new MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 });
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
      this.dieAlpha = p.onScreen ? smooth(DEVICE_LOD.die.fade[0], DEVICE_LOD.die.fade[1], seen) : 0;
      this.die.setZoom(v.zoom, seen, view);
      this.die.frame(this.t, paused, this.dieAlpha > 0.01 && shown(dieFace.parent));
    }
    // the cards: read where they lie once they have swung down
    const v = viewOn(cam, H, HINGE_Z), view = v.rect ?? EVERYWHERE;
    const lod = { view, top: this.budget.assign([...this.gpu.candidates(view), ...this.npu.candidates(view), ...this.tpm.candidates(view)]) };
    this.gpu.setZoom(v.zoom);
    this.npu.setZoom(v.zoom);
    this.tpm.setZoom(v.zoom);
    this.tpm.frame(dt, true, paused, lod);
    this.gpu.frame(dt, true, paused, lod);
    this.npu.frame(dt, true, paused, lod);
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

  private partsOf(f: Face): { id: string; rect: Rect; min: number }[] {
    if (f.kind === 'die') {
      if (!this.cpuSpec) return [];
      return planOf(this.cpuSpec).blocks.filter((b) => b.kind !== 'stage').map((b) => ({ id: 'cpu.' + b.kind, rect: b.rect, min: DEVICE_LOD.die.hover }));
    }
    if (f.kind === 'tpm') {
      const m = f.slot ? this.tpms.get(f.slot) : undefined;
      return m ? tpmParts(tpmGeo(m.visual, m.hdr)).map((p) => ({ id: `${f.slot}.${p.id}`, rect: p.rect, min: p.inner ? DEVICE_LOD.tpm.hover : DEVICE_LOD.tpm.lid })) : [];
    }
    const c = f.slot ? this.cards.get(f.slot) : undefined;
    if (!c) return [];
    if (f.kind === 'gpu') return gpuParts(gpuPlan(c.visual)).map((p) => ({ id: `${f.slot}.${p.id}`, rect: moveRect(p.rect, c.origin), min: p.inner ? DEVICE_LOD.gpu.hover : DEVICE_LOD.gpu.fan }));
    return npuParts(npuGeo(c.visual)).map((p) => ({ id: `${f.slot}.${p.id}`, rect: moveRect(p.rect, c.origin), min: p.fine ? DEVICE_LOD.npu.fine : p.inner ? DEVICE_LOD.npu.hover : DEVICE_LOD.npu.lid }));
  }

  private viewOf(kind: ChipKind): Container {
    return kind === 'die' ? this.die.root : kind === 'gpu' ? this.gpu.root : kind === 'tpm' ? this.tpm.root : this.npu.root;
  }

  /** Draw a face's live layer: the part of it in view (in its own frame: a card may still be turning), at the screen's density. */
  private draw(f: Face, cam: PerspectiveCamera, H: number, dpr: number, now: number): void {
    const a = f.kind === 'die' ? this.dieAlpha : 1;
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
      f.tex = new CanvasTexture(canvas);
      f.tex.colorSpace = SRGBColorSpace;
      f.mat.map = f.tex;
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

  private drop(): void {
    for (const f of this.faces) {
      f.mesh.removeFromParent();
      f.mesh.geometry.dispose();
      f.tex?.dispose();
      f.mat.dispose();
    }
    this.faces = [];
  }

  dispose(): void {
    this.drop();
    this.die.clear();
  }
}
