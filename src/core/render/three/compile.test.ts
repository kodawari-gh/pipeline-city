import { describe, expect, it, vi } from 'vitest';
import { Material, Mesh, Scene, type WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { freeWhenLinked, linked, prime, startPassPrograms, startPrograms, whenLinked, type Program } from './compile';

/** A program that links after `n` looks. */
const after = (n: number): Program => ({ isReady: () => n-- <= 0 });

describe('whenLinked', () => {
  it('resolves at once when all are linked, and says so', async () => {
    const seen: [number, number][] = [];
    await whenLinked([after(0), after(0)], (d, t) => seen.push([d, t]), 1);
    expect(seen).toEqual([[2, 2]]);
  });

  it('waits for the last one and counts them as they link', async () => {
    const seen: number[] = [];
    await whenLinked([after(0), after(2), after(4)], (d) => seen.push(d), 1);
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBe(3);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('linked: every one', () => {
    expect(linked([after(0), after(0)])).toBe(true);
    expect(linked([after(0), after(5)])).toBe(false);
    // a destroyed program (three sets its `program` to undefined) never links: it does not hold the wait
    expect(linked([after(0), { isReady: () => false, program: undefined } as Program])).toBe(true);
    expect(linked([{ isReady: () => false, program: {} } as Program])).toBe(false);
  });
});

describe('prime', () => {
  it('makes the first use of each program, once, and empties the list', () => {
    const uses = [0, 0, 0];
    const left: Program[] = uses.map((_, i) => ({ isReady: () => true, getUniforms: () => { uses[i] = (uses[i] ?? 0) + 1; } }));
    expect(prime(left, 1000)).toBe(true);
    expect(left).toEqual([]);
    expect(uses).toEqual([1, 1, 1]);
    expect(prime(left, 1000)).toBe(true); // (nothing left: nothing is used again)
    expect(uses).toEqual([1, 1, 1]);
  });

  it('stops at its time and takes the rest at the next call', () => {
    let used = 0, t = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => t);
    try {
      const left: Program[] = Array.from({ length: 5 }, () => ({ isReady: () => true, getUniforms: () => { used++; t += 1; } }));
      expect(prime(left, 2)).toBe(false); // (2 ms: two programs)
      expect(used).toBe(2);
      expect(prime(left, 10)).toBe(true);
      expect(used).toBe(5);
    } finally { spy.mockRestore(); }
  });

  it('leaves a destroyed program alone (the driver would log an invalid value for its deleted program) and one with no first use', () => {
    let used = 0;
    const left = [
      { isReady: () => false, program: undefined, getUniforms: () => { used++; } },
      { isReady: () => true },
    ] as Program[];
    expect(prime(left, 1000)).toBe(true);
    expect(used).toBe(0);
  });
});

describe('freeWhenLinked', () => {
  const tree = (programs: Program[]) => {
    const made = new Material(), fresh = new Material(), root = new Scene();
    root.add(new Mesh(undefined, made), new Mesh(undefined, fresh));
    const r = { properties: { has: (m: Material) => m === made, get: () => ({ programs: new Map(programs.map((p, i) => [String(i), p])) }) } } as unknown as WebGLRenderer;
    return { r, root };
  };

  it('frees at once when the programs have linked (a material with no program is not asked)', () => {
    const { r, root } = tree([after(0)]);
    let n = 0;
    freeWhenLinked(r, root, () => n++, 1);
    expect(n).toBe(1);
  });

  it('waits for a program that still links, then frees once', async () => {
    const { r, root } = tree([after(0), after(3)]);
    let n = 0;
    freeWhenLinked(r, root, () => n++, 1);
    expect(n).toBe(0);
    await new Promise((done) => setTimeout(done, 40));
    expect(n).toBe(1);
  });
});

describe('startPrograms', () => {
  it('compiles into a target, puts the old target back and gives each program once', () => {
    const shared = after(0), mats = [new Material(), new Material()], targets: unknown[] = [];
    let target: unknown = 'screen';
    const r = {
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => { target = t; targets.push(t); },
      compile: () => new Set(mats),
      properties: { get: () => ({ currentProgram: shared }) },
    } as unknown as WebGLRenderer;
    const scene = new Scene();
    scene.add(new Mesh());
    expect(startPrograms(r, scene, null as never)).toEqual([shared]);
    expect((targets[0] as { isWebGLRenderTarget?: boolean }).isWebGLRenderTarget).toBe(true);
    expect(target).toBe('screen');
  });

  it('makes the see-through variant of a fade, each variant once, and leaves the fade opaque', () => {
    const lid = new Mesh(undefined, new Material()), seen: boolean[] = [];
    const progs = new Map<Material, Map<string, Program>>();
    const r = {
      getRenderTarget: () => null, setRenderTarget: () => {},
      compile: () => {
        seen.push(lid.material.transparent);
        const m = progs.get(lid.material) ?? new Map<string, Program>();
        m.set(String(lid.material.transparent), after(0));
        progs.set(lid.material, m);
        return new Set([lid.material]);
      },
      properties: { get: (m: Material) => ({ programs: progs.get(m) }) },
    } as unknown as WebGLRenderer;
    const root = new Scene();
    root.add(lid);
    expect(startPrograms(r, root, null as never, { fades: [lid] })).toHaveLength(2);
    expect(seen).toEqual([false, true]);
    expect(lid.material.transparent).toBe(false);
  });
});

describe('startPassPrograms', () => {
  it('links for the attributes a pass draws with: three makes another program for a quad with others', () => {
    const seen: string[] = [], material = new Material();
    const r = {
      getRenderTarget: () => null, setRenderTarget: () => {},
      compile: (root: Mesh) => { seen.push(...Object.keys(root.geometry.attributes)); return new Set(); },
      properties: { get: () => ({}) },
    } as unknown as WebGLRenderer;
    startPassPrograms(r, [{ material }]);
    const drawn = (new FullScreenQuad(material) as unknown as { _mesh: Mesh })._mesh.geometry;
    expect(seen.sort()).toEqual(Object.keys(drawn.attributes).sort());
  });
});
