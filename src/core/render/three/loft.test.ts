import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { frameLoft, ribbon, taperTube } from './loft';

describe('frameLoft', () => {
  const profile = [[0, 0], [0, 100], [50, 150], [200, 150]] as const;

  it('spans the rect and the profile height', () => {
    const b = new Box3().setFromBufferAttribute(frameLoft(1000, 600, profile).attributes.position as never);
    expect(b.min.toArray()).toEqual([-500, -300, 0]);
    expect(b.max.toArray()).toEqual([500, 300, 150]);
  });

  it('faces out: the top step looks up, the outer wall looks out', () => {
    const g = frameLoft(1000, 600, profile), p = g.attributes.position!, n = g.attributes.normal!;
    let up = 0, out = 0;
    for (let i = 0; i < p.count; i++) {
      // the bottom side's vertices: the flat top step (z 150) faces +z, the outer wall (inset 0, below the top) faces -y
      if (p.getZ(i) === 150 && n.getZ(i) > 0.9) up++;
      if (p.getY(i) === -300 && p.getZ(i) === 0 && n.getY(i) < -0.9) out++;
    }
    expect(up).toBeGreaterThan(0);
    expect(out).toBeGreaterThan(0);
  });

  it('caps the inner rect when asked', () => {
    const open = frameLoft(1000, 600, profile), shut = frameLoft(1000, 600, profile, { cap: true });
    expect(shut.index!.count - open.index!.count).toBe(6);
  });
});

describe('taperTube', () => {
  it('is thick at its start and thin at its end', () => {
    const g = taperTube([[0, 0, 0], [0, 500, 0], [0, 1000, 0]], 100, 20, 8), p = g.attributes.position!;
    let r0 = 0, r1 = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (Math.abs(p.getY(i)) < 1) r0 = Math.max(r0, r);
      if (Math.abs(p.getY(i) - 1000) < 1) r1 = Math.max(r1, r);
    }
    expect(r0).toBeCloseTo(100, 0);
    expect(r1).toBeCloseTo(20, 0);
  });
});

describe('ribbon', () => {
  it('runs along its points, its width along up', () => {
    const b = new Box3().setFromBufferAttribute(ribbon([[0, 0, 0], [500, 0, 0], [1000, 0, 0]], 200).attributes.position as never);
    expect(b.getSize(new Vector3()).toArray().map(Math.round)).toEqual([1000, 200, 0]);
  });
});
