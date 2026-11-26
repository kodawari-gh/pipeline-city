import { assert, expect, test, vi } from 'vitest';
import { BoxGeometry, Color, LightShadow, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene } from 'three';
import type * as threeTypes from 'three';
import { framed, meshHash } from '@/core/render/three/lightmapmix';
import type * as lightmapmixTypes from '@/core/render/three/lightmapmix';
import { partsOf } from '@/core/render/three/merge';
import { ShadowCache } from '@/core/render/three/shadows';
import { DARK, JACK_GLOW } from '@/features/network/render/jackleds';
import type * as jackledsTypes from '@/features/network/render/jackleds';
import { BEDSIDE_FAR, BEDSIDE_LAYER, Room3D } from './room3d';
import { FLOOR_Y, NIGHTSTAND } from './roomplan';

/** Whether an object is a mesh. */
const isMesh = (o: unknown): o is Mesh => o instanceof Mesh;

/** Whether a stub stands in for a renderer (it has the shadow map the cache takes over). */
const isRenderer = (o: unknown): o is threeTypes.WebGLRenderer =>
  typeof o === 'object' && o !== null && 'shadowMap' in o;

/** The first mesh under `root` that casts a shadow on the bedside layer (the drawer). */
function bedsideCaster(root: threeTypes.Object3D): threeTypes.Object3D | undefined {
  let found: threeTypes.Object3D | undefined;
  root.traverse((o) => {
    if (!found && isMesh(o) && o.castShadow && o.layers.isEnabled(BEDSIDE_LAYER)) {
      found = o;
    }
  });
  return found;
}

/** Draws the maps of the lights that ask for one, noting them in `drawn`. */
function drawPending(ls: threeTypes.Light[], drawn: threeTypes.Light[]): void {
  for (const l of ls) {
    if ('shadow' in l && l.shadow instanceof LightShadow && l.shadow.needsUpdate) {
      drawn.push(l);
      l.shadow.needsUpdate = false;
    }
  }
}

/** A box mesh with its own material, 900 mm a side, at x (3 m up, 3 m in). */
const boxAt = (x: number): Mesh<BoxGeometry, MeshStandardMaterial> => {
  const m = new Mesh(new BoxGeometry(900, 900, 900), new MeshStandardMaterial({ color: 0x33_66_99 }));
  m.position.set(x, 3000, 3000);
  return m;
};

/** A geometry's index array, or null with none. */
const indexArray = (g: threeTypes.BufferGeometry): ArrayLike<number> | null => g.index?.array ?? null;

/** The meshes a camera would draw under `o`: shown, and every parent shown. */
function shownMeshes(o: threeTypes.Object3D, s = new Set<threeTypes.Object3D>()): Set<threeTypes.Object3D> {
  if (!o.visible) {
    return s;
  }
  if (isMesh(o)) {
    s.add(o);
  }
  for (const c of o.children) {
    shownMeshes(c, s);
  }
  return s;
}

/** The levels of the link: the cord's side (and the machine's) and the line's, a link and an activity each. */
const lv = (lan: [number, number], wan: [number, number]): jackledsTypes.LinkLevels => ({
  pc: { link: lan[0], act: lan[1] },
  lan: { link: lan[0], act: lan[1] },
  wan: { link: wan[0], act: wan[1] },
  moving: false,
});

/** The glow of every light of one colour, by material, dimmest first (a router has two jacks with lights: the side one and the WAN one). */
function glowsOf(root: threeTypes.Object3D, hex: number): number[] {
  const seen = new Map<threeTypes.Material, number>();
  root.traverse((o) => {
    if (!isMesh(o) || Array.isArray(o.material)) {
      return;
    }
    const m = o.material;
    if ('emissive' in m && m.emissive instanceof Color && m.emissive.getHex() === hex && 'emissiveIntensity' in m) {
      seen.set(m, Number(m.emissiveIntensity));
    }
  });
  return [...seen.values()].toSorted((a, b) => a - b);
}

/** Runs `run` on each item in turn, each after the last one is done. */
async function inTurn<T>(items: readonly T[], run: (t: T) => Promise<void>): Promise<void> {
  const [head, ...rest] = items;
  if (head === undefined) {
    return;
  }
  await run(head);
  await inTurn(rest, run);
}

