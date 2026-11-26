import {
  DirectionalLight,
  Frustum,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
} from 'three';
import type * as threeTypes from 'three';
import { assert, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { debugLayer, debugStats } from '@/app/debug/city-layers';
import { CITY_CUTS, LOW_EVERY, parseCityCuts } from './detail';
import { GRID } from './plan';
import { Fleet } from './cars';
import { Sweep, drawn } from './sweep';
import { Traffic } from './traffic';
import { OutsideView } from './view';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The value down a path of fields under `o`, each read as it stands (unknown until checked): the view keeps these to itself, and the
 * tests look in as the `?debug` layers do. */
function dig(o: unknown, ...path: string[]): unknown {
  let at = o;
  for (const k of path) {
    assert(typeof at === 'object' && at !== null, `no ${path.join('.')}`);
    const fields = new Map<string, unknown>(Object.entries(at));
    assert(fields.has(k), `no ${path.join('.')}`);
    at = fields.get(k);
  }
  return at;
}

/** A number read with `dig`, checked. */
function num(x: unknown): number {
  assert(typeof x === 'number', 'not a number');
  return x;
}

/** The view's picture quad material. */
function quadOf(v: OutsideView): threeTypes.ShaderMaterial {
  const quad = dig(v, 'quad');
  assert.instanceOf(quad, ShaderMaterial);
  return quad;
}

/** The value of the picture quad's uniform `k`. */
function uniformOf(v: OutsideView, k: string): unknown {
  const u = must(quadOf(v).uniforms[k]);
  const value: unknown = u.value;
  return value;
}

/** The target the view draws its picture into (none before the first draw). */
function targetOf(v: OutsideView): threeTypes.WebGLRenderTarget | null {
  const target = dig(v, 'target');
  assert(target === null || target instanceof WebGLRenderTarget, 'the target is not a render target');
  return target;
}

/** The kit's materials that glow at night. */
function nightMats(v: OutsideView): threeTypes.MeshStandardMaterial[] {
  const night = dig(v, 'kit', 'night');
  assert(Array.isArray(night), 'the kit has no night list');
  const entries: unknown[] = night;
  return entries.map((n) => {
    const mat = dig(n, 'mat');
    assert.instanceOf(mat, MeshStandardMaterial);
    return mat;
  });
}

/** The view's own materials (outside the kit). */
function disposablesOf(v: OutsideView): threeTypes.Material[] {
  const ms = dig(v, 'disposables');
  assert(Array.isArray(ms), 'the view has no disposables');
  const list: unknown[] = ms;
  return list.filter((m): m is threeTypes.Material => m instanceof Material);
}

/** The sweeps that cut the city to a view. */
function sweepsOf(v: OutsideView): Sweep[] {
  const ss = dig(v, 'sweeps');
  assert(Array.isArray(ss), 'the view has no sweeps');
  const list: unknown[] = ss;
  return list.filter((x) => x instanceof Sweep);
}

/** A stand-in renderer with the calls the view makes (a stub: there is no WebGL here). */
const isRenderer = (x: unknown): x is threeTypes.WebGLRenderer =>
  typeof x === 'object' && x !== null && 'render' in x && 'setRenderTarget' in x && 'getContext' in x;

/** The quad mesh's one material. */
function materialOf(m: threeTypes.Mesh): threeTypes.Material {
  const mat = m.material;
  assert.instanceOf(mat, Material);
  return mat;
}

/** Whether the object is a mesh. */
const isMesh = (o: threeTypes.Object3D): o is threeTypes.Mesh => o instanceof Mesh;

/** Leaves the sky's environment alone: its cube camera is not drawn by the stub renderers. */
const keepEnv = (v: OutsideView) => Object.assign(v, { envDirty: false });

/** Adds `f` to the listeners kept for `k`. */
function listen(on: Map<string, Set<unknown>>, k: string, f: unknown): void {
  const set = on.get(k) ?? new Set<unknown>();
  on.set(k, set);
  set.add(f);
}

/** A Low view with these citycuts. */
const lowView = (cuts: string) => new OutsideView(0, 0, 10, 10, 0, 'low', parseCityCuts(`?citycuts=${cuts}`, 'low'));

/** A High view with these citycuts. */
const highView = (cuts: string) => new OutsideView(0, 0, 10, 10, 0, 'high', parseCityCuts(`?citycuts=${cuts}`, 'high'));

/** The cuts that may never draw more than the uncut city (`streets` and `palette` trade triangles for draws). */
const neverMore = (c: string) => c !== 'streets' && c !== 'palette';

/** The kinds of the city's materials, in order (none for a mesh over several). */
function kinds(v: OutsideView): (string | undefined)[] {
  return everyMesh(v)
    .map((m) => (Array.isArray(m.material) ? undefined : m.material.type))
    .toSorted((a, b) => (a ?? '').localeCompare(b ?? ''));
}

/** The lit suns in the scene, and the meshes on the view's facade material. */
function sunsAndFacade(v: OutsideView): { sun: number; facade: number } {
  const [facadeMat] = disposablesOf(v);
  let sun = 0,
    facade = 0;
  v.scene.traverse((o) => {
    if (o instanceof DirectionalLight && o.intensity > 0) {
      sun++;
    }
    if (isMesh(o) && o.material === facadeMat) {
      facade++;
    }
  });
  return { sun, facade };
}

/** Whether a mesh of the city draws the cheap sky (a shader with the noise texture). */
function noiseSky(v: OutsideView): boolean {
  return everyMesh(v).some((m) => m.material instanceof ShaderMaterial && 'tNoise' in m.material.uniforms);
}

/** A boot's turns: each noted in `events` and yielding to the event loop; on the second, `release` (the textures come in). */
function turnsFor(events: string[], release: () => void): { turn: () => Promise<void>; count: () => number } {
  let turns = 0;
  return {
    turn: async () => {
      events.push('turn');
      if (++turns === 2) {
        release();
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    },
    count: () => turns,
  };
}

describe('debugLayer and debugStats (city-layers.ts)', () => {
  let v: OutsideView;
  beforeAll(() => {
    v = new OutsideView(0, 0, 1, 1, 0);
  }, 180_000);

  it('has stats of what it draws, and every layer back on leaves them as they were', () => {
    const all = debugStats(v);
    expect(all.tris).toBeGreaterThan(1000);
    expect(all.calls).toBeGreaterThan(5);
    for (const k of [
      'lights',
      'buildings',
      'trees',
      'streets',
      'freeze',
      'cars',
      'sky',
      'glow',
      'steam',
      'mirror',
      'flat',
    ]) {
      debugLayer(v, k, true);
      debugLayer(v, k, false);
    }
    expect(debugStats(v)).toStrictEqual(all);
  });

  it('buildings, trees, streets, cars, steam and sky take their triangles out, each one its own', () => {
    const all = debugStats(v);
    for (const k of ['buildings', 'trees', 'streets', 'cars', 'steam', 'sky']) {
      debugLayer(v, k, true);
      const less = debugStats(v);
      expect(less.tris, `layer ${k}`).toBeLessThan(all.tris);
      expect(less.calls, `layer ${k}`).toBeLessThan(all.calls);
      debugLayer(v, k, false);
      expect(debugStats(v), `layer ${k}`).toStrictEqual(all);
    }
    debugLayer(v, 'buildings', true);
    const noBuildings = debugStats(v).tris;
    expect(noBuildings).toBeLessThan(all.tris * 0.9);
    debugLayer(v, 'buildings', false);
  });

  it('lights puts the lamps and the emissives at 0 at night, and on again gives them back', () => {
    v.frame(23, 1);
    const lit = nightMats(v).map((m) => m.emissiveIntensity);
    expect(lit.every((x) => x > 0)).toBe(true);
    expect(v.lamps.every((l) => l.visible)).toBe(true);
    debugLayer(v, 'lights', true);
    v.frame(23, 1);
    expect(nightMats(v).every((m) => m.emissiveIntensity === 0)).toBe(true);
    expect(v.lamps.every((l) => !l.visible)).toBe(true);
    expect(num(dig(v, 'facade', 'night', 'value'))).toBe(0);
    // the signs' layer: every node of each sign off (HIDDEN_LAYER = 30), then back on (layer 0)
    const signMasks = (): number[] =>
      must(v.parts['signs']).flatMap((s) => {
        const m: number[] = [];
        s.traverse((o) => {
          m.push(o.layers.mask);
        });
        return m;
      });
    expect(signMasks().length).toBeGreaterThan(0);
    expect(signMasks().every((m) => m === 2 ** 30)).toBe(true);
    debugLayer(v, 'lights', false);
    v.frame(23, 1);
    expect(nightMats(v).map((m) => m.emissiveIntensity)).toStrictEqual(lit);
    expect(v.lamps.every((l) => l.visible)).toBe(true);
    expect(num(dig(v, 'facade', 'night', 'value'))).toBeGreaterThan(0);
    expect(signMasks().every((m) => m === 1)).toBe(true);
  });

  it('glow and mirror go to 0 at night, and on again give them back', () => {
    v.frame(23, 1);
    const glow = num(uniformOf(v, 'glowK')),
      mirror = num(dig(v, 'mirrorAt'));
    expect(glow).toBeGreaterThan(0);
    expect(mirror).toBeGreaterThan(0);
    debugLayer(v, 'glow', true);
    debugLayer(v, 'mirror', true);
    v.frame(23, 1);
    expect(uniformOf(v, 'glowK')).toBe(0);
    expect(num(dig(v, 'mirrorAt'))).toBe(0);
    debugLayer(v, 'glow', false);
    debugLayer(v, 'mirror', false);
    v.frame(23, 1);
    expect(uniformOf(v, 'glowK')).toBe(glow);
    expect(num(dig(v, 'mirrorAt'))).toBe(mirror);
  });

  it('freeze keeps the clock where it was, and on again lets it run', () => {
    v.frame(12, 10);
    debugLayer(v, 'freeze', true);
    v.frame(12, 50);
    expect(num(dig(v, 'clock'))).toBe(10);
    debugLayer(v, 'freeze', false);
    v.frame(12, 60);
    expect(num(dig(v, 'clock'))).toBe(60);
  });
});

// City 1x (`flat`): the picture's target follows the toggle, both ways, in size and samples
describe('OutsideView.draw, flat (City 1x)', () => {
  let v: OutsideView, room: Scene, cam: PerspectiveCamera, renderer: threeTypes.WebGLRenderer;
  const draw = () => {
    v.draw(renderer, room, cam, 4);
  };
  beforeEach(() => {
    v = new OutsideView(0, 0, 2, 2, 0);
    room = new Scene();
    room.add(v.mesh);
    cam = new PerspectiveCamera(50, 1, 0.1, 20_000);
    cam.position.set(0, 0, 3);
    const gl = {
      createQuery: () => ({}),
      beginQuery: vi.fn<() => void>(),
      endQuery: vi.fn<() => void>(),
      getQueryParameter: () => true,
      ANY_SAMPLES_PASSED_CONSERVATIVE: 0x8d_6a,
      QUERY_RESULT: 0x88_66,
      QUERY_RESULT_AVAILABLE: 0x88_67,
    };
    const stub = {
      domElement: { addEventListener: vi.fn<() => void>(), removeEventListener: vi.fn<() => void>() },
      getDrawingBufferSize: (s: threeTypes.Vector2) => s.set(400, 300),
      getContext: () => gl,
      getRenderTarget: () => null,
      setRenderTarget: vi.fn<() => void>(),
      clear: vi.fn<() => void>(),
      render: vi.fn<() => void>(),
    };
    assert(isRenderer(stub));
    renderer = stub;
    v.frame(12, 1);
    // (the sky's environment is not what these check: its cube camera is not drawn by this stub renderer)
    keepEnv(v);
  }, 180_000);

  it('flat shrinks the target to 1x with 2 samples, and off gives back the 2x target', () => {
    draw();
    const big = targetOf(v);
    assert.exists(big);
    expect(big.samples).toBe(2);
    const w2 = big.width,
      h2 = big.height;
    const release = vi.spyOn(big, 'dispose');
    debugLayer(v, 'flat', true);
    draw();
    const small = targetOf(v);
    expect(small).not.toBe(big);
    expect(release).toHaveBeenCalledWith();
    assert.exists(small);
    expect(small.width).toBe(w2 / 2);
    expect(small.height).toBe(h2 / 2);
    expect(small.samples).toBe(2);
    debugLayer(v, 'flat', false);
    draw();
    const back = targetOf(v);
    assert.exists(back);
    expect(back.width).toBe(w2);
    expect(back.height).toBe(h2);
    expect(back.samples).toBe(2);
  });

  it('the flat toggle sets the quad scale, the target size and its samples on the next draw, both ways', () => {
    draw();
    const first = targetOf(v);
    assert.exists(first);
    const w2 = first.width,
      h2 = first.height;
    expect([uniformOf(v, 'ss'), first.samples]).toStrictEqual([2, 2]);
    debugLayer(v, 'flat', true);
    draw();
    const flat = targetOf(v);
    assert.exists(flat);
    expect([uniformOf(v, 'ss'), flat.width, flat.height, flat.samples]).toStrictEqual([1, w2 / 2, h2 / 2, 2]);
    debugLayer(v, 'flat', false);
    draw();
    const sharp = targetOf(v);
    assert.exists(sharp);
    expect([uniformOf(v, 'ss'), sharp.width, sharp.height, sharp.samples]).toStrictEqual([2, w2, h2, 2]);
  });
});

const meshes = (v: OutsideView): number => {
  let n = 0;
  v.scene.traverse((o) => {
    if (isMesh(o)) {
      n++;
    }
  });
  return n;
};
/** The ticks `frame` needs before the picture is due. */
function ticks(v: OutsideView): number {
  for (let n = 1; n <= 20; n++) {
    v.frame(12, n);
    if (v.due) {
      return n;
    }
  }
  return Infinity;
}

function everyMesh(v: OutsideView): threeTypes.Mesh[] {
  const out: threeTypes.Mesh[] = [];
  v.scene.traverse((o) => {
    if (isMesh(o)) {
      out.push(o);
    }
  });
  return out;
}
/** Mesh count, the indices drawn in all, and a checksum of every position. */
function fingerprint(v: OutsideView): { meshes: number; drawn: number; sum: number } {
  let drawnN = 0,
    sum = 0;
  const ms = everyMesh(v);
  for (const m of ms) {
    drawnN += drawn(m.geometry);
    assert.exists(m.geometry.attributes['position']);
    const p = m.geometry.attributes['position'].array;
    for (let i = 0; i < p.length; i++) {
      sum += (p[i] ?? 0) * ((i % 7) + 1);
    }
  }
  return { meshes: ms.length, drawn: drawnN, sum: Math.round(sum) };
}
/** The triangles the city draws for a camera at the window looking out (down the avenue), after the sweeps cut to its view. */
function viewTriangles(v: OutsideView, fov: number): number {
  const cam = new PerspectiveCamera(fov, 16 / 9, 1, 20_000);
  cam.position.set(GRID.av0, 100, 0);
  cam.lookAt(GRID.av0, 100, -1000);
  cam.updateMatrixWorld(true);
  const seen = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
  );
  for (const s of sweepsOf(v)) {
    s.cut(seen);
  }
  let n = 0;
  for (const m of everyMesh(v)) {
    if (!m.visible) {
      continue;
    }
    const g = m.geometry,
      r = g.drawRange,
      total = drawn(g),
      c = Math.min(r.count, total - r.start);
    n += (c / 3) * (m instanceof InstancedMesh ? m.count : 1);
  }
  return Math.round(n);
}

describe('OutsideView detail', () => {
  let high: OutsideView, low: OutsideView, plain: OutsideView;
  beforeAll(() => {
    plain = new OutsideView(0, 0, 10, 10, 0);
    high = new OutsideView(0, 0, 10, 10, 0, 'high');
    low = new OutsideView(0, 0, 10, 10, 0, 'low');
  }, 180_000);

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
    expect(fingerprint(high)).toStrictEqual(base);
    expect(fingerprint(highView('none'))).toStrictEqual(base);
    expect(fingerprint(highView('far,palette,fleet,steam'))).toStrictEqual(base);
    expect(base.meshes).toBeGreaterThan(14);
  }, 180_000);

  it('Low zoom: no cut draws more triangles than the uncut city, for the same view', () => {
    const none = lowView('none');
    for (const fov of [20, 45, 70]) {
      const base = viewTriangles(none, fov);
      expect(base).toBeGreaterThan(0);
      expect(viewTriangles(low, fov)).toBeLessThanOrEqual(base);
      // (`streets` and `palette` trade triangles for draws: wide cells, and one mesh over materials of unlike reach, cut the view more coarsely;
      // alone they may draw more, the sum of all cuts may not. The other cuts may never draw more: a merged ring that mixes near and far
      // pieces draws every near piece in the far pieces' wide band, so rings of unlike reach stay apart.)
      for (const cut of CITY_CUTS.filter((c) => neverMore(c))) {
        expect(viewTriangles(lowView(cut), fov), `${cut} at ${fov}`).toBeLessThanOrEqual(base);
      }
    }
  }, 600_000);

  it("Low with no cut (citycuts=none) draws High's materials; the facade cut alone is the Lambert one", () => {
    const uncut = lowView('none');
    expect(kinds(uncut)).toStrictEqual(kinds(high));
    expect(kinds(lowView('facade'))).toContain('MeshLambertMaterial');
    expect(kinds(uncut)).not.toContain('MeshLambertMaterial');
  }, 180_000);

  it('Low: a sun that lights at noon, and the buildings on the facade material', () => {
    low.frame(12, 1);
    const { sun, facade } = sunsAndFacade(low);
    expect(sun).toBeGreaterThan(0);
    expect(facade).toBeGreaterThan(0);
    // (the cut is real: fewer meshes than High)
    expect(meshes(low)).toBeLessThan(meshes(high));
  });

  it('Low: the sky is the cheap shader (with the noise texture), High and the uncut city keep the full one', () => {
    expect(noiseSky(low)).toBe(true);
    expect(noiseSky(high)).toBe(false);
    expect(noiseSky(lowView('none'))).toBe(false);
  }, 300_000);

  it('Low: the streets cut draws fewer meshes, and the furniture cut fewer triangles, than the uncut city', () => {
    // (`streets` trades triangles for draws: its wide cells add triangles, so it is checked by mesh count. `furniture` keeps every mesh,
    // so it is checked by triangles.)
    const none = lowView('none');
    const streets = lowView('streets');
    const furniture = lowView('furniture');
    expect(meshes(streets)).toBeLessThan(meshes(none));
    expect(viewTriangles(furniture, 45)).toBeLessThan(viewTriangles(none, 45));
  }, 300_000);
});

