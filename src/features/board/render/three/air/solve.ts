// The air's flow (docs/render/air.md): a potential flow through the grid, with the cells' open shares as the medium. A fan puts a flux through a plane
// of the grid: a wall fan takes air from the room (or gives it back) through the wall, an inner fan (a cooler's, a card's) takes it from the cells
// behind its plane and gives it to the cells before it. A fan's flow falls as pressure builds against it: a wall fan by its stiffness `kf`, an inner
// fan by the conduction of the faces it sits on. The flow is linear in the fans' flows, so each fan is solved ALONE once (a "basis"), and the machine's
// air at any fan speeds is the sum of the bases weighted by the speeds. The solve is a preconditioned conjugate gradient on the grid, matrix-free, run a
// slice per frame. Pure TS.
import type { AirGrid, Shape, V3 } from './grid';

/** A face the fan's air crosses and the speed it has there for each unit of the fan's flow: the cell-centred speed gets it (see `velocityOf`). */
export interface Jet {
  c: number;
  /** The cell on the other side of the fan's plane (an inner fan), or -1 (a wall fan: the air comes in from the room through the wall). */
  to: number;
  axis: 0 | 1 | 2;
  /** Units per second per unit of the fan's flow, signed along +axis. */
  v: number;
}

/** A fan as the solver sees it. */
export interface AirFanDef {
  id: string;
  /** The cells of the fan and each one's share: positive where the fan puts air in, negative where it takes air out. */
  cells: number[];
  w: number[];
  /** The flow at full speed, units cubed per second. */
  q: number;
  /** A wall fan's flow falls by this much for each unit of pressure (the potential, units squared per second) against it. Inner fans have none. */
  kf: number;
  jets: Jet[];
}

/** The speed no air goes past, units per second (a jet through a gap has to stay sane). */
export const V_MAX = 90000;
/** The open share of a face below which it is a wall to the speed of the air. */
const FACE_MIN = 1e-3;

const EPS = 1e-9;
const AXES: readonly [number, number][] = [[1, 2], [0, 2], [0, 1]];

/**
 * A fan on the case's wall. `wall` 0..5 is -x, +x, -y, +y, -z, +z; `centre`: where on it (the other two axes count). `into`: it blows room air in (else it
 * draws the case's air out). `q`: the flow at full speed; `kf`: the stiffness.
 */
export function wallFan(g: AirGrid, id: string, wall: number, centre: V3, shape: Shape, into: boolean, q: number, kf: number): AirFanDef {
  const axis = (wall >> 1) as 0 | 1 | 2, hi = (wall & 1) === 1, half = g.h[axis]! / 2, at: V3 = [centre[0], centre[1], centre[2]];
  at[axis] = hi ? g.max[axis] : g.min[axis];
  const raw = g.footprint(at, axis, shape, hi ? -half : half), [u, v] = AXES[axis]!, cellArea = g.h[u]! * g.h[v]!;
  // (a cell that is all wall takes no air: a fan against a part has only the rest of its disc)
  const keep = raw.cells.map((c) => !g.solid(c)), cells = raw.cells.filter((_, n) => keep[n]), area = raw.area.filter((_, n) => keep[n]), total = area.reduce((a, b) => a + b, 0) || 1;
  // the air moves along +axis when it comes in at the low wall or goes out at the high one
  const dir = (hi ? -1 : 1) * (into ? 1 : -1), sign = into ? 1 : -1;
  return {
    id, q, kf, cells, w: area.map((a) => (sign * a) / total),
    jets: cells.map((c, n) => ({ c, to: -1, axis, v: (dir * area[n]!) / total / cellArea })),
  };
}

