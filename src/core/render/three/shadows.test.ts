import { describe, expect, it } from 'vitest';
import { BoxGeometry, DirectionalLight, Group, InstancedMesh, Matrix4, Mesh, PointLight, Scene, SpotLight, type Light, type LightShadow, type Object3D, type WebGLRenderer } from 'three';
import { ShadowCache, catchUp } from './shadows';

/** A scene with a panel of two casters, a still caster and a spinning rotor; the cache over a renderer that is only its shadow map. */
function setup() {
  const scene = new Scene(), panel = new Group(), rotor = new Group();
  const caster = () => { const m = new Mesh(new BoxGeometry()); m.castShadow = true; return m; };
  const a = caster(), b = caster(), still = caster(), blade = caster();
  panel.add(a, b);
  rotor.userData.spin = true;
  rotor.add(blade);
  scene.add(panel, still, rotor);
  const cache = new ShadowCache({ shadowMap: { render: () => {} } } as unknown as WebGLRenderer);
  const movers = () => (cache as unknown as { movers: Object3D[] }).movers;
  const at = (t: number) => { scene.updateMatrixWorld(true); return cache.scan(scene, t); };
  at(0);
  at(5000); // settled: nothing is a mover
  return { scene, panel, a, b, still, rotor, cache, movers, at };
}

describe('ShadowCache.scan', () => {
  it('sees nothing when nothing moves, and forgets the movers once settled', () => {
    const { at, movers } = setup();
    expect(movers()).toEqual([]);
    expect(at(5100)).toBe(false);
  });
  it('makes the casters that move the movers, and keeps the still ones out', () => {
    const { panel, a, b, at, movers } = setup();
    panel.position.x = 10;
    expect(at(6000)).toBe(true);
    expect(new Set(movers())).toEqual(new Set([a, b]));
    panel.position.x = 20;
    expect(at(6016)).toBe(true);
    expect(movers()).toHaveLength(2);
    expect(at(6032)).toBe(false);
    expect(movers()).toHaveLength(2); // kept while the move may go on
    expect(at(7100)).toBe(false);
    expect(movers()).toEqual([]);
  });
  it('counts a still caster that hides as a change', () => {
    const { still, at, movers } = setup();
    still.visible = false;
    expect(at(6000)).toBe(true);
    expect(movers()).toEqual([]);
  });
  it('leaves a spinning part out', () => {
    const { rotor, at } = setup();
    rotor.rotation.z = 1;
    expect(at(6000)).toBe(false);
  });
  it('redraws a point light\'s cube map whole while things move (the still picture is a flat map)', () => {
    const scene = new Scene(), m = new Mesh(new BoxGeometry());
    m.castShadow = true;
    scene.add(m);
    const drawn: string[] = [];
    const cache = new ShadowCache({ shadowMap: { render: (ls: { type: string }[], s: Object3D) => drawn.push(`${ls[0]!.type}:${s === scene}`) } } as unknown as WebGLRenderer);
    const bulb = new PointLight(), sun = new DirectionalLight();
    bulb.shadow.autoUpdate = sun.shadow.autoUpdate = false;
    bulb.shadow.needsUpdate = true;
    scene.updateMatrixWorld(true); cache.scan(scene, 0);
    m.position.x = 5;
    scene.updateMatrixWorld(true);
    expect(cache.scan(scene, 16)).toBe(true);
    (cache as unknown as { render: (l: unknown[], s: Object3D, c: unknown) => void }).render([bulb, sun], scene, null);
    expect(drawn).toEqual(['PointLight:true']);
  });
  it('moves a live mesh (its vertices change, its matrix does not) on every scan', () => {
    const { still, at, movers } = setup();
    still.userData.live = true;
    expect(at(6000)).toBe(true);
    expect(at(6016)).toBe(true);
    expect(movers()).toEqual([still]);
  });
  it('sees a caster whose geometry or copies change under a still matrix', () => {
    const { still, at } = setup();
    still.geometry = new BoxGeometry(2, 2, 2);
    expect(at(6000)).toBe(true);
  });
});

