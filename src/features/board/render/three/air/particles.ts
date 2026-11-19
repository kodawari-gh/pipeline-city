// The air's particles (docs/render/air.md): small parcels of air that ride the flow of the grid (build.ts) and carry heat. They are born where air
// comes in (an intake fan, a vent), pushed round the parts (the parts' boxes stop them: they slide along a face), heated where they pass a hot part
// (each part's coefficient from the sim, scaled by how fast the air runs over it), lifted by their own warmth, and gone where air leaves. The air that
// leaves goes on outside the case as a jet, and room air is drawn in toward each intake: the halo, drawn fading out with the distance from the case.
// The coolant of a liquid loop is particles too, on a line of its own. Structure of arrays, no allocation per step. Pure TS.
import type { AirSim } from './build';
import { coolantAt, pointOn, UNITS_PER_M, type AirPart, type LoopPath } from './plan';
import type { V3 } from './grid';

/** What the air does in game time is shown this much slower: the real air crosses a case in a second, too fast to follow. */
export const TIME_SCALE = 0.5;
/**
 * Points of a particle's trail (the head and its past). The past moves on when the head has gone a stretch from the last point: as long as the air is
 * fast (`STRETCH_S` seconds of its travel, between the two limits, units), so a streak shows the speed, and never so short that a slow one is a dot. Still
 * air moves it on after `TRAIL_WAIT` seconds.
 */
export const TRAIL = 8;
const STRETCH_MIN = 110, STRETCH_MAX = 520, STRETCH_S = 0.075, TRAIL_WAIT = 0.3;
/** A bead of coolant is a short dash, less than the gap to the next: this much of trail between its points, units. */
const STRETCH_BEAD = 30;
/** Air's heat capacity per volume, J per cubic metre and kelvin, and the units cubed in a metre cubed. */
const RHO_CP = 1.2 * 1005;
const M3 = UNITS_PER_M ** 3;
/** The speed over a part at which its coefficient holds, and the exponent forced convection follows (the heat moved grows as speed to 0.6 or so). */
const U_REF = 0.5 * UNITS_PER_M;
/** Units per second a parcel rises for each kelvin it is warmer than the room (buoyancy against the drag of the case). */
const BUOY = 0.02 * UNITS_PER_M;
/**
 * Seconds a warm parcel takes to mix with the case's air (a plume fades over the width of a case), and how much faster a parcel takes a part's heat than the
 * air as a whole does (a parcel is a small sample of air: it is in the part's boundary layer, where the air is near the part's own warmth).
 */
const MIX_TAU = 2.5, TAKE_GAIN = 5;
/**
 * A part shed warm parcels: only those that happen to cross it would take its heat, and the plume is what a thermal view is for. It sheds one parcel a second
 * for each `WARM_W` watts it gives the air (at most `WARM_MAX_RATE` a second), when it is `WARM_MIN_K` kelvins over the room; they start `WARM_START` of the way
 * to its warmth; and they may swell the pool by `WARM_EXTRA`.
 */
const WARM_W = 12, WARM_MAX_RATE = 5, WARM_MIN_K = 6, WARM_START = 0.7, WARM_EXTRA = 120;
/** The share of the air's speed the eddies move at, and the speed they have in still air (units per second); how long an eddy lasts, s. */
const TURB = 0.2, TURB_BASE = 700, TURB_TAU = 0.5;
/** An axis a box blocks: the air passes less than this share of it. */
const BLOCK = 0.12;
const EDGE = 2;
/** The coolant's speed at full flow, units per second. */
const COOLANT_SPEED = 7000;
/** Spacing of the coolant's beads along the line, units. */
const BEAD = 330;

