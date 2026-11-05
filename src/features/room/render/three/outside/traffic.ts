// The street's moving traffic (`cars.ts` draws it). Each travel lane is a route straight across the grid, out of the window's sight at both
// ends (behind our own facade, or far off down the road): a car that leaves at the end comes back at the start, behind the last one in. A
// car keeps its distance to the one ahead and stops for a red light, or for an amber one it can stop for (the intelligent driver model).
// Every crossing has its lights; they run a green wave away from us down the avenues. Pure: the routes, the lights' clock, the cars.
import { CAR_COLOURS, GRID, LANES, avenueX, heading, rng, streetZ } from './plan';

/** A crossing's light for one road. */
export type Light = 'go' | 'amber' | 'stop';

/** A crossing's cycle (s): the avenue's green, the amber, all red, the street's green, the amber, all red. */
const AV_GO = 26, AMBER = 3, CLEAR = 2, ST_GO = 16;
export const PERIOD = AV_GO + AMBER + CLEAR + ST_GO + AMBER + CLEAR;
/** The green wave's speed down the avenues (m/s): each crossing's cycle starts later by the time a block takes at it. */
const WAVE = 12;

/** The light at crossing (avenue i, street j) at time t (s), for the avenue's traffic (`av`) or the street's. */
export function lightAt(i: number, j: number, t: number, av: boolean): Light {
  const u = (((t - (j * GRID.pz) / WAVE - i * 9.7) % PERIOD) + PERIOD) % PERIOD;
  const g0 = av ? 0 : AV_GO + AMBER + CLEAR, g1 = g0 + (av ? AV_GO : ST_GO);
  return u >= g0 && u < g1 ? 'go' : u >= g1 && u < g1 + AMBER ? 'amber' : 'stop';
}

/** A crossing's box: from one road's kerb line to the other's, out over the pavements, so the zebras are in it. */
export const avenueSpan = (i: number): [number, number] => [avenueX(i) - GRID.avenue / 2, avenueX(i) + GRID.avenue / 2];
export const streetSpan = (j: number): [number, number] => [streetZ(j) - GRID.street / 2, streetZ(j) + GRID.street / 2];

/** A stop line along a route: its distance from the start, its crossing, and whether the route is the avenue there. */
export interface Stop { s: number; i: number; j: number; av: boolean }

/** A lane's route: its start (x, z), its way (a unit along x or z), its length, its stop lines in order, the speed its cars want (m/s). */
export interface Route { x: number; z: number; dx: number; dz: number; len: number; stops: Stop[]; v0: number }

/** How far down an avenue its traffic runs (m): the one the window looks down and its neighbours run on into the downtown. */
const avReach = (i: number): number => (Math.abs(i) <= 1 ? 3700 : 1800);
/** The avenues and streets with traffic, the streets' reach each way (m), where the routes start behind our facade (m). */
const AVENUES = 4, STREETS = 10, ST_REACH = 950, BEHIND = 40;
/** How far before a crossing's box a car stops (m). */
const STOP = 0.6;

/** Every lane's route. */
export function routes(): Route[] {
  const out: Route[] = [];
  for (let i = -AVENUES; i <= AVENUES; i++) for (const off of LANES.avenue.travel) for (const dz of [-1, 1]) {
    // away on the east side, from behind our facade; toward us on the west side, from far off
    const far = -avReach(i), z = dz < 0 ? BEHIND : far, len = BEHIND - far, stops: Stop[] = [];
    for (let j = 0; streetZ(j) > far; j++) {
      const [lo, hi] = streetSpan(j);
      stops.push({ s: dz < 0 ? z - hi - STOP : lo - STOP - z, i, j, av: true });
    }
    out.push({ x: avenueX(i) - dz * off, z, dx: 0, dz, len, stops: sortStops(stops), v0: 13 });
  }
  for (let j = 0; j <= STREETS; j++) for (const off of LANES.street.travel) for (const dx of [-1, 1]) {
    // east on the side toward us, west on the far side
    const x = -dx * ST_REACH + GRID.av0, stops: Stop[] = [];
    for (let i = -GRID.cols; i <= GRID.cols; i++) {
      const [lo, hi] = avenueSpan(i);
      if (Math.abs(avenueX(i) - GRID.av0) > ST_REACH - 40) continue;
      stops.push({ s: dx > 0 ? lo - STOP - x : x - hi - STOP, i, j, av: false });
    }
    out.push({ x, z: streetZ(j) + dx * off, dx, dz: 0, len: 2 * ST_REACH, stops: sortStops(stops), v0: 10 });
  }
  return out;
}
const sortStops = (s: Stop[]): Stop[] => s.filter((x) => x.s > 0).sort((a, b) => a.s - b.s);

/** The car models (`cars.ts` builds them): a hatchback, a saloon, an estate, and their lengths (m). */
export const MODELS = [{ tail: 'hatch', len: 4.1 }, { tail: 'boot', len: 4.65 }, { tail: 'estate', len: 4.7 }] as const;

