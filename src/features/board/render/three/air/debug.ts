// A picture of what the air's plan holds, for the developer (`window.__air.debug = true` in a dev build): the case's air as a white box, each body as
// a box (red: a wall, orange: air passes some of it), each fan as a ring on its plane (green blows in, cyan draws out, yellow runs inside) with a stick
// along its flow, each opening as a blue ring. The fastest cells' arrows show the flow itself.
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import type { AirSim } from './build';
import type { AirPlan } from './plan';
import type { V3 } from './grid';

const SEG = 20;

function boxLines(out: number[], min: V3, max: V3): void {
  const c = (i: number): V3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  for (let i = 0; i < 8; i++) {
    for (let a = 0; a < 3; a++) {
      if (!(i & (1 << a))) {
        out.push(...c(i), ...c(i | (1 << a)));
      }
    }
  }
}

function ringLines(out: number[], at: V3, axis: number, r: number): void {
  const [u, v] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2,
      b = ((i + 1) / SEG) * Math.PI * 2,
      p: V3 = [...at],
      q: V3 = [...at];
    p[u!] = at[u!]! + Math.cos(a) * r;
    p[v!] = at[v!]! + Math.sin(a) * r;
    q[u!] = at[u!]! + Math.cos(b) * r;
    q[v!] = at[v!]! + Math.sin(b) * r;
    out.push(...p, ...q);
  }
}

/** The lines of a plan: a mesh per colour. */
export function planLines(plan: AirPlan, sim?: AirSim): LineSegments[] {
  const white: number[] = [],
    red: number[] = [],
    orange: number[] = [],
    green: number[] = [],
    cyan: number[] = [],
    yellow: number[] = [],
    blue: number[] = [],
    grey: number[] = [];
  boxLines(white, plan.min, plan.max);
  for (const b of plan.boxes) {
    boxLines(b.k[0] < 0.12 && b.k[1] < 0.12 && b.k[2] < 0.12 ? red : orange, b.min, b.max);
  }
  for (const f of plan.fans) {
    if (f.kind === 'wall') {
      const axis = f.wall >> 1,
        hi = (f.wall & 1) === 1,
        at: V3 = [...f.centre];
      at[axis] = hi ? plan.max[axis]! : plan.min[axis]!;
      ringLines(f.into ? green : cyan, at, axis, f.r);
      const tip: V3 = [...at];
      tip[axis]! += (hi ? -1 : 1) * (f.into ? 1 : -1) * 900;
      (f.into ? green : cyan).push(...at, ...tip);
    } else {
      ringLines(yellow, f.at, f.axis, f.r);
      const tip: V3 = [...f.at];
      tip[f.axis]! += f.dir * 900;
      yellow.push(...f.at, ...tip);
    }
  }
  for (const v of plan.vents) {
    const axis = v.wall >> 1,
      hi = (v.wall & 1) === 1,
      at: V3 = [...v.centre];
    at[axis] = hi ? plan.max[axis]! : plan.min[axis]!;
    if ('r' in v.shape) {
      ringLines(blue, at, axis, v.shape.r);
    } else {
      const lo: V3 = [...at],
        up: V3 = [...at],
        [u, w] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
      lo[u!] = at[u!]! - v.shape.hw;
      lo[w!] = at[w!]! - v.shape.hh;
      up[u!] = at[u!]! + v.shape.hw;
      up[w!] = at[w!]! + v.shape.hh;
      boxLines(blue, lo, up);
    }
  }
  // the fastest cells' arrows
  if (sim) {
    const g = sim.grid,
      { u } = sim.field,
      top: [number, number][] = [];
    for (let c = 0; c < g.cells; c += 5) {
      top.push([c, Math.hypot(u[3 * c]!, u[3 * c + 1]!, u[3 * c + 2]!)]);
    }
    const c0: V3 = [0, 0, 0];
    for (const [c, m] of top) {
      if (m < 800) {
        continue;
      }
      g.centre(c, c0);
      const k = 700 / m;
      grey.push(...c0, c0[0] + u[3 * c]! * k, c0[1] + u[3 * c + 1]! * k, c0[2] + u[3 * c + 2]! * k);
    }
  }
  const make = (pts: number[], color: number): LineSegments => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pts, 3));
    const l = new LineSegments(
      g,
      new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    l.frustumCulled = false;
    l.renderOrder = 1100;
    return l;
  };
  return [
    make(white, 0xff_ff_ff),
    make(red, 0xff_33_44),
    make(orange, 0xff_a0_30),
    make(green, 0x40_ff_70),
    make(cyan, 0x40_e0_ff),
    make(yellow, 0xff_e0_40),
    make(blue, 0x50_80_ff),
    make(grey, 0x90_90_a0),
  ];
}
