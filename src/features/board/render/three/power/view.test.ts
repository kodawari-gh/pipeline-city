// The power lens's view (docs/render/power.md): the shape of a real machine, the draw of a snapshot, the glow of the parts, and the words of detail that come and go
// with the machine's size on the screen.
import { beforeAll, describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Scene, Vector3 } from 'three';
import { BakeQueue } from '@/core/render/three/artlod';
import { roomGeo } from '@/features/room/render/shell/room';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { Machine3D } from '../machine3d';
import { quietCanvas } from '../testutil';
import { PowerView3D } from './view';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

quietCanvas();

const texts = (v: PowerView3D): string[] => v.wordsNow.map((t) => t.text);

describe('PowerView3D', () => {
  let snap: Snapshot, machine: Machine3D, center: Vector3, size: Vector3;

  beforeAll(() => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
    // (the machine runs: every part draws, so every kind of part has its words)
    const s = g.snapshot(),
      devices = structuredClone(s.devices);
    for (const d of devices) {
      d.powerW = d.kind === 'display' ? 3 : 8;
    }
    snap = {
      ...s,
      powered: true,
      power: { ...s.power, off: false, totalW: 120 },
      devices,
    };
    machine = new Machine3D(snap, roomGeo(), { q: new BakeQueue(), chips: null, inRoom: false });
    const box = new Box3();
    for (const o of machine.caseRoots) {
      box.expandByObject(o);
    }
    center = box.getCenter(new Vector3());
    size = box.getSize(new Vector3());
  });

  /** A camera that looks at the case from the glass side, from a distance at which the case's height takes about `share` of the view's. */
  const cameraAt = (share: number): PerspectiveCamera => {
    const cam = new PerspectiveCamera(30, 16 / 9, 100, 400_000);
    cam.position.set(center.x, center.y, center.z + size.z / 2 + size.y / (2 * share * Math.tan((15 * Math.PI) / 180)));
    cam.lookAt(center);
    cam.updateMatrixWorld();
    return cam;
  };

  it('builds the shape of the machine and draws it on the first frame', () => {
    const scene = new Scene(),
      v = new PowerView3D(scene);
    expect(v.shown).toBe(false);
    v.frame(cameraAt(0.8), 900, snap, machine, 0.016);
    expect(v.shown).toBe(true);
    expect(must(v.shapeNow).lines.length).toBeGreaterThan(20);
    expect(must(v.drawNow).refW).toBeGreaterThanOrEqual(60);
    expect(must(v.flowsNow).strips).toBeGreaterThan(100);
    expect(Number.isFinite(v.cost)).toBe(true);
    v.dispose();
  });

  it('shows every word while the machine is big on the screen', () => {
    const v = new PowerView3D(new Scene());
    v.frame(cameraAt(0.8), 900, snap, machine, 0.016);
    const t = texts(v);
    for (const w of ['WALL', 'SUPPLY', 'CPU', 'RAM']) {
      expect(t.some((x) => x.startsWith(w))).toBe(true);
    }
    v.dispose();
  });

  it('leaves the words of detail out while the machine is small, and keeps the main ones and the scale', () => {
    const v = new PowerView3D(new Scene());
    v.frame(cameraAt(0.2), 900, snap, machine, 0.016);
    const t = texts(v);
    expect(t.some((x) => x.startsWith('WALL'))).toBe(true);
    expect(t.some((x) => x.startsWith('SUPPLY'))).toBe(true);
    expect(t).toContain('');
    for (const w of ['CPU', 'RAM', 'DRIVE', 'FAN HUB']) {
      expect(t.some((x) => x.startsWith(w))).toBe(false);
    }
    v.dispose();
  });

  it('brings the words of detail back as the machine grows, and does not flicker between the two sizes', () => {
    const v = new PowerView3D(new Scene());
    v.frame(cameraAt(0.2), 900, snap, machine, 0.016);
    expect(texts(v).some((x) => x.startsWith('CPU'))).toBe(false);
    // (between the two limits it stays as it was)
    v.frame(cameraAt(0.48), 900, snap, machine, 0.016);
    expect(texts(v).some((x) => x.startsWith('CPU'))).toBe(false);
    v.frame(cameraAt(0.8), 900, snap, machine, 0.016);
    expect(texts(v).some((x) => x.startsWith('CPU'))).toBe(true);
    v.frame(cameraAt(0.48), 900, snap, machine, 0.016);
    expect(texts(v).some((x) => x.startsWith('CPU'))).toBe(true);
    v.dispose();
  });

  it('hides the lens and gives the parts their own look back', () => {
    const v = new PowerView3D(new Scene());
    v.frame(cameraAt(0.8), 900, snap, machine, 0.016);
    v.hide();
    expect(v.shown).toBe(false);
    v.dispose();
  });
});
