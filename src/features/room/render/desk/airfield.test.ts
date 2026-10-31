import { describe, expect, it } from 'vitest';
import { AirField, growTrail, MAX_PARTICLES, TRAIL_MAX, trailLength, type FieldIn, type FieldPort } from './airfield';

const box = { x: 0, y: 0, w: 8000, h: 6000 };
const inlet = (level = 1): FieldPort => ({ id: 'front0', kind: 'in', pt: [7800, 3000], span: { x: 7700, y: 1500, w: 260, h: 3000 }, level });
const exhaust = (level = 1): FieldPort => ({ id: 'rear', kind: 'out', pt: [0, 900], span: { x: -100, y: 300, w: 170, h: 1200 }, level });
const input = (ports: FieldPort[], heat = 0): FieldIn => ({ box, ports, zones: [{ rects: [{ x: 3500, y: 2500, w: 600, h: 600 }], heat }, { rects: [{ x: 600, y: 5000, w: 900, h: 200 }], heat: 0 }] });

const run = (f: AirField, i: FieldIn, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) f.step(1 / 30, i); };

describe('the air field', () => {
  it('air runs from the intake toward the exhaust', () => {
    const f = new AirField();
    f.step(0.01, input([inlet(), exhaust()]));
    const v = f.velocity(4000, 2000);
    expect(v[0]).toBeLessThan(0); // west
    expect(v[1]).toBeLessThan(0); // and up, toward the rear exhaust
  });

  it('the far corners are not dead: a part in the corner away from every fan still has moving air, only slower than the middle', () => {
    const f = new AirField();
    f.step(0.01, input([inlet(), exhaust()]));
    const corner = f.speedAt(1000, 5100), mid = f.speedAt(4000, 2000);
    expect(corner).toBeGreaterThan(30);
    expect(corner).toBeLessThan(mid);
  });

  it('particles are released at an intake and leave through the exhaust, so the field stays bounded and nobody lingers', () => {
    const f = new AirField(), i = input([inlet(), exhaust()]);
    run(f, i, 90);
    expect(f.parts.length).toBeGreaterThan(5);
    expect(f.parts.length).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(Math.max(...f.parts.map((p) => p.age))).toBeLessThan(22);
  });

  it('intake air starts outside the case and is drawn in through the fan, then the field takes it', () => {
    const f = new AirField(), i = input([inlet(), exhaust()]);
    for (let k = 0; k < 300 && !f.parts.some((p) => p.inb); k++) f.step(1 / 30, i); // the first drop of air outside
    const outside = f.parts.filter((p) => p.inb);
    expect(outside.length).toBeGreaterThan(0);
    for (const p of outside) { expect(p.x).toBeGreaterThan(box.x + box.w); expect(p.vx).toBeLessThan(0); } // east of the front wall, flying west into it
    run(f, i, 20);
    expect(f.parts.some((p) => !p.inb && p.x < box.x + box.w)).toBe(true); // those that crossed are in the field
  });

  it('an intake that is warm (a radiator in front) lets warm air in: cold outside, warm once through the fan', () => {
    const f = new AirField(), i = input([{ ...inlet(), warm: 0.8 }, exhaust()]);
    for (let k = 0; k < 600; k++) f.step(1 / 30, i);
    const far = f.parts.filter((p) => p.inb && p.x > box.x + box.w + 1200), through = f.parts.filter((p) => !p.inb && p.x > 6500 && p.x < 7700);
    for (const p of far) expect(p.heat).toBe(0);
    expect(through.length).toBeGreaterThan(0);
    expect(Math.max(...through.map((p) => p.heat))).toBeGreaterThan(0.5);
  });

  it('with no exhaust nothing is drawn out: the air through the middle of the case is slower than with one, and nothing is absorbed', () => {
    const withOut = new AirField(), without = new AirField();
    withOut.step(0.01, input([inlet(), exhaust()]));
    without.step(0.01, input([inlet()]));
    expect(without.speedAt(3000, 1500)).toBeLessThan(withOut.speedAt(3000, 1500));
    // and a particle sitting at the rear opening is not removed when there is no sink there
    without.parts.push({ x: 60, y: 900, vx: 0, vy: 0, heat: 0, age: 1, k: 1, seed: 1 });
    without.step(1 / 30, input([inlet()]));
    expect(without.parts.some((p) => p.x < 400)).toBe(true);
  });

  it('air picks up the heat of a hot part it passes; with a cool part it stays cool', () => {
    const peak = (heat: number) => {
      const f = new AirField(), i = input([inlet(), exhaust()], heat);
      let top = 0;
      for (let t = 0; t < 90; t += 1 / 30) { f.step(1 / 30, i); for (const p of f.parts) top = Math.max(top, p.heat); }
      return top;
    };
    expect(peak(0.9)).toBeGreaterThan(0.15);
    expect(peak(0)).toBeLessThan(0.01);
  });

  it('air goes round a part, never through it', () => {
    const f = new AirField(), i = input([inlet(), exhaust()], 0.5), r = i.zones[0]!.rects[0]!;
    for (let t = 0; t < 60; t += 1 / 30) {
      f.step(1 / 30, i);
      for (const p of f.parts) expect(p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h).toBe(false);
    }
  });

  it('a fan that is still releases nothing, and a paused game (dt 0) holds every particle', () => {
    const f = new AirField();
    run(f, input([inlet(0), exhaust(0)]), 5);
    expect(f.parts).toHaveLength(0);
    run(f, input([inlet(), exhaust()]), 10);
    const at = f.parts.map((p) => [p.x, p.y]);
    f.step(0, input([inlet(), exhaust()]));
    expect(f.parts.map((p) => [p.x, p.y])).toEqual(at);
  });

  it("reads the sim's air of an area: next to a part in a poorly ventilated area the air crawls and stays warm", () => {
    const part = { x: 3500, y: 2500, w: 600, h: 600 };
    const mk = (flow: number, riseC: number): FieldIn => ({ box, ports: [inlet(), exhaust()], zones: [{ rects: [part], heat: 0, flow, riseC }] });
    const probe = (i: FieldIn) => {
      const f = new AirField(); f.step(0.01, i);
      const p = { x: 3300, y: 2800, vx: 0, vy: 0, heat: 0, age: 0, k: 1, seed: 0 }; f.parts.push(p);
      f.step(1 / 30, i);
      return p;
    };
    const free = probe(mk(1, 0)), trapped = probe(mk(0, 9));
    expect(Math.hypot(trapped.x - 3300, trapped.y - 2800)).toBeLessThan(Math.hypot(free.x - 3300, free.y - 2800));
    expect(free.heat).toBe(0);
    expect(trapped.heat).toBeGreaterThan(0.3);
  });

  it('a particle keeps the path it took as its trail, and the trail is longer for a faster particle but never beyond TRAIL_MAX', () => {
    expect(trailLength(2000)).toBe(TRAIL_MAX);
    expect(trailLength(300)).toBeLessThan(trailLength(900));
    const f = new AirField(), i = input([inlet(), exhaust()]);
    run(f, i, 20);
    const moving = f.parts.filter((p) => p.trail && p.trail.length > 1);
    expect(moving.length).toBeGreaterThan(0);
    for (const p of moving) {
      let len = 0, x = p.x, y = p.y;
      for (let k = p.trail!.length - 1; k >= 0; k--) { len += Math.hypot(p.trail![k]![0] - x, p.trail![k]![1] - y); [x, y] = p.trail![k]!; }
      expect(len).toBeLessThan(trailLength(Math.hypot(p.vx, p.vy)) + 90);
    }
  });

  it('a slower particle cuts its trail short', () => {
    const p = { x: 1000, y: 0, vx: 2000, vy: 0, heat: 0, age: 0, k: 1, seed: 0, trail: [[0, 0], [250, 0], [500, 0], [750, 0]] as [number, number][] };
    growTrail(p, 960, 0);
    const long = p.trail.length;
    p.vx = 100;
    growTrail(p, 1000, 0);
    expect(p.trail.length).toBeLessThan(long);
  });

  it('a flat part is no obstacle: air passes over it and still takes up its heat; a tall one is gone round', () => {
    const part = { x: 3500, y: 2500, w: 600, h: 600 };
    const through = (flat: boolean) => {
      const i: FieldIn = { box, ports: [inlet(), exhaust()], zones: [{ rects: [part], heat: 1, flat }] };
      const f = new AirField(); f.step(0.01, i);
      const p = { x: 3800, y: 2800, vx: 0, vy: 0, heat: 0, age: 0, k: 1, seed: 0 }; f.parts.push(p);
      f.step(1 / 30, i);
      return p;
    };
    const flat = through(true), tall = through(false);
    expect(flat.x > 3500 && flat.x < 4100 && flat.y > 2500 && flat.y < 3100).toBe(true); // still over the part
    expect(tall.x < 3500 || tall.x > 4100 || tall.y < 2500 || tall.y > 3100).toBe(true); // pushed out of it
    expect(flat.heat).toBeGreaterThan(0);
  });
});
