import { assert, describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PointLight,
  Scene,
  SpotLight,
} from 'three';
import type * as threeTypes from 'three';
import { ShadowCache, catchUp } from './shadows';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** A renderer as far as the shadow cache uses one: its shadow map. */
const isRenderer = (x: unknown): x is threeTypes.WebGLRenderer =>
  typeof x === 'object' && x !== null && 'shadowMap' in x;
/** A renderer that is only its shadow map, which draws with `draw`. */
function shadowRenderer(draw: (ls: never[], s: threeTypes.Object3D) => void): threeTypes.WebGLRenderer {
  const r = { shadowMap: { render: draw } };
  assert(isRenderer(r));
  return r;
}
/** The cache's movers (a field of its own: the test reads it to see what it holds). */
const hasMovers = (c: unknown): c is { movers: threeTypes.Object3D[] } =>
  typeof c === 'object' && c !== null && 'movers' in c && Array.isArray(c.movers);
/** The movers the cache `c` holds. */
const moversOf = (c: unknown): threeTypes.Object3D[] => {
  assert(hasMovers(c));
  return c.movers;
};
/** Whether `l` is one of `ls`. */
const among = (ls: readonly threeTypes.Light[], l: threeTypes.Light) => ls.includes(l);
/** A caster: a box that casts. */
const castingBox = () => {
  const m = new Mesh(new BoxGeometry());
  m.castShadow = true;
  return m;
};
/** The camera a render is for (the stand-in maps draw no picture: any camera does). */
const cam = new PerspectiveCamera();
/** Is `o` in `scene` (its parent chain reaches the scene)? */
function inScene(o: threeTypes.Object3D, scene: threeTypes.Object3D): boolean {
  for (let p: threeTypes.Object3D | null = o; p; p = p.parent) {
    if (p === scene) {
      return true;
    }
  }
  return false;
}

/** A scene with a panel of two casters, a still caster and a spinning rotor; the cache over a renderer that is only its shadow map. */
function setup() {
  const scene = new Scene(),
    panel = new Group(),
    rotor = new Group();
  const a = castingBox(),
    b = castingBox(),
    still = castingBox(),
    blade = castingBox();
  panel.add(a, b);
  rotor.userData['spin'] = true;
  rotor.add(blade);
  scene.add(panel, still, rotor);
  const cache = new ShadowCache(
    shadowRenderer(() => {
      // (a still scene draws nothing the test looks at)
    }),
  );
  const movers = () => moversOf(cache);
  const at = (t: number) => {
    scene.updateMatrixWorld(true);
    return cache.scan(scene, t);
  };
  at(0);
  at(5000); // settled: nothing is a mover
  return { scene, panel, a, b, still, rotor, cache, movers, at };
}

