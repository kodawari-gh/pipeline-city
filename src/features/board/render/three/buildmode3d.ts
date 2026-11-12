// BUILD MY PC (docs/PC_PARTS.md): the machine alone on a plain stage, away from the room, to build it, swap its parts and watch every part come out and go in.
// It runs a sandbox `Game` on the main thread (the real rules: `install`, `uninstall`, `connectCable`) and draws its snapshot with the game's own `Machine3D`.
// What has to come out before what is the removal graph (`sim/removal.ts`); how each step looks is `buildmotion.ts`. A swap or a removal takes out
// every part that stands in the way (in the graph's order), does the job, then puts those parts back in reverse order.
// The case's shell and the board are one piece here: swapping either plays the whole machine lifting away (the parts in it come out first).
import { effect, signal } from '@preact/signals';
import { AmbientLight, Box3, Vector3, CircleGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, type Material, type Object3D } from 'three';
import { slotRects } from './slots3d';
import { effective, FrameGate } from '@/app/graphics';
import { airflowLens, powerLens } from '@/app/hover';
import { BakeQueue } from '@/core/render/three/artlod';
import { applyView, distanceOf, fitRect, heightAt, orbitBy, panBy, settled, stepView, zoomAt, type OrbitView } from '@/core/render/three/camera';
import { DrawGate, STILL_PX, ViewWatch } from '@/core/render/three/ondemand';
import { byProgram, rankMaterials } from '@/core/render/three/drawsort';
import { syncWorld } from '@/core/render/three/stillworld';
import { anisotropy, disposeTree, refilter } from '@/core/render/three/geometry';
import { BASE_EXPOSURE, createRenderContext, disposeRenderContext } from '@/core/render/three/init';
import { findById, idOf, pick, seeThrough, tag } from '@/core/render/three/pick';
import { Post } from '@/core/render/three/post';
import { roomGeo } from '@/features/room/render/shell/room';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { accessBlockers, buildGraph, BOARD, CASE, cableNode, devNode, isCableNode, isDevNode, removalPlan, removalPlanAll, SIDE } from '@/features/board/sim/removal';
import { boardSlots, deviceSpec, fanHost, freeSlots, slotAccepts, slotFits, type Board, type SlotInfo } from '@/features/board/sim/board';
import { cableBlocked, cableNeeded, cablesOf, type Cables } from '@/features/board/sim/cables';
import { BOARD_TIERS, CASE_TIERS, getSpec, specsOfKind, type DeviceKind } from '@/features/board/sim/specs';
import type { Snapshot } from '@/worker/protocol';
import type { Game } from '@/worker/game/game';
import { freeBakePools, startBaker } from './bake';
import { sweepLabels } from '@/core/render/camera';
import { Monitor } from '@/features/room/render/three/props3d';
import { CASE as CASE_RECT, DESK_Y, LAYOUT_CASE, LAYOUT_TIER, MONITOR, SCREEN, setLayoutTier } from '../layout/layout';
import { DOOR_SECONDS } from './casedoor';
import { PSU_BODY, PSU_COVER } from './basement3d';
import { motionFor, motionSeconds, poseAt } from './buildmotion';
import { Machine3D } from './machine3d';
import { Lens3D } from './lens3d';
import type { BuildLayout, BuildPreset } from '@/features/board/sim/buildspecs';
import type { BenchKind, BenchResult } from '@/features/sandbox/sim/pcbench';

/** A part in the bin: what a player can fit. */
export interface BinPart { id: string; name: string; kind: DeviceKind | 'board' | 'case'; tier: number }


export interface BuildStatus {
  busy: boolean;
  /** The words for this moment of the animation. */
  step: string;
  /** What has been done, newest last. */
  log: string[];
  /** Counts up with every change of the machine (the UI reads it to redraw). */
  rev: number;
}

/** One undoable change: a part fitted in, or taken out of, a socket. */
type Step = { t: 'fit' | 'remove'; spec: string; slot: string };

/** What a swap took out, to put back. */
type Undo = { t: 'cable'; id: string } | { t: 'dev'; spec: string; slot: string; invId: string; clock?: number };

