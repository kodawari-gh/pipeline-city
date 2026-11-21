import { describe, expect, it } from 'vitest';
import { AdditiveBlending, Group, PerspectiveCamera, Vector3, type Mesh, type MeshBasicMaterial } from 'three';import { screenPx } from '@/core/render/three/artlod';
import { DEVICE_LOD } from '@/core/render/lod/lod';
import { boardSnap, snap } from '@/core/ui/testdata';
import { BOARD_NIC } from '@/features/network/render/nic/nicplan';
import { BOARD_BAND, boardNicIds, nicGeo, nicParts } from '@/features/network/render/nic/niclayout';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { BD, GEO, NIC_LEN, nicY, setLayoutTier } from '../layout/layout';
import { STAND } from './card3d';
import { Chips3D, liveCrop, livePx, viewOn } from './chips3d';
import { nicLanes } from './nicflow';
import { NIC_LANES, nicCopper } from './niccopper';
import { tabOf } from './pcie';
import { phyChip } from './phychip3d';
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

describe("the Ethernet chip on the motherboard's live layer", () => {
  const LOOKS = [['board-fe', 1], ['board-ge', 3]] as const;
  const scene = (tier: number) => snap({ board: boardSnap({ tier }) });

  /** The chip as the machine builds it, its die's face handed to `c`, and a camera `k` times the zoom the die has shown at (a plain machine's world: layout y down as -y). */
  function over(c: Chips3D, tier: number, look: string, k: number) {
    setLayoutTier(tier, tier);
    const plan = nicGeo(look, BOARD_BAND).die, root = new Group();
    const chip = phyChip(GEO.phy!, look, `${BOARD_NIC}.nic-ctl`, plan, (frame, S) => { const r = new Group(); frame.add(r); return { root: r, z: 3 / S }; });
    root.add(chip.root);
    root.updateMatrixWorld(true);
    c.face(chip.die!.root, 'nic', chip.plan, chip.die!.z, BOARD_NIC);
    // (the live layer draws on a canvas, which Node has none of: its plane is shown as the layer leaves it once it has drawn)
    const plane = chip.die!.root.children[0] as Mesh, m = plane.material as MeshBasicMaterial;
    plane.visible = true;
    m.opacity = 1;
    const H = 900, cam = new PerspectiveCamera(30, 1.6, 1, 1e6), zoom = (k * DEVICE_LOD.die.fade[1]) / chip.scale, d = H / (2 * Math.tan((15 * Math.PI) / 180) * zoom);
    cam.position.set(chip.rect.x + chip.rect.w / 2, -(chip.rect.y + chip.rect.h / 2), BOARD_Z + chip.dieTop + 3 + d);
    cam.updateMatrixWorld();
    return { chip, cam, H };
  }

  it('shows the live floorplan once the mould has gone, and its blocks answer a hover with the board\'s ids', () => {
    for (const [look, tier] of LOOKS) {
      const c = new Chips3D();
      c.setScene(scene(tier));
      const { cam, H } = over(c, tier, look, 4);
      const id = c.hitAt(cam, H, 0, 0);
      expect(id, look).not.toBeNull();
      expect(boardNicIds(look), look).toContain(id);
      expect(id!.startsWith('board.nic-'), look).toBe(true);
    }
  });

  it('answers each block of the die with its own id: the smallest rectangle under the pointer wins over the controller\'s frame', () => {
    for (const [look, tier] of LOOKS) {
      const c = new Chips3D();
      c.setScene(scene(tier));
      const { cam, H, chip } = over(c, tier, look, 4), face = chip.die!.root;
      face.updateWorldMatrix(true, false);
      const blocks = nicParts(nicGeo(look, BOARD_BAND)).filter((p) => p.id !== 'nic-ctl');
      expect(blocks.length, look).toBe(7);
      for (const p of blocks) {
        // (the block's middle, as the screen sees it; a plan's y runs down, the frame's runs up)
        const at = face.localToWorld(new Vector3(p.rect.x + p.rect.w / 2, -(p.rect.y + p.rect.h / 2), chip.die!.z)).project(cam);
        expect(c.hitAt(cam, H, at.x, at.y), `${look} ${p.id}`).toBe(`${BOARD_NIC}.${p.id}`);
      }
    }
  });

  it('has nothing to hit from far away: the zoom is under the part\'s hover zoom', () => {
    const c = new Chips3D();
    c.setScene(scene(3));
    const { cam, H } = over(c, 3, 'board-ge', 0.02);
    expect(c.hitAt(cam, H, 0, 0)).toBeNull();
  });

  it('has no board part on a board with no jack: a face of the board answers nothing', () => {
    const c = new Chips3D();
    c.setScene(scene(0));
    const { cam, H } = over(c, 3, 'board-ge', 4);
    expect(c.hitAt(cam, H, 0, 0)).toBeNull();
    // (with the board's jack the same view hits a block)
    const d = new Chips3D();
    d.setScene(scene(3));
    const v = over(d, 3, 'board-ge', 4);
    expect(d.hitAt(v.cam, v.H, 0, 0)).not.toBeNull();
  });

  it('goes with the scene: a new scene takes the board chip\'s face away', () => {
    const c = new Chips3D();
    c.setScene(scene(3));
    const { cam, H, chip } = over(c, 3, 'board-ge', 4);
    expect(chip.die!.root.children).toHaveLength(1);
    expect(c.hitAt(cam, H, 0, 0)).not.toBeNull();
    c.setScene(null);
    expect(chip.die!.root.children).toHaveLength(0);
    expect(c.hitAt(cam, H, 0, 0)).toBeNull();
  });
});
