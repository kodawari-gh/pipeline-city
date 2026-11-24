import { describe, expect, it } from 'vitest';
import { Object3D, PerspectiveCamera } from 'three';
import { ArtSet } from './artset3d';

describe('ArtSet reveals', () => {
  const camAt = (z: number): PerspectiveCamera => {
    const cam = new PerspectiveCamera(30, 1, 1, 1e6);
    cam.position.set(0, 0, z);
    cam.updateMatrixWorld(true);
    return cam;
  };

  it('runs each reveal with the zoom seen at its point (pixels per unit), nearer is larger', () => {
    const art = new ArtSet(),
      at = new Object3D(),
      seen: number[] = [];
    art.reveal(at, (z) => seen.push(z));
    art.look(camAt(4000), 900, 1);
    art.look(camAt(1000), 900, 1);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeGreaterThan(seen[0]!);
    art.dispose();
  });

  it('takes a reveal away with the function it gives back', () => {
    const art = new ArtSet(),
      at = new Object3D();
    let n = 0;
    const undo = art.reveal(at, () => {
      n++;
    });
    art.look(camAt(1000), 900, 1);
    undo();
    art.look(camAt(1000), 900, 1);
    expect(n).toBe(1);
    art.dispose();
  });

  it('shows the part as from up close once opened, whatever the camera', () => {
    const art = new ArtSet(),
      at = new Object3D();
    let z = 0;
    art.reveal(at, (v) => {
      z = v;
    });
    art.open();
    art.look(camAt(60000), 900, 1);
    expect(z).toBe(Infinity);
    art.dispose();
  });
});
