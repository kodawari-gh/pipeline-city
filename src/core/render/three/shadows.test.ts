import { describe, expect, it } from 'vitest';
import { BoxGeometry, DirectionalLight, Group, Mesh, PointLight, Scene, SpotLight, type Light, type LightShadow, type Object3D, type WebGLRenderer } from 'three';
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
    if (moved) lamp.shadow.needsUpdate = bulb.shadow.needsUpdate = true;
    return { drawn: [...drawn], moved };
  };
  frame(0);
  frame(16);
  frame(5000); // settled
  return { caster, rotor, lamp, bulb, frame };
}

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
