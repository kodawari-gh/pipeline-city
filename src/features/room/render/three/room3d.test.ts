import { expect, it, vi } from 'vitest';
import { BoxGeometry, Matrix4, Mesh, MeshStandardMaterial, Scene, type Light, type LightShadow, type Object3D, type PointLight, type WebGLRenderer } from 'three';
import { framed, meshHash, type Bake } from '@/core/render/three/lightmapmix';
import { partsOf } from '@/core/render/three/merge';
import { ShadowCache } from '@/core/render/three/shadows';
import { BEDSIDE_FAR, BEDSIDE_LAYER, Room3D } from './room3d';
import { FLOOR_Y, NIGHTSTAND } from './roomplan';

type Caster = Light & { shadow: LightShadow };

it('keeps the bedside lantern\'s map to the drawer and the bed with the lamps\' shadows off: only a caster on BEDSIDE_LAYER redraws it', () => {
  const room = new Room3D(), scene = new Scene();
  const bed = (room as unknown as { bedLight: PointLight }).bedLight, lights = (room as unknown as { casters: Caster[] }).casters;
  // a caster under the drawer: in the lantern's range, on no layer of its map
  const near = new Mesh(new BoxGeometry(1000, 1000, 1000));
  near.castShadow = true;
  near.position.set(NIGHTSTAND.x + NIGHTSTAND.w / 2, -FLOOR_Y + 500, NIGHTSTAND.z1 / 2);
  scene.add(room.root, near);
  let drawer: Object3D | undefined;
  room.root.traverse((o) => { if (!drawer && (o as Mesh).isMesh && o.castShadow && o.layers.isEnabled(BEDSIDE_LAYER)) drawer = o; });
  const drawn: Light[] = [];
  const draw = (ls: Caster[]) => { for (const l of ls) if (l.shadow.needsUpdate) { drawn.push(l); l.shadow.needsUpdate = false; } };
  const r = { shadowMap: { render: draw } } as unknown as WebGLRenderer;
  const cache = new ShadowCache(r);
  let now = 0;
  /** A frame, then the next one: the lights whose maps the second one drew. */
  const frames = (): Light[] => {
    for (let i = 0; i < 2; i++) {
      drawn.length = 0;
      r.shadowMap.render(lights.filter((l) => l.castShadow), scene, null as never);
      scene.updateMatrixWorld(true);
      room.redrawShadows(cache.scan(scene, now += 16), now);
    }
    return [...drawn];
  };
  const settle = () => { frames(); now += 5000; frames(); };

  room.setLights(0, false); // Medium: the lamps' shadows off
  bed.intensity = 1;
  expect(bed.castShadow).toBe(true);
  expect(bed.shadow.camera.far).toBe(BEDSIDE_FAR);
  expect(bed.shadow.camera.projectionMatrix.elements[10]).toBeCloseTo(-(BEDSIDE_FAR + 200) / (BEDSIDE_FAR - 200), 6);
  expect(bed.shadow.camera.layers.mask).toBe(1 << BEDSIDE_LAYER);
  expect(drawer).toBeDefined();
  settle();
  near.position.x += 500;
  expect(frames()).not.toContain(bed);
  drawer!.position.x += 50;
  expect(frames()).toContain(bed);

  room.setLights(0, true); // High: the lantern reaches across the room again
  expect(bed.shadow.camera.far).toBe(130000);
  expect(bed.shadow.needsUpdate).toBe(true);
  expect(bed.shadow.camera.layers.mask).toBe(1);
  settle();
  near.position.x += 500;
  expect(frames()).toContain(bed);
}, 60000);

it('casting is false with the shadows off and true at a shadow level', () => {
  const room = new Room3D();
  room.setLights(4, false);
  room.setShadows(0);
  expect(room.casting).toBe(false);
  room.setShadows(1);
  expect(room.casting).toBe(true);
});

it('scanShadows does not scan with no caster, and scans once with one', () => {
  const room = new Room3D(), scene = new Scene();
  let calls = 0;
  const cache = { scan: (_s: Object3D, _now: number) => { calls++; return false; } };
  room.setLights(4, false);
  room.setShadows(0);
  expect(room.scanShadows(cache, scene, 0)).toBe(false);
  expect(calls).toBe(0);
  room.setShadows(1);
  room.scanShadows(cache, scene, 16);
  expect(calls).toBe(1);
});

it('scanShadows asks again while a map is pending, but not when no light casts', () => {
  const room = new Room3D(), scene = new Scene();
  const cache = { scan: () => false, pending: true };
  room.setLights(4, false);
  room.setShadows(0);
  expect(room.scanShadows(cache, scene, 0)).toBe(false);
  room.setShadows(1);
  expect(room.scanShadows(cache, scene, 16)).toBe(true);
});

/** The city's picture in numbers: its meshes, their vertices drawn, and a sum of every position. */
function cityChecksum(room: Room3D): string {
  const view = (room as unknown as { outside: { scene: Scene } }).outside;
  let meshes = 0, vertices = 0, sum = 0;
  view.scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    meshes++;
    vertices += m.geometry.attributes.position?.count ?? 0;
    for (const v of m.geometry.attributes.position?.array ?? []) sum += v;
  });
  return `${meshes}/${vertices}/${sum.toFixed(3)}`;
}
type Swap = { cityDetail?: string; setCityDetail?: (d: 'high' | 'low') => void };

