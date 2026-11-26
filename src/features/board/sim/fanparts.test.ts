import { describe, expect, it } from 'vitest';
import { Prng } from '@/core/sim';
import { Game } from '@/worker/game/game';
import { migrate, parseSave } from '@/worker/game/save';
import type * as saveTypes from '@/worker/game/save';
import { econ } from '@/worker/game/testkit';
import {
  createBoard,
  deviceSpec,
  fanAir,
  fanShare,
  fanSlots,
  fansOn,
  findDevices,
  freeSlots,
  install,
  mountFan,
  slotFits,
  strayFans,
  ThermalModel,
  uninstall,
} from '.';
import type * as simTypes from '.';
import { buildGraph, devNode, removalPlan } from './removal';
import { caseMounts, CASE_TIERS, getSpec } from './specs';
import { FANS_ON } from './thermal';
import type * as thermalTypes from './thermal';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The reason `r` was refused; fails the test when it went through. */
function refusal(r: { ok: true } | { ok: false; reason: string }): string {
  if (r.ok) {
    throw new Error('expected a refusal, but it went through');
  }
  return r.reason;
}

/** Id of the first installed device of `kind`; fails the test when there is none. */
function firstId(board: simTypes.Board, kind: simTypes.DeviceSpec['kind']): string {
  return must(findDevices(board, kind)[0]).id;
}

/** Thermal state of the first installed device of `kind`; fails the test when it is missing. */
function stateOf(
  th: simTypes.ThermalModel,
  board: simTypes.Board,
  kind: simTypes.DeviceSpec['kind'],
): simTypes.DeviceThermal {
  return must(th.state(firstId(board, kind)));
}

const rig = (extra: string[], parts = ['cpu0', 'psu0', 'ram0', 'display0', 'cooler0']): simTypes.Board => {
  const b = createBoard(0);
  for (const s of [...parts, ...extra]) {
    expect(install(b, s).ok, `for ${s}`).toBe(true);
  }
  return b;
};
/** The fan spots a part's spec declares, if its kind has any. */
const fanSpotsOf = (spec: simTypes.DeviceSpec | undefined): unknown =>
  spec !== undefined && 'fanSpots' in spec ? spec.fanSpots : undefined;
const free = (b: simTypes.Board, spec: string): string[] => freeSlots(b, 'fan', getSpec(spec)).map((s) => s.id);

describe('a fan fits only a spot of its size', () => {
  it("a case's mounts take the case's size, on every tier", () => {
    for (let t = 0; t < CASE_TIERS.length; t++) {
      const b = createBoard(0);
      b.caseTier = t;
      expect(fanSlots(b).map((s) => s.id)).toStrictEqual(caseMounts(t));
      for (const s of fanSlots(b)) {
        expect(s.size).toBe(must(CASE_TIERS[t]).fanSize);
      }
    }
  });

  it('a 120 mm fan is refused on a Mini mount and on the stock heatsink, with the size in the reason', () => {
    const b = rig([]);
    expect(free(b, 'fan120')).toStrictEqual([]);
    expect(install(b, 'fan120', 'front0').ok).toBe(false);
    const onCooler = install(b, 'fan120', 'cooler0.fan0');
    expect(refusal(onCooler)).toContain('92');
    expect(install(b, 'fan92', 'cooler0.fan0').ok).toBe(true);
  });

  it("a free fan goes to a heatsink's spot before a case mount", () => {
    expect(free(rig([]), 'fan92')).toStrictEqual(['cooler0.fan0', 'front0', 'front1']);
  });

  it('the 40 mm fan fits only fan fins', () => {
    const b = createBoard(2);
    expect(free(b, 'fan40')).toStrictEqual([]);
    expect(install(b, 'vsink2').ok).toBe(true);
    expect(free(b, 'fan40')).toStrictEqual(['vrm-sink0.fan0']);
  });
});

describe("a host's fan spots", () => {
  it('the tower shows two spots only while it is fitted; the plain fins and the liquid block have none', () => {
    const b = createBoard(1);
    b.caseTier = 2;
    expect(install(b, 'cpu1').ok).toBe(true);
    expect(fanSlots(b).filter((s) => s.id.startsWith('cooler0'))).toStrictEqual([]);
    const c = install(b, 'cooler1');
    expect(c.ok).toBe(true);
    expect(
      fanSlots(b)
        .filter((s) => s.id.startsWith('cooler0'))
        .map((s) => [s.id, s.size]),
    ).toStrictEqual([
      ['cooler0.fan0', 120],
      ['cooler0.fan1', 120],
    ]);
    uninstall(b, firstId(b, 'cooler'));
    expect(fanSlots(b).filter((s) => s.id.startsWith('cooler0'))).toStrictEqual([]);
    for (const s of ['vsink0', 'vsink1', 'rsink0', 'rsink1', 'cooler2']) {
      expect(fanSpotsOf(getSpec(s))).toBeUndefined();
    }
  });

  it("a fan on a heatsink's spot is listed on that host; one on a case mount on the mount", () => {
    const b = rig(['fan92']);
    expect(fansOn(b, 'cooler0').map((f) => f.slot)).toStrictEqual(['cooler0.fan0']);
    expect(install(b, 'fan92', 'front0').ok).toBe(true);
    expect(mountFan(b, 'front0')?.spec).toBe('fan92');
    expect(mountFan(b, 'front1')).toBeUndefined();
  });

  it('a fan whose spot is gone is a stray; a spot of another size makes one too', () => {
    const b = rig(['fan92']);
    expect(install(b, 'fan92', 'front0').ok).toBe(true);
    expect(strayFans(b)).toStrictEqual([]);
    b.caseTier = 2; // 120 mm mounts
    expect(strayFans(b).map((f) => f.slot)).toStrictEqual(['front0']);
  });
});