// The halo: the case's air is the air inside it, but a fan reaches the room. Air that leaves an exit goes on outside as a jet (a ray from the exit that
// slows and mixes into the room); room air is drawn in toward each intake (a ray to the intake that speeds up as it nears it). Neither is solved: the room
// is not in the grid. Both are drawn fading out with the distance from the case, over `HALO_K` of its longest side.
/** The halo's pool as a share of the case's air particles, the share of it that is drawn in, and the share of the air that leaves an exit and goes on as a jet. */
const HALO_SHARE = 0.2, HALO_IN = 0.45, HALO_TAKE = 0.5;
/** How far the halo reaches: a share of the case's longest side, between two limits (units). */
const HALO_K = 0.5, HALO_MIN = 3200, HALO_MAX = 7500;
/** How bright the halo is against the air inside. */
const HALO_ALPHA = 0.85;
/** A jet: seconds it takes to slow to half, the tangent of its half-angle, and the least speed it leaves at (units per second). */
const JET_TAU = 0.45, SPREAD = 0.3, SPEED_MIN = 3500;
/** A draw-in: the distance (units) over which it speeds up toward the intake, and where it counts as arrived. The cone it comes from: the cosine of its half-angle. */
const SINK_R = 1500, SINK_END = 350, CONE_COS = 0.47;
/** The eddies of the halo (a share of its speed), seconds a warm jet takes to mix into the room, and the share of the case's buoyancy it feels. */
const TURB_OUT = 0.22, OUT_MIX_TAU = 1.2, OUT_BUOY = 0.7;
/** Seconds a jet lives outside (at least, and a spread over it), and a draw-in at most. */
const JET_LIFE = 1.3, JET_LIFE_SPREAD = 1.2, SINK_LIFE = 5;

export interface AirEnv {
  /** Seconds since the last step; 0 holds everything still (the game is paused). */
  dt: number;
  ambientC: number;
  /** The case air's mean temperature: a warm parcel mixes toward it. */
  mixC: number;
  coolant: { flow: number; hotC: number; coldC: number } | null;
}

interface PartRt { id: string; lo: V3; hi: V3; tempC: number; rate: number; ua: number; powerW: number; porous: boolean; key: string }

/** Kinds of particle. `EXHAUST` and `INTAKE` are the halo, outside the case. */
export const AIR = 1, COOLANT = 2, EXHAUST = 3, INTAKE = 4;

export class AirParticles {
  readonly cap: number;
  count = 0;
  /** Each particle's trail: `TRAIL` points of x, y, z, the head first. */
  readonly P: Float32Array;
  readonly T: Float32Array;
  /** The fade of each (0 to 1). */
  readonly A: Float32Array;
  readonly K: Uint8Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly tick: Float32Array;
  private readonly eddy: Float32Array;
  /** A bead: its length along the line. A jet: the speed it left at. A draw-in: the speed at its intake. */
  private readonly at: Float32Array;
  /** A jet: its direction. A draw-in: the point on the wall it is drawn to. */
  private readonly aux: Float32Array;
  private parts: PartRt[] = [];
  /** Per part, the warm parcels it owes (a fraction builds up between frames). */
  private warm = new Float32Array(0);
  private partStart = new Int32Array(0);
  private partList = new Int32Array(0);
  private partKey = '';
  private nAir = 0;
  private nEx = 0;
  private nIn = 0;
  private acc = 0;
  private accIn = 0;
  private loop: LoopPath | null = null;
  private seed: number;
  private readonly u: V3 = [0, 0, 0];
  private readonly q: V3 = [0, 0, 0];
  private readonly o: V3 = [0, 0, 0];
  /** The wall the air that left last went out through (`collide`). */
  private exitWall = 0;
  /** The halo's pool, the most of it drawn in, and the most jets. */
  readonly haloMax: number;
  private readonly inMax: number;
  private readonly exMax: number;
  /** How far from the case the halo reaches, units. */
  readonly halo: number;

  /** `target`: how many air parcels the case holds. */
  constructor(readonly sim: AirSim, public target: number, seed = 1) {
    this.haloMax = Math.round(target * HALO_SHARE);
    this.inMax = Math.round(this.haloMax * HALO_IN);
    this.exMax = this.haloMax - this.inMax;
    this.cap = target + 130 + this.haloMax;
    const g = sim.grid;
    this.halo = Math.min(HALO_MAX, Math.max(HALO_MIN, HALO_K * Math.max(g.max[0] - g.min[0], g.max[1] - g.min[1], g.max[2] - g.min[2])));
    this.P = new Float32Array(this.cap * TRAIL * 3);
    this.T = new Float32Array(this.cap);
    this.A = new Float32Array(this.cap);
    this.K = new Uint8Array(this.cap);
    this.age = new Float32Array(this.cap);
    this.life = new Float32Array(this.cap);
    this.tick = new Float32Array(this.cap);
    this.eddy = new Float32Array(this.cap * 3);
    this.at = new Float32Array(this.cap);
    this.aux = new Float32Array(this.cap * 3);
    this.seed = seed >>> 0 || 1;
  }

