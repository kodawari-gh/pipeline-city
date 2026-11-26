/* oxlint-disable import/max-dependencies -- the die test builds the die in every part that carries one, each in its own module */
import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { builtinTheme } from '@/core/render/theme';
import type { RectLike } from '@/core/render/three/geometry';
import { NAND_DIE, nandDieArt } from '@/features/storage/render/diskdie';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { ArtSet } from './artset3d';
import * as chipdie3d from './chipdie3d';
import { DIE_SHOW } from '@/core/render/lod/lod';
import { driveBody } from '@/features/storage/render/drives';
import { MM } from './pcbkit3d';
import { nvmeStick } from './nvme3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): three.Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a three.Mesh');
  }
  return o;
}

/** A list of one value, or the value itself when it is already a list. */
function asList<T>(value: T | T[]): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

/** A host that keeps what each place asked for: where, and what to do at a zoom. */
function host(): chipdie3d.DieHost & {
  asks: { r: RectLike; z: number; apply: (zoom: number) => void }[];
  zoom: (z: number) => void;
} {
  const art = new ArtSet(),
    asks: { r: RectLike; z: number; apply: (zoom: number) => void }[] = [];
  return {
    art,
    T: builtinTheme(),
    asks,
    reveal: (r, z, apply) => {
      asks.push({ r, z, apply });
    },
    zoom: (z) => {
      for (const a of asks) {
        a.apply(z);
      }
    },
  };
}

function assert_asks_for_a_place_for_its_label_or_sink_and_each_(): void {
  const d = host(),
    g = new three.Group(),
    b = driveBody('ssd-nvme', 'm20');
  nvmeStick(g, b, { name: 'NVMe', capacityBytes: 128 * 1024, heatsink: false }, d);
  // the cover, the controller, the DRAM, two NAND packages
  expect(d.asks).toHaveLength(5);
  // (the packages ask as they are built, the cover last: it spans all of them)
  const cover = must(d.asks.at(-1));
  expect(cover.r.w).toBeGreaterThan(must(d.asks[0]).r.w * 3);
  // before the cover band the whole stick stands; past it one group goes: the cover (the dies' frames follow the packages' asks, not this one)
  const vis = () => g.children.map((c) => c.visible);
  cover.apply(chipdie3d.COVER_BAND[0] - 0.1);
  const before = vis();
  cover.apply(chipdie3d.COVER_BAND[1] + 0.1);
  const after = vis();
  expect(before.map((v, i) => v && !must(after[i])).filter(Boolean)).toHaveLength(1);
  d.art.dispose();
  const plain = new three.Group();
  expect(() => nvmeStick(plain, b, { name: 'NVMe', capacityBytes: 128 * 1024, heatsink: false })).not.toThrow();
}

describe('a chip package that shows its die', () => {
  const r: RectLike = { x: 100, y: 100, w: 18 * MM, h: 12 * MM };
  // (the die is the package's width, less its rim: the band is read on the die)
  const SIDE = 18 * MM * chipdie3d.DIE_FILL;

  it("has its cap, its substrate, its die and the die's frame; the die's art is hidden while the cap is whole", () => {
    const d = host(),
      g = new three.Group();
    chipdie3d.dieInPackage(
      g,
      d,
      r,
      BOARD_Z,
      1.25 * MM,
      [],
      {},
      { ...NAND_DIE, bake: d.art.baker(() => nandDieArt(d.T, 1, 'ssd-sata')) },
    );
    // cap, substrate, silicon, frame
    expect(g.children).toHaveLength(4);
    const cap = must(g.children[0]),
      frame = must(g.children[3]);
    expect(d.asks).toHaveLength(1);
    // (asked at the package's centre, a step over its top)
    expect(must(d.asks[0]).r).toStrictEqual(r);
    expect(must(d.asks[0]).z).toBeCloseTo(BOARD_Z + 1.25 * MM, 5);
    d.zoom(DIE_SHOW[0] / SIDE - 0.1);
    expect(cap.visible).toBe(true);
    expect(frame.visible).toBe(false);
    d.zoom((DIE_SHOW[0] + DIE_SHOW[1]) / 2 / SIDE);
    expect(cap.visible).toBe(true);
    expect(frame.visible).toBe(true);
    d.zoom(DIE_SHOW[1] / SIDE + 0.1);
    expect(cap.visible).toBe(false);
    expect(frame.visible).toBe(true);
    d.art.dispose();
  });

  function assert_keeps_the_die_inside_the_package_and_gives_the_c(): void {
    const d = host(),
      a = new three.Group(),
      b = new three.Group(),
      face = { ...NAND_DIE, bake: d.art.baker(() => nandDieArt(d.T, 1, 'ssd-sata')) };
    chipdie3d.dieInPackage(a, d, r, BOARD_Z, 1.25 * MM, [], {}, face);
    chipdie3d.dieInPackage(b, d, { ...r, x: 400 }, BOARD_Z, 1.25 * MM, [], {}, face);
    const mats = (g: three.Group) => {
      const out = new Set<unknown>();
      must(g.children[0]).traverse((x) => {
        if (!isMesh(x)) {
          return;
        }
        for (const k of asList(asMesh(x).material)) {
          out.add(k);
        }
      });
      return out;
    };
    for (const m of mats(a)) {
      expect(mats(b).has(m)).toBe(false);
    }
    const box = new three.Box3().setFromObject(must(a.children[2]));
    expect(box.min.x).toBeGreaterThanOrEqual(r.x - 1);
    expect(box.max.x).toBeLessThanOrEqual(r.x + r.w + 1);
    expect(-box.max.y).toBeGreaterThanOrEqual(r.y - 1);
    expect(-box.min.y).toBeLessThanOrEqual(r.y + r.h + 1);
    d.art.dispose();
  }

  it('keeps the die inside the package and gives the cap materials of its own (fading it leaves the neighbours alone)', () => {
    expect.hasAssertions();
    assert_keeps_the_die_inside_the_package_and_gives_the_c();
  });

  it('turns a die a quarter round to lie along a tall package', () => {
    const d = host(),
      g = new three.Group();
    chipdie3d.dieInPackage(
      g,
      d,
      { x: 0, y: 0, w: 8 * MM, h: 13 * MM },
      BOARD_Z,
      MM,
      [],
      {},
      { ...NAND_DIE, bake: d.art.baker(() => nandDieArt(d.T, 1)), turn: true },
    );
    const frame = must(g.children[3]),
      silicon = new three.Box3().setFromObject(must(g.children[2])),
      size = silicon.getSize(new three.Box3().min.clone());
    expect(frame.rotation.z).toBeCloseTo(Math.PI / 2, 5);
    // (the silicon is taller than wide, as the package)
    expect(size.y).toBeGreaterThan(size.x);
    d.art.dispose();
  });
});

describe('the NVMe stick with its dies', () => {
  it('asks for a place for its label (or sink) and each package: the cover first, then the dies; a stick without the host has none', () => {
    expect.hasAssertions();
    assert_asks_for_a_place_for_its_label_or_sink_and_each_();
  });
});
