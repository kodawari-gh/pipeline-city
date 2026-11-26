// The board's live layer in 3D: the 2D renderer's own `Live` (core/render/live.ts) runs unchanged, fed the same snapshot, and draws the traffic on the
// buses, the power the rails carry, the regulator's state, the OS badge and the dead board. Its picture is drawn by the offscreen Pixi renderer
// onto a plane that lies on the board (just over its face, under every raised part), cropped to what the camera sees, so seen from an angle it
// is the board's own glow, not a sheet over the view. What 3D shows another way, or not at all, is left out: the dies (`Chips3D`), the parts' glows (a
// running part has none in 3D), the RAM map, the cards and the wall cords.
// It is cheap by design (docs/render/live.md "Performance"): `Live` runs, and the plane is drawn, at most every 33 ms (not once per frame) at no more than
// 1024 px, the packets are two plain strokes a lane, and the byte-by-byte RAM diff is skipped.
// Two things the 2D board did for `Live` are done here (docs/render/live.md "Activity"): it runs on the world's clock, the one the dies replay on (a
// pause stops it, the fast speeds do not blur it, a close zoom slows it), and the CPU's replay (`DieTraffic`) tells it what the core reaches for and
// which interrupts it takes, so the sticks, the drives and the cards answer on their own lanes while the machine runs, not only while it boots.
import {
  Mesh,
  MeshBasicMaterial,
  AdditiveBlending,
  PlaneGeometry,
  type CanvasTexture,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import type { Snapshot } from '@/worker/protocol';
import { builtinTheme } from '@/core/render/theme';
import { Live } from '@/core/render/live';
import { DECODE_SRGB, rawSrgb } from '@/core/render/three/artlod';
import { seeThrough } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { getSpec, type CpuSpec } from '@/features/board/sim/specs';
import { planOf } from '@/features/cpu/render/die/dieart';
import { DieTraffic } from '@/features/cpu/render/die/dietraffic';
import { driveKindOf } from '@/features/storage/render/drives';
import { BD, LAYOUT_CASE, LAYOUT_TIER, SCREEN } from '../layout/layout';
import { buildBuses } from '../wiring/routes';
import { bakeRenderer, drawLive } from './bake';
import { LIVE_LEVELS, liveCrop, livePx, viewOn } from './chips3d';

/** The plane's depth: over the board's face, under the raised parts. */
const Z = BOARD_Z + 3;
/** The widest the traces are drawn (pixels): they are thin lit lines, a soft glow on the board, not a die's art, so they need no more than this. */
const TRACE_SIDE = 1024;
/** The least gap between two drawings of the traces (ms): a packet's trip is 170 ms or more, so 30 a second is smooth; a finer "Live chips" level does not draw them faster. */
const TRACE_MS = 33;
const idx = (slot: string) => Number(/\d+$/.exec(slot)?.[0] ?? 0);
/** A drive that `Live` draws no art for (the 3D drives have their own look): it still lights its lanes. */
const NO_BODY = { x: 0, y: 0, w: 0, h: 0 };

export class BoardLive3D {
  private readonly T = builtinTheme();
  private live: Live | null = null;
  /** The board's clock (ms): the world's pace summed up (`frame`'s `gdt`), the clock the dies replay on, not the room's day. */
  private t = 0;
  /** What the CPU reaches for, replayed with nothing drawn: each reach lights the lanes of the stick or the device that answers (`Live.touchRam`). */
  private readonly traffic = new DieTraffic();
  private cpuKey = '';
  private readonly mat = new MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly mesh = seeThrough(new Mesh(new PlaneGeometry(1, 1), this.mat));
  private canvas: HTMLCanvasElement | null = null;
  private tex: CanvasTexture | null = null;
  private size = '';
  private sceneKey = '';
  /** When `Live` last ran its frame and the time it is owed (s): they run together, at most every `TRACE_MS` or `level.ms` (see `frame`). */
  private liveAt = -Infinity;
  private owed = 0;
  /** `Live` has run since the traces were last drawn: a new picture is due. */
  private fresh = true;
  private lastSnap: Snapshot | null = null;
  /** How often and how finely the traces draw: an entry of `LIVE_LEVELS` (the graphics settings; the game's and Build my PC's stages set it). */
  level: { ms: number; px: number } = LIVE_LEVELS[2];

  constructor(scene: Scene) {
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    // (the 2D board's `die.onMemory` and `die.onInterrupt`)
    this.traffic.onMemory = (e) => this.live?.touchRam(e.kind, e.addr, e.core);
    this.traffic.onInterrupt = (line) => this.live?.touchIrq(line);
  }

  /** The scene Live draws for: rebuilt when the tier, the case or the installed parts change. */
  private build(s: Snapshot): void {
    const r = bakeRenderer();
    if (!r) return;
    this.live ??= new Live(r);
    const dimms = s.devices.filter((d) => d.kind === 'ram').map((d) => idx(d.slot));
    const disp = s.devices.find((d) => d.kind === 'display');
    // (a drive with no art: `Live` reads its busy flag and its byte counters from every snapshot, and lights its lanes while it moves data)
    const drives = (s.storage ?? []).map((d) => ({
      slot: d.slot,
      deviceId: d.deviceId,
      kind: driveKindOf((getSpec(d.spec) as { visual?: string } | undefined)?.visual ?? ''),
      body: NO_BODY,
      g: null,
      lane: null,
    }));
    this.live.setScene({
      T: this.T,
      targets: [],
      buses: buildBuses(),
      cables: [],
      fans: [],
      dramChips: [],
      dimms,
      flags: {
        psu: s.devices.some((d) => d.kind === 'psu'),
        display: !!disp,
        gfx: !!(getSpec(disp?.spec ?? '') as { graphics?: boolean } | undefined)?.graphics,
      },
      drives,
    });
    this.live.setConnected(new Set(s.cables.filter((c) => c.connected).map((c) => c.id)) as never);
    this.sceneKey = this.keyOf(s);
    // the CPU's replay follows the CPU: a new one, a new plan (the cycles it was playing are the old one's)
    const cpu = s.devices.find((d) => d.kind === 'cpu'),
      spec = cpu ? getSpec(cpu.spec) : undefined,
      key = spec?.kind === 'cpu' ? cpu!.spec : '';
    if (key !== this.cpuKey) {
      this.cpuKey = key;
      this.traffic.setPlan(key ? planOf(spec as CpuSpec) : null);
    }
    // (a new scene and a new replay start from the snapshot as it stands: a paused game sends no other)
    this.lastSnap = null;
  }

  private keyOf(s: Snapshot): string {
    return `${LAYOUT_TIER}|${LAYOUT_CASE}|${s.devices.map((d) => `${d.spec}@${d.slot}`).join(',')}|${s.cables.map((c) => +c.connected).join('')}`;
  }

  /**
   * Per frame (after the camera): advance the board's animation and draw it over the part of the board in view. `gdt` is the world's step (s: the
   * game's pace as the dies replay it, 0 while paused), which the board's clock sums up.
   */
  frame(
    cam: PerspectiveCamera,
    H: number,
    s: Snapshot | null,
    gdt: number,
    paused: boolean,
    dpr: number,
    on: boolean,
  ): void {
    if (!s || !on) {
      this.mesh.visible = false;
      this.screen = null;
      return;
    }
    if (!this.live || this.sceneKey !== this.keyOf(s)) this.build(s);
    const live = this.live;
    if (!live) {
      this.mesh.visible = false;
      return;
    }
    this.t += gdt * 1000;
    this.owed += gdt;
    cam.updateMatrixWorld();
    // (a view corner that looks past the board's plane, a steep side view on a wide screen, has no rect: the plane is still in view at the centre, so all of the face is drawn)
    const v = viewOn(cam, H, Z),
      view = v.zoom > 0 ? (v.rect ?? BD) : null,
      crop = view ? liveCrop(BD, view, 0.05) : null;
    live.setZoom(v.zoom);
    if (view) live.setView(view);
    live.setInterior(!!crop);
    if (this.lastSnap !== s) {
      live.update(s, this.t);
      live.setPlugged(!!s.plugged);
      this.traffic.update(s);
      this.lastSnap = s;
    }
    this.traffic.frame(this.t, paused);
    // `Live`'s frame and the drawing of its layer go together, at most once per `level.ms`: a frame in between would only build the packets' strokes
    // for the next one to wipe (the strokes are rebuilt, and cut into triangles, on every frame `Live` runs)
    const now = performance.now();
    if (now - this.liveAt >= Math.max(TRACE_MS, this.level.ms)) {
      this.liveAt = now;
      live.frame(this.owed, this.t, paused);
      this.owed = 0;
      this.fresh = true;
    }
    this.drawScreen(live, s);
    if (!crop) {
      this.mesh.visible = false;
      return;
    }
    if (!this.fresh) {
      this.mesh.visible = true;
      return;
    }
    const canvas = (this.canvas ??= document.createElement('canvas'));
    const got = drawLive(live.root, crop, livePx(crop, v.zoom * dpr, this.level.px, TRACE_SIDE), canvas);
    if (!got) {
      this.mesh.visible = false;
      return;
    }
    this.fresh = false;
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
  screen: { canvas: HTMLCanvasElement; w: number; h: number; rev: number } | null = null;
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenRev = 0;
  private screenAt = -Infinity;

  private drawScreen(live: Live, s: Snapshot): void {
    if (!s.monitorPowered || !s.devices.some((d) => d.kind === 'display')) {
      this.screen = null;
      return;
    }
    const now = performance.now();
    if (this.screen && now - this.screenAt < 66) return;
    const canvas = (this.screenCanvas ??= document.createElement('canvas'));
    const got = drawLive(live.ext, SCREEN, 1280 / SCREEN.w, canvas);
    this.screen = got ? { canvas, ...got, rev: ++this.screenRev } : null;
    if (got) {
      // the 2D screen is drawn over the panel's dark glass: under a blank screen's faint art the texture would be clear, and its colour alone (no alpha) would show
      const c = canvas.getContext('2d')!;
      c.globalCompositeOperation = 'destination-over';
      c.fillStyle = '#0d1116';
      c.fillRect(0, 0, got.w, got.h);
      c.globalCompositeOperation = 'source-over';
    }
    this.screenAt = now;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.tex?.dispose();
    this.mat.dispose();
    // (Build my PC makes one per open: what Pixi kept for the layer goes with it)
    try {
      this.live?.root.destroy({ children: true });
      this.live?.ext.destroy({ children: true });
    } catch {
      /* already freed */
    }
    this.live = null;
    this.screen = null;
    this.canvas = this.screenCanvas = null;
  }
}
