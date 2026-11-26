// The loop's two hoses as one rig (cooler3d.ts): built where `hose` hangs them, posed live by Build my PC while it takes them off or puts them on.
import { CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import { SEG, place, withLow } from '@/core/render/three/geometry';
import { tag } from '@/core/render/three/pick';
import { Rope, hang } from '@/core/render/three/rope';
import { Sleeve } from '@/core/render/three/sleeve';
import { samplesFor, sleeveMat } from '../cables3d';
import { HOSE_R, nth } from './kit';
import { HOSE_LOOK, ferruleMat, hoseRope } from './hoses';
import type { Env, MeshStandardMaterial, RopeEnd, RopeSpec, V3 } from './types';

/** How far a hose's end slides along its fitting to come off it: past the collar's tip and its ridges, with room. */
const HOSE_PULL = 300;
const UP = new Vector3(0, 1, 0);
/** A hose of the rig: its rope as built and its ends, its seated points, its two skins and ferrules, and its live rope while it moves. */
interface Hose {
  spec: RopeSpec;
  ends: readonly [RopeEnd, RopeEnd];
  seat: V3[];
  hi: Sleeve;
  lo: Sleeve;
  ferrules: readonly [Mesh, Mesh];
  rope: Rope | null;
}

/** Skin a hose along its points; its ferrules sit on the straight leads, 70 in from each end. */
function drawHose(h: Hose, pts: readonly V3[]): void {
  h.hi.update([pts]);
  h.lo.update([pts]);
  const n = pts.length;
  for (const [f, i, j] of [
    [h.ferrules[0], 0, 1],
    [h.ferrules[1], n - 1, n - 2],
  ] as const) {
    const p = new Vector3(...nth(pts, i)),
      d = new Vector3(...nth(pts, j)).sub(p).normalize();
    f.position.copy(p).addScaledVector(d, 70);
    f.quaternion.setFromUnitVectors(UP, d);
  }
}

/** A rope end `s` of the way off its fitting along its own axis (`HOSE_PULL` at 1), moved by `off`. */
const slid = (e: RopeEnd, s: number, off: V3): RopeEnd => ({
  at: [
    e.at[0] + e.dir[0] * s * HOSE_PULL + off[0],
    e.at[1] + e.dir[1] * s * HOSE_PULL + off[1],
    e.at[2] + e.dir[2] * s * HOSE_PULL + off[2],
  ],
  dir: e.dir,
});

/**
 * The loop's two hoses as one piece (machine3d.ts builds them only with a pump and a radiator both fitted). They stand as `hose` hangs them, and
 * Build my PC poses them live while it takes them off or puts them on (`pose`): each end slides along its fitting, the pair moves by an offset,
 * and between the ends each hose hangs on a live rope, so it bends, sags and trails as it is carried. A rigid copy would move as a stiff piece.
 */
export class LoopHoses {
  /** What Build my PC shows and hides (tagged 'hoses'). */
  readonly root = tag(new Group(), 'hoses');
  /** What the zoom fades with the cooler (`fadeTree` sets its `visible` too, so it is not `root`). */
  readonly body = new Group();
  /** The sleeve of each hose (the hot one first): each its own material, so the thermal view can show each hose's water. */
  readonly skins: MeshStandardMaterial[] = [];
  private readonly hoses: Hose[] = [];
  /** The ropes' space while they move: the case's walls less the glass (the hoses leave through the open side), and the boxes. */
  private readonly free: Env;

  constructor(ends: readonly (readonly [RopeEnd, RopeEnd])[], env: Env) {
    this.root.add(this.body);
    this.free = { planes: env.planes.filter((p) => p.n[2] >= 0), solids: env.solids };
    const ferrule = ferruleMat(),
      ring = new CylinderGeometry(HOSE_R + 20, HOSE_R + 20, 140, SEG.disc);
    for (const [a, b] of ends) {
      const look = sleeveMat(...HOSE_LOOK),
        spec = hoseRope(a, b, env),
        seat = hang(spec),
        steps = samplesFor(seat.length);
      this.skins.push(look);
      // (the lower level: half the steps, 6 sides; the same skin, so it fits the full one; both follow every pose)
      const hi = new Sleeve(1, HOSE_R, steps, SEG.sleeve),
        lo = new Sleeve(1, HOSE_R, Math.max(SEG.sleeveStepsLow, Math.ceil(steps / 2)), SEG.sleeveLow);
      const ferrules = [place(new Mesh(ring, ferrule)), place(new Mesh(ring, ferrule))] as const;
      const skin = place(
        new Mesh(
          withLow(hi.geometry, () => lo.geometry),
          look,
        ),
      );
      this.body.add(skin, ...ferrules);
      const h: Hose = { spec, ends: [a, b], seat, hi, lo, ferrules, rope: null };
      this.hoses.push(h);
      drawHose(h, seat);
    }
  }

  /**
   * Pose the hoses: each end `slide` of the way off its fitting (0 on it, 1 free), the pair moved by `off`; the ropes take `steps` steps. While
   * the ends are on their fittings the hoses keep some of their seated arcs (all of them at 0), so they leave and come back to them smoothly.
   */
  pose(slide: number, off: V3, steps: number): void {
    const s = Math.max(0, Math.min(1, slide)),
      keep = 1 - s;
    for (const h of this.hoses) {
      const a = slid(h.ends[0], s, off),
        b = slid(h.ends[1], s, off),
        seat = h.seat.map((p): V3 => [p[0] + off[0], p[1] + off[1], p[2] + off[2]]);
      h.rope ??= new Rope({ ...h.spec, ...this.free, a, b }, { live: true, start: seat });
      h.rope.setEnds(a, b);
      h.rope.step(steps);
      const live = h.rope.points();
      drawHose(
        h,
        keep > 0
          ? live.map((p, i): V3 => {
              const q = nth(seat, i);
              return [p[0] + (q[0] - p[0]) * keep, p[1] + (q[1] - p[1]) * keep, p[2] + (q[2] - p[2]) * keep];
            })
          : live,
      );
    }
  }

  /** Each hose's seated points (the hot one first, its pump end first): the airflow lens runs the coolant along them. */
  paths(): V3[][] {
    return this.hoses.map((h) => h.seat.map((p): V3 => [p[0], p[1], p[2]]));
  }

  /** Back on the fittings as they were built: the seated arcs, and no live rope. */
  rest(): void {
    for (const h of this.hoses) {
      h.rope = null;
      drawHose(h, h.seat);
    }
  }
}
