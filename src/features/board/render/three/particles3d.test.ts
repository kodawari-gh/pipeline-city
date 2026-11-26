import { describe, expect, it } from 'vitest';
import * as three from 'three';
import type { Snapshot } from '@/worker/protocol';
import { Particles3D } from './particles3d';
import { maxedSnapshot } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

// What rises over the machine: smoke off a burnt part, and nothing else. A part that runs hot sends up no haze and the CPU no sparks.

const base = maxedSnapshot();
const running: Snapshot = { ...base, powered: true, power: { ...base.power, tripped: false }, phase: 'running' };
const hot: Snapshot = { ...running, devices: running.devices.map((d) => ({ ...d, tempC: 95, throttle: 0.5 })) };
const burnt: Snapshot = { ...running, devices: running.devices.map((d) => ({ ...d, burnt: d.kind === 'cpu' })) };

const isPoints = (o: unknown): o is three.Points =>
  typeof o === 'object' && o !== null && 'isPoints' in o && o.isPoints === true;

/** The position attribute of the points, as a buffer attribute. */
function positionOf(p: three.Points): three.BufferAttribute {
  const attr = p.geometry.attributes['position'];
  if (!(attr instanceof three.BufferAttribute)) {
    throw new TypeError('expected a position buffer attribute');
  }
  return attr;
}

/** The positions of the points, x y z each. */
function positions(p: three.Points): Float32Array {
  const a = positionOf(p).array;
  if (!(a instanceof Float32Array)) {
    throw new TypeError('expected float positions');
  }
  return a;
}

function stage(): { scene: three.Scene; fx: Particles3D; points: three.Points } {
  const scene = new three.Scene(),
    fx = new Particles3D(scene),
    [points] = scene.children;
  if (!isPoints(points)) {
    throw new TypeError('expected the particles to be points');
  }
  return { scene, fx, points };
}
const inAir = (p: three.Points): number => {
  const a = positions(p);
  let n = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (must(a[i]) < 1e6) {
      n++;
    }
  }
  return n;
};
const run = (fx: Particles3D, s: Snapshot | null, secs: number): void => {
  for (let i = 0; i < secs * 30; i++) {
    fx.frame(s, 1 / 30);
  }
};

function assert_stops_with_the_pause_the_smoke_hangs_where_it_is(): void {
  const { fx, points } = stage();
  run(fx, burnt, 2);
  const before = inAir(points),
    pos = [...positions(points)];
  for (let i = 0; i < 90; i++) {
    fx.frame(burnt, 0);
  }
  expect(inAir(points)).toBe(before);
  expect([...positions(points)]).toStrictEqual(pos);
  expect(points.visible).toBe(true);
}

describe('particles over the machine', () => {
  it('a part that runs hot sends up no haze, and the CPU no sparks', () => {
    const { fx, points } = stage();
    run(fx, hot, 8);
    expect(inAir(points)).toBe(0);
    expect(points.visible).toBe(false);
  });

  it('a burnt part smokes, and the smoke clears when the part is gone', () => {
    const { fx, points } = stage();
    run(fx, burnt, 3);
    expect(points.visible).toBe(true);
    expect(inAir(points)).toBeGreaterThan(5);
    // (the part is replaced: no new smoke, and what is in the air thins out and goes)
    run(fx, running, 6);
    expect(inAir(points)).toBe(0);
    expect(points.visible).toBe(false);
  });

  it('stops with the pause: the smoke hangs where it is, and none is born', () => {
    expect.hasAssertions();
    assert_stops_with_the_pause_the_smoke_hangs_where_it_is();
  });

  it('draws none at density 0, and has no work with no smoke in the air', () => {
    const { fx, points } = stage();
    fx.density = 0;
    run(fx, burnt, 3);
    expect(inAir(points)).toBe(0);
    expect(points.visible).toBe(false);
    fx.density = 1;
    const pos = positionOf(points);
    run(fx, running, 2);
    // (nothing to move: the buffer is not marked for upload)
    expect(pos.version).toBe(0);
  });
});
