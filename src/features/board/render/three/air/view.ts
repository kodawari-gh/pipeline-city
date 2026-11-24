// The airflow lens in 3D (docs/render/air.md): the case's air as particles in the machine's own space, seen as a thermal camera sees it. It makes the air of a
// machine from its parts' boxes (plan.ts), solves the flow of every fan once (build.ts, a slice per frame), and then only moves particles: they ride the flow,
// slide round the parts, take heat from the hot ones by the sim's coefficients and leave where air leaves (and go on outside as a jet). The coolant is a liquid of
// its own, run along the hoses and the radiator's lanes (water.ts). The parts glow by their temperature on the thermal scale (`Machine3D.thermal`), the room goes cold and dark under a veil, and a bar tells the scale.
// The words (`airflowModel`) are pinned to 3D points as light DOM pills.
import { Group, type PerspectiveCamera, type Scene } from 'three';
import type { Snapshot } from '@/worker/protocol';
import { effective } from '@/app/graphics';
import { viewInset } from '@/app/hover';
import { FAN_FULL_LEVEL, FanMotor, fanBank, machineLive } from '@/core/render/fanmotor';
import { AMBIENT_C } from '../../../sim/specs';
import { AIR_SOURCES } from '@/features/room/render/desk/airsources';
import { airflowModel } from '@/features/room/render/desk/airflow';
import { fanMounts, radiatorSpan } from '@/features/room/render/desk/props/case';
import { CASE_FRONT } from '@/features/room/render/three/roomplan';
import { CASE_GLASS, REAR_FAN, REAR_FAN_FITTED } from '../../layout/layout';
import { COOLER_AIR } from '../cooler3d';
import { slotRects } from '../slots3d';
import type { Machine3D } from '../machine3d';
import { AirTags3D, type AirTag } from './airtags';
import { AirSim } from './build';
import { planLines } from './debug';
import { AirParticles } from './particles';
import {
  airParts,
  airPlan,
  airReference,
  planKey,
  PSU_BANK,
  psuBay,
  surfaceTemps,
  type AirPart,
  type AirPlan,
} from './plan';
import { makeVeil, Ribbons } from './ribbons';
import { Water } from './water';
import { waterNet } from './waternet';
import type { LineSegments } from 'three';

/** The share of the air particles by the graphics setting (Off, Low, High): the lens always shows some. */
const DENSITY = [0.4, 0.7, 1];
/** Air particles at full density: few, each a fine streak, so the flow reads and the heat is what the eye finds. */
const COUNT = 260;
/** Milliseconds a frame may spend on solving the flow of a new machine. */
const SOLVE_MS = 4;
/** The thermal scale runs from the room's temperature to the hottest part's, over at least this many kelvins (so a cool machine does not look hot) and at most that many. */
const SPAN_MIN = 30,
  SPAN_MAX = 70;
/** Seconds the scale's top takes to follow the hottest part (so the colours do not jump). */
const SCALE_TAU = 1.5;

/** How hard a fan blows by its speed (0 to 1): a fan that turns moves air, a faster one more. */
const blow = (l: number): number => (l > 0.02 ? 0.3 + 0.7 * Math.min(1.3, l) : 0);
/** The same by the fans' bank id (`fanBank`: the 3D machine publishes the speed its fans turn at). */
const levelOf = (bank: string): number => blow(fanBank.level(bank));

export class AirView3D {
  private readonly group = new Group();
  private readonly veil = makeVeil();
  private readonly tags: AirTags3D;
  /** The words as the model made them, and the whole degrees the scale tag shows (it is made again when they change). */
  private words3: AirTag[] = [];
  private shownHi = Number.NaN;
  private plan: AirPlan | null = null;
  private sim: AirSim | null = null;
  private particles: AirParticles | null = null;
  private ribbons: Ribbons | null = null;
  /** The coolant as a liquid, made when the machine has a loop; `waterTried`: it has been looked for since the last rebuild. */
  private water: Water | null = null;
  private waterTried = false;
  private parts: AirPart[] = [];
  private temps: ReadonlyMap<string, number> = new Map();
  private seen: Snapshot | null = null;
  private machine: Machine3D | null = null;
  private filled = false;
  private debugLines: LineSegments[] = [];
  private wantDebug = false;
  private t = 0;
  /** The thermal scale's top, C (its foot is the room's), and whether it was set at all; whether the parts glow now. */
  private hi = AMBIENT_C + SPAN_MIN;
  private scaled = false;
  private glowing = false;
  /** The power supply's fan: it has no fan in the 3D machine, so it turns here by the rule of the 2D board (1 + 8 x the load, only while it runs). */
  private readonly psuFan = new FanMotor();
  private psuLevel = 0;
  private readonly levelFor = (bank: string): number => (bank === PSU_BANK ? this.psuLevel : levelOf(bank));
  /** Milliseconds a frame of the lens takes on the main thread, smoothed (the solve of a new machine included). */
  cost = 0;

