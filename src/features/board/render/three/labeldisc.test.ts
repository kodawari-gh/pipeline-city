// A fan's printed label (`labelDisc`): the face keeps the print where a cylinder's cap had it, and the rim has no uv (it merges with the hub).
import { describe, expect, it } from 'vitest';
import { CylinderGeometry, MeshStandardMaterial } from 'three';
import { labelDisc } from './fans3d';

describe('labelDisc', () => {
  it('maps the print as the cap of a cylinder turned to face +z', () => {
    const r = 50, t = 4, z = 10, sides = 16;
    const [rim, top] = labelDisc(r, t, z, sides, new MeshStandardMaterial(), new MeshStandardMaterial());
    // the old part: a full cylinder, its +y cap turned to +z
    const old = new CylinderGeometry(r, r, t, sides).rotateX(Math.PI / 2), op = old.attributes.position!, ou = old.attributes.uv!, on = old.attributes.normal!;
    const cap: { x: number; y: number; u: number; v: number }[] = [];
    for (let i = 0; i < op.count; i++) if (on.getZ(i) > 0.9) cap.push({ x: op.getX(i), y: op.getY(i), u: ou.getX(i), v: ou.getY(i) });
    const p = top!.geometry.attributes.position!, uv = top!.geometry.attributes.uv!;
    expect(cap.length).toBeGreaterThan(sides);
    for (let i = 0; i < p.count; i++) {
      expect(p.getZ(i)).toBeCloseTo(z + t / 2, 6);
      const same = cap.find((c) => Math.hypot(c.x - p.getX(i), c.y - p.getY(i)) < 1e-4);
      expect(same, `vertex ${i}`).toBeDefined();
      expect(uv.getX(i)).toBeCloseTo(same!.u, 5);
      expect(uv.getY(i)).toBeCloseTo(same!.v, 5);
    }
    expect(rim!.geometry.attributes.uv).toBeUndefined();
  });
});
