import { describe, expect, it } from 'vitest';
import { Box3, Raycaster, Vector3, type Mesh } from 'three';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { PKG } from '../layout/layout';
import { CPU_Z } from './cpu3d';
import { coolerFoot, coolerModel } from './cooler3d';
import { RINGS, footShade } from './footshade3d';

describe('Low contact shade', () => {
  const r = { x: 100, y: 200, w: 1000, h: 600 },
    reach = 300,
    peak = 0.4;

  it('is darkest under and at the footprint, gone at its reach, its outline the footprint grown by the reach', () => {
    const m = footShade(r, reach, peak, 50),
      pos = m.geometry.attributes.position!,
      col = m.geometry.attributes.color!;
    expect(col.itemSize).toBe(4);
    expect(col.getW(0)).toBeCloseTo(peak);
    const per = (pos.count - 1) / RINGS.length,
      last = 1 + (RINGS.length - 1) * per;
    for (let i = 1; i < 1 + per; i++) expect(col.getW(i)).toBeCloseTo(peak);
    for (let i = last; i < pos.count; i++) expect(col.getW(i)).toBe(0);
    const b = new Box3().setFromBufferAttribute(pos as never);
    expect(b.min.x).toBeCloseTo(r.x - reach);
    expect(b.max.x).toBeCloseTo(r.x + r.w + reach);
    expect(b.max.y).toBeCloseTo(-r.y + reach);
    expect(b.min.y).toBeCloseTo(-(r.y + r.h) - reach);
  });

  it('faces +z, draws once with no depth write, and is not hit', () => {
    const m = footShade(r, reach, peak),
      pos = m.geometry.attributes.position!,
      ix = m.geometry.index!;
    let area = 0;
    for (let t = 0; t < ix.count; t += 3) {
      const [a, b, c] = [ix.getX(t), ix.getX(t + 1), ix.getX(t + 2)];
      const s =
        (pos.getX(b) - pos.getX(a)) * (pos.getY(c) - pos.getY(a)) -
        (pos.getY(b) - pos.getY(a)) * (pos.getX(c) - pos.getX(a));
      expect(s).toBeGreaterThanOrEqual(-1e-6);
      area += s / 2;
    }
    expect(area).toBeGreaterThan(r.w * r.h);
    expect(m.material).toMatchObject({ transparent: true, depthWrite: false, vertexColors: true });
    const ray = new Raycaster(new Vector3(r.x + 10, -r.y - 10, 100), new Vector3(0, 0, -1));
    expect(ray.intersectObject(m)).toHaveLength(0);
  });

  it('lies round each cooler: over the CPU package, inside the reach of its mount on the board', () => {
    for (const visual of ['cooler-liquid', 'cooler-tower', 'cooler-stock']) {
      const { r: f } = coolerFoot(visual),
        model = coolerModel(visual).root;
      expect(f.x <= PKG.x && f.y <= PKG.y && f.x + f.w >= PKG.x + PKG.w && f.y + f.h >= PKG.y + PKG.h, visual).toBe(
        true,
      );
      // what of the cooler stands low over the board (not the back plate behind it, not the fins or fans high over it): its mount's
      // hardware at the four holes reaches furthest; the foot keeps within a little of it
      const near = new Box3();
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        if (!(o as Mesh).isMesh) return;
        const b = new Box3().setFromObject(o);
        if (b.max.z > BOARD_Z && b.min.z < CPU_Z.top + 120) near.union(b);
      });
      expect(f.x, visual).toBeGreaterThanOrEqual(near.min.x - 160);
      expect(f.x + f.w, visual).toBeLessThanOrEqual(near.max.x + 160);
      expect(f.y, visual).toBeGreaterThanOrEqual(-near.max.y - 160);
      expect(f.y + f.h, visual).toBeLessThanOrEqual(-near.min.y + 160);
    }
  });
});
