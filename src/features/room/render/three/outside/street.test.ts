import { Box3, Vector3, type Mesh } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOW_FURNITURE_M, type CityDetail } from './detail';
import { makeKit, type Kit } from './kit';
import { trees, type Tree } from './plan';
import { street } from './street';

type Out = ReturnType<typeof street>;
/** `street` as the Low cut will call it (the third parameter does not exist yet). */
const withDetail = street as (k: Kit, ts: readonly Tree[], detail?: CityDetail) => Out;

/** The small things of the kit's iron (drains, grilles): their distance from the window (m). */
function furniture(o: Out, k: Kit): number[] {
  o.group.updateMatrixWorld(true);
  const out: number[] = [], c = new Vector3(), s = new Vector3();
  o.group.traverse((m) => {
    if (!(m as Mesh).isMesh || (m as Mesh).material !== k.iron) return;
    const b = new Box3().setFromObject(m);
    if (b.getSize(s).length() > 3) return;
    b.getCenter(c);
    out.push(Math.hypot(c.x, c.z));
  });
  return out;
}
const meshes = (o: Out): number => { let n = 0; o.group.traverse((m) => { if ((m as Mesh).isMesh) n++; }); return n; };

describe('street detail', () => {
  let k: Kit, ts: Tree[], high: Out, low: Out;
  beforeAll(() => { k = makeKit(); ts = trees(); high = street(k, ts); low = withDetail(k, ts, 'low'); }, 60000);

  it('lock: High is the same with the detail omitted or "high"', () => {
    const again = withDetail(k, ts, 'high');
    expect(meshes(again)).toBe(meshes(high));
    expect(furniture(again, k)).toEqual(furniture(high, k));
  }, 60000);

  it('Low: has fewer meshes than High', () => {
    expect(meshes(low)).toBeLessThan(meshes(high));
  });

  it('Low: no furniture past LOW_FURNITURE_M, and some inside it', () => {
    expect(furniture(high, k).some((d) => d > LOW_FURNITURE_M)).toBe(true);
    expect(furniture(low, k).filter((d) => d > LOW_FURNITURE_M)).toEqual([]);
    expect(furniture(low, k).some((d) => d <= LOW_FURNITURE_M)).toBe(true);
  });

  it('Low: the lamps\' lights and the signals are unchanged', () => {
    expect(low.lights.map((v) => v.toArray())).toEqual(high.lights.map((v) => v.toArray()));
    expect(low.signals).toEqual(high.signals);
  });
});
