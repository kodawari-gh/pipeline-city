// The power and airflow lenses in 3D (docs/render/interact.md, lenses): the 2D lenses themselves (`PowerLens`, `AirflowLens`) run unchanged, fed the
// same models. Their picture (the room dimmed, the electrical map or the air over it) is drawn by the offscreen Pixi renderer onto a plane that
// stands at the board's depth and covers the view, drawn over everything: seen flat it is the 2D lens, seen from an angle it is a sheet laid over the
// machine.
import { Container } from 'pixi.js';
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type PerspectiveCamera, type Scene } from 'three';
import type { Snapshot } from '@/worker/protocol';
import { assignLeads } from '../../sim/cables';
import { BOARD_TIERS, getSpec } from '../../sim/specs';
import { airflowLens, powerLens } from '@/app/hover';
import { cardOrigin, cardPlugs, tpmRect } from '@/core/render/accelart';
import { builtinTheme } from '@/core/render/theme';
import { seeThrough } from '@/core/render/three/pick';
import { AIR_SOURCES } from '@/features/room/render/desk/airsources';
import { AirflowLens, airflowModel } from '@/features/room/render/desk/airflow';
import { PowerLens, lensModel } from '@/features/room/render/desk/lens';
import { fanMounts, radiatorSpan } from '@/features/room/render/desk/props/case';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { slotRect as storageSlotRect } from '@/features/storage/render/drives';
import {
  CASE_GLASS, COOLER, DIMM_H, DIMM_W, DIMM_X, DIMM_Y, LAYOUT_CASE, LAYOUT_TIER, MONITOR, PCIE_RAILS, PKG, PSU, RAM_SINK, REAR_FAN, REAR_FAN_FITTED, VRM_SINK, type Rect,
} from '../layout/layout';
import { buildBuses, buildCables, type Cable, type Bus, type PcieTarget } from '../wiring/routes';
import { CORD_KINDS, cordPlan, cordRoute, type CordKind } from '../wiring/cords';
import { drawLive } from './bake';
import { liveCrop, livePx, viewOn } from './chips3d';
import type { RoomGeo } from '@/features/room/render/shell/room';

type Pt = [number, number];
const Z = BOARD_Z + 300;
const idx = (slot: string) => Number(/\d+$/.exec(slot)?.[0] ?? 0);

/** Where each socket of the board and the case is, by slot id (the 2D board's `scene.slots`). */
export function slotRects(s: Snapshot): Map<string, Rect> {
  const m = new Map<string, Rect>(), slots = BOARD_TIERS[s.boardTier]?.slots ?? {};
  const add = (type: string, n: number, of: (i: number) => Rect | null) => { for (let i = 0; i < n; i++) { const r = of(i); if (r) m.set(`${type}${i}`, r); } };
  add('dimm', slots.dimm ?? 0, (i) => ({ x: DIMM_X(i), y: DIMM_Y(i), w: DIMM_W, h: DIMM_H }));
  add('cpu', slots.cpu ?? 0, () => PKG);
  add('cooler', slots.cooler ?? 0, () => COOLER);
  add('display', slots.display ?? 0, () => MONITOR);
  add('atx', slots.atx ?? 0, () => PSU);
  add('atx-plus', slots['atx-plus'] ?? 0, () => PSU);
  add('pcie', slots.pcie ?? 0, (i) => { const r = PCIE_RAILS[i]; return r ? { x: r.x, y: r.y - 20, w: r.w, h: r.h + 40 } : null; });
  add('vrm-sink', slots['vrm-sink'] ?? 0, () => VRM_SINK);
  add('ram-sink', slots['ram-sink'] ?? 0, () => RAM_SINK);
  add('tpm', slots.tpm ?? 0, () => tpmRect(LAYOUT_TIER));
  for (const side of ['front', 'top'] as const) { const span = radiatorSpan(side); if (span) m.set(`rad-${side}`, span.rect); }
  add('sata', slots.sata ?? 0, (i) => storageSlotRect('sata' + i));
  add('m2', slots.m2 ?? 0, (i) => storageSlotRect('m2' + i));
  return m;
}

/** The PSU's leads as the 2D board routes them: the PCIe ones to the sockets of the cards they were dealt to. */
function cablesOf(s: Snapshot): Cable[] {
  const cards = s.devices.filter((d) => (d.kind === 'gpu' || d.kind === 'npu') && !d.burnt).map((d) => ({ slot: d.slot, loadW: getSpec(d.spec)!.loadW, visual: (getSpec(d.spec) as { visual: string }).visual }));
  const targets = assignLeads(cards).filter((l) => s.cables.some((c) => c.id === l.lead)).map((l): PcieTarget => {
    const card = cards.find((c) => c.slot === l.slot)!, o = cardOrigin(idx(l.slot), card.visual);
    return { kind: l.lead, x: o.x + (cardPlugs(card.visual)[l.plug] ?? 0), top: o.y, plug: l.plug };
  });
  const hasPsu = s.devices.some((d) => d.kind === 'psu'), hasDisplay = s.devices.some((d) => d.kind === 'display');
  return buildCables(targets).filter((c) => (c.kind === 'video' ? hasDisplay : hasPsu));
}

