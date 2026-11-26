import { assert, describe, expect, it } from 'vitest';
import { advance, handleMessage, newHost } from '@/worker/host';
import type { FromSim, Snapshot } from '@/worker/protocol';
import { SANDBOX_MONEY } from '../../economy/sim/economy';
import { Game } from '@/worker/game/game';
import { JOB_DEX } from '../../jobs/sim/jobdex';
import { play } from '../../economy/sim/operator';
import { parseSave } from '@/worker/game/save';
import { econ } from '@/worker/game/testkit';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const sb = (o: { preassembled?: boolean; seed?: number } = {}) =>
  new Game({ seed: o.seed ?? 3, sandbox: true, preassembled: o.preassembled, economy: econ() });
const buy = (g: Game, id: string): string => {
  const r = g.purchase(id);
  if (!r.ok) {
    throw new Error(`${id}: ${r.reason}`);
  }
  return r.invId;
};

/** A purchase that costs nothing and can be made. */
const isFree = (p: { price: number; affordable: boolean }): boolean => p.price === 0 && p.affordable;
/** A fan in the case (not on a cooler or a card). */
const caseFan = (d: { spec: string; slot: string }): boolean => d.spec.startsWith('fan') && !d.slot.includes('.');

/** A save as the plain JSON data a file holds, before any parsing. */
const jsonData = (save: unknown): unknown => {
  const text = JSON.stringify(save);
  return JSON.parse(text);
};
/** JSON data that must be an object, to spread a changed field over. */
function asObject(v: unknown): object {
  if (typeof v !== 'object' || v === null) {
    throw new TypeError('expected a JSON object');
  }
  return v;
}

/** A sandbox game run for 300 ticks with a scan key: its snapshot as text. */
function sandboxRun(): string {
  const g = sb({ preassembled: true, seed: 9 });
  g.spawnKey('cli.scan', 2);
  g.powerButton();
  for (let i = 0; i < 300; i++) {
    g.advanceBaseTick();
  }
  return JSON.stringify(g.snapshot());
}

/** The snapshot among the host's replies. */
const snap = (r: FromSim[]): Snapshot => must(r.find((m) => m.type === 'snapshot')).snapshot;

const maxed = () => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true, economy: econ() });

/** The network is up (or busy). */
const linkUp = (g: Game): boolean => {
  const { state } = g.snapshot().net;
  return state === 'link-up' || state === 'saturated';
};
/** Ticks the game until the link is up, at most `max` base ticks. */
function tickUntilLinkUp(g: Game, max: number): void {
  for (let i = 0; i < max && !linkUp(g); i++) {
    g.advanceBaseTick();
  }
}

/** The classes of job that arrived over `ticks` (the queue is cleared every tick). */
const classArrivals = (g: Game, ticks: number): Set<string> => {
  const seen = new Set<string>();
  for (let i = 0; i < ticks; i++) {
    g.advanceBaseTick();
    for (const k of g.tray.waiting()) {
      seen.add(k.cls);
    } // not snapshot(): it prices every key, which runs the whole job once
    g.clearQueue();
  }
  return seen;
};
/** A powered sandbox at level 18 with a good reputation and the real arrival rate. */
const levelledSandbox = (): Game => {
  const g = new Game({ seed: 3, sandbox: true, preassembled: true, economy: { startQueue: [] } }); // the real arrival rate
  g.powerButton();
  g.setLevel(18);
  g.setReputation(4);
  return g;
};
/** The kinds of job that arrived over `ticks` (the queue is cleared every tick). */
const kindArrivals = (g: Game, ticks: number): Set<string> => {
  const seen = new Set<string>();
  for (let i = 0; i < ticks; i++) {
    g.advanceBaseTick();
    for (const k of g.tray.waiting()) {
      seen.add(k.type);
    } // not snapshot(): it prices every key, which runs the whole job once
    g.clearQueue();
  }
  return seen;
};

