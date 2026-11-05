import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial } from 'three';
import { rectBox, worldUv } from './geometry';

/** The uvs of the box's face toward +z (BoxGeometry's fifth face) at its four corners, by corner position (x, y). */
function front(o: ReturnType<typeof rectBox>): Map<string, [number, number]> {
  const g = o.geometry, p = g.getAttribute('position'), uv = g.getAttribute('uv'), m = new Map<string, [number, number]>();
  for (let i = 16; i < 20; i++) m.set(`${p.getX(i) + o.position.x},${p.getY(i) + o.position.y}`, [uv.getX(i), uv.getY(i)]);
  return m;
}

describe('worldUv', () => {
  it('gives a narrow box and a wide one the same texture size, and runs on across boxes that meet', () => {
    const m = new MeshBasicMaterial();
    const narrow = front(worldUv(rectBox({ x: 0, y: 0, w: 1000, h: 8000 }, 0, 100, m), 2000));
    const wide = front(worldUv(rectBox({ x: 1000, y: 0, w: 6000, h: 8000 }, 0, 100, m), 2000));
    // (2D y down: the box's world y runs from 0 down to -8000)
    expect(narrow.get('0,0')).toEqual([0, 0]);
    expect(narrow.get('1000,-8000')).toEqual([0.5, -4]);
    expect(wide.get('1000,0')).toEqual(narrow.get('1000,0'));
    expect(wide.get('7000,-8000')).toEqual([3.5, -4]);
  });
});
