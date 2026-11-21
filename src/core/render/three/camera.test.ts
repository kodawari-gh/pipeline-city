import { describe, expect, it } from 'vitest';
import {
  LIMITS, clampView, distanceOf, eyeOf, fitHeight, fitRect, heightAt, keepInside, leanClear, orbitBy, panBy, reach, retarget, settled, sight, stepView, zoomAt,
  zoomAbout, zoomOn, type OrbitView, type Room,
} from './camera';

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

  describe('the target on the surface the player looks at', () => {
    // the screen point of a world point, on a screen 1 tall (y up, -0.5 to 0.5 at the target's distance)
    const onScreen = (v: OrbitView, p: { x: number; y: number; z: number }) => {
      const e = eyeOf(v), s = (e.z - p.z) * 2 * Math.tan((v.fov * Math.PI) / 360);
      return { x: (p.x - e.x) / s, y: (p.y - e.y) / s };
    };

    it('reads the height a view shows on any plane, whatever its target', () => {
      expect(heightAt(V, V.z)).toBeCloseTo(V.height);
      // a plane further back shows more
      expect(heightAt(V, V.z - 500)).toBeCloseTo(V.height + 500 * 2 * Math.tan((V.fov * Math.PI) / 360));
      const turned = { ...V, yaw: 0.3, pitch: 0.2 };
      expect(heightAt(retarget(turned, -400), 1000)).toBeCloseTo(heightAt(turned, 1000));
    });

    it('slides the target onto a plane and keeps the picture', () => {
      for (const v of [V, { ...V, yaw: 0.4, pitch: 0.25 }]) {
        const r = retarget(v, -2000), a = eyeOf(v), b = eyeOf(r);
        expect(r.z).toBeCloseTo(-2000);
        expect([b.x, b.y, b.z].map((n, i) => n - [a.x, a.y, a.z][i]!).every((d) => Math.abs(d) < 1e-6)).toBe(true);
      }
    });

    it('zooms on the surface under the pointer: it stays there, and each notch takes the same share of the way', () => {
      // the target floats 2500 in front of the surface the pointer is on (the overview's, over the board)
      const v = { ...V, x: 0, y: 0, z: 5000, height: 4000, fov: 26 }, p = { x: 300, y: -150, z: 2500 };
      let z = v;
      const gap = [heightAt(z, p.z)];
      for (let i = 0; i < 20; i++) { z = zoomOn(z, p, 0.8); gap.push(heightAt(z, p.z)); }
      const a = onScreen(v, p), b = onScreen(z, p);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
      expect(z.z).toBeCloseTo(p.z);
      for (let i = 1; i < 18; i++) expect(gap[i]! / gap[i - 1]!).toBeCloseTo(0.8);
      // the closest look is reached at the surface, not short of it
      for (let i = 0; i < 60; i++) z = zoomOn(z, p, 0.8);
      expect(heightAt(z, p.z)).toBeCloseTo(LIMITS.heightMin);
    });
  });

  describe('a view that turns all the way round', () => {
    // the screen point of a world point, on a screen 1 tall at the target's distance (y up), and its depth along the line of sight
    const seen = (v: OrbitView, p: { x: number; y: number; z: number }) => {
      const e = eyeOf(v), c = Math.cos(v.pitch), tan = 2 * Math.tan((v.fov * Math.PI) / 360);
      const d = [p.x - e.x, p.y - e.y, p.z - e.z];
      const f = [-Math.sin(v.yaw) * c, -Math.sin(v.pitch), -Math.cos(v.yaw) * c], r = [Math.cos(v.yaw), 0, -Math.sin(v.yaw)];
      const u = [-Math.sin(v.pitch) * Math.sin(v.yaw), Math.cos(v.pitch), -Math.sin(v.pitch) * Math.cos(v.yaw)];
      const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!, depth = dot(d, f);
      return { x: dot(d, r) / (depth * tan), y: dot(d, u) / (depth * tan), depth };
    };
    const LIM = { min: 5, max: 400 }, W: OrbitView = { x: 10, y: 20, z: 30, yaw: 0, pitch: 0.4, height: 100, fov: 28 }, P = { x: 18, y: 31, z: 22 };

    it('keeps the point under the pointer where it is, from any side', () => {
      for (const yaw of [0, 0.9, 2.2, -3, 4.5]) {
        const v = { ...W, yaw }, z = zoomAbout(v, P, 0.5, LIM), a = seen(v, P), b = seen(z, P);
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.y).toBeCloseTo(a.y, 6);
        expect(b.depth).toBeCloseTo(a.depth / 2, 6);
        expect(z.height).toBeCloseTo(a.depth * 2 * Math.tan((W.fov * Math.PI) / 360) * 0.5, 6);
      }
    });

    it('brings the target onto the plane through the point that faces the eye', () => {
      const z = zoomAbout({ ...W, yaw: 1.7 }, P, 0.6, LIM);
      expect(seen(z, { x: z.x, y: z.y, z: z.z }).depth).toBeCloseTo(seen(z, P).depth, 6);
    });

    it('never goes against the way asked, whatever side of the surface the limit lies', () => {
      // the target sits at the closest height; a point in front of its plane is closer than the limit: a zoom in holds, it does not back off
      const near = zoomAbout({ ...W, height: LIM.min }, { x: W.x, y: W.y, z: W.z + 10 }, 0.8, LIM);
      expect(near.height).toBeLessThanOrEqual(LIM.min + 1e-9);
      // and a point behind the target's plane, at the widest height: a zoom out holds, it does not close in
      const far = zoomAbout({ ...W, yaw: 0, pitch: 0, height: LIM.max }, { x: W.x, y: W.y, z: W.z - 50 }, 1.25, LIM);
      expect(far.height).toBeGreaterThanOrEqual(LIM.max - 1e-9);
      // (the same for the board's camera)
      const board = { ...V, height: LIMITS.heightMin }, front = zoomOn(board, { x: board.x, y: board.y, z: board.z + 40 }, 0.8);
      expect(front.height).toBeLessThanOrEqual(LIMITS.heightMin + 1e-9);
    });

    it('stops at its limits, at the surface under the pointer', () => {
      let z = { ...W, yaw: 2.6 };
      for (let i = 0; i < 80; i++) z = zoomAbout(z, P, 0.8, LIM);
      expect(seen(z, P).depth * 2 * Math.tan((W.fov * Math.PI) / 360)).toBeCloseTo(LIM.min, 6);
      for (let i = 0; i < 80; i++) z = zoomAbout(z, P, 1.25, LIM);
      expect(z.height).toBeCloseTo(LIM.max, 6);
    });
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

  describe('a lean over a part inside a case', () => {
    // the target at the origin, the eye 4000 away, the screen 1000 tall by 2 wide; a solid body to the east and in front, like a drive cage
    const at = (a: number): OrbitView => ({ x: 0, y: 0, z: 0, yaw: a, pitch: 0, height: 1000, fov: 14 });
    const cage: Room = { x0: 1500, x1: 3000, y0: -2000, y1: 2000, z0: -500, z1: 3000 };

    it('leans as far as it wants where nothing stands in the way', () => {
      expect(leanClear(at, 0.7, [], 2)).toBe(0.7);
      expect(leanClear(at, 0.7, [{ ...cage, x0: 9000, x1: 9500 }], 2)).toBe(0.7);
      expect(leanClear(at, 0, [cage], 2)).toBe(0);
    });

    it('stops short of the lean that would put a solid body between the eye and the target', () => {
      const got = leanClear(at, 0.7, [cage], 2);
      expect(got).toBeGreaterThan(0.1);
      expect(got).toBeLessThan(0.7);
      // the same for a lean the other way, in the mirror
      const mirror: Room = { ...cage, x0: -cage.x1, x1: -cage.x0 };
      expect(leanClear((a) => at(-a), 0.7, [mirror], 2)).toBeCloseTo(got, 6);
      // asking for more gives no more
      expect(leanClear(at, 1.2, [cage], 2)).toBeCloseTo(got, 1);
    });

    it('gives the lean its sign', () => {
      expect(leanClear((a) => at(a), -0.7, [cage], 2)).toBe(-0.7);
      expect(leanClear((a) => at(a), 0.7, [{ ...cage, x0: -cage.x1, x1: -cage.x0 }], 2)).toBe(0.7);
    });

    it('does not lean at all where the eye is already behind the body', () => {
      expect(leanClear(at, 0.7, [{ ...cage, x0: -500, x1: 500, z0: 500, z1: 3500 }], 2)).toBe(0);
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

  it('calls a view settled once the ease has as good as ended', () => {
    const goal = { ...V, x: 500, height: 4000 };
    let a = V;
    expect(settled(a, goal)).toBe(false);
    for (let i = 0; i < 60; i++) a = stepView(a, goal, 1 / 60);
    expect(settled(a, goal)).toBe(false);
    for (let i = 0; i < 120; i++) a = stepView(a, goal, 1 / 60);
    expect(settled(a, goal)).toBe(true);
  });
});
