import { PerspectiveCamera, Scene, Vector2, WebGLRenderTarget, type Mesh, type MeshStandardMaterial, type PointLight, type ShaderMaterial, type WebGLRenderer } from 'three';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { debugLayer, debugStats } from '@/app/debug/city-layers';
import { OutsideView } from './view';

// the `?debug` overlay's layers: each changes what it claims, and turning it on again gives back what the view was
type Peek = {
  scene: { traverse(f: (o: unknown) => void): void }; lamps: PointLight[]; dome: Mesh; clock: number; key: number; mirrorAt: number;
  quad: ShaderMaterial; kit: { night: { mat: MeshStandardMaterial; k: number }[] }; facade: { night: { value: number } };
  target: WebGLRenderTarget | null;
  parts: { signs: { traverse(f: (o: { layers: { mask: number } }) => void): void }[] };
};

describe('debugLayer and debugStats (city-layers.ts)', () => {
  let v: OutsideView, p: Peek;
  beforeAll(() => { v = new OutsideView(0, 0, 1, 1, 0); p = v as unknown as Peek; });

  it('has stats of what it draws, and every layer back on leaves them as they were', () => {
    const all = debugStats(v);
    expect(all.tris).toBeGreaterThan(1000);
    expect(all.calls).toBeGreaterThan(5);
    for (const k of ['lights', 'buildings', 'freeze', 'cars', 'sky', 'glow', 'steam', 'mirror', 'flat']) { debugLayer(v,k, true); debugLayer(v,k, false); }
    expect(debugStats(v)).toEqual(all);
  });

  it('buildings, cars, steam and sky take their triangles out, each one its own', () => {
    const all = debugStats(v);
    for (const k of ['buildings', 'cars', 'steam', 'sky']) {
      debugLayer(v,k, true);
      const less = debugStats(v);
      expect(less.tris, k).toBeLessThan(all.tris);
      expect(less.calls, k).toBeLessThan(all.calls);
      debugLayer(v,k, false);
      expect(debugStats(v), k).toEqual(all);
    }
    debugLayer(v,'buildings', true);
    const noBuildings = debugStats(v).tris;
    expect(noBuildings).toBeLessThan(all.tris * 0.9);
    debugLayer(v,'buildings', false);
  });

  it('lights puts the lamps and the emissives at 0 at night, and on again gives them back', () => {
    v.frame(23, 1);
    const lit = p.kit.night.map((n) => n.mat.emissiveIntensity);
    expect(lit.every((x) => x > 0)).toBe(true);
    expect(p.lamps.every((l) => l.visible)).toBe(true);
    debugLayer(v,'lights', true);
    v.frame(23, 1);
    expect(p.kit.night.every((n) => n.mat.emissiveIntensity === 0)).toBe(true);
    expect(p.lamps.every((l) => !l.visible)).toBe(true);
    expect(p.facade.night.value).toBe(0);
    // the signs' layer: every node of each sign off (HIDDEN_LAYER = 30), then back on (layer 0)
    const signMasks = (): number[] => p.parts.signs.flatMap((s) => { const m: number[] = []; s.traverse((o) => m.push(o.layers.mask)); return m; });
    expect(signMasks().length).toBeGreaterThan(0);
    expect(signMasks().every((m) => m === 2 ** 30)).toBe(true);
    debugLayer(v,'lights', false);
    v.frame(23, 1);
    expect(p.kit.night.map((n) => n.mat.emissiveIntensity)).toEqual(lit);
    expect(p.lamps.every((l) => l.visible)).toBe(true);
    expect(p.facade.night.value).toBeGreaterThan(0);
    expect(signMasks().every((m) => m === 1)).toBe(true);
  });

  it('glow and mirror go to 0 at night, and on again give them back', () => {
    v.frame(23, 1);
    const glow = p.quad.uniforms.glowK!.value as number, mirror = p.mirrorAt;
    expect(glow).toBeGreaterThan(0);
    expect(mirror).toBeGreaterThan(0);
    debugLayer(v,'glow', true);
    debugLayer(v,'mirror', true);
    v.frame(23, 1);
    expect(p.quad.uniforms.glowK!.value).toBe(0);
    expect(p.mirrorAt).toBe(0);
    debugLayer(v,'glow', false);
    debugLayer(v,'mirror', false);
    v.frame(23, 1);
    expect(p.quad.uniforms.glowK!.value).toBe(glow);
    expect(p.mirrorAt).toBe(mirror);
  });

  it('freeze keeps the clock where it was, and on again lets it run', () => {
    v.frame(12, 10);
    debugLayer(v,'freeze', true);
    v.frame(12, 50);
    expect(p.clock).toBe(10);
    debugLayer(v,'freeze', false);
    v.frame(12, 60);
    expect(p.clock).toBe(60);
  });
});