describe('ShadowCache.scan', () => {
  it('sees nothing when nothing moves, and forgets the movers once settled', () => {
    const { at, movers } = setup();
    expect(movers()).toStrictEqual([]);
    expect(at(5100)).toBe(false);
  });
  it('makes the casters that move the movers, and keeps the still ones out', () => {
    const { panel, a, b, at, movers } = setup();
    panel.position.x = 10;
    expect(at(6000)).toBe(true);
    expect(new Set(movers())).toStrictEqual(new Set([a, b]));
    panel.position.x = 20;
    expect(at(6016)).toBe(true);
    expect(movers()).toHaveLength(2);
    expect(at(6032)).toBe(false);
    expect(movers()).toHaveLength(2); // kept while the move may go on
    expect(at(7100)).toBe(false);
    expect(movers()).toStrictEqual([]);
  });
  it('counts a still caster that hides as a change', () => {
    const { still, at, movers } = setup();
    still.visible = false;
    expect(at(6000)).toBe(true);
    expect(movers()).toStrictEqual([]);
  });
  it('leaves a spinning part out', () => {
    const { rotor, at } = setup();
    rotor.rotation.z = 1;
    expect(at(6000)).toBe(false);
  });
  it("redraws a point light's cube map whole while things move (the still picture is a flat map)", () => {
    const scene = new Scene(),
      m = new Mesh(new BoxGeometry());
    m.castShadow = true;
    scene.add(m);
    const drawn: string[] = [];
    const r = shadowRenderer((ls: { type: string }[], s) => {
        drawn.push(`${must(ls[0]).type}:${s === scene}`);
      }),
      cache = new ShadowCache(r);
    const bulb = new PointLight(),
      sun = new DirectionalLight();
    bulb.shadow.autoUpdate = false;
    sun.shadow.autoUpdate = false;
    bulb.shadow.needsUpdate = true;
    scene.updateMatrixWorld(true);
    cache.scan(scene, 0);
    m.position.x = 5;
    scene.updateMatrixWorld(true);
    expect(cache.scan(scene, 16)).toBe(true);
    r.shadowMap.render([bulb, sun], scene, cam); // (the cache draws in the shadow map's place)
    expect(drawn).toStrictEqual(['PointLight:true']);
  });
  it('moves a live mesh (its vertices change, its matrix does not) on every scan', () => {
    const { still, at, movers } = setup();
    still.userData['live'] = true;
    expect(at(6000)).toBe(true);
    expect(at(6016)).toBe(true);
    expect(movers()).toStrictEqual([still]);
  });
  it('sees a caster whose geometry or copies change under a still matrix', () => {
    const { still, at } = setup();
    still.geometry = new BoxGeometry(2, 2, 2);
    expect(at(6000)).toBe(true);
  });
});

/**
 * One frame of a test: the renders (each draws the maps the budget allows), then the scan. The budget defers a map to the next render, so the
 * frame draws on while a map is owed (`pending`). A move asks every map again. Returns the maps drawn over the frame, and whether a caster moved.
 */
interface FrameRig {
  cache: ShadowCache;
  r: threeTypes.WebGLRenderer;
  scene: Scene;
  lights: threeTypes.Light[];
  drawn: threeTypes.Light[];
}
function frameOf(
  { cache, r, scene, lights, drawn }: FrameRig,
  t: number,
): { drawn: threeTypes.Light[]; moved: boolean } {
  const got: threeTypes.Light[] = [];
  let moved = false;
  do {
    drawn.length = 0;
    r.shadowMap.render(lights, scene, cam);
    got.push(...drawn);
    scene.updateMatrixWorld(true);
    if (cache.scan(scene, t)) {
      moved = true;
      for (const l of lights) {
        catchUp(l);
      }
    }
  } while (cache.pending);
  return { drawn: got, moved };
}

/** A scene with a still caster, a spinning rotor and two lights; the cache over a renderer that records each map it draws, as three does. */
function lit() {
  const scene = new Scene(),
    caster = new Mesh(new BoxGeometry()),
    rotor = new Group(),
    blade = new Mesh(new BoxGeometry());
  caster.castShadow = true;
  blade.castShadow = true;
  rotor.userData['spin'] = true;
  rotor.add(blade);
  const lamp = new SpotLight(),
    bulb = new PointLight();
  for (const l of [lamp, bulb]) {
    l.castShadow = true;
    l.shadow.autoUpdate = false;
    l.shadow.needsUpdate = true;
  }
  scene.add(caster, rotor, lamp, bulb);
  const drawn: threeTypes.Light[] = [];
  const draw = (ls: (threeTypes.Light & { shadow?: threeTypes.LightShadow })[]) => {
    for (const l of ls) {
      if (must(l.shadow).autoUpdate || must(l.shadow).needsUpdate) {
        drawn.push(l);
        must(l.shadow).needsUpdate = false;
      }
    }
  };
  const r = shadowRenderer(draw);
  const cache = new ShadowCache(r);
  /** One frame: the maps drawn for it, then the scan after its draw; a move asks every map again (as `Room3D.redrawShadows`). */
  const frame = (t: number) => frameOf({ cache, r, scene, lights: [lamp, bulb], drawn }, t);
  frame(0);
  frame(16);
  frame(5000); // settled
  return { caster, rotor, lamp, bulb, frame };
}