const off = () => {
  const g = new Game({
    seed: 1,
    preassembled: true,
    economy: { ...econ([]), levelGating: false, caseGating: false },
  });
  g.money = 1e6;
  g.powerButton();
  return g;
};

const fit = (g: Game, spec: string): void => {
  const b = g.purchase(spec);
  if (!b.ok) {
    throw new Error(b.reason);
  }
  const r = g.install(b.invId);
  if (!r.ok) {
    throw new Error(r.reason);
  }
};

const spare = (g: Game, spec: string) => g.snapshot().inventory.filter((i) => i.spec === spec).length;

describe('the game sends stray fans to the inventory', () => {
  it('a case swap Mini to Mid sends the two front fans back and unplugs their cables; the heatsink keeps its fan', () => {
    const g = off();
    expect(g.cables['fan:front0']).toBe(true);
    fit(g, 'case2');
    expect(spare(g, 'fan92')).toBe(2);
    expect(g.board.devices.filter((d) => d.spec === 'fan92').map((d) => d.slot)).toStrictEqual(['cooler0.fan0']);
    expect(g.cables['fan:front0']).not.toBe(true);
  });

  it("the removal plan takes a heatsink's fan off first; a heatsink that comes off anyway sends its fan back", () => {
    const g = off(),
      cooler = must(findDevices(g.board, 'cooler')[0]),
      fan = must(g.board.devices.find((d) => d.slot === 'cooler0.fan0'));
    const plan = removalPlan(buildGraph(g.board, g.cables), devNode(cooler.id));
    expect(plan.indexOf(devNode(fan.id))).toBeGreaterThanOrEqual(0);
    expect(plan.indexOf(devNode(fan.id))).toBeLessThan(plan.indexOf(devNode(cooler.id)));
    expect(g.uninstall(cooler.id).ok).toBe(true);
    expect(g.board.devices.some((d) => d.slot.startsWith('cooler0'))).toBe(false);
    expect(spare(g, 'fan92')).toBe(1);
    expect(g.cables['cpufan']).not.toBe(true);
  });
});

/** A tier-1 board in a Mid case with a tower heatsink and `fans` on its spots, in order. */
function tower(fans: string[]): simTypes.Board {
  const b = createBoard(1);
  b.caseTier = 2;
  for (const s of ['cpu1', 'psu1', 'ram0', 'display0', 'cooler1']) {
    expect(install(b, s).ok).toBe(true);
  }
  for (const [k, f] of fans.entries()) {
    expect(install(b, f, `cooler0.fan${k}`).ok).toBe(true);
  }
  return b;
}

const settle = (b: simTypes.Board, fans: thermalTypes.FanPower) => {
  const th = new ThermalModel(new Prng(1));
  for (let k = 0; k < 800; k++) {
    th.step(b, { cpu: 1 }, true, fans);
  }
  return stateOf(th, b, 'cpu').tempC;
};

