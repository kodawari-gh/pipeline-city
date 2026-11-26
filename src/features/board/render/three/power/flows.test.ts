// The power lens's lines as meshes (docs/render/power.md "The lines"): the strips the shader draws, and what a snapshot writes into them.
import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { PowerFlows, seedOf, strips } from './flows';
import type { PowerDraw, PowerLine, PowerShape } from './net';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}
/** The children of `o`, each a mesh. */
const meshes = (o: three.Object3D): three.Mesh[] => o.children.map((c) => asMesh(c));
/** The one material of `m`. */
function materialOf(m: three.Mesh): three.Material {
  if (Array.isArray(m.material)) {
    throw new TypeError('expected one material');
  }
  return m.material;
}
/** The value of the number uniform `name` of the shader of `m`. */
function uniformOf(m: three.Mesh, name: string): number {
  const mat = materialOf(m);
  if (!(mat instanceof three.ShaderMaterial)) {
    throw new TypeError('expected a ShaderMaterial');
  }
  const value: unknown = must(mat.uniforms[name]).value;
  if (typeof value !== 'number') {
    throw new TypeError(`expected ${name} to be a number`);
  }
  return value;
}

const line = (id: string, pts: [number, number, number][], o: Partial<PowerLine> = {}): PowerLine => ({
  id,
  cable: must(id.split('#')[0]),
  kind: 'cable',
  fade: 0,
  pts,
  width: 17,
  lift: 30,
  branch: false,
  tone: 'use',
  watts: () => 0,
  state: () => 'on',
  ...o,
});

function assert_is_a_number_in_0_1_that_the_name_decides(): void {
  for (const id of ['atx#0', 'cpu#3', 'trace.pwrcpu.1', '']) {
    const a = seedOf(id);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(seedOf(id)).toBe(a);
  }
}

function assert_keeps_the_width_the_seed_the_lift_and_the_fade_o(): void {
  const l = line(
    'a',
    [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ],
    { width: 22, lift: 70, fade: 1500 },
  );
  const s = strips([l]);
  for (let k = 0; k < s.n; k++) {
    expect([...s.look.subarray(4 * k, 4 * k + 4)]).toStrictEqual([22, Math.fround(seedOf('a')), 70, 1500]);
  }
}

const strength = (m: three.Mesh): number => uniformOf(m, 'uStrength');

const clock = (m: three.Mesh): number => uniformOf(m, 'uClock');

describe('seedOf', () => {
  it('is a number in [0, 1) that the name decides', () => {
    expect.hasAssertions();
    assert_is_a_number_in_0_1_that_the_name_decides();
  });

  it('differs between the strands of one cable, so they do not pulse as one', () => {
    const seeds = new Set(Array.from({ length: 12 }, (_, k) => seedOf(`atx#${k}`)));
    expect(seeds.size).toBeGreaterThanOrEqual(11);
  });
});

