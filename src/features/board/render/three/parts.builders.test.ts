// The CPU, TPM and RAM builders: each part builds its `PartBuild` directly through `buildPart` and a `PartContext` made here, and the
// build lists what the part adds (its rails, reveals, fades, skins, and the chip faces and the stick entry).
/* oxlint-disable import/max-dependencies -- one test of three builders, each on its own model */
/* oxlint-disable eslint/no-duplicate-imports -- types in an import of their own */
import { describe, expect, it } from 'vitest';
import type { DeviceSnap, Snapshot } from '@/worker/game/types';
import { BakeQueue } from '@/core/render/three/artlod';
import { builtinTheme } from '@/core/render/theme';
import { DIE } from '../layout/layout';
import { ArtSet } from './artset3d';
import { basementPlan } from './basement3d';
import { baseCagePlan } from './drivecage3d';
import { buildPart, dimmRect, idx } from './parts';
import type { PartBuild, PartContext } from './parts';
import { slotRects } from './slots3d';
import { Game } from '@/worker/game/game';
import { quietCanvas } from './testutil';

/** Returns `value` when it is present, otherwise `fallback`. */
function or<T>(value: T, fallback: NonNullable<T>): NonNullable<T> {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}

quietCanvas();

/** A context as a test makes it: the machine's read-only inputs, live chips or not. */
function context(s: Snapshot, live: boolean): PartContext {
  return {
    art: new ArtSet(new BakeQueue()),
    T: builtinTheme(),
    live,
    fans: [],
    rad: null,
    cages: [baseCagePlan()],
    plan: basementPlan(),
    rects: slotRects(s),
    caseRgb: true,
    hoses: () => null,
  };
}

/** The sandbox's biggest machine with a TPM on its header (the maxed one has none). */
function withTpm(): Snapshot {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }),
    b = g.purchase('tpm1');
  if (!b.ok) {
    throw new Error(`buy tpm1: ${b.reason}`);
  }
  const r = g.install(b.invId, 'tpm0');
  if (!r.ok) {
    throw new Error(`fit tpm1: ${JSON.stringify(r)}`);
  }
  return g.snapshot();
}

const maxedSnapshot = withTpm;

function part(s: Snapshot, kind: string): DeviceSnap {
  const d = s.devices.find((x) => x.kind === kind);
  if (!d) {
    throw new Error(`the maxed machine has no ${kind}`);
  }
  return d;
}

/** The chip faces a build lists, as [what runs, slot or ''] pairs (a copper entry is not a face). */
const faces = (b: PartBuild): [unknown, unknown][] =>
  b.chips.map((c) => ('face' in c ? [c.face[1], or(c.face[4], '')] : ['traces', '']));

const build = (kind: string, live = true): { d: DeviceSnap; b: PartBuild } => {
  const s = maxedSnapshot(),
    d = part(s, kind);
  return { d, b: buildPart(d, context(s, live)) };
};

describe('the CPU builder', () => {
  const { d, b } = build('cpu');
  it('names its part and puts one root on the machine', () => {
    expect(b.id).toBe(d.id);
    expect(b.kind).toBe('cpu');
    expect(b.slot).toBe(d.slot);
    expect(b.roots).toHaveLength(1);
  });
  it('lists the live die face as a chip-face entry', () => {
    expect(faces(b).map(([what]) => what)).toStrictEqual(['die']);
  });
  it('fades its lid, reveals over the die, and flies to the die on a rail', () => {
    expect(b.fades).toHaveLength(1);
    expect(b.reveals).toHaveLength(1);
    expect(b.rails).toHaveLength(1);
    expect(b.rails[0]?.id).toBe(d.id);
    expect(b.rails[0]?.rect).toMatchObject({ x: DIE.x, y: DIE.y, w: DIE.w, h: DIE.h });
  });
  it('has one skin for its device and no stick, card or cooler', () => {
    expect(b.skins.map(([id]) => id)).toStrictEqual([d.id]);
    expect(b.stick).toBeNull();
    expect(b.card).toBeNull();
    expect(b.cooler).toBeNull();
  });
});

describe('the TPM builder', () => {
  it('on a live view lists its die as a chip-face entry and leaves the reveals to the live layer', () => {
    const { d, b } = build('tpm', true);
    expect(b.kind).toBe('tpm');
    expect(b.roots).toHaveLength(1);
    expect(b.chips.length).toBeGreaterThan(0);
    expect(new Set(faces(b).map(([what]) => what))).toStrictEqual(new Set(['tpm']));
    expect(new Set(faces(b).map(([, slot]) => slot))).toStrictEqual(new Set([d.slot]));
    expect(b.reveals).toHaveLength(0);
    expect(b.rails.map((r) => r.id)).toStrictEqual([d.id]);
    expect(b.powerRoots.map(([id]) => id)).toStrictEqual([d.id]);
  });
  it('without a live view bakes its die still and fades it with the camera', () => {
    const { d, b } = build('tpm', false);
    expect(b.chips).toHaveLength(0);
    expect(b.reveals).toHaveLength(1);
    expect(b.rails.map((r) => r.id)).toStrictEqual([d.id]);
    expect(b.powerRoots.map(([id]) => id)).toStrictEqual([d.id]);
  });
});

describe('the RAM stick builder', () => {
  const s = maxedSnapshot(),
    d = part(s, 'ram'),
    b = buildPart(d, context(s, true));
  it('adds its stick entry for the memory bank, by slot', () => {
    expect(b.stick).not.toBeNull();
    expect(b.stick?.idx).toBe(idx(d.slot));
    expect(b.stick?.faces.length).toBeGreaterThan(0);
  });
  it('puts its group and its click target on the machine, and fades its spreader', () => {
    expect(b.roots).toHaveLength(2);
    expect(b.fades).toHaveLength(1);
  });
  it('reveals its dies over its own socket', () => {
    expect(b.reveals).toHaveLength(1);
    const r = dimmRect(idx(d.slot));
    expect(b.reveals[0]?.anywhere).toBe(false);
    expect(b.reveals[0]?.at.x).toBeCloseTo(r.x + r.w / 2);
    expect(b.reveals[0]?.at.y).toBeCloseTo(-(r.y + r.h / 2));
  });
  it('has one skin and no chip faces', () => {
    expect(b.skins.map(([id]) => id)).toStrictEqual([d.id]);
    expect(b.chips).toHaveLength(0);
    expect(b.card).toBeNull();
  });
});
