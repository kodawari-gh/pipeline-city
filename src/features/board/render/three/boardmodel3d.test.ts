import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, Vector3, type DataTexture, type MeshStandardMaterial } from 'three';
import { lerpHex, mat } from '@/core/render/three/materials';
import { builtinTheme } from '@/core/render/theme';
import { hexNum } from '../skins';
import { pcieSlot, rgbStrip } from './boardmodel3d';
import type { Spin } from './fans3d';

describe('the RGB strip', () => {
  it('draws its 44 LEDs as one mesh and one lamp, each LED on its own texel of the gradient', () => {
    const T = builtinTheme(), lamps: Spin[] = [], r = { x: 100, y: 200, w: 4300, h: 60 };
    const lit: Mesh[] = [];
    rgbStrip(r, T, lamps).traverse((o) => { const m = o as Mesh; if (m.isMesh && (m.material as MeshStandardMaterial).emissiveMap) lit.push(m); });
    expect(lit).toHaveLength(1);
    expect(lamps).toHaveLength(1);
    expect(lamps[0]!.ring).toBe(lit[0]!.material);
    expect(lamps[0]!.fixed).toBe(0xffffff);
    const map = (lit[0]!.material as MeshStandardMaterial).emissiveMap as DataTexture, px = map.image.data as Uint8Array;
    expect(map.image.width).toBe(44);
    const g = lit[0]!.geometry, pos = g.attributes.position!, uv = g.attributes.uv!;
    expect(pos.count).toBe(44 * 24);
    for (const k of [0, 13, 43]) {
      // the LED's box stands at its place along the strip, and all its uvs read its texel
      const i = k * 24, at = r.x + (k * r.w) / 43, c = lerpHex(hexNum(T.alu), hexNum(T.br), k / 43);
      expect(Math.abs(pos.getX(i) - at)).toBeLessThanOrEqual(12);
      expect(Math.floor(uv.getX(i) * 44)).toBe(k);
      expect([...px.slice(4 * k, 4 * k + 3)]).toEqual([(c >> 16) & 255, (c >> 8) & 255, c & 255]);
    }
  });
});

// (the whole board needs Pixi's document to draw its art: the gallery's screenshots check it)
describe('the gallery board', () => {
  it('builds a PCIe slot with its contacts down both walls of the groove, none on the key', () => {
    const r = { x: 0, y: 0, w: 2030, h: 60 }, key = r.x + Math.min(r.w * 0.2, 700);
    let pins: InstancedMesh | null = null;
    pcieSlot(r, mat(0x333333)).traverse((o) => { if (o instanceof InstancedMesh) pins = o; });
    expect(pins).not.toBeNull();
    const n = pins!.count, at = new Vector3(), m = new Matrix4(), walls = new Set<number>();
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