  constructor(
    scene: Scene,
    private readonly dom: HTMLElement | null = null,
  ) {
    this.group.add(this.veil);
    this.group.visible = false;
    scene.add(this.group);
    this.tags = new AirTags3D();
    if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __air?: AirView3D }).__air = this;
  }

  // (for the developer: `window.__air`)
  get planNow(): AirPlan | null {
    return this.plan;
  }
  get simNow(): AirSim | null {
    return this.sim;
  }
  get particlesNow(): AirParticles | null {
    return this.particles;
  }
  get partsNow(): readonly AirPart[] {
    return this.parts;
  }
  /** The thermal scale now: its foot and its top, C. */
  get scaleNow(): [number, number] {
    return [AMBIENT_C, this.hi];
  }
  set debug(on: boolean) {
    this.wantDebug = on;
    this.syncDebug();
  }
  get debug(): boolean {
    return this.wantDebug;
  }

  private syncDebug(): void {
    for (const l of this.debugLines) {
      l.removeFromParent();
      l.geometry.dispose();
      (l.material as { dispose(): void }).dispose();
    }
    this.debugLines = [];
    if (!this.wantDebug || !this.plan) return;
    this.debugLines = planLines(this.plan, this.sim ?? undefined);
    for (const l of this.debugLines) this.group.add(l);
  }

  /** Is the lens drawing? */
  get shown(): boolean {
    return this.group.visible;
  }

  hide(): void {
    this.group.visible = false;
    this.tags.show(false);
    // (the parts take their own look back)
    if (this.glowing) {
      this.machine?.thermal(null);
      this.glowing = false;
    }
  }

  /** Make the air of a new machine: the plan, the grid, the particles. */
  private rebuild(snap: Snapshot, bodies: ReturnType<Machine3D['airBodies']>): void {
    this.release();
    const plan = airPlan(snap, bodies),
      sim = new AirSim(plan),
      dens = DENSITY[effective.peek().particles] ?? 1,
      particles = new AirParticles(sim, Math.round(COUNT * dens), 7);
    this.plan = plan;
    this.sim = sim;
    this.particles = particles;
    this.ribbons = new Ribbons(particles);
    // the supply's unit hides what it holds: the air in it is drawn over the casing, a little past it
    const bay = psuBay(snap);
    if (bay) {
      const m = 150;
      this.ribbons.xray(
        [bay.min[0] - m, bay.min[1] - m, bay.min[2] - m],
        [bay.max[0] + m, bay.max[1] + m, bay.max[2] + m],
      );
    }
    this.group.add(this.ribbons.mesh);
    this.filled = false;
    this.scaled = false;
    this.seen = null;
    this.syncDebug();
  }

  private release(): void {
    this.water?.dispose();
    this.water = null;
    this.waterTried = false;
    this.ribbons?.dispose();
    this.ribbons = null;
    this.particles = null;
    this.sim = null;
    this.plan = null;
  }

  /** The words: the 2D model's tags, pinned to the case's glass. */
  private words(snap: Snapshot): void {
    const dev = snap.devices.find((d) => d.kind === 'radiator'),
      span = dev ? radiatorSpan(dev.slot === 'rad-front' ? 'front' : 'top') : null;
    const model = airflowModel({
      s: snap,
      mounts: fanMounts(),
      radiator: span ? { side: span.side as 'front' | 'top', ids: span.ids, rect: span.rect } : null,
      rearFitted: REAR_FAN_FITTED,
      rear: REAR_FAN,
      glass: CASE_GLASS,
      slots: slotRects(snap),
      sources: AIR_SOURCES,
    });
    const z = CASE_FRONT - 150;
    this.words3 = model.tags.map((t): AirTag => ({
      id: t.id,
      at: [t.at[0], -t.at[1], z],
      text: t.text,
      tone: t.tone,
      anchor: t.anchor,
      ...(t.tempC !== undefined ? { tempC: t.tempC } : {}),
    }));
    this.shownHi = Number.NaN;
    this.pushTags();
  }

  /** The words and, under the room's, the thermal scale (its top is the hottest part's temperature, in whole degrees). */
  private pushTags(): void {
    const room = this.words3.find((t) => t.id === 'g.room') ?? this.words3[0],
      hi = Math.round(this.hi);
    this.shownHi = hi;
    this.tags.set(
      room
        ? [
            ...this.words3,
            {
              id: 'g.scale',
              at: room.at,
              text: '',
              tone: 'dim',
              anchor: room.anchor,
              scale: [AMBIENT_C, hi],
              under: room.id,
            },
          ]
        : this.words3,
      this.t,
    );
  }

  /** Per frame, after the camera. `dt`: game seconds (0 holds the air); `pxH`: the view's height in pixels. */
  frame(cam: PerspectiveCamera, pxH: number, snap: Snapshot | null, machine: Machine3D | null, dt: number): void {
    if (!snap || !machine) {
      this.hide();
      return;
    }
    const t0 = performance.now();
    this.t += dt;
    const bodies = machine.airBodies();
    if (!this.plan || machine !== this.machine || planKey(snap, bodies) !== this.plan.key) {
      if (machine !== this.machine && this.glowing) {
        this.machine?.thermal(null);
        this.glowing = false;
      }
      this.machine = machine;
      this.rebuild(snap, bodies);
    }
    const plan = this.plan!,
      sim = this.sim!,
      particles = this.particles!;
    // the supply's fan turns here: the 3D machine has none (it blows by what it draws)
    const running = machineLive(snap),
      load = snap.power.budgetW > 0 ? Math.min(1, Math.max(0, snap.power.totalW / snap.power.budgetW)) : 0;
    this.psuLevel = blow(Math.min(1, this.psuFan.step(dt, running ? 1 + 8 * load : 0) / FAN_FULL_LEVEL));
    // the flow of each fan, a slice a frame; the case fills the moment it is all solved
    if (!sim.field.ready) sim.run(SOLVE_MS);
    if (sim.field.ready) {
      if (sim.levels(this.levelFor) && !this.filled && sim.inflow > 0) {
        particles.fill(AMBIENT_C);
        this.filled = true;
      }
    }
    if (snap !== this.seen) {
      this.seen = snap;
      this.parts = airParts(snap, plan);
      this.temps = surfaceTemps(snap, this.parts);
      particles.setParts(this.parts);
      this.words(snap);
    }
    // the thermal scale: from the room's temperature to a little over the hottest part, eased
    let top = AMBIENT_C;
    for (const v of this.temps.values()) if (v > top) top = v;
    const goal = Math.min(AMBIENT_C + SPAN_MAX, Math.max(AMBIENT_C + SPAN_MIN, top));
    this.hi = this.scaled ? this.hi + (goal - this.hi) * (1 - Math.exp(-Math.min(dt, 0.2) / SCALE_TAU)) : goal;
    this.scaled = true;
    machine.thermal(this.temps, AMBIENT_C, this.hi);
    this.glowing = true;
    const loop = snap.board?.loop;
    if (sim.field.ready) particles.step({ dt, ambientC: AMBIENT_C, mixC: airReference(snap) });
    this.ribbons!.frame(cam, pxH, AMBIENT_C, this.hi);
    if (this.ribbons!.mesh.parent !== this.group) this.group.add(this.ribbons!.mesh);
    // the water: made once the machine has a loop (its hoses are built by then), still when the pump is off
    if (loop && !this.water && !this.waterTried) {
      this.waterTried = true;
      const net = waterNet(machine.loopPaths(), machine.loopRadiator(), COOLER_AIR.pump);
      if (net) {
        this.water = new Water(net);
        this.group.add(this.water.mesh);
      }
    }
    if (this.water) {
      this.water.mesh.visible = !!loop;
      if (loop) this.water.frame(cam, pxH, AMBIENT_C, this.hi, loop.hotC, loop.coldC, running ? loop.flow : 0, dt);
    }
    this.group.visible = true;
    this.tags.show(true);
    if (Math.round(this.hi) !== this.shownHi) this.pushTags();
    const r = this.dom?.getBoundingClientRect();
    if (r)
      this.tags.frame(cam, {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        minTop: viewInset.peek().top,
      }); // (a label under the HUD bar cannot be read)
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
  }

  dispose(): void {
    this.hide();
    this.release();
    for (const l of this.debugLines) {
      l.geometry.dispose();
      (l.material as { dispose(): void }).dispose();
    }
    this.group.removeFromParent();
    (this.veil.material as { dispose(): void }).dispose();
    this.veil.geometry.dispose();
    this.tags.dispose();
  }
}
