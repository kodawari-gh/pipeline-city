import { describe, expect, it } from 'vitest';
import { Box3, Group, Mesh } from 'three';
import { builtinTheme } from '@/core/render/theme';
import type { RectLike } from '@/core/render/three/geometry';
import { NAND_DIE, nandDieArt } from '@/features/storage/render/diskdie';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { ArtSet } from './artset3d';
import { COVER_BAND, DIE_BAND, dieInPackage, type DieHost } from './chipdie3d';
import { driveBody } from '@/features/storage/render/drives';
import { MM } from './pcbkit3d';
import { nvmeStick } from './nvme3d';

/** A host that keeps what each place asked for: where, and what to do at a zoom. */
function host(): DieHost & { asks: { r: RectLike; z: number; apply: (zoom: number) => void }[]; zoom: (z: number) => void } {
  const art = new ArtSet(), asks: { r: RectLike; z: number; apply: (zoom: number) => void }[] = [];
  return { art, T: builtinTheme(), asks, reveal: (r, z, apply) => { asks.push({ r, z, apply }); }, zoom: (z) => asks.forEach((a) => a.apply(z)) };
}

describe('a chip package that shows its die', () => {
  const r: RectLike = { x: 100, y: 100, w: 18 * MM, h: 12 * MM };

  it('has its cap, its substrate, its die and the die\'s frame; the die\'s art is hidden while the cap is whole', () => {
    const d = host(), g = new Group();
    dieInPackage(g, d, r, BOARD_Z, 1.25 * MM, [], {}, { ...NAND_DIE, bake: d.art.baker(() => nandDieArt(d.T, 1, 'ssd-sata')) });
    // cap, substrate, silicon, frame
    expect(g.children).toHaveLength(4);
    const [cap, , , frame] = g.children as [Group, Mesh, Mesh, Group];
    expect(d.asks).toHaveLength(1);
    // (asked at the package's centre, a step over its top)
    expect(d.asks[0]!.r).toEqual(r);
    expect(d.asks[0]!.z).toBeCloseTo(BOARD_Z + 1.25 * MM, 5);
    d.zoom(DIE_BAND[0] - 0.1);
    expect(cap.visible).toBe(true);
    expect(frame.visible).toBe(false);
    d.zoom((DIE_BAND[0] + DIE_BAND[1]) / 2);
    expect(cap.visible).toBe(true);
    expect(frame.visible).toBe(true);
    d.zoom(DIE_BAND[1] + 0.1);
    expect(cap.visible).toBe(false);
    expect(frame.visible).toBe(true);
    d.art.dispose();
  });

  it('keeps the die inside the package and gives the cap materials of its own (fading it leaves the neighbours alone)', () => {
    const d = host(), a = new Group(), b = new Group(), face = { ...NAND_DIE, bake: d.art.baker(() => nandDieArt(d.T, 1, 'ssd-sata')) };
    dieInPackage(a, d, r, BOARD_Z, 1.25 * MM, [], {}, face);
    dieInPackage(b, d, { ...r, x: 400 }, BOARD_Z, 1.25 * MM, [], {}, face);
    const mats = (g: Group) => { const out = new Set<unknown>(); g.children[0]!.traverse((x) => { const m = (x as Mesh).material; if (m) for (const k of Array.isArray(m) ? m : [m]) out.add(k); }); return out; };
    for (const m of mats(a)) expect(mats(b).has(m)).toBe(false);
    const box = new Box3().setFromObject(a.children[2]!);
    expect(box.min.x).toBeGreaterThanOrEqual(r.x - 1);
    expect(box.max.x).toBeLessThanOrEqual(r.x + r.w + 1);
    expect(-box.max.y).toBeGreaterThanOrEqual(r.y - 1);
    expect(-box.min.y).toBeLessThanOrEqual(r.y + r.h + 1);
    d.art.dispose();
  });

  it('turns a die a quarter round to lie along a tall package', () => {
    const d = host(), g = new Group();
    dieInPackage(g, d, { x: 0, y: 0, w: 8 * MM, h: 13 * MM }, BOARD_Z, 1 * MM, [], {}, { ...NAND_DIE, bake: d.art.baker(() => nandDieArt(d.T, 1)), turn: true });
    const frame = g.children[3]!, silicon = new Box3().setFromObject(g.children[2]!), size = silicon.getSize(new Box3().min.clone());
    expect(frame.rotation.z).toBeCloseTo(Math.PI / 2, 5);
    // (the silicon is taller than wide, as the package)
    expect(size.y).toBeGreaterThan(size.x);
    d.art.dispose();
  });
});

describe('the NVMe stick with its dies', () => {
  it('asks for a place for its label (or sink) and each package: the cover first, then the dies; a stick without the host has none', () => {
    const d = host(), g = new Group(), b = driveBody('ssd-nvme', 'm20');
    nvmeStick(g, b, { name: 'NVMe', capacityBytes: 128 * 1024, heatsink: false }, d);
    // the cover, the controller, the DRAM, two NAND packages
    expect(d.asks).toHaveLength(5);
    // (the packages ask as they are built, the cover last: it spans all of them)
    const cover = d.asks[d.asks.length - 1]!;
    expect(cover.r.w).toBeGreaterThan(d.asks[0]!.r.w * 3);
    // before the cover band the whole stick stands; past it one group goes: the cover (the dies' frames follow the packages' asks, not this one)
    const vis = () => g.children.map((c) => c.visible);
    cover.apply(COVER_BAND[0] - 0.1);
    const before = vis();
    cover.apply(COVER_BAND[1] + 0.1);
    const after = vis();
    expect(before.map((v, i) => v && !after[i]!).filter(Boolean)).toHaveLength(1);
    d.art.dispose();
    const plain = new Group();
    expect(() => nvmeStick(plain, b, { name: 'NVMe', capacityBytes: 128 * 1024, heatsink: false })).not.toThrow();
  });
});
