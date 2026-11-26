import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { builtinTheme } from '@/core/render/theme';
import type { V3 } from '@/core/render/three/rope';
import { MM } from './pcbkit3d';
import { ArtSet } from './artset3d';
import { COVER_BAND } from './chipdie3d';
import { HDD_MM, SSD_MM, sataDriveModel } from './drive3d';
import * as driveinner3d from './driveinner3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

/** A list of one value, or the value itself when it is already a list. */
function asList<T>(value: T | T[]): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

const isGroup = (o: unknown): o is three.Group =>
  typeof o === 'object' && o !== null && 'isGroup' in o && o.isGroup === true;
function asGroup(o: unknown): three.Group {
  if (!isGroup(o)) {
    throw new Error('expected a Group');
  }
  return o;
}

/** A host that keeps what each place asked: where, and what to do at a zoom. */
function host(): driveinner3d.DriveHost & {
  asks: { at: V3; apply: (zoom: number) => void }[];
  zoom: (z: number) => void;
} {
  const art = new ArtSet(),
    asks: { at: V3; apply: (zoom: number) => void }[] = [];
  return {
    art,
    T: builtinTheme(),
    asks,
    reveal: (at, apply) => {
      asks.push({ at, apply });
    },
    zoom: (z) => {
      for (const a of asks) {
        a.apply(z);
      }
    },
  };
}
const boxOf = (o: three.Object3D): three.Box3 => new three.Box3().setFromObject(o);
const meshes = (o: three.Object3D): three.Mesh[] => {
  const out: three.Mesh[] = [];
  o.traverse((x) => {
    if (isMesh(x)) {
      out.push(x);
    }
  });
  return out;
};
const look = { name: 'Drive', capacityBytes: 96 * 1024 };

describe('the SSD board', () => {
  it('stands in the drive, a package for each die: controller, DRAM and four NAND ask for their zoom where they stand', () => {
    const h = host(),
      b = driveinner3d.ssdBoard(h, 100, 70, 200);
    expect(h.asks).toHaveLength(6);
    const box = boxOf(b);
    // (the board's x runs across the drive, its y along it, its depth up: nothing leaves the 2.5 in. drive's box)
    expect(box.min.x).toBeGreaterThanOrEqual(100 - 1);
    expect(box.max.x).toBeLessThanOrEqual(100 + 65 * MM + 1);
    expect(box.min.y).toBeGreaterThanOrEqual(70 - 1);
    expect(box.max.y).toBeLessThan(SSD_MM.t * MM);
    expect(box.min.z).toBeGreaterThanOrEqual(200 - 1);
    expect(box.max.z).toBeLessThanOrEqual(200 + 90 * MM + 1);
    for (const a of h.asks) {
      expect(a.at[0]).toBeGreaterThan(100);
      expect(a.at[2]).toBeGreaterThan(200);
    }
    h.art.dispose();
  });
});

describe('the hard disk inside', () => {
  const fit = {
    spin: { x: (HDD_MM.w * MM) / 2, z: (HDD_MM.l - 51.5) * MM },
    pivot: { x: (HDD_MM.w - 20) * MM, z: 19.5 * MM },
    floor: 8.2 * MM,
  };

  it('keeps its parts in the cavity: the platters clear of the walls, the arm over them, all under the cover', () => {
    const h = host(),
      g = driveinner3d.hddInside(h, fit),
      box = boxOf(g),
      wall = 4.5 * MM,
      top = (HDD_MM.t - 0.8) * MM - 2;
    expect(box.min.x).toBeGreaterThan(wall);
    expect(box.max.x).toBeLessThan(HDD_MM.w * MM - wall);
    expect(box.min.z).toBeGreaterThan(wall);
    expect(box.max.z).toBeLessThan(HDD_MM.l * MM - wall);
    expect(box.min.y).toBeGreaterThanOrEqual(fit.floor - 1);
    expect(box.max.y).toBeLessThan(top);
    h.art.dispose();
  });

  it('puts the head over the data band: the arm reaches from the pivot to between the hub and the rim', () => {
    const h = host(),
      g = driveinner3d.hddInside(h, fit),
      act = g.children.find((c) => c.type === 'Group' && c.position.x === fit.pivot.x);
    expect(act).toBeTruthy();
    // the arm points at the spindle
    const tip = {
      x: fit.pivot.x + Math.sin(must(act).rotation.y) * 58 * MM,
      z: fit.pivot.z + Math.cos(must(act).rotation.y) * 58 * MM,
    };
    const r = Math.hypot(tip.x - fit.spin.x, tip.z - fit.spin.z) / MM;
    expect(r).toBeGreaterThan(0.3 * 45);
    expect(r).toBeLessThan(0.97 * 45);
    h.art.dispose();
  });
});