/**
 * A scene with a caster and a rotor at x = 100, and three lights at the origin: a bulb that reaches 10 (its cube's corner: 17.3), a lamp
 * that reaches 500 and a sun with no range. A frame is as in `lit`.
 */
function ranged() {
  const scene = new Scene(),
    caster = new Mesh(new BoxGeometry()),
    rotor = new Group(),
    blade = new Mesh(new BoxGeometry());
  caster.castShadow = true;
  blade.castShadow = true;
  rotor.userData['spin'] = true;
  rotor.add(blade);
  caster.position.x = 100;
  rotor.position.x = 100;
  const bulb = new PointLight(0xff_ff_ff, 1, 10),
    lamp = new SpotLight(),
    sun = new DirectionalLight();
  const lights = [bulb, lamp, sun];
  for (const l of lights) {
    l.castShadow = true;
    l.shadow.autoUpdate = false;
    l.shadow.needsUpdate = true;
  }
  scene.add(caster, rotor, ...lights);
  const drawn: threeTypes.Light[] = [];
  const draw = (ls: (threeTypes.Light & { shadow?: threeTypes.LightShadow })[]) => {
    for (const l of ls) {
      if (must(l.shadow).needsUpdate) {
        drawn.push(l);
        must(l.shadow).needsUpdate = false;
      }
    }
  };
  const r = shadowRenderer(draw);
  const cache = new ShadowCache(r);
  const frame = (t: number) => frameOf({ cache, r, scene, lights, drawn }, t).drawn;
  frame(0);
  frame(16);
  frame(5000); // settled
  return { caster, rotor, bulb, lamp, sun, lights, frame };
}

describe('ShadowCache ranges', () => {
  it('redraws only the lights a moving caster is in the range of', () => {
    const { caster, lamp, sun, frame } = ranged();
    caster.position.x = 110;
    frame(6000);
    expect(frame(6016)).toStrictEqual([lamp, sun]);
  });
  it('redraws a light for a caster that moves in its range, comes into it or leaves it', () => {
    const { caster, bulb, lamp, sun, frame } = ranged();
    caster.position.x = 5; // in
    frame(6000);
    expect(frame(6016)).toStrictEqual([bulb, lamp, sun]);
    caster.position.x = 6; // within
    frame(6032);
    expect(frame(6048)).toStrictEqual([bulb, lamp, sun]);
    caster.position.x = 100; // out: the map still holds it
    frame(6064);
    expect(frame(6080)).toStrictEqual([bulb, lamp, sun]);
    caster.position.x = 110;
    frame(6096);
    expect(frame(6112)).toStrictEqual([lamp, sun]);
  });
  it("reaches as far as the corner of a point light's cube, and no farther", () => {
    const { caster, bulb, lamp, sun, frame } = ranged();
    caster.position.set(18.5, 0, 0); // its sphere (0.87) ends past 17.3
    frame(6000);
    expect(frame(6016)).toStrictEqual([lamp, sun]);
    caster.position.set(18.6, 0, 0);
    frame(6032);
    expect(frame(6048)).toStrictEqual([lamp, sun]);
    caster.position.set(10, 10, 10); // the corner
    frame(6064);
    expect(frame(6080)).toStrictEqual([bulb, lamp, sun]);
  });
  it("takes an instanced caster's bounds over its copies", () => {
    const { caster, bulb, lamp, sun, lights, frame } = ranged();
    const copies = new InstancedMesh(new BoxGeometry(), undefined, 2);
    copies.castShadow = true;
    copies.position.x = 100;
    copies.setMatrixAt(0, new Matrix4());
    copies.setMatrixAt(1, new Matrix4().makeTranslation(-100, 0, 0)); // a copy at the bulb
    must(caster.parent).add(copies);
    frame(6000);
    expect(frame(6016)).toStrictEqual(lights); // new
    frame(8000);
    copies.setMatrixAt(0, new Matrix4().makeTranslation(1, 0, 0));
    copies.instanceMatrix.needsUpdate = true;
    frame(8016);
    expect(frame(8032)).toStrictEqual([bulb, lamp, sun]);
  });
  it('catches up a turned rotor only for the lights in range of it', () => {
    const { rotor, bulb, lamp, lights, frame } = ranged();
    rotor.rotation.z = 1;
    frame(6000);
    for (const l of lights) {
      catchUp(l);
    }
    expect(frame(6016)).toStrictEqual([lamp, lights[2]]);
    rotor.position.x = 5;
    rotor.rotation.z = 2;
    frame(6032);
    catchUp(bulb);
    expect(frame(6048)).toStrictEqual([bulb]);
  });
  it('redraws a light for a caster in its range that hides', () => {
    const { caster, lamp, sun, frame } = ranged();
    caster.visible = false;
    frame(6000);
    expect(frame(6016)).toStrictEqual([lamp, sun]);
  });
});

