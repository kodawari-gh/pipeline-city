// The airflow lens in 3D (docs/render/air.md): the case's air as particles in the machine's own space. It makes the air of a machine from its parts' boxes
// (plan.ts), solves the flow of every fan once (build.ts, a slice per frame), and then only moves particles: they ride the flow, slide round the parts, take heat
// from the hot ones by the sim's coefficients and leave where air leaves. The coolant and the power supply's air run on lines of their own. The words
// (`airflowModel`) are pinned to 3D points as light DOM pills. A dark veil under it all dims the room.
import { Group, type PerspectiveCamera, type Scene } from 'three';
import type { Snapshot } from '@/worker/protocol';
import { effective } from '@/app/graphics';
import { FAN_FULL_LEVEL, FanMotor, fanBank, machineLive } from '@/core/render/fanmotor';
import { AMBIENT_C } from '../../../sim/specs';
import { AIR_SOURCES } from '@/features/room/render/desk/airsources';
import { airflowModel, type AirModel } from '@/features/room/render/desk/airflow';
import { fanMounts, radiatorSpan } from '@/features/room/render/desk/props/case';
import { CASE_FRONT } from '@/features/room/render/three/roomplan';
import { CASE_GLASS, REAR_FAN, REAR_FAN_FITTED } from '../../layout/layout';
import { basementPlan } from '../basement3d';
import { slotRects } from '../slots3d';
import type { Machine3D } from '../machine3d';
import { AirTags3D, type AirTag } from './airtags';
import { AirSim } from './build';
import { planLines } from './debug';
import { AirParticles } from './particles';
import { airParts, airPlan, airReference, loopPath, pathLine, planKey, type AirPart, type AirPlan, type PathLine } from './plan';
import { makeVeil, Ribbons } from './ribbons';
import type { V3 } from './grid';
import type { LineSegments } from 'three';

/** The share of the air particles by the graphics setting (Off, Low, High): the lens always shows some. */
const DENSITY = [0.4, 0.7, 1];
/** Air particles at full density. */
const COUNT = 1900;
/** Milliseconds a frame may spend on solving the flow of a new machine. */
const SOLVE_MS = 4;

/** How hard a fan blows by its speed (0 to 1): a fan that turns moves air, a faster one more. */
const blow = (l: number): number => (l > 0.02 ? 0.3 + 0.7 * Math.min(1.3, l) : 0);
/** The same by the fans' bank id (`fanBank`: the 3D machine publishes the speed its fans turn at). */
export const levelOf = (bank: string): number => blow(fanBank.level(bank));

export class AirView3D {
  private readonly group = new Group();
  private readonly veil = makeVeil();
  private readonly tags: AirTags3D;
  private plan: AirPlan | null = null;
  private sim: AirSim | null = null;
  private particles: AirParticles | null = null;
  private ribbons: Ribbons | null = null;
  private model: AirModel | null = null;
  private parts: AirPart[] = [];
  private seen: Snapshot | null = null;
  private machine: Machine3D | null = null;
  private filled = false;
  private debugLines: LineSegments[] = [];
  private wantDebug = false;
  private t = 0;
  /** The power supply's fan: it has no fan in the 3D machine, so it turns here by the rule of the 2D board (1 + 8 x the load, only while it runs). */
  private readonly psuFan = new FanMotor();
  /** Milliseconds a frame of the lens takes on the main thread, smoothed (the solve of a new machine included). */
  cost = 0;

