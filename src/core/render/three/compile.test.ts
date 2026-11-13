import { describe, expect, it } from 'vitest';
import { Material, Mesh, Scene, type WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { linked, startPassPrograms, startPrograms, whenLinked, type Program } from './compile';

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

  it('screen: links both the target\'s and the screen\'s variants, puts the old target back, and frees the 1x1 target', () => {
    let target: unknown = 'screen';
    const targets: unknown[] = [];
    const freed: unknown[] = [];
    let compiles = 0;
    const r = {
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => {
        target = t; targets.push(t);
        if ((t as { isWebGLRenderTarget?: boolean } | null)?.isWebGLRenderTarget) (t as { addEventListener: (e: string, f: () => void) => void }).addEventListener('dispose', () => freed.push(t));
      },
      // a fresh program per compile, so each variant's programs are told apart
      compile: () => { compiles++; return new Set<Material>([new Material()]); },
      properties: { get: () => ({ currentProgram: after(0) }) },
    } as unknown as WebGLRenderer;
    const out = startPrograms(r, new Scene(), null as never, { screen: true });
    // the target's pass, then the screen's: each compiles once (no fade)
    expect(targets.length).toBe(3);
    expect((targets[0] as { isWebGLRenderTarget?: boolean }).isWebGLRenderTarget).toBe(true);
    expect(targets[1]).toBeNull();
    expect(targets[2]).toBe('screen');
    expect(compiles).toBe(2);
    expect(out).toHaveLength(2);
    expect(freed).toEqual([targets[0]]);
    expect(target).toBe('screen');
  });

  it('without screen: compiles into the 1x1 target only, as before', () => {
    const targets: unknown[] = [];
    let target: unknown = 'screen';
    const r = {
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => { target = t; targets.push(t); },
      compile: () => new Set<Material>(),
      properties: { get: () => ({}) },
    } as unknown as WebGLRenderer;
    startPrograms(r, new Scene(), null as never);
    expect(targets.length).toBe(2);
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