describe('sandbox start', () => {
  it('is flagged, rich, tutorial-free and powered off', () => {
    const g = sb({ preassembled: true });
    const s = g.snapshot();
    expect(s.sandbox).toBe(true);
    expect(s.money).toBe(SANDBOX_MONEY);
    expect(Object.values(s.progress).every(Boolean)).toBe(true);
    expect(s.powered).toBe(false);
    expect(s.devices.map((d) => d.kind).filter((k) => k !== 'fan')).toHaveLength(5);
    expect(s.devices.filter((d) => d.kind === 'fan').map((d) => d.slot)).toStrictEqual([
      'front0',
      'front1',
      'cooler0.fan0',
    ]);
    expect(g.powerButton().ok).toBe(true);
  });
  it('bare keeps the starter crate', () => {
    const s = sb().snapshot();
    expect(s.devices.map((d) => d.slot)).toStrictEqual(['front0', 'front1']); // only the case's two fans
    expect(s.inventory.map((i) => i.spec)).toStrictEqual(['cpu0', 'psu0', 'ram0', 'display0', 'cooler0', 'fan92']);
  });
  it('campaign is unchanged', () => {
    const g = new Game({ seed: 3, economy: econ() });
    const s = g.snapshot();
    expect(s.sandbox).toBe(false);
    expect(s.money).toBe(0);
    expect(Object.values(s.progress).some(Boolean)).toBe(false);
    expect('sandbox' in g.toSave()).toBe(false);
    expect(g.purchase('cpu1').ok).toBe(false);
    expect(g.purchase('board3').ok).toBe(false);
    expect(s.purchases.every((p) => p.price > 0)).toBe(true);
    expect(new Game({ seed: 3, preassembled: true }).powered).toBe(true);
  });
});

describe('sandbox purchases', () => {
  it('are free and money never changes', () => {
    const g = sb({ preassembled: true });
    for (const id of ['cooler2', 'ram2', 'vsink2', 'hdd0']) {
      buy(g, id);
    }
    expect(g.snapshot().money).toBe(SANDBOX_MONEY);
    expect(g.snapshot().purchases.every((p) => isFree(p))).toBe(true);
  });
  it('offer every spec and any board tier directly, with carry-over', () => {
    const g = sb({ preassembled: true });
    const ids = g.snapshot().purchases.map((p) => p.id);
    for (const id of [
      'cpu0',
      'cpu2',
      'ram0',
      'psu1',
      'cooler0',
      'vsink0',
      'board1',
      'board2',
      'board3',
      'hdd0',
      'ssd1',
      'nvme2',
      'os1',
    ]) {
      expect(ids).toContain(id);
    }
    expect(ids).toContain('os4');
    const before = g.board.devices.filter((d) => !caseFan(d)).map((d) => d.id);
    g.install(buy(g, 'board3'));
    expect(g.board.tier).toBe(3);
    expect(g.board.devices.map((d) => d.id)).toStrictEqual(before);
    expect(g.snapshot().inventory.filter((i) => i.spec === 'fan92')).toHaveLength(2); // the bigger case takes bigger fans: the Mini's come off
  });
  it('physics still refuses at the install, not at the till: PSU watts, missing slot, powered-on install', () => {
    const g = sb({ preassembled: true });
    const spare = (id: string) => {
      const foundInventory = g.snapshot().inventory.find((i) => i.id === id);
      assert.exists(foundInventory);
      return foundInventory;
    };
    const cpu = buy(g, 'cpu2'),
      nvme = buy(g, 'nvme2'),
      psu = buy(g, 'psu2');
    expect(spare(cpu).installable).toBe(false); // the 40 W PSU cannot feed it
    // the Starter board has no M.2
    const nvmeSpare = spare(nvme);
    expect(nvmeSpare.installable).toBe(false);
    expect(nvmeSpare.reason).toMatch(/m2/u);
    expect(spare(psu).installable).toBe(false); // needs the ATX+ connector
    g.install(buy(g, 'board3'));
    expect(spare(psu).installable).toBe(true); // the big board has it
    const inv = buy(g, 'cooler1');
    g.powerButton();
    expect(g.install(inv)).toMatchObject({ ok: false, reason: 'power the machine off first' });
    expect(g.purchase('board2').ok).toBe(true); // a smaller board is a spare, or a downgrade
  });
  it('an OS still needs a drive to install on', () => {
    const g = sb({ preassembled: true });
    const os = g.purchase('os1');
    assert(os.ok);
    assert.isNotEmpty(os.invId);
    const item = g.snapshot().inventory.find((i) => i.id === os.invId);
    assert.exists(item);
    expect(item.installable).toBe(false);
    expect(item.reason).toMatch(/storage drive/u);
  });
});