  private rand(): number {
    // mulberry32
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private gauss(): number { return (this.rand() + this.rand() + this.rand() - 1.5) * 2; }

  // ------------------------------------------------------------------ what the air meets

  /** The parts that heat the air. Their boxes are cut into the grid once (when the set or the boxes change); their temperatures and coefficients are read every time. */
  setParts(parts: readonly AirPart[]): void {
    const key = parts.map((p) => `${p.id}${p.min}${p.max}${p.porous}`).join('|');
    const g = this.sim.grid;
    const rt = parts.map((p): PartRt => {
      const lo: V3 = [p.min[0] - p.reach, p.min[1] - p.reach, p.min[2] - p.reach], hi: V3 = [p.max[0] + p.reach, p.max[1] + p.reach, p.max[2] + p.reach];
      const vol = (a: V3, b: V3) => Math.max(1, (b[0] - a[0]) * (b[1] - a[1]) * (b[2] - a[2]));
      // the air in play: the part's own box for fins, the shell round it for a plain part
      const v = (p.porous ? vol(p.min, p.max) : vol(lo, hi) - vol(p.min, p.max)) / M3;
      return { id: p.id, lo, hi, tempC: p.tempC, rate: Math.min(60, TAKE_GAIN * p.ua / (RHO_CP * v)), ua: p.ua, powerW: p.powerW, porous: p.porous, key: `${p.id}` };
    });
    if (key !== this.partKey) {
      this.partKey = key;
      const counts = new Int32Array(g.cells + 1), lists: [number, number][] = [];
      rt.forEach((p, pi) => {
        const span = (a: number): [number, number] => [Math.max(0, Math.floor((p.lo[a]! - g.min[a]!) / g.h[a]!)), Math.min(g.n[a]! - 1, Math.floor((p.hi[a]! - g.min[a]!) / g.h[a]!))];
        const [i0, i1] = span(0), [j0, j1] = span(1), [k0, k1] = span(2);
        for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = g.index(i, j, k); lists.push([c, pi]); counts[c + 1]!++; }
      });
      this.partStart = new Int32Array(g.cells + 1);
      for (let c = 0; c < g.cells; c++) this.partStart[c + 1] = this.partStart[c]! + counts[c + 1]!;
      this.partList = new Int32Array(lists.length);
      const fill = this.partStart.slice(0, g.cells);
      for (const [c, pi] of lists) this.partList[fill[c]!++] = pi;
    }
    this.parts = rt;
    if (this.warm.length !== rt.length) this.warm = new Float32Array(rt.length);
  }

  /** The coolant's loop (or null): beads of water run along it. */
  setLoop(loop: LoopPath | null): void {
    if (loop === this.loop) return;
    this.loop = loop;
    this.drop(COOLANT);
    if (!loop) return;
    const n = Math.max(10, Math.min(120, Math.round(loop.length / BEAD)));
    for (let i = 0; i < n; i++) this.spawnPath((i / n) * loop.length);
  }

  private drop(kind: number): void {
    for (let i = this.count - 1; i >= 0; i--) if (this.K[i] === kind) this.remove(i);
  }

  // ------------------------------------------------------------------ births and deaths

  private slot(kind: number, life: number, T: number): number {
    if (this.count >= this.cap) return -1;
    const i = this.count++;
    this.K[i] = kind;
    this.T[i] = T;
    this.age[i] = 0;
    this.life[i] = life;
    this.tick[i] = 0;
    this.A[i] = 0;
    this.eddy[3 * i] = this.eddy[3 * i + 1] = this.eddy[3 * i + 2] = 0;
    if (kind === AIR) this.nAir++;
    else if (kind === EXHAUST) this.nEx++;
    else if (kind === INTAKE) this.nIn++;
    return i;
  }