describe('ShadowCache layers', () => {
  const LAYER = 5;
  function rig() {
    const scene = new Scene();
    const plain = castingBox(),
      on = castingBox(),
      rotor = new Group(),
      blade = castingBox();
    on.layers.enable(LAYER);
    rotor.userData['spin'] = true;
    rotor.add(blade);
    const layered = new PointLight(0xff_ff_ff, 1, 1000),
      dflt = new PointLight(0xff_ff_ff, 1, 1000);
    layered.shadow.camera.layers.set(LAYER);
    const lights = [layered, dflt];
    for (const l of lights) {
      l.castShadow = true;
      l.shadow.autoUpdate = false;
      l.shadow.needsUpdate = true;
    }
    scene.add(plain, on, rotor, ...lights);
    const drawn: threeTypes.Light[] = [];
    const draw = (ls: PointLight[]) => {
      for (const l of ls) {
        if (l.shadow.needsUpdate) {
          drawn.push(l);
          l.shadow.needsUpdate = false;
        }
      }
    };
    const r = shadowRenderer(draw);
    const cache = new ShadowCache(r);
    const frame = (t: number) => frameOf({ cache, r, scene, lights, drawn }, t).drawn;
    frame(0);
    frame(16);
    frame(5000);
    return { plain, on, rotor, layered, dflt, frame };
  }

  it("does not redraw a light for a caster on none of its map's layers, and does for one on a layer", () => {
    const { plain, on, layered, dflt, frame } = rig();
    plain.position.x = 10;
    frame(6000);
    expect(frame(6016)).toStrictEqual([dflt]);
    on.position.x = 10;
    frame(7000);
    expect(frame(7016)).toStrictEqual([layered, dflt]);
  });
  it("leaves a spinning part on layer 0 out of a layered light's redraws", () => {
    const { rotor, layered, dflt, frame } = rig();
    rotor.rotation.z = 1;
    frame(6000);
    catchUp(layered);
    catchUp(dflt);
    expect(frame(6016)).toStrictEqual([dflt]);
  });
});

describe('ShadowCache maps', () => {
  it('draws no map in a still scene, catch-up requests included', () => {
    const { lamp, bulb, frame } = lit();
    for (let i = 0; i < 10; i++) {
      catchUp(must([bulb, lamp][i % 2]));
      expect(frame(5100 + i * 16).drawn).toStrictEqual([]);
    }
  });
  it('redraws the maps for a moving caster', () => {
    const { caster, lamp, bulb, frame } = lit();
    caster.position.x = 10;
    expect(frame(6000).moved).toBe(true);
    expect(frame(6016).drawn).toStrictEqual([lamp, bulb]);
    caster.position.x = 20;
    frame(6032);
    expect(frame(6048).drawn).toStrictEqual([lamp, bulb]);
  });
  it('catches up a turned rotor, which is no mover', () => {
    const { rotor, lamp, frame } = lit();
    rotor.rotation.z = 1;
    expect(frame(6000).moved).toBe(false);
    catchUp(lamp);
    expect(frame(6016).drawn).toStrictEqual([lamp]);
    catchUp(lamp);
    expect(frame(6032).drawn).toStrictEqual([]);
  });
  it('draws no map for a light at 0, and draws it the first frame it is lit', () => {
    const { caster, lamp, bulb, frame } = lit();
    bulb.intensity = 0;
    caster.position.x = 10;
    frame(6000);
    expect(frame(6016).drawn).toStrictEqual([lamp]);
    expect(bulb.shadow.needsUpdate).toBe(true); // owed
    expect(frame(6032).drawn).toStrictEqual([]);
    bulb.intensity = 1;
    expect(frame(6048).drawn).toStrictEqual([bulb]);
  });
  it('draws a light its owner redraws by autoUpdate as asked, even at 0', () => {
    const { lamp, frame } = lit();
    lamp.intensity = 0;
    lamp.shadow.autoUpdate = true;
    expect(frame(6000).drawn).toStrictEqual([lamp]);
  });
});