const OUTSIDE = new Set(['video', 'lan', 'pcmains', 'monmains']);
/** The eye's key and range, as in the game's board view. */
const EYE_KEY = 0.04, EYE_RANGE = [0.3, 14] as const;
const FOV = 30, START = { yaw: 0.42, pitch: 0.3, fov: FOV };
/** The settle after a part goes in: how long it lasts and how far (world units) the part dips past its seat. */
const SETTLE_SECONDS = 0.35, SETTLE_DEPTH = 55;
/** The tile bakes' time in a tick that follows a drawn frame, and in one that follows none (ms); the drawn frames between two rank refreshes. */
const BAKE_MS = 6, BAKE_STILL_MS = 12, RANK_EVERY = 32;
const sleep =(ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The motion of a part in this slot: a fan on a case mount comes off its own wall first (the mount's id starts with its side), a heatsink's fan lifts off it;
 *  a SATA drive comes out on its cage's tray (`tray`), an M.2 stick off its socket. */
export const motionOf = (kind: string, slot: string): string => (kind === 'fan' && !fanHost(slot) ? `fan-${slot.replace(/\d+$/, '')}` : kind === 'storage' && slot.startsWith('sata') ? 'tray' : kind);

/** A game's snapshot, kept until the game changes (PERF19): `game.snapshot()` builds the inventory and copies the board through JSON, about 8 % of
 *  an idle phone frame when each frame asked for it. Call `drop` after every change to the game; another game object starts over by itself. */
export class SnapCache {
  private game: Game | null = null;
  private snap: Snapshot | null = null;
  of(game: Game): Snapshot {
    if (game !== this.game || !this.snap) { this.game = game; this.snap = game.snapshot(); }
    return this.snap;
  }
  /** (the game goes too: a closed stage keeps no game through its cache) */
  drop(): void { this.snap = null; this.game = null; }
}

/** The bin: every case, board and part kind that has a 3D model in the machine. */
export function binParts(): BinPart[] {
  const out: BinPart[] = CASE_TIERS.map((c) => ({ id: `case${c.tier}`, name: c.name, kind: 'case', tier: c.tier }));
  for (const b of BOARD_TIERS) out.push({ id: `board${b.tier}`, name: `${b.name} board`, kind: 'board', tier: b.tier });
  for (const k of ['cpu', 'cooler', 'radiator', 'fan', 'ram', 'vrm-sink', 'ram-sink', 'storage', 'gpu', 'npu', 'nic', 'tpm', 'psu'] as const) for (const s of specsOfKind(k)) out.push({ id: s.id, name: s.name, kind: k, tier: s.tier });
  return out;
}

export class BuildStage {
  readonly status = signal<BuildStatus>({ busy: false, step: '', log: [], rev: 0 });
  /** The last benchmark of the machine as it stands (cleared by any change), and the kind being run now. */
  readonly bench = signal<BenchResult | null>(null);
  readonly benching = signal<BenchKind | 'start' | null>(null);
  /** Playback speed: 1 is the animations' own time. */
  readonly speed = signal(1);
  /** The sandbox game. Change it only through `edit` (or put a new game here): the stage keeps its snapshot until then. */
  get game(): Game { return this.alive(this._game); }
  set game(g: Game) { this._game = g; }
  private _game: Game | null = null;
  private readonly snaps = new SnapCache();
  private _machine: Machine3D | null = null;
  private get machine(): Machine3D { return this.alive(this._machine); }
  /**
   * A closed stage lets go of its machine and its game (PERF12): the UI's last render can keep a closure that holds the stage until the next
   * open. A job that wakes after the close (a timer) stops here, and `job` drops the error.
   */
  private alive<T>(x: T | null): T {
    if (this.dead || !x) throw new Error('Build my PC is closed');
    return x;
  }
  private readonly bakes = new BakeQueue();
  private readonly ctx;
  private readonly post: Post;
  private readonly gate = new FrameGate();
  /** Drawn on demand (docs/render/load.md): a still machine draws no frame; a change, a motion or a camera move draws. */
  private readonly demand = new DrawGate();
  private readonly moved = new ViewWatch();
  /** The power and airflow lenses (the `powerLens` / `airflowLens` signals), over the machine as in the game. */
  private readonly lens: Lens3D;
  private readonly host: HTMLElement;
  private view: OrbitView;
  private goal: OrbitView;
  private W: number;
  private H: number;
  private raf = 0;
  private dead = false;
  private last = performance.now();
  private wantOpen = false;
  private anim: { objs: { o: Object3D; base: [number, number, number]; baseTurn: number }[]; kind: string; dir: 'out' | 'in'; t: number; done: () => void } | null = null;
  private readonly was: [number, number] = [LAYOUT_TIER, LAYOUT_CASE];
  private readonly cleanup: (() => void)[] = [];
  private tierKey = '';
  private metered = 1;
  private seen = 1;
  /** The last tick drew a frame; the drawn frames' count (`RANK_EVERY`). */
  private drew = true;
  private frames = 0;
  /** A press on a part inside the open case (no busy job) hands the device id and the press here: the UI drags it. */
  onGrab: ((device: string, e: PointerEvent) => void) | null = null;

  private constructor(host: HTMLElement) {
    this.host = host;
    this.ctx = createRenderContext(host, '#0e1118');
    const { scene, camera, renderer } = this.ctx;
    this.W = Math.max(1, host.clientWidth);
    this.H = Math.max(1, host.clientHeight);
    scene.environmentIntensity = 0.45;
    scene.add(new AmbientLight(0xffffff, 0.12), new HemisphereLight(0xbfd0ff, 0x1a1410, 0.3));
    const key = new DirectionalLight(0xfff0dc, 0.9);
    key.position.set(-6000, 9000, 14000);
    const rim = new DirectionalLight(0x8fb0ff, 0.45);
    rim.position.set(9000, 3000, -4000);
    const lamp = new PointLight(0xfff1dd, 1.0, 0, 0);
    lamp.position.set(0, 4000, 9000);
    scene.add(key, rim, lamp);
    // the frame's cuts (docs/render/case.md "Build my PC's frame"): the still parts' matrices stay (`syncWorld` in `frame`), and the opaque
    // draws go in program order
    scene.matrixWorldAutoUpdate = false;
    renderer.setOpaqueSort(byProgram);
    this.post = new Post(renderer, scene, camera, this.W, this.H);
    this.lens = new Lens3D(scene);
    // the graphics settings, now and on every change while the stage is open (the frame limit is in `frame`)
    this.cleanup.push(effect(() => {
      const g = effective.value;
      this.post.apply(g, renderer, this.W, this.H);
      if (g.filtering !== anisotropy) refilter(scene, g.filtering);
      this.demand.ask();
    }));
    this.view = this.goal = this.frameView();
    this.listen(renderer.domElement);
    const ro = new ResizeObserver(() => {
      this.W = Math.max(1, host.clientWidth); this.H = Math.max(1, host.clientHeight);
      renderer.setSize(this.W, this.H); this.post.setSize(this.W, this.H);
      this.demand.ask(); // (a new size clears the canvas)
    });
    ro.observe(host);
    this.cleanup.push(() => ro.disconnect());
    const restored = () => this.demand.ask();
    renderer.domElement.addEventListener('webglcontextrestored', restored);
    this.cleanup.push(() => renderer.domElement.removeEventListener('webglcontextrestored', restored));
  }

  /** Open the stage in `host` (a sized element) with a fresh sandbox game that holds the biggest machine. */
  static async open(host: HTMLElement): Promise<BuildStage> {
    const { Game } = await import('@/worker/game/game');
    startBaker();
    const s = new BuildStage(host);
    s.game = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
    s.rebuild();
    if (import.meta.env.DEV) (window as unknown as { __build?: BuildStage }).__build = s;
    s.last = performance.now();
    s.raf = requestAnimationFrame(s.frame);
    return s;
  }

  /** The machine as it stands: one snapshot per change of the game, not one per frame. */
  get snapshot(): Snapshot { return this.snaps.of(this.game); }
  get board(): Board { return this.game.board; }
  get cables(): Cables { return this.game.cables; }
  /** Every change to the stage's game goes through here (install, uninstall, purchase, a cable): it drops the kept snapshot. */
  private edit<T>(change: (g: Game) => T): T {
    try { return change(this.game); } finally { this.snaps.drop(); this.demand.ask(); }
  }

  // ------------------------------------------------------------------ drawing
  private frameView(): OrbitView {
    return fitRect({ x: CASE_RECT.x, y: CASE_RECT.y, w: CASE_RECT.w, h: CASE_RECT.h }, BOARD_Z, this.W / this.H, START, 0.55);
  }

  private rebuild(): void {
    if (this.dead) return;
    if (this.bench.peek()) this.bench.value = null;
    // (the redraw always reads the game as it is now)
    this.snaps.drop();
    const s = this.snapshot, tier = s.boardTier, caseTier = Math.max(tier, s.caseTier);
    const refit = !this._machine || `${tier}|${caseTier}` !== this.tierKey;
    this.tierKey = `${tier}|${caseTier}`;
    setLayoutTier(tier, caseTier);
    const { scene } = this.ctx;
    if (this._machine) { scene.remove(this._machine.root); this._machine.dispose(); }
    this._machine = new Machine3D(s, roomGeo(), this.bakes, null, false);
    scene.add(this._machine.root);
    this.stage(caseTier);
    this.syncMonitor(s.devices.some((d) => d.kind === 'display'));
    if (refit) this.view = this.goal = this.frameView();
    const st = this.status.peek();
    this.status.value = { ...st, rev: st.rev + 1 };
    this.demand.ask();
  }

  private marker: Mesh | null = null;
  private markerAt = '';
  /** The snap preview: a glowing box over the socket a dragged part would fit in (`dropTarget`); null hides it. A socket with no place of its own (a case fan) shows none. */
  showTarget(slot: string | null): void {
    this.demand.ask();
    const rect = slot && this.machine.doorOpen ? slotRects(this.snapshot).get(slot) : undefined;
    if (!rect) { if (this.marker) this.marker.visible = false; this.markerAt = ''; return; }
    if (!this.marker) {
      this.marker = seeThrough(new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0x3be3ff, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false, toneMapped: false })));
      this.marker.renderOrder = 999;
      this.ctx.scene.add(this.marker);
    }
    const key = `${slot}`;
    if (key !== this.markerAt) { this.markerAt = key; this.marker.position.set(rect.x + rect.w / 2, -(rect.y + rect.h / 2), BOARD_Z + 250); this.marker.scale.set(rect.w, rect.h, 1); }
    this.marker.visible = true;
  }

  private monitor: Group | null = null;
  /** The room's own monitor (`Monitor`, props3d.ts) on the stage when the machine has one, its screen on standby, tagged for the animation. */
  private syncMonitor(on: boolean): void {
    const { scene } = this.ctx;
    if (this.monitor) { scene.remove(this.monitor); disposeTree(this.monitor, true); this.monitor = null; }
    if (!on) return;
    // (built where the room puts it, then moved so its foot's middle stands on the stage's origin, beside the case and turned to the camera)
    const g = tag(new Group(), 'monitor'), m = new Monitor(MONITOR, SCREEN, DESK_Y, 0);
    m.set({ installed: true, powered: true, live: false, text: '' }, 12);
    m.root.position.set(-(MONITOR.x + MONITOR.w / 2), DESK_Y, 400);
    g.add(m.root);
    g.position.set(CASE_RECT.x - 5200, -(CASE_RECT.y + CASE_RECT.h), BOARD_Z + 1800);
    g.rotation.y = 0.5;
    scene.add(g);
    this.monitor = g;
  }

  private floor: Mesh | null = null;
  /** The plain floor under the case. */
  private stage(_caseTier: number): void {
    const { scene } = this.ctx;
    if (!this.floor) {
      this.floor = new Mesh(new CircleGeometry(1, 72).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: new Color(0x171b25), roughness: 0.55, metalness: 0.25 }));
      this.floor.receiveShadow = true;
      scene.add(this.floor);
    }
    this.floor.scale.setScalar(CASE_RECT.w * 1.4);
    this.floor.position.set(CASE_RECT.x + CASE_RECT.w / 2, -(CASE_RECT.y + CASE_RECT.h) - 140, BOARD_Z + 1800);
  }

  private frame = (now: number): void => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.gate.ready(now, effective.peek().fps)) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const { scene, camera, renderer } = this.ctx;
    this.view = settled(this.view, this.goal) ? this.goal : stepView(this.view, this.goal, dt);
    applyView(camera, this.view, this.W / this.H);
    this.machine.setOpen(this.wantOpen, true);
    const snap = this.snapshot;
    this.machine.frame(snap, dt);
    this.machine.lod(camera, this.H, renderer.getPixelRatio());
    this.step(dt * this.speed.peek());
    // (a tick that drew no frame has the time for more tiles: the tiles' frames come in batches, `DrawGate.want`)
    this.bakes.run(this.drew ? BAKE_MS : BAKE_STILL_MS);
    if (this.marker?.visible) (this.marker.material as MeshBasicMaterial).opacity = 0.22 + 0.14 * Math.sin(now / 160);
    this.lens.frame(camera, this.H, snap, roomGeo(), dt, renderer.getPixelRatio());
    this.post.setReach(heightAt(this.view, BOARD_Z));
    // the eye adapts as in the game (`board3d.ts`): a cream case and a black one both read
    // (the meter's reading comes a frame or more after its draw: a tick with no draw takes the last frame's too)
    this.read(this.post.metered());
    this.seen *= (this.metered / this.seen) ** (1 - Math.pow(0.01, dt));
    this.post.setEye(this.seen);
    // drawn on demand: a part's motion, a fan or a panel, a lens, the snap preview's pulse, the eye on its way, or a camera move
    const D = distanceOf(this.view), w = renderer.domElement.width, h = renderer.domElement.height;
    const busy = !!this.anim || this.status.peek().busy || this.machine.moving || powerLens.peek() || airflowLens.peek() || !!this.marker?.visible
      || Math.abs(Math.log(this.metered / this.seen)) > 1e-3 || this.moved.shift(camera, w, h, D / 4, D * 4) >= STILL_PX;
    // (tiles still in the queue: their frames come in batches, docs/render/case.md "Build my PC's frame")
    this.drew = this.demand.want(now, busy, this.bakes.size > 0);
    if (!this.drew) return;
    syncWorld(scene);
    this.post.render();
    this.moved.mark(camera, w, h);
    // (a frame with a change may have new materials or programs; the others refresh the ranks now and then)
    if (this.demand.forced || !(++this.frames % RANK_EVERY)) rankMaterials(scene, this.programOf);
    this.read(this.post.meter());
  };

  private readonly programOf = (m: Material): number =>
    (this.ctx.renderer.properties.get(m) as { currentProgram?: { id: number } }).currentProgram?.id ?? 0;

  private read(lum: number | null): void {
    if (lum !== null) this.metered = Math.min(EYE_RANGE[1], Math.max(EYE_RANGE[0], EYE_KEY / (BASE_EXPOSURE * lum)));
  }

  private step(dt: number): void {
    const a = this.anim;
    if (!a) return;
    a.t += dt;
    const m = motionFor(a.kind), p = poseAt(m, a.t, a.dir);
    for (const x of a.objs) {
      x.o.position.set(x.base[0] + p.offset[0], x.base[1] + p.offset[1], x.base[2] + p.offset[2]);
      x.o.rotation.z = x.baseTurn + p.turn;
    }
    this.setStep(p.label);
    if (a.t >= motionSeconds(m)) {
      // a part going in settles: it dips a little past its seat along the way it came, then comes back (a damped spring, 0.3 s)
      if (a.dir === 'in' && a.t < motionSeconds(m) + SETTLE_SECONDS) {
        const u = (a.t - motionSeconds(m)) / SETTLE_SECONDS, far = m.keys[m.keys.length - 1]!.at, reach = Math.hypot(...far) || 1;
        const k = -SETTLE_DEPTH * Math.exp(-5 * u) * Math.sin(u * Math.PI * 3) / reach;
        for (const x of a.objs) x.o.position.set(x.base[0] + far[0] * k, x.base[1] + far[1] * k, x.base[2] + far[2] * k);
        return;
      }
      for (const x of a.objs) x.o.position.set(x.base[0], x.base[1], x.base[2]);
      this.anim = null; a.done();
    }
  }

  private setStep(step: string): void {
    const st = this.status.peek();
    if (st.step !== step) this.status.value = { ...st, step };
  }

  private note(line: string): void {
    const st = this.status.peek();
    this.status.value = { ...st, log: [...st.log.slice(-39), line] };
  }

  // ------------------------------------------------------------------ the camera
  private listen(el: HTMLCanvasElement): void {
    let drag: { x: number; y: number; pan: boolean } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button === 0 && !e.shiftKey && this.onGrab && !this.status.peek().busy) {
        const id = this.partAt(e.clientX, e.clientY);
        if (id) { this.onGrab(id, e); return; }
      }
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) { const k = this.goal.height / this.H; this.goal = panBy(this.goal, -dx * k, dy * k); }
      else this.goal = orbitBy(this.goal, -dx * 0.006, dy * 0.006);
    };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      this.goal = zoomAt(this.goal, Math.exp(e.deltaY * 0.0012), ((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1), this.W / this.H);
    };
    const menu = (e: Event) => e.preventDefault();
    const reset = () => { this.goal = this.frameView(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', menu);
    el.addEventListener('dblclick', reset);
    this.cleanup.push(() => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel); el.removeEventListener('contextmenu', menu); el.removeEventListener('dblclick', reset); });
  }

  resetView(): void { this.goal = this.frameView(); }

  /** A camera preset: the whole machine seen from the front, three-quarter (the start), the side, or from above. */
  preset(name: 'front' | 'angle' | 'side' | 'top'): void {
    const at = { front: { yaw: 0, pitch: 0.08 }, angle: { yaw: START.yaw, pitch: START.pitch }, side: { yaw: 1.05, pitch: 0.12 }, top: { yaw: 0.2, pitch: 0.75 } }[name];
    this.goal = { ...this.frameView(), ...at };
  }

  /** Fly the camera to a fitted part (its device id); false when it has no model. */
  focusDevice(id: string): boolean {
    const o = this.objectOf(devNode(id));
    if (!o) return false;
    o.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(o), c = box.getCenter(new Vector3()), s = box.getSize(new Vector3());
    this.goal = { ...this.goal, x: c.x, y: c.y, z: c.z, height: Math.max(s.x, s.y, s.z) * 2.4 };
    return true;
  }

  /** The socket a part would be fitted in when dropped at a client point (or by a click when `x` is not given): what `fit` picks. Null when none takes it. */
  dropTarget(item: string, x?: number, y?: number): string | null {
    if (/^(case|board)\d$/.test(item)) return item;
    const spec = getSpec(item);
    if (!spec) return null;
    const fits = (s: SlotInfo) => slotAccepts(s.type, spec.slot) && slotFits(s, spec);
    const at = x === undefined || y === undefined ? null : this.slotAt(x, y);
    if (at && boardSlots(this.board).some((s) => s.id === at && fits(s))) return at;
    return freeSlots(this.board, spec.slot, spec)[0]?.id ?? boardSlots(this.board).find((s) => fits(s) && this.board.devices.some((d) => d.slot === s.id))?.id ?? null;
  }

  // ------------------------------------------------------------------ undo and redo (fit and remove of one part; a new case, board, preset or reset starts over)
  private past: Step[] = [];
  private future: Step[] = [];
  private replay = false;
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  private record(s: Step): void { if (this.replay) return; this.past.push(s); this.future = []; }
  private forget(): void { this.past = []; this.future = []; }
  private async run(s: Step): Promise<void> {
    this.replay = true;
    try {
      if (s.t === 'fit') await this.fit(s.spec, s.slot);
      else { const d = this.board.devices.find((x) => x.slot === s.slot && x.spec === s.spec); if (d) await this.remove(devNode(d.id)); }
    } finally { this.replay = false; }
  }
  async undo(): Promise<void> {
    const s = this.past.pop();
    if (!s || this.status.peek().busy) { if (s) this.past.push(s); return; }
    await this.run({ ...s, t: s.t === 'fit' ? 'remove' : 'fit' });
    this.future.push(s);
    this.bump();
  }
  async redo(): Promise<void> {
    const s = this.future.pop();
    if (!s || this.status.peek().busy) { if (s) this.future.push(s); return; }
    await this.run(s);
    this.past.push(s);
    this.bump();
  }
  private bump(): void { const st = this.status.peek(); this.status.value = { ...st, rev: st.rev + 1 }; }

  /** Is the side panel open (or opening)? The case hides what is inside it, so parts and sockets answer only then. */
  get insideOpen(): boolean { return this.wantOpen; }
  openInside(open: boolean): void { this.wantOpen = open; this.demand.ask(); }

  /** The id under a client point, from the board's own pieces (the case is left out: it hides what is inside). */
  private hitId(x: number, y: number): string | null {
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    const o = pick(this.machine.boardRoots(), this.ctx.camera, ((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1));
    return idOf(o);
  }

  /** The device under a client point (its id), when the side panel is open; else null. */
  partAt(x: number, y: number): string | null {
    if (!this.machine.doorOpen) return null;
    const id = this.hitId(x, y);
    return id && this.board.devices.some((d) => d.id === id) ? id : null;
  }

  /** The socket under a client point: a part's slot, or an empty socket's id; null off the board or with the panel shut. */
  slotAt(x: number, y: number): string | null {
    if (!this.machine.doorOpen) return null;
    const id = this.hitId(x, y);
    if (!id) return null;
    const d = this.board.devices.find((v) => v.id === id);
    if (d) return d.slot;
    return boardSlots(this.board).some((s) => s.id === id) ? id : null;
  }

  /** Dev and checks: put the camera exactly here (the flicker check nudges it a pixel at a time). */
  jump(v: Partial<OrbitView>): void { this.view = this.goal = { ...this.view, ...v }; }
  get orbit(): OrbitView { return this.view; }
  /** Dev aid (close-up reviews): turn the camera to a node's part and fill the view with it. */
  focus(node: string, yaw = 0.3, pitch = 0.35, fill = 2.2): boolean {
    const o = this.objectOf(node);
    if (!o) return false;
    o.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(o), c = box.getCenter(new Vector3()), s = box.getSize(new Vector3());
    this.jump({ x: c.x, y: c.y, z: c.z, yaw, pitch, height: Math.max(s.x, s.y, s.z) * fill });
    return true;
  }

  // ------------------------------------------------------------------ the steps
  /** The scene object that stands for a node, or null (the monitor stands in the room, not in the machine). */
  private objectOf(node: string): Object3D | null {
    const root = this.machine.root;
    if (isCableNode(node)) return findById(root, 'cable.' + node.slice(6));
    if (isDevNode(node)) {
      const d = this.board.devices.find((x) => devNode(x.id) === node);
      if (!d) return null;
      if (deviceSpec(d).kind === 'display') return this.monitor;
      // (the shroud's cover also answers to 'psu': the supply's own group holds the unit)
      return findById(root, d.id) ?? (deviceSpec(d).kind === 'psu' ? root.getObjectByName(PSU_BODY)?.parent ?? null : null);
    }
    return null;
  }

  /** The part comes out: a power supply's shroud cover comes off first, and stays off until the rebuild that follows. */
  private async unseat(node: string, kind: string): Promise<void> {
    const cover = kind === 'psu' ? this.machine.root.getObjectByName(PSU_COVER) : null;
    if (cover) await this.playAll([cover], 'shroud', 'out');
    await this.play(node, kind, 'out');
  }

  /** The part goes in, right after the rebuild that made it: a power supply with its shroud's cover held off, which then goes back on. */
  private async seat(node: string, kind: string): Promise<void> {
    const cover = kind === 'psu' ? this.machine.root.getObjectByName(PSU_COVER) : null, far = poseAt(motionFor('shroud'), 0, 'in').offset;
    if (cover) cover.position.set(cover.position.x + far[0], cover.position.y + far[1], cover.position.z + far[2]);
    await this.play(node, kind, 'in');
    if (cover) {
      cover.position.set(cover.position.x - far[0], cover.position.y - far[1], cover.position.z - far[2]);
      await this.playAll([cover], 'shroud', 'in');
    }
  }

  /** After the rebuild that took a power supply away: its shroud's cover, rebuilt in place, comes back from where it was left. */
  private coverBack(kind: string): Promise<void> {
    const cover = kind === 'psu' ? this.machine.root.getObjectByName(PSU_COVER) : null;
    return cover ? this.playAll([cover], 'shroud', 'in') : Promise.resolve();
  }

  /** Play a motion on some objects together. Without any (the monitor of a part that is not built) the time still passes, so the log reads right. */
  private playAll(objs: Object3D[], kind: string, dir: 'out' | 'in'): Promise<void> {
    const m = motionFor(kind), p = poseAt(m, 0, dir);
    return new Promise((done) => {
      const list = objs.map((o) => ({ o, base: [o.position.x, o.position.y, o.position.z] as [number, number, number], baseTurn: o.rotation.z }));
      this.anim = { objs: list, kind, dir, t: 0, done: () => { if (dir === 'out' && objs.length > 1) for (const x of list) x.o.position.set(...x.base); done(); } };
      for (const x of list) x.o.position.set(x.base[0] + p.offset[0], x.base[1] + p.offset[1], x.base[2] + p.offset[2]);
    });
  }

  /** Play a node's motion on its object. */
  private play(node: string, kind: string, dir: 'out' | 'in'): Promise<void> {
    const obj = this.objectOf(node);
    return this.playAll(obj ? [obj] : [], kind, dir);
  }

  private async door(open: boolean): Promise<void> {
    if (this.wantOpen === open) return;
    this.wantOpen = open;
    this.setStep(open ? 'Undo the side panel' : 'Close the side panel');
    await sleep((DOOR_SECONDS[CASE_KIND[LAYOUT_CASE] ?? 'gamer'] * 1000 + 250) / this.speed.peek());
  }

  private labelOf(node: string, verb: 'Take out' | 'Put back'): string {
    if (node === SIDE) return verb === 'Take out' ? 'Open the side panel' : 'Close the side panel';
    if (isCableNode(node)) return `${verb === 'Take out' ? 'Unplug' : 'Plug in'} ${this.snapshot.cables.find((c) => c.id === node.slice(6))?.name ?? node.slice(6)}`;
    const d = this.board.devices.find((x) => devNode(x.id) === node);
    return `${verb} ${d ? deviceSpec(d).name : node}`;
  }

  /** Take one node out of the machine, with its animation; what it was goes on `undo` (the target itself is left off it). */
  private async takeOut(node: string, undo: Undo[] | null): Promise<string | null> {
    if (node === SIDE) { await this.door(true); this.note(this.labelOf(node, 'Take out')); return null; }
    this.note(this.labelOf(node, 'Take out'));
    if (isCableNode(node)) {
      const id = node.slice(6);
      if (!OUTSIDE.has(id)) await this.door(true);
      await this.play(node, 'cable', 'out');
      this.edit((g) => g.disconnectCable(id));
      undo?.push({ t: 'cable', id });
      this.rebuild();
      return null;
    }
    const d = this.board.devices.find((x) => devNode(x.id) === node);
    if (!d) return null;
    const kind = deviceSpec(d).kind;
    await this.unseat(node, motionOf(kind, d.slot));
    const r = this.edit((g) => g.uninstall(d.id));
    if (!r.ok) { this.note(`Cannot take it out: ${r.reason}`); this.rebuild(); return null; }
    undo?.push({ t: 'dev', spec: d.spec, slot: d.slot, invId: r.invId!, clock: d.clock });
    this.rebuild();
    await this.coverBack(kind);
    return r.invId;
  }

  private async putBack(u: Undo): Promise<void> {
    if (u.t === 'cable') {
      if (this.cables[u.id] || !cableNeeded(this.board, u.id as never) || cableBlocked(this.board, u.id as never)) return;
      // (the PC's cord goes into the supply's inlet: with the supply out it stays unplugged)
      if (u.id === 'pcmains' && !this.board.devices.some((d) => deviceSpec(d).kind === 'psu')) return;
      this.note(`Plug in ${this.snapshot.cables.find((c) => c.id === u.id)?.name ?? u.id}`);
      this.edit((g) => g.connectCable(u.id));
      this.rebuild();
      await this.play(cableNode(u.id), 'cable', 'in');
      return;
    }
    const r = this.edit((g) => g.install(u.invId, u.slot));
    // (a fan the new heatsink or case has no spot for stays out, as the game sends it to the inventory)
    if (!r.ok) { this.note(getSpec(u.spec)?.kind === 'fan' ? `${getSpec(u.spec)!.name} no longer fits: it stays out` : `Cannot put ${getSpec(u.spec)?.name ?? u.spec} back: ${r.reason}`); return; }
    this.note(`Put back ${getSpec(u.spec)?.name ?? u.spec}`);
    this.rebuild();
    const node = devNode(r.deviceId ?? '');
    await this.seat(node, motionOf(deviceSpec(this.board.devices.find((x) => x.id === r.deviceId)!).kind, u.slot));
  }

  /** Plug in the cables a part just fitted needs. */
  private async plugNeeded(): Promise<void> {
    for (const c of cablesOf(this.board)) {
      if (OUTSIDE.has(c.id) || this.cables[c.id] || !cableNeeded(this.board, c.id) || cableBlocked(this.board, c.id)) continue;
      await this.putBack({ t: 'cable', id: c.id });
    }
  }

  private async job(work: () => Promise<void>): Promise<void> {
    if (this.status.peek().busy || this.dead) return;
    this.status.value = { ...this.status.peek(), busy: true, step: '' };
    try { await work(); } catch (e) { if (!this.dead) throw e; } finally {
      // (a close in the middle of a job: the stage is gone, nothing to put back)
      if (!this.dead) {
        await this.door(false);
        this.status.value = { ...this.status.peek(), busy: false, step: '' };
        this.rebuild();
      }
    }
  }

  /** The nodes to take out for a target, in order (the target last). */
  plan(node: string): string[] { return removalPlan(buildGraph(this.board, this.cables), node); }

  /** Take a part out with everything in its way, then put the others back. The part goes to the bin (the game's inventory). */
  remove(node: string): Promise<void> {
    return this.job(async () => {
      const undo: Undo[] = [], steps = this.plan(node);
      const gone = isDevNode(node) ? this.board.devices.find((x) => devNode(x.id) === node) : undefined;
      if (gone) this.record({ t: 'remove', spec: gone.spec, slot: gone.slot });
      for (const n of steps) await this.takeOut(n, n === node ? null : undo);
      for (const u of undo.reverse()) await this.putBack(u);
      this.note(`Done: ${steps.length} step${steps.length === 1 ? '' : 's'}`);
    });
  }

  /** Fit a catalogue part (its id; the shelf is unlimited, there is no inventory here). `drop`: the socket it was dropped on
   *  (`slotAt`) when that socket takes it; otherwise (or without one) the first free socket that takes it, else the socket of the part it replaces. */
  fit(item: string, drop?: string): Promise<void> {
    return this.job(async () => {
      const itemId = item;
      if (/^(case|board)\d$/.test(itemId)) return this.fitShell(itemId);
      const spec = getSpec(itemId);
      if (!spec) { this.note(`Unknown part ${itemId}`); return; }
      const fits = (s: SlotInfo) => slotAccepts(s.type, spec.slot) && slotFits(s, spec);
      const free = freeSlots(this.board, spec.slot, spec)[0];
      const taken = boardSlots(this.board).find((s) => fits(s) && this.board.devices.some((d) => d.slot === s.id));
      const aimed = drop && boardSlots(this.board).some((s) => s.id === drop && fits(s)) ? drop : undefined;
      const slot = aimed ?? free?.id ?? taken?.id;
      if (!slot) { this.note(spec.kind === 'fan' ? `Nothing in this machine takes a ${spec.size} mm fan` : `${spec.name} fits no socket on this board`); return; }
      const occupant = this.board.devices.find((d) => d.slot === slot) ?? null;
      const graph = buildGraph(this.board, this.cables);
      const steps = occupant ? removalPlan(graph, devNode(occupant.id)) : removalPlanAll(graph, accessBlockers(this.board, slot, spec.kind).filter((n) => graph.has(n)));
      if (!steps.length) steps.push(SIDE);
      if (steps[0] !== SIDE) steps.unshift(SIDE);
      const undo: Undo[] = [];
      for (const n of steps) await this.takeOut(n, occupant && n === devNode(occupant.id) ? null : undo);
      const bought = this.edit((g) => g.purchase(itemId));
      if (!bought.ok) this.note(`Cannot get ${spec.name}: ${bought.reason}`);
      else {
        const put = this.edit((g) => g.install(bought.invId, slot));
        if (!put.ok) this.note(`${spec.name} does not fit: ${put.reason}`);
        else {
          this.note(`Fit ${spec.name} in ${slot}`);
          if (occupant) this.record({ t: 'remove', spec: occupant.spec, slot });
          this.record({ t: 'fit', spec: itemId, slot });
          this.rebuild();
          await this.seat(devNode(put.deviceId ?? ''), motionOf(spec.kind, slot));
          await this.plugNeeded();
        }
      }
      for (const u of undo.reverse()) await this.putBack(u);
      await this.plugNeeded();
    });
  }

  /** A new board or case: every part comes out first, the machine is swapped as one piece, then the parts go back (what no longer fits stays in the bin). */
  private async fitShell(itemId: string): Promise<void> {
    const isCase = itemId.startsWith('case'), tier = Number(itemId.slice(-1));
    this.forget();
    if (isCase ? tier === this.board.caseTier : tier === this.board.tier && !this.board.burnt) { this.note('That one is already fitted'); return; }
    const graph = buildGraph(this.board, this.cables), steps = removalPlan(graph, isCase ? CASE : BOARD);
    const undo: Undo[] = [];
    for (const n of steps) {
      if (n === BOARD || n === CASE) break;
      await this.takeOut(n, undo);
    }
    await this.door(false);
    // the board first (on a case swap too: the case cannot lift off with it inside), then the case
    this.note('Undo the board screws and lift the board out');
    await this.playAll(this.machine.boardRoots(), 'board', 'out');
    if (isCase) { this.note('Take the old case away'); await this.playAll(this.machine.caseRoots, 'case', 'out'); }
    const bought = this.edit((g) => g.purchase(itemId));
    const fitted = bought.ok ? this.edit((g) => g.install(bought.invId)) : bought;
    if (!fitted.ok) this.note(`Cannot fit it: ${fitted.reason}`);
    this.rebuild();
    if (fitted.ok) {
      const board = this.machine.boardRoots(), far = poseAt(motionFor('board'), 0, 'in').offset;
      if (isCase) {
        // the new case comes down first, the board still held over it
        for (const o of board) o.position.set(o.position.x + far[0], o.position.y + far[1], o.position.z + far[2]);
        this.note(`Set the ${CASE_TIERS[tier]!.name} down`);
        await this.playAll(this.machine.caseRoots, 'case', 'in');
        for (const o of board) o.position.set(o.position.x - far[0], o.position.y - far[1], o.position.z - far[2]);
      }
      this.note(`Lower the ${isCase ? 'board' : BOARD_TIERS[tier]!.name + ' board'} onto its standoffs`);
      await this.playAll(board, 'board', 'in');
    }
    for (const u of undo.reverse()) await this.putBack(u);
    await this.plugNeeded();
  }

  /** A ready-made machine, built at once (no animation): `level` 0..1 picks how high a tier of each part; `ram`, `storage`, `gpus` and `npus` how many
   *  of each to fit. Parts that fit nowhere are skipped. */
  async buildPreset(p: BuildPreset): Promise<void> {
    if (this.status.peek().busy) return;
    const { Game } = await import('@/worker/game/game');
    if (this.dead) return;
    const g = new Game({ seed: 1, sandbox: true, preassembled: false });
    for (const d of g.snapshot().devices) if (d.kind === 'fan') g.uninstall(d.id);
    const pick = (kind: DeviceKind): string | null => {
      // (a RAID module holds data only: no OS boots from it, so the benchmark's jobs could not run)
      const all = [...specsOfKind(kind as never)].filter((s) => !(s as { mirror?: boolean }).mirror).sort((a, b) => a.tier - b.tier || a.price - b.price);
      // (a drive rounds up: the slowest drives make every job wait on the disk)
      const at = p.level * (all.length - 1);
      return all.length ? all[Math.min(all.length - 1, kind === 'storage' ? Math.ceil(at) : Math.round(at))]!.id : null;
    };
    const put = (id: string | null, slot?: string): boolean => {
      if (!id) return false;
      const b = g.purchase(id);
      return b.ok && g.install(b.invId, slot).ok;
    };
    const shell = (list: readonly { tier: number }[]) => Math.round(p.level * (list.length - 1));
    put(`case${shell(CASE_TIERS)}`);
    put(`board${shell(BOARD_TIERS)}`);
    const fill = (kind: DeviceKind, n: number): void => {
      const id = pick(kind), spec = id ? getSpec(id) : undefined;
      for (let i = 0; spec && i < n; i++) { const free = freeSlots(g.board, spec.slot, spec)[0]; if (!free || !put(id, free.id)) break; }
    };
    fill('psu', 1); fill('cpu', 1); fill('cooler', 1); fill('ram', p.ram); fill('storage', p.storage); fill('gpu', p.gpus); fill('npu', p.npus);
    fill('nic', 1); fill('display', 1);
    // fans come in sizes (a heatsink takes 40 mm, a case mount its own): from the chosen tier down, each spec goes in every spot that takes it
    const fans = [...specsOfKind('fan')].sort((a, b) => a.tier - b.tier || a.price - b.price);
    for (const f of fans.slice(0, 1 + Math.round(p.level * (fans.length - 1))).reverse()) {
      for (let i = 0; i < 40; i++) { const free = freeSlots(g.board, f.slot, f)[0]; if (!free || !put(f.id, free.id)) break; }
    }
    const t = (n: number) => Math.min(n, 1 + Math.round(p.level * (n - 1)));
    this.software(g, { os: t(3), router: t(4), isp: t(5) });
    this.adopt(g, `Built the ${p.name} machine`);
  }

  /** The OS on the first drive, a router and an ISP plan with the LAN cable (what the benchmark's jobs need). Each is skipped when its tier is 0 or it does not fit. */
  private software(g: Game, s: { os: number; router: number; isp: number }): void {
    const buy = (id: string) => { const b = g.purchase(id); return b.ok && g.install(b.invId).ok; };
    if (s.os && g.board.devices.some((d) => deviceSpec(d).kind === 'storage')) buy(`os${s.os}`);
    if (s.router) buy(`router${s.router}`);
    if (s.isp) g.purchase(`isp${s.isp}`);
    if (s.router && s.isp) g.connectLan();
  }

  /** Run the benchmark on the machine as it is (a copy runs; the stage's game is not changed). */
  async runBenchmark(): Promise<void> {
    if (this.benching.peek() || this.status.peek().busy) return;
    this.benching.value = 'start';
    try {
      const { runBench } = await import('@/features/sandbox/sim/pcbench');
      const r = await runBench(this.game, (k) => { this.benching.value = k; });
      if (!this.dead) this.bench.value = r;
    } finally { this.benching.value = null; }
  }

  /** What is in the machine now, to save under a name (`loadLayout` builds it again). */
  get layout(): BuildLayout {
    const g = this.game;
    return {
      caseTier: this.board.caseTier, boardTier: this.board.tier, parts: this.board.devices.map((d) => ({ spec: d.spec, slot: d.slot })),
      os: this.snapshot.os?.tier ?? 0, router: g.routerTier, isp: g.ispTier,
    };
  }

  /** Build a saved layout at once (no animation). Parts that no longer fit are skipped. */
  async loadLayout(l: BuildLayout, name: string): Promise<void> {
    if (this.status.peek().busy) return;
    const { Game } = await import('@/worker/game/game');
    if (this.dead) return;
    const g = new Game({ seed: 1, sandbox: true, preassembled: false });
    for (const d of g.snapshot().devices) if (d.kind === 'fan') g.uninstall(d.id);
    const put = (id: string, slot?: string) => { const b = g.purchase(id); return b.ok && g.install(b.invId, slot).ok; };
    put(`case${l.caseTier}`);
    put(`board${l.boardTier}`);
    for (const p of l.parts) put(p.spec, p.slot);
    this.software(g, { os: l.os ?? 0, router: l.router ?? 0, isp: l.isp ?? 0 });
    this.adopt(g, `Loaded ${name}`);
  }

  /** Make `g` the machine: plug every cable it needs, forget the history and redraw. */
  private adopt(g: Game, line: string): void {
    for (const c of cablesOf(g.board)) if (!OUTSIDE.has(c.id) && cableNeeded(g.board, c.id) && !cableBlocked(g.board, c.id)) g.connectCable(c.id);
    for (const c of OUTSIDE) if (cableNeeded(g.board, c as never)) g.connectCable(c);
    this.game = g;
    this.forget();
    this.status.value = { busy: false, step: '', log: [line], rev: this.status.peek().rev };
    this.rebuild();
  }

  /** A new sandbox machine: the biggest rig, as at the start. */
  async reset(): Promise<void> {
    if (this.status.peek().busy) return;
    const { Game } = await import('@/worker/game/game');
    if (this.dead) return;
    this.forget();
    this.game = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
    this.status.value = { busy: false, step: '', log: [], rev: this.status.peek().rev };
    this.rebuild();
  }

  /** An empty case and board of the smallest tier: build up from nothing. */
  async clear(): Promise<void> {
    if (this.status.peek().busy) return;
    const { Game } = await import('@/worker/game/game');
    if (this.dead) return;
    this.forget();
    this.game = new Game({ seed: 1, sandbox: true, preassembled: false });
    // a new game's case holds its two starter fans: Empty means nothing fitted
    this.edit((g) => { for (const d of g.snapshot().devices) if (d.kind === 'fan') g.uninstall(d.id); });
    this.status.value = { busy: false, step: '', log: [], rev: this.status.peek().rev };
    this.rebuild();
  }

  /**
   * Frees all that the stage owns (PERF12), once. The WebGL context, the renderer and the post chain's targets go at once. The machine with
   * its baked art, the monitor with its textures and the stage's own meshes go in a second task (`FREE_LATER_MS`): all in one task held a
   * phone's frame longer than the close did before. The room's shared caches (`roomGeo`, shared materials) stay.
   */
  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) f();
    this.cleanup.length = 0;
    this.anim = null;
    this.onGrab = null;
    setLayoutTier(...this.was);
    if (import.meta.env.DEV) {
      const w = window as unknown as { __build?: BuildStage };
      if (w.__build === this) delete w.__build;
    }
    disposeRenderContext(this.ctx);
    this.post.dispose();
    setTimeout(() => this.freeScene(), FREE_LATER_MS);
  }

  /** The second half of `dispose`: the meshes and materials (cheap with the context lost), and what Pixi kept for their art. */
  private freeScene(): void {
    this.lens.dispose();
    const { scene } = this.ctx;
    if (this._machine) { scene.remove(this._machine.root); this._machine.dispose(); }
    if (this.monitor) { scene.remove(this.monitor); disposeTree(this.monitor, true); this.monitor = null; }
    // the art is gone: what Pixi pooled for it, and its labels in the size rule
    freeBakePools();
    sweepLabels();
    // (a material shared with the room keeps this renderer's listener until its dispose)
    disposeTree(scene);
    scene.clear();
    this._machine = null;
    this._game = null;
    this.snaps.drop();
    this.bakes.drop(''); // (a job's closure holds the art it bakes)
    this.marker = this.floor = null;
    void this.host;
  }
}

/** How long after a close the stage frees its meshes: a frame or so after its context (`BuildStage.dispose`). */
const FREE_LATER_MS = 20;