  private remove(i: number): void {
    const kind = this.K[i];
    if (kind === AIR) this.nAir--;
    else if (kind === EXHAUST) this.nEx--;
    else if (kind === INTAKE) this.nIn--;
    const last = --this.count;
    if (i !== last) {
      this.K[i] = this.K[last]!;
      this.T[i] = this.T[last]!;
      this.A[i] = this.A[last]!;
      this.age[i] = this.age[last]!;
      this.life[i] = this.life[last]!;
      this.tick[i] = this.tick[last]!;
      this.at[i] = this.at[last]!;
      for (let k = 0; k < 3; k++) { this.eddy[3 * i + k] = this.eddy[3 * last + k]!; this.aux[3 * i + k] = this.aux[3 * last + k]!; }
      for (let k = 0; k < TRAIL * 3; k++) this.P[i * TRAIL * 3 + k] = this.P[last * TRAIL * 3 + k]!;
    }
  }

  private put(i: number, x: number, y: number, z: number): void {
    const o = i * TRAIL * 3;
    for (let k = 0; k < TRAIL; k++) { this.P[o + 3 * k] = x; this.P[o + 3 * k + 1] = y; this.P[o + 3 * k + 2] = z; }
  }

  /** Is a point inside a body that stops all air? */
  private inSolid(x: number, y: number, z: number): boolean {
    const g = this.sim.grid, c = g.cellAt(x, y, z);
    if (c < 0) return true;
    for (let n = g.boxStart[c]!; n < g.boxStart[c + 1]!; n++) {
      const b = g.boxes[g.boxList[n]!]!;
      if (b.k[0] < BLOCK && b.k[1] < BLOCK && b.k[2] < BLOCK && x > b.min[0] && x < b.max[0] && y > b.min[1] && y < b.max[1] && z > b.min[2] && z < b.max[2]) return true;
    }
    return false;
  }

  /** A particle of air where the air comes in, with the room's temperature. */
  private spawnAir(ambientC: number): boolean {
    const hit = this.sim.inlet(this.rand());
    if (!hit) return false;
    const g = this.sim.grid, c = g.centre(hit.c, this.o), axis = hit.wall >> 1, hi = (hit.wall & 1) === 1;
    const p: V3 = [c[0] + (this.rand() - 0.5) * g.h[0], c[1] + (this.rand() - 0.5) * g.h[1], c[2] + (this.rand() - 0.5) * g.h[2]];
    // (just inside the wall it comes through)
    const ha = g.h[axis]!;
    p[axis] = hi ? g.max[axis]! - 0.1 * ha - this.rand() * 0.4 * ha : g.min[axis]! + 0.1 * ha + this.rand() * 0.4 * ha;
    if (this.inSolid(p[0], p[1], p[2])) return false;
    const i = this.slot(AIR, 9 + this.rand() * 7, ambientC);
    if (i < 0) return false;
    this.put(i, p[0], p[1], p[2]);
    return true;
  }

  /** A parcel that has just taken a part's heat: born in the part's own air (its fins, or the shell round it) at `WARM_START` of the way to the part's warmth. */
  private spawnWarm(p: PartRt, ambientC: number): boolean {
    const x = p.lo[0] + this.rand() * (p.hi[0] - p.lo[0]), y = p.lo[1] + this.rand() * (p.hi[1] - p.lo[1]), z = p.lo[2] + this.rand() * (p.hi[2] - p.lo[2]);
    if (this.sim.grid.cellAt(x, y, z) < 0 || this.inSolid(x, y, z)) return false;
    const i = this.slot(AIR, 9 + this.rand() * 7, ambientC + WARM_START * (0.6 + 0.4 * this.rand()) * (p.tempC - ambientC));
    if (i < 0) return false;
    this.put(i, x, y, z);
    return true;
  }

  /** A particle at a random place in the case's air, at a random age: the case is full when the view opens. */
  private spawnAnywhere(ambientC: number): boolean {
    const g = this.sim.grid;
    for (let tries = 0; tries < 12; tries++) {
      const c = Math.floor(this.rand() * g.cells);
      if (g.solid(c)) continue;
      const m = g.centre(c, this.o), x = m[0] + (this.rand() - 0.5) * g.h[0], y = m[1] + (this.rand() - 0.5) * g.h[1], z = m[2] + (this.rand() - 0.5) * g.h[2];
      if (this.inSolid(x, y, z)) continue;
      const i = this.slot(AIR, 9 + this.rand() * 7, ambientC);
      if (i < 0) return false;
      this.put(i, x, y, z);
      this.age[i] = this.rand() * this.life[i]! * 0.8;
      return true;
    }
    return false;
  }