describe('strips', () => {
  it('makes a strip of each stretch and numbers the arc length along its line', () => {
    const s = strips([
      line('a', [
        [0, 0, 0],
        [3, 4, 0],
        [3, 4, 12],
      ]),
    ]);
    expect(s.n).toBe(2);
    expect([...s.a.subarray(0, 4)]).toStrictEqual([0, 0, 0, 0]);
    expect([...s.b.subarray(0, 4)]).toStrictEqual([3, 4, 0, 5]);
    expect([...s.a.subarray(4, 8)]).toStrictEqual([3, 4, 0, 5]);
    expect([...s.b.subarray(4, 8)]).toStrictEqual([3, 4, 12, 17]);
  });

  it('keeps the width, the seed, the lift and the fade of the line in each of its strips', () => {
    expect.hasAssertions();
    assert_keeps_the_width_the_seed_the_lift_and_the_fade_o();
  });

  it('numbers where the strips of each line begin and how many there are, and skips a stretch with no length', () => {
    const s = strips([
      line('a', [
        [0, 0, 0],
        [5, 0, 0],
        [5, 0, 0],
        [9, 0, 0],
      ]),
      line('b', [
        [0, 0, 0],
        [0, 0, 7],
      ]),
      line('c', [[1, 1, 1]]),
    ]);
    expect([...s.first]).toStrictEqual([0, 2, 3]);
    expect([...s.count]).toStrictEqual([2, 1, 0]);
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
    line('atx#0', [
      [0, 0, 0],
      [0, 100, 0],
    ]),
    line('atx#1', [
      [10, 0, 0],
      [10, 100, 0],
      [10, 100, 50],
    ]),
    line(
      'trace.pwrcpu.0',
      [
        [0, 0, 0],
        [50, 0, 0],
      ],
      { cable: '', kind: 'trace', lift: 70 },
    ),
    line(
      'atx~0',
      [
        [0, -30, 0],
        [0, 0, 0],
      ],
      { cable: 'atx', kind: 'ghost', fade: 30 },
    ),
  ],
  rings: [{ id: 'atx.ring', cable: 'atx', at: [0, 100, 0], r: 400 }],
  nodes: [
    {
      id: 'node.vrm',
      role: 'hub',
      at: [20, 30, 5],
      ex: [10, 0, 0],
      ey: [0, 6, 0],
      round: 2,
      watts: () => 0,
      state: () => 'on',
    },
    {
      id: 'node.wall',
      role: 'source',
      at: [0, 0, 0],
      ex: [4, 0, 0],
      ey: [0, 4, 0],
      round: 1,
      watts: () => 0,
      state: () => 'on',
    },
  ],
  seats: new Map(),
  wall: null,
  monitor: null,
  hub: null,
  psu: null,
});

/** A draw of the lines' `state` and `level`; the rings are shut and the plates idle unless `more` says otherwise. */
const draw = (
  state: number[],
  level: number[],
  more: { open?: number[]; node?: { level: number[]; state: number[] } } = {},
): PowerDraw => ({
  level: Float32Array.from(level),
  state: Uint8Array.from(state),
  open: Uint8Array.from(more.open ?? [0]),
  nodeLevel: Float32Array.from(more.node?.level ?? [0, 0]),
  nodeState: Uint8Array.from(more.node?.state ?? [0, 0]),
  tags: [],
  parts: new Map(),
  roles: new Map(),
  warn: new Set(),
  refW: 60,
});

/** The per-strip state buffer of a layer (`[level, state, tone]` a strip). */
/** An instanced attribute of a mesh. */
const attrOf = (m: three.Mesh, name: string): number[] => [...m.geometry.getAttribute(name).array];
const stateOf = (m: three.Mesh): number[] => attrOf(m, 'iState');

describe('PowerFlows', () => {
  it('draws the lines with the depth test and the hidden runs through everything, in two meshes, with a mesh of rings and one of plates', () => {
    const f = new PowerFlows(shape());
    expect(f.mesh.children).toHaveLength(4);
    expect(f.strips).toBe(1 + 2 + 1 + 1);
    expect(f.plates).toBe(2);
    const [plates, solid, ghost, rings] = meshes(f.mesh);
    expect(materialOf(must(solid)).depthTest).toBe(true);
    expect(materialOf(must(ghost)).depthTest).toBe(false);
    // (a plate lies where its thing is: a part in front of it hides it, and a dim copy of it shows through the part)
    expect(materialOf(must(plates)).depthTest).toBe(true);
    expect(must(plates).visible).toBe(true);
    expect(must(rings).visible).toBe(true);
    const [hidden] = meshes(must(plates));
    expect(materialOf(must(hidden)).depthTest).toBe(false);
    expect(must(hidden).geometry).toBe(must(plates).geometry);
    expect(must(hidden).renderOrder).toBeLessThan(must(plates).renderOrder);
    expect(strength(must(hidden))).toBeGreaterThan(0);
    expect(strength(must(hidden))).toBeLessThan(strength(must(plates)) * 0.4);
    f.dispose();
  });

  it('moves both clocks of the plates, the dim copy too', () => {
    const f = new PowerFlows(shape());
    f.frame(new three.PerspectiveCamera(50, 1, 1, 1000), 400, 0, 3.5);
    const plates = asMesh(f.mesh.children[0]),
      [hidden] = meshes(plates);
    expect(clock(plates)).toBe(3.5);
    expect(clock(must(hidden))).toBe(3.5);
    f.dispose();
  });

  it('writes the level and the state of each line into its strips', () => {
    const f = new PowerFlows(shape());
    f.set(draw([1, 2, 0, 1], [0.5, 0, 0, 0.25]), new Set());
    const [, solid, ghost] = meshes(f.mesh);
    // (the solid mesh holds atx#0 (1 strip), atx#1 (2) and the trace (1); the hidden run is the other mesh)
    expect(stateOf(must(solid)).slice(0, 12)).toStrictEqual([0.5, 1, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0]);
    expect(stateOf(must(ghost)).slice(0, 3)).toStrictEqual([0.25, 1, 0]);
    f.dispose();
  });

  it('writes the tone of each line into its strips: a use amber, a hub cyan, the mains from the wall white', () => {
    const s = shape();
    must(s.lines[0]).tone = 'source';
    must(s.lines[2]).tone = 'hub';
    const f = new PowerFlows(s);
    f.set(draw([1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5]), new Set());
    const [, solid] = meshes(f.mesh);
    // (atx#0 one strip: source 2; atx#1 two strips: use 0; the trace: hub 1)
    expect(stateOf(must(solid)).filter((_, i) => i % 3 === 2)).toStrictEqual([2, 0, 0, 1]);
    f.dispose();
  });

  it('marks the strips of a cable a hand holds, so the shader hides them', () => {
    const f = new PowerFlows(shape());
    f.set(draw([1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5]), new Set(['atx']));
    const [, solid, ghost] = meshes(f.mesh);
    // (atx's three strips and its hidden stub: 3; the copper is nobody's cable)
    expect(stateOf(must(solid)).filter((_, i) => i % 3 === 1)).toStrictEqual([3, 3, 3, 1]);
    expect(stateOf(must(ghost))[1]).toBe(3);
    f.dispose();
  });

  it('shows a ring only while its cable is out', () => {
    const f = new PowerFlows(shape());
    f.set(draw([1, 1, 1, 1], [0, 0, 0, 0], { open: [1] }), new Set());
    const rings = asMesh(f.mesh.children[3]);
    expect(attrOf(rings, 'iOpen').slice(0, 1)).toStrictEqual([1]);
    f.dispose();
  });

  it('writes the level and the state of each plate, with its role and its corner', () => {
    const f = new PowerFlows(shape());
    f.set(draw([1, 1, 1, 1], [0, 0, 0, 0], { node: { level: [0.6, 0.2], state: [1, 2] } }), new Set());
    const plates = asMesh(f.mesh.children[0]);
    // (role 1 a hub, 2 a source; then the level, the state, the corner)
    expect(attrOf(plates, 'iLook').map((x) => Math.round(x * 10) / 10)).toStrictEqual([1, 0.6, 1, 2, 2, 0.2, 2, 1]);
    expect(attrOf(plates, 'iAt').slice(0, 3)).toStrictEqual([20, 30, 5]);
    f.dispose();
  });

  it('is empty without lines, and leaves the lens nothing to draw', () => {
    const f = new PowerFlows({
      lines: [],
      rings: [],
      nodes: [],
      seats: new Map(),
      wall: null,
      monitor: null,
      hub: null,
      psu: null,
    });
    expect(f.strips).toBe(0);
    expect(f.plates).toBe(0);
    expect(meshes(f.mesh).every((m) => !m.visible)).toBe(true);
    f.dispose();
  });
});
