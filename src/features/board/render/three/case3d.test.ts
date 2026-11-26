import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { builtinTheme } from '@/core/render/theme';
import { CASE_KIND, caseWindow } from '@/features/room/render/shell/casedecor';
import { CASE_FRONT as FRONT, CASE_Z } from '@/features/room/render/three/roomplan';
import { CASE, FOOT, setLayoutTier } from '../layout/layout';
import { caseModel, outlinePts, SIDE_T } from './case3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

const T = builtinTheme();

function assert_builds_each_tier_as_its_own_kind_inside_the_case(): void {
  for (const t of [0, 1, 2, 3]) {
    setLayoutTier(t, t);
    const kind = must(CASE_KIND[t]),
      m = caseModel(kind, T),
      b = new three.Box3().setFromObject(m.root);
    expect(b.min.x).toBeGreaterThan(CASE.x - 160);
    expect(b.max.x).toBeLessThan(CASE.x + CASE.w + 160);
    expect(b.max.y).toBeLessThan(-CASE.y + 300); // (the power button's unseen pick plate, `hitPlate`, rises 270 over the top) // the controls stand on the top
    expect(b.min.y).toBeCloseTo(-(CASE.y + CASE.h + FOOT), 0); // the feet reach the desk
    expect(b.min.z).toBeGreaterThanOrEqual(CASE_Z - 1);
    m.door.updateMatrixWorld(true);
    const s = new three.Box3().setFromObject(m.door);
    expect(s.min.z).toBeGreaterThanOrEqual(FRONT - (kind === 'oem' ? 260 : SIDE_T + 60)); // (the Mini's panel folds round onto the rear wall)
    expect(s.max.z).toBeLessThan(FRONT + 80);
  }
}

function assert_cuts_a_window_in_every_side_but_the_Mini_s_and_l(): void {
  for (const t of [0, 1, 2, 3]) {
    setLayoutTier(t, t);
    const kind = must(CASE_KIND[t]),
      m = caseModel(kind, T);
    expect(Boolean(m.glass)).toBe(kind !== 'oem');
    expect(m.rgb).toBe(kind === 'gamer' || kind === 'show');
    // (the showcase's light comes from its inner strips, `innerStrips`, not from the case's own parts)
    expect(m.spins.length > 0).toBe(kind === 'gamer');
    if (m.glass) {
      m.door.updateMatrixWorld(true);
      const g = new three.Box3().setFromObject(m.glass),
        w = caseWindow(kind);
      expect(g.min.x).toBeCloseTo(w.x, 0);
      expect(g.max.y).toBeCloseTo(-w.y, 0);
    }
    // no painted streaks on the glass: all on the side panel takes the room's light, as the glass does
    m.side.traverse((o) => {
      if (isMesh(o) && o !== m.hit) {
        expect(Array.isArray(o.material) ? undefined : o.material.type).not.toBe('MeshBasicMaterial');
      }
    });
    // the side panel takes a click only on its unseen plate (it opens the case); the parts behind it take the rest
    m.side.traverse((o) => {
      if (isMesh(o) && o !== m.hit) {
        expect(o.raycast.length).toBe(0);
      }
    });
    expect(m.hit.userData['id']).toBe('case.side');
    expect(m.power.userData['id']).toBe('power');
  }
}

function assert_chamfers_a_cut_corner_and_rounds_the_others(): void {
  const r = { x: 0, y: 0, w: 1000, h: 600 };
  const cut = outlinePts(r, 0, [200, 0, 0, 0]);
  expect(cut.map((p) => [p.x, p.y])).toStrictEqual([
    [0, -200],
    [200, -0],
    [1000, -0],
    [1000, -600],
    [0, -600],
  ]);
  const round = outlinePts(r, 100, undefined, 4);
  expect(round).toHaveLength(20);
  for (const p of round) {
    expect(p.x >= 0 && p.x <= 1000 && p.y <= 0 && p.y >= -600).toBe(true);
  }
}

describe('the 3D cases', () => {
  it('builds each tier as its own kind, inside the case box, standing on its feet', () => {
    expect.hasAssertions();
    assert_builds_each_tier_as_its_own_kind_inside_the_case();
  });

  it("cuts a window in every side but the Mini's, and lights only the gaming case and the showcase", () => {
    expect.hasAssertions();
    assert_cuts_a_window_in_every_side_but_the_Mini_s_and_l();
  });

  it('chamfers a cut corner and rounds the others', () => {
    expect.hasAssertions();
    assert_chamfers_a_cut_corner_and_rounds_the_others();
  });
});