/** A fan inside the case: it moves air along `axis` in the direction `dir` (+1 or -1) across the plane through `at`, from the cells behind to the cells before. */
export function innerFan(g: AirGrid, id: string, at: V3, axis: 0 | 1 | 2, dir: 1 | -1, shape: Shape, q: number): AirFanDef {
  // the plane is snapped to the grid's face next to it: the two layers of cells on either side
  const h = g.h[axis]!, face = Math.min(g.n[axis]! - 1, Math.max(1, Math.round((at[axis] - g.min[axis]) / h))), up = face - (dir > 0 ? 1 : 0), centre: V3 = [at[0], at[1], at[2]];
  centre[axis] = g.min[axis] + (up + 0.5) * h;
  const f = g.footprint(centre, axis, shape), step = [1, g.n[0], g.n[0] * g.n[1]][axis]!, [u, v] = AXES[axis]!, cellArea = g.h[u]! * g.h[v]!;
  // (a column whose cells are a wall, or leave the grid, has no air to move: the rest of the disc carries the fan's flow)
  const cols = f.cells.flatMap((c, n) => { const to = c + dir * step, k = Math.floor(c / step) % g.n[axis]! + dir; return k >= 0 && k < g.n[axis]! && !g.solid(c) && !g.solid(to) ? [{ c, to, a: f.area[n]! }] : []; });
  const total = cols.reduce((a, x) => a + x.a, 0) || 1, cells: number[] = [], w: number[] = [], jets: Jet[] = [];
  for (const { c, to, a } of cols) {
    cells.push(c, to);
    w.push(-a / total, a / total);
    jets.push({ c, to, axis, v: (dir * a) / total / cellArea });
  }
  return { id, q, kf: 0, cells, w, jets };
}

/** The operator of the grid with the fans' stiffness, and a preconditioner: the matrix is never built. */
class Op {
  readonly diag: Float64Array;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;

  constructor(private readonly g: AirGrid, private readonly fans: readonly AirFanDef[]) {
    const [nx, ny, nz] = g.n;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.diag = new Float64Array(g.cells);
    const [fx, fy, fz] = g.face, sheet = nx * ny;
    const tiny = EPS * (g.h[1] * g.h[2]) / g.h[0];
    for (let k = 0, c = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, c++) {
      let s = g.ground[c]! + tiny + fx[c]! + fy[c]! + fz[c]!;
      if (i > 0) s += fx[c - 1]!;
      if (j > 0) s += fy[c - nx]!;
      if (k > 0) s += fz[c - sheet]!;
      this.diag[c] = s;
    }
    for (const f of fans) f.cells.forEach((c, n) => { this.diag[c]! += f.kf * f.w[n]! * f.w[n]!; });
  }

  /** y = A x. */
  apply(x: Float64Array, y: Float64Array): void {
    const { nx, ny, nz, diag } = this, [fx, fy, fz] = this.g.face, sheet = nx * ny;
    for (let k = 0, c = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, c++) {
      let s = diag[c]! * x[c]!;
      // (a face toward +axis has no conductance at the wall, so no neighbour is read out of range)
      if (i < nx - 1) s -= fx[c]! * x[c + 1]!;
      if (j < ny - 1) s -= fy[c]! * x[c + nx]!;
      if (k < nz - 1) s -= fz[c]! * x[c + sheet]!;
      if (i > 0) s -= fx[c - 1]! * x[c - 1]!;
      if (j > 0) s -= fy[c - nx]! * x[c - nx]!;
      if (k > 0) s -= fz[c - sheet]! * x[c - sheet]!;
      y[c] = s;
    }
    // a wall fan is a rank one term: kf (w . x) w over its cells. Its diagonal part is already in `diag`: leave that out and add the rest.
    for (const f of this.fans) {
      if (f.kf === 0) continue;
      let dot = 0;
      f.cells.forEach((c, n) => { dot += f.w[n]! * x[c]!; });
      f.cells.forEach((c, n) => { y[c]! += f.kf * f.w[n]! * (dot - f.w[n]! * x[c]!); });
    }
  }
}

/** A preconditioned conjugate gradient that runs a few steps at a time. */
class Cg {
  readonly x: Float64Array;
  private readonly r: Float64Array;
  private readonly z: Float64Array;
  private readonly p: Float64Array;
  private readonly q: Float64Array;
  private rz = 0;
  private readonly bn: number;
  iters = 0;
  done = false;

  constructor(private readonly op: Op, b: Float64Array, private readonly tol = 1e-4, private readonly max = 400) {
    const N = b.length;
    this.x = new Float64Array(N);
    this.r = Float64Array.from(b);
    this.z = new Float64Array(N);
    this.p = new Float64Array(N);
    this.q = new Float64Array(N);
    this.bn = Math.sqrt(b.reduce((a, v) => a + v * v, 0));
    if (this.bn === 0) { this.done = true; return; }
    for (let c = 0; c < N; c++) this.z[c] = this.r[c]! / op.diag[c]!;
    this.p.set(this.z);
    this.rz = this.dot(this.r, this.z);
  }