describe('OutsideView ambient motion', () => {
  let high: OutsideView, low: OutsideView;
  beforeAll(() => {
    high = new OutsideView(0, 0, 10, 10, 0, 'high');
    low = new OutsideView(0, 0, 10, 10, 0, 'low');
  }, 180_000);

  it('High: the steam and the leaves advance with the clock', () => {
    high.frame(12, 1);
    expect([num(dig(high, 'leaf', 'time', 'value')), num(dig(high, 'steam', 'time', 'value'))]).toStrictEqual([1, 1]);
    high.frame(12, 2.5);
    expect([num(dig(high, 'leaf', 'time', 'value')), num(dig(high, 'steam', 'time', 'value'))]).toStrictEqual([
      2.5, 2.5,
    ]);
  });

  it('Low: the steam and the leaves do not advance with the clock', () => {
    low.frame(12, 1);
    const a = [num(dig(low, 'leaf', 'time', 'value')), num(dig(low, 'steam', 'time', 'value'))];
    low.frame(12, 2.5);
    low.frame(12, 40);
    expect([num(dig(low, 'leaf', 'time', 'value')), num(dig(low, 'steam', 'time', 'value'))]).toStrictEqual(a);
    expect(a[0]).toBe(a[1]);
  });

  it('Low: the sky, the facade beacons and the haze keep the clock', () => {
    low.frame(12, 7);
    const sky = dig(low, 'sky');
    assert.instanceOf(sky, ShaderMaterial);
    expect(must(sky.uniforms['time']).value).toBe(7);
    expect(num(dig(low, 'facade', 'time', 'value'))).toBe(7);
    expect(num(dig(low, 'haze', 'hzTime', 'value'))).toBe(7);
  });

  it('Low: the traffic (and so the signals) still runs on each frame', () => {
    const traffic = dig(low, 'traffic'),
      fleet = dig(low, 'fleet');
    assert.instanceOf(traffic, Traffic);
    assert.instanceOf(fleet, Fleet);
    const t0 = traffic.t;
    fleet.update(1, 0, 0);
    expect(traffic.t).toBeGreaterThan(t0);
  });
});

