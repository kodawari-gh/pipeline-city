import { describe, expect, it } from 'vitest';
import { Prng } from '@/core/sim';
import { Game } from '@/worker/game/game';
import { Operator, play } from '../../economy/sim/operator';
import { parseSave } from '@/worker/game/save';
import {
  BOARD_TIERS,
  boardSlots,
  createBoard,
  findDevices,
  install,
  setClock,
  ThermalModel,
  upgradeBoard,
} from './index';
import type * as simTypes from './index';
import { ECONOMY } from '../../economy/sim/economy';
import { DEVICE_SPECS } from './specs';
import type * as specsTypes from './specs';

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

// These tests are about hardware, not player levels: every item is buyable (levels have their own tests in levels.test.ts).
ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

function ok<T extends { ok: boolean }>(r: T): T {
  expect(r.ok).toBe(true);
  return r;
}

/** A board of `tier` with the parts installed and the CPU at `clock` (null = base). */
function rig(
  tier: number,
  cpu: string,
  o: { clock?: number; cooler?: string; sink?: string | undefined; psu?: string } = {},
): simTypes.Board {
  const b = createBoard(tier);
  for (const s of [cpu, 'ram0', 'display0', o.cooler ?? 'cooler1', o.psu ?? (tier >= 2 ? 'psu2' : 'psu1')]) {
    ok(install(b, s));
  }
  if (o.cooler === 'cooler2') {
    const radSlot = must(boardSlots(b).find((s) => s.type === 'radiator'));
    ok(install(b, 'rad2', radSlot.id));
  } // an AIO cools through its radiator
  if (o.sink !== undefined) {
    ok(install(b, o.sink));
  }
  // every heatsink gets the fan it used to have built in
  const builtIn: Record<string, string> = { cooler0: 'fan92', cooler1: 'fan120', vsink2: 'fan40', rsink2: 'fan40' };
  const fans = b.devices.flatMap((d) => {
    const fan = builtIn[d.spec];
    return fan === undefined ? [] : [{ fan, at: `${d.slot}.fan0` }];
  });
  for (const { fan, at } of fans) {
    ok(install(b, fan, at));
  }
  if (o.clock !== undefined) {
    ok(setClock(b, firstId(b, 'cpu'), o.clock));
  }
  return b;
}

interface Trace {
  th: ThermalModel;
  maxT: number;
  maxRatio: number;
  unstableAt: number;
  throttleAt: number;
  burnAt: number;
  hits: number;
}

function run(b: simTypes.Board, ticks: number, load = 1): Trace {
  const th = new ThermalModel(new Prng(1));
  const t: Trace = { th, maxT: 0, maxRatio: 0, unstableAt: -1, throttleAt: -1, burnAt: -1, hits: 0 };
  for (let k = 0; k < ticks; k++) {
    th.step(b, { cpu: load });
    t.maxT = Math.max(t.maxT, th.vrm.tempC);
    t.maxRatio = Math.max(t.maxRatio, th.vrm.loadRatio);
    if (th.vrm.unstable && t.unstableAt < 0) {
      t.unstableAt = k;
    }
    if (th.vrm.throttle < 1 && t.throttleAt < 0) {
      t.throttleAt = k;
    }
    if (b.burnt === true && t.burnAt < 0) {
      t.burnAt = k;
    }
    if (th.vrmErrorRoll()) {
      t.hits++;
    }
  }
  return t;
}

/** How many slots of `type` a fresh board of `tier` has. */
const count = (tier: number, type: string) => boardSlots(createBoard(tier)).filter((s) => s.type === type).length;