describe('sandbox tools', () => {
  it('spawnKey adds keys of every template, clearQueue empties the tray', () => {
    const g = sb();
    for (const t of ['cli', 'cli.log', 'cli.calc', 'cli.checksum', 'cli.scan']) {
      expect(g.spawnKey(t, 2).ok).toBe(true);
    }
    expect(g.trayKeyIds()).toHaveLength(6);
    expect(g.spawnKey('nope').ok).toBe(false);
    expect(g.spawnKey('cli', 99).ok).toBe(false);
    expect(g.spawnKey('constructor').ok).toBe(false);
    for (let i = 0; i < 4; i++) {
      g.spawnKey('cli');
    }
    expect(g.spawnKey('cli').ok).toBe(false);
    expect(g.clearQueue()).toMatchObject({ ok: true, removed: 10 });
    expect(g.trayKeyIds()).toHaveLength(0);
  });
  it('setReputation clamps and shows exactly', () => {
    const g = sb();
    for (let i = 0; i < 200; i++) {
      g.advanceBaseTick();
    }
    expect(g.setReputation(2).ok).toBe(true);
    expect(g.snapshot().reputation).toBeCloseTo(2, 6);
    g.setReputation(100);
    expect(g.snapshot().reputation).toBe(g.cfg.repMax);
    g.setReputation(-1);
    expect(g.snapshot().reputation).toBe(g.cfg.repMin);
    expect(g.setReputation(Number.NaN).ok).toBe(false);
  });
  it('are refused in a campaign game', () => {
    const g = new Game({ seed: 1, economy: econ() });
    for (const r of [g.spawnKey('cli'), g.clearQueue(), g.repairAll(), g.setReputation(2)]) {
      expect(r).toStrictEqual({ ok: false, reason: 'sandbox mode only' });
    }
    expect(g.trayKeyIds()).toHaveLength(1);
  });
  it('repairAll recovers a burnt part, a dead board and a tripped PSU', () => {
    const g = sb({ preassembled: true });
    g.powerButton();
    g.board.burnt = true;
    const cpu0Device = g.board.devices.find((d) => d.spec === 'cpu0');
    assert.exists(cpu0Device);
    cpu0Device.burnt = true;
    g.thermal.power = { ...g.thermal.power, tripped: true };
    g.thermal.vrm.tempC = 200;
    expect(g.snapshot().phase).toBe('error');
    expect(g.repairAll()).toMatchObject({ ok: true, repaired: 2, tripCleared: true });
    const s = g.snapshot();
    expect(s.board.burnt).toBe(false);
    expect(s.devices.every((d) => !d.burnt)).toBe(true);
    expect(s.power.tripped).toBe(false);
    expect(s.board.vrm.tempC).toBe(25);
    expect(s.phase).not.toBe('error');
  });
});

describe('sandbox save', () => {
  it('round-trips the flag, and campaign saves are untouched', () => {
    const g = sb({ preassembled: true });
    buy(g, 'board2');
    const save = jsonData(g.toSave());
    expect(save).toHaveProperty('sandbox', true);
    expect(save).toHaveProperty('version', 5);
    const g2 = Game.fromSave(parseSave(save), { baseDemandPerTick: 0 });
    expect(g2.sandbox).toBe(true);
    expect(g2.snapshot().money).toBe(SANDBOX_MONEY);
    expect(g2.purchase('cpu0').ok).toBe(true);
    expect(() => parseSave({ ...asObject(save), sandbox: 'yes' })).toThrow(/sandbox/u);
    const c = new Game({ seed: 1 });
    const campaign = jsonData(c.toSave());
    expect(Game.fromSave(campaign).sandbox).toBe(false);
  });
  it('keeps the pinned level and the classes and kinds switched off, so one workload can be tested again and again', () => {
    const g = sb({ preassembled: true });
    g.setLevel(14);
    g.setJobClasses(['cli', 'web']);
    g.setJobKinds(['fib', 'mandel']);
    const save = asObject(jsonData(g.toSave()));
    expect(save).toMatchObject({ sandboxLevel: 14, sandboxOff: ['cli', 'web'], sandboxKindsOff: ['fib', 'mandel'] });
    const g2 = Game.fromSave(parseSave(save), { baseDemandPerTick: 0 });
    const s = g2.snapshot().level;
    expect(s).toMatchObject({ level: 14, sandbox: true });
    expect([...s.classesOff].toSorted()).toStrictEqual(['cli', 'web']);
    expect([...s.kindsOff].toSorted()).toStrictEqual(['fib', 'mandel']);
    // a game that changed nothing writes the level only, and an id that no longer exists is dropped
    const plain = jsonData(sb({ preassembled: true }).toSave());
    expect(plain).toHaveProperty('sandboxLevel', 8);
    expect(plain).not.toHaveProperty('sandboxOff');
    expect(plain).not.toHaveProperty('sandboxKindsOff');
    const old = Game.fromSave(parseSave({ ...save, sandboxOff: ['cli', 'gone'], sandboxKindsOff: ['gone'] }), {
      baseDemandPerTick: 0,
    });
    expect(old.snapshot().level.classesOff).toStrictEqual(['cli']);
    expect(old.snapshot().level.kindsOff).toStrictEqual([]);
    expect(() => parseSave({ ...save, sandboxLevel: 99 })).toThrow(/sandboxLevel/u);
    expect(() => parseSave({ ...save, sandboxOff: 'cli' })).toThrow(/sandboxOff/u);
    // a campaign game ignores them
    const c = new Game({ seed: 1 }),
      cs = asObject(jsonData(c.toSave()));
    expect(cs).not.toHaveProperty('sandboxLevel');
    expect(Game.fromSave(parseSave({ ...cs, sandboxLevel: 14, sandboxOff: ['cli'] })).snapshot().level).toMatchObject({
      sandbox: false,
      classesOff: [],
    });
  });
  it('is deterministic', () => {
    expect(sandboxRun()).toBe(sandboxRun());
  });
});

