// The pick ray and the unseen click boxes (`unseen`): a box on the undrawn layer answers the pointer and costs no draw.
import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera } from 'three';
import { drawnMeshes } from './partlod';
import { idOf, pick, pickPoint, seeThrough, tag, unseen } from './pick';

const camera = (): PerspectiveCamera => {
  const c = new PerspectiveCamera(30, 1, 1, 1000);
  c.position.set(0, 0, 100);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld(true);
  return c;
};
const box = (z: number) => {
  const m = new Mesh(new BoxGeometry(10, 10, 1), new MeshStandardMaterial());
  m.position.z = z;
  return m;
};

describe('the pick ray', () => {
  it('finds an unseen box, which no camera draws', () => {
    const root = new Group(),
      hit = unseen(tag(box(5), 'socket'));
    root.add(hit, box(0));
    root.updateMatrixWorld(true);
    const cam = camera();
    expect(idOf(pick([root], cam, 0, 0))).toBe('socket');
    expect(cam.layers.test(hit.layers)).toBe(false);
    expect(drawnMeshes(root)).toBe(1);
    expect([hit.castShadow, hit.receiveShadow]).toStrictEqual([false, false]);
  });

  it('skips a hidden unseen box and a see-through mesh', () => {
    const root = new Group(),
      hit = unseen(tag(box(5), 'socket')),
      glass = seeThrough(tag(box(8), 'glass')),
      part = tag(box(0), 'part');
    root.add(hit, glass, part);
    root.updateMatrixWorld(true);
    hit.visible = false;
    const cam = camera();
    expect(idOf(pick([root], cam, 0, 0))).toBe('part');
  });

  it('finds the depth of the surface behind a plate that only takes a click (`skip`)', () => {
    const root = new Group(),
      plate = unseen(tag(box(5), 'case.side')),
      part = tag(box(0), 'part');
    root.add(plate, part);
    root.updateMatrixWorld(true);
    const cam = camera();
    expect(pickPoint([root], cam, 0, 0)?.z).toBeCloseTo(5.5);
    expect(pickPoint([root], cam, 0, 0, (o) => idOf(o) === 'case.side')?.z).toBeCloseTo(0.5);
    expect(pickPoint([root], cam, 0, 0, () => true)).toBeNull();
  });
});
