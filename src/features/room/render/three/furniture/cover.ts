// The made bed (`bed`): the frame's levels, the mattress in its fitted sheet, the duvet's drape over it, and the runner across its foot on the
// duvet's own grid.
import { Mesh } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SEG, place } from '@/core/render/three/geometry';
import { cloth } from '@/core/render/three/materials';
import { Drape, breaks, slab, smooth } from '../bedding3d';
import { DUVET, RUNNER, SHEET } from '../palette';
import { BED, FLOOR_Y } from '../roomplan';
import { woven } from './textures';
import type { BedForm, Group } from './types';

/** The frame's levels (2D y down): the platform's top board down to `under`; the apron, set back `set` from its edges, down to `apron`. */
export const PLAT = FLOOR_Y - 4600,
  UNDER = FLOOR_Y - 3000,
  APRON = FLOOR_Y - 1100,
  SET = 2200;

/** The runner's rows across the duvet's grid (its foot end). */
const RUNNER_V0 = 26_500,
  RUNNER_V1 = 34_500;

/** The mattress (its top 9000 over the floor, its edges rounded) in its fitted sheet, set in from the platform's edges; its form for the cloth. */
export function madeMattress(g: Group): { mattress: Mesh; form: BedForm; mw: number } {
  const { x, w, z0, z1, head: hd } = BED,
    x1 = x + w,
    cx = x + w / 2;
  const sheet = cloth(0xff_ff_ff, { ...woven(SHEET), roughness: 0.92 });
  const mTop = BED.top,
    mr = 700,
    inset = 1100,
    mx0 = x + inset,
    mx1 = x1 - inset,
    mz0 = z0 + hd + 60,
    mz1 = z1 - inset,
    mw = mx1 - mx0;
  const mattress = place(new Mesh(new RoundedBoxGeometry(mw, PLAT - mTop, mz1 - mz0, SEG.softBevel, mr), sheet));
  mattress.position.set(cx, -(mTop + PLAT) / 2, (mz0 + mz1) / 2);
  g.add(mattress);
  const form: BedForm = { mx0, mx1, mz0, mz1, top: -mTop, r: mr, x0: x, x1, z1, rim: -PLAT, base: -UNDER };
  return { mattress, form, mw };
}

/** The duvet's drape, its thickness over its grid, the grid (its rows and columns) and the runner's half width. */
interface CoverGrid {
  cover: Drape;
  tD: (u: number, v: number) => number;
  us: number[];
  vs: number[];
  ar: number;
}

/**
 * The duvet's drape and grid. A runner across the foot, on the duvet, its hem a little higher: its edges are rows and columns of the duvet's
 * grid too, so it follows the duvet's own triangles, out along their normals, and never crosses them.
 */
function coverGrid(form: BedForm): CoverGrid {
  const fl = FLOOR_Y,
    cover = new Drape(form, 40, 260),
    D = cover.dropTo(-(fl - 4000)),
    A = cover.a + D,
    V = cover.b + D;
  const v0 = 14_500,
    band = 3600,
    T = 620;
  const tD = (u: number, v: number) =>
    T *
    (0.45 + 0.55 * smooth(0, 1600, Math.min(A - Math.abs(u), V - v))) *
    (2 - smooth(v0 + band - 220, v0 + band + 220, v));
  const Dr = cover.dropTo(-(fl - 4800)),
    Ar = cover.a + Dr;
  const us = grid(
    breaks(-A, A, 500, 260, [
      [-A, -A + D + 1500],
      [A - D - 1500, A],
    ]),
    [-Ar, Ar],
  );
  const vs = grid(
    breaks(v0, V, 500, 240, [
      [v0, v0 + band + 800],
      [V - D - 1500, V],
    ]),
    [RUNNER_V0, RUNNER_V1],
  );
  return { cover, tD, us, vs, ar: Ar };
}

/** A grid's lines: `xs` and `add` together, each once, in order. */
function grid(xs: number[], add: number[]): number[] {
  return [...new Set([...xs, ...add])].toSorted((a, b) => a - b);
}

/** The duvet: a cloth slab over the drape, as thick as `tD`. */

function duvetOf({ cover, tD, us, vs }: CoverGrid): Mesh {
  return slab(
    (u, v) => cover.at(u, v),
    us,
    vs,
    tD,
    6000,
    cloth(0xff_ff_ff, { ...woven(DUVET, { repeat: [1, 1] }), roughness: 0.9 }),
  );
}

/** The runner across the duvet's foot: out along the duvet's normals, over its thickness and a little more. */
function runnerOf({ cover, tD, us, vs, ar: Ar }: CoverGrid): Mesh {
  const lift = (u: number, v: number) => tD(u, v) + 50 + 70 * (1 + Math.sin(u / 1300 + v / 900));
  return slab(
    (u, v) => {
      const { p, n } = cover.at(u, v),
        k = lift(u, v);
      return { p: [p[0] + n[0] * k, p[1] + n[1] * k, p[2] + n[2] * k], n };
    },
    us.filter((u) => Math.abs(u) <= Ar),
    vs.filter((v) => v >= RUNNER_V0 && v <= RUNNER_V1),
    (u, v) => 260 * (0.6 + 0.4 * smooth(0, 700, Math.min(Ar - Math.abs(u), v - RUNNER_V0, RUNNER_V1 - v))),
    4000,
    cloth(0xff_ff_ff, { ...woven(RUNNER, { repeat: [1, 1] }), roughness: 0.94 }),
  );
}

/** The duvet and the runner over the mattress's form (`form`), on one grid. */
export function bedCover(form: BedForm): { duvet: Mesh; runner: Mesh } {
  const drape = coverGrid(form);
  const duvet = duvetOf(drape),
    runner = runnerOf(drape);
  return { duvet, runner };
}