describe('sandbox host', () => {
  it('starts a sandbox, runs the tools, allows 64x only there', () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1, sandbox: true, preassembled: true });
    assert.exists(h.game);
    expect(h.game.sandbox).toBe(true);
    expect(snap(handleMessage(h, { type: 'spawnKey', template: 'cli.calc', scale: 3 })).tray).toHaveLength(2);
    expect(snap(handleMessage(h, { type: 'clearQueue' })).tray).toHaveLength(0);
    expect(handleMessage(h, { type: 'repairAll' }).map((m) => m.type)).toStrictEqual(['snapshot']);
    expect(snap(handleMessage(h, { type: 'setReputation', value: 3 })).reputation).toBeCloseTo(3, 6);
    handleMessage(h, { type: 'setSpeed', speed: 64 });
    expect(advance(h, 1000)).toBe(64);
    const c = newHost();
    handleMessage(c, { type: 'init', seed: 1 });
    const [firstHandleMessage] = handleMessage(c, { type: 'setSpeed', speed: 64 });
    assert.exists(firstHandleMessage);
    expect(firstHandleMessage.type).toBe('error');
    expect(c.speed).toBe(1);
    expect(handleMessage(c, { type: 'spawnKey', template: 'cli' }).map((m) => m.type)).toStrictEqual([
      'error',
      'snapshot',
    ]);
  });
});

describe('sandbox high-end build', () => {
  it('builds the best machine in a few actions and runs jobs', () => {
    const g = new Game({ seed: 5, sandbox: true });
    for (const id of ['board3', 'psu2', 'cpu2', 'ram2', 'cooler2', 'vsink2', 'nvme2', 'os1']) {
      buy(g, id);
    }
    const op = play(g, 1, 0);
    op.assemble(false);
    expect(g.hasOs()).toBe(true);
    expect(g.board.tier).toBe(3);
    expect(g.missingCables()).toStrictEqual([]);
    g.powerButton();
    for (let i = 0; i < 4; i++) {
      g.spawnKey('cli');
    }
    play(g, 4000, 0);
    expect(g.completed).toBeGreaterThan(5);
    expect(g.snapshot().board.burnt).toBe(false);
  }, 20_000); // a long run: the default 5 s timed out when the whole suite ran in parallel
});

describe('sandbox maxed machine', () => {
  it('is the biggest case and board with the best part of every kind, every DIMM and M.2 slot filled, a router, a plan and the ethernet cable', () => {
    const g = maxed(),
      s = g.snapshot();
    expect(g.board.tier).toBe(3);
    expect(g.board.caseTier).toBe(3);
    const specs = s.devices.map((d) => d.spec).toSorted();
    expect(specs.filter((x) => x === 'cpu4w')).toHaveLength(1);
    expect(specs.filter((x) => x === 'ram5')).toHaveLength(8);
    expect(specs.filter((x) => x === 'nvme2')).toHaveLength(3);
    for (const id of ['psu4', 'cooler2', 'vsink2', 'rsink2', 'nic3', 'display0']) {
      expect(specs).toContain(id);
    }
    expect(specs).not.toContain('cpu0');
    expect(specs).not.toContain('psu0');
    expect(specs).not.toContain('cooler0');
    expect(specs).not.toContain('ram0');
    assert.exists(s.os);
    assert.exists(s.net.router);
    expect(s.cables.every((c) => c.connected)).toBe(true);
    expect(s.powered).toBe(false);
    expect(s.log).toHaveLength(0); // the build is not in the log
  });
  it('powers on, boots, and the link comes up', () => {
    const g = maxed();
    expect(g.powerButton().ok).toBe(true);
    tickUntilLinkUp(g, 4000);
    const s = g.snapshot();
    expect(['link-up', 'saturated']).toContain(s.net.state);
    expect(s.power.tripped).toBe(false);
    expect(s.phase).not.toBe('error');
    for (let i = 0; i < 1500; i++) {
      g.advanceBaseTick();
    } // and it stays up: the 250 W supply and the liquid loop carry it
    expect(g.snapshot().power.tripped).toBe(false);
    expect(g.snapshot().phase).not.toBe('error');
  }, 120_000);
  it('does not change the plain assembled sandbox machine', () => {
    expect(sb({ preassembled: true }).snapshot().devices).toHaveLength(8); // five parts and three fans
  });
});