  constructor(private readonly scene: Scene, private readonly dom: HTMLElement | null = null) {
    this.group.add(this.veil);
    this.group.visible = false;
    scene.add(this.group);
    this.tags = new AirTags3D();
    if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __air?: AirView3D }).__air = this;
  }

  // (for the developer: `window.__air`)
  get planNow(): AirPlan | null { return this.plan; }
  get simNow(): AirSim | null { return this.sim; }
  get particlesNow(): AirParticles | null { return this.particles; }
  get partsNow(): readonly AirPart[] { return this.parts; }
  set debug(on: boolean) { this.wantDebug = on; this.syncDebug(); }
  get debug(): boolean { return this.wantDebug; }

  private syncDebug(): void {
    for (const l of this.debugLines) { l.removeFromParent(); l.geometry.dispose(); (l.material as { dispose(): void }).dispose(); }
    this.debugLines = [];
    if (!this.wantDebug || !this.plan) return;
    this.debugLines = planLines(this.plan, this.sim ?? undefined);
    for (const l of this.debugLines) this.group.add(l);
  }

  /** Is the lens drawing? */
  get shown(): boolean { return this.group.visible; }

  hide(): void {
    this.group.visible = false;
    this.tags.show(false);
  }

  /** Make the air of a new machine: the plan, the grid, the particles. */
  private rebuild(snap: Snapshot, bodies: ReturnType<Machine3D['airBodies']>): void {
    this.release();
    const plan = airPlan(snap, bodies), sim = new AirSim(plan), dens = DENSITY[effective.peek().particles] ?? 1, particles = new AirParticles(sim, Math.round(COUNT * dens), 7);
    this.plan = plan;
    this.sim = sim;
    this.particles = particles;
    this.ribbons = new Ribbons(particles);
    this.group.add(this.ribbons.mesh);
    this.filled = false;
    this.seen = null;
    this.syncDebug();
  }

  private release(): void {
    this.ribbons?.dispose();
    this.ribbons = null;
    this.particles = null;
    this.sim = null;
    this.plan = null;
  }

  /** The words: the 2D model's tags (and its channel for the power supply's air), pinned to the case's glass. */
  private words(snap: Snapshot): void {
    const dev = snap.devices.find((d) => d.kind === 'radiator'), span = dev ? radiatorSpan(dev.slot === 'rad-front' ? 'front' : 'top') : null;
    const model = airflowModel({
      s: snap, mounts: fanMounts(), radiator: span ? { side: span.side as 'front' | 'top', ids: span.ids, rect: span.rect } : null,
      rearFitted: REAR_FAN_FITTED, rear: REAR_FAN, glass: CASE_GLASS, slots: slotRects(snap), sources: AIR_SOURCES,
    });
    this.model = model;
    const z = CASE_FRONT - 150;
    this.tags.set(model.tags.map((t): AirTag => ({ id: t.id, at: [t.at[0], -t.at[1], z], text: t.text, tone: t.tone, anchor: t.anchor, ...(t.tempC !== undefined ? { tempC: t.tempC } : {}) })), this.t);
  }

  /** The power supply's channel: the model's lane through the supply, lifted into the machine's depth. */
  private channel(): PathLine | null {
    const lane = this.model?.lanes.find((l) => l.channel && l.id === 'fan.psu');
    if (!lane || lane.pts.length < 2) return null;
    const u = basementPlan().psu, z = (u.z0 + u.z1) / 2;
    return pathLine(lane.pts.map(([x, y]): V3 => [x, -y, z]));
  }

  /** Per frame, after the camera. `dt`: game seconds (0 holds the air); `pxH`: the view's height in pixels. */
  frame(cam: PerspectiveCamera, pxH: number, snap: Snapshot | null, machine: Machine3D | null, dt: number): void {
    if (!snap || !machine) { this.hide(); return; }
    const t0 = performance.now();
    this.t += dt;
    const bodies = machine.airBodies();
    if (!this.plan || machine !== this.machine || planKey(snap, bodies) !== this.plan.key) {
      this.machine = machine;
      this.rebuild(snap, bodies);
    }
    const plan = this.plan!, sim = this.sim!, particles = this.particles!;
    // the flow of each fan, a slice a frame; the case fills the moment it is all solved
    if (!sim.field.ready) sim.run(SOLVE_MS);
    if (sim.field.ready) {
      if (sim.levels(levelOf) && !this.filled && sim.inflow > 0) { particles.fill(AMBIENT_C); this.filled = true; }
    }
    if (snap !== this.seen) {
      this.seen = snap;
      this.parts = airParts(snap, plan);
      particles.setParts(this.parts);
      this.words(snap);
      const rad = plan.bodies.find((b) => b.kind === 'radiator'), side = snap.devices.find((d) => d.kind === 'radiator')?.slot === 'rad-front' ? 'front' : 'top';
      particles.setLoop(snap.board?.loop && rad ? loopPath(machine.loopPaths(), rad, side) : null);
      particles.setChannel(this.channel());
    }
    const loop = snap.board?.loop, running = machineLive(snap), psu = this.model?.zones.find((z) => z.id === 'psu');
    const load = snap.power.budgetW > 0 ? Math.min(1, Math.max(0, snap.power.totalW / snap.power.budgetW)) : 0, psuSpeed = this.psuFan.step(dt, running ? 1 + 8 * load : 0);
    if (sim.field.ready) {
      particles.step({
        dt, ambientC: AMBIENT_C, mixC: airReference(snap),
        coolant: loop && running ? { flow: loop.flow, hotC: loop.hotC, coldC: loop.coldC } : null,
        psu: psu && psuSpeed > 0.04 ? { level: blow(Math.min(1, psuSpeed / FAN_FULL_LEVEL)), tempC: psu.tempC } : null,
      });
    }
    this.ribbons!.frame(cam, pxH, AMBIENT_C);
    if (this.ribbons!.mesh.parent !== this.group) this.group.add(this.ribbons!.mesh);
    this.group.visible = true;
    this.tags.show(true);
    const r = this.dom?.getBoundingClientRect();
    if (r) this.tags.frame(cam, { left: r.left, top: r.top, width: r.width, height: r.height });
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
  }

  dispose(): void {
    this.release();
    for (const l of this.debugLines) { l.geometry.dispose(); (l.material as { dispose(): void }).dispose(); }
    this.group.removeFromParent();
    (this.veil.material as { dispose(): void }).dispose();
    this.veil.geometry.dispose();
    this.tags.dispose();
  }
}
