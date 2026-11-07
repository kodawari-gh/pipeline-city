// BUILD MY PC (docs/PC_PARTS.md): the machine alone on a plain stage, away from the room, to build it, swap its parts and watch every part come out and go in.
// It runs a sandbox `Game` on the main thread (the real rules: `install`, `uninstall`, `connectCable`) and draws its snapshot with the game's own `Machine3D`.
// What has to come out before what is the removal graph (`sim/removal.ts`); how each step looks is `buildmotion.ts`. A swap or a removal takes out
// every part that stands in the way (in the graph's order), does the job, then puts those parts back in reverse order.
// The case's shell and the board are one piece here: swapping either plays the whole machine lifting away (the parts in it come out first).
import { signal } from '@preact/signals';
import { AmbientLight, BoxGeometry, CircleGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial, PointLight, type Object3D } from 'three';
import { effective } from '@/app/graphics';
import { BakeQueue } from '@/core/render/three/artlod';
import { applyView, fitRect, heightAt, orbitBy, panBy, settled, stepView, zoomAt, type OrbitView } from '@/core/render/three/camera';
import { disposeTree } from '@/core/render/three/geometry';
import { BASE_EXPOSURE, createRenderContext } from '@/core/render/three/init';
import { findById, tag } from '@/core/render/three/pick';
import { Post } from '@/core/render/three/post';
import { roomGeo } from '@/features/room/render/shell/room';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { accessBlockers, buildGraph, BOARD, CASE, cableNode, devNode, isCableNode, isDevNode, nodeKind, removalPlan, removalPlanAll, SIDE } from '@/features/board/sim/removal';
import { boardSlots, deviceSpec, freeSlots, slotAccepts, slotFitsWidth, type Board } from '@/features/board/sim/board';
import { cableBlocked, cableNeeded, cablesOf, type Cables } from '@/features/board/sim/cables';
import { BOARD_TIERS, CASE_TIERS, caseMounts, getSpec, specsOfKind, type DeviceKind } from '@/features/board/sim/specs';
import type { Snapshot } from '@/worker/protocol';
import type { Game } from '@/worker/game/game';
import { startBaker } from './bake';
import { CASE as CASE_RECT, LAYOUT_CASE, LAYOUT_TIER, setLayoutTier } from '../layout/layout';
import { DOOR_SECONDS } from './casedoor';
import { motionFor, motionSeconds, poseAt } from './buildmotion';
import { Machine3D } from './machine3d';

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

/** What a swap took out, to put back. */
type Undo = { t: 'cable'; id: string } | { t: 'dev'; spec: string; slot: string; invId: string; clock?: number };

const OUTSIDE = new Set(['video', 'lan', 'pcmains', 'monmains']);
/** The eye's key and range, as in the game's board view. */
const EYE_KEY = 0.04, EYE_RANGE = [0.3, 14] as const;
const FOV = 30, START = { yaw: 0.42, pitch: 0.3, fov: FOV };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The bin: every case, board and part kind that has a 3D model in the machine. */
export function binParts(): BinPart[] {
  const out: BinPart[] = CASE_TIERS.map((c) => ({ id: `case${c.tier}`, name: c.name, kind: 'case', tier: c.tier }));
  for (const b of BOARD_TIERS) out.push({ id: `board${b.tier}`, name: `${b.name} board`, kind: 'board', tier: b.tier });
  for (const k of ['cpu', 'cooler', 'radiator', 'ram', 'vrm-sink', 'ram-sink', 'storage', 'gpu', 'npu', 'nic', 'tpm', 'psu'] as const) for (const s of specsOfKind(k)) out.push({ id: s.id, name: s.name, kind: k, tier: s.tier });
  return out;
}

