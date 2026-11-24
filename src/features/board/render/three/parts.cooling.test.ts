// The cooler, sink, fan and radiator builders: each part builds its `PartBuild` directly through `buildPart` and a `PartContext` made
// here, and the build lists what the part adds (its rails, reveals, fades, skins, spins and the cooler entry).
/* oxlint-disable import/max-dependencies -- one test of five builders, each on its own model */
/* oxlint-disable eslint/no-duplicate-imports -- types in an import of their own */
import { describe, expect, it } from 'vitest';
import type { DeviceSnap, Snapshot } from '@/worker/game/types';
import { BakeQueue } from '@/core/render/three/artlod';
import { builtinTheme } from '@/core/render/theme';
import { radiatorSpan } from '@/features/room/render/desk/props/case';
import { getSpec } from '../../sim/specs';
import { radiatorFit, radiatorGrade } from '../cooler';
import { ArtSet } from './artset3d';
import { basementPlan } from './basement3d';
import { baseCagePlan } from './drivecage3d';
import { buildPart } from './parts';
import type { PartBuild, PartContext } from './parts';
import { slotRects } from './slots3d';
import { Game } from '@/worker/game/game';
import { quietCanvas } from './testutil';

quietCanvas();

const maxed = (): Snapshot => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }).snapshot();

/** A context as a test makes it, the way Machine3D makes its own: the fans fitted and the radiator bolted on, read-only. */
function context(s: Snapshot, o: { rad?: boolean; fans?: boolean; caseRgb?: boolean } = {}): PartContext {
  const radDev = o.rad === false ? undefined : s.devices.find((d) => d.kind === 'radiator'),
    span = radDev ? radiatorSpan(radDev.slot === 'rad-front' ? 'front' : 'top') : null;
  return {
    art: new ArtSet(new BakeQueue()),
    T: builtinTheme(),
    live: true,
    fans:
      o.fans === false
        ? []
        : s.devices
            .filter((d) => d.kind === 'fan')
            .map((d) => ({
              id: d.id,
              slot: d.slot, // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fan specs are fans
              spec: getSpec(d.spec) as never,
            })),
    rad:
      span && radDev
        ? {
            fit: radiatorFit(
              span,
              0,
              radiatorGrade((getSpec(radDev.spec) as { visual?: string } | undefined)?.visual ?? ''),
            ),
            count: span.ids.length,
            span,
          }
        : null,
    cages: [baseCagePlan()],
    plan: basementPlan(),
    rects: slotRects(s),
    caseRgb: o.caseRgb ?? true,
    hoses: () => null,
  };
}

/** Is the cooler a liquid loop's pump? */
function isPump(d: DeviceSnap): boolean {
  const spec = getSpec(d.spec);
  return spec !== undefined && 'loop' in spec && spec.loop !== undefined;
}

const NEEDS = { 'vrm-sink': 'vrmfan', 'ram-sink': 'ramfan' };

const find = (s: Snapshot, pred: (d: DeviceSnap) => boolean): DeviceSnap => {
  const d = s.devices.find(pred);
  if (!d) {
    throw new Error('the maxed machine lacks the part');
  }
  return d;
};

describe('the cooler builder', () => {
  const s = maxed(),
    d = find(s, (x) => x.kind === 'cooler'),
    b: PartBuild = buildPart(d, context(s));
  it('names its part and puts one root on the machine', () => {
    expect(b.id).toBe(d.id);
    expect(b.kind).toBe('cooler');
    expect(b.slot).toBe(d.slot);
    expect(b.roots).toHaveLength(1);
  });
  it('lists its fading group as the cooler, with the pump fact', () => {
    expect(b.cooler).not.toBeNull();
    expect(b.fades).toContain(b.cooler?.group);
    expect(b.cooler?.pump).toBe(isPump(d));
  });
  it('reveals over the die band, is an obstacle, and has one skin', () => {
    expect(b.reveals).toHaveLength(1);
    expect(b.reveals[0]?.anywhere).toBe(b.cooler?.pump);
    expect(b.obstacles.some((o) => o.userData['cooler'] === true)).toBe(true);
    expect(b.skins.map(([id]) => id)).toStrictEqual([d.id]);
  });
  it('fades with the camera without error', () => {
    expect(() => b.reveals[0]?.apply(0)).not.toThrow();
    expect(() => b.reveals[0]?.apply(10)).not.toThrow();
  });
  it('holds no card, stick or chip faces', () => {
    expect(b.card).toBeNull();
    expect(b.stick).toBeNull();
    expect(b.chips).toHaveLength(0);
  });
});

