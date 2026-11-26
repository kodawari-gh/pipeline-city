import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { lerpHex, mat } from '@/core/render/three/materials';
import { BakeQueue } from '@/core/render/three/artlod';
import { builtinTheme } from '@/core/render/theme';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { GEO, setLayoutTier } from '../layout/layout';
import { hexNum } from '../skins';
import { ArtSet } from './artset3d';
import { boardModel, pcieSlot, rgbStrip } from './boardmodel3d';
import type { Spin } from './fans3d';
import { quietCanvas } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

const isMeshStandardMaterial = (o: unknown): o is three.MeshStandardMaterial =>
  typeof o === 'object' && o !== null && 'isMeshStandardMaterial' in o && o.isMeshStandardMaterial === true;
function asMeshStandardMaterial(o: unknown): three.MeshStandardMaterial {
  if (!isMeshStandardMaterial(o)) {
    throw new Error('expected a MeshStandardMaterial');
  }
  return o;
}

quietCanvas();

function assert_draws_its_44_LEDs_as_one_mesh_and_one_lamp_each_(): void {
  const T = builtinTheme(),
    lamps: Spin[] = [],
    r = { x: 100, y: 200, w: 4300, h: 60 };
  const lit: three.Mesh[] = [];
  rgbStrip(r, T, lamps).traverse((o) => {
    if (!isMesh(o)) {
      return;
    }
    const m = o;
    if (asMeshStandardMaterial(m.material).emissiveMap) {
      lit.push(m);
    }
  });
  expect(lit).toHaveLength(1);
  expect(lamps).toHaveLength(1);
  expect(must(lamps[0]).ring).toBe(must(lit[0]).material);
  expect(must(lamps[0]).fixed).toBe(0xff_ff_ff);
  const map = asMeshStandardMaterial(must(lit[0]).material).emissiveMap as three.DataTexture,
    px = map.image.data as Uint8Array;
  expect(map.image.width).toBe(44);
  const g = must(lit[0]).geometry,
    pos = must(g.attributes['position']),
    uv = must(g.attributes['uv']);
  expect(pos.count).toBe(44 * 24);
  for (const k of [0, 13, 43]) {
    // the LED's box stands at its place along the strip, and all its uvs read its texel
    const i = k * 24,
      at = r.x + (k * r.w) / 43,
      c = lerpHex(hexNum(T.alu), hexNum(T.br), k / 43);
    expect(Math.abs(pos.getX(i) - at)).toBeLessThanOrEqual(12);
    expect(Math.floor(uv.getX(i) * 44)).toBe(k);
    expect([...px.slice(4 * k, 4 * k + 3)]).toStrictEqual([(c >> 16) & 255, (c >> 8) & 255, c & 255]);
  }
}

function assert_builds_a_PCIe_slot_with_its_contacts_down_both_w(): void {
  const r = { x: 0, y: 0, w: 2030, h: 60 },
    key = r.x + Math.min(r.w * 0.2, 700);
  const found: three.InstancedMesh[] = [];
  pcieSlot(r, mat(0x33_33_33)).traverse((o) => {
    const mesh = o as three.InstancedMesh;
    if (mesh.isInstancedMesh) {
      found.push(mesh);
    }
  });
  if (found.length === 0) {
    throw new Error('expected instanced slot pins');
  }
  const pins = found[0]!;
  const n = pins.count,
    at = new three.Vector3(),
    m = new three.Matrix4(),
    walls = new Set<number>();
  expect(n).toBeGreaterThan(100);
  for (let i = 0; i < n; i++) {
    pins.getMatrixAt(i, m);
    at.setFromMatrixPosition(m);
    expect(at.x < key - 6 || at.x > key + 24, `pin at ${at.x}`).toBe(true);
    expect(at.x).toBeGreaterThan(r.x + 40);
    expect(at.x).toBeLessThan(r.x + r.w - 50);
    walls.add(Math.round(at.y));
  }
  expect(walls.size).toBe(2);
}

describe('the RGB strip', () => {
  it('draws its 44 LEDs as one mesh and one lamp, each LED on its own texel of the gradient', () => {
    expect.hasAssertions();
    assert_draws_its_44_LEDs_as_one_mesh_and_one_lamp_each_();
  });
});

// (the whole board needs Pixi's document to draw its art: the gallery's screenshots check it)
describe('the gallery board', () => {
  it('builds a PCIe slot with its contacts down both walls of the groove, none on the key', () => {
    expect.hasAssertions();
    assert_builds_a_PCIe_slot_with_its_contacts_down_both_w();
  });
});

describe("the board model's Ethernet chip", () => {
  const T = builtinTheme();
  const model = (tier: number, feat?: { ethernetMbps: number; usbPorts: number; displayPorts: number }) => {
    setLayoutTier(tier, tier);
    return boardModel(new ArtSet(new BakeQueue()), T, tier, feat ? { feat } : {});
  };

  function assert_stands_on_every_board_that_has_the_chip_among_th(): void {
    for (const tier of [1, 2, 3]) {
      const b = model(tier),
        g = must(GEO.phy);
      expect(b.phy, `tier ${tier}`).not.toBeNull();
      expect(must(b.phy).root.parent, `tier ${tier}`).toBe(b.small);
      expect(must(b.phy).root.userData['id'], `tier ${tier}`).toBe('board.nic-ctl');
      expect(must(b.phy).rect.w / g.w, `tier ${tier}`).toBeGreaterThan(0.97);
      expect(must(b.phy).rect.x + must(b.phy).rect.w / 2, `tier ${tier}`).toBeCloseTo(g.x + g.w / 2, 6);
      expect(must(b.phy).rect.y + must(b.phy).rect.h / 2, `tier ${tier}`).toBeCloseTo(g.y + g.h / 2, 6);
      // the die has its floorplan: the live layer has a face to cover, over the board's
      expect(must(b.phy).die, `tier ${tier}`).not.toBeNull();
      expect(must(b.phy).dieTop, `tier ${tier}`).toBeGreaterThan(0);
      expect(BOARD_Z + must(b.phy).dieTop, `tier ${tier}`).toBeLessThan(BOARD_Z + must(b.phy).top);
    }
  }

  it('stands on every board that has the chip, among the small parts, over its rectangle with a die of its own', () => {
    expect.hasAssertions();
    assert_stands_on_every_board_that_has_the_chip_among_th();
  });

  it("is on no board that has none (the first tier's)", () => {
    const b = model(0);
    expect(GEO.phy).toBeNull();
    expect(b.phy).toBeNull();
  });

  it("takes its look from the board's port speed: two plans, not one", () => {
    const fast = model(2, { ethernetMbps: 100, usbPorts: 2, displayPorts: 1 }),
      gig = model(2, { ethernetMbps: 1000, usbPorts: 2, displayPorts: 1 });
    // (same body, another die: the marking and the floorplan differ, the package does not)
    expect(must(fast.phy).rect).toStrictEqual(must(gig.phy).rect);
    expect(must(fast.phy).plan).not.toBe(must(gig.phy).plan);
  });
});
