import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { builtinTheme } from '@/core/render/theme';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { DIMM_H, GEO, setLayoutTier } from '../layout/layout';
import { ArtSet } from './artset3d';
import { SLOT_H, SLOT_W, STICK, STICK_MM, dimmSlot, ramStick, stickLook, stickTier, stickTop } from './ram3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

function assert_climbs_one_linear_ladder_the_tier_numbers_follow(): void {
  const visuals = ['dimm-basic', 'dimm-fast', 'dimm-ddr3', 'dimm-lowlat', 'dimm-ecc', 'dimm-ddr5', 'dimm-ddr5ecc'];
  expect(visuals.map(stickTier)).toStrictEqual([0, 1, 2, 3, 4, 5, 6]);
  const tops = visuals.map(stickTop);
  for (let i = 4; i < tops.length; i++) {
    expect(must(tops[i])).toBeGreaterThan(must(tops[i - 1]));
  }
  expect(must(tops[3])).toBeGreaterThan(must(tops[2]));
}

function assert_keeps_a_real_stick_s_proportions_31_25_mm_tall_t(): void {
  setLayoutTier(3, 3);
  const r = must(GEO.dimm[0]).rect,
    pitch = must(GEO.dimm[1]).rect.x - r.x,
    mm = 23;
  expect(STICK.h / DIMM_H).toBeCloseTo(31.25 / 133.35, 2);
  expect(STICK.t / mm).toBeCloseTo(3.27, 1);
  expect((stickTop('dimm-ddr5') - STICK.z0) / STICK_MM).toBeCloseTo(41.25, 0);
  for (const visual of ['dimm-fast', 'dimm-ddr3', 'dimm-ecc', 'dimm-ddr5', 'dimm-ddr5ecc']) {
    const b = new Box3().setFromObject(ramStick(visual, false, r, 'DDR5 256K').root),
      w = (b.max.x - b.min.x) / mm;
    expect(w).toBeGreaterThan(5);
    expect(w).toBeLessThan(8);
    // a gap to the next stick
    expect(b.max.x - b.min.x).toBeLessThan(pitch - 40);
  }
}

function assert_stands_a_stick_in_its_socket_as_wide_as_the_sock(): void {
  setLayoutTier(3, 3);
  const r = must(GEO.dimm[0]).rect,
    cx = r.x + r.w / 2;
  for (const visual of ['dimm-basic', 'dimm-fast', 'dimm-ddr3', 'dimm-ecc', 'dimm-ddr5', 'dimm-ddr5ecc']) {
    const s = ramStick(visual, false, r),
      b = new Box3().setFromObject(s.root);
    expect(b.max.x - b.min.x).toBeLessThan(visual === 'dimm-basic' ? SLOT_W : r.w);
    expect(Math.abs((b.min.x + b.max.x) / 2 - cx)).toBeLessThan(1);
    expect(b.min.z).toBeLessThan(BOARD_Z + SLOT_H);
    expect(b.min.z).toBeGreaterThan(BOARD_Z);
    expect(b.max.z).toBeCloseTo(stickTop(visual), -1);
    expect(-b.max.y).toBeGreaterThanOrEqual(r.y);
    expect(-b.min.y).toBeLessThanOrEqual(r.y + r.h);
    expect(s.spins).toHaveLength(stickLook(visual) === 'rgb' ? 1 : 0);
  }
}

describe('the 3D memory sticks', () => {
  it('gives each tier its look: bare, a low plate, a full plate, then a plate under a light bar', () => {
    expect(
      ['dimm-basic', 'dimm-fast', 'dimm-ddr3', 'dimm-lowlat', 'dimm-ecc', 'dimm-ddr5', 'dimm-ddr5ecc'].map(stickLook),
    ).toStrictEqual(['bare', 'low', 'flat', 'rgb', 'rgb', 'rgb', 'rgb']);
  });

  it('climbs one linear ladder: the tier numbers follow the shop, and each light-bar tier stands higher than the last', () => {
    expect.hasAssertions();
    assert_climbs_one_linear_ladder_the_tier_numbers_follow();
  });

  it("keeps a real stick's proportions: 31.25 mm tall to its 133.35 mm, 3.3 mm thick bare, 5 to 8 mm under a spreader, 41 mm with a light bar", () => {
    expect.hasAssertions();
    assert_keeps_a_real_stick_s_proportions_31_25_mm_tall_t();
  });

  it('stands a stick in its socket: as wide as the socket bare, its fingers down in the groove, its top where the look says', () => {
    expect.hasAssertions();
    assert_stands_a_stick_in_its_socket_as_wide_as_the_sock();
  });

  it('closes the latches on a stick and opens them on an empty socket', () => {
    setLayoutTier(3, 3);
    const r = must(GEO.dimm[0]).rect;
    expect(dimmSlot(r, false).latches.children.map((p) => Math.abs(p.rotation.x))).toStrictEqual([0, 0]);
    expect(dimmSlot(r, true).latches.children.map((p) => Math.abs(p.rotation.x))).toStrictEqual([0.5, 0.5]);
  });

  it('puts a die on each DRAM chip face: eight data chips, two faces each, a ninth chip on an ECC stick; the live map only on the east faces of the data chips', () => {
    setLayoutTier(3, 3);
    const r = must(GEO.dimm[0]).rect,
      art = new ArtSet(),
      T = builtinTheme();
    const plain = ramStick('dimm-ddr5', false, r, '', { art, T, spec: { banks: 32, bankGroups: 8, subChannels: 2 } });
    expect(plain.dies).toHaveLength(16);
    expect(plain.mapFaces).toHaveLength(8);
    expect(must(plain.plan).banks).toHaveLength(32);
    const ecc = ramStick('dimm-ddr5ecc', true, r, '', { art, T, spec: { banks: 32, bankGroups: 8, subChannels: 2 } });
    expect(ecc.dies).toHaveLength(18);
    expect(ecc.mapFaces).toHaveLength(8);
    // (the parity chip's die is the same plan, smaller)
    expect(must(ecc.dies[16]).scale.x).toBeLessThan(1);
    expect(must(ecc.dies[0]).scale.x).toBe(1);
    art.dispose();
  });

  it('builds a stick with no dies when the set is not given (the sticks keep only their chips)', () => {
    setLayoutTier(3, 3);
    const s = ramStick('dimm-ddr5', false, must(GEO.dimm[0]).rect);
    expect(s.dies).toHaveLength(0);
    expect(s.mapFaces).toHaveLength(0);
    expect(s.plan).toBeNull();
  });
});