export class BuildStage {
  readonly status = signal<BuildStatus>({ busy: false, step: '', log: [], rev: 0 });
  /** Playback speed: 1 is the animations' own time. */
  readonly speed = signal(1);
  game!: Game;
  private machine!: Machine3D;
  private readonly bakes = new BakeQueue();
  private readonly ctx;
  private readonly post: Post;
  private readonly host: HTMLElement;
  private view: OrbitView;
  private goal: OrbitView;
  private W: number;
  private H: number;
  private raf = 0;
  private dead = false;
  private last = performance.now();
  private wantOpen = false;
  private anim: { obj: Object3D | null; base: [number, number, number]; baseTurn: number; kind: string; dir: 'out' | 'in'; t: number; done: () => void } | null = null;
  private readonly was: [number, number] = [LAYOUT_TIER, LAYOUT_CASE];
  private readonly cleanup: (() => void)[] = [];
  private nSteps = 0;
  private tierKey = '';
  private metered = 1;
  private seen = 1;

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
    this.post = new Post(renderer, scene, camera, this.W, this.H);
    this.post.apply(effective.peek(), renderer, this.W, this.H);
    this.view = this.goal = this.frameView();
    this.listen(renderer.domElement);
    const ro = new ResizeObserver(() => {
      this.W = Math.max(1, host.clientWidth); this.H = Math.max(1, host.clientHeight);
      renderer.setSize(this.W, this.H); this.post.setSize(this.W, this.H);
    });
    ro.observe(host);
    this.cleanup.push(() => ro.disconnect());
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

  get snapshot(): Snapshot { return this.game.snapshot(); }
  get board(): Board { return this.game.board; }
  get cables(): Cables { return this.game.cables; }

  // ------------------------------------------------------------------ drawing
  private frameView(): OrbitView {
    return fitRect({ x: CASE_RECT.x, y: CASE_RECT.y, w: CASE_RECT.w, h: CASE_RECT.h }, BOARD_Z, this.W / this.H, START, 0.55);
  }

  private rebuild(): void {
    const s = this.game.snapshot(), tier = s.boardTier, caseTier = Math.max(tier, s.caseTier);
    const refit = !this.machine || `${tier}|${caseTier}` !== this.tierKey;
    this.tierKey = `${tier}|${caseTier}`;
    setLayoutTier(tier, caseTier);
    const { scene } = this.ctx;
    if (this.machine) { scene.remove(this.machine.root); this.machine.dispose(); }
    this.machine = new Machine3D(s, roomGeo(), this.bakes, null);
    scene.add(this.machine.root);
    this.stage(caseTier);
    this.syncMonitor(s.devices.some((d) => d.kind === 'display'));
    if (refit) this.view = this.goal = this.frameView();
    const st = this.status.peek();
    this.status.value = { ...st, rev: st.rev + 1 };
  }

  private monitor: Group | null = null;
  /** A plain monitor on the stage when the machine has one (the room's own stands in the room): a stand, a bezel and a lit screen, tagged for the animation. */
  private syncMonitor(on: boolean): void {
    const { scene } = this.ctx;
    if (this.monitor) { scene.remove(this.monitor); disposeTree(this.monitor); this.monitor = null; }
    if (!on) return;
    const g = tag(new Group(), 'monitor'), dark = new MeshStandardMaterial({ color: 0x14171e, roughness: 0.45, metalness: 0.5 });
    const box = (w: number, h: number, d: number, m: MeshStandardMaterial, x: number, y: number, z: number) => { const o = new Mesh(new BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); };
    const screen = new MeshStandardMaterial({ color: 0x0b1626, emissive: 0x16345a, emissiveIntensity: 0.9, roughness: 0.2 });
    box(2600, 140, 1500, dark, 0, 70, 0);
    box(420, 1400, 260, dark, 0, 840, -200);
    box(6200, 3500, 240, dark, 0, 2900, 0);
    box(5900, 3200, 40, screen, 0, 2900, 130);
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
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const { camera, renderer } = this.ctx;
    this.view = settled(this.view, this.goal) ? this.goal : stepView(this.view, this.goal, dt);
    applyView(camera, this.view, this.W / this.H);
    this.machine.setOpen(this.wantOpen, true);
    this.machine.frame(this.game.snapshot(), dt);
    this.machine.lod(camera, this.H, renderer.getPixelRatio());
    this.step(dt * this.speed.peek());
    this.bakes.run(6);
    this.post.setReach(heightAt(this.view, BOARD_Z));
    // the eye adapts as in the game (`board3d.ts`): a cream case and a black one both read
    const lum = this.post.meter();
    if (lum !== null) this.metered = Math.min(EYE_RANGE[1], Math.max(EYE_RANGE[0], EYE_KEY / (BASE_EXPOSURE * lum)));
    this.seen *= (this.metered / this.seen) ** (1 - Math.pow(0.01, dt));
    this.post.setEye(this.seen);
    this.post.render();
  };

