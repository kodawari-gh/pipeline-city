import { DirectionalLight, Frustum, Matrix4, PerspectiveCamera, Scene, Vector2, WebGLRenderTarget, type InstancedMesh, type Material, type Mesh, type MeshStandardMaterial, type PointLight, type ShaderMaterial, type WebGLRenderer } from 'three';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { debugLayer, debugStats } from '@/app/debug/city-layers';
import { CITY_CUTS, LOW_EVERY, parseCityCuts, type CityCuts, type CityDetail } from './detail';
import { GRID } from './plan';
import { drawn, type Sweep } from './sweep';
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
  beforeAll(() => { v = new OutsideView(0, 0, 1, 1, 0); p = v as unknown as Peek; }, 180000);

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
  }, 180000);

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

const Detailed = OutsideView as unknown as new (cx: number, cy: number, w: number, h: number, z: number, detail?: CityDetail, cuts?: CityCuts) => OutsideView;
const inner = (v: OutsideView): { scene: Scene; disposables: Material[] } => v as unknown as { scene: Scene; disposables: Material[] };
const meshes = (v: OutsideView): number => { let n = 0; inner(v).scene.traverse((o) => { if ((o as Mesh).isMesh) n++; }); return n; };
/** The ticks `frame` needs before the picture is due. */
function ticks(v: OutsideView): number {
  for (let n = 1; n <= 20; n++) { v.frame(12, n); if (v.due) return n; }
  return Infinity;
}

const everyMesh = (v: OutsideView): Mesh[] => { const out: Mesh[] = []; inner(v).scene.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); }); return out; };
/** Mesh count, the indices drawn in all, and a checksum of every position. */
function fingerprint(v: OutsideView): { meshes: number; drawn: number; sum: number } {
  let drawnN = 0, sum = 0;
  const ms = everyMesh(v);
  for (const m of ms) {
    drawnN += drawn(m.geometry);
    const p = m.geometry.attributes.position!.array;
    for (let i = 0; i < p.length; i++) sum += p[i]! * ((i % 7) + 1);
  }
  return { meshes: ms.length, drawn: drawnN, sum: Math.round(sum) };
}
/** The triangles the city draws for a camera at the window looking out (down the avenue), after the sweeps cut to its view. */
function viewTriangles(v: OutsideView, fov: number): number {
  const cam = new PerspectiveCamera(fov, 16 / 9, 1, 20000);
  cam.position.set(GRID.av0, 100, 0);
  cam.lookAt(GRID.av0, 100, -1000);
  cam.updateMatrixWorld(true);
  const seen = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  for (const s of (v as unknown as { sweeps: Sweep[] }).sweeps) s.cut(seen);
  let n = 0;
  for (const m of everyMesh(v)) {
    if (!m.visible) continue;
    const g = m.geometry, r = g.drawRange, total = drawn(g), c = Math.min(r.count, total - r.start);
    n += (c / 3) * ((m as InstancedMesh).isInstancedMesh ? (m as InstancedMesh).count : 1);
  }
  return Math.round(n);
}

