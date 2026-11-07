import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { mat } from '@/core/render/three/materials';
import { pcieSlot } from './boardmodel3d';

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
