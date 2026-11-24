import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3, type Object3D } from 'three';
import { builtinTheme } from '@/core/render/theme';
import { idOf } from '@/core/render/three/pick';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { LAYOUT_CASE, LAYOUT_TIER, setLayoutTier } from '../layout/layout';
import { buildShowcaseModel } from './showcase';

const T = builtinTheme();
const BUILT = [
  'cpu',
  'ram',
  'gpu',
  'npu',
  'nic',
  'cooler',
  'fan',
  'storage',
  'psu',
  'radiator',
  'tpm',
  'vrm-sink',
  'ram-sink',
  'display',
];

describe('the showcase models', () => {
  it('builds every spec of the modelled kinds: solid, resting on the floor, centred', () => {
    for (const s of Object.values(DEVICE_SPECS).filter((x) => BUILT.includes(x.kind))) {
      const m = buildShowcaseModel(s.id, T);
      expect(m, s.id).not.toBeNull();
      const b = new Box3().setFromObject(m!),
        z = b.getSize(b.max.clone()),
        c = b.getCenter(b.max.clone());
      expect(z.x * z.y * z.z, s.id).toBeGreaterThan(0);
      expect(b.min.y, s.id).toBeCloseTo(0, 3);
      expect(Math.abs(c.x) + Math.abs(c.z), s.id).toBeLessThan(1);
    }
  });

  it('builds the cases', () => {
    for (const id of ['case0', 'case1', 'case2', 'case3']) expect(buildShowcaseModel(id, T), id).not.toBeNull();
  });

  it('builds the four routers (the shared model of router3d.ts): solid, resting on the floor, centred, each of its own size', () => {
    const widths = ['router1', 'router2', 'router3', 'router4'].map((id) => {
      const m = buildShowcaseModel(id, T);
      expect(m, id).not.toBeNull();
      const b = new Box3().setFromObject(m!),
        s = b.getSize(b.max.clone()),
        c = b.getCenter(b.max.clone());
      expect(s.x * s.y * s.z, id).toBeGreaterThan(0);
      expect(b.min.y, id).toBeCloseTo(0, 3);
      expect(Math.abs(c.x) + Math.abs(c.z), id).toBeLessThan(1);
      return s.x;
    });
    expect(new Set(widths.map((w) => Math.round(w))).size).toBe(4);
    // (no such router: nothing to show)
    for (const id of ['router0', 'router5']) expect(buildShowcaseModel(id, T), id).toBeNull();
  });

  it('shows a router with every jack light out: a still has no link to light them', () => {
    for (const id of ['router1', 'router4']) {
      let lit = 0;
      buildShowcaseModel(id, T)!.traverse((o) => {
        const m = (o as { material?: { emissive?: { getHex(): number }; emissiveIntensity?: number } }).material;
        // (a jack's lights are green and amber; the status row is cyan or azure)
        if (m?.emissive && [0x58e08a, 0xffb547].includes(m.emissive.getHex()) && (m.emissiveIntensity ?? 0) > 0) lit++;
      });
      expect(lit, id).toBe(0);
    }
  });

  // (a part that wears 2D art runs its reveals from the viewer's frame hook, as the case's reveals run)
  const runFrame = (o: Object3D, z: number): void => {
    const cam = new PerspectiveCamera(30, 1, 1, 1e6);
    cam.position.set(0, 0, z);
    cam.updateMatrixWorld(true);
    o.updateMatrixWorld(true);
    o.traverse((n) => {
      const f = n.userData.frame as ((c: PerspectiveCamera, h: number) => void) | undefined;
      if (f) f(cam, 900);
    });
  };

  it('fades the shell of a router as the camera comes in and shows its board, as the room does', () => {
    for (const id of ['router1', 'router4']) {
      const m = buildShowcaseModel(id, T)!;
      const board = (): boolean => {
        let v = false;
        m.traverse((o) => {
          if (o.userData.id === 'router') v = o.visible;
        });
        return v;
      };
      runFrame(m, 60000);
      expect(board(), id + ' far').toBe(false);
      runFrame(m, 1500);
      expect(board(), id + ' near').toBe(true);
    }
  });

  it('stands a RAM stick with its long side along x', () => {
    const b = new Box3().setFromObject(buildShowcaseModel('ram0', T)!),
      s = b.getSize(b.max.clone());
    expect(s.x).toBeGreaterThan(s.y);
    expect(s.x).toBeGreaterThan(s.z);
  });

  it("turns a NIC to show its parts first: its jacks stand on the viewer's side of the card (+z), as a graphics card shows its cooler", () => {
    for (const id of ['nic1', 'nic2', 'nic3']) {
      const m = buildShowcaseModel(id, T)!;
      m.updateMatrixWorld(true);
      let jack: Object3D | null = null;
      m.traverse((o) => {
        if (idOf(o)?.endsWith('.nic-jack')) jack = o;
      });
      expect(jack, id).not.toBeNull();
      const whole = new Box3().setFromObject(m).getCenter(new Vector3()),
        at = new Box3().setFromObject(jack!).getCenter(new Vector3());
      expect(at.z - whole.z, id).toBeGreaterThan(1);
    }
  });

  it('leaves the live layout as it was, and gives null for an unknown id', () => {
    setLayoutTier(1, 2);
    buildShowcaseModel('case3', T);
    buildShowcaseModel('gpu0', T);
    expect([LAYOUT_TIER, LAYOUT_CASE]).toEqual([1, 2]);
    expect(buildShowcaseModel('nope', T)).toBeNull();
  });
});
