import { DirectionalLight, Frustum, Matrix4, PerspectiveCamera, type InstancedMesh, type Material, type Mesh, type Scene } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CITY_CUTS, LOW_EVERY, parseCityCuts, type CityCuts, type CityDetail } from './detail';
import { GRID } from './plan';
import { drawn, type Sweep } from './sweep';
import { OutsideView } from './view';

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

  it('Low: the scene has at most 17 meshes', () => {
    expect(meshes(low)).toBeLessThanOrEqual(17);
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
  }, 300000);

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