/** A scene with a still caster, a spinning rotor and two lights; the cache over a renderer that records each map it draws, as three does. */
function lit() {
  const scene = new Scene(), caster = new Mesh(new BoxGeometry()), rotor = new Group(), blade = new Mesh(new BoxGeometry());
  caster.castShadow = blade.castShadow = true;
  rotor.userData.spin = true;
  rotor.add(blade);
  const lamp = new SpotLight(), bulb = new PointLight();
  for (const l of [lamp, bulb]) { l.castShadow = true; l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; }
  scene.add(caster, rotor, lamp, bulb);
  const drawn: Light[] = [];
  const draw = (ls: (Light & { shadow?: LightShadow })[]) => { for (const l of ls) if (l.shadow!.autoUpdate || l.shadow!.needsUpdate) { drawn.push(l); l.shadow!.needsUpdate = false; } };
  const r = { shadowMap: { render: draw } } as unknown as WebGLRenderer;
  const cache = new ShadowCache(r);
  /** One frame: the maps drawn for it, then the scan after its draw; a move asks every map again (as `Room3D.redrawShadows`). */
  const frame = (t: number) => {
    drawn.length = 0;
    r.shadowMap.render([lamp, bulb], scene, null as never);
    scene.updateMatrixWorld(true);
    const moved = cache.scan(scene, t);
    if (moved) { catchUp(lamp); catchUp(bulb); }
    return { drawn: [...drawn], moved };
  };
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
  const scene = new Scene(), caster = new Mesh(new BoxGeometry()), rotor = new Group(), blade = new Mesh(new BoxGeometry());
  caster.castShadow = blade.castShadow = true;
  rotor.userData.spin = true;
  rotor.add(blade);
  caster.position.x = rotor.position.x = 100;
  const bulb = new PointLight(0xffffff, 1, 10), lamp = new SpotLight(), sun = new DirectionalLight();
  const lights = [bulb, lamp, sun];
  for (const l of lights) { l.castShadow = true; l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; }
  scene.add(caster, rotor, ...lights);
  const drawn: Light[] = [];
  const draw = (ls: (Light & { shadow?: LightShadow })[]) => { for (const l of ls) if (l.shadow!.needsUpdate) { drawn.push(l); l.shadow!.needsUpdate = false; } };
  const r = { shadowMap: { render: draw } } as unknown as WebGLRenderer;
  const cache = new ShadowCache(r);
  const frame = (t: number) => {
    drawn.length = 0;
    r.shadowMap.render(lights, scene, null as never);
    scene.updateMatrixWorld(true);
    if (cache.scan(scene, t)) for (const l of lights) catchUp(l);
    return [...drawn];
  };
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
    expect(frame(6016)).toEqual([lamp, sun]);
  });
  it('redraws a light for a caster that moves in its range, comes into it or leaves it', () => {
    const { caster, bulb, lamp, sun, frame } = ranged();
    caster.position.x = 5; // in
    frame(6000);
    expect(frame(6016)).toEqual([bulb, lamp, sun]);
    caster.position.x = 6; // within
    frame(6032);
    expect(frame(6048)).toEqual([bulb, lamp, sun]);
    caster.position.x = 100; // out: the map still holds it
    frame(6064);
    expect(frame(6080)).toEqual([bulb, lamp, sun]);
    caster.position.x = 110;
    frame(6096);
    expect(frame(6112)).toEqual([lamp, sun]);
  });
  it('reaches as far as the corner of a point light\'s cube, and no farther', () => {
    const { caster, bulb, lamp, sun, frame } = ranged();
    caster.position.set(18.5, 0, 0); // its sphere (0.87) ends past 17.3
    frame(6000);
    expect(frame(6016)).toEqual([lamp, sun]);
    caster.position.set(18.6, 0, 0);
    frame(6032);
    expect(frame(6048)).toEqual([lamp, sun]);
    caster.position.set(10, 10, 10); // the corner
    frame(6064);
    expect(frame(6080)).toEqual([bulb, lamp, sun]);
  });
  it('takes an instanced caster\'s bounds over its copies', () => {
    const { caster, bulb, lamp, sun, lights, frame } = ranged();
    const copies = new InstancedMesh(new BoxGeometry(), undefined, 2);
    copies.castShadow = true;
    copies.position.x = 100;
    copies.setMatrixAt(0, new Matrix4());
    copies.setMatrixAt(1, new Matrix4().makeTranslation(-100, 0, 0)); // a copy at the bulb
    caster.parent!.add(copies);
    frame(6000);
    expect(frame(6016)).toEqual(lights); // new
    frame(8000);
    copies.setMatrixAt(0, new Matrix4().makeTranslation(1, 0, 0));
    copies.instanceMatrix.needsUpdate = true;
    frame(8016);
    expect(frame(8032)).toEqual([bulb, lamp, sun]);
  });
  it('catches up a turned rotor only for the lights in range of it', () => {
    const { rotor, bulb, lamp, lights, frame } = ranged();
    rotor.rotation.z = 1;
    frame(6000);
    for (const l of lights) catchUp(l);
    expect(frame(6016)).toEqual([lamp, lights[2]]);
    rotor.position.x = 5;
    rotor.rotation.z = 2;
    frame(6032);
    catchUp(bulb);
    expect(frame(6048)).toEqual([bulb]);
  });
  it('redraws a light for a caster in its range that hides', () => {
    const { caster, lamp, sun, frame } = ranged();
    caster.visible = false;
    frame(6000);
    expect(frame(6016)).toEqual([lamp, sun]);
  });
});