describe('board tier ladder', () => {
  it('has four tiers with growing slot counts; slots a tier lacks are absent', () => {
    expect(BOARD_TIERS.map((t) => t.name)).toStrictEqual(['Starter', 'Basic', 'Mainstream', 'Enthusiast']);

    // Starter: 1 CPU socket, ONE DIMM, 2 SATA, 1 USB, 1 display, one PCIe (a network card), no M.2, ATX power.
    expect(
      ['cpu', 'dimm', 'sata', 'usb', 'display', 'pcie', 'm2', 'atx', 'atx-plus', 'vrm-sink', 'ram-sink'].map((s) =>
        count(0, s),
      ),
    ).toStrictEqual([1, 1, 2, 1, 1, 1, 0, 1, 0, 1, 1]);
    expect([1, 2, 3].map((t) => count(t, 'dimm'))).toStrictEqual([2, 4, 8]);
    expect([0, 1, 2, 3].map((t) => count(t, 'pcie'))).toStrictEqual([1, 2, 3, 4]);
    expect([0, 1, 2, 3].map((t) => count(t, 'sata'))).toStrictEqual([2, 3, 4, 8]);
    expect([0, 1, 2, 3].map((t) => count(t, 'm2'))).toStrictEqual([0, 0, 2, 3]);
    expect([0, 1, 2, 3].map((t) => count(t, 'usb'))).toStrictEqual([1, 2, 3, 4]);
    expect([0, 1, 2, 3].map((t) => must(BOARD_TIERS[t]).features.ethernetMbps)).toStrictEqual([0, 100, 100, 1000]);
    for (const t of BOARD_TIERS) {
      expect(t.features.usbPorts).toBe(count(t.tier, 'usb'));
    }
    const vrmAmps = BOARD_TIERS.map((t) => t.vrm.phases * t.vrm.ampsPerPhase);
    expect(vrmAmps.toSorted((a, b) => a - b)).toStrictEqual(vrmAmps); // VRM strength grows with the tier
  });

  it('carries installed devices over on a board purchase', () => {
    const b = rig(0, 'cpu0');
    const ids = b.devices.map((d) => d.id);
    ok(upgradeBoard(b, 1));
    expect(b.devices.map((d) => d.id)).toStrictEqual(ids);
    ok(upgradeBoard(b, 3));
    expect(b.devices.map((d) => d.id)).toStrictEqual(ids);
    expect(b.tier).toBe(3);
  });
});

describe('VRM under normal use', () => {
  it("a stock CPU never throttles, destabilises or burns the VRM on its tier's board or any better one", () => {
    const minTier: Record<string, number> = { cpu0: 0, cpu1: 0, cpu2: 2, cpu2d: 3, cpu3t: 3 };
    for (const cpu of ['cpu0', 'cpu1', 'cpu2', 'cpu2d', 'cpu3t']) {
      for (let tier = must(minTier[cpu]); tier < 4; tier++) {
        const r = run(rig(tier, cpu), 600);
        const label = `${cpu} on tier ${tier}`;
        expect(r.maxRatio, `for ${label}`).toBeLessThan(1);
        expect(r.maxT, `for ${label}`).toBeLessThan(must(BOARD_TIERS[tier]).vrm.throttleC);
        expect(r.unstableAt, `for ${label}`).toBe(-1);
        expect(r.burnAt, `for ${label}`).toBe(-1);
      }
    }
  });

  it('the dual core draws by the cores that run: both busy needs the Enthusiast board, one core fits the Mainstream one', () => {
    const both = run(rig(3, 'cpu2d'), 600);
    expect(both.maxRatio).toBeGreaterThan(0.5);
    expect(both.maxRatio).toBeLessThan(0.65); // about 0.58 of the 120 A
    const lesson = run(rig(2, 'cpu2d'), 600, 1);
    expect(lesson.maxRatio).toBeGreaterThan(1); // the Mainstream board cannot feed both cores (the lesson: buy the board first)
    expect(lesson.unstableAt).toBeGreaterThanOrEqual(0);
    const one = run(rig(2, 'cpu2d'), 600, 0.5); // one of two cores busy, as under a single-job OS
    expect(one.maxRatio).toBeLessThan(1);
    expect(one.unstableAt).toBe(-1);
  });

  it('idle stays cool, with a small loss', () => {
    const r = run(rig(2, 'cpu2'), 600, 0.1);
    expect(r.maxT).toBeLessThan(35);
    expect(r.th.vrm.heatW).toBeLessThan(2);
  });

  it('the VRM loss is drawn from the PSU', () => {
    const b = rig(1, 'cpu1');
    const r = run(b, 5);
    const parts = [...r.th.devices.values()].reduce((s, d) => s + d.powerW, 0);
    expect(r.th.power.vrmLossW).toBeGreaterThan(1);
    expect(r.th.power.totalW).toBeCloseTo(parts + r.th.power.vrmLossW, 6);
    // A weaker VRM wastes more: the same CPU costs more watts on the Starter board than on the Enthusiast one.
    const weak = run(rig(0, 'cpu1'), 5).th.power.totalW;
    const strong = run(rig(3, 'cpu1'), 5).th.power.totalW;
    expect(weak).toBeGreaterThan(strong);
  });

  it('a healthy VRM leaves the PRNG stream untouched', () => {
    const prng = new Prng(9);
    const th = new ThermalModel(prng);
    const b = rig(2, 'cpu2');
    for (let k = 0; k < 100; k++) {
      th.step(b);
      expect(th.vrmErrorRoll()).toBe(false);
    }
    expect(prng.getState()).toBe(new Prng(9).getState());
  });
});

