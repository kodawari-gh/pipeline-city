// The air of the case as a flow field, not as fixed lanes. Every intake fan is a source and every exhaust fan a sink of a 2D potential flow; the case's walls
// are mirrors (a source has an image across each wall), so the air fills the whole box, bends toward the exhausts, runs fast near a fan and slowly in the
// corners far from one. Particles are carried by it, go round the parts, take up the heat of every part they pass and leave through an exhaust.
// Pure (no Pixi): `AirField` is stepped by the lens and tested. The flow itself is a picture of where the air would go; the zones carry the sim's own numbers
// for their area (board/sim/airflow.ts): where the sim says the air barely moves, the particles crawl and stay warm; where the cards heat it, they carry that heat.

export type Pt = [number, number];
export interface Box { x: number; y: number; w: number; h: number }

/** A fan as the field sees it: `in` blows air into the case from `span`, `out` draws it out, `local` (a cooler, a card) stirs the air where it stands. */
export interface FieldPort { id: string; kind: 'in' | 'out' | 'local'; pt: Pt; span: Box; /** 0 (still) to 1 (full): the fan's real speed. */ level: number }
export interface FieldZone {
  rects: Box[]; /** 0 (cool) to 1 (at its limit). */ heat: number;
  /** The sim's ventilation of the area the part sits in, 0 to 1 (unset: 1). Air near a poorly ventilated part crawls and lingers. */
  flow?: number;
  /** How much warmer than the room the sim's air of that area is, C (unset: 0). Air there never runs cooler than that. */
  riseC?: number;
}
export interface FieldIn { box: Box; ports: FieldPort[]; zones: FieldZone[] }

export interface Particle { x: number; y: number; vx: number; vy: number; heat: number; age: number; /** a personal speed factor, 0.75 to 1.25 */ k: number; seed: number }

/** Flux of a full-speed fan (world units squared per second): about 900 units a second at 1500 units from it. */
const Q_FAN = 8.5e6;
/** The core of a source or sink: nearer than this the speed stops growing. */
const CORE = 320;
const MAX_SPEED = 2400;
/** Particles a fan at full speed releases per second, and the most the field carries. */
export const SPAWN_PER_S = 2.4, MAX_PARTICLES = 110;
const LIFE_S = 22;
/** How far from a part the air feels its heat, and how fast it takes it up (per second). */
const REACH = 420, HEAT_RATE = 1.8;
/** Share of its speed air keeps next to a part whose area has no air moving (the sim's flow 0), and the rise in C that counts as a full 1 of heat. */
const CRAWL_MIN = 0.3, RISE_FULL_C = 12;

const rectDist = (r: Box, x: number, y: number) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.y - y, 0, y - r.y - r.h));
const inside = (r: Box, x: number, y: number, m = 0) => x > r.x - m && x < r.x + r.w + m && y > r.y - m && y < r.y + r.h + m;

export class AirField {
  parts: Particle[] = [];
  private acc = new Map<string, number>();
  private t = 0;
  private n = 0;
  private strengths: { x: number; y: number; q: number }[] = [];
  private in_: FieldIn | null = null;

  /** Sources and sinks for these fans, with the sinks scaled to take out what the sources put in (no exhaust: nothing leaves and the air stalls). */
  private build(input: FieldIn) {
    const src = input.ports.filter((p) => p.kind !== 'out' && p.level > 0), snk = input.ports.filter((p) => p.kind === 'out' && p.level > 0);
    const into = src.reduce((a, p) => a + Q_FAN * p.level * (p.kind === 'local' ? 0.18 : 1), 0), outOf = snk.reduce((a, p) => a + Q_FAN * p.level, 0);
    const scale = outOf > 0 ? into / outOf : 0;
    this.strengths = [
      ...src.map((p) => ({ x: p.pt[0], y: p.pt[1], q: Q_FAN * p.level * (p.kind === 'local' ? 0.18 : 1) })),
      ...snk.map((p) => ({ x: p.pt[0], y: p.pt[1], q: -Q_FAN * p.level * scale })),
    ];
    this.in_ = input;
  }

  /** The air's velocity at a point: every source and sink, and its mirror images across the four walls (and the corners). */
  velocity(x: number, y: number, out: Pt = [0, 0]): Pt {
    const b = this.in_!.box, x1 = b.x + b.w, y1 = b.y + b.h;
    let vx = 0, vy = 0;
    for (const s of this.strengths) {
      for (let ix = -1; ix <= 1; ix++) {
        const px = ix === 0 ? s.x : ix < 0 ? 2 * b.x - s.x : 2 * x1 - s.x;
        for (let iy = -1; iy <= 1; iy++) {
          const py = iy === 0 ? s.y : iy < 0 ? 2 * b.y - s.y : 2 * y1 - s.y, dx = x - px, dy = y - py, k = s.q / (2 * Math.PI * (dx * dx + dy * dy + CORE * CORE));
          vx += k * dx; vy += k * dy;
        }
      }
    }
    const m = Math.hypot(vx, vy);
    if (m > MAX_SPEED) { vx *= MAX_SPEED / m; vy *= MAX_SPEED / m; }
    out[0] = vx; out[1] = vy;
    return out;
  }

