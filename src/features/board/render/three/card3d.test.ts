import { describe, expect, it } from 'vitest';
import { Box3, Group, Vector3, type Mesh } from 'three';
import { DEVICE_LOD } from '@/core/render/lod/lod';
import { findById } from '@/core/render/three/pick';
import { NIC_FACE } from '@/features/network/render/nic/niclayout';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { nicY, setLayoutTier } from '../layout/layout';
import { HINGE_Z, STAND, card3d, type CardKind } from './card3d';

const build = (kind: CardKind, visual: string, slot = 0) => {
  const art = new Group();
  return { c: card3d(kind, visual, slot, (parent) => { parent.add(art); return art; }), art };
};
/** The box round what is shown (a faded part is hidden). */
const box = (o: Group) => {
  o.updateMatrixWorld(true);
  const b = new Box3();
  o.traverseVisible((m) => { if ((m as Mesh).isMesh && m.children.length === 0) b.union(new Box3().setFromObject(m)); });
  return b;
};

describe('the 3D expansion cards', () => {
  it('stands a card up out of its slot: on edge along the slot, as tall as its kind, its fingers down in the slot', () => {
    setLayoutTier(3, 3);
    for (const [kind, visual] of [['gpu', 'gpu-3'], ['npu', 'npu-1'], ['nic', 'nic-10g']] as const) {
      const { c } = build(kind, visual);
      c.pose(0);
      const b = box(c.root);
      expect(b.max.z, visual).toBeGreaterThan(HINGE_Z + STAND[kind] - 40);
      expect(b.min.z, visual).toBeGreaterThan(BOARD_Z + 40);
      expect(b.min.z, visual).toBeLessThan(HINGE_Z - 40);
      // on edge: the PCB at the slot's line, the cooler hanging south of it (down, standing)
      expect(-b.max.y, visual).toBeLessThan(nicY(0) - 20);
      expect(-b.min.y, visual).toBeGreaterThan(nicY(0) + 100);
    }
  });

  it('fades the cooler, then swings the card down flat to its 2D face up close, and stands it up again', () => {
    setLayoutTier(3, 3);
    const { c, art } = build('gpu', 'gpu-2');
    c.pose(0);
    expect(art.visible).toBe(false);
    c.pose(DEVICE_LOD.gpu.fade[1] + 0.1);
    expect(art.visible).toBe(true);
    const flat = box(c.root);
    expect(flat.max.z).toBeLessThan(HINGE_Z + 5);
    c.pose(0);
    expect(box(c.root).max.z).toBeGreaterThan(HINGE_Z + STAND.gpu - 40);
  });

  it('folds a NIC flat to the north once it swings down: its parts come up on the PCB, its fingers stay at its own slot, the controller\'s die faces the glass with its floorplan upright, and the bodies stand where the card says', () => {
    setLayoutTier(3, 3);
    for (const visual of ['nic-gbe', 'nic-10g', 'nic-40g']) {
      const floor = new Group(), c = card3d('nic', visual, 1, () => { throw new Error('no 2D face'); }, { id: 'pcie1', floor: (frame) => { frame.add(floor); return { root: floor, z: 3 }; } });
      const [swing0, swing1] = [DEVICE_LOD.nic.fade[0] + 0.04, DEVICE_LOD.nic.fade[1]], dir = (v: Vector3) => v.transformDirection(floor.matrixWorld);
      // standing: nothing has folded, the parts hang under the PCB, the die faces down (south, as every card's parts do in a tower)
      c.pose(0);
      expect(c.flat(), visual).toBe(0);
      c.root.updateMatrixWorld(true);
      expect(dir(new Vector3(0, 0, 1)).y, `${visual} standing`).toBeCloseTo(-1, 6);
      // half way the card is up in the air, and clear of the board all the way down
      c.pose((swing0 + swing1) / 2);
      expect(c.flat(), visual).toBeGreaterThan(0.2);
      expect(c.flat(), visual).toBeLessThan(0.8);
      for (let k = 0; k <= 8; k++) {
        c.pose(swing0 + ((swing1 - swing0) * k) / 8);
        expect(box(c.root).min.z, `${visual} swing ${k}`).toBeGreaterThan(BOARD_Z + 40);
      }
      // flat: the die's frame is as the world's (x east, y north: the plan's top is the screen's top), and its face is toward the glass
      c.pose(swing1 + 0.1);
      expect(c.flat(), visual).toBe(1);
      c.root.updateMatrixWorld(true);
      expect(dir(new Vector3(1, 0, 0)).x, `${visual} x`).toBeCloseTo(1, 6);
      expect(dir(new Vector3(0, 1, 0)).y, `${visual} y`).toBeCloseTo(1, 6);
      expect(dir(new Vector3(0, 0, 1)).z, `${visual} z`).toBeCloseTo(1, 6);
      // the card lies north of its slot's line, over its body, and only its finger tab reaches south of the line: its fingers are at its own slot, not at the next one's
      const flat = box(c.root), y0 = nicY(1);
      expect(-flat.min.y, `${visual} fingers`).toBeLessThanOrEqual(y0 + NIC_FACE.south + 1);
      expect(-flat.min.y, `${visual} fingers`).toBeGreaterThanOrEqual(y0 + 100);
      expect(-flat.max.y, `${visual} body`).toBeLessThan(y0 - NIC_FACE.north + 1);
      expect(flat.min.z, `${visual} down`).toBeGreaterThan(HINGE_Z - 60);
      // the die lies where the card says (its footprint, the depth of its top): the plan's middle is on the die's middle
      const d = c.die!, w = floor.localToWorld(new Vector3(d.rect.x + d.rect.w / 2, -(d.rect.y + d.rect.h / 2), 0));
      expect(w.z, visual).toBeCloseTo(d.zTop, 3);
      expect(w.x, visual).toBeCloseTo(d.at.x + d.at.w / 2, 3);
      expect(-w.y, visual).toBeCloseTo(d.at.y + d.at.h / 2, 3);
      // each body stands inside its footprint as the card reports it, and as high as it says
      const ids = c.bodies.map((b) => b.id);
      expect(ids, visual).toEqual(['jack', 'ctl', 'xtal', 'nvm', 'vreg', 'label'].map((p) => `pcie1.nic-${p}`));
      for (const b of c.bodies) {
        const o = findById(c.root, b.id);
        expect(o, `${visual} ${b.id}`).not.toBeNull();
        const bx = new Box3().setFromObject(o!), m = 60;
        expect(bx.min.x, `${visual} ${b.id} x0`).toBeGreaterThanOrEqual(b.rect.x - m);
        expect(bx.max.x, `${visual} ${b.id} x1`).toBeLessThanOrEqual(b.rect.x + b.rect.w + m);
        expect(-bx.max.y, `${visual} ${b.id} y0`).toBeGreaterThanOrEqual(b.rect.y - m);
        expect(-bx.min.y, `${visual} ${b.id} y1`).toBeLessThanOrEqual(b.rect.y + b.rect.h + m);
        if (!b.id.endsWith('label')) { expect(bx.max.z, `${visual} ${b.id} top`).toBeLessThanOrEqual(b.z + m); expect(bx.max.z, `${visual} ${b.id} top`).toBeGreaterThanOrEqual(b.z - m); }
      }
    }
  });

  it('gives a NIC no 2D face, a lid to fade off its die, and no die at all where there is no floorplan to put on it', () => {
    setLayoutTier(3, 3);
    const plain = build('nic', 'nic-gbe').c;
    expect(plain.die).toBeNull();
    expect(plain.lids).toHaveLength(1);
    expect(plain.bodies).toHaveLength(6);
    for (const [kind, visual] of [['gpu', 'gpu-1'], ['npu', 'npu-1']] as const) {
      const c = build(kind, visual).c;
      expect(c.die, visual).toBeNull();
      expect(c.lids, visual).toEqual([]);
      expect(c.bodies, visual).toEqual([]);
      c.pose(1);
      expect(c.flat(), visual).toBe(0);
    }
  });

  it('gives a GPU its fans and its light bar, and puts its power sockets on the top edge', () => {
    setLayoutTier(3, 3);
    for (const [visual, fans, plugs] of [['gpu-1', 1, 0], ['gpu-2', 2, 1], ['gpu-3', 3, 2]] as const) {
      const { c } = build('gpu', visual);
      expect(c.spins.filter((s) => s.ring === null).length, visual).toBe(fans);
      expect(c.spins.filter((s) => s.fixed !== undefined).length, visual).toBe(1);
      expect(c.sockets.length, visual).toBe(plugs);
      for (const s of c.sockets) expect(s.z, visual).toBeGreaterThan(HINGE_Z + STAND.gpu);
    }
  });
});
