import { describe, expect, it } from 'vitest';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { BOARD_TIERS } from '../../sim/specs';
import { IO_PORTS } from '../layout/boardlayout';
import { BR } from '../layout/layout';
import { fitted, ioShells, ioStacks } from './boardhw3d';

describe('the rear connectors behind the shield', () => {
  for (const [tier, spec] of BOARD_TIERS.entries()) {
    const feat = spec.features, shells = ioShells(feat, tier);
    it(`${spec.name}: every shell goes through the rear wall's I/O opening`, () => {
      for (const s of shells) {
        expect(s.y0, `shell at y ${s.y0}`).toBeGreaterThanOrEqual(BR.io.y - 20);
        expect(s.y1, `shell at y ${s.y1}`).toBeLessThanOrEqual(BR.io.y + BR.io.h + 20);
        expect(s.z0).toBeGreaterThanOrEqual(BOARD_Z + 80);
        expect(s.z1).toBeLessThanOrEqual(BOARD_Z + 1220);
      }
    });
    it(`${spec.name}: each fitted port has a shell round its centre, and the stacks hold every shell without meeting`, () => {
      for (const p of IO_PORTS) if (fitted(p, feat)) expect(shells.some((s) => s.y0 < p.y && p.y < s.y1), p.id).toBe(true);
      const stacks = ioStacks(shells);
      expect(stacks.reduce((n, st) => n + st.shells.length, 0)).toBe(shells.length);
      for (let i = 1; i < stacks.length; i++) expect(stacks[i]!.y0).toBeGreaterThanOrEqual(stacks[i - 1]!.y1 + 12);
      for (const st of stacks) for (const s of st.shells) expect(st.top).toBeGreaterThan(s.z1);
    });
  }
});
