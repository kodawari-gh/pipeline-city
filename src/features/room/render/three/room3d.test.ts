import { expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, Scene, type Light, type LightShadow, type Object3D, type PointLight, type WebGLRenderer } from 'three';
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