/** Three spot lights (due at once) over a caster that does not move, and an autoUpdate light; the cache over a recording renderer, as three does. */
function budget() {
  const scene = new Scene(),
    caster = new Mesh(new BoxGeometry());
  caster.castShadow = true;
  scene.add(caster);
  const lights = [new SpotLight(), new SpotLight(), new SpotLight()];
  for (const l of lights) {
    l.castShadow = true;
    l.shadow.autoUpdate = false;
    l.shadow.needsUpdate = true;
  }
  const auto = new SpotLight();
  auto.castShadow = true;
  auto.shadow.autoUpdate = true;
  scene.add(...lights, auto);
  const drawn: threeTypes.Light[] = [];
  const draw = (ls: (threeTypes.Light & { shadow?: threeTypes.LightShadow })[]) => {
    for (const l of ls) {
      if (must(l.shadow).autoUpdate || must(l.shadow).needsUpdate) {
        drawn.push(l);
        must(l.shadow).needsUpdate = false;
      }
    }
  };
  const r = shadowRenderer(draw);
  const cache = new ShadowCache(r);
  const render = () => {
    drawn.length = 0;
    r.shadowMap.render([...lights, auto], scene, cam);
    return [...drawn];
  };
  const frame = (t: number) => {
    scene.updateMatrixWorld(true);
    cache.scan(scene, t);
    return render();
  };
  return { lights, auto, cache, render, frame };
}

describe('ShadowCache budget', () => {
  it('draws at most one full map in one render', () => {
    const { lights, frame } = budget();
    const first = frame(0).filter((l) => among(lights, l));
    expect(first).toHaveLength(1);
  });
  it('draws each due map once within as many frames as due lights, then none', () => {
    const { lights, frame, render } = budget();
    const seen: threeTypes.Light[] = [];
    for (let i = 1; i <= 3; i++) {
      seen.push(...frame(i * 16).filter((l) => among(lights, l)));
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen)).toStrictEqual(new Set(lights));
    expect(render().filter((l) => among(lights, l))).toStrictEqual([]);
  });
  it('is pending until every deferred map is drawn', () => {
    const { cache, frame } = budget();
    const c = cache;
    frame(0);
    expect(c.pending).toBe(true);
    frame(16);
    expect(c.pending).toBe(true);
    frame(32);
    expect(c.pending).toBe(false);
  });
  it('draws an autoUpdate light every render, whatever the budget', () => {
    const { auto, frame, render } = budget();
    expect(frame(0)).toContain(auto);
    expect(frame(16)).toContain(auto);
    expect(render()).toContain(auto);
  });
  it('draws no further full map in a second render of the same frame', () => {
    const { lights, frame, render } = budget();
    frame(0);
    expect(render().filter((l) => among(lights, l))).toStrictEqual([]);
  });
});

/**
 * Three due spot lights over a still caster, as `budget`, but the renderer draws only the lights in the scene (as three does), so a light
 * removed from it is not drawn. Returns the scene, the lights and the cache's `pending`.
 */
