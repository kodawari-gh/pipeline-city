import { describe, expect, it, vi } from 'vitest';
import { catenary, hangCable, pathLen, startFall, stepFall, tiePoints } from './cable';
import type * as cableTypes from './cable';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A directory entry, as far as this test reads one. */
interface DirEntry {
  name: string;
  isDirectory: () => boolean;
}
/** The parts of `node:fs` this test reads with. */
interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string, options: { withFileTypes: true }) => DirEntry[];
}
/** The part of `node:url` this test uses. */
interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}
const fs = await vi.importActual<NodeFs>('node:fs');
const { fileURLToPath } = await vi.importActual<NodeUrl>('node:url');
const SRC: string = fileURLToPath(new URL('../../', import.meta.url));

/** How far the rope sags below its ends. */
const sag = (l: cableTypes.Pt[]) => Math.max(...l.map((p) => p[1]));

/** Steps a falling plug at 60 a second, on a cable of `len` from `anchor`, until it rests at `rest` (or 10 seconds pass); the time it took. */
function fallTime(
  f: cableTypes.Fall,
  { anchor, len, rest }: { anchor: cableTypes.Pt; len: number; rest: cableTypes.Pt },
): number {
  let t = 0;
  while (!f.done && t < 10) {
    stepFall(f, 1 / 60, anchor, len, rest);
    t += 1 / 60;
  }
  return t;
}

/** Every .ts file under `d`, but the cable's own and its test. */
function sourceFiles(d: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = `${d}${e.name}`;
    if (e.isDirectory()) {
      sourceFiles(`${p}/`, out);
    } else if (e.name.endsWith('.ts') && e.name !== 'cable.ts' && e.name !== 'cable.test.ts') {
      out.push(p);
    }
  }
  return out;
}

describe('cable physics', () => {
  it('a rope longer than the chord sags below it and has the length it was given', () => {
    const a: cableTypes.Pt = [0, 0],
      b: cableTypes.Pt = [1000, 0],
      pts = catenary(a, b, 1150, 60);
    expect(pts[0]).toStrictEqual(a);
    expect(must(pts[60])[0]).toBeCloseTo(1000, 3);
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(100); // screen down is positive: it hangs
    expect(pathLen(pts)).toBeGreaterThan(1130);
    expect(pathLen(pts)).toBeLessThan(1170);
  });

  it('a rope as short as the chord is straight; it is symmetrical level and sags less the tighter it is', () => {
    const straight = catenary([0, 0], [500, 300], 400);
    expect(straight.every((p) => Math.abs(p[1] - (p[0] * 300) / 500) < 1e-6)).toBe(true);
    const loose = catenary([0, 0], [1000, 0], 1200, 40),
      tight = catenary([0, 0], [1000, 0], 1020, 40);
    expect(sag(loose)).toBeGreaterThan(sag(tight));
    expect(must(loose[10])[1]).toBeCloseTo(must(loose[30])[1], 1);
  });

  it('runs to the left as well and reaches a higher end', () => {
    const l = catenary([1000, 0], [0, -400], 1300, 40);
    expect(must(l[40])[0]).toBeCloseTo(0, 3);
    expect(must(l[40])[1]).toBeCloseTo(-400, 3);
    expect(Math.max(...l.map((p) => p[1]))).toBeGreaterThanOrEqual(0);
  });

  it('a cable hangs from its fixed end along the way it leaves, and ends at the plug', () => {
    const anchor: cableTypes.Pt = [200, 0],
      tip: cableTypes.Pt = [900, 700],
      pts = hangCable(anchor, [0, -1], tip);
    expect(pts[0]).toStrictEqual(anchor);
    expect(must(pts.at(-1))[0]).toBeCloseTo(900, 3);
    expect(must(pts.at(-1))[1]).toBeCloseTo(700, 3);
    expect(must(pts[3])[1]).toBeLessThan(anchor[1] + 1); // it starts by going up
    for (const p of pts) {
      expect(Number.isFinite(p[0] + p[1])).toBe(true);
    }
  });

  it('a cable shorter than the distance is pulled straight and a plug right under the fixed end makes a loop to the side', () => {
    const t = hangCable([0, 0], [0, 1], [800, 0], { len: 500 });
    expect(Math.max(...t.map((p) => Math.abs(p[1])))).toBeLessThan(100); // only the stub leaves its line
    const u = hangCable([0, 0], [0, 1], [0, 600], { len: 900 });
    expect(Math.max(...u.map((p) => Math.abs(p[0])))).toBeGreaterThan(100);
  });

  it('a plug that is let go falls, bounces, slides to its rest place and stops there', () => {
    const anchor: cableTypes.Pt = [0, 0],
      rest: cableTypes.Pt = [300, 900];
    const f = startFall([400, 100], [200, 0]);
    const t = fallTime(f, { anchor, len: 1400, rest });
    expect(f.done).toBe(true);
    expect(t).toBeLessThan(4);
    expect(f.p).toStrictEqual(rest);
  });

  it('a falling plug never gets farther from the fixed end than the cable is long', () => {
    const anchor: cableTypes.Pt = [0, 0],
      rest: cableTypes.Pt = [100, 2000],
      f = startFall([900, 0], [1500, 0]);
    for (let i = 0; i < 300; i++) {
      stepFall(f, 1 / 60, anchor, 1000, rest);
      expect(Math.hypot(f.p[0] - anchor[0], f.p[1] - anchor[1])).toBeLessThan(1001);
    }
  });

  it('ties go along a long run and stay clear of its ends', () => {
    const pts: cableTypes.Pt[] = Array.from({ length: 101 }, (_, i) => [i * 50, 0] as cableTypes.Pt);
    const ties = tiePoints(pts, 1500, 260);
    expect(ties.length).toBeGreaterThan(2);
    for (const t of ties) {
      expect(t.at[0]).toBeGreaterThan(259);
      expect(t.at[0]).toBeLessThan(5000 - 259);
    }
  });

  it('every cable takes its sleeve from one place: no other file spells the sleeve colours', () => {
    const files = sourceFiles(SRC);
    const bad = files.filter((f) => /#171d29|#2a313d|#36457a|#8fa3d6/iu.test(fs.readFileSync(f, 'utf8')));
    expect(bad).toStrictEqual([]);
  });
});
