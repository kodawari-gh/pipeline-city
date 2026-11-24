import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, Vector3, type DataTexture, type MeshStandardMaterial } from 'three';
import { lerpHex, mat } from '@/core/render/three/materials';
import { BakeQueue } from '@/core/render/three/artlod';
import { builtinTheme } from '@/core/render/theme';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { GEO, setLayoutTier } from '../layout/layout';
import { hexNum } from '../skins';
import { ArtSet } from './artset3d';
import { boardModel, pcieSlot, rgbStrip } from './boardmodel3d';
import type { Spin } from './fans3d';
import { MM } from './pcbkit3d';
import { quietCanvas } from './testutil';

quietCanvas();

describe('the RGB strip', () => {
  it('draws its 44 LEDs as one mesh and one lamp, each LED on its own texel of the gradient', () => {
    const T = builtinTheme(),
      lamps: Spin[] = [],
      r = { x: 100, y: 200, w: 4300, h: 60 };
    const lit: Mesh[] = [];
    rgbStrip(r, T, lamps).traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && (m.material as MeshStandardMaterial).emissiveMap) lit.push(m);
    });
    expect(lit).toHaveLength(1);
    expect(lamps).toHaveLength(1);
    expect(lamps[0]!.ring).toBe(lit[0]!.material);
    expect(lamps[0]!.fixed).toBe(0xffffff);
    const map = (lit[0]!.material as MeshStandardMaterial).emissiveMap as DataTexture,
      px = map.image.data as Uint8Array;
    expect(map.image.width).toBe(44);
    const g = lit[0]!.geometry,
      pos = g.attributes['position']!,
      uv = g.attributes['uv']!;
    expect(pos.count).toBe(44 * 24);
    for (const k of [0, 13, 43]) {
      // the LED's box stands at its place along the strip, and all its uvs read its texel
      const i = k * 24,
        at = r.x + (k * r.w) / 43,
        c = lerpHex(hexNum(T.alu), hexNum(T.br), k / 43);
      expect(Math.abs(pos.getX(i) - at)).toBeLessThanOrEqual(12);
      expect(Math.floor(uv.getX(i) * 44)).toBe(k);
      expect([...px.slice(4 * k, 4 * k + 3)]).toEqual([(c >> 16) & 255, (c >> 8) & 255, c & 255]);
    }
  });
});

// (the whole board needs Pixi's document to draw its art: the gallery's screenshots check it)
describe('the gallery board', () => {
  it('builds a PCIe slot with its contacts down both walls of the groove, none on the key', () => {
    const r = { x: 0, y: 0, w: 2030, h: 60 },
      key = r.x + Math.min(r.w * 0.2, 700);
    let pins: InstancedMesh | null = null;
    pcieSlot(r, mat(0x333333)).traverse((o) => {
      if (o instanceof InstancedMesh) pins = o;
    });
    expect(pins).not.toBeNull();
    const n = pins!.count,
      at = new Vector3(),
      m = new Matrix4(),
      walls = new Set<number>();
    expect(n).toBeGreaterThan(100);
    for (let i = 0; i < n; i++) {
      pins!.getMatrixAt(i, m);
      at.setFromMatrixPosition(m);
      expect(at.x < key - 6 || at.x > key + 24, `pin at ${at.x}`).toBe(true);
      expect(at.x).toBeGreaterThan(r.x + 40);
      expect(at.x).toBeLessThan(r.x + r.w - 50);
      walls.add(Math.round(at.y));
    }
    expect(walls.size).toBe(2);
  });
});

describe("the board model's Ethernet chip", () => {
  const T = builtinTheme();
  const model = (tier: number, feat?: { ethernetMbps: number; usbPorts: number; displayPorts: number }) => {
    setLayoutTier(tier, tier);
    return boardModel(new ArtSet(new BakeQueue()), T, tier, feat ? { feat } : {});
  };

  it('stands on every board that has the chip, among the small parts, over its rectangle with a die of its own', () => {
    for (const tier of [1, 2, 3]) {
      const b = model(tier),
        g = GEO.phy!;
      expect(b.phy, `tier ${tier}`).not.toBeNull();
      expect(b.phy!.root.parent, `tier ${tier}`).toBe(b.small);
      expect(b.phy!.root.userData['id'], `tier ${tier}`).toBe('board.nic-ctl');
      expect(b.phy!.rect.w / g.w, `tier ${tier}`).toBeGreaterThan(0.97);
      expect(b.phy!.rect.x + b.phy!.rect.w / 2, `tier ${tier}`).toBeCloseTo(g.x + g.w / 2, 6);
      expect(b.phy!.rect.y + b.phy!.rect.h / 2, `tier ${tier}`).toBeCloseTo(g.y + g.h / 2, 6);
      // the die has its floorplan: the live layer has a face to cover, over the board's
      expect(b.phy!.die, `tier ${tier}`).not.toBeNull();
      expect(b.phy!.dieTop, `tier ${tier}`).toBeGreaterThan(0);
      expect(BOARD_Z + b.phy!.dieTop, `tier ${tier}`).toBeLessThan(BOARD_Z + b.phy!.top);
    }
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
    expect(fast.phy!.rect).toEqual(gig.phy!.rect);
    expect(fast.phy!.plan).not.toBe(gig.phy!.plan);
  });
});
