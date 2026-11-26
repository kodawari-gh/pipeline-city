// The air's grid (docs/render/air.md): the case's inside cut into small boxes. Each cell says how well air passes it along x, y and z (0 wall, 1 open).
// Two neighbours share a face; its conductance follows from the two cells (a harmonic mean), so a thin plate blocks its normal and lets air slide along
// its face. The grid is built once for a machine (the case and the parts do not move), then the solver (solve.ts) and the particles (particles.ts) read it.
// Pure TS: no DOM, no Three. World units as the machine's root (x east, y up, z toward the glass).

export type V3 = [number, number, number];

/** A box in the air's way. `k`: the share of air that passes along each axis (0 a wall, 1 free). `part`: the heat exchanger it belongs to, if any. */
export interface AirBox {
  id: string;
  min: V3;
  max: V3;
  k: V3;
  part?: string;
}

/** The cells a shape covers on a plane, with the area on each (units squared). */
export interface Footprint {
  cells: number[];
  area: number[];
}

/** A shape on a plane: a disc of radius `r`, or a rectangle of half sides `hw` (the first in-plane axis) and `hh`. */
export type Shape = { r: number } | { hw: number; hh: number };

/** Cells in a grid, about: the finer the better the field, the dearer the solve. */
const GRID_CELLS = 14_000;
/** The share of a cell's open area below which the cell counts as a wall. */
const SOLID = 0.02;

/** The cells of a grid over `min`..`max`: how many along each axis and how big (the grid and a plan that snaps walls to its cells agree on them). */
export function gridShape(min: V3, max: V3, cells = GRID_CELLS): { n: V3; h: V3 } {
  const size: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    edge = Math.cbrt((size[0] * size[1] * size[2]) / cells);
  const n: V3 = [
    Math.max(2, Math.round(size[0] / edge)),
    Math.max(2, Math.round(size[1] / edge)),
    Math.max(2, Math.round(size[2] / edge)),
  ];
  return { n, h: [size[0] / n[0], size[1] / n[1], size[2] / n[2]] };
}

const AXES: readonly [number, number][] = [
  [1, 2],
  [0, 2],
  [0, 1],
];

/** Series share of a slab of share `f` (of the cell along the flow) and openness `k`: 1 free, 0 a wall. */
const series = (k: number, f: number): number => (f <= 0 ? 1 : k / (k * (1 - f) + f));

export class AirGrid {
  readonly n: V3;
  /** Cell size along each axis. */
  readonly h: V3;
  readonly min: V3;
  readonly max: V3;
  readonly cells: number;
  /** Open share of each cell along each axis. */
  readonly open: [Float32Array, Float32Array, Float32Array];
  /** Conductance of each cell's face toward +axis (0 at the domain's wall and at a wall cell). */
  readonly face: [Float64Array, Float64Array, Float64Array];
  /** Conductance of each cell to the outside (an opening in the case's wall). */
  readonly ground: Float64Array;
  /** The boxes of each cell, as a list (`boxStart[c]` to `boxStart[c + 1]` in `boxList`, indices of `boxes`). */
  readonly boxStart: Int32Array;
  readonly boxList: Int32Array;

  constructor(
    min: V3,
    max: V3,
    readonly boxes: readonly AirBox[],
    cells = GRID_CELLS,
  ) {
    this.min = min;
    this.max = max;
    const shape = gridShape(min, max, cells);
    this.n = shape.n;
    this.h = shape.h;
    this.cells = this.n[0] * this.n[1] * this.n[2];
    const N = this.cells;
    this.open = [new Float32Array(N).fill(1), new Float32Array(N).fill(1), new Float32Array(N).fill(1)];
    this.face = [new Float64Array(N), new Float64Array(N), new Float64Array(N)];
    this.ground = new Float64Array(N);
    this.boxStart = new Int32Array(N + 1);
    this.boxList = this.fill();
    this.link();
  }