describe('ShadowCache layers', () => {
  const LAYER = 5;
  function rig() {
    const scene = new Scene(), caster = () => { const m = new Mesh(new BoxGeometry()); m.castShadow = true; return m; };
    const plain = caster(), on = caster(), rotor = new Group(), blade = caster();
    on.layers.enable(LAYER);
    rotor.userData.spin = true;
    rotor.add(blade);
    const layered = new PointLight(0xffffff, 1, 1000), dflt = new PointLight(0xffffff, 1, 1000);
    layered.shadow.camera.layers.set(LAYER);
    const lights = [layered, dflt];
    for (const l of lights) { l.castShadow = true; l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; }
    scene.add(plain, on, rotor, ...lights);
    const drawn: Light[] = [];
    const draw = (ls: PointLight[]) => { for (const l of ls) if (l.shadow.needsUpdate) { drawn.push(l); l.shadow.needsUpdate = false; } };
    const r = { shadowMap: { render: draw } } as unknown as WebGLRenderer;
    const cache = new ShadowCache(r);
    const frame = (t: number) => {
      drawn.length = 0;
      r.shadowMap.render(lights, scene, null as never);
      scene.updateMatrixWorld(true);
      if (cache.scan(scene, t)) for (const l of lights) catchUp(l);
      return [...drawn];
    };
    frame(0); frame(16); frame(5000);
    return { plain, on, rotor, layered, dflt, frame };
  }

  it('does not redraw a light for a caster on none of its map\'s layers, and does for one on a layer', () => {
    const { plain, on, layered, dflt, frame } = rig();
    plain.position.x = 10;
    frame(6000);
    expect(frame(6016)).toEqual([dflt]);
    on.position.x = 10;
    frame(7000);
    expect(frame(7016)).toEqual([layered, dflt]);
  });
  it('leaves a spinning part on layer 0 out of a layered light\'s redraws', () => {
    const { rotor, layered, dflt, frame } = rig();
    rotor.rotation.z = 1;
    frame(6000);
    catchUp(layered); catchUp(dflt);
    expect(frame(6016)).toEqual([dflt]);
  });
});

describe('ShadowCache maps', () => {
  it('draws no map in a still scene, catch-up requests included', () => {
    const { lamp, bulb, frame } = lit();
    for (let i = 0; i < 10; i++) {
      catchUp(i % 2 ? lamp : bulb);
      expect(frame(5100 + i * 16).drawn).toEqual([]);
    }
  });
  it('redraws the maps for a moving caster', () => {
    const { caster, lamp, bulb, frame } = lit();
    caster.position.x = 10;
    expect(frame(6000).moved).toBe(true);
    expect(frame(6016).drawn).toEqual([lamp, bulb]);
    caster.position.x = 20;
    frame(6032);
    expect(frame(6048).drawn).toEqual([lamp, bulb]);
  });
  it('catches up a turned rotor, which is no mover', () => {
    const { rotor, lamp, frame } = lit();
    rotor.rotation.z = 1;
    expect(frame(6000).moved).toBe(false);
    catchUp(lamp);
    expect(frame(6016).drawn).toEqual([lamp]);
    catchUp(lamp);
    expect(frame(6032).drawn).toEqual([]);
  });
  it('draws no map for a light at 0, and draws it the first frame it is lit', () => {
    const { caster, lamp, bulb, frame } = lit();
    bulb.intensity = 0;
    caster.position.x = 10;
    frame(6000);
    expect(frame(6016).drawn).toEqual([lamp]);
    expect(bulb.shadow.needsUpdate).toBe(true); // owed
    expect(frame(6032).drawn).toEqual([]);
    bulb.intensity = 1;
    expect(frame(6048).drawn).toEqual([bulb]);
  });
  it('draws a light its owner redraws by autoUpdate as asked, even at 0', () => {
    const { lamp, frame } = lit();
    lamp.intensity = 0;
    lamp.shadow.autoUpdate = true;
    expect(frame(6000).drawn).toEqual([lamp]);
  });
});
