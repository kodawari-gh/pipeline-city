import { DirectionalLight, type Material, type Mesh, type Scene } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOW_EVERY, type CityDetail } from './detail';
import { OutsideView } from './view';

/** `OutsideView` as the Low cut will build it (the detail parameter does not exist yet). */
const Detailed = OutsideView as unknown as new (cx: number, cy: number, w: number, h: number, z: number, detail?: CityDetail) => OutsideView;
const inner = (v: OutsideView): { scene: Scene; disposables: Material[] } => v as unknown as { scene: Scene; disposables: Material[] };
const meshes = (v: OutsideView): number => { let n = 0; inner(v).scene.traverse((o) => { if ((o as Mesh).isMesh) n++; }); return n; };
/** The ticks `frame` needs before the picture is due. */
function ticks(v: OutsideView): number {
  for (let n = 1; n <= 20; n++) { v.frame(12, n); if (v.due) return n; }
  return Infinity;
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

  it('Low: the scene has at most 14 meshes', () => {
    expect(meshes(low)).toBeLessThanOrEqual(14);
  });

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
