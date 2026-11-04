import { describe, expect, it } from 'vitest';
import { LIMITS, clampView, distanceOf, eyeOf, fitHeight, fitRect, keepInside, orbitBy, panBy, reach, sight, stepView, zoomAt, type OrbitView, type Room } from './camera';

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

  describe('kept inside a room', () => {
    const R: Room = { x0: -5000, x1: 5000, y0: -2000, y1: 3000, z0: 500, z1: 8000 };
    const inside = (v: OrbitView) => { const e = eyeOf(v); return e.x >= R.x0 - 1e-6 && e.x <= R.x1 + 1e-6 && e.y >= R.y0 - 1e-6 && e.y <= R.y1 + 1e-6 && e.z <= R.z1 + 1e-6; };

    it('leaves a view that fits as it is', () => {
      const v = { ...V, x: 0, y: 0, z: 1000, height: 1000, fov: 26 };
      expect(keepInside(v, R, { restore: true })).toEqual(v);
    });

    it('widens a room view to keep its height, then shrinks the height', () => {
      const wide = keepInside({ ...V, x: 0, y: 0, z: 1000, height: 5000, fov: 26 }, R, { restore: true });
      expect(wide.height).toBeCloseTo(5000);
      expect(wide.fov).toBeGreaterThan(26);
      expect(inside(wide)).toBe(true);
      const huge = keepInside({ ...V, x: 0, y: 0, z: 1000, height: 30000, fov: 26 }, R, { restore: true });
      expect(huge.fov).toBeCloseTo(40);
      expect(huge.height).toBeLessThan(30000);
      expect(inside(huge)).toBe(true);
    });

    it('never widens a narrow (board) view', () => {
      const v = keepInside({ ...V, x: 0, y: 0, z: 1000, height: 5000, fov: 14 }, R, { restore: true });
      expect(v.fov).toBe(14);
      expect(inside(v)).toBe(true);
    });

    it('narrows a widened goal again once there is room, but not an eased view', () => {
      const v = { ...V, x: 0, y: 0, z: 1000, height: 1000, fov: 38 };
      expect(keepInside(v, R, { restore: true }).fov).toBe(26);
      expect(keepInside(v, R).fov).toBe(38);
    });

    it('holds the eye off the side walls when it orbits, and the target in the room', () => {
      const v = keepInside({ ...V, x: 4000, y: 0, z: 1000, yaw: 1.1, height: 4000, fov: 26 }, R, { restore: true });
      expect(inside(v)).toBe(true);
      const out = keepInside({ ...V, x: 90000, y: -9000, z: -400, height: 500, fov: 26 }, R, { targetZ0: -1000 });
      expect([out.x, out.y, out.z]).toEqual([5000, -2000, -400]);
    });

    it('measures the reach along the line of sight', () => {
      expect(reach({ ...V, x: 0, y: 0, z: 1000 }, R)).toBeCloseTo(7000);
      expect(reach({ ...V, x: 0, y: 0, z: 1000, yaw: Math.PI / 2 }, R)).toBeCloseTo(5000);
    });
  });

  describe('kept out of the furniture', () => {
    const R: Room = { x0: -50000, x1: 50000, y0: -20000, y1: 20000, z0: 0, z1: 60000 };
    // a cupboard in front of the target, between it and the eye
    const B: Room = { x0: -2000, x1: 2000, y0: -20000, y1: 0, z0: 10000, z1: 14000 };
    const near = (v: OrbitView, b: Room, gap: number) => { const e = eyeOf(v); return e.x > b.x0 - gap && e.x < b.x1 + gap && e.y > b.y0 - gap && e.y < b.y1 + gap && e.z > b.z0 - gap && e.z < b.z1 + gap; };

    it('stops the eye short of a block on its line of sight', () => {
      const v = { ...V, x: 0, y: -5000, z: 2000, height: 20000, fov: 26 };
      const t = reach(v, R, [B]);
      expect(t).toBeLessThan(8000);
      expect(t).toBeGreaterThan(7000);
      const k = keepInside(v, R, { blocks: [B], restore: true });
      expect(near(k, B, 149)).toBe(false);
      expect(distanceOf(k)).toBeLessThanOrEqual(t + 1e-6);
    });

    it('lets the eye pass over a block it clears, with room for the near plane', () => {
      const v = { ...V, x: 0, y: 2000, z: 2000, pitch: 0.2, height: 8000, fov: 26 };
      expect(reach(v, R, [B])).toBeCloseTo(reach(v, R));
      // a line of sight that grazes the top: the near plane's lower edge would come down to it
      const graze = { ...v, y: 200, pitch: 0 };
      expect(reach(graze, R, [B])).toBeLessThan(reach(graze, R));
    });

    it('lets the eye off a block the target is at, but not into it', () => {
      // the target on the cupboard's top, the eye above it
      const top = { ...V, x: 0, y: 0, z: 12000, pitch: 0.4, height: 8000, fov: 26 };
      expect(sight(top, R, [B])).toEqual([0, reach(top, R)]);
      // the target just this side of it, or in it: the eye that would go into it goes on through and out of the far side, a close look
      // backs out
      for (const z of [9950, 12000]) {
        const at = { ...V, x: 0, y: -5000, z, height: 1000, fov: 26 }, [n, f] = sight(at, R, [B]);
        expect(f).toBeCloseTo(reach(at, R));
        expect(n).toBeGreaterThan(14150 - z);
        expect(n).toBeLessThan(14150 - z + 400);
        const k = keepInside(at, R, { blocks: [B] });
        expect(near(k, B, 149)).toBe(false);
        expect(eyeOf(k).z).toBeGreaterThan(B.z1);
        // a view from far off is left as it is
        expect(keepInside({ ...at, height: 8000 }, R, { blocks: [B] }).height).toBe(8000);
      }
      // where the room ends first, it stops short of the face (from inside: it backs out to the wall)
      const short = { ...R, z1: 13000 }, back = { ...V, x: 0, y: -5000, z: 9950, height: 8000, fov: 26 };
      expect(sight(back, short, [B])).toEqual([0, expect.closeTo(50)]);
      expect(sight({ ...back, z: 12000 }, short, [B])).toEqual([1000, 1000]);
    });

    it('sizes the near plane for a wide room view', () => {
      // beside a tall block, looking along its face: the wider the fov, the sooner its near plane would reach the face
      const tall: Room = { ...B, y1: 20000 }, v = { ...V, x: 2400, y: 0, z: 2000, height: 8000, fov: 26 };
      expect(reach(v, R, [tall], 40)).toBeLessThan(reach(v, R, [tall], 26));
    });
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