  private step(dt: number): void {
    const a = this.anim;
    if (!a) return;
    a.t += dt;
    const m = motionFor(a.kind), p = poseAt(m, a.t, a.dir);
    if (a.obj) {
      a.obj.position.set(a.base[0] + p.offset[0], a.base[1] + p.offset[1], a.base[2] + p.offset[2]);
      a.obj.rotation.z = a.baseTurn + p.turn;
    }
    this.setStep(p.label);
    if (a.t >= motionSeconds(m)) { this.anim = null; a.done(); }
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
    const down = (e: PointerEvent) => { el.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; };
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

  /** Dev and checks: put the camera exactly here (the flicker check nudges it a pixel at a time). */
  jump(v: Partial<OrbitView>): void { this.view = this.goal = { ...this.view, ...v }; }
  get orbit(): OrbitView { return this.view; }

  // ------------------------------------------------------------------ the steps
  /** The scene object that stands for a node, or null (the monitor stands in the room, not in the machine). */
  private objectOf(node: string): Object3D | null {
    const root = this.machine.root;
    if (isCableNode(node)) return findById(root, 'cable.' + node.slice(6));
    if (node.startsWith('fan:')) return findById(root, 'case:' + node.slice(4));
    if (isDevNode(node)) {
      const d = this.board.devices.find((x) => devNode(x.id) === node);
      if (!d) return null;
      if (deviceSpec(d).kind === 'display') return this.monitor;
      return findById(root, d.id) ?? (deviceSpec(d).kind === 'psu' ? findById(root, 'psu') : null);
    }
    return null;
  }

  /** Play a node's motion on its object. Without an object (the monitor, an unbuilt cable) the time still passes, so the log reads right. */
  private play(node: string, kind: string, dir: 'out' | 'in'): Promise<void> {
    const obj = this.objectOf(node), m = motionFor(kind);
    return new Promise((done) => {
      const base: [number, number, number] = obj ? [obj.position.x, obj.position.y, obj.position.z] : [0, 0, 0];
      this.anim = { obj, base, baseTurn: obj?.rotation.z ?? 0, kind, dir, t: 0, done };
      if (obj) { const p = poseAt(m, 0, dir); obj.position.set(base[0] + p.offset[0], base[1] + p.offset[1], base[2] + p.offset[2]); }
    });
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
      this.game.disconnectCable(id);
      undo?.push({ t: 'cable', id });
      this.rebuild();
      return null;
    }
    const d = this.board.devices.find((x) => devNode(x.id) === node);
    if (!d) return null;
    const kind = deviceSpec(d).kind;
    await this.play(node, kind, 'out');
    const r = this.game.uninstall(d.id);
    if (!r.ok) { this.note(`Cannot take it out: ${r.reason}`); this.rebuild(); return null; }
    undo?.push({ t: 'dev', spec: d.spec, slot: d.slot, invId: r.invId!, clock: d.clock });
    this.rebuild();
    return r.invId;
  }