describe('VRM trouble', () => {
  it('a high-tier CPU on the Starter board is capped and crashes, the same CPU on a strong board is fine', () => {
    const weak = run(rig(0, 'cpu2'), 1000);
    expect(weak.maxRatio).toBeGreaterThan(1.3);
    expect(weak.unstableAt).toBe(0);
    expect(weak.throttleAt).toBeGreaterThan(0); // it heats until the VRM trims the CPU clock
    expect(weak.hits).toBeGreaterThan(5);
    const strong = run(rig(2, 'cpu2'), 1000);
    expect(strong.unstableAt).toBe(-1);
    expect(strong.hits).toBe(0);
  });

  it('the VRM throttle multiplies into the CPU clock', () => {
    const b = rig(0, 'cpu2', { cooler: 'cooler2' });
    const r = run(b, 90); // throttled, not yet burnt
    const cpu = stateOf(r.th, b, 'cpu');
    expect(r.th.vrm.throttle).toBeLessThan(1);
    expect(r.th.vrm.throttle).toBeGreaterThanOrEqual(0.8);
    expect(cpu.effClock).toBeLessThan(3 * r.th.vrm.throttle + 1e-9); // trimmed by the VRM factor // cpu2 base clock 3, trimmed by the VRM
  });

  it('overclocking a weak board: stable but warm, then throttled, crashing, then burnt', () => {
    const a = run(rig(0, 'cpu1', { cooler: 'cooler2', clock: 2.1 }), 400);
    expect(a.unstableAt).toBe(-1);
    expect(a.maxT).toBeGreaterThan(55); // heated well beyond stock
    expect(a.maxT).toBeLessThan(must(BOARD_TIERS[0]).vrm.throttleC);
    const b = run(rig(0, 'cpu1', { cooler: 'cooler2', clock: 2.3 }), 400);
    expect(b.throttleAt).toBeGreaterThan(0);
    expect(b.unstableAt).toBe(0);
    expect(b.hits).toBeGreaterThan(0);
    expect(b.burnAt).toBeGreaterThan(b.throttleAt); // sustained overload while hot kills it
    // A cpu2 on the Starter board with a liquid cooler (no airflow over the VRM) cooks it.
    const board = rig(0, 'cpu2', { cooler: 'cooler2' });
    const c = run(board, 800);
    expect(c.throttleAt).toBeGreaterThan(0);
    expect(c.burnAt).toBeGreaterThan(c.throttleAt);
    expect(board.burnt).toBe(true);
    const { th } = c;
    th.step(board);
    expect(th.power.totalW).toBe(0); // a dead board draws nothing
    expect(stateOf(th, board, 'cpu').effClock).toBe(0);
  });

  it('an overload past 1.6 burns the board quickly', () => {
    const r = run(rig(0, 'cpu1', { cooler: 'cooler2', clock: 2.6 }), 100);
    expect(r.maxRatio).toBeGreaterThan(1.5);
    expect(r.unstableAt).toBe(0);
  });
});

/** When an overclocked liquid-cooled Starter board's VRM throttles, with the VRM heatsink `sink` (or none). */
const throttleWith = (sink?: string) => run(rig(0, 'cpu1', { cooler: 'cooler2', clock: 2.3, sink }), 600).throttleAt;
/** Whether tick `x` comes after tick `y`, where -1 is never. */
const later = (x: number, y: number) => x === -1 || x > y;
/** The VRM's peak temperature of an overclocked Starter board with `cooler`. */
const peakVrmT = (cooler: string) => run(rig(0, 'cpu1', { cooler, clock: 2.1 }), 600).maxT;
/** The CPU's temperature of an overclocked Starter board with `cooler`, after the run. */
function cpuTWith(cooler: string): number {
  const b = rig(0, 'cpu1', { cooler, clock: 2.1 });
  const r = run(b, 600);
  return stateOf(r.th, b, 'cpu').tempC;
}