it('the city detail is "high" by default', () => {
  expect((new Room3D() as unknown as Swap).cityDetail).toBe('high');
}, 60000);

it('setCityDetail("low") builds the cut city, and "high" again builds the first city back, the old view disposed', () => {
  const room = new Room3D(), swap = room as unknown as Swap, first = cityChecksum(room);
  const view = (room as unknown as { outside: { dispose(): void } }).outside, dispose = vi.spyOn(view, 'dispose');
  expect(swap.setCityDetail).toBeTypeOf('function');
  swap.setCityDetail!('low');
  expect(swap.cityDetail).toBe('low');
  expect(cityChecksum(room)).not.toBe(first);
  expect(dispose).toHaveBeenCalledTimes(1);
  swap.setCityDetail!('high');
  expect(swap.cityDetail).toBe('high');
  expect(cityChecksum(room)).toBe(first);
}, 180000);

// (d) the second share: the bake gives its meshes a light map and changes their materials, so `takeBake` shares equal materials again (and a
// replaced one leaves the reflections' register).
it('takes the baked bounce and then shares equal materials again, the replaced one out of the reflections', async () => {
  const room = new Room3D();
  await room.ready; // (the first share and the merge are over)
  const priv = room as unknown as { envs: { adopt(o: Object3D): void; mats: Set<unknown> }; takeBake(b: Bake): void };
  // two meshes made after the first share, each with its own material, equal but for their identity
  const make = (x: number) => { const m = new Mesh(new BoxGeometry(900, 900, 900), new MeshStandardMaterial({ color: 0x336699 })); m.position.set(x, 3000, 3000); return m; };
  const a = make(0), b = make(5000);
  room.root.add(a, b);
  priv.envs.adopt(room.root);
  expect(a.material).not.toBe(b.material);
  const dropped = b.material;
  expect(priv.envs.mats.has(dropped)).toBe(true);
  room.root.updateMatrixWorld(true);
  const toRoot = room.root.matrixWorld.clone().invert();
  const hashOf = (m: Mesh) => meshHash(framed(m.geometry, new Matrix4().multiplyMatrices(toRoot, m.matrixWorld)), m.geometry.index?.array ?? null);
  const corners = a.geometry.index!.count;
  const bake: Bake = {
    manifest: {
      version: 1, encoding: 'rgbm-sqrt', width: 64, height: 64, texelsPerMetre: 50, samples: 1, groups: [], dark: [],
      meshes: [{ name: 'a', hash: hashOf(a), corners, offset: 0 }, { name: 'b', hash: hashOf(b), corners, offset: corners }],
    },
    maps: new Map(), uvs: new Uint16Array(4 * corners),
  };
  priv.takeBake(bake);
  // both took the light map, and the two equal materials are one again
  expect(a.geometry.attributes.uv1).toBeDefined();
  expect(b.geometry.attributes.uv1).toBeDefined();
  expect(b.material).toBe(a.material);
  expect((a.material as MeshStandardMaterial).lightMap).not.toBeNull();
  expect(priv.envs.mats.has(dropped)).toBe(false);
  expect(priv.envs.mats.has(a.material)).toBe(true);
});

// (a) lock: `frame` shows and hides parts by the game's state (a router, a monitor). The palette merge after the bake must not take any mesh whose
// shown state the game changes: a merged copy would stay drawn. The test finds those meshes by running the frame in both states, not by name.
it('the palette merge leaves every mesh the game shows and hides alone (checked from what a frame changes)', async () => {
  const room = new Room3D();
  const frame = (installed: boolean, router: number) => room.frame({ hour: 12, lamp: false, blind: false, screen: { installed, powered: installed, live: false, text: '' }, router, isp: 0, ispName: '', mail: false, t: 1 }, 0.016);
  /** The meshes a camera would draw: shown, and every parent shown. */
  const drawn = () => { const s = new Set<Object3D>(); const walk = (o: Object3D) => { if (!o.visible) return; if ((o as Mesh).isMesh) s.add(o); o.children.forEach(walk); }; walk(room.root); return s; };
  frame(true, 1);
  const on = drawn();
  frame(false, 0);
  const off = drawn();
  const flips = [...on].filter((o) => !off.has(o));
  expect(flips.length).toBeGreaterThan(1); // (the router and the monitor)
  frame(true, 1);
  await room.ready;
  const merged = new Set<Object3D>();
  room.root.traverse((o) => { for (const p of partsOf(o)) merged.add(p.mesh); });
  expect(merged.size).toBeGreaterThan(0); // (the merge ran)
  expect(flips.filter((o) => merged.has(o))).toEqual([]);
  // and nothing the merge made stands drawn once the game hides them
  frame(false, 0);
  expect(flips.filter((o) => drawn().has(o))).toEqual([]);
});
