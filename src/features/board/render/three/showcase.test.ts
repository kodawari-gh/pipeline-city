import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { builtinTheme } from '@/core/render/theme';
import { idOf } from '@/core/render/three/pick';
import { DEVICE_SPECS } from '@/features/board/sim/specs';
import { LAYOUT_CASE, LAYOUT_TIER, setLayoutTier } from '../layout/layout';
import { buildShowcaseModel } from './showcase';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Returns `value` when it is present, otherwise `fallback`. */
function or<T>(value: T, fallback: NonNullable<T>): NonNullable<T> {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}

const T = builtinTheme();
const BUILT = new Set([
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
]);

function assert_builds_every_spec_of_the_modelled_kinds_solid_re(): void {
  for (const s of Object.values(DEVICE_SPECS).filter((x) => BUILT.has(x.kind))) {
    const m = buildShowcaseModel(s.id, T);
    expect(m).not.toBeNull();
    const b = new three.Box3().setFromObject(must(m)),
      z = b.getSize(b.max.clone()),
      c = b.getCenter(b.max.clone());
    expect(z.x * z.y * z.z).toBeGreaterThan(0);
    expect(b.min.y).toBeCloseTo(0, 3);
    expect(Math.abs(c.x) + Math.abs(c.z)).toBeLessThan(1);
  }
}

function assert_builds_the_cases(): void {
  for (const id of ['case0', 'case1', 'case2', 'case3']) {
    expect(buildShowcaseModel(id, T)).not.toBeNull();
  }
}

function assert_builds_the_four_routers_the_shared_model_of_rout(): void {
  const widths = ['router1', 'router2', 'router3', 'router4'].map((id) => {
    const m = buildShowcaseModel(id, T);
    expect(m).not.toBeNull();
    const b = new three.Box3().setFromObject(must(m)),
      s = b.getSize(b.max.clone()),
      c = b.getCenter(b.max.clone());
    expect(s.x * s.y * s.z).toBeGreaterThan(0);
    expect(b.min.y).toBeCloseTo(0, 3);
    expect(Math.abs(c.x) + Math.abs(c.z)).toBeLessThan(1);
    return s.x;
  });
  expect(new Set(widths.map((w) => Math.round(w))).size).toBe(4);
  // (no such router: nothing to show)
  for (const id of ['router0', 'router5']) {
    expect(buildShowcaseModel(id, T)).toBeNull();
  }
}

function assert_shows_a_router_with_every_jack_light_out_a_still(): void {
  for (const id of ['router1', 'router4']) {
    let lit = 0;
    must(buildShowcaseModel(id, T)).traverse((o) => {
      const m = (o as { material?: { emissive?: { getHex: () => number }; emissiveIntensity?: number } }).material;
      // (a jack's lights are green and amber; the status row is cyan or azure)
      if (m?.emissive && [0x58_e0_8a, 0xff_b5_47].includes(m.emissive.getHex()) && or(m.emissiveIntensity, 0) > 0) {
        lit++;
      }
    });
    expect(lit).toBe(0);
  }
}

// (a part that wears 2D art runs its reveals from the viewer's frame hook, as the case's reveals run)
const runFrame = (o: three.Object3D, z: number): void => {
  const cam = new three.PerspectiveCamera(30, 1, 1, 1e6);
  cam.position.set(0, 0, z);
  cam.updateMatrixWorld(true);
  o.updateMatrixWorld(true);
  o.traverse((n) => {
    const f = n.userData['frame'] as ((c: three.PerspectiveCamera, h: number) => void) | undefined;
    if (f) {
      f(cam, 900);
    }
  });
};

function assert_turns_a_NIC_to_show_its_parts_first_its_jacks_st(): void {
  for (const id of ['nic1', 'nic2', 'nic3']) {
    const m = must(buildShowcaseModel(id, T));
    m.updateMatrixWorld(true);
    let jack: three.Object3D | null = null;
    m.traverse((o) => {
      if (idOf(o)?.endsWith('.nic-jack')) {
        jack = o;
      }
    });
    expect(jack).not.toBeNull();
    const whole = new three.Box3().setFromObject(m).getCenter(new three.Vector3()),
      at = new three.Box3().setFromObject(must(jack)).getCenter(new three.Vector3());
    expect(at.z - whole.z).toBeGreaterThan(1);
  }
}

describe('the showcase models', () => {
  it('builds every spec of the modelled kinds: solid, resting on the floor, centred', () => {
    expect.hasAssertions();
    assert_builds_every_spec_of_the_modelled_kinds_solid_re();
  });

  it('builds the cases', () => {
    expect.hasAssertions();
    assert_builds_the_cases();
  });

  it('builds the four routers (the shared model of router3d.ts): solid, resting on the floor, centred, each of its own size', () => {
    expect.hasAssertions();
    assert_builds_the_four_routers_the_shared_model_of_rout();
  });

  it('shows a router with every jack light out: a still has no link to light them', () => {
    expect.hasAssertions();
    assert_shows_a_router_with_every_jack_light_out_a_still();
  });

  function assert_fades_the_shell_of_a_router_as_the_camera_comes_(): void {
    for (const id of ['router1', 'router4']) {
      const m = must(buildShowcaseModel(id, T));
      const board = (): boolean => {
        let v = false;
        m.traverse((o) => {
          if (o.userData['id'] === 'router') {
            v = o.visible;
          }
        });
        return v;
      };
      runFrame(m, 60_000);
      expect(board(), `${id} far`).toBe(false);
      runFrame(m, 1500);
      expect(board(), `${id} near`).toBe(true);
    }
  }

  it('fades the shell of a router as the camera comes in and shows its board, as the room does', () => {
    expect.hasAssertions();
    assert_fades_the_shell_of_a_router_as_the_camera_comes_();
  });

  it('stands a RAM stick with its long side along x', () => {
    const b = new three.Box3().setFromObject(must(buildShowcaseModel('ram0', T))),
      s = b.getSize(b.max.clone());
    expect(s.x).toBeGreaterThan(s.y);
    expect(s.x).toBeGreaterThan(s.z);
  });

  it("turns a NIC to show its parts first: its jacks stand on the viewer's side of the card (+z), as a graphics card shows its cooler", () => {
    expect.hasAssertions();
    assert_turns_a_NIC_to_show_its_parts_first_its_jacks_st();
  });

  it('leaves the live layout as it was, and gives null for an unknown id', () => {
    setLayoutTier(1, 2);
    buildShowcaseModel('case3', T);
    buildShowcaseModel('gpu0', T);
    expect([LAYOUT_TIER, LAYOUT_CASE]).toStrictEqual([1, 2]);
    expect(buildShowcaseModel('nope', T)).toBeNull();
  });
});