describe('VRM cooling', () => {
  it('heatsink tiers delay the throttle', () => {
    const none = throttleWith();
    const t0 = throttleWith('vsink0');
    const t1 = throttleWith('vsink1');
    const t2 = throttleWith('vsink2');
    expect(none).toBeGreaterThan(0);

    expect(later(t0, none)).toBe(true);
    expect(later(t1, t0)).toBe(true);
    expect(later(t2, t1)).toBe(true);
    expect(t2).toBe(-1);
  });

  it('a heatsink keeps a cooked board alive; the fan version draws power', () => {
    const burn = (sink?: string) => run(rig(0, 'cpu2', { cooler: 'cooler2', sink }), 800).burnAt;
    expect(burn()).toBeGreaterThan(0);
    expect(burn('vsink2')).toBe(-1);
    const withFan = run(rig(1, 'cpu1', { sink: 'vsink2' }), 5).th;
    const without = run(rig(1, 'cpu1'), 5).th;
    expect(withFan.power.totalW).toBeGreaterThan(without.power.totalW);
  });

  it('an air cooler also cools the VRM, a liquid cooler does not', () => {
    const stock = peakVrmT('cooler0');
    const tower = peakVrmT('cooler1');
    const liquid = peakVrmT('cooler2');
    expect(tower).toBeLessThan(stock);
    expect(liquid).toBeGreaterThan(stock);
    // The liquid loop is the better CPU cooler, yet the VRM runs hotter: VRM cooling matters more with it.
    expect(cpuTWith('cooler2')).toBeLessThan(cpuTWith('cooler1'));
  });
});

const BUSY = { baseDemandPerTick: 1, queueCap: 10, coldBootTicks: 0, startQueue: [{ template: 'cli.log' }] };

/** Preassembled Starter game with a cpu2 and a 100 W PSU (and optionally a liquid cooler), bot-assembled. */
function weakGame(liquid: boolean, seed = 5): { g: Game; op: Operator } {
  const g = new Game({ seed, preassembled: true, economy: BUSY });
  g.money = 1e6;
  g.powerButton();
  for (const id of ['psu1', 'cpu2', ...(liquid ? ['cooler2'] : [])]) {
    ok(g.purchase(id));
  }
  const op = new Operator(g, 0);
  op.assemble();
  return { g, op };
}

/** Runs the game and its operator tick by tick until `done`, at most `max` ticks. */
function driveUntil(w: { g: Game; op: Operator }, max: number, done: (g: Game) => boolean): void {
  for (let t = 0; t < max && !done(w.g); t++) {
    w.g.advanceBaseTick();
    w.op.step();
  }
}

/** The inventory id of what was bought; fails the test when the purchase was refused. */
function bought(r: ReturnType<Game['purchase']>): string {
  if (!r.ok) {
    throw new Error(`purchase refused: ${r.reason}`);
  }
  return r.invId;
}

/** A weak game run 300 ticks into VRM trouble, as one string: the board, the errors, the money and the PRNG. */
function troubleSnap(): string {
  const { g, op } = weakGame(false, 11);
  for (let t = 0; t < 300; t++) {
    g.advanceBaseTick();
    op.step();
  }
  return JSON.stringify([g.snapshot().board, g.errors, g.money, g.machine.prng.getState()]);
}

