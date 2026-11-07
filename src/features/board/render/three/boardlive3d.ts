// The board's live layer in 3D: the 2D renderer's own `Live` (core/render/live.ts) runs unchanged, fed the same snapshot, and draws the traffic on the
// buses, the power the rails carry, the regulator's state, the OS badge and the dead board. Its picture is drawn by the offscreen Pixi renderer
// onto a plane that lies on the board (just over its face, under every raised part), cropped to what the camera sees, so seen from an angle it
// is the board's own glow, not a sheet over the view. What 3D shows another way is left out: the dies (`Chips3D`), the parts' glows (their
// `PartSkin`), the RAM map, the cards and the wall cords.
import { Mesh, MeshBasicMaterial, AdditiveBlending, PlaneGeometry, type CanvasTexture, type PerspectiveCamera, type Scene } from 'three';
import type { Snapshot } from '@/worker/protocol';
import { builtinTheme } from '@/core/render/theme';
import { Live } from '@/core/render/live';
import { DECODE_SRGB, rawSrgb } from '@/core/render/three/artlod';
import { seeThrough } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { getSpec } from '@/features/board/sim/specs';
import { BD, LAYOUT_CASE, LAYOUT_TIER, SCREEN } from '../layout/layout';
import { buildBuses } from '../wiring/routes';
import { bakeRenderer, drawLive } from './bake';
import { liveCrop, livePx, viewOn } from './chips3d';

/** The plane's depth: over the board's face, under the raised parts. */
const Z = BOARD_Z + 3;
const idx = (slot: string) => Number(/\d+$/.exec(slot)?.[0] ?? 0);

export class BoardLive3D {
  private readonly T = builtinTheme(true);
  private live: Live | null = null;
  private readonly mat = new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending: AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private readonly mesh = seeThrough(new Mesh(new PlaneGeometry(1, 1), this.mat));
  private canvas: HTMLCanvasElement | null = null;
  private tex: CanvasTexture | null = null;
  private size = '';
  private sceneKey = '';
  private at = -Infinity;
  private lastSnap: Snapshot | null = null;

  constructor(scene: Scene) {
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  /** The scene Live draws for: rebuilt when the tier, the case or the installed parts change. */
  private build(s: Snapshot): void {
    const r = bakeRenderer();
    if (!r) return;
    this.live ??= new Live(r, this.T.dark);
    const dimms = s.devices.filter((d) => d.kind === 'ram').map((d) => idx(d.slot));
    const disp = s.devices.find((d) => d.kind === 'display');
    this.live.setScene(this.T, [], buildBuses(), [], [], [], dimms, { psu: s.devices.some((d) => d.kind === 'psu'), display: !!disp, gfx: !!(getSpec(disp?.spec ?? '') as { graphics?: boolean } | undefined)?.graphics });
    this.live.setConnected(new Set(s.cables.filter((c) => c.connected).map((c) => c.id)) as never);
    this.sceneKey = this.keyOf(s);
  }

  private keyOf(s: Snapshot): string { return `${LAYOUT_TIER}|${LAYOUT_CASE}|${s.devices.map((d) => `${d.spec}@${d.slot}`).join(',')}|${s.cables.map((c) => +c.connected).join('')}`; }

  /** Per frame (after the camera): advance the board's animation and draw it over the part of the board in view. `gt` the game clock (ms), `gdt` its step (s). */
  frame(cam: PerspectiveCamera, H: number, s: Snapshot | null, gt: number, gdt: number, paused: boolean, dpr: number, on: boolean): void {
    if (!s || !on) { this.mesh.visible = false; this.screen = null; return; }
    if (!this.live || this.sceneKey !== this.keyOf(s)) this.build(s);
    const live = this.live;
    if (!live) { this.mesh.visible = false; return; }
    cam.updateMatrixWorld();
    const v = viewOn(cam, H, Z), crop = v.zoom > 0 && v.rect ? liveCrop(BD, v.rect, 0.05) : null;
    live.setZoom(v.zoom);
    if (v.rect) live.setView(v.rect);
    live.setInterior(!!crop);
    if (this.lastSnap !== s) { live.update(s, gt); live.setPlugged(!!s.plugged); this.lastSnap = s; }
    live.frame(gdt, gt, paused);
    this.drawScreen(live, s);
    if (!crop) { this.mesh.visible = false; return; }
    const now = performance.now();
    if (now - this.at < 33) { this.mesh.visible = true; return; }
    const canvas = (this.canvas ??= document.createElement('canvas'));
    const got = drawLive(live.root, crop, livePx(crop, v.zoom * dpr), canvas);
    if (!got) { this.mesh.visible = false; return; }
    this.at = now;
    const size = `${canvas.width}x${canvas.height}`;
    if (!this.tex || this.size !== size) {
      this.tex?.dispose();
      this.tex = rawSrgb(canvas);
      this.mat.map = this.tex;
      this.mat.defines = { ...DECODE_SRGB };
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

  /** The monitor's screen, drawn by `Live` at the screen's own resolution (about 15 times a second), or null while the monitor is off or absent. */
  screen: { canvas: HTMLCanvasElement; w: number; h: number } | null = null;
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenAt = -Infinity;

  private drawScreen(live: Live, s: Snapshot): void {
    if (!s.monitorPowered || !s.devices.some((d) => d.kind === 'display')) { this.screen = null; return; }
    const now = performance.now();
    if (this.screen && now - this.screenAt < 66) return;
    const canvas = (this.screenCanvas ??= document.createElement('canvas'));
    const got = drawLive(live.ext, SCREEN, 1280 / SCREEN.w, canvas);
    this.screen = got ? { canvas, ...got } : null;
    if (got) {
      // the 2D screen is drawn over the panel's dark glass: under a blank screen's faint art the texture would be clear, and its colour alone (no alpha) would show
      const c = canvas.getContext('2d')!;
      c.globalCompositeOperation = 'destination-over'; c.fillStyle = '#0d1116'; c.fillRect(0, 0, got.w, got.h); c.globalCompositeOperation = 'source-over';
    }
    this.screenAt = now;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.tex?.dispose();
    this.mat.dispose();
  }
}