export class Lens3D {
  private readonly T = builtinTheme(true);
  private readonly power = new PowerLens();
  private readonly air = new AirflowLens();
  private readonly mat = new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  private readonly mesh = seeThrough(new Mesh(new PlaneGeometry(1, 1), this.mat));
  private readonly both = new Container();
  private canvas: HTMLCanvasElement | null = null;
  private tex: CanvasTexture | null = null;
  private size = '';
  private powerKey: unknown = null;
  private airKey: unknown = null;
  private buses: Bus[] | null = null;
  private busKey = '';
  private t = 0;
  private at = -Infinity;

  constructor(scene: Scene) {
    this.power.setTheme(this.T);
    this.air.setTheme(this.T);
    this.mesh.visible = false;
    this.mesh.renderOrder = 1000;
    scene.add(this.mesh);
    this.both.addChild(this.power.root, this.air.root);
  }

  /** Per frame (after the camera): draw the lens that is on over the view, or hide the plane. `dt` in game seconds. */
  frame(cam: PerspectiveCamera, H: number, s: Snapshot | null, geo: RoomGeo, dt: number): void {
    const wantPower = powerLens.peek() && !!s, wantAir = airflowLens.peek() && !!s;
    if (!wantPower && !wantAir) { this.mesh.visible = false; this.powerKey = this.airKey = null; return; }
    const snap = s!;
    if (wantPower) {
      const key = [snap, LAYOUT_TIER, LAYOUT_CASE];
      if (!this.powerKey || (this.powerKey as unknown[]).some((v, i) => v !== key[i])) {
        this.powerKey = key;
        const bk = `${LAYOUT_TIER}|${LAYOUT_CASE}`;
        if (bk !== this.busKey || !this.buses) { this.busKey = bk; this.buses = buildBuses(); }
        const plan = cordPlan(geo);
        const cords = CORD_KINDS.map((k: CordKind) => {
          const pl = plan[k], connected = !!snap.cables.find((c) => c.id === k)?.connected, at: Pt = connected ? pl.outlet : pl.rest;
          return { kind: k, connected, plugAt: at, route: cordRoute(pl, at), outlet: pl.outlet };
        });
        this.power.setModel(lensModel({ s: snap, cords, cables: cablesOf(snap), buses: this.buses, slots: slotRects(snap), monitor: MONITOR }));
      }
    } else this.powerKey = null;
    if (wantAir) {
      if (this.airKey !== snap) {
        this.airKey = snap;
        const dev = snap.devices.find((d) => d.kind === 'radiator'), span = dev ? radiatorSpan(dev.slot === 'rad-front' ? 'front' : 'top') : null;
        this.air.setModel(airflowModel({
          s: snap, mounts: fanMounts(), radiator: span ? { side: span.side as 'front' | 'top', ids: span.ids, rect: span.rect } : null,
          rearFitted: REAR_FAN_FITTED, rear: REAR_FAN, glass: CASE_GLASS, slots: slotRects(snap), sources: AIR_SOURCES,
        }));
      }
    } else this.airKey = null;

    const now = performance.now(), dpr = Math.min(2, window.devicePixelRatio || 1);
    this.t += dt;
    cam.updateMatrixWorld();
    const v = viewOn(cam, H, Z), world = { x: -1e5, y: -1e5, w: 2e5, h: 2e5 }, crop = v.zoom > 0 && v.rect ? liveCrop(world, v.rect, 0.05) : null;
    if (!crop) { this.mesh.visible = false; return; }
    // the lens draws over the view as a 2D camera at this zoom would show it
    const z = v.zoom, view = { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2, z, cx: (crop.w * z) / 2, cy: (crop.h * z) / 2, w: crop.w * z, h: crop.h * z };
    this.power.frame(wantPower, view, dt, now);
    this.air.frame(wantAir, view, dt, now);
    if (now - this.at < 33) { this.mesh.visible = true; return; }
    const canvas = (this.canvas ??= document.createElement('canvas'));
    const got = drawLive(this.both, crop, livePx(crop, z * dpr), canvas);
    if (!got) { this.mesh.visible = false; return; }
    this.at = now;
    const size = `${canvas.width}x${canvas.height}`;
    if (!this.tex || this.size !== size) {
      this.tex?.dispose();
      this.tex = new CanvasTexture(canvas);
      this.tex.colorSpace = SRGBColorSpace;
      this.mat.map = this.tex;
      this.mat.needsUpdate = true;
      this.size = size;
    }
    this.tex.repeat.set(got.w / canvas.width, got.h / canvas.height);
    this.tex.offset.set(0, 1 - got.h / canvas.height);
    this.tex.needsUpdate = true;
    this.mesh.position.set(crop.x + crop.w / 2, -(crop.y + crop.h / 2), Z);
    this.mesh.scale.set(crop.w, crop.h, 1);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.tex?.dispose();
    this.mat.dispose();
  }
}