  index(i: number, j: number, k: number): number {
    return i + this.n[0] * (j + this.n[1] * k);
  }

  /** The cell holding a point, or -1 outside the grid. */
  cellAt(x: number, y: number, z: number): number {
    const i = Math.floor((x - this.min[0]) / this.h[0]),
      j = Math.floor((y - this.min[1]) / this.h[1]),
      k = Math.floor((z - this.min[2]) / this.h[2]);
    if (i < 0 || j < 0 || k < 0 || i >= this.n[0] || j >= this.n[1] || k >= this.n[2]) {
      return -1;
    }
    return this.index(i, j, k);
  }

  /** The centre of a cell. */
  centre(c: number, out: V3 = [0, 0, 0]): V3 {
    const [nx, ny] = this.n,
      i = c % nx,
      j = Math.floor(c / nx) % ny,
      k = Math.floor(c / (nx * ny));
    out[0] = this.min[0] + (i + 0.5) * this.h[0];
    out[1] = this.min[1] + (j + 0.5) * this.h[1];
    out[2] = this.min[2] + (k + 0.5) * this.h[2];
    return out;
  }

  /** Is a cell all wall (no air passes it in any direction)? */
  solid(c: number): boolean {
    return this.open[0][c]! < SOLID && this.open[1][c]! < SOLID && this.open[2][c]! < SOLID;
  }

  /** The cell range a box touches along an axis, as [first, last] (empty when first > last). */
  private span(a: number, lo: number, hi: number): [number, number] {
    const m = this.min[a]!,
      h = this.h[a]!;
    return [Math.max(0, Math.floor((lo - m) / h)), Math.min(this.n[a]! - 1, Math.ceil((hi - m) / h) - 1)];
  }

  /** Cut the boxes into the cells: the open share of each, and each cell's list of boxes. */
  private fill(): Int32Array {
    const [nx, ny] = this.n,
      [hx, hy, hz] = this.h,
      N = this.cells,
      counts = new Int32Array(N + 1);
    const lists: [number, number][] = [];
    this.boxes.forEach((b, bi) => {
      const [i0, i1] = this.span(0, b.min[0], b.max[0]),
        [j0, j1] = this.span(1, b.min[1], b.max[1]),
        [k0, k1] = this.span(2, b.min[2], b.max[2]);
      for (let k = k0; k <= k1; k++) {
        const fz = Math.min(b.max[2], this.min[2] + (k + 1) * hz) - Math.max(b.min[2], this.min[2] + k * hz);
        if (fz <= 0) {
          continue;
        }
        for (let j = j0; j <= j1; j++) {
          const fy = Math.min(b.max[1], this.min[1] + (j + 1) * hy) - Math.max(b.min[1], this.min[1] + j * hy);
          if (fy <= 0) {
            continue;
          }
          for (let i = i0; i <= i1; i++) {
            const fx = Math.min(b.max[0], this.min[0] + (i + 1) * hx) - Math.max(b.min[0], this.min[0] + i * hx);
            if (fx <= 0) {
              continue;
            }
            const c = i + nx * (j + ny * k),
              sx = fx / hx,
              sy = fy / hy,
              sz = fz / hz;
            // along an axis the covered columns are in parallel with the free ones, and a slab in a column is in series with the rest of it
            this.open[0][c]! *= 1 - sy * sz * (1 - series(b.k[0], sx));
            this.open[1][c]! *= 1 - sx * sz * (1 - series(b.k[1], sy));
            this.open[2][c]! *= 1 - sx * sy * (1 - series(b.k[2], sz));
            lists.push([c, bi]);
            counts[c + 1]!++;
          }
        }
      }
    });
    for (let c = 0; c < N; c++) {
      this.boxStart[c + 1] = this.boxStart[c]! + counts[c + 1]!;
    }
    const out = new Int32Array(lists.length),
      at = this.boxStart.slice(0, N);
    for (const [c, bi] of lists) {
      out[at[c]!++] = bi;
    }
    return out;
  }

