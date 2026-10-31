import { describe, expect, it } from 'vitest';
import { LIMITS, clampView, distanceOf, eyeOf, fitHeight, fitRect, orbitBy, panBy, stepView, zoomAt, type OrbitView } from './camera';

const V: OrbitView = { x: 100, y: 200, z: 300, yaw: 0, pitch: 0, height: 1000, fov: 30 };

describe('3D camera', () => {
  it('keeps the shown height when the fov changes (a dolly zoom)', () => {
    const near = distanceOf({ height: 1000, fov: 40 }), far = distanceOf({ height: 1000, fov: 8 });
    expect(far).toBeGreaterThan(near * 4);
    expect(2 * far * Math.tan((8 * Math.PI) / 360)).toBeCloseTo(1000);
  });

  it('looks at the target from the front at yaw and pitch zero', () => {
    const e = eyeOf(V);
    expect(e.x).toBeCloseTo(100);
    expect(e.y).toBeCloseTo(200);
    expect(e.z).toBeCloseTo(300 + distanceOf(V));
  });

  it('fits by the tighter of width and height', () => {
    expect(fitHeight(1000, 100, 2, 1)).toBe(500);
    expect(fitHeight(100, 1000, 2, 1)).toBe(1000);
  });

  it('maps a layout rect (y down) to a world target (y up)', () => {
    const v = fitRect({ x: 0, y: 100, w: 200, h: 100 }, 50, 2, V, 1);
    expect([v.x, v.y, v.z]).toEqual([100, -150, 50]);
  });

  it('clamps the angles and the zoom', () => {
    expect(clampView({ ...V, yaw: 9, pitch: 9, height: 1 })).toMatchObject({ yaw: LIMITS.yaw, pitch: LIMITS.pitchMax, height: LIMITS.heightMin });
    expect(orbitBy(V, -9, -9)).toMatchObject({ yaw: -LIMITS.yaw, pitch: LIMITS.pitchMin });
  });

  it('zooms toward the pointer: the point under it stays there', () => {
    const aspect = 2, nx = 0.5, ny = -0.25, z = zoomAt(V, 0.5, nx, ny, aspect);
    expect(z.height).toBe(500);
    // the world point under the pointer, before and after
    expect(V.x + nx * (V.height / 2) * aspect).toBeCloseTo(z.x + nx * (z.height / 2) * aspect);
    expect(V.y + ny * (V.height / 2)).toBeCloseTo(z.y + ny * (z.height / 2));
  });

  it('pans along the screen axes when the camera is turned', () => {
    const p = panBy({ ...V, yaw: Math.PI / 2 }, 10, 0);
    expect(p.x).toBeCloseTo(V.x);
    expect(p.z).toBeCloseTo(V.z - 10);
  });

  it('eases to the goal, the same way at any frame rate', () => {
    const goal = { ...V, x: 500, height: 4000, fov: 8 };
    let a = V, b = V;
    for (let i = 0; i < 60; i++) a = stepView(a, goal, 1 / 60);
    for (let i = 0; i < 20; i++) b = stepView(b, goal, 1 / 20);
    expect(a.x).toBeCloseTo(b.x, 3);
    expect(a.height).toBeCloseTo(b.height, 2);
    expect(a.x).toBeGreaterThan(495);
  });
});