  /** Speed of the air at a point, as a fraction of a fan's reach (a quick read of how well a spot is ventilated). */
  speedAt(x: number, y: number): number { const [vx, vy] = this.velocity(x, y); return Math.hypot(vx, vy); }

  /** Advance `dt` seconds (game time; 0 holds everything). */
  step(dt: number, input: FieldIn) {
    this.build(input);
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const { box, ports, zones } = input, outs = ports.filter((p) => p.kind === 'out');
    // release: each fan that blows puts particles in at its own rate, across its width
    for (const p of ports) {
      if (p.kind === 'out' || p.level <= 0.02) continue;
      const rate = SPAWN_PER_S * p.level ** 0.7 * (p.kind === 'local' ? 0.5 : 1), a = (this.acc.get(p.id) ?? 0) + rate * dt;
      let n = Math.floor(a);
      this.acc.set(p.id, a - n);
      while (n-- > 0 && this.parts.length < MAX_PARTICLES) {
        const s = p.span, r = Math.random();
        const x = p.kind === 'in' ? s.x + Math.random() * s.w * 0.4 : p.pt[0] + (Math.random() - 0.5) * s.w * 0.5, y = p.kind === 'in' ? s.y + r * s.h : p.pt[1] + (Math.random() - 0.5) * s.h * 0.5;
        if (zones.some((z) => z.rects.some((q) => inside(q, x, y, 30)))) continue;
        this.parts.push({ x, y, vx: 0, vy: 0, heat: 0, age: 0, k: 0.75 + 0.5 * Math.random(), seed: this.n++ });
      }
    }
    const v: Pt = [0, 0];
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]!;
      p.age += dt;
      this.velocity(p.x, p.y, v);
      // a little turbulence, more where the air is hot
      const w = 90 * (0.3 + p.heat), ph = this.t * 1.1 + p.seed * 2.3;
      p.vx = v[0] * p.k + Math.sin(ph + p.y * 0.002) * w; p.vy = v[1] * p.k + Math.cos(ph * 0.9 + p.x * 0.002) * w;
      p.x += p.vx * dt; p.y += p.vy * dt;
      // the parts are in the way: air goes round them
      for (const z of zones) for (const r of z.rects) {
        if (!inside(r, p.x, p.y, 30)) continue;
        const l = p.x - (r.x - 30), rr = r.x + r.w + 30 - p.x, tp = p.y - (r.y - 30), bt = r.y + r.h + 30 - p.y, m = Math.min(l, rr, tp, bt);
        if (m === l) p.x = r.x - 30; else if (m === rr) p.x = r.x + r.w + 30; else if (m === tp) p.y = r.y - 30; else p.y = r.y + r.h + 30;
      }
      // it takes up the heat of the parts it passes, and loses a little to the rest of the case; next to a part the sim says is poorly ventilated it
      // crawls, and the air there is as warm as the sim's air of that area
      let h = p.heat, floor = 0;
      for (const z of zones) {
        let d = Infinity;
        for (const r of z.rects) d = Math.min(d, rectDist(r, p.x, p.y));
        if (d >= REACH) continue;
        const near = 1 - d / REACH, flow = z.flow ?? 1;
        if (flow < 1) { const slow = 1 - near * (1 - flow) * (1 - CRAWL_MIN); p.x -= p.vx * dt * (1 - slow); p.y -= p.vy * dt * (1 - slow); }
        if (z.riseC) floor = Math.max(floor, Math.min(1, z.riseC / RISE_FULL_C) * near);
        if (z.heat > h) h += (z.heat - h) * Math.min(1, dt * HEAT_RATE * near);
      }
      p.heat = Math.max(floor, h * Math.exp(-dt * 0.04));
      // it leaves through an exhaust, or is gone when it has wandered too long or out of the case
      const gone = p.age > LIFE_S || outs.some((o) => rectDist(o.span, p.x, p.y) < 150 + (o.span.w > 600 || o.span.h > 600 ? 0 : 100)) || !inside(box, p.x, p.y, 900);
      if (gone) this.parts.splice(i, 1);
    }
  }
}
