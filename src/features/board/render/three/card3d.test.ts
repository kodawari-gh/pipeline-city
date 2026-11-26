import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { DEVICE_LOD } from '@/core/render/lod/lod';
import { findById } from '@/core/render/three/pick';
import { NIC_FACE } from '@/features/network/render/nic/niclayout';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { nicY, setLayoutTier } from '../layout/layout';
import * as card3d from './card3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

const build = (kind: card3d.CardKind, visual: string, slot = 0) => {
  const art = new three.Group();
  return {
    c: card3d.card3d(kind, visual, slot, (parent) => {
      parent.add(art);
      return art;
    }),
    art,
  };
};
/** The box round what is shown (a faded part is hidden). */
const box = (o: three.Group) => {
  o.updateMatrixWorld(true);
  const b = new three.Box3();
  o.traverseVisible((m) => {
    if (isMesh(m) && m.children.length === 0) {
      b.union(new three.Box3().setFromObject(m));
    }
  });
  return b;
};

function assert_stands_a_card_up_out_of_its_slot_on_edge_along_t(): void {
  setLayoutTier(3, 3);
  for (const [kind, visual] of [
    ['gpu', 'gpu-3'],
    ['npu', 'npu-1'],
    ['nic', 'nic-10g'],
  ] as const) {
    const { c } = build(kind, visual);
    c.pose(0);
    const b = box(c.root);
    expect(b.max.z).toBeGreaterThan(card3d.HINGE_Z + card3d.STAND[kind] - 40);
    expect(b.min.z).toBeGreaterThan(BOARD_Z + 40);
    expect(b.min.z).toBeLessThan(card3d.HINGE_Z - 40);
    // on edge: the PCB at the slot's line, the cooler hanging south of it (down, standing)
    expect(-b.max.y).toBeLessThan(nicY(0) - 20);
    expect(-b.min.y).toBeGreaterThan(nicY(0) + 100);
  }
}

function assert_fades_the_cooler_and_shows_the_2D_face_on_the_st(): void {
  setLayoutTier(3, 3);
  const { c, art } = build('gpu', 'gpu-2');
  const up = () => {
    c.root.updateMatrixWorld(true);
    return art.getWorldDirection(new three.Vector3());
  };
  c.pose(0);
  expect(art.visible).toBe(false);
  expect(up().y).toBeCloseTo(1, 6);
  const before = box(c.root);
  for (const zoom of [
    0.1,
    DEVICE_LOD.gpu.fade[0],
    (DEVICE_LOD.gpu.fade[0] + DEVICE_LOD.gpu.fade[1]) / 2,
    DEVICE_LOD.gpu.fade[1] + 0.1,
    5,
  ]) {
    c.pose(zoom);
    // (the face looks north, up in the tower, whatever the zoom: the card stays on its slot's line, standing)
    expect(up().y, `zoom ${zoom}`).toBeCloseTo(1, 6);
    expect(box(c.root).min.z, `zoom ${zoom}`).toBeGreaterThan(BOARD_Z + 40);
  }
  expect(art.visible).toBe(true);
  // (the cooler and the upper PCB are gone, the part on the slot's line stays where it stood)
  const bare = box(c.root);
  expect(bare.max.z).toBeLessThan(before.max.z);
  expect(bare.max.z).toBeGreaterThan(card3d.HINGE_Z + 100);
  c.pose(0);
  expect(box(c.root).max.z).toBeGreaterThan(card3d.HINGE_Z + card3d.STAND.gpu - 40);
}

function assert_puts_a_card_s_face_and_each_part_s_where_the_sta(): void {
  setLayoutTier(3, 3);
  const y0 = nicY(2),
    at = card3d.standIn(2, { x: 500, y: y0 + 100, w: 400, h: 300 }, card3d.HINGE_Z + 50);
  // (east-west as it was; its middle is 250 south of the line, so 250 toward the glass; its top is 50 over the PCB, so 50 over the line's height)
  expect(at).toStrictEqual({ x: 500, w: 400, z: card3d.HINGE_Z + 250, d: 300, y: -y0 + 50 });
  for (const [kind, visual] of [
    ['gpu', 'gpu-3'],
    ['npu', 'npu-1'],
    ['nic', 'nic-10g'],
  ] as const) {
    const f = build(kind, visual, 2).c.face;
    expect(f.y).toBeCloseTo(-y0, 6);
    expect(f.z - f.d / 2).toBeCloseTo(card3d.HINGE_Z, 6);
    expect(f.d).toBeGreaterThan(300);
    expect(f.d).toBeLessThanOrEqual(card3d.STAND[kind]);
  }
}