  private spawnPath(s: number): void {
    const line = this.loop;
    if (!line) return;
    const i = this.slot(COOLANT, 1e9, 25);
    if (i < 0) return;
    this.at[i] = s;
    const p = pointOn(line, s, this.q);
    this.put(i, p[0], p[1], p[2]);
  }

  /** Room air a way off an intake, drawn toward it: the halo. It starts in a cone before the opening it comes to, at a distance the halo reaches. */
  private spawnIntake(ambientC: number): boolean {
    if (this.nIn >= this.inMax) return false;
    const hit = this.sim.inlet(this.rand());
    if (!hit) return false;
    const g = this.sim.grid, c = g.centre(hit.c, this.o), axis = hit.wall >> 1, sgn = (hit.wall & 1) === 1 ? 1 : -1, a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
    // the point on the wall it is drawn to
    c[axis] = sgn > 0 ? g.max[axis]! : g.min[axis]!;
    this.sim.field.sample(c[0], c[1], c[2], this.u);
    const speed = Math.max(SPEED_MIN, Math.hypot(this.u[0], this.u[1], this.u[2]));
    // a place in the cone before it, nearer the wall than the halo's edge
    const cosT = 1 - this.rand() * (1 - CONE_COS), sinT = Math.sqrt(1 - cosT * cosT), ph = this.rand() * 2 * Math.PI;
    const out = this.halo * (0.12 + 0.68 * this.rand()) / cosT;
    const i = this.slot(INTAKE, SINK_LIFE, ambientC);
    if (i < 0) return false;
    const e = 3 * i;
    this.aux[e] = c[0]; this.aux[e + 1] = c[1]; this.aux[e + 2] = c[2];
    this.at[i] = speed;
    const d = this.q;
    d[axis] = sgn * cosT; d[a1] = sinT * Math.cos(ph); d[a2] = sinT * Math.sin(ph);
    this.put(i, c[0] + d[0] * out, c[1] + d[1] * out, c[2] + d[2] * out);
    return true;
  }

  /**
   * A parcel of air that reached an exit goes on outside as a jet (the halo) by its own place, speed and warmth, along the wall's normal with a spread and
   * the drift it had. Its trail goes on through the wall, so the streak leaves the case whole. False when this parcel is not taken (the halo is full).
   */
  private handOver(i: number, speed: number): boolean {
    if (this.nEx >= this.exMax || this.rand() > HALO_TAKE) return false;
    const wall = this.exitWall, axis = wall >> 1, sgn = (wall & 1) === 1 ? 1 : -1, a1 = (axis + 1) % 3, a2 = (axis + 2) % 3, e = 3 * i, d = this.o, p = this.q, u = this.u;
    const m = Math.max(1, speed);
    d[axis] = sgn;
    d[a1] = (this.rand() - 0.5) * 2 * SPREAD + 0.35 * u[a1]! / m;
    d[a2] = (this.rand() - 0.5) * 2 * SPREAD + 0.35 * u[a2]! / m;
    const n = Math.hypot(d[0], d[1], d[2]);
    this.aux[e] = d[0] / n; this.aux[e + 1] = d[1] / n; this.aux[e + 2] = d[2] / n;
    this.at[i] = Math.max(SPEED_MIN, speed);
    this.K[i] = EXHAUST;
    this.nAir--;
    this.nEx++;
    this.age[i] = 0;
    this.life[i] = JET_LIFE + this.rand() * JET_LIFE_SPREAD;
    this.tick[i] = 0;
    const h = i * TRAIL * 3;
    this.P[h] = p[0]!; this.P[h + 1] = p[1]!; this.P[h + 2] = p[2]!;
    this.P[h + axis] = p[axis]! + sgn * 6;
    return true;
  }

  /** Is a point inside the case's air box? */
  private inside(x: number, y: number, z: number): boolean {
    const g = this.sim.grid;
    return x > g.min[0] && x < g.max[0] && y > g.min[1] && y < g.max[1] && z > g.min[2] && z < g.max[2];
  }

  /** How far a point is outside the case's air box, units (0 on or inside it). */
  private reach(x: number, y: number, z: number): number {
    const g = this.sim.grid;
    return Math.hypot(Math.max(g.min[0] - x, x - g.max[0], 0), Math.max(g.min[1] - y, y - g.max[1], 0), Math.max(g.min[2] - z, z - g.max[2], 0));
  }

