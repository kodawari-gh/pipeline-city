import { describe, expect, it } from 'vitest';
import { Box3, Group, type Mesh } from 'three';
import { DEVICE_LOD } from '@/core/render/lod/lod';
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
