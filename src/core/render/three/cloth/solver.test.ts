import { describe, expect, it } from 'vitest';
import { assemble, type Piece } from './pattern';
import { floor, sphere } from './solid';
import { Cloth, type ClothParams } from './solver';

const PARAMS: ClothParams = { rate: 1500, thickness: 3, self: 8, stretch: 1e-7, bend: 2e-4, friction: [0.6, 0.4] };

/** A flat square `s` mm wide, laid by `place`. */
const square = (name: string, s: number, place: Piece['place']): Piece => ({
  name,
  edges: [
    { name: 'bottom', pts: [[0, 0], [s, 0]] }, { name: 'right', pts: [[s, 0], [s, s]] },
    { name: 'top', pts: [[s, s], [0, s]] }, { name: 'left', pts: [[0, s], [0, 0]] },
  ],
  place,
});

describe('cloth solver', () => {
  it('closes a seam without gravity and leaves the pieces at their lengths', () => {
    const m = assemble({
      pieces: [square('a', 200, (x, y) => [x, y, 0]), square('b', 200, (x, y) => [x + 220, y, 0])],
      seams: [{ a: ['a', 'right'], b: ['b', 'left'], flip: true }], materials: ['c'],
    }, 20);
    const c = new Cloth(m, PARAMS);
    c.run({ time: 0.5, gravity: 0, solid: floor(-1e4), sew: Infinity, keep: 0 });
    const s = c.stats();
    expect(s.seam).toBeLessThan(0.5);
    expect(s.stretch).toBeLessThan(0.05);
  });

  it('drapes a square over a ball: it stays off it, keeps its lengths and stills', () => {
    const m = assemble({ pieces: [square('a', 400, (x, y) => [x - 200, 120, y - 200])], seams: [], materials: ['c'] }, 20);
    const ball = sphere(0, 0, 0, 100), c = new Cloth(m, PARAMS);
    c.run({ time: 1.5, gravity: 9810, solid: ball, sew: Infinity, keep: 0.2 });
    c.run({ time: 0.5, gravity: 9810, solid: ball, sew: Infinity, keep: 0.01 });
    for (let i = 0; i < m.n; i++) expect(ball(c.p[3 * i]!, c.p[3 * i + 1]!, c.p[3 * i + 2]!)).toBeGreaterThan(PARAMS.thickness - 0.5);
    // it hangs down past the ball's middle all round
    let low = Infinity;
    for (let i = 0; i < m.n; i++) low = Math.min(low, c.p[3 * i + 1]!);
    expect(low).toBeLessThan(-50);
    const s = c.stats();
    expect(s.stretch).toBeLessThan(0.1);
    expect(s.speed).toBeLessThan(200);
  });
});
