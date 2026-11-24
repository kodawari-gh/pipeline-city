// The storage (NVMe and SATA) and PSU builders: each part builds its `PartBuild` directly through `buildPart` and a `PartContext` made
// here, and the build lists what the part adds (its rails, reveals, fades, skins and a SATA drive's sockets).
/* oxlint-disable import/max-dependencies -- one test of three builders, each on its own model */
/* oxlint-disable eslint/no-duplicate-imports -- types in an import of their own */
import { describe, expect, it } from 'vitest';
import type { DeviceSnap, Snapshot } from '@/worker/game/types';
import { BakeQueue } from '@/core/render/three/artlod';
import { builtinTheme } from '@/core/render/theme';
import { getSpec } from '../../sim/specs';
import { driveKindOf } from '@/features/storage/render/drives';
import { ArtSet } from './artset3d';
import { basementPlan } from './basement3d';
import { baseCagePlan } from './drivecage3d';
import { buildPart } from './parts';
import type { PartBuild, PartContext } from './parts';
import { slotRects } from './slots3d';
import { Game } from '@/worker/game/game';
import { quietCanvas } from './testutil';

quietCanvas();

/** The sandbox's biggest machine, with a SATA drive in its first bay when `sataSpec` is given. */
function maxed(sataSpec?: string): Snapshot {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  if (sataSpec !== undefined) {
    const b = g.purchase(sataSpec);
    if (!b.ok) {
      throw new Error(`buy ${sataSpec}: ${b.reason}`);
    }
    const r = g.install(b.invId, 'sata0');
    if (!r.ok) {
      throw new Error(`fit ${sataSpec}: ${JSON.stringify(r)}`);
    }
  }
  return g.snapshot();
}

/** A context as a test makes it: the machine's read-only inputs. */
function context(s: Snapshot): PartContext {
  return {
    art: new ArtSet(new BakeQueue()),
    T: builtinTheme(),
    live: true,
    fans: [],
    rad: null,
    cages: [baseCagePlan()],
    plan: basementPlan(),
    rects: slotRects(s),
    caseRgb: true,
    hoses: () => null,
  };
}

const visualOf = (d: DeviceSnap): string => {
  const spec = getSpec(d.spec);
  return spec && 'visual' in spec ? spec.visual : '';
};

function build(pred: (d: DeviceSnap) => boolean, sataSpec?: string): { d: DeviceSnap; b: PartBuild } {
  const s = maxed(sataSpec),
    d = s.devices.find((x) => pred(x));
  if (!d) {
    throw new Error('the maxed machine lacks the part');
  }
  return { d, b: buildPart(d, context(s)) };
}

const nvme = (d: DeviceSnap): boolean =>
  d.kind === 'storage' && d.slot.startsWith('m2') && driveKindOf(visualOf(d)) === 'ssd-nvme';
const sata = (d: DeviceSnap): boolean => d.kind === 'storage' && d.slot.startsWith('sata');

describe('the NVMe builder', () => {
  const { d, b } = build(nvme);
  it('names its part and puts one root on the machine', () => {
    expect(b.id).toBe(d.id);
    expect(b.kind).toBe('storage');
    expect(b.slot).toBe(d.slot);
    expect(b.roots).toHaveLength(1);
  });
  it('flies to itself on a rail and reveals its dies as the camera comes in', () => {
    expect(b.rails.map((r) => r.id)).toStrictEqual([d.id]);
    expect(b.reveals.length).toBeGreaterThan(0);
  });
  it('has one skin and no sockets, stick, card, cooler or chip faces', () => {
    expect(b.skins.map(([id]) => id)).toStrictEqual([d.id]);
    expect(b.drive).toBeNull();
    expect(b.stick).toBeNull();
    expect(b.card).toBeNull();
    expect(b.cooler).toBeNull();
    expect(b.chips).toHaveLength(0);
  });
});

describe.each(['ssd1', 'hdd0'])('the SATA drive builder (%s)', (spec) => {
  const { d, b } = build(sata, spec);
  it('names its part and puts one root (the drive on its tray) on the machine', () => {
    expect(b.id).toBe(d.id);
    expect(b.kind).toBe('storage');
    expect(b.roots).toHaveLength(1);
  });
  it('lists its data and power sockets in its part build, as world points', () => {
    expect(b.drive).not.toBeNull();
    for (const p of [b.drive?.data, b.drive?.power]) {
      expect(p).toHaveLength(3);
      expect(p?.every((n) => Number.isFinite(n))).toBe(true);
    }
    expect(b.drive?.data).not.toStrictEqual(b.drive?.power);
  });
  it('flies to itself on a rail, reveals its inside and has one skin', () => {
    expect(b.rails.map((r) => r.id)).toStrictEqual([d.id]);
    expect(b.reveals.length).toBeGreaterThan(0);
    expect(b.skins.map(([id]) => id)).toStrictEqual([d.id]);
    expect(b.stick).toBeNull();
    expect(b.card).toBeNull();
  });
  it('is the only builder to list sockets', () => {
    const s = maxed('ssd1'),
      c = context(s);
    for (const x of s.devices.filter((y) => !sata(y))) {
      expect(buildPart(x, c).drive).toBeNull();
    }
  });
});

describe('the PSU builder', () => {
  const { d, b } = build((x) => x.kind === 'psu');
  it('names its part and puts one root on the machine', () => {
    expect(b.id).toBe(d.id);
    expect(b.kind).toBe('psu');
    expect(b.roots).toHaveLength(1);
  });
  it('has one skin for its device and no sockets, stick, card, cooler or chip faces', () => {
    expect(b.skins.map(([id]) => id)).toStrictEqual([d.id]);
    expect(b.drive).toBeNull();
    expect(b.stick).toBeNull();
    expect(b.card).toBeNull();
    expect(b.cooler).toBeNull();
    expect(b.chips).toHaveLength(0);
  });
  it('builds the same list twice (no hidden state in the builder)', () => {
    const c = build((x) => x.kind === 'psu').b;
    expect([b.rails.length, b.reveals.length, b.fades.length]).toStrictEqual([
      c.rails.length,
      c.reveals.length,
      c.fades.length,
    ]);
  });
});
