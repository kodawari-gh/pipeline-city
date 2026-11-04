import { describe, expect, it } from 'vitest';
import { distanceOf, eyeOf, keepInside, reach, type OrbitView, type Room } from '@/core/render/three/camera';
import { roomGeo } from '../shell/room';
import { BED, CURTAIN, EAST_X, FLOOR_Y, FRONT_Z, LEDGE, SLAT_W, WEST_X, WINDOW, daylight, eyeBlocks, eyeRoom, slatRuns, sunDir, wallAround } from './roomplan';

const HOLE = { x: 1000, y: 200, w: 1000, h: 400 };

describe('3D room plan', () => {
  it('cuts the slats round the window', () => {
    const runs = slatRuns(0, 4000, 0, 1000, HOLE);
    for (const r of runs) {
      const overlapsX = r.x < HOLE.x + HOLE.w && r.x + SLAT_W > HOLE.x, overlapsY = r.y0 < HOLE.y + HOLE.h && r.y1 > HOLE.y;
      expect(overlapsX && overlapsY).toBe(false);
    }
    expect(runs.some((r) => r.y1 === HOLE.y)).toBe(true);
    expect(runs.some((r) => r.y0 === HOLE.y + HOLE.h)).toBe(true);
  });

  it('builds a wall that covers everything but the hole', () => {
    const area = wallAround(0, 4000, 0, 1000, HOLE).reduce((a, r) => a + r.w * r.h, 0);
    expect(area).toBe(4000 * 1000 - HOLE.w * HOLE.h);
  });

  it('has sun by day and none at night', () => {
    expect(daylight(12)).toBe(1);
    expect(daylight(2)).toBe(0);
    expect(daylight(23)).toBe(0);
    expect(daylight(7)).toBeGreaterThan(0);
    expect(daylight(7)).toBeLessThan(1);
  });

  it('keeps the sun behind the back wall, high at midday and low in the west at dusk', () => {
    for (const h of [6, 9, 12, 14.2, 18, 20.5]) expect(sunDir(h)[2]).toBeLessThan(0);
    expect(sunDir(13)[1]).toBeGreaterThan(0.6);
    expect(sunDir(20.5)[0]).toBeLessThan(0);
    expect(sunDir(20.5)[1]).toBeLessThan(0.05);
  });

  it('holds the eye inside the walls, the window and the floor', () => {
    const r = eyeRoom();
    expect(r.x0).toBeGreaterThan(WEST_X);
    expect(r.x1).toBeLessThan(EAST_X);
    expect(r.y0).toBeGreaterThan(-FLOOR_Y);
    expect(r.z0).toBeGreaterThan(0);
    expect(r.z1).toBeLessThan(FRONT_Z);
    expect(WINDOW.x).toBeGreaterThan(WEST_X);
  });

  describe('the eye and the furniture', () => {
    const r = eyeRoom(), blocks = eyeBlocks(roomGeo());
    const inRoom = (v: OrbitView) => keepInside(v, r, { targetZ0: -3000, fovBase: 26, blocks });
    const inside = (p: { x: number; y: number; z: number }, b: Room, pad = 0) =>
      p.x > b.x0 - pad && p.x < b.x1 + pad && p.y > b.y0 - pad && p.y < b.y1 + pad && p.z > b.z0 - pad && p.z < b.z1 + pad;
    /** The eye and the near plane's corners (NEAR of the way to the target, the widest screen). */
    const points = (v: OrbitView) => {
      const e = eyeOf(v), d = distanceOf(v), n = 0.04 * d, hh = n * Math.tan((v.fov * Math.PI) / 360), hw = hh * 2.4;
      const c = Math.cos(v.pitch), dir = [Math.sin(v.yaw) * c, Math.sin(v.pitch), Math.cos(v.yaw) * c], right = [Math.cos(v.yaw), 0, -Math.sin(v.yaw)];
      const up = [-Math.sin(v.yaw) * Math.sin(v.pitch), c, -Math.cos(v.yaw) * Math.sin(v.pitch)];
      const at = (a: number, b: number) => ({ x: e.x - dir[0]! * n + right[0]! * a + up[0]! * b, y: e.y - dir[1]! * n + up[1]! * b, z: e.z - dir[2]! * n + right[2]! * a + up[2]! * b });
      return [e, at(-hw, -hh), at(hw, -hh), at(-hw, hh), at(hw, hh)];
    };

    it('keeps the eye and its near plane out of every piece, from anywhere in the room, at any angle', () => {
      let n = 0;
      for (let x = r.x0; x <= r.x1; x += 6000) for (let y = r.y0; y <= r.y1; y += 6000) for (let z = -3000; z <= r.z1; z += 6000) {
        // (a target at a piece or in it: the next test)
        if (blocks.some((b) => inside({ x, y, z }, b, 150))) continue;
        for (const yaw of [-1.1, -0.5, 0, 0.5, 1.1]) for (const pitch of [-0.08, 0.2, 0.6]) for (const height of [30000, 6000]) {
          const v = inRoom({ x, y, z, yaw, pitch, height, fov: 26 }), hit = points(v).find((p) => blocks.some((b) => inside(p, b)));
          expect(hit, `${[x, y, z, yaw, pitch, height]}`).toBeUndefined();
          n++;
        }
      }
      expect(n).toBeGreaterThan(5000);
    });

    it('backs the eye out of a piece the target is in: a close look at the pillows, at the bed', () => {
      const cx = BED.x + BED.w / 2;
      let wall = 0;
      for (const [y, z] of [[-(BED.top - 2500), 4000], [-(BED.top + 1000), 20000]] as const) for (const yaw of [-0.6, 0, 0.6]) for (const pitch of [0.05, 0.3, 0.6]) {
        const v = inRoom({ x: cx, y, z, yaw, pitch, height: 1500, fov: 26 }), at = points(v).find((p) => blocks.some((b) => inside(p, b)));
        expect(v.height).toBeGreaterThan(1500);
        // (where the wall comes first, the eye backs out as far as the room lets it)
        if (Math.abs(distanceOf(v) - reach(v, r)) < 1) { wall++; continue; }
        expect(at, `${[y, z, yaw, pitch]}`).toBeUndefined();
      }
      expect(wall).toBeLessThanOrEqual(1);
    });

    it('keeps the eye out of the bookcase in the view along the west wall', () => {
      const v = inRoom({ x: -30000, y: -6000, z: 15000, yaw: -1, pitch: 0.2, height: 30000, fov: 26 });
      expect(points(v).some((p) => blocks.some((b) => inside(p, b)))).toBe(false);
    });

    it('hangs the curtains clear of the ledge and the desk', () => {
      expect(CURTAIN.z - 0.98 * CURTAIN.wave).toBeGreaterThan(LEDGE.z);
      expect(CURTAIN.x3).toBeLessThan(roomGeo().desk.x0);
    });
  });
});