// City 1x (`flat`): the picture's target follows the toggle, both ways, in size and samples
describe('OutsideView.draw, flat (City 1x)', () => {
  let v: OutsideView, p: Peek, room: Scene, cam: PerspectiveCamera, renderer: WebGLRenderer;
  const draw = () => v.draw(renderer, room, cam, 4);
  beforeEach(() => {
    v = new OutsideView(0, 0, 2, 2, 0); p = v as unknown as Peek;
    room = new Scene(); room.add(v.mesh);
    cam = new PerspectiveCamera(50, 1, 0.1, 20000); cam.position.set(0, 0, 3);
    const gl = { createQuery: () => ({}), beginQuery: () => {}, endQuery: () => {}, getQueryParameter: () => true, ANY_SAMPLES_PASSED_CONSERVATIVE: 0x8d6a, QUERY_RESULT: 0x8866, QUERY_RESULT_AVAILABLE: 0x8867 };
    renderer = {
      domElement: { addEventListener: () => {} }, getDrawingBufferSize: (s: Vector2) => s.set(400, 300), getContext: () => gl,
      getRenderTarget: () => null, setRenderTarget: () => {}, clear: () => {}, render: () => {},
    } as unknown as WebGLRenderer;
    v.frame(12, 1);
    // (the sky's environment is not what these check: its cube camera is not drawn by this stub renderer)
    (v as unknown as { envDirty: boolean }).envDirty = false;
  });

  it('flat shrinks the target to 1x with 2 samples, and off gives back the 2x target', () => {
    draw();
    const big = p.target!;
    expect(big.samples).toBe(2);
    const w2 = big.width, h2 = big.height;
    const release = vi.spyOn(big, 'dispose');
    debugLayer(v,'flat', true);
    draw();
    expect(p.target).not.toBe(big);
    expect(release).toHaveBeenCalled();
    expect(p.target!.width).toBe(w2 / 2);
    expect(p.target!.height).toBe(h2 / 2);
    expect(p.target!.samples).toBe(2);
    debugLayer(v,'flat', false);
    draw();
    expect(p.target!.width).toBe(w2);
    expect(p.target!.height).toBe(h2);
    expect(p.target!.samples).toBe(2);
  });

  it('the flat toggle sets the quad scale, the target size and its samples on the next draw, both ways', () => {
    draw();
    const w2 = p.target!.width, h2 = p.target!.height;
    expect([p.quad.uniforms.ss!.value, p.target!.samples]).toEqual([2, 2]);
    debugLayer(v,'flat', true);
    draw();
    expect([p.quad.uniforms.ss!.value, p.target!.width, p.target!.height, p.target!.samples]).toEqual([1, w2 / 2, h2 / 2, 2]);
    debugLayer(v,'flat', false);
    draw();
    expect([p.quad.uniforms.ss!.value, p.target!.width, p.target!.height, p.target!.samples]).toEqual([2, w2, h2, 2]);
  });
});