describe.each(['vrm-sink', 'ram-sink'] as const)('the %s builder', (kind) => {
  const s = maxed(),
    d = find(s, (x) => x.kind === kind),
    fan = find(s, (x) => x.kind === 'fan' && x.slot.startsWith(`${kind}0.fan`)),
    b = buildPart(d, context(s));
  it('names its part and puts one root on the machine', () => {
    expect(b.id).toBe(d.id);
    expect(b.kind).toBe(kind);
    expect(b.roots).toHaveLength(1);
    expect(b.roots[0]?.userData['sink']).toBe(true);
  });
  it('is an obstacle with one thermal skin', () => {
    expect(b.obstacles).toContain(b.roots[0]);
    expect(b.skins.map(([id]) => id)).toStrictEqual([d.id]);
  });
  it('keeps its fan: a spin that needs its own light, and a power root for the fan', () => {
    expect(b.spins).toHaveLength(1);
    expect(b.spins[0]?.needs).toBe(NEEDS[kind]);
    expect(b.powerRoots.map(([id]) => id)).toStrictEqual([fan.id]);
  });
  it('without its fan builds no spin and no power root', () => {
    const bare = buildPart(d, context(s, { fans: false }));
    expect(bare.spins).toHaveLength(0);
    expect(bare.powerRoots).toHaveLength(0);
    expect(bare.roots).toHaveLength(1);
  });
  it('has no card, stick, cooler or chip faces', () => {
    expect(b.card).toBeNull();
    expect(b.stick).toBeNull();
    expect(b.cooler).toBeNull();
    expect(b.chips).toHaveLength(0);
  });
});

describe('the case fan builder', () => {
  const s = maxed(),
    d = find(s, (x) => x.kind === 'fan' && x.slot === 'front0'),
    b = buildPart(d, context(s));
  it('puts its group on the machine and in the case pieces a swap lifts', () => {
    expect(b.id).toBe(d.id);
    expect(b.roots).toHaveLength(1);
    expect(b.caseRoots).toStrictEqual(b.roots);
  });
  it('spins, and is powered through its own group', () => {
    expect(b.spins).toHaveLength(1);
    expect(b.powerRoots.map(([id]) => id)).toStrictEqual([d.id]);
    expect(b.powerRoots[0]?.[1]).toBe(b.roots[0]);
  });
  it('has no light on a plain case', () => {
    const [plain] = buildPart(d, context(s, { caseRgb: false })).spins;
    expect(plain?.gain).toBe(0);
  });
  const sinkFan = find(s, (x) => x.kind === 'fan' && x.slot === 'vrm-sink0.fan0');
  it('on a heatsink adds nothing of its own: its host builds it', () => {
    const hosted = buildPart(sinkFan, context(s));
    expect(hosted.roots).toHaveLength(0);
    expect(hosted.spins).toHaveLength(0);
  });
});

describe('the radiator builder', () => {
  const s = maxed(),
    d = find(s, (x) => x.kind === 'radiator'),
    b = buildPart(d, context(s));
  it('puts one root on the machine, as an obstacle a cable may start in', () => {
    expect(b.id).toBe(d.id);
    expect(b.kind).toBe('radiator');
    expect(b.roots).toHaveLength(1);
    expect(b.obstacles.some((o) => o.userData['radiator'] === true)).toBe(true);
  });
  it('has one skin and no cooler entry', () => {
    expect(b.skins.map(([id]) => id)).toStrictEqual([d.id]);
    expect(b.cooler).toBeNull();
  });
  it('without a radiator bolted on adds no obstacle and no skin', () => {
    const bare = buildPart(d, context(s, { rad: false }));
    expect(bare.obstacles).toHaveLength(0);
    expect(bare.skins).toHaveLength(0);
  });
});