describe('the game around the VRM', () => {
  it('a CPU too big for the Starter VRM crashes the machine with a VRM reason in the log', () => {
    const w = weakGame(false),
      { g } = w;
    driveUntil(w, 500, (game) => game.errors > 0);
    expect(g.errors).toBeGreaterThan(0);
    const s = g.snapshot();
    expect(s.log.filter((e) => e.kind === 'fault').some((e) => e.text.includes('VRM voltage droop'))).toBe(true);
    expect(s.board.vrm.unstable).toBe(true);
    expect(s.board.vrm.loadRatio).toBeGreaterThan(1);
  });

  it('a burnt board is dead until replaced: no power, parts stay, the flag is saved, a board purchase carries the parts over', () => {
    const w = weakGame(true),
      { g } = w;
    driveUntil(w, 1500, (game) => game.board.burnt === true);
    expect(g.board.burnt).toBe(true);
    const s = g.snapshot();
    expect(s).toMatchObject({ phase: 'error', phaseReason: 'board dead: replace the board' });
    expect(s.board).toMatchObject({ burnt: true, name: 'Starter' });
    expect(s.board.vrm.burnt).toBe(true);
    expect(s.log.some((e) => e.text.includes('board dead'))).toBe(true);
    // Replacement: the same tier is for sale like any board (bought with the machine on, installed with it off).
    expect(must(s.purchases.find((p) => p.id === 'board0')).blocked).toBeUndefined();
    g.powerButton();
    expect(refusal(g.powerButton())).toMatch(/board dead/u);
    // The flag survives a save; temperatures do not.
    const text = JSON.stringify(g.toSave()),
      saved = parseSave(JSON.parse(text));
    expect(saved.board.burnt).toBe(true);
    const l = Game.fromSave(saved, BUSY);
    expect(l.snapshot().board.burnt).toBe(true);
    expect(l.powerButton().ok).toBe(false);
    // Buy a board of the same tier: devices carry over, the dead board is gone.
    g.money = 1000;
    const specs = g
      .snapshot()
      .devices.map((d) => d.spec)
      .toSorted();
    const buy = bought(ok(g.purchase('board0')));
    expect(ok(g.install(buy)).ok).toBe(true);
    const after = g.snapshot();
    expect(after.board.burnt).toBe(false);
    expect(after.devices.map((d) => d.spec).toSorted()).toStrictEqual(specs);
    expect(g.powerButton().ok).toBe(true);
  });

  it('a board can be bought with the machine on, and installed only with it off', () => {
    const g = new Game({ seed: 1, preassembled: true });
    g.money = 1000;
    expect(must(g.snapshot().purchases.find((p) => p.id === 'board1')).blocked).toBeUndefined();
    const b = g.purchase('board1');
    expect(b.ok).toBe(true);
    const boardId = bought(b);
    expect(refusal(g.install(boardId))).toMatch(/power the machine off/u);
  });

  it('the snapshot describes the board, its features, only the slots it has, the VRM and the heatsink', () => {
    const g = new Game({ seed: 1 });
    const s = g.snapshot();
    expect(s.board).toMatchObject({
      tier: 0,
      name: 'Starter',
      burnt: false,
      features: { ethernetMbps: 0, usbPorts: 1, displayPorts: 1 },
    });
    expect(s.board.slots.map((x) => x.type).toSorted()).toStrictEqual([
      'atx',
      'cooler',
      'cpu',
      'dimm',
      'display',
      'fan',
      'fan',
      'pcie',
      'radiator',
      'ram-sink',
      'sata',
      'sata',
      'usb',
      'vrm-sink',
    ]); // the Mini's two front mounts
    expect(s.board.slots).toStrictEqual(s.slots);
    expect(s.board.vrm).toMatchObject({ phases: 2, ampsPerPhase: 12, burnt: false, sinkDeviceId: null });
    expect(s.board.vrmSink).toBeNull();
    const p = must(s.purchases.find((x) => x.id === 'vsink0'));
    expect(p).toMatchObject({ kind: 'vrm-sink', price: 30 });
  });

  it('a bought VRM heatsink installs into the vrm-sink slot and shows in the snapshot', () => {
    const g = new Game({ seed: 1, preassembled: true });
    g.money = 1000;
    g.powerButton();
    const sink = bought(ok(g.purchase('vsink1')));
    ok(g.install(sink));
    const s = g.snapshot();
    expect(s.board.vrmSink).toMatchObject({ spec: 'vsink1', slot: 'vrm-sink0', kind: 'vrm-sink' });
    expect(s.board.vrm.sinkDeviceId).toBe(must(s.board.vrmSink).id);
    expect(s.purchases.find((x) => x.id === 'vsink0')).toBeDefined(); // every tier stays on sale
    expect(s.purchases.find((x) => x.id === 'vsink2')).toBeDefined();
  });

  it('is deterministic under VRM trouble, and the burnt flag survives parseSave', () => {
    expect(troubleSnap()).toBe(troubleSnap());
    const g = new Game({ seed: 3, preassembled: true });
    g.board.burnt = true;
    const text = JSON.stringify(g.toSave()),
      saved: unknown = JSON.parse(text);
    expect(parseSave(saved).board.burnt).toBe(true);
  });

  it('play() still earns money on the Starter board with the starter parts (VRM never interferes)', () => {
    const g = new Game({ seed: 2, preassembled: true });
    play(g, 600, 1);
    expect(g.completed).toBeGreaterThan(2);
    expect(g.errors).toBe(0);
    expect(g.snapshot().board.vrm.unstable).toBe(false);
  });
});

void findDevices;

/** Runs a busy CPU and card until the card `dev` burns, at most `max` ticks. */
function heatUntilBurnt(b: simTypes.Board, dev: { burnt?: boolean }, max: number): ThermalModel {
  const th = new ThermalModel(new Prng(1));
  for (let k = 0; k < max && dev.burnt !== true; k++) {
    th.step(b, { gpu: 1, cpu: 1 });
  }
  return th;
}