describe('OutsideView detail', () => {
  let high: OutsideView, low: OutsideView, plain: OutsideView;
  beforeAll(() => {
    plain = new OutsideView(0, 0, 10, 10, 0);
    high = new Detailed(0, 0, 10, 10, 0, 'high');
    low = new Detailed(0, 0, 10, 10, 0, 'low');
  }, 180000);

  it('lock: High draws on frame 3, with the detail omitted or "high"', () => {
    expect(ticks(plain)).toBe(3);
    expect(ticks(high)).toBe(3);
    expect(meshes(high)).toBe(meshes(plain));
  });

  it('Low: draws on frame LOW_EVERY, not on frame 3', () => {
    expect(ticks(low)).toBe(LOW_EVERY);
  });

  it('Low: the scene has at most 18 meshes', () => {
    // (18: the Low fleet keeps the far car box past 100 m, one mesh more than the old 17-mesh lock)
    expect(meshes(low)).toBeLessThanOrEqual(18);
  });

  it('lock: a High city is the same with the detail omitted, "high" or any citycuts', () => {
    const base = fingerprint(plain);
    expect(fingerprint(high)).toEqual(base);
    expect(fingerprint(new Detailed(0, 0, 10, 10, 0, 'high', parseCityCuts('?citycuts=none', 'high')))).toEqual(base);
    expect(fingerprint(new Detailed(0, 0, 10, 10, 0, 'high', parseCityCuts('?citycuts=far,palette,fleet,steam', 'high')))).toEqual(base);
    expect(base.meshes).toBeGreaterThan(14);
  }, 180000);

  it('Low zoom: no cut draws more triangles than the uncut city, for the same view', () => {
    const none = new Detailed(0, 0, 10, 10, 0, 'low', parseCityCuts('?citycuts=none', 'low'));
    for (const fov of [20, 45, 70]) {
      const base = viewTriangles(none, fov);
      expect(base).toBeGreaterThan(0);
      expect(viewTriangles(low, fov)).toBeLessThanOrEqual(base);
      // (`streets` and `palette` trade triangles for draws: wide cells, and one mesh over materials of unlike reach, cut the view more coarsely;
      // alone they may draw more, the sum of all cuts may not. The other cuts may never draw more: a merged ring that mixes near and far
      // pieces draws every near piece in the far pieces' wide band, so rings of unlike reach stay apart.)
      for (const cut of CITY_CUTS.filter((c) => c !== 'streets' && c !== 'palette')) expect(viewTriangles(new Detailed(0, 0, 10, 10, 0, 'low', parseCityCuts(`?citycuts=${cut}`, 'low')), fov), `${cut} at ${fov}`).toBeLessThanOrEqual(base);
    }
  }, 600000);

  it("Low with no cut (Firefox, no citycuts) draws High's materials; the facade cut alone is the Lambert one", () => {
    const kinds = (v: OutsideView): string[] => everyMesh(v).map((m) => (m.material as Material).type).sort();
    const uncut = new Detailed(0, 0, 10, 10, 0, "low", parseCityCuts("", "low", true));
    expect(kinds(uncut)).toEqual(kinds(high));
    expect(kinds(new Detailed(0, 0, 10, 10, 0, "low", parseCityCuts("?citycuts=facade", "low")))).toContain("MeshLambertMaterial");
    expect(kinds(uncut)).not.toContain("MeshLambertMaterial");
  }, 180000);

  it('Low: a sun that lights at noon, and the buildings on the facade material', () => {
    low.frame(12, 1);
    const { scene, disposables } = inner(low);
    let sun = 0, facade = 0;
    scene.traverse((o) => {
      if ((o as DirectionalLight).isDirectionalLight && (o as DirectionalLight).intensity > 0) sun++;
      if ((o as Mesh).isMesh && (o as Mesh).material === disposables[0]) facade++;
    });
    expect(sun).toBeGreaterThan(0);
    expect(facade).toBeGreaterThan(0);
    // (the cut is real: fewer meshes than High)
    expect(meshes(low)).toBeLessThan(meshes(high));
  });
});

describe('OutsideView ambient motion', () => {
  type Clocked = {
    leaf: { time: { value: number } }; steam: { time: { value: number } }; facade: { time: { value: number } };
    haze: { hzTime: { value: number } }; sky: { uniforms: { time: { value: number } } }; traffic: { t: number };
    fleet: { update(dt: number, ex: number, ez: number): void };
  };
  const clocks = (v: OutsideView): Clocked => v as unknown as Clocked;
  let high: OutsideView, low: OutsideView;
  beforeAll(() => {
    high = new Detailed(0, 0, 10, 10, 0, 'high');
    low = new Detailed(0, 0, 10, 10, 0, 'low');
  }, 180000);

  it('High: the steam and the leaves advance with the clock', () => {
    high.frame(12, 1);
    expect([clocks(high).leaf.time.value, clocks(high).steam.time.value]).toEqual([1, 1]);
    high.frame(12, 2.5);
    expect([clocks(high).leaf.time.value, clocks(high).steam.time.value]).toEqual([2.5, 2.5]);
  });

  it('Low: the steam and the leaves do not advance with the clock', () => {
    low.frame(12, 1);
    const a = [clocks(low).leaf.time.value, clocks(low).steam.time.value];
    low.frame(12, 2.5);
    low.frame(12, 40);
    expect([clocks(low).leaf.time.value, clocks(low).steam.time.value]).toEqual(a);
    expect(a[0]).toBe(a[1]);
  });

  it('Low: the sky, the facade beacons and the haze keep the clock', () => {
    low.frame(12, 7);
    const c = clocks(low);
    expect(c.sky.uniforms.time.value).toBe(7);
    expect(c.facade.time.value).toBe(7);
    expect(c.haze.hzTime.value).toBe(7);
  });

  it('Low: the traffic (and so the signals) still runs on each frame', () => {
    const c = clocks(low), t0 = c.traffic.t;
    c.fleet.update(1, 0, 0);
    expect(c.traffic.t).toBeGreaterThan(t0);
  });
});
