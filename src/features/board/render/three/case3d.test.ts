import { describe, expect, it } from 'vitest';
import { Box3, type Material, type Mesh } from 'three';
import { builtinTheme } from '@/core/render/theme';
import { CASE_KIND, caseWindow } from '@/features/room/render/shell/casedecor';
import { CASE_FRONT as FRONT, CASE_Z } from '@/features/room/render/three/roomplan';
import { CASE, FOOT, setLayoutTier } from '../layout/layout';
import { caseModel, outlinePts, SIDE_T } from './case3d';

const T = builtinTheme(true);

describe('the 3D cases', () => {
  it('builds each tier as its own kind, inside the case box, standing on its feet', () => {
    for (const t of [0, 1, 2, 3]) {
      setLayoutTier(t, t);
      const kind = CASE_KIND[t]!, m = caseModel(kind, T), b = new Box3().setFromObject(m.root);
      expect(b.min.x, kind).toBeGreaterThan(CASE.x - 160);
      expect(b.max.x, kind).toBeLessThan(CASE.x + CASE.w + 160);
      expect(b.max.y, kind).toBeLessThan(-CASE.y + 300); // (the power button's unseen pick plate, `hitPlate`, rises 270 over the top) // the controls stand on the top
      expect(b.min.y, kind).toBeCloseTo(-(CASE.y + CASE.h + FOOT), 0); // the feet reach the desk
      expect(b.min.z, kind).toBeGreaterThanOrEqual(CASE_Z - 1);
      m.door.updateMatrixWorld(true);
      const s = new Box3().setFromObject(m.door);
      expect(s.min.z, kind).toBeGreaterThanOrEqual(FRONT - (kind === 'oem' ? 260 : SIDE_T + 60)); // (the Mini's panel folds round onto the rear wall)
      expect(s.max.z, kind).toBeLessThan(FRONT + 80);
    }
  });

  it('cuts a window in every side but the Mini\'s, and lights only the gaming case and the showcase', () => {
    for (const t of [0, 1, 2, 3]) {
      setLayoutTier(t, t);
      const kind = CASE_KIND[t]!, m = caseModel(kind, T);
      expect(!!m.glass, kind).toBe(kind !== 'oem');
      expect(m.rgb, kind).toBe(kind === 'gamer' || kind === 'show');
      expect(m.spins.length > 0, kind).toBe(m.rgb);
      if (m.glass) {
        m.door.updateMatrixWorld(true);
        const g = new Box3().setFromObject(m.glass as Mesh), w = caseWindow(kind);
        expect(g.min.x, kind).toBeCloseTo(w.x, 0);
        expect(g.max.y, kind).toBeCloseTo(-w.y, 0);
      }
      // no painted streaks on the glass: all on the side panel takes the room's light, as the glass does
      m.side.traverse((o) => { if ((o as Mesh).isMesh && o !== m.hit) expect(((o as Mesh).material as Material).type, kind).not.toBe('MeshBasicMaterial'); });
      // the side panel takes a click only on its unseen plate (it opens the case); the parts behind it take the rest
      m.side.traverse((o) => { if ((o as Mesh).isMesh && o !== m.hit) expect(o.raycast.length, kind).toBe(0); });
      expect(m.hit.userData.id, kind).toBe('case.side');
      expect(m.power.userData.id, kind).toBe('power');
    }
  });

  it('chamfers a cut corner and rounds the others', () => {
    const r = { x: 0, y: 0, w: 1000, h: 600 };
    const cut = outlinePts(r, 0, [200, 0, 0, 0]);
    expect(cut.map((p) => [p.x, p.y])).toEqual([[0, -200], [200, -0], [1000, -0], [1000, -600], [0, -600]]);
    const round = outlinePts(r, 100, undefined, 4);
    expect(round.length).toBe(20);
    for (const p of round) expect(p.x >= 0 && p.x <= 1000 && p.y <= 0 && p.y >= -600).toBe(true);
  });
});
