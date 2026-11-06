import { describe, expect, it } from 'vitest';
import { Material, Mesh, Scene, type WebGLRenderer } from 'three';
import { linked, startPrograms, whenLinked, type Program } from './compile';

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