/** A car on its route: how far along its front is, its speed, the speed it wants, its model and paint, and whether its brake lights are on. */
export interface Mover { route: number; s: number; v: number; v0: number; model: number; len: number; colour: number; brake: boolean; next: number }

/** The driver model: the most it speeds up and the braking it is at ease with (m/s²), the gap it keeps standing (m) and in time (s). */
const ACC = 1.4, DEC = 2.6, GAP = 2.2, HEADWAY = 1.3;
/** It brakes for an amber light only if it can at this (m/s²); a red one it runs only if it cannot stop at this. */
const AMBER_DEC = 3.4, HARD = 7;
/** How far ahead a car heeds a light (m). */
const SIGHT = 160;

/** The acceleration toward a speed v0 with a gap ahead, closing at dv. */
function idm(v: number, v0: number, gap: number, dv: number): number {
  const want = GAP + Math.max(0, v * HEADWAY + (v * dv) / (2 * Math.sqrt(ACC * DEC)));
  return ACC * (1 - (v / v0) ** 4 - (want / Math.max(gap, 0.05)) ** 2);
}

export class Traffic {
  readonly routes = routes();
  readonly cars: Mover[] = [];
  /** Each route's cars, the front one first. */
  private lanes: Mover[][];
  /** The lights' clock (s). */
  t = 0;

  constructor(seed = 41) {
    const r = rng(seed);
    this.lanes = this.routes.map((rt, ri) => {
      const lane: Mover[] = [];
      // spread over the route, front first, a gap that ranges from close to wide
      for (let s = rt.len - r() * 30; s > 0;) {
        const q = r(), model = q < 0.45 ? 0 : q < 0.75 ? 1 : 2, len = MODELS[model].len, v0 = rt.v0 * (0.85 + r() * 0.3);
        lane.push({ route: ri, s, v: v0, v0, model, len, colour: Math.floor(r() * CAR_COLOURS.length), brake: false, next: 0 });
        s -= len + GAP + v0 * HEADWAY * (1 + r() * 3.5);
      }
      for (const c of lane) c.next = this.nextStop(rt, c.s);
      this.cars.push(...lane);
      return lane;
    });
    // let the traffic settle into the lights' rhythm
    for (let k = 0; k < 240; k++) this.step(0.25);
  }

  private nextStop(rt: Route, s: number): number {
    let n = 0;
    while (n < rt.stops.length && rt.stops[n]!.s < s) n++;
    return n;
  }

  /** Move every car on by dt (s). */
  step(dt: number): void {
    this.t += dt;
    this.lanes.forEach((lane, ri) => {
      const rt = this.routes[ri]!;
      for (let k = 0; k < lane.length; k++) {
        const c = lane[k]!, ahead = k > 0 ? lane[k - 1]! : null;
        let a = ahead ? idm(c.v, c.v0, ahead.s - ahead.len - c.s, c.v - ahead.v) : idm(c.v, c.v0, 1e4, 0);
        const st = rt.stops[c.next];
        if (st && st.s - c.s < SIGHT) {
          const gap = st.s - c.s, light = lightAt(st.i, st.j, this.t, st.av), need = (c.v * c.v) / (2 * Math.max(gap, 0.05));
          const halt = light === 'stop' ? need < HARD : light === 'amber' ? need < AMBER_DEC : false;
          if (halt) a = Math.min(a, idm(c.v, c.v0, gap + GAP - 0.4, c.v));
        }
        const v = Math.max(0, c.v + a * dt), room = ahead ? ahead.s - ahead.len - 0.4 : Infinity;
        let s = c.s + ((c.v + v) / 2) * dt;
        // (never into the car ahead: up to its tail at most, at its speed)
        if (s > room) { s = Math.max(c.s, room); c.v = Math.min(v, ahead!.v); } else c.v = v;
        c.s = s;
        c.brake = a < -0.5 || c.v < 0.3;
        while (c.next < rt.stops.length && rt.stops[c.next]!.s < c.s) c.next++;
      }
      // the front car out past the end comes in again behind the last one
      const front = lane[0];
      if (front && front.s - front.len > rt.len) {
        lane.shift();
        const last = lane[lane.length - 1];
        front.s = last ? Math.min(0, last.s - last.len - GAP - front.v0 * HEADWAY * 1.5) : 0;
        front.v = last ? Math.min(front.v0, last.v + 2) : front.v0;
        front.next = 0;
        lane.push(front);
      }
    });
  }

  /** Where a car is: its middle (x, z) and its turn about y. */
  pose(c: Mover): { x: number; z: number; rot: number } {
    const rt = this.routes[c.route]!, m = c.s - c.len / 2;
    return { x: rt.x + rt.dx * m, z: rt.z + rt.dz * m, rot: heading(rt.dx, rt.dz) };
  }
}
