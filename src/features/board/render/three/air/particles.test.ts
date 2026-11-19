import { describe, expect, it } from 'vitest';
import { AirSim } from './build';
import type { AirBox, V3 } from './grid';
import { AIR, AirParticles, COOLANT, PSU, TRAIL, type AirEnv } from './particles';
import { pathLine, type AirPart, type AirPlan, type PlanFan, type PlanVent } from './plan';

const MIN: V3 = [0, 0, 0], MAX: V3 = [8000, 6000, 4000];
const intake: PlanFan = { id: 'f0', bank: 'case:front0', kind: 'wall', wall: 1, centre: [0, 3000, 2000], r: 1200, into: true, q: 1e11 };
const rear: PlanVent = { id: 'rear', wall: 0, centre: [0, 3000, 2000], shape: { r: 1500 }, open: 1 };
/** A block in the middle of the case, in the way of the stream. */
const block: AirBox = { id: 'blk', min: [3000, 2000, 1000], max: [4500, 4000, 3000], k: [0, 0, 0] };
const plan = (boxes: AirBox[] = [block]): AirPlan => ({ key: 'k', min: MIN, max: MAX, boxes, vents: [rear], fans: [intake], bodies: [] });
const AMBIENT = 25;
const env = (o: Partial<AirEnv> = {}): AirEnv => ({ dt: 1 / 30, ambientC: AMBIENT, mixC: AMBIENT, coolant: null, psu: null, ...o });

function world(boxes?: AirBox[], target = 400): { sim: AirSim; p: AirParticles } {
  const sim = new AirSim(plan(boxes), 3000);
  for (let i = 0; i < 400 && !sim.run(50); i++);
  sim.levels(() => 1);
  return { sim, p: new AirParticles(sim, target, 5) };
}
const run = (p: AirParticles, steps: number, e: AirEnv = env()): void => { for (let i = 0; i < steps; i++) p.step(e); };
const head = (p: AirParticles, i: number): V3 => [p.P[i * TRAIL * 3]!, p.P[i * TRAIL * 3 + 1]!, p.P[i * TRAIL * 3 + 2]!];

