// The card builders (GPU, NPU, NIC): each kind's part build, made directly from a part and a read-only context, with no Machine3D.
// What a card adds: its rails, reveals, fades, skin, card model and (a NIC) its LAN lamps. The builder never writes to the context.
import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import type { DeviceSnap } from '@/worker/game/types';
import { builtinTheme } from '@/core/render/theme';
import { ArtSet } from './artset3d';
import { basementPlan } from './basement3d';
import type { Card3D } from './card3d';
import { buildPart } from './parts';
// oxlint-disable-next-line eslint/no-duplicate-imports -- `consistent-type-specifier-style` puts a module's types in an import of their own
import type { PartBuild, PartContext } from './parts';
import { quietCanvas } from './testutil';

quietCanvas();

/** A context as a test builds it: no machine, no live chips, nothing fitted but the part. */
const context = (): PartContext =>
  Object.freeze({
    art: new ArtSet(),
    T: builtinTheme(),
    live: false,
    fans: [],
    rad: null,
    cages: [],
    plan: basementPlan(),
    rects: new Map(),
    caseRgb: true,
    hoses: () => null,
  });

function fit(g: Game, spec: string, slot: string): void {
  const b = g.purchase(spec);
  if (!b.ok) {
    throw new Error(`buy ${spec}: ${b.reason}`);
  }
  const r = g.install(b.invId, slot);
  if (!r.ok) {
    throw new Error(`fit ${spec}: ${JSON.stringify(r)}`);
  }
}

/** The first fitted part of a kind, from a maxed sandbox (a card bought for the kinds it has none of). */
function part(kind: 'gpu' | 'npu' | 'nic', buy?: string): DeviceSnap {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  if (buy !== undefined) {
    fit(g, buy, 'pcie0');
  }
  const d = g.snapshot().devices.find((x) => x.kind === kind);
  if (!d) {
    throw new Error(`no ${kind} fitted`);
  }
  return d;
}

/** The card model of a build (a card's build always has one). */
function cardOf(b: PartBuild): Card3D {
  if (!b.card) {
    throw new Error(`${b.id} has no card model`);
  }
  return b.card;
}

const rails = (b: PartBuild): string[] => b.rails.map((r) => r.id);

/** What every card's build shares. */
function common(b: PartBuild, d: DeviceSnap): void {
  expect(b.id).toBe(d.id);
  expect(b.kind).toBe(d.kind);
  expect(b.slot).toBe(d.slot);
  expect(b.roots.length).toBeGreaterThan(0);
  expect(b.fades).toContain(cardOf(b).root);
  expect(b.obstacles).toContain(cardOf(b).root);
  expect(b.reveals.length).toBeGreaterThan(0);
  expect(b.skins.map(([id]) => id)).toStrictEqual([d.id]);
  expect(b.cooler).toBeNull();
  expect(b.stick).toBeNull();
  expect(b.drive).toBeNull();
}

describe('the card builders', () => {
  it.each([
    { kind: 'gpu' as const, buy: 'gpu1' },
    { kind: 'npu' as const, buy: 'npu1' },
  ])('builds a $kind with a flight to the card and one to each of its dies', ({ kind, buy }) => {
    const d = part(kind, buy);
    const b = buildPart(d, context());
    common(b, d);
    expect(rails(b)).toContain(d.id);
    const { dies, lids } = cardOf(b);
    expect(dies.length).toBeGreaterThan(0);
    expect(rails(b)).toStrictEqual(expect.arrayContaining(dies.map((x) => `${d.slot}.${kind}-${x.part}`)));
    expect(b.chips).toStrictEqual(
      expect.arrayContaining(dies.map((x) => ({ face: [x.root, kind, x.rect, x.z, d.slot] }))),
    );
    expect(b.apart).toStrictEqual(expect.arrayContaining(lids));
    expect(b.lan).toStrictEqual([]);
  });

  it('builds a NIC with its flights, its parts, its lids and its LAN lamps', () => {
    const d = part('nic');
    const b = buildPart(d, context());
    common(b, d);
    expect(rails(b)).toContain(d.id);
    const c = cardOf(b);
    expect(c.bodies.length).toBeGreaterThan(0);
    expect(b.lan).toStrictEqual([[d.id, c.lan]]);
    expect(c.lan).not.toBeNull();
    expect(b.apart).toStrictEqual(expect.arrayContaining(c.lids));
    expect(b.still).toStrictEqual([c.parts].filter(Boolean));
  });

  it('never writes to its context and builds the same part twice alike', () => {
    const d = part('gpu', 'gpu1');
    const ctx = context();
    const a = buildPart(d, ctx),
      b = buildPart(d, ctx);
    expect(rails(a)).toStrictEqual(rails(b));
    expect(a.reveals).toHaveLength(b.reveals.length);
    expect(a.fades).toHaveLength(b.fades.length);
    expect(ctx.rects.size).toBe(0);
  });
});