function removable(grouped = false) {
  const scene = new Scene(),
    caster = new Mesh(new BoxGeometry());
  caster.castShadow = true;
  scene.add(caster);
  const lights = [new SpotLight(), new SpotLight(), new SpotLight()];
  for (const l of lights) {
    l.castShadow = true;
    l.shadow.autoUpdate = false;
    l.shadow.needsUpdate = true;
  }
  // the lights under a group, the group in the scene (or the lights directly in the scene)
  const group = new Group();
  if (grouped) {
    scene.add(group);
    group.add(...lights);
  } else {
    scene.add(...lights);
  }
  const drawn: threeTypes.Light[] = [];
  const draw = (ls: (threeTypes.Light & { shadow?: threeTypes.LightShadow })[]) => {
    for (const l of ls) {
      if (must(l.shadow).needsUpdate) {
        drawn.push(l);
        must(l.shadow).needsUpdate = false;
      }
    }
  };
  const r = shadowRenderer(draw);
  const cache = new ShadowCache(r);
  const c = cache;
  /** One scan, then the render of the frame (over the lights in the scene, as three's): the maps drawn. */
  const frame = (t: number) => {
    scene.updateMatrixWorld(true);
    cache.scan(scene, t);
    drawn.length = 0;
    r.shadowMap.render(
      lights.filter((l) => inScene(l, scene)),
      scene,
      cam,
    );
    return [...drawn];
  };
  return {
    scene,
    group,
    lights,
    cache,
    c,
    frame,
    drawn,
    r,
    scan: (t: number) => {
      scene.updateMatrixWorld(true);
      cache.scan(scene, t);
    },
  };
}

describe('ShadowCache removed lights', () => {
  it('is not pending on a deferred light removed from the scene, and never draws it', () => {
    const { scene, lights, c, frame, scan, drawn } = removable();
    expect(frame(0)).toStrictEqual([lights[0]]);
    expect(c.pending).toBe(true); // lights[1] and lights[2] are owed
    scene.remove(must(lights[1])); // deferred, not yet drawn
    scan(16);
    expect(c.pending).toBe(true); // lights[2] is still owed
    expect(frame(32)).toStrictEqual([lights[2]]);
    expect(drawn).not.toContain(lights[1]);
    expect(c.pending).toBe(false);
  });
  it('is not pending once every deferred light is removed from the scene', () => {
    const { scene, lights, c, frame } = removable();
    frame(0);
    scene.remove(must(lights[1]), must(lights[2]));
    expect(frame(16)).toStrictEqual([]);
    expect(c.pending).toBe(false);
  });
  it('is not pending on lights under a group removed from the scene, and never draws them', () => {
    const { scene, group, lights, c, frame, drawn } = removable(true);
    expect(frame(0)).toStrictEqual([lights[0]]);
    expect(c.pending).toBe(true); // lights[1] and lights[2] are owed
    scene.remove(group);
    expect(must(lights[1]).parent).toBe(group); // still under the group, which is not in the scene
    expect(frame(16)).toStrictEqual([]);
    expect(c.pending).toBe(false);
    expect(drawn).not.toContain(lights[1]);
    expect(drawn).not.toContain(lights[2]);
  });
  it('keeps a deferred light of another scene: a scan of this scene does not drop it', () => {
    const { c, frame, scan, r, drawn } = removable();
    const other = new Scene(),
      x = new SpotLight();
    x.castShadow = true;
    x.shadow.autoUpdate = false;
    x.shadow.needsUpdate = true;
    other.add(x);
    frame(0); // draws lights[0]: the budget is spent
    drawn.length = 0;
    r.shadowMap.render([x], other, cam); // deferred: owed, in another scene
    expect(drawn).toStrictEqual([]);
    frame(16);
    frame(32); // lights[1] and lights[2] are drawn, the board's scans run
    expect(c.pending).toBe(true); // x is still owed
    scan(48); // refills the budget
    drawn.length = 0;
    r.shadowMap.render([x], other, cam);
    expect(drawn).toStrictEqual([x]);
    expect(c.pending).toBe(false);
  });
});
