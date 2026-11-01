import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera } from 'three';
import { screenPx } from '@/core/render/three/artlod';
import { liveCrop, livePx, viewOn } from './chips3d';

/** A camera over the layout point (100, 200) at depth 5000, looking straight at the wall. */
function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(30, 1.6, 1, 1e6);
  cam.position.set(100, -200, 5000);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

describe('viewOn', () => {
  it('finds the layout rect the view covers on a plane, and the zoom at its centre', () => {
    const v = viewOn(camera(), 900, 0), h = 2 * 5000 * Math.tan((15 * Math.PI) / 180);
    expect(v.zoom).toBeCloseTo(screenPx(5000, 30, 900), 6);
    expect(v.rect!.h).toBeCloseTo(h, 0);
    expect(v.rect!.w).toBeCloseTo(h * 1.6, 0);
    expect(v.rect!.x + v.rect!.w / 2).toBeCloseTo(100, 0);
    expect(v.rect!.y + v.rect!.h / 2).toBeCloseTo(200, 0); // layout y runs down
  });

  it('reads the plane of a part in its own frame', () => {
    const part = new Group();
    part.position.set(0, 0, 1000);
    part.updateMatrixWorld();
    const v = viewOn(camera(), 900, 0, part.matrixWorld.clone().invert());
    expect(v.zoom).toBeCloseTo(screenPx(4000, 30, 900), 6);
  });

  it('has no rect for a plane behind the camera', () => {
    const v = viewOn(camera(), 900, 9000);
    expect(v.rect).toBeNull();
    expect(v.zoom).toBe(0);
  });
});

describe('liveCrop', () => {
  const face = { x: 0, y: 0, w: 1000, h: 500 };
  it('keeps the part of the face in the view, with a margin', () => {
    expect(liveCrop(face, { x: 800, y: 100, w: 1000, h: 1000 })).toEqual({ x: 700, y: 0, w: 300, h: 500 });
  });
  it('is nothing when the view is elsewhere, and all of it with no view', () => {
    expect(liveCrop(face, { x: 3000, y: 0, w: 500, h: 500 })).toBeNull();
    expect(liveCrop(face, null)).toEqual(face);
  });
});

describe('livePx', () => {
  it('draws at the screen density, capped by the finest level and the widest canvas', () => {
    expect(livePx({ x: 0, y: 0, w: 100, h: 100 }, 4)).toBe(4);
    expect(livePx({ x: 0, y: 0, w: 100, h: 100 }, 40)).toBe(10);
    expect(livePx({ x: 0, y: 0, w: 1000, h: 200 }, 5)).toBeCloseTo(2.048, 6);
  });
});