  /** Fill the case with air as it flows now. */
  fill(ambientC: number): void {
    this.drop(AIR);
    this.drop(EXHAUST);
    this.drop(INTAKE);
    if (this.sim.inflow <= 0) return;
    for (let n = 0; n < this.target; n++) this.spawnAnywhere(ambientC);
  }

  // ------------------------------------------------------------------ the step

  /** Move every particle by `env.dt` seconds of game time (shown `TIME_SCALE` slower). */
  step(env: AirEnv): void {
    const dt = env.dt;
    if (dt <= 0) return;
    const dtp = Math.min(dt, 0.05) * TIME_SCALE, sim = this.sim, u = this.u, o = this.o;
    const mixK = 1 - Math.exp(-dtp / MIX_TAU), eddyK = Math.exp(-dtp / TURB_TAU), eddyS = Math.sqrt(1 - eddyK * eddyK), outK = 1 - Math.exp(-dtp / OUT_MIX_TAU);
    for (let i = 0; i < this.count; i++) {
      const kind = this.K[i]!, h = i * TRAIL * 3;
      this.age[i]! += dt;
      if (kind !== COOLANT && this.age[i]! > this.life[i]!) { this.remove(i--); continue; }
      let x = this.P[h]!, y = this.P[h + 1]!, z = this.P[h + 2]!, speed = 0, wrapped = false, fade = 1;
      if (kind === AIR) {
        o[0] = x; o[1] = y; o[2] = z;
        sim.field.sample(x, y, z, u);
        speed = Math.hypot(u[0], u[1], u[2]);
        const T = this.T[i]!, sg = TURB * (speed + TURB_BASE) * eddyS, e = 3 * i;
        // eddies: a velocity that wanders and fades, so the streams are not combed
        this.eddy[e] = this.eddy[e]! * eddyK + sg * this.gauss();
        this.eddy[e + 1] = this.eddy[e + 1]! * eddyK + sg * this.gauss();
        this.eddy[e + 2] = this.eddy[e + 2]! * eddyK + sg * this.gauss();
        x += (u[0] + this.eddy[e]!) * dtp;
        y += (u[1] + this.eddy[e + 1]! + BUOY * Math.max(-3, T - env.ambientC)) * dtp;
        z += (u[2] + this.eddy[e + 2]!) * dtp;
        if (this.collide(o, x, y, z)) { if (!this.handOver(i, speed)) this.remove(i--); continue; }
        x = this.q[0]; y = this.q[1]; z = this.q[2];
        this.exchange(i, x, y, z, speed, dtp);
        const Tn = this.T[i]!;
        if (Tn > env.mixC) this.T[i] = Tn + (env.mixC - Tn) * mixK;
      } else if (kind === COOLANT) {
        const line = this.loop;
        if (!line) { this.remove(i--); continue; }
        const flow = env.coolant?.flow ?? 0, before = this.at[i]!, s = (before + flow * COOLANT_SPEED * dtp) % Math.max(1, line.length);
        // (a bead that comes round to the line's start leaves no trail across it)
        wrapped = s < before;
        this.at[i] = s;
        const p = pointOn(line, s, this.q);
        x = p[0]; y = p[1]; z = p[2];
        speed = flow * COOLANT_SPEED;
        if (env.coolant) this.T[i] = coolantAt(line, s, env.coolant.hotC, env.coolant.coldC);
      } else {
        // the halo: a jet (rides its ray, slows, mixes into the room) or room air drawn in (rides its ray to the intake, faster as it nears)
        const e = 3 * i, T = this.T[i]!;
        let vx: number, vy: number, vz: number, tame = 1;
        if (kind === EXHAUST) {
          speed = this.at[i]! / (1 + this.age[i]! / JET_TAU);
          vx = this.aux[e]! * speed; vy = this.aux[e + 1]! * speed; vz = this.aux[e + 2]! * speed;
        } else {
          const dx = this.aux[e]! - x, dy = this.aux[e + 1]! - y, dz = this.aux[e + 2]! - z, r = Math.hypot(dx, dy, dz);
          if (r < SINK_END) { this.remove(i--); continue; }
          speed = this.at[i]! * SINK_R / (r + SINK_R);
          vx = dx / r * speed; vy = dy / r * speed; vz = dz / r * speed;
          // (the eddies die away as it reaches the opening)
          tame = Math.min(1, r / (3 * SINK_R));
        }
        const sg = TURB_OUT * (speed + TURB_BASE) * eddyS * tame;
        this.eddy[e] = this.eddy[e]! * eddyK + sg * this.gauss();
        this.eddy[e + 1] = this.eddy[e + 1]! * eddyK + sg * this.gauss();
        this.eddy[e + 2] = this.eddy[e + 2]! * eddyK + sg * this.gauss();
        x += (vx + this.eddy[e]!) * dtp;
        y += (vy + this.eddy[e + 1]! + (kind === EXHAUST ? OUT_BUOY * BUOY * Math.max(-3, T - env.ambientC) : 0)) * dtp;
        z += (vz + this.eddy[e + 2]!) * dtp;
        // (in the case again: a draw-in has arrived, a jet fell back on its wall)
        if (this.inside(x, y, z)) { this.remove(i--); continue; }
        if (kind === EXHAUST) this.T[i] = T + (env.ambientC - T) * outK;
        // fading out with the distance from the case
        const k = Math.min(1, this.reach(x, y, z) / this.halo);
        fade = 1 - k * k * (3 - 2 * k);
        if (fade < 0.015) { this.remove(i--); continue; }
      }
      if (wrapped) this.put(i, x, y, z);
      this.P[h] = x; this.P[h + 1] = y; this.P[h + 2] = z;
      // the trail: the past moves on after the head has gone a stretch (or a while has passed)
      this.tick[i]! += dt;
      const stretch = kind !== COOLANT ? Math.max(STRETCH_MIN, Math.min(STRETCH_MAX, speed * TIME_SCALE * STRETCH_S)) : STRETCH_BEAD, ex = x - this.P[h + 3]!, ey = y - this.P[h + 4]!, ez = z - this.P[h + 5]!;
      if (ex * ex + ey * ey + ez * ez >= stretch * stretch || this.tick[i]! >= TRAIL_WAIT) {
        this.tick[i] = 0;
        for (let k = TRAIL - 1; k >= 2; k--) { this.P[h + 3 * k] = this.P[h + 3 * (k - 1)]!; this.P[h + 3 * k + 1] = this.P[h + 3 * (k - 1) + 1]!; this.P[h + 3 * k + 2] = this.P[h + 3 * (k - 1) + 2]!; }
        this.P[h + 3] = x; this.P[h + 4] = y; this.P[h + 5] = z;
      }
      // the fade: in at birth, out at the end; slow air is dimmer than fast (the loop has no end)
      const a = this.age[i]!, l = this.life[i]!, bright = Math.min(1, 0.45 + speed / 4500);
      if (kind === AIR) this.A[i] = Math.min(1, a / 0.5) * Math.min(1, (l - a) / Math.max(0.5, 0.25 * l)) * bright;
      else if (kind === COOLANT) this.A[i] = Math.min(1, a / 0.5);
      else this.A[i] = fade * (kind === INTAKE ? Math.min(1, a / 0.5) : 1) * Math.min(1, (l - a) / 0.6) * bright * HALO_ALPHA;
    }
    this.births(env, dt);
  }

