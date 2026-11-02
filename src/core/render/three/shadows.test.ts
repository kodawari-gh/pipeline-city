import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, Scene, type Object3D, type WebGLRenderer } from 'three';
import { ShadowCache } from './shadows';

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
  it('moves a live mesh (its vertices change, its matrix does not) on every scan', () => {
    const { still, at, movers } = setup();
    still.userData.live = true;
    expect(at(6000)).toBe(true);
    expect(at(6016)).toBe(true);
    expect(movers()).toEqual([still]);
  });
});
