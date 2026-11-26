import { BoxGeometry, Mesh, SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { DepthMap, Taut, arc, bake, convexHull } from './contact';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const lowest = (g: BoxGeometry | SphereGeometry, axis: 0 | 1 | 2) => {
  g.computeBoundingBox();
  return must(g.boundingBox).min.getComponent(axis);
};

/** How many of the points are under the height `y`. */
const countUnder = (p: { count: number; getY: (i: number) => number }, y: number) =>
  Array.from({ length: p.count }, (_, i) => p.getY(i)).filter((v) => v < y).length;
/** The points of a cloth line every `step` along it. */
const samplesOf = (t: Taut, step: number) =>
  Array.from({ length: Math.ceil(t.length / step) }, (_, k) => t.at(k * step));
/** Whether a point is between the top's edge and the ledge of the step (x 10 to 30, kept clear of both). */
const inGap = (p: { x: number }) => p.x > 10.5 && p.x < 29.5;
/** Whether a point is the corner under the step (10, 40). */
const isStepCorner = ([x, y]: readonly number[]) => x === 10 && y === 40;

describe('contact', () => {
  it('sets a thing down on a flat face and on what is already there', () => {
    const floor = new DepthMap(1, 1, [-1000, 0, -1000], [1000, 0, 1000], 20).face(
      0,
      [-1000, 0, -1000],
      [1000, 0, 1000],
    );
    const box = new BoxGeometry(200, 200, 200).translate(0, 900, 0);
    expect(floor.settle(box)).toBeCloseTo(-800);
    expect(lowest(box, 1)).toBeCloseTo(0);
    // a ball dropped on the box rests on its top, not on the floor
    floor.add(box);
    const ball = new SphereGeometry(50, 16, 12).translate(40, 2000, 0);
    floor.settle(ball);
    expect(lowest(ball, 1)).toBeCloseTo(200, 0);
  });

  it('leans a thing back onto a wall along z, and leaves one with nothing behind it', () => {
    const wall = new DepthMap(2, 1, [-500, -500, 0], [500, 500, 0], 10).face(100, [-500, -500, 0], [500, 500, 0]);
    const box = new BoxGeometry(100, 100, 100).translate(0, 0, 3000);
    wall.settle(box, 5);
    expect(lowest(box, 2)).toBeCloseTo(105);
    const off = new BoxGeometry(100, 100, 100).translate(5000, 0, 3000);
    expect(wall.settle(off)).toBe(0);
  });

  it('presses soft cloth flat where it meets the support, not past it', () => {
    const floor = new DepthMap(1, 1, [-1000, 0, -1000], [1000, 0, 1000], 10).face(
      0,
      [-1000, 0, -1000],
      [1000, 0, 1000],
    );
    const ball = new SphereGeometry(300, 24, 16).translate(0, 300, 0);
    floor.settle(ball, -60);
    floor.conform(ball, 10);
    const p = must(ball.attributes['position']);
    let min = Infinity;
    for (let i = 0; i < p.count; i++) {
      min = Math.min(min, p.getY(i));
    }
    const flat = countUnder(p, 12);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(flat).toBeGreaterThan(10);
    // the top is untouched
    ball.computeBoundingBox();
    expect(must(ball.boundingBox).max.y).toBeCloseTo(540, 0);
  });

  it('moves a mesh into its geometry', () => {
    const m = new Mesh(new BoxGeometry(10, 10, 10));
    m.position.set(100, 0, 0);
    m.rotation.set(0, Math.PI / 2, 0);
    const g = bake(m);
    g.computeBoundingBox();
    expect(must(g.boundingBox).min.x).toBeCloseTo(95);
    expect(m.position.x).toBe(0);
  });

  it('walks a taut cloth over a box from its top to its far side, out by its offset', () => {
    const box = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ] as const;
    const t = new Taut(box, [0, 50], [100, 0], 5);
    // from the top's edge (straight up by the offset), over the corner, down the side to its foot
    const start = t.at(0);
    expect(start.x).toBeCloseTo(0, 3);
    expect(start.y).toBeCloseTo(55, 3);
    const end = t.at(t.length);
    expect(end.x).toBeCloseTo(105, 0);
    expect(end.y).toBeCloseTo(0, 0);
    // halfway down the side it is out by the offset, its normal straight out
    const sideMid = t.length - 25,
      mid = t.at(sideMid);
    expect(mid.x).toBeCloseTo(105, 0);
    expect(mid.nx).toBeCloseTo(1, 1);
    // past the end it runs on straight down
    expect(t.at(t.length + 30).y).toBeCloseTo(end.y - 30, 0);
  });

  it('bridges a step: the cloth goes from the top edge to the lower ledge straight, never into the corner between', () => {
    const pts = [
      ...arc(0, 90, 10, Math.PI / 2, 0),
      [10, 40] as const,
      [30, 40] as const,
      [30, 0] as const,
      [-50, 0] as const,
      [-50, 100] as const,
    ];
    const t = new Taut(pts, [0, 100], [30, 0], 0);
    // between the top's edge and the ledge it runs on the straight line from one to the other, never down into the corner
    for (const p of samplesOf(t, 2).filter((q) => inGap(q))) {
      expect(p.y).toBeGreaterThan(90 - (p.x - 10) * 2.5 - 0.5);
    }
    expect(convexHull(pts).some((q) => isStepCorner(q))).toBe(false);
  });
});
