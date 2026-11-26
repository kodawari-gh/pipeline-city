import { describe, expect, it } from 'vitest';
import { UNFANNED_SHARE, basicFan, deviceSpec, fittedRadiator, getSpec, mountFan, sideMounts } from '.';
import type * as simTypes from '.';
import { Game } from '@/worker/game/game';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

type Kind = simTypes.DeviceSpec['kind'];
type SpecOf<K extends Kind> = Extract<simTypes.DeviceSpec, { kind: K }>;

/** Whether `spec` is a part of `kind`. */
function isKind<K extends Kind>(spec: simTypes.DeviceSpec, kind: K): spec is SpecOf<K> {
  return spec.kind === kind;
}

/** `spec` narrowed to its `kind`; fails the test when it is missing or some other part. */
function specOf<K extends Kind>(spec: simTypes.DeviceSpec | undefined, kind: K): SpecOf<K> {
  if (spec === undefined || !isKind(spec, kind)) {
    throw new Error(`expected a ${kind} spec, got ${spec?.kind ?? 'nothing'}`);
  }
  return spec;
}

// A radiator spans every fan of its side: its cooling grows with the share of those fans that turn (docs/ASSEMBLY.md "Fan cables").
const rig = (): Game => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true });

describe("a radiator over its side's fans", () => {
  it('the maxed rig has the radiator on the top, over both top fans', () => {
    const g = rig(),
      r = must(fittedRadiator(g.board));
    expect(r.side).toBe('top');
    expect(r.mounts).toStrictEqual(sideMounts(g.board.caseTier, 'top'));
    expect(r.mounts).toHaveLength(2);
    expect(r.mounts.map((m) => mountFan(g.board, m)?.spec)).toStrictEqual(['fan140x', 'fan140x']);
  });

  it('its cooling follows the air its turning fans move, from half of it (none) to all of it (a basic fan on every mount, or more)', () => {
    const g = rig(),
      r = must(fittedRadiator(g.board)),
      k = specOf(deviceSpec(r.dev), 'radiator').coolingPerC;
    for (const id of r.mounts) {
      g.cables[`fan:${id}`] = true;
    }
    g.cables['sysfan'] = true;
    expect(g.fanPower().loopK).toBeCloseTo(k); // two high-airflow fans: more than the radiator needs
    g.cables[`fan:${r.mounts[0]}`] = false;
    const one = Math.min(1, specOf(getSpec('fan140x'), 'fan').airflow / (2 * basicFan(140).airflow));
    expect(g.fanPower().loopK).toBeCloseTo(k * (UNFANNED_SHARE + (1 - UNFANNED_SHARE) * one));
    expect(one).toBeLessThan(1);
    for (const id of r.mounts) {
      g.cables[`fan:${id}`] = false;
    }
    expect(g.fanPower().loopK).toBeCloseTo(k * UNFANNED_SHARE);
    for (const id of r.mounts) {
      g.cables[`fan:${id}`] = true;
    }
    g.cables['sysfan'] = false; // no hub, no fan turns
    expect(g.fanPower().loopK).toBeCloseTo(k * UNFANNED_SHARE);
  });

  it('the fans under the radiator are not counted as case fans; the others are', () => {
    const g = rig(),
      r = must(fittedRadiator(g.board));
    for (const id of Object.keys(g.cables).filter((key) => key.startsWith('fan:'))) {
      g.cables[id] = true;
    }
    g.cables['sysfan'] = true;
    const all = Object.keys(g.cables).filter((id) => id.startsWith('fan:')).length;
    expect(g.fanPower().caseFans).toBe(all - r.mounts.length);
  });
});