describe('a SATA drive with its inside', () => {
  for (const hdd of [true, false]) {
    const name = hdd ? 'hard disk' : 'SSD';

    it(`${name}: the cover fades over its band and the inside shows; whole before it`, () => {
      const h = host(),
        dm = sataDriveModel(hdd, look, h);
      const lid = asGroup(dm.root.children.at(-1)),
        inside = asGroup(dm.root.children.at(-2));
      h.zoom(COVER_BAND[0] - 0.1);
      expect(lid.visible).toBe(true);
      expect(inside.visible).toBe(false);
      h.zoom(COVER_BAND[1] + 0.1);
      expect(lid.visible).toBe(false);
      expect(inside.visible).toBe(true);
      // (halfway: both stand, the cover thin)
      h.zoom((COVER_BAND[0] + COVER_BAND[1]) / 2);
      expect(lid.visible).toBe(true);
      expect(inside.visible).toBe(true);
      h.art.dispose();
    });

    it(`${name}: asks for its zoom at several places along it, the highest zoom taking the cover off`, () => {
      const h = host(),
        dm = sataDriveModel(hdd, look, h);
      const covers = h.asks.filter((a) => a.at[1] === dm.t / 2);
      expect(covers.length).toBeGreaterThanOrEqual(3);
      for (const a of covers) {
        expect(a.at[0]).toBeGreaterThan(0);
        expect(a.at[0]).toBeLessThan(dm.w);
        expect(a.at[2]).toBeGreaterThan(0);
        expect(a.at[2]).toBeLessThan(dm.l);
      }
      // (one place in the view is enough)
      for (const a of covers) {
        a.apply(0);
      }
      must(covers[1]).apply(2);
      const lid = asGroup(dm.root.children.at(-1));
      expect(lid.visible).toBe(false);
      h.art.dispose();
    });

    it(`${name}: the lid has materials of its own, and the machine's body material is one of the visible shell's`, () => {
      const h = host(),
        dm = sataDriveModel(hdd, look, h),
        lid = asGroup(dm.root.children.at(-1));
      const rest = dm.root.children.filter((c) => c !== lid);
      const lidMats = new Set(meshes(lid).flatMap((m) => asList(m.material)));
      const restMats = new Set(rest.flatMap(meshes).flatMap((m) => asList(m.material)));
      for (const x of lidMats) {
        expect(restMats.has(x)).toBe(false);
      }
      // the hard disk's casting stays when the cover goes; the SSD's body is its top shell, which goes with the lid
      expect((hdd ? restMats : lidMats).has(dm.body)).toBe(true);
      h.art.dispose();
    });

    it(`${name}: stays in the size of the drive`, () => {
      const h = host(),
        dm = sataDriveModel(hdd, look, h),
        plain = sataDriveModel(hdd, look),
        a = boxOf(dm.root),
        b = boxOf(plain.root);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(a.min[k]).toBeCloseTo(b.min[k], 0);
        expect(a.max[k]).toBeCloseTo(b.max[k], 0);
      }
      h.art.dispose();
    });
  }

  it('builds the old solid drive without a host: no inside, no asks', () => {
    for (const hdd of [true, false]) {
      const dm = sataDriveModel(hdd, look);
      expect(dm.root.children.every((c) => c.visible)).toBe(true);
    }
  });
});