describe('OutsideView.make (the boot builds the city a step at a time)', () => {
  it('names each step in order, and builds the city that `new` builds', async () => {
    const steps: { label: string; share: number }[] = [];
    const whole = new OutsideView(0, 0, 10, 10, 0, 'high');
    const stepped = await OutsideView.make(0, 0, 10, 10, 0, 'high', async (label, share) => {
      steps.push({ label, share });
      await Promise.resolve();
    });
    expect(steps.map((s) => s.label)).toStrictEqual([
      'Laying the streets',
      'Merging the streets',
      'Raising the towers',
      'Planting the trees',
      'Painting the sky',
    ]);
    expect(steps.map((s) => s.share)).toStrictEqual(steps.map((s) => s.share).toSorted((a, b) => a - b));
    assert.exists(steps[0]);
    expect(steps[0].share).toBe(0);
    expect(steps.every((s) => s.share < 1)).toBe(true);
    expect(debugStats(stepped)).toStrictEqual(debugStats(whole));
  }, 180_000);

  // BOOT-05: the buildings need no texture, so the boot builds them while the baked textures load, and the first step waits for the textures
  it('with `early`: builds the buildings in turns while `until` is pending, waits for it before the first step, and builds the same city', async () => {
    const events: string[] = [],
      whole = new OutsideView(0, 0, 10, 10, 0, 'high');
    const textures: PromiseWithResolvers<void> = Promise.withResolvers(),
      until = textures.promise;
    const release = () => {
      events.push('until');
      textures.resolve();
    };
    const timer = setTimeout(release, 20_000);
    const { turn, count } = turnsFor(events, release);
    const early = await OutsideView.make(
      0,
      0,
      10,
      10,
      0,
      'high',
      async (label) => {
        events.push(label);
        await Promise.resolve();
      },
      { until, turn },
    );
    clearTimeout(timer);
    const turns = count();
    const first = events.indexOf('Laying the streets');
    expect(events.indexOf('turn')).toBe(0);
    expect(events.indexOf('until'), 'the textures in before the first step').toBeLessThan(first);
    expect(
      events.slice(0, first).filter((e) => e === 'turn'),
      'the turns before the first step',
    ).toHaveLength(turns);
    expect(turns).toBeGreaterThanOrEqual(2);
    expect(events.slice(first)).toStrictEqual([
      'Laying the streets',
      'Merging the streets',
      'Raising the towers',
      'Planting the trees',
      'Painting the sky',
    ]);
    expect(debugStats(early)).toStrictEqual(debugStats(whole));
  }, 180_000);
});

