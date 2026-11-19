// The power lens's lines as meshes (docs/render/power.md "The lines"): the strips the shader draws, and what a snapshot writes into them.
import { describe, expect, it } from 'vitest';
import type { InstancedBufferAttribute, Mesh } from 'three';
import { PowerFlows, seedOf, strips } from './flows';
import type { PowerDraw, PowerLine, PowerShape } from './net';

const line = (id: string, pts: [number, number, number][], o: Partial<PowerLine> = {}): PowerLine => ({
  id, cable: id.split('#')[0]!, kind: 'cable', fade: 0, pts, width: 17, lift: 30, branch: false, watts: () => 0, state: () => 'on', ...o,
});

describe('seedOf', () => {
  it('is a number in [0, 1) that the name decides', () => {
    for (const id of ['atx#0', 'cpu#3', 'trace.pwrcpu.1', '']) {
      const a = seedOf(id);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
      expect(seedOf(id)).toBe(a);
    }
  });

  it('differs between the strands of one cable, so they do not pulse as one', () => {
    const seeds = new Set(Array.from({ length: 12 }, (_, k) => seedOf(`atx#${k}`)));
    expect(seeds.size).toBeGreaterThanOrEqual(11);
  });
});

describe('strips', () => {
  it('makes a strip of each stretch and numbers the arc length along its line', () => {
    const s = strips([line('a', [[0, 0, 0], [3, 4, 0], [3, 4, 12]])]);
    expect(s.n).toBe(2);
    expect([...s.a.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...s.b.slice(0, 4)]).toEqual([3, 4, 0, 5]);
    expect([...s.a.slice(4, 8)]).toEqual([3, 4, 0, 5]);
    expect([...s.b.slice(4, 8)]).toEqual([3, 4, 12, 17]);
  });

  it('keeps the width, the seed, the lift and the fade of the line in each of its strips', () => {
    const l = line('a', [[0, 0, 0], [10, 0, 0], [10, 10, 0]], { width: 22, lift: 70, fade: 1500 });
    const s = strips([l]);
    for (let k = 0; k < s.n; k++) expect([...s.look.slice(4 * k, 4 * k + 4)]).toEqual([22, Math.fround(seedOf('a')), 70, 1500]);
  });

  it('numbers where the strips of each line begin and how many there are, and skips a stretch with no length', () => {
    const s = strips([line('a', [[0, 0, 0], [5, 0, 0], [5, 0, 0], [9, 0, 0]]), line('b', [[0, 0, 0], [0, 0, 7]]), line('c', [[1, 1, 1]])]);
    expect([...s.first]).toEqual([0, 2, 3]);
    expect([...s.count]).toEqual([2, 1, 0]);
    expect(s.n).toBe(3);
    // (the arc is not broken by the point that was left out: the second strip starts where the first ends)
    expect(s.a[4 * 1 + 3]).toBe(5);
    expect(s.b[4 * 1 + 3]).toBe(9);
  });

  it('is empty for no lines', () => {
    expect(strips([]).n).toBe(0);
  });
});

/** A shape of a cable, a line of copper and a hidden run, as the net makes them. */
const shape = (): PowerShape => ({
  lines: [
    line('atx#0', [[0, 0, 0], [0, 100, 0]]),
    line('atx#1', [[10, 0, 0], [10, 100, 0], [10, 100, 50]]),
    line('trace.pwrcpu.0', [[0, 0, 0], [50, 0, 0]], { cable: '', kind: 'trace', lift: 70 }),
    line('atx~0', [[0, -30, 0], [0, 0, 0]], { cable: 'atx', kind: 'ghost', fade: 30 }),
  ],
  rings: [{ id: 'atx.ring', cable: 'atx', at: [0, 100, 0], r: 400 }],
  seats: new Map(), wall: null, monitor: null, hub: null, psu: null,
});

const draw = (state: number[], level: number[], open = [0]): PowerDraw => ({
  level: Float32Array.from(level), state: Uint8Array.from(state), open: Uint8Array.from(open), tags: [], parts: new Map(), warn: new Set(), refW: 60,
});

/** The per-strip state buffer of a layer (`[level, state]` a strip). */
const stateOf = (m: Mesh): number[] => [...((m.geometry as unknown as { getAttribute(n: string): InstancedBufferAttribute }).getAttribute('iState').array as Float32Array)];

describe('PowerFlows', () => {
  it('draws the lines with the depth test and the hidden runs through everything, in two meshes, with a mesh of rings', () => {
    const f = new PowerFlows(shape());
    expect(f.mesh.children.length).toBe(3);
    expect(f.strips).toBe(1 + 2 + 1 + 1);
    const [solid, ghost, rings] = f.mesh.children as Mesh[];
    expect((solid!.material as { depthTest: boolean }).depthTest).toBe(true);
    expect((ghost!.material as { depthTest: boolean }).depthTest).toBe(false);
    expect(rings!.visible).toBe(true);
    f.dispose();
  });

  it('writes the level and the state of each line into its strips', () => {
    const f = new PowerFlows(shape());
    f.set(draw([1, 2, 0, 1], [0.5, 0, 0, 0.25]), new Set());
    const [solid, ghost] = f.mesh.children as Mesh[];
    // (the solid mesh holds atx#0 (1 strip), atx#1 (2) and the trace (1); the hidden run is the other mesh)
    expect(stateOf(solid!).slice(0, 8)).toEqual([0.5, 1, 0, 2, 0, 2, 0, 0]);
    expect(stateOf(ghost!).slice(0, 2)).toEqual([0.25, 1]);
    f.dispose();
  });

  it('marks the strips of a cable a hand holds, so the shader hides them', () => {
    const f = new PowerFlows(shape());
    f.set(draw([1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5]), new Set(['atx']));
    const [solid, ghost] = f.mesh.children as Mesh[];
    // (atx's three strips and its hidden stub: 3; the copper is nobody's cable)
    expect(stateOf(solid!).filter((_, i) => i % 2 === 1)).toEqual([3, 3, 3, 1]);
    expect(stateOf(ghost!)[1]).toBe(3);
    f.dispose();
  });

  it('shows a ring only while its cable is out', () => {
    const f = new PowerFlows(shape());
    f.set(draw([1, 1, 1, 1], [0, 0, 0, 0], [1]), new Set());
    const rings = f.mesh.children[2] as Mesh;
    expect([...((rings.geometry as unknown as { getAttribute(n: string): InstancedBufferAttribute }).getAttribute('iOpen').array as Float32Array)].slice(0, 1)).toEqual([1]);
    f.dispose();
  });

  it('is empty without lines, and leaves the lens nothing to draw', () => {
    const f = new PowerFlows({ lines: [], rings: [], seats: new Map(), wall: null, monitor: null, hub: null, psu: null });
    expect(f.strips).toBe(0);
    expect((f.mesh.children as Mesh[]).every((m) => !m.visible)).toBe(true);
    f.dispose();
  });
});