  /** Walls and parts: slide along a face the particle ran into, drop it where air leaves. The result is in `q`. Returns true when the particle is gone. */
  private collide(o: V3, x: number, y: number, z: number): boolean {
    const g = this.sim.grid, p = this.q;
    p[0] = x; p[1] = y; p[2] = z;
    for (let pass = 0; pass < 2; pass++) {
      const c = g.cellAt(p[0], p[1], p[2]);
      if (c < 0) break;
      for (let n = g.boxStart[c]!; n < g.boxStart[c + 1]!; n++) {
        const b = g.boxes[g.boxList[n]!]!;
        if (p[0] <= b.min[0] || p[0] >= b.max[0] || p[1] <= b.min[1] || p[1] >= b.max[1] || p[2] <= b.min[2] || p[2] >= b.max[2]) continue;
        // inside: which way did it come in? by the axis it was outside of, the one it is least deep along
        let axis = -1, depth = Infinity, face = 0;
        for (let a = 0; a < 3; a++) {
          const below = o[a]! <= b.min[a]!, above = o[a]! >= b.max[a]!;
          if (!below && !above) continue;
          const d = below ? p[a]! - b.min[a]! : b.max[a]! - p[a]!;
          if (d < depth) { depth = d; axis = a; face = below ? b.min[a]! - 1 : b.max[a]! + 1; }
        }
        if (axis >= 0) { if (b.k[axis]! < BLOCK) p[axis] = face; continue; }
        // it began inside (it was born there, or came through a face that lets air in): out of a wall by the nearest face
        if (b.k[0] < BLOCK && b.k[1] < BLOCK && b.k[2] < BLOCK) {
          let best = Infinity;
          for (let a = 0; a < 3; a++) {
            const lo = p[a]! - b.min[a]!, hi = b.max[a]! - p[a]!;
            if (lo < best) { best = lo; axis = a; face = b.min[a]! - 1; }
            if (hi < best) { best = hi; axis = a; face = b.max[a]! + 1; }
          }
          p[axis] = face;
        }
      }
    }
    // the case's walls: stay in; where air leaves, go
    for (let a = 0; a < 3; a++) {
      if (p[a]! < g.min[a]! + EDGE) { p[a] = g.min[a]! + EDGE; if (this.leaves(2 * a, p)) return true; }
      else if (p[a]! > g.max[a]! - EDGE) { p[a] = g.max[a]! - EDGE; if (this.leaves(2 * a + 1, p)) return true; }
    }
    return false;
  }

