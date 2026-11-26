// The coolers' small parts (cooler3d.ts): screw heads, the loop's G1/4 fittings and plugs, the heat pipes, and the mount every cooler stands on.
/* oxlint-disable eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own */
import { CatmullRomCurve3, CylinderGeometry, Mesh, TorusGeometry, TubeGeometry, Vector2, Vector3 } from 'three';
import type { BufferGeometry, Group, Material, MeshStandardMaterial } from 'three';
import { SEG, instanced, place, rectBox, softBox, withLow } from '@/core/render/three/geometry';
import { byDetail } from '@/core/render/three/detail';
import { mat } from '@/core/render/three/materials';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { COOLER_HOLE, COOLER_HOLES } from '../../layout/layout';
import { METAL, alu, plastic, screwHead, steel } from './look';

/** Screws standing on a face at depth `z`, `r` round (the push pins' heads, the crossbar's spring screws, the radiator's fill port). */
export function screws(g: Group, at: readonly (readonly [number, number])[], o: { z: number; r: number }): void {
  const { z, r } = o,
    geo = new CylinderGeometry(r, r * 1.08, r * 0.5, SEG.disc).rotateX(Math.PI / 2),
    side = alu(METAL.hi, 0.3),
    top = mat(0xff_ff_ff, { map: screwHead(), metalness: 0.7, roughness: 0.35 });
  for (const [x, y] of at) {
    const s = place(new Mesh(geo, [side, top, side]));
    s.position.set(x, -y, z + r * 0.25);
    g.add(s);
  }
}

/** The loop's hoses: 12 mm braided hoses, as an all-in-one loop's. */
export const HOSE_R = 140;
/** A G1/4 fitting along its axis from its port: the hex it screws in by, the collar the hose's ferrule pushes over, its length; the hose starts `FIT.len - 40` out. */
export const FIT = { hex: 220, hexLen: 110, collar: HOSE_R + 30, len: 330 } as const;
/** The loop's fittings and plugs: black chrome. */
export const chrome = (): MeshStandardMaterial => mat(0x2a_2d_32, { metalness: 0.9, roughness: 0.22 });

/** Where a part of a fitting goes: out of the port at `p` along `dir`, `at` that far out; `axis` is the one its geometry was built along. */
interface Along {
  p: Vector3;
  dir: Vector3;
  at: number;
  axis?: Vector3;
}

/** A part of a fitting: `geo` built along `axis`, turned to point along `dir` and set `at` that far out of the port at `p`. */
function along(g: Group, part: { geo: BufferGeometry; m: Material }, o: Along) {
  const { p, dir, at, axis = new Vector3(0, 1, 0) } = o,
    a = place(new Mesh(part.geo, part.m));
  a.quaternion.setFromUnitVectors(axis, dir);
  a.position.copy(p).addScaledVector(dir, at);
  g.add(a);
}

/** A port at the world point `p` facing `dir` (a unit vector). */
export interface Port {
  p: Vector3;
  dir: Vector3;
}

/** A G1/4 fitting screwed into a port at the world point `p`, pointing along `dir` (a unit vector): its hex, then the collar with two ridges round it. */
export function fitting(g: Group, { p, dir }: Port, m: Material): void {
  along(g, { geo: new CylinderGeometry(FIT.hex, FIT.hex, FIT.hexLen, SEG.hexNut), m }, { p, dir, at: FIT.hexLen / 2 });
  along(
    g,
    { geo: new CylinderGeometry(FIT.collar, FIT.collar + 12, FIT.len - FIT.hexLen, SEG.drum), m },
    { p, dir, at: (FIT.hexLen + FIT.len) / 2 },
  );
  for (const at of [FIT.hexLen + 60, FIT.len - 30]) {
    const geo = new TorusGeometry(FIT.collar + 6, 10, SEG.smallDisc, SEG.bigDisc);
    along(g, { geo, m }, { p, dir, at, axis: new Vector3(0, 0, 1) });
  }
}