// the main canvas outlives the view: a handler left on it keeps the whole view (its city and its textures) alive after a preset change
describe('OutsideView.dispose (the canvas it watched)', () => {
  it('takes its context-loss handlers off the canvas, and frees the query', () => {
    const v = new OutsideView(0, 0, 2, 2, 0, 'low');
    const room = new Scene();
    room.add(v.mesh);
    const cam = new PerspectiveCamera(50, 1, 0.1, 20_000);
    cam.position.set(0, 0, 3);
    const on = new Map<string, Set<unknown>>(),
      query = {},
      deleted: unknown[] = [];
    const gl = {
      createQuery: () => query,
      deleteQuery: (q: unknown) => deleted.push(q),
      beginQuery: vi.fn<() => void>(),
      endQuery: vi.fn<() => void>(),
      getQueryParameter: () => true,
      ANY_SAMPLES_PASSED_CONSERVATIVE: 0x8d_6a,
      QUERY_RESULT: 0x88_66,
      QUERY_RESULT_AVAILABLE: 0x88_67,
    };
    const canvas = {
      addEventListener: (k: string, f: unknown) => {
        listen(on, k, f);
      },
      removeEventListener: (k: string, f: unknown) => {
        on.get(k)?.delete(f);
      },
    };
    const renderer = {
      domElement: canvas,
      getDrawingBufferSize: (s: threeTypes.Vector2) => s.set(400, 300),
      getContext: () => gl,
      getRenderTarget: () => null,
      setRenderTarget: vi.fn<() => void>(),
      clear: vi.fn<() => void>(),
      render: vi.fn<() => void>(),
    };
    assert(isRenderer(renderer));
    v.frame(12, 1);
    keepEnv(v);
    v.draw(renderer, room, cam, 4);
    // the quad's draw asks the query: its two hooks
    const quad = materialOf(v.mesh),
      group = new Group();
    v.mesh.onBeforeRender(renderer, room, cam, v.mesh.geometry, quad, group);
    v.mesh.onAfterRender(renderer, room, cam, v.mesh.geometry, quad, group);
    expect([...on.values()].map((s) => s.size)).toStrictEqual([1, 1]);
    // drawing again on the same canvas adds nothing
    v.draw(renderer, room, cam, 4);
    expect([...on.values()].map((s) => s.size)).toStrictEqual([1, 1]);
    v.dispose();
    expect([...on.values()].map((s) => s.size)).toStrictEqual([0, 0]);
    expect(deleted).toStrictEqual([query]);
  }, 180_000);
});