  private dot(a: Float64Array, b: Float64Array): number {
    let s = 0;
    for (let c = 0; c < a.length; c++) s += a[c]! * b[c]!;
    return s;
  }

  /** Run `n` steps (or to the end). Returns whether it is done. */
  step(n: number): boolean {
    const { x, r, z, p, q, op } = this, N = x.length;
    for (let it = 0; it < n && !this.done; it++) {
      op.apply(p, q);
      const alpha = this.rz / this.dot(p, q);
      for (let c = 0; c < N; c++) { x[c]! += alpha * p[c]!; r[c]! -= alpha * q[c]!; }
      this.iters++;
      if (Math.sqrt(this.dot(r, r)) <= this.tol * this.bn || this.iters >= this.max) { this.done = true; break; }
      for (let c = 0; c < N; c++) z[c] = r[c]! / op.diag[c]!;
      const rz = this.dot(r, z), beta = rz / this.rz;
      this.rz = rz;
      for (let c = 0; c < N; c++) p[c] = z[c]! + beta * p[c]!;
    }
    return this.done;
  }
}

/**
 * The speed of the air in each cell for the potential `phi`: the gradient on each face with air through it, averaged over the cell's two faces, plus the
 * fan's own flow on the faces it crosses (`jets`, times the fan's flow `q`). (The air that passes a part of a cell goes at the gradient: the open
 * share only says how much of the face is open.) Stored as x, y, z per cell.
 */
export function velocityOf(g: AirGrid, phi: Float64Array, jets: readonly Jet[] = [], q = 0): Float32Array {
  const [nx, ny, nz] = g.n, [hx, hy, hz] = g.h, [fx, fy, fz] = g.face, sheet = nx * ny, N = g.cells;
  const sum = new Float64Array(3 * N), cnt = new Uint8Array(3 * N);
  // (a face counts when a thousandth of it is open or more: a wall's open share is a rounding error above zero, and the potential across it is the whole pressure of the room)
  const tx = FACE_MIN * hy * hz / hx, ty = FACE_MIN * hx * hz / hy, tz = FACE_MIN * hx * hy / hz;
  for (let k = 0, c = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, c++) {
    if (i < nx - 1 && fx[c]! > tx) { const v = (phi[c]! - phi[c + 1]!) / hx; sum[3 * c]! += v; sum[3 * (c + 1)]! += v; cnt[3 * c]!++; cnt[3 * (c + 1)]!++; }
    if (j < ny - 1 && fy[c]! > ty) { const v = (phi[c]! - phi[c + nx]!) / hy; sum[3 * c + 1]! += v; sum[3 * (c + nx) + 1]! += v; cnt[3 * c + 1]!++; cnt[3 * (c + nx) + 1]!++; }
    if (k < nz - 1 && fz[c]! > tz) { const v = (phi[c]! - phi[c + sheet]!) / hz; sum[3 * c + 2]! += v; sum[3 * (c + sheet) + 2]! += v; cnt[3 * c + 2]!++; cnt[3 * (c + sheet) + 2]!++; }
  }
  // the fan's own flow: on its face (both cells see it) or, on the wall, through a face of the room's side (only the one cell, and the face counts)
  for (const j of jets) {
    const a = 3 * j.c + j.axis, v = j.v * q;
    sum[a]! += v;
    if (j.to >= 0) { sum[3 * j.to + j.axis]! += v; } else cnt[a]!++;
  }
  const out = new Float32Array(3 * N);
  for (let c = 0; c < N; c++) {
    let u = cnt[3 * c]! ? sum[3 * c]! / cnt[3 * c]! : 0, v = cnt[3 * c + 1]! ? sum[3 * c + 1]! / cnt[3 * c + 1]! : 0, w = cnt[3 * c + 2]! ? sum[3 * c + 2]! / cnt[3 * c + 2]! : 0;
    const m = Math.hypot(u, v, w);
    if (m > V_MAX) { const s = V_MAX / m; u *= s; v *= s; w *= s; }
    out[3 * c] = u;
    out[3 * c + 1] = v;
    out[3 * c + 2] = w;
  }
  return out;
}