test("keeps the bedside lantern's map to the drawer and the bed with the lamps' shadows off: only a caster on BEDSIDE_LAYER redraws it", () => {
  const room = new Room3D(),
    scene = new Scene();
  const bed = room.bedLight,
    lights = room.casters;
  // a caster under the drawer: in the lantern's range, on no layer of its map
  const near = new Mesh(new BoxGeometry(1000, 1000, 1000));
  near.castShadow = true;
  near.position.set(NIGHTSTAND.x + NIGHTSTAND.w / 2, -FLOOR_Y + 500, NIGHTSTAND.z1 / 2);
  scene.add(room.root, near);
  const drawer = bedsideCaster(room.root);
  const drawn: threeTypes.Light[] = [];
  const draw = (ls: threeTypes.Light[]): void => {
    drawPending(ls, drawn);
  };
  const r = { shadowMap: { render: draw } };
  assert(isRenderer(r), 'the stub stands in for a renderer');
  const eye = new PerspectiveCamera();
  const cache = new ShadowCache(r);
  let now = 0;
  /** A frame, then the next one: the lights whose maps the second one drew. */
  const frames = (): threeTypes.Light[] => {
    for (let i = 0; i < 2; i++) {
      drawn.length = 0;
      r.shadowMap.render(
        lights.filter((l) => l.castShadow),
        scene,
        eye,
      );
      scene.updateMatrixWorld(true);
      room.redrawShadows(cache.scan(scene, (now += 16)), now);
    }
    return [...drawn];
  };
  const settle = () => {
    frames();
    now += 5000;
    frames();
  };

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
  assert.exists(drawer);
  drawer.position.x += 50;
  expect(frames()).toContain(bed);

  room.setLights(0, true); // High: the lantern reaches across the room again
  expect(bed.shadow.camera.far).toBe(130_000);
  expect(bed.shadow.needsUpdate).toBe(true);
  expect(bed.shadow.camera.layers.mask).toBe(1);
  settle();
  near.position.x += 500;
  expect(frames()).toContain(bed);
}, 180_000);

test('casting is false with the shadows off and true at a shadow level', () => {
  const room = new Room3D();
  room.setLights(4, false);
  room.setShadows(0);
  expect(room.casting).toBe(false);
  room.setShadows(1);
  expect(room.casting).toBe(true);
});

test('scanShadows does not scan with no caster, and scans once with one', () => {
  const room = new Room3D(),
    scene = new Scene();
  let calls = 0;
  const cache = {
    scan: (_s: threeTypes.Object3D, _now: number) => {
      calls++;
      return false;
    },
  };
  room.setLights(4, false);
  room.setShadows(0);
  expect(room.scanShadows(cache, scene, 0)).toBe(false);
  expect(calls).toBe(0);
  room.setShadows(1);
  room.scanShadows(cache, scene, 16);
  expect(calls).toBe(1);
});

test('scanShadows asks again while a map is pending, but not when no light casts', () => {
  const room = new Room3D(),
    scene = new Scene();
  const cache = { scan: () => false, pending: true };
  room.setLights(4, false);
  room.setShadows(0);
  expect(room.scanShadows(cache, scene, 0)).toBe(false);
  room.setShadows(1);
  expect(room.scanShadows(cache, scene, 16)).toBe(true);
});

/** The city's picture in numbers: its meshes, their vertices drawn, and a sum of every position. */
function cityChecksum(room: Room3D): string {
  const view = room.outside;
  let meshes = 0,
    vertices = 0,
    sum = 0;
  view.scene.traverse((o) => {
    if (!isMesh(o)) {
      return;
    }
    const m = o;
    meshes++;
    vertices += m.geometry.attributes['position']?.count ?? 0;
    for (const v of m.geometry.attributes['position']?.array ?? []) {
      sum += v;
    }
  });
  return `${meshes}/${vertices}/${sum.toFixed(3)}`;
}

test('the city detail is "high" by default', () => {
  expect(new Room3D().cityDetail).toBe('high');
}, 180_000);

test('setCityDetail("low") builds the cut city, and "high" again builds the first city back, the old view disposed', () => {
  const room = new Room3D(),
    first = cityChecksum(room);
  const view = room.outside,
    dispose = vi.spyOn(view, 'dispose');
  expect(room).toHaveProperty('setCityDetail', expect.any(Function));
  room.setCityDetail('low');
  expect(room.cityDetail).toBe('low');
  expect(cityChecksum(room)).not.toBe(first);
  expect(dispose).toHaveBeenCalledOnce();
  room.setCityDetail('high');
  expect(room.cityDetail).toBe('high');
  expect(cityChecksum(room)).toBe(first);
}, 180_000);

// (d) the second share: the bake gives its meshes a light map and changes their materials, so `takeBake` shares equal materials again (and a
// replaced one leaves the reflections' register).
test('takes the baked bounce and then shares equal materials again, the replaced one out of the reflections', async () => {
  const room = new Room3D();
  await room.ready; // (the first share and the merge are over)
  // two meshes made after the first share, each with its own material, equal but for their identity
  const a = boxAt(0),
    b = boxAt(5000);
  room.root.add(a, b);
  room.envs.adopt(room.root);
  expect(a.material).not.toBe(b.material);
  const dropped = b.material;
  expect(room.envs.mats.has(dropped)).toBe(true);
  room.root.updateMatrixWorld(true);
  const toRoot = room.root.matrixWorld.clone().invert();
  const hashOf = (m: Mesh) =>
    meshHash(framed(m.geometry, new Matrix4().multiplyMatrices(toRoot, m.matrixWorld)), indexArray(m.geometry));
  assert.exists(a.geometry.index);
  const corners = a.geometry.index.count;
  const bake: lightmapmixTypes.Bake = {
    manifest: {
      version: 1,
      encoding: 'rgbm-sqrt',
      width: 64,
      height: 64,
      texelsPerMetre: 50,
      samples: 1,
      groups: [],
      dark: [],
      meshes: [
        { name: 'a', hash: hashOf(a), corners, offset: 0 },
        { name: 'b', hash: hashOf(b), corners, offset: corners },
      ],
    },
    maps: new Map(),
    uvs: new Uint16Array(4 * corners),
  };
  room.takeBake(bake);
  // both took the light map, and the two equal materials are one again
  expect(a.geometry.attributes['uv1']).toBeDefined();
  expect(b.geometry.attributes['uv1']).toBeDefined();
  expect(b.material).toBe(a.material);
  expect(a.material.lightMap).not.toBeNull();
  expect(room.envs.mats.has(dropped)).toBe(false);
  expect(room.envs.mats.has(a.material)).toBe(true);
});