  private leaves(wall: number, p: V3): boolean {
    const c = this.sim.grid.cellAt(p[0], p[1], p[2]);
    if (c < 0 || this.sim.exits[c] !== wall + 1) return false;
    this.exitWall = wall;
    return true;
  }

  /** The heat the parts a parcel of air is in give it, by each part's coefficient and the speed of the air over it. */
  private exchange(i: number, x: number, y: number, z: number, speed: number, dtp: number): void {
    const g = this.sim.grid, c = g.cellAt(x, y, z);
    if (c < 0) return;
    for (let n = this.partStart[c]!; n < this.partStart[c + 1]!; n++) {
      const p = this.parts[this.partList[n]!];
      if (!p || x < p.lo[0] || x > p.hi[0] || y < p.lo[1] || y > p.hi[1] || z < p.lo[2] || z > p.hi[2] || p.rate <= 0) continue;
      // forced convection: more air over the surface carries more heat. In still air a part still gives its natural share.
      const f = Math.max(0.35, Math.min(2.2, Math.pow(speed / U_REF, 0.6)));
      this.T[i] = this.T[i]! + (p.tempC - this.T[i]!) * (1 - Math.exp(-p.rate * f * dtp));
    }
  }

  private births(env: AirEnv, dt: number): void {
    const sim = this.sim;
    if (sim.inflow > 0) {
      // a steady count: what has left or aged is replaced within a moment or two
      this.acc += Math.max(0, this.target - this.nAir) * Math.min(0.1, dt) * 2.5;
      let n = Math.floor(this.acc);
      this.acc -= n;
      for (let tries = 0; n > 0 && tries < n * 3; tries++) if (this.spawnAir(env.ambientC)) n--;
      // a part warmer than the room sheds warm air at the rate of the heat it gives (a plume to follow), up to a share of the pool
      for (let k = 0; k < this.parts.length; k++) {
        const p = this.parts[k]!, dT = p.tempC - env.ambientC;
        if (dT < WARM_MIN_K || p.ua <= 0 || this.nAir >= this.target + WARM_EXTRA) continue;
        this.warm[k]! += Math.min(WARM_MAX_RATE, (p.ua * dT) / WARM_W) * Math.min(0.1, dt);
        let w = Math.floor(this.warm[k]!);
        this.warm[k]! -= w;
        for (let tries = 0; w > 0 && tries < w * 4; tries++) if (this.spawnWarm(p, env.ambientC)) w--;
      }
      // the halo's draw-in: room air toward the intakes, by the same shares
      this.accIn += Math.max(0, this.inMax - this.nIn) * Math.min(0.1, dt) * 1.5;
      let m = Math.floor(this.accIn);
      this.accIn -= m;
      for (let tries = 0; m > 0 && tries < m * 3; tries++) if (this.spawnIntake(env.ambientC)) m--;
    }
  }
}