/** The fans' flow in the case, solved fan by fan (`run`), mixed by the fans' speeds (`setLevel`, `mix`) and read at any point (`sample`). */
export class AirField {
  /** The current speed of the air in each cell (x, y, z), the bases mixed by the fans' levels. */
  readonly u: Float32Array;
  /** Each fan's own field and potential: undefined until solved. */
  private readonly bases: (Float32Array | undefined)[];
  private readonly phis: (Float64Array | undefined)[];
  private readonly level: number[];
  private readonly op: Op;
  private cg: Cg | null = null;
  private next = 0;
  private dirty = true;

  constructor(readonly grid: AirGrid, readonly fans: readonly AirFanDef[]) {
    this.u = new Float32Array(3 * grid.cells);
    this.bases = fans.map(() => undefined);
    this.phis = fans.map(() => undefined);
    this.level = fans.map(() => 0);
    this.op = new Op(grid, fans);
  }

  /** Every fan has been solved. */
  get ready(): boolean { return this.next >= this.fans.length; }

  /** Solve for up to `ms` milliseconds, one fan at a time. Returns whether all fans are done. */
  run(ms: number): boolean {
    const end = performance.now() + ms;
    while (!this.ready) {
      const fan = this.fans[this.next]!;
      if (!this.cg) this.cg = new Cg(this.op, this.rhs(fan), 1e-4);
      while (!this.cg.step(4)) if (performance.now() >= end) return false;
      this.phis[this.next] = this.cg.x;
      this.bases[this.next] = velocityOf(this.grid, this.cg.x, fan.jets, fan.q);
      this.cg = null;
      this.next++;
      this.dirty = true;
      if (performance.now() >= end) break;
    }
    return this.ready;
  }

  /** The right-hand side of one fan alone, at full speed. */
  private rhs(f: AirFanDef): Float64Array {
    const b = new Float64Array(this.grid.cells);
    f.cells.forEach((c, n) => { b[c]! += f.q * f.w[n]!; });
    return b;
  }

  /** How hard fan `i` runs, 0 to 1 (more is allowed: a fast fan). */
  setLevel(i: number, v: number): void {
    if (Math.abs(v - this.level[i]!) < 1e-4) return;
    this.level[i] = v;
    this.dirty = true;
  }

  /** Mix the bases by the levels (only when something changed): the field the particles read. */
  mix(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const u = this.u;
    u.fill(0);
    this.bases.forEach((b, i) => {
      const f = this.level[i]!;
      if (!b || f === 0) return;
      for (let c = 0; c < u.length; c++) u[c]! += f * b[c]!;
    });
    // (each basis is under the cap, the sum may not be)
    for (let c = 0; c < u.length; c += 3) {
      const m = Math.hypot(u[c]!, u[c + 1]!, u[c + 2]!);
      if (m > V_MAX) { const s = V_MAX / m; u[c]! *= s; u[c + 1]! *= s; u[c + 2]! *= s; }
    }
  }

  /** The potential of the mixed flow in a cell (units squared per second): the pressure the fans make there. */
  pressure(c: number): number {
    let p = 0;
    this.phis.forEach((phi, i) => { if (phi) p += this.level[i]! * phi[c]!; });
    return p;
  }

  /** The air's speed at a point, by trilinear interpolation of the cells (a cell of wall counts as still: the air slows near a wall). Into `out`. */
  sample(x: number, y: number, z: number, out: V3): V3 {
    const g = this.grid, [nx, ny, nz] = g.n, u = this.u;
    const fx = Math.min(nx - 1, Math.max(0, (x - g.min[0]) / g.h[0] - 0.5)), fy = Math.min(ny - 1, Math.max(0, (y - g.min[1]) / g.h[1] - 0.5)), fz = Math.min(nz - 1, Math.max(0, (z - g.min[2]) / g.h[2] - 0.5));
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), k = Math.min(nz - 2, Math.floor(fz)), tx = fx - i, ty = fy - j, tz = fz - k;
    const c0 = i + nx * (j + ny * k), dx = 1, dy = nx, dz = nx * ny;
    let a = 0, b = 0, c = 0;
    for (let n = 0; n < 8; n++) {
      const ox = n & 1, oy = (n >> 1) & 1, oz = n >> 2, w = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty) * (oz ? tz : 1 - tz), cell = 3 * (c0 + ox * dx + oy * dy + oz * dz);
      a += w * u[cell]!;
      b += w * u[cell + 1]!;
      c += w * u[cell + 2]!;
    }
    out[0] = a;
    out[1] = b;
    out[2] = c;
    return out;
  }
}