// (a) lock: `frame` shows and hides parts by the game's state (a router, a monitor). The palette merge after the bake must not take any mesh whose
// shown state the game changes: a merged copy would stay drawn. The test finds those meshes by running the frame in both states, not by name.
test('the palette merge leaves every mesh the game shows and hides alone (checked from what a frame changes)', async () => {
  const room = new Room3D();
  const frame = (installed: boolean, router: number): void => {
    room.frame(
      {
        hour: 12,
        lamp: false,
        blind: false,
        screen: { installed, powered: installed, live: false, text: '' },
        router,
        isp: 0,
        ispName: '',
        mail: false,
        t: 1,
      },
      0.016,
    );
  };
  /** The meshes a camera would draw: shown, and every parent shown. */
  const drawn = (): Set<threeTypes.Object3D> => shownMeshes(room.root);
  frame(true, 1);
  const on = drawn();
  frame(false, 0);
  const off = drawn();
  const flips = [...on].filter((o) => !off.has(o));
  expect(flips.length).toBeGreaterThan(1); // (the router and the monitor)
  frame(true, 1);
  await room.ready;
  const merged = new Set<threeTypes.Object3D>();
  room.root.traverse((o) => {
    for (const p of partsOf(o)) {
      merged.add(p.mesh);
    }
  });
  expect(merged.size).toBeGreaterThan(0); // (the merge ran)
  expect(flips.filter((o) => merged.has(o))).toStrictEqual([]);
  // and nothing the merge made stands drawn once the game hides them
  frame(false, 0);
  expect(flips.filter((o) => drawn().has(o))).toStrictEqual([]);
});

// The router's jack lights on the shelf (docs/render/net.md "LED meanings"): the side jack the lead's cord goes into and the WAN jack carry a light each way; the frames
// of the link, as `LinkLeds` turns them into levels, are all that lights them, and the merges leave their lamps alone.
test("lights the router's side jack and its WAN jack from the levels of the link, and no other", async () => {
  const room = new Room3D();
  const out = { installed: false, powered: false, live: false, text: '' };
  const frame = (router: number, net?: jackledsTypes.LinkLevels): void => {
    room.frame(
      { hour: 12, lamp: false, blind: false, screen: out, router, isp: 3, ispName: '', mail: false, t: 1, net },
      0.016,
    );
  };
  const glows = (hex: number): number[] => glowsOf(room.root, hex);
  const LINK = 0x58_e0_8a,
    ACT = 0xff_b5_47;
  await inTurn([1, 2, 3, 4], async (tier) => {
    frame(tier);
    await room.ready;
    // (built dark, and dark with no levels)
    expect(glows(LINK), `tier ${tier}`).toStrictEqual([0, 0]);
    expect(glows(ACT), `tier ${tier}`).toStrictEqual([0, 0]);
    frame(tier, lv([0, 0], [0, 0]));
    expect(glows(LINK), `tier ${tier}`).toStrictEqual([0, 0]);
    // (the cord's side and the line's side each by themselves, link and activity each by itself)
    frame(tier, lv([1, 0], [0, 0]));
    expect(glows(LINK), `tier ${tier}`).toStrictEqual([0, JACK_GLOW.link]);
    expect(glows(ACT), `tier ${tier}`).toStrictEqual([0, 0]);
    frame(tier, lv([0, 0], [1, 1]));
    expect(glows(LINK), `tier ${tier}`).toStrictEqual([0, JACK_GLOW.link]);
    expect(glows(ACT), `tier ${tier}`).toStrictEqual([0, JACK_GLOW.act]);
    frame(tier, lv([1, 1], [1, 1]));
    expect(glows(LINK), `tier ${tier}`).toStrictEqual([JACK_GLOW.link, JACK_GLOW.link]);
    expect(glows(ACT), `tier ${tier}`).toStrictEqual([JACK_GLOW.act, JACK_GLOW.act]);
    // (the frames stop: they go out)
    frame(tier, DARK);
    expect(glows(LINK), `tier ${tier}`).toStrictEqual([0, 0]);
    expect(glows(ACT), `tier ${tier}`).toStrictEqual([0, 0]);
  });
  // (no router stands: nothing is lit, whatever the levels)
  frame(0, lv([1, 1], [1, 1]));
  expect(glows(LINK)).toStrictEqual([0, 0]);
});