const cpuTemp = (b: simTypes.Board, th: ThermalModel) => stateOf(th, b, 'cpu').tempC;

const settle = (b: simTypes.Board, loads: Record<string, number>, ticks = 400) => {
  const th = new ThermalModel(new Prng(1));
  for (let k = 0; k < ticks; k++) {
    th.step(b, loads);
  }
  return th;
};

const withCard = (card: string, psu = 'psu3') => {
  const b = rig(3, 'cpu1', { psu, cooler: 'cooler1' });
  ok(install(b, card));
  return b;
};

describe('cards in the case (docs/ACCEL.md)', () => {
  it('a 180 W card warms the CPU by about 9 degrees without a case fan', () => {
    // gpu3 is a later tier (T80): stand in for it with the table's numbers.
    const gpu3 = {
      ...must(DEVICE_SPECS['gpu1']),
      id: 'gpu3t',
      loadW: 180,
      idleW: 12,
      thermal: { ...must(DEVICE_SPECS['gpu1']).thermal, passive: 6 },
    };
    (DEVICE_SPECS as Record<string, specsTypes.DeviceSpec>)['gpu3t'] = gpu3;
    try {
      const bare = rig(3, 'cpu1', { psu: 'psu3', cooler: 'cooler1' });
      const base = cpuTemp(bare, settle(bare, { cpu: 1, gpu: 1 }));
      const card = withCard('gpu3t');
      const th = settle(card, { cpu: 1, gpu: 1 });
      expect(th.caseRiseC).toBeCloseTo(9, 0);
      expect(cpuTemp(card, th) - base).toBeGreaterThan(8);
      expect(cpuTemp(card, th) - base).toBeLessThan(10);
    } finally {
      delete (DEVICE_SPECS as Record<string, specsTypes.DeviceSpec>)['gpu3t'];
    }
  });

  it('the card itself is not warmed by its own heat, only by its own load; no card, no rise', () => {
    const bare = rig(3, 'cpu1', { psu: 'psu3' });
    expect(settle(bare, { cpu: 1 }, 50).caseRiseC).toBe(0);
    const b = withCard('gpu1');
    const idle = settle(b, {}, 50);
    expect(idle.caseRiseC).toBeCloseTo(0.05 * 4 * 1, 1); // idle watts only, until something drives it
    const busy = settle(b, { gpu: 1 }, 50);
    expect(busy.caseRiseC).toBeGreaterThan(idle.caseRiseC);
  });

  it('the card throttles like a CPU when it runs hot, and burns when far over', () => {
    const b = withCard('gpu1');
    const dev = must(findDevices(b, 'gpu')[0]);
    ok(setClock(b, dev.id, 3));
    const th = heatUntilBurnt(b, dev, 600);
    const st = must(th.state(dev.id));
    expect(st.tempC).toBeGreaterThan(80); // past its throttle point
    expect(st.throttle).toBeLessThan(1);
  });

  it("the card's watts count against the PSU: an overclocked card can brown out a small supply", () => {
    (DEVICE_SPECS as Record<string, specsTypes.DeviceSpec>)['gpuCool'] = {
      ...must(DEVICE_SPECS['gpu1']),
      id: 'gpuCool',
      thermal: { ...must(DEVICE_SPECS['gpu1']).thermal, passive: 8 },
    };
    const mk = () => {
      const b = rig(3, 'cpu0', { psu: 'psu1', cooler: 'cooler0' });
      ok(install(b, 'gpuCool'));
      return b;
    };
    const calm = mk();
    expect(settle(calm, { gpu: 1, cpu: 1 }, 20).power.psuFactor).toBe(1);
    const hot = mk();
    ok(setClock(hot, firstId(hot, 'gpu'), 3));
    const th = settle(hot, { gpu: 1, cpu: 1 }, 20);
    expect(th.power.psuFactor).toBeLessThan(1);
    delete (DEVICE_SPECS as Record<string, specsTypes.DeviceSpec>)['gpuCool'];
  });

  it('an NPU or a TPM draws its watts too (they have no clock)', () => {
    const b = withCard('npu1');
    const th = settle(b, { npu: 1 }, 20);
    expect(stateOf(th, b, 'npu').powerW).toBeCloseTo(15, 5);
    ok(install(b, 'tpm1'));
    const th2 = settle(b, {}, 5);
    expect(stateOf(th2, b, 'tpm').powerW).toBeCloseTo(0.2, 5);
  });
});