/** A G1/4 plug in a port at `p` facing `dir`: a flat round head, a hex socket in it. */
export function plug(g: Group, { p, dir }: Port, m: Material): void {
  along(g, { geo: new CylinderGeometry(190, 200, 60, SEG.drum), m }, { p, dir, at: 30 });
  along(
    g,
    { geo: new CylinderGeometry(70, 70, 8, SEG.lowDisc), m: mat(0x05_06_08, { roughness: 0.8 }) },
    { p, dir, at: 62 },
  );
}

/** A cylinder standing along z, one unit tall (`instanced` stretches it), `r0` round at its top and `r1` at its foot. */
export const upright = (r0: number, r1: number, sides: number): CylinderGeometry =>
  new CylinderGeometry(r0, r1, 1, sides).rotateX(Math.PI / 2);
/** One copy at each cooler hole, from depth `z0` to `z1` (for `instanced`). */
export const atHoles = (z0: number, z1: number): { x: number; y: number; z: number; sz: number }[] =>
  COOLER_HOLES.map(([x, y]) => ({ x, y: -y, z: (z0 + z1) / 2, sz: z1 - z0 }));
/** A circle of points round (x, y) in the board's plane (world y up): a round hole in a shape. */
export const circle = ({ x, y }: { x: number; y: number }, r: number, n = 64): Vector2[] =>
  Array.from(
    { length: n },
    (_, k) => new Vector2(x + Math.cos((k / n) * Math.PI * 2) * r, y + Math.sin((k / n) * Math.PI * 2) * r),
  );
/** A bent pipe through the points (`rounded`), smooth at its bends however long its runs. */
export const pipe = (pts: readonly (readonly [number, number, number])[], r: number, m: Material): Mesh => {
  const curve = new CatmullRomCurve3(
    pts.map((p) => new Vector3(p[0], p[1], p[2])),
    false,
    'centripetal',
  );
  // (the lower level: fewer steps and sides on the same curve, LOD-05)
  const g = withLow(
    new TubeGeometry(
      curve,
      byDetail(SEG.heatPipeSteps, SEG.heatPipeStepsLow),
      r,
      byDetail(SEG.heatPipe, SEG.heatPipeLow),
    ),
    () => new TubeGeometry(curve, SEG.heatPipeLevelSteps, r, SEG.heatPipeLevelSides),
  );
  return place(new Mesh(g, m)); // (ASR6: was 220 x 16 at High)
};

/**
 * What every cooler mounts with, on the board's four cooler holes (`COOLER_HOLES`): a steel backplate on an insulating pad behind the board, a
 * threaded stud up through each hole; `standoff`: a hex standoff on each stud up to that depth, the cooler's bracket on them; `nut`: a knurled thumb
 * nut on each, its underside at that depth.
 */
export function mount(g: Group, o: { standoff?: number; nut?: number }): void {
  const m = steel();
  g.add(softBox({ x: -1080, y: -1020, w: 2160, h: 2040 }, BOARD_Z - 124, BOARD_Z - 70, m, 40));
  g.add(rectBox({ x: -1040, y: -980, w: 2080, h: 1960 }, BOARD_Z - 70, BOARD_Z - 64, plastic()));
  const { standoff, nut } = o,
    top = Math.max(nut ?? 0, standoff ?? BOARD_Z + 20) + 30;
  g.add(instanced(upright(COOLER_HOLE.r - 8, COOLER_HOLE.r - 8, SEG.post), m, atHoles(BOARD_Z - 70, top)));
  if (standoff !== undefined && Boolean(standoff)) {
    g.add(instanced(upright(58, 58, SEG.hexNut), steel(true), atHoles(BOARD_Z, standoff)));
  }
  if (nut !== undefined && Boolean(nut)) {
    g.add(instanced(upright(80, 90, SEG.drum), steel(true), atHoles(nut, nut + 130)));
  }
}

/** The item at `i`, which the caller knows is there (a pair's halves, a rope's points): a clear error if it is not. */
export function nth<T>(xs: readonly T[], i: number): T {
  const x = xs[i];
  if (x === undefined) {
    throw new RangeError(`no item ${i} of ${xs.length}`);
  }
  return x;
}