describe('the air\'s particles', () => {
  it('fill the case with air that flows, and stay in it and out of the solid parts', () => {
    const { p } = world();
    p.fill(AMBIENT);
    expect(p.count).toBeGreaterThan(300);
    run(p, 400);
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = head(p, i);
      expect(x).toBeGreaterThanOrEqual(MIN[0]);
      expect(x).toBeLessThanOrEqual(MAX[0]);
      expect(y).toBeGreaterThanOrEqual(MIN[1]);
      expect(y).toBeLessThanOrEqual(MAX[1]);
      expect(z).toBeGreaterThanOrEqual(MIN[2]);
      expect(z).toBeLessThanOrEqual(MAX[2]);
      if (p.K[i] === AIR) expect(x > block.min[0] && x < block.max[0] && y > block.min[1] && y < block.max[1] && z > block.min[2] && z < block.max[2]).toBe(false);
    }
  });

  it('are born at the intake and renewed as they leave: the count holds near what was asked', () => {
    const { p } = world(undefined, 400);
    p.fill(AMBIENT);
    run(p, 900);
    expect(p.count).toBeGreaterThan(250);
    expect(p.count).toBeLessThanOrEqual(p.cap);
  });

  it('ride the flow: on the whole they go from the east wall to the west, where the air leaves', () => {
    const { p } = world([], 300);
    p.fill(AMBIENT);
    run(p, 20);
    const x0: number[] = [];
    for (let i = 0; i < p.count; i++) x0.push(head(p, i)[0]);
    const n = p.count;
    run(p, 20);
    // (the same particles: births put new ones at the end and deaths swap from it, so the first ones are still those that stayed)
    let dx = 0, k = 0;
    for (let i = 0; i < Math.min(n, p.count, 100); i++) { if (Math.abs(head(p, i)[0] - x0[i]!) < 4000) { dx += head(p, i)[0] - x0[i]!; k++; } }
    expect(k).toBeGreaterThan(20);
    expect(dx / k).toBeLessThan(0);
  });

  it('a fan that stops lets the air age out: no new air, and the case empties', () => {
    const { sim, p } = world();
    p.fill(AMBIENT);
    sim.levels(() => 0);
    run(p, 800, env({ dt: 0.1 }));
    let air = 0;
    for (let i = 0; i < p.count; i++) if (p.K[i] === AIR) air++;
    expect(air).toBe(0);
  });

  it('are held by a paused game: with no time nothing moves', () => {
    const { p } = world();
    p.fill(AMBIENT);
    run(p, 10);
    const before = Array.from(p.P.slice(0, p.count * TRAIL * 3));
    p.step(env({ dt: 0 }));
    expect(Array.from(p.P.slice(0, p.count * TRAIL * 3))).toEqual(before);
  });

  it('take heat from a hot part in their way, never more than the part has, and carry it on', () => {
    const { p } = world([]);
    const hot: AirPart = { id: 'cpu', kind: 'cooler', min: [5500, 2000, 1000], max: [6500, 4000, 3000], porous: true, reach: 0, tempC: 80, powerW: 70, ua: 4, label: 'CPU' };
    p.setParts([hot]);
    p.fill(AMBIENT);
    run(p, 500);
    let warm = 0, max = -Infinity;
    for (let i = 0; i < p.count; i++) if (p.K[i] === AIR) { if (p.T[i]! > AMBIENT + 2) warm++; max = Math.max(max, p.T[i]!); }
    expect(warm).toBeGreaterThan(5);
    expect(max).toBeLessThanOrEqual(80 + 1e-3);
    // (a cold part gives nothing)
    const { p: q } = world([]);
    q.setParts([{ ...hot, tempC: AMBIENT, ua: 0 }]);
    q.fill(AMBIENT);
    run(q, 300);
    for (let i = 0; i < q.count; i++) expect(q.T[i]).toBeLessThanOrEqual(AMBIENT + 1e-3);
  });

  it('a part with a higher coefficient heats the air more', () => {
    const heat = (ua: number): number => {
      const { p } = world([]);
      p.setParts([{ id: 'cpu', kind: 'cooler', min: [5500, 2000, 1000], max: [6500, 4000, 3000], porous: true, reach: 0, tempC: 80, powerW: 70, ua, label: 'CPU' }]);
      p.fill(AMBIENT);
      run(p, 400);
      let s = 0;
      for (let i = 0; i < p.count; i++) s += p.T[i]! - AMBIENT;
      return s / p.count;
    };
    expect(heat(6)).toBeGreaterThan(heat(0.5));
  });

  it('run the coolant round its loop as beads, coloured by the water\'s temperature', () => {
    const { p } = world([]);
    const line = pathLine([[1000, 1000, 500], [3000, 1000, 500], [3000, 3000, 500], [1000, 3000, 500]]);
    p.setLoop({ ...line, hot: 2000, rad: 4000, cold: 6000 });
    let beads = 0;
    for (let i = 0; i < p.count; i++) if (p.K[i] === COOLANT) beads++;
    expect(beads).toBeGreaterThanOrEqual(10);
    run(p, 60, env({ coolant: { flow: 1, hotC: 60, coldC: 40 } }));
    for (let i = 0; i < p.count; i++) {
      if (p.K[i] !== COOLANT) continue;
      expect(p.T[i]).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(p.T[i]).toBeLessThanOrEqual(60 + 1e-6);
      const [x, y, z] = head(p, i);
      expect(z).toBeCloseTo(500, 3);
      expect(x).toBeGreaterThanOrEqual(1000 - 1e-3);
      expect(x).toBeLessThanOrEqual(3000 + 1e-3);
      expect(y).toBeGreaterThanOrEqual(1000 - 1e-3);
    }
    // (no loop, no beads)
    p.setLoop(null);
    for (let i = 0; i < p.count; i++) expect(p.K[i]).not.toBe(COOLANT);
  });

  it('keep the coolant still when the pump gives no flow', () => {
    const { p } = world([]);
    p.setLoop({ ...pathLine([[1000, 1000, 500], [3000, 1000, 500], [3000, 3000, 500]]), hot: 1000, rad: 2000, cold: 3000 });
    run(p, 3, env({ coolant: { flow: 0, hotC: 60, coldC: 40 } }));
    const before = Array.from(p.P.slice(0, p.count * TRAIL * 3));
    run(p, 20, env({ coolant: { flow: 0, hotC: 60, coldC: 40 } }));
    for (let i = 0; i < p.count; i++) if (p.K[i] === COOLANT) expect(head(p, i)).toEqual([before[i * TRAIL * 3], before[i * TRAIL * 3 + 1], before[i * TRAIL * 3 + 2]]);
  });

  it('the power supply\'s air runs on its own channel and warms toward the supply\'s temperature', () => {
    const { p } = world([]);
    p.setChannel(pathLine([[500, 500, 500], [2500, 500, 500]]));
    let n = 0;
    for (let i = 0; i < p.count; i++) if (p.K[i] === PSU) n++;
    expect(n).toBeGreaterThan(5);
    run(p, 120, env({ psu: { level: 1, tempC: 60 } }));
    let warm = 0;
    for (let i = 0; i < p.count; i++) if (p.K[i] === PSU && p.T[i]! > AMBIENT + 1) warm++;
    expect(warm).toBeGreaterThan(0);
    p.setChannel(null);
    for (let i = 0; i < p.count; i++) expect(p.K[i]).not.toBe(PSU);
  });

  it('a bead of the supply\'s air that reaches the end of its channel starts again at the front, with no trail across the channel', () => {
    const { p } = world([]);
    p.setChannel(pathLine([[500, 500, 500], [2500, 500, 500]]));
    for (let step = 0; step < 300; step++) {
      p.step(env({ psu: { level: 1, tempC: 60 } }));
      for (let i = 0; i < p.count; i++) {
        if (p.K[i] !== PSU) continue;
        const h = i * TRAIL * 3, tail = h + 3 * (TRAIL - 1);
        expect(Math.hypot(p.P[h]! - p.P[tail]!, p.P[h + 1]! - p.P[tail + 1]!, p.P[h + 2]! - p.P[tail + 2]!)).toBeLessThan(1500);
      }
    }
  });

  it('keep a short trail behind the head, that follows the path it took', () => {
    const { p } = world([]);
    p.fill(AMBIENT);
    run(p, 200);
    let trailed = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.K[i] !== AIR) continue;
      const h = i * TRAIL * 3, d = Math.hypot(p.P[h]! - p.P[h + 3 * (TRAIL - 1)]!, p.P[h + 1]! - p.P[h + 3 * (TRAIL - 1) + 1]!, p.P[h + 2]! - p.P[h + 3 * (TRAIL - 1) + 2]!);
      if (d > 100) trailed++;
      expect(d).toBeLessThan(6000);
    }
    expect(trailed).toBeGreaterThan(50);
  });
});