describe('sandbox: which job classes arrive on their own', () => {
  const arrivals = classArrivals;
  const start = levelledSandbox;
  it('turns classes off and back on, and shows the choice in the snapshot', () => {
    const g = start();
    expect(g.snapshot().level.classesOff).toStrictEqual([]);
    expect(g.setJobClasses(['gpu', 'npu'])).toStrictEqual({ ok: true, off: ['gpu', 'npu'] });
    expect(g.snapshot().level.classesOff).toStrictEqual(['gpu', 'npu']);
    expect(g.setJobClasses([]).ok).toBe(true);
    expect(g.snapshot().level.classesOff).toStrictEqual([]);
  });
  it('stops an off class arriving while the others still do', () => {
    const g = start();
    g.setJobClasses(['cli', 'scan', 'db', 'web', 'secure', 'npu', 'hpc']);
    const seen = arrivals(g, 6000);
    expect(seen.has('gpu')).toBe(true);
    expect([...seen].filter((c) => c !== 'gpu')).toStrictEqual([]);
  });
  it('brings nothing when every class is off, but spawnKey still works', () => {
    const g = start();
    g.setJobClasses(['cli', 'scan', 'db', 'web', 'secure', 'gpu', 'npu', 'hpc']);
    expect(arrivals(g, 3000).size).toBe(0);
    expect(g.spawnKey('gpu').ok).toBe(true);
  });
  it('refuses unknown classes, and a campaign game', () => {
    expect(start().setJobClasses(['nope']).ok).toBe(false);
    expect(new Game({ seed: 1, economy: econ() }).setJobClasses([])).toStrictEqual({
      ok: false,
      reason: 'sandbox mode only',
    });
  });

  const kinds = kindArrivals;
  it('turns single kinds of job off and shows the choice in the snapshot', () => {
    const g = start();
    expect(g.snapshot().level.kindsOff).toStrictEqual([]);
    expect(g.setJobKinds(['fib', 'mandel'])).toStrictEqual({ ok: true, off: ['fib', 'mandel'] });
    expect(g.snapshot().level.kindsOff).toStrictEqual(['fib', 'mandel']);
    expect(g.setJobKinds([]).ok).toBe(true);
    expect(g.snapshot().level.kindsOff).toStrictEqual([]);
  });
  it('stops an off kind arriving while its siblings still do', () => {
    const g = start();
    const before = kinds(g, 3000);
    expect(before.has('fib')).toBe(true);
    const off = start();
    off.setJobKinds(['fib', 'log', 'calc', 'checksum']);
    const seen = kinds(off, 3000);
    expect(seen.has('fib')).toBe(false);
    expect(['log', 'calc', 'checksum'].some((k) => seen.has(k))).toBe(false);
    expect(seen.size).toBeGreaterThan(3);
  });
  it('a class with every kind off sends nothing, and spawnKey still works', () => {
    const g = start();
    g.setJobClasses(['cli', 'scan', 'db', 'web', 'secure', 'npu', 'hpc']); // only gpu is left at level 18...
    g.setJobKinds(JOB_DEX.filter((e) => e.cls === 'gpu').map((e) => e.id));
    expect(kinds(g, 3000).size).toBe(0);
    expect(g.spawnKey('gpu').ok).toBe(true);
  });
  it('switching a kind or class off also removes its waiting keys', () => {
    const g = start();
    g.spawnKey('cli');
    g.spawnKey('gpu');
    g.setJobKinds(['log', 'calc', 'checksum']);
    expect(g.snapshot().tray.some((k) => k.cls === 'cli')).toBe(false);
    expect(g.snapshot().tray.some((k) => k.cls === 'gpu')).toBe(true);
    g.setJobClasses(['gpu']);
    expect(g.snapshot().tray).toHaveLength(0);
  });
  it('refuses unknown kinds, and a campaign game', () => {
    expect(start().setJobKinds(['nope']).ok).toBe(false);
    expect(new Game({ seed: 1, economy: econ() }).setJobKinds([])).toStrictEqual({
      ok: false,
      reason: 'sandbox mode only',
    });
  });
});