function assert_keeps_a_NIC_standing_as_its_cooler_fades_its_par(): void {
  setLayoutTier(3, 3);
  for (const visual of ['nic-gbe', 'nic-10g', 'nic-40g']) {
    const floor = new three.Group(),
      c = card3d.card3d(
        'nic',
        visual,
        1,
        () => {
          throw new Error('no 2D face');
        },
        {
          id: 'pcie1',
          floor: (frame) => {
            frame.add(floor);
            return { root: floor, z: 3 };
          },
        },
      );
    const [show0, show1] = [DEVICE_LOD.nic.fade[0] + 0.04, DEVICE_LOD.nic.fade[1]],
      dir = (v: three.Vector3) => v.transformDirection(floor.matrixWorld);
    // the detail comes in with the zoom: none far away, all of it past the band, and the card is where it was all the way
    c.pose(0);
    expect(c.detail()).toBe(0);
    c.pose((show0 + show1) / 2);
    expect(c.detail()).toBeGreaterThan(0.2);
    expect(c.detail()).toBeLessThan(0.8);
    for (let k = 0; k <= 8; k++) {
      c.pose(show0 + ((show1 - show0) * k) / 8);
      c.root.updateMatrixWorld(true);
      // (the parts are on the PCB's top face and the die faces north: up in the tower, toward the camera: a mirror of the tower's card, whose parts face down; the plan's top is away from the glass)
      expect(dir(new three.Vector3(0, 0, 1)).y, `${visual} up ${k}`).toBeCloseTo(1, 6);
      expect(dir(new three.Vector3(1, 0, 0)).x, `${visual} x ${k}`).toBeCloseTo(1, 6);
      expect(dir(new three.Vector3(0, 1, 0)).z, `${visual} top ${k}`).toBeCloseTo(-1, 6);
      expect(box(c.root).min.z, `${visual} ${k}`).toBeGreaterThan(BOARD_Z + 40);
    }
    c.pose(show1 + 0.1);
    expect(c.detail()).toBe(1);
    // the card stands on its slot's line (its own, not the previous one's): its parts stand over the PCB's top face, up to the jacks' height, its fingers go down into the slot, and its mask runs up to the card's height
    const bare = box(c.root),
      y0 = nicY(1);
    expect(-bare.max.y, `${visual} parts`).toBeLessThanOrEqual(y0 - 100);
    expect(-bare.max.y, `${visual} parts`).toBeGreaterThanOrEqual(y0 - card3d.SLOT_BAY.north - 1);
    expect(bare.min.z, `${visual} fingers`).toBeLessThan(card3d.HINGE_Z - 40);
    expect(bare.max.z, `${visual} face`).toBeGreaterThan(card3d.HINGE_Z + NIC_FACE.south - 1);
    expect(bare.max.z, `${visual} face`).toBeLessThanOrEqual(card3d.HINGE_Z + card3d.STAND.nic + 1);
    // the die stands where the card says: the plan's middle is on the die's middle, at the depth of its top over the line's height
    const d = must(c.die),
      w = floor.localToWorld(new three.Vector3(d.rect.x + d.rect.w / 2, -(d.rect.y + d.rect.h / 2), 0));
    expect(w.y).toBeCloseTo(d.stand.y, 3);
    expect(w.x).toBeCloseTo(d.stand.x + d.stand.w / 2, 3);
    expect(w.z).toBeCloseTo(d.stand.z, 3);
    // each body stands inside its footprint as the card reports it, and as high as it says
    const ids = c.bodies.map((b) => b.id);
    expect(ids).toStrictEqual(['jack', 'ctl', 'xtal', 'nvm', 'vreg', 'label'].map((p) => `pcie1.nic-${p}`));
    for (const b of c.bodies) {
      const o = findById(c.root, b.id);
      expect(o, `${visual} ${b.id}`).not.toBeNull();
      const bx = new three.Box3().setFromObject(must(o)),
        m = 60,
        l = b.lie;
      expect(bx.min.x, `${visual} ${b.id} x0`).toBeGreaterThanOrEqual(l.x - m);
      expect(bx.max.x, `${visual} ${b.id} x1`).toBeLessThanOrEqual(l.x + l.w + m);
      expect(bx.min.z, `${visual} ${b.id} z0`).toBeGreaterThanOrEqual(l.z - l.d / 2 - m);
      expect(bx.max.z, `${visual} ${b.id} z1`).toBeLessThanOrEqual(l.z + l.d / 2 + m);
      if (!b.id.endsWith('label')) {
        expect(bx.max.y, `${visual} ${b.id} top`).toBeLessThanOrEqual(l.y + m);
        expect(bx.max.y, `${visual} ${b.id} top`).toBeGreaterThanOrEqual(l.y - m);
      }
    }
  }
}