  /** The face conductances from the open shares: between two cells the harmonic mean, scaled by the face's area over the cells' distance. */
  private link(): void {
    const [nx, ny, nz] = this.n,
      [hx, hy, hz] = this.h,
      scale = [(hy * hz) / hx, (hx * hz) / hy, (hx * hy) / hz],
      step = [1, nx, nx * ny];
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const c = i + nx * (j + ny * k),
            at = [i, j, k];
          for (let a = 0; a < 3; a++) {
            if (at[a]! >= this.n[a]! - 1) {
              continue;
            }
            const p = this.open[a]![c]!,
              q = this.open[a]![c + step[a]!]!;
            this.face[a]![c] = p + q > 1e-6 ? (scale[a]! * (2 * p * q)) / (p + q) : 0;
          }
        }
      }
    }
  }

  /**
   * The cells a shape covers on the plane across `axis` through `at`, moved `shift` along the axis (to take the layer of cells next to a wall or a fan).
   * Each cell has the area of the shape inside it (sampled), so a fan's flow spreads over its cells by their share.
   */
  footprint(at: V3, axis: 0 | 1 | 2, shape: Shape, shift = 0): Footprint {
    const [u, v] = AXES[axis]!,
      hu = 'r' in shape ? shape.r : shape.hw,
      hv = 'r' in shape ? shape.r : shape.hh;
    const s = Math.min(this.h[u]!, this.h[v]!) / 3,
      nu = Math.max(1, Math.round((2 * hu) / s)),
      nv = Math.max(1, Math.round((2 * hv) / s)),
      du = (2 * hu) / nu,
      dv = (2 * hv) / nv;
    const acc = new Map<number, number>(),
      p: V3 = [0, 0, 0];
    p[axis] = at[axis] + shift;
    for (let a = 0; a < nu; a++) {
      for (let b = 0; b < nv; b++) {
        const x = -hu + (a + 0.5) * du,
          y = -hv + (b + 0.5) * dv;
        if ('r' in shape && x * x + y * y > shape.r * shape.r) {
          continue;
        }
        p[u] = at[u]! + x;
        p[v] = at[v]! + y;
        const c = this.cellAt(
          Math.min(this.max[0] - 1e-6, Math.max(this.min[0] + 1e-6, p[0])),
          Math.min(this.max[1] - 1e-6, Math.max(this.min[1] + 1e-6, p[1])),
          Math.min(this.max[2] - 1e-6, Math.max(this.min[2] + 1e-6, p[2])),
        );
        if (c >= 0) {
          acc.set(c, (acc.get(c) ?? 0) + du * dv);
        }
      }
    }
    if (acc.size === 0) {
      p[u] = at[u]!;
      p[v] = at[v]!;
      const c = this.cellAt(p[0], p[1], p[2]);
      if (c >= 0) {
        acc.set(c, 4 * hu * hv);
      }
    }
    return { cells: [...acc.keys()], area: [...acc.values()] };
  }

  /**
   * An opening in the case's wall (a grille, a slot): air goes through to the room. `wall` 0..5 is -x, +x, -y, +y, -z, +z; `centre` is where on that wall
   * (the other two axes count); `open` is the share of the area that passes air. The cells next to the wall get their conductance by their area on it.
   */
  vent(wall: number, centre: V3, shape: Shape, open: number): void {
    const axis = (wall >> 1) as 0 | 1 | 2,
      hi = (wall & 1) === 1,
      half = this.h[axis]! / 2,
      at: V3 = [centre[0], centre[1], centre[2]];
    at[axis] = hi ? this.max[axis] : this.min[axis];
    const f = this.footprint(at, axis, shape, hi ? -half : half);
    f.cells.forEach((c, n) => {
      this.ground[c]! += (open * f.area[n]!) / half;
    });
  }
}