  private async putBack(u: Undo): Promise<void> {
    if (u.t === 'cable') {
      if (this.cables[u.id] || !cableNeeded(this.board, u.id as never) || cableBlocked(this.board, u.id as never)) return;
      this.note(`Plug in ${this.snapshot.cables.find((c) => c.id === u.id)?.name ?? u.id}`);
      this.game.connectCable(u.id);
      this.rebuild();
      await this.play(cableNode(u.id), 'cable', 'in');
      return;
    }
    const r = this.game.install(u.invId, u.slot);
    if (!r.ok) { this.note(`Cannot put ${getSpec(u.spec)?.name ?? u.spec} back: ${r.reason}`); return; }
    this.note(`Put back ${getSpec(u.spec)?.name ?? u.spec}`);
    this.rebuild();
    const node = devNode(r.deviceId ?? '');
    await this.play(node, deviceSpec(this.board.devices.find((x) => x.id === r.deviceId)!).kind, 'in');
  }

  /** Plug in the cables a part just fitted needs. */
  private async plugNeeded(): Promise<void> {
    for (const c of cablesOf(this.board)) {
      if (OUTSIDE.has(c.id) || this.cables[c.id] || !cableNeeded(this.board, c.id) || cableBlocked(this.board, c.id)) continue;
      await this.putBack({ t: 'cable', id: c.id });
    }
  }

  private async job(work: () => Promise<void>): Promise<void> {
    if (this.status.peek().busy) return;
    this.status.value = { ...this.status.peek(), busy: true, step: '' };
    this.nSteps = 0;
    try { await work(); } finally {
      await this.door(false);
      this.status.value = { ...this.status.peek(), busy: false, step: '' };
      this.rebuild();
    }
  }

  /** The nodes to take out for a target, in order (the target last). */
  plan(node: string): string[] { return removalPlan(buildGraph(this.board, this.cables), node); }

  /** Take a part out with everything in its way, then put the others back. The part goes to the bin (the game's inventory). */
  remove(node: string): Promise<void> {
    return this.job(async () => {
      const undo: Undo[] = [], steps = this.plan(node);
      for (const n of steps) await this.takeOut(n, n === node ? null : undo);
      for (const u of undo.reverse()) await this.putBack(u);
      this.note(`Done: ${steps.length} step${steps.length === 1 ? '' : 's'}`);
    });
  }

  /** Fit a part from the bin: into a free socket, or in place of the part that holds it. */
  fit(itemId: string): Promise<void> {
    return this.job(async () => {
      const g = this.game;
      if (/^(case|board)\d$/.test(itemId)) return this.fitShell(itemId);
      const spec = getSpec(itemId);
      if (!spec) { this.note(`Unknown part ${itemId}`); return; }
      const free = freeSlots(this.board, spec.slot, spec)[0];
      const taken = boardSlots(this.board).find((s) => slotAccepts(s.type, spec.slot) && slotFitsWidth(s, spec) && this.board.devices.some((d) => d.slot === s.id));
      const slot = free?.id ?? taken?.id;
      if (!slot) { this.note(`${spec.name} fits no socket on this board`); return; }
      const occupant = this.board.devices.find((d) => d.slot === slot) ?? null;
      const graph = buildGraph(this.board, this.cables);
      const steps = occupant ? removalPlan(graph, devNode(occupant.id)) : removalPlanAll(graph, accessBlockers(this.board, slot, spec.kind).filter((n) => graph.has(n)));
      if (!steps.length) steps.push(SIDE);
      if (steps[0] !== SIDE) steps.unshift(SIDE);
      const undo: Undo[] = [];
      for (const n of steps) await this.takeOut(n, occupant && n === devNode(occupant.id) ? null : undo);
      const bought = g.purchase(itemId);
      if (!bought.ok) this.note(`Cannot get ${spec.name}: ${bought.reason}`);
      else {
        const put = g.install(bought.invId, slot);
        if (!put.ok) this.note(`${spec.name} does not fit: ${put.reason}`);
        else {
          this.note(`Fit ${spec.name} in ${slot}`);
          this.rebuild();
          await this.play(devNode(put.deviceId ?? ''), spec.kind, 'in');
          await this.plugNeeded();
        }
      }
      for (const u of undo.reverse()) await this.putBack(u);
      await this.plugNeeded();
    });
  }

