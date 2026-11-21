import { describe, expect, it } from 'vitest';
import { AdditiveBlending, Group, PerspectiveCamera, type Mesh, type MeshBasicMaterial } from 'three';
import { screenPx } from '@/core/render/three/artlod';
import { BD, NIC_LEN, nicY, setLayoutTier } from '../layout/layout';
import { STAND } from './card3d';
import { Chips3D, liveCrop, livePx, viewOn } from './chips3d';
import { nicLanes } from './nicflow';
import { NIC_LANES, nicCopper } from './niccopper';
import { tabOf } from './pcie';
import { quietCanvas } from './testutil';

quietCanvas();

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

describe("a network card's lit copper", () => {
  const lanesOf = (visual: string, slot: number) => {
    const y0 = nicY(slot), x1 = BD.x + NIC_LEN[visual]!, f = { x0: BD.x, x1, xe: x1, y0, end: y0 + STAND.nic };
    return nicLanes(nicCopper(visual, f, tabOf(slot, x1, NIC_LANES[visual]!)), slot);
  };

  it('stands on a plane of its own, its light added to the mask under it, drawn only while a packet runs', () => {
    setLayoutTier(3, 3);
    const c = new Chips3D(), parent = new Group(), lanes = lanesOf('nic-gbe', 0);
    c.setScene(null);
    c.traces(parent, 'pcie0', lanes, 5);
    expect(parent.children).toHaveLength(1);
    const mesh = parent.children[0] as Mesh, m = mesh.material as MeshBasicMaterial;
    expect(m.blending).toBe(AdditiveBlending);
    expect(m.depthWrite).toBe(false);
    expect(m.polygonOffset).toBe(true);
    // (no packet: nothing to draw, so the plane is not shown, here or after a frame)
    expect(mesh.visible).toBe(false);
    const cam = new PerspectiveCamera(30, 1.6, 1, 1e6);
    cam.position.set(lanes.rect.x + lanes.rect.w / 2, -(lanes.rect.y + lanes.rect.h / 2), 600);
    c.frame(cam, 900, 0.016, false, 1);
    expect(mesh.visible).toBe(false);
    // the card has nothing to point at on it: a hit there is no part
    expect(c.hitAt(cam, 900, 0, 0)).toBeNull();
  });

  it('has no plane for a card with no such copper, and goes with the scene', () => {
    setLayoutTier(3, 3);
    const c = new Chips3D(), parent = new Group(), lanes = lanesOf('nic-gbe', 0);
    c.setScene(null);
    c.traces(parent, 'pcie1', { ...lanes, media: [], host: [] }, 5);
    expect(parent.children).toHaveLength(0);
    c.traces(parent, 'pcie0', lanes, 5);
    expect(parent.children).toHaveLength(1);
    c.setScene(null);
    expect(parent.children).toHaveLength(0);
  });
});