function assert_gives_a_NIC_no_2D_face_a_lid_to_fade_off_its_die(): void {
  setLayoutTier(3, 3);
  const plain = build('nic', 'nic-gbe').c;
  expect(plain.die).toBeNull();
  expect(plain.lids).toHaveLength(1);
  expect(plain.bodies).toHaveLength(6);
  for (const [kind, visual] of [
    ['gpu', 'gpu-1'],
    ['npu', 'npu-1'],
  ] as const) {
    const { c } = build(kind, visual);
    expect(c.die).toBeNull();
    expect(c.lids).toStrictEqual([]);
    expect(c.bodies).toStrictEqual([]);
    c.pose(1);
    expect(c.detail()).toBe(0);
  }
}

function assert_gives_a_GPU_its_fans_and_its_light_bar_and_puts_(): void {
  setLayoutTier(3, 3);
  for (const [visual, fans, plugs] of [
    ['gpu-1', 1, 0],
    ['gpu-2', 2, 1],
    ['gpu-3', 3, 2],
  ] as const) {
    const { c } = build('gpu', visual);
    expect(c.spins.filter((s) => s.ring === null)).toHaveLength(fans);
    expect(c.spins.filter((s) => s.fixed !== undefined)).toHaveLength(1);
    expect(c.sockets).toHaveLength(plugs);
    for (const s of c.sockets) {
      expect(s.z).toBeGreaterThan(card3d.HINGE_Z + card3d.STAND.gpu);
    }
  }
}

describe('the 3D expansion cards', () => {
  it('stands a card up out of its slot: on edge along the slot, as tall as its kind, its fingers down in the slot', () => {
    expect.hasAssertions();
    assert_stands_a_card_up_out_of_its_slot_on_edge_along_t();
  });

  it('fades the cooler and shows the 2D face on the standing card up close, and never turns the card', () => {
    expect.hasAssertions();
    assert_fades_the_cooler_and_shows_the_2D_face_on_the_st();
  });

  it("puts a card's face, and each part's, where the standing card has them: `standIn` turns the flat pose a quarter about the slot's line", () => {
    expect.hasAssertions();
    assert_puts_a_card_s_face_and_each_part_s_where_the_sta();
  });

  it("keeps a NIC standing as its cooler fades: its parts, its jacks too, are on the PCB's top face, its fingers are at its own slot, the controller's die faces up with its floorplan upright, and the bodies stand where the card says", () => {
    expect.hasAssertions();
    assert_keeps_a_NIC_standing_as_its_cooler_fades_its_par();
  });

  it('gives a NIC no 2D face, a lid to fade off its die, and no die at all where there is no floorplan to put on it', () => {
    expect.hasAssertions();
    assert_gives_a_NIC_no_2D_face_a_lid_to_fade_off_its_die();
  });

  it('gives a GPU its fans and its light bar, and puts its power sockets on the top edge', () => {
    expect.hasAssertions();
    assert_gives_a_GPU_its_fans_and_its_light_bar_and_puts_();
  });
});