  /** The case fans that can be swapped (the mounts a radiator covers have none). */
  fanMounts(): string[] { return caseMounts(this.board.caseTier).filter((m) => !!findById(this.machine.root, 'case:' + m)); }

  /** Swap a case fan: unplug its cable, unscrew and lift it out, put it back, plug it in. */
  serviceFan(mount: string): Promise<void> {
    return this.job(async () => {
      const id = `fan:${mount}`, plugged = !!this.cables[id];
      await this.door(true);
      this.note(`Unplug the fan cable (${mount})`);
      if (plugged) { await this.play(cableNode(id), 'cable', 'out'); this.game.disconnectCable(id); this.rebuild(); }
      this.note(`Take out the fan (${mount})`);
      await this.play('fan:' + mount, 'fan', 'out');
      this.note(`Put the fan back (${mount})`);
      await this.play('fan:' + mount, 'fan', 'in');
      if (plugged) { this.game.connectCable(id); this.rebuild(); await this.play(cableNode(id), 'cable', 'in'); this.note(`Plug in the fan cable (${mount})`); }
    });
  }

  /** A new board or case: every part comes out first, the machine is swapped as one piece, then the parts go back (what no longer fits stays in the bin). */
  private async fitShell(itemId: string): Promise<void> {
    const isCase = itemId.startsWith('case'), tier = Number(itemId.slice(-1));
    if (isCase ? tier === this.board.caseTier : tier === this.board.tier && !this.board.burnt) { this.note('That one is already fitted'); return; }
    const graph = buildGraph(this.board, this.cables), steps = removalPlan(graph, isCase ? CASE : BOARD);
    const undo: Undo[] = [];
    for (const n of steps) {
      if (n === BOARD || n === CASE) break;
      await this.takeOut(n, undo);
    }
    await this.door(false);
    this.note(`Take the old ${isCase ? 'case' : 'board'} away`);
    await this.playRoot(nodeKind(this.board, isCase ? CASE : BOARD), 'out');
    const bought = this.game.purchase(itemId);
    if (!bought.ok) { this.note(bought.reason); await this.playRoot(isCase ? 'case' : 'board', 'in'); }
    else {
      const r = this.game.install(bought.invId);
      if (!r.ok) this.note(`Cannot fit it: ${r.reason}`);
      this.rebuild();
      this.note(`Fit the ${isCase ? CASE_TIERS[tier]!.name : BOARD_TIERS[tier]!.name + ' board'}`);
      await this.playRoot(isCase ? 'case' : 'board', 'in');
    }
    for (const u of undo.reverse()) await this.putBack(u);
    await this.plugNeeded();
  }

  /** The whole machine moves (a board or a case swap). */
  private playRoot(kind: string, dir: 'out' | 'in'): Promise<void> {
    const root = this.machine.root;
    return new Promise((done) => {
      const base: [number, number, number] = [root.position.x, root.position.y, root.position.z];
      this.anim = { obj: root, base, baseTurn: 0, kind, dir, t: 0, done: () => { root.position.set(...base); done(); } };
    });
  }

  /** A new sandbox machine: the biggest rig, as at the start. */
  async reset(): Promise<void> {
    if (this.status.peek().busy) return;
    const { Game } = await import('@/worker/game/game');
    this.game = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
    this.status.value = { busy: false, step: '', log: [], rev: this.status.peek().rev };
    this.rebuild();
  }

  /** An empty case and board of the smallest tier: build up from nothing. */
  async clear(): Promise<void> {
    if (this.status.peek().busy) return;
    const { Game } = await import('@/worker/game/game');
    this.game = new Game({ seed: 1, sandbox: true, preassembled: false });
    this.status.value = { busy: false, step: '', log: [], rev: this.status.peek().rev };
    this.rebuild();
  }

  dispose(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) f();
    this.ctx.scene.remove(this.machine.root);
    this.machine.dispose();
    disposeTree(this.ctx.scene);
    this.ctx.renderer.dispose();
    this.ctx.canvas.remove();
    setLayoutTier(...this.was);
    void this.host;
  }
}
