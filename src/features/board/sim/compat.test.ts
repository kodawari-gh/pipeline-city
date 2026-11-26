import { describe, expect, it } from 'vitest';
import { Prng } from '@/core/sim';
import {
  checkCompat,
  compatProblems,
  cpuFullLoad,
  cpuVrmRatio,
  createBoard,
  findDevices,
  fullDrawW,
  install,
  deviceSpec,
  ratedLoadW,
  safeCpuClock,
  setClock,
  ThermalModel,
} from './index';
import type * as simTypes from './index';
import { FANS_ON } from './thermal';

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

function build(tier: number, parts: string[]) {
  const b = createBoard(tier);
  for (const s of parts) {
    expect(install(b, s).ok, `for ${s}`).toBe(true);
  }
  return b;
}
const ids = (b: ReturnType<typeof createBoard>) => checkCompat(b).map((i) => i.id);

describe('compatibility checks', () => {
  it('a plain starter-class build has no problems', () => {
    expect(compatProblems(build(1, ['cpu1', 'ram0', 'display0', 'cooler1', 'fan120', 'psu1']))).toStrictEqual([]);
  });

  it('a bare CPU heatsink is a tip, and it may run the CPU hot', () => {
    const b = build(1, ['cpu1', 'ram0', 'display0', 'cooler1', 'psu1']);
    const tip = must(checkCompat(b).find((i) => i.id === 'cooler-no-fan'));
    expect(tip).toMatchObject({ severity: 'tip' });
    expect(tip.message).toContain('120 mm');
    expect(ids(build(1, ['cpu1', 'ram0', 'display0', 'cooler1', 'fan120', 'psu1']))).not.toContain('cooler-no-fan');
  });

  it('the static VRM ratio matches what the thermal model sees at full load', () => {
    const b = build(3, ['cpu5h', 'ram0', 'display0', 'cooler2', 'psu2']),
      cpu = must(findDevices(b, 'cpu')[0]);
    const th = new ThermalModel(new Prng(1));
    const load = cpuFullLoad(specOf(deviceSpec(cpu), 'cpu'));
    th.step(b, { cpu: load }, true, { ...FANS_ON, caseFans: 0 });
    expect(cpuVrmRatio(b, cpu.id)).toBeCloseTo(th.vrm.loadRatio, 2);
  });

  it("a CPU too big for its board's regulator is a warning, names the part and gives a safe clock that clears it", () => {
    const b = build(3, ['cpu5h', 'ram0', 'display0', 'cooler2', 'psu2']),
      cpu = must(findDevices(b, 'cpu')[0]);
    expect(cpuVrmRatio(b, cpu.id)).toBeGreaterThan(1);
    const issue = checkCompat(b).find((i) => i.id === 'vrm-overload');
    expect(issue).toMatchObject({ severity: 'warn', part: cpu.id });
    expect(must(issue).message).toContain('crashes');
    const safe = must(must(issue).fix).clock;
    expect(safe).toBe(safeCpuClock(b, cpu.id));
    expect(setClock(b, cpu.id, safe).ok).toBe(true);
    expect(cpuVrmRatio(b, cpu.id)).toBeLessThanOrEqual(1);
    expect(ids(b)).not.toContain('vrm-overload');
  });

  it('a build that crashes in the sim is exactly one the check warns about, and the safe clock stops the crashes', () => {
    const run = (b: ReturnType<typeof createBoard>) => {
      const cpu = must(findDevices(b, 'cpu')[0]),
        th = new ThermalModel(new Prng(1)),
        load = cpuFullLoad(specOf(deviceSpec(cpu), 'cpu'));
      let unstable = false;
      for (let i = 0; i < 5; i++) {
        th.step(b, { cpu: load }, true, { ...FANS_ON, caseFans: 0 });
        unstable ||= th.vrm.unstable;
      } // the first ticks: the CPU has not heated up and throttled yet
      return unstable;
    };
    const b = build(3, ['cpu5h', 'ram0', 'display0', 'cooler2', 'psu2']),
      cpu = must(findDevices(b, 'cpu')[0]);
    expect(run(b)).toBe(true);
    setClock(b, cpu.id, must(safeCpuClock(b, cpu.id)));
    expect(run(b)).toBe(false);
  });

  it('errors come before warnings and tips, and a loop with no radiator is a tip', () => {
    const b = build(3, ['cpu5h', 'ram0', 'display0', 'cooler2', 'psu2']);
    const order = checkCompat(b).map((i) => i.severity),
      rank = { error: 0, warn: 1, tip: 2 } as const;
    expect(order).toStrictEqual(order.toSorted((a, c) => rank[a] - rank[c]));
    expect(ids(b)).toContain('loop-no-radiator');
  });

  it('every issue is self-describing: id, severity and a plain sentence', () => {
    for (const i of checkCompat(build(3, ['cpu5h', 'ram0', 'display0', 'cooler2', 'psu2']))) {
      expect(i.id).toMatch(/^[a-z-]+$/u);
      expect(['error', 'warn', 'tip']).toContain(i.severity);
      expect(i.message.length).toBeGreaterThan(20);
    }
  });
});

// (Build my PC fits a part the supply cannot feed: `install` with `power: false`; the check says what the machine will do)
const loose = (tier: number, parts: string[]) => {
  const b = createBoard(tier);
  for (const s of parts) {
    expect(install(b, s, undefined, { power: false }).ok, `for ${s}`).toBe(true);
  }
  return b;
};

describe('the supply', () => {
  it("the full draw is the parts' watts and what the regulators waste, and the supply issues quote it", () => {
    const b = loose(1, ['psu0', 'cpu2', 'cooler0', 'ram2', 'display0']);
    expect(fullDrawW(b)).toBeGreaterThan(ratedLoadW(b));
    expect(checkCompat(b).find((i) => i.id === 'psu-brownout')).toMatchObject({ value: fullDrawW(b), limit: 40 });
  });

  it('a supply a little short is a warning (the machine runs slower), a supply far short an error (it trips), a supply that carries it says nothing', () => {
    const parts = ['cpu2', 'cooler0', 'ram2', 'display0'];
    const little = must(checkCompat(loose(1, ['psu0', ...parts])).find((i) => i.id === 'psu-brownout'));
    expect(little).toMatchObject({ severity: 'warn' });
    expect(little.message).toMatch(
      /The power supply gives 40 W\. The voltage sags and the machine runs at \d+% of its speed/u,
    );
    const far = checkCompat(loose(1, ['psu0', ...parts, 'gpu1'])),
      trip = must(far.find((i) => i.id === 'psu-trip'));
    expect(trip).toMatchObject({ severity: 'error' });
    expect(trip.message).toMatch(/The power supply gives 40 W\. It trips/u);
    expect(far.map((i) => i.id)).not.toContain('psu-brownout');
    const fine = ids(loose(1, ['psu1', ...parts]));
    expect(fine).not.toContain('psu-brownout');
    expect(fine).not.toContain('psu-trip');
  });

  it('a card needs a lead the supply has: a supply with none gives an error, and the issue names the supply', () => {
    const b = loose(1, ['psu1', 'cpu1', 'cooler0', 'ram0', 'gpu2']),
      psu = must(findDevices(b, 'psu')[0]);
    const leads = must(checkCompat(b).find((i) => i.id === 'pcie-leads'));
    expect(leads).toMatchObject({ severity: 'error', part: psu.id });
    expect(leads.message).toContain('The power supply has none');
  });
});