describe('how much a fan helps', () => {
  it('the share curve: bare alone, full at one basic fan, a little more with more air', () => {
    expect(fanShare(0.35, 0)).toBeCloseTo(0.35, 6);
    expect(fanShare(0.35, 1)).toBeCloseTo(1, 6);
    expect(fanShare(0.35, 2)).toBeGreaterThan(1);
    expect(fanShare(0.35, 2)).toBeLessThan(1.3);
    expect(fanShare(0.5, 0.5)).toBeGreaterThan(fanShare(0.5, 0.25));
  });

  it("a fan's air is its airflow, and the fans of a host add up", () => {
    expect(fanAir([])).toBe(0);
    const b = createBoard(1);
    b.caseTier = 2;
    for (const s of ['cpu1', 'cooler1']) {
      expect(install(b, s).ok).toBe(true);
    }
    expect(install(b, 'fan120', 'cooler0.fan0').ok).toBe(true);
    expect(install(b, 'fan120x', 'cooler0.fan1').ok).toBe(true);
    expect(fanAir(fansOn(b, 'cooler0'))).toBeCloseTo(2.5, 6);
    const fan = must(fansOn(b, 'cooler0')[1]);
    expect(deviceSpec(fan).kind).toBe('fan');
  });

  const stock = ['cpu0', 'psu0', 'ram0', 'display0'];

  it('a bare stock heatsink runs hotter than a fanned one, and cooler than no heatsink', () => {
    const none = settle(rig([], stock), { ...FANS_ON });
    const bare = settle(rig([]), { ...FANS_ON });
    const fanned = settle(rig(['fan92']), { ...FANS_ON });
    expect(bare).toBeGreaterThan(fanned);
    expect(bare).toBeLessThan(none);
  });

  it('the fan helps only with its cable plugged', () => {
    const fanned = rig(['fan92']);
    expect(settle(fanned, { ...FANS_ON, cpu: false })).toBeGreaterThan(settle(fanned, { ...FANS_ON }));
  });

  it('two fans on the tower beat one, a little', () => {
    const one = settle(tower(['fan120']), { ...FANS_ON }),
      two = settle(tower(['fan120', 'fan120']), { ...FANS_ON }),
      bare = settle(tower([]), { ...FANS_ON });
    expect(two).toBeLessThan(one);
    expect(one - two).toBeLessThan(bare - one);
  });
});

describe('a bare heatsink at the power button', () => {
  it('boots: only a liquid loop with its pump cable out stops POST', () => {
    const g = new Game({ seed: 2, preassembled: true });
    g.powerButton();
    const fan = must(g.board.devices.find((d) => d.slot === 'cooler0.fan0'));
    g.disconnectCable('cpufan');
    expect(g.uninstall(fan.id).ok).toBe(true);
    g.powerButton();
    g.advanceBaseTick();
    expect(g.snapshot().postBlocker).toBeNull();
    expect(g.powered).toBe(true);
  });
});

/** A version 4 save: the same machine with its built-in fans (no fan devices), all its cables as they were. */
function v4(g: Game) {
  const s = structuredClone(g.toSave());
  return { ...s, version: 4, board: { ...s.board, devices: s.board.devices.filter((d) => !d.spec.startsWith('fan')) } };
}

describe('saves from before the fan parts', () => {
  /** A version 4 save: the same machine with its built-in fans (no fan devices), all its cables as they were. */

  it('fits a basic fan on every mount and the fan each heatsink had built in, from nextId', () => {
    const g = new Game({ seed: 3, preassembled: true });
    const m: saveTypes.Save = parseSave(migrate(v4(g)));
    expect(m.version).toBe(5);
    const fans = m.board.devices.filter((d) => d.spec.startsWith('fan')).map((d) => [d.slot, d.spec]);
    expect(fans).toStrictEqual([
      ['front0', 'fan92'],
      ['front1', 'fan92'],
      ['cooler0.fan0', 'fan92'],
    ]);
    const ids = m.board.devices.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.board.nextId).toBeGreaterThan(Math.max(...ids.map((i) => Number(i.replaceAll(/\D/gu, '')))));
  });

  it('the tower gets one fan; a Full case loses the mounts it no longer has, and their cables', () => {
    const g = new Game({ seed: 3, preassembled: true });
    const s = v4(g);
    s.board.caseTier = 3;
    must(s.board.devices.find((d) => d.spec === 'cooler0')).spec = 'cooler1';
    s.cables['fan:front3'] = true;
    s.cables['fan:top2'] = true;
    s.cables['fan:front0'] = true;
    const m: saveTypes.Save = parseSave(migrate(s));
    expect(m.board.devices.filter((d) => d.spec === 'fan120').map((d) => d.slot)).toStrictEqual(['cooler0.fan0']);
    expect(m.board.devices.filter((d) => d.spec === 'fan140').map((d) => d.slot)).toStrictEqual(caseMounts(3));
    expect(m.cables['fan:front3']).toBeUndefined();
    expect(m.cables['fan:top2']).toBeUndefined();
    expect(m.cables['fan:front0']).toBe(true);
  });

  it('loads with the same fans turning, so the machine cools as it did', () => {
    const g = new Game({ seed: 3, preassembled: true });
    const l = Game.fromSave(v4(g));
    expect(l.fanPower()).toStrictEqual(g.fanPower());
    expect(
      l
        .snapshot()
        .devices.map((d) => d.slot)
        .toSorted(),
    ).toStrictEqual(
      g
        .snapshot()
        .devices.map((d) => d.slot)
        .toSorted(),
    );
    expect(() => Game.fromSave({ ...v4(g), cables: undefined })).toThrow(/version 4/u);
  });

  it("a current fan's slot fits itself", () => {
    const b = rig(['fan92']);
    const s = must(fanSlots(b).find((x) => x.id === 'cooler0.fan0'));
    const fan92 = must(getSpec('fan92')),
      fan120 = must(getSpec('fan120'));
    expect(slotFits(s, fan92)).toBe(true);
    expect(slotFits(s, fan120)).toBe(false);
  });
});
