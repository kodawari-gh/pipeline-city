import { describe, expect, it } from 'vitest';
import {
  clockZones,
  compareRows,
  estTempC,
  goodness,
  ladderFor,
  osSection,
  pickerFor,
  specBrief,
  statsOf,
  zoneOf,
} from './picker';
import { getSpec } from '@/features/board/sim/specs';
import { dev, key, PURCHASES, snap, STARTER_CRATE } from '@/core/ui/testdata';
import type { KeySnap, OsJobSnap, OsSnap, Snapshot, StorageSnap } from '@/worker/game/game';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

type AnySpec = NonNullable<ReturnType<typeof getSpec>>;

/** The spec of `id`, or fails the test when there is none. */
const spec = (id: string): AnySpec => must(getSpec(id));

/** The CPU spec `id`, or fails the test when it is something else. */
function cpuSpecOf(id: string): Extract<AnySpec, { kind: 'cpu' }> {
  const s = spec(id);
  if (s.kind !== 'cpu') {
    throw new Error(`${id} is a ${s.kind}, not a cpu`);
  }
  return s;
}

/** The cooler spec `id`, or fails the test when it is something else. */
function coolerSpecOf(id: string): Extract<AnySpec, { kind: 'cooler' }> {
  const s = spec(id);
  if (s.kind !== 'cooler') {
    throw new Error(`${id} is a ${s.kind}, not a cooler`);
  }
  return s;
}

/** The picker for `id`, or fails the test when there is none. */
const picker = (id: string, s: Snapshot) => must(pickerFor(id, s));

/** The text of the picker's lines marked bad. */
const badLines = (m: { lines: { level?: string; text: string }[] }): string[] =>
  m.lines.filter((l) => l.level === 'bad').map((l) => l.text);

const cpuSpec = cpuSpecOf('cpu0');
const stockCooler = coolerSpecOf('cooler0');

describe('picker contents per id', () => {
  it('returns nothing without a selection or an unknown id', () => {
    expect(pickerFor(null, snap())).toBeNull();
    expect(pickerFor('cpu0', null)).toBeNull();
    expect(pickerFor('no-such-thing', snap())).toBeNull();
  });

  it('empty CPU socket: the crate part as a spare, then the upgrades with poor and blocked reasons', () => {
    const m = picker('cpu0', snap());
    expect(m.kind).toBe('cpu');
    expect(m.title).toBe('Processor socket');
    expect(m.plain).toMatch(/empty processor socket/u);
    expect(m.lines).toStrictEqual([]);
    expect(m.device).toBeUndefined();
    expect(m.clock).toBe(false);
    expect(m.current).toBeNull();
    expect(m.ladder.map((r) => [r.specId, r.state]).slice(0, 3)).toStrictEqual([
      ['cpu0', 'crate'],
      ['cpu1', 'poor'],
      ['cpu2', 'blocked'],
    ]);
    expect(m.ladder[1]).toMatchObject({ price: 200, reason: 'Need $200 more' });
    expect(must(m.ladder[2]).reason).toBe('needs a 100 W power supply');
  });

  it('sandbox: nothing is unaffordable and prices read free', () => {
    const m = picker('cpu0', snap({ sandbox: true, money: 0 }));
    expect(m.ladder.find((r) => r.specId === 'cpu1')).toMatchObject({ state: 'ready', free: true, reason: undefined });
    const c = picker('cpu0', snap({ money: 0 }));
    expect(c.ladder.find((r) => r.specId === 'cpu1')).toMatchObject({ state: 'poor' });
    expect(must(c.ladder.find((r) => r.specId === 'cpu1')).free).toBeUndefined();
  });

  it('installed CPU: live device, clock control, the ladder starts at the fitted part', () => {
    const s = snap({
      devices: [dev({ id: 'dev1', spec: 'cpu0', kind: 'cpu', slot: 'cpu0' })],
      slots: [{ id: 'cpu0', type: 'cpu', deviceId: 'dev1' }],
      cpuClock: { value: 1, min: 0.25, max: 1.5 },
      inventory: [],
    });
    const m = picker('cpu0', s);
    expect(m.device?.id).toBe('dev1');
    expect(m.clock).toBe(true);
    expect(m.current).toBe('cpu0');
    expect(m.ladder[0]).toMatchObject({ specId: 'cpu0', state: 'installed', devId: 'dev1' });
    expect(m.ladder.find((r) => r.specId === 'cpu1')).toMatchObject({ state: 'poor' });
    expect(m.ladder.find((r) => r.specId === 'ram1')).toBeUndefined();
    expect(m.lines).toStrictEqual([]);

    const overclocked = snap({
      devices: [dev({ id: 'dev1', tempC: 88, unstable: true })],
      cpuClock: { value: 1.5, min: 0.25, max: 1.5 },
    });
    const hot = must(pickerFor('dev1', overclocked));
    expect(badLines(hot).some((text) => text.includes('Unstable'))).toBe(true);
  });

  it('a fitted part offers Remove (by its slot, its device id or its world id); an empty socket and a spare do not', () => {
    const s = snap({
      devices: [dev({ id: 'dev9', spec: 'display0', kind: 'display', slot: 'display0', name: 'CLI monitor' })],
      slots: [
        { id: 'display0', type: 'display', deviceId: 'dev9' },
        { id: 'cpu0', type: 'cpu', deviceId: null },
      ],
      powered: false,
      phase: 'off',
    });
    for (const id of ['display0', 'dev9', 'monitor']) {
      expect(picker(id, s).actions).toStrictEqual([
        expect.objectContaining({ id: 'uninstall', deviceId: 'dev9', label: 'Remove CLI monitor' }),
      ]);
      const [first] = picker(id, s).actions;
      expect(must(first).why).toBeUndefined();
    }
    expect(picker('cpu0', s).actions).toStrictEqual([]);
    expect(picker('inv:inv3', s).actions).toStrictEqual([]);
    const [onFirst] = picker('dev9', { ...s, powered: true }).actions;
    expect(must(onFirst).why).toMatch(/Power the machine off/u);
    const burnt = snap({
      devices: [
        dev({ id: 'dev9', spec: 'display0', kind: 'display', slot: 'display0', name: 'CLI monitor', burnt: true }),
      ],
      slots: s.slots,
    });
    const [scrap] = picker('dev9', burnt).actions;
    expect(must(scrap).label).toBe('Scrap CLI monitor');
  });

  it('a spec id that is not installed shows the spec, and is the default comparison', () => {
    const s = snap({ devices: [dev({ id: 'dev1', spec: 'cpu0', kind: 'cpu' })] });
    const m = picker('cpu1', s);
    expect(m.kind).toBe('cpu');
    expect(m.device).toBeUndefined();
    expect(m.title).toBe(must(getSpec('cpu1')).name);
    expect(m.focus).toBe('cpu1');
  });

  it('inventory item (inv:): the part of its kind, its ladder, and the item as the comparison', () => {
    const m = picker('inv:inv3', snap());
    expect(m.kind).toBe('ram');
    expect(m.focus).toBe('ram0');
    expect(m.ladder.find((r) => r.specId === 'ram0')).toMatchObject({ state: 'crate', invId: 'inv3' });
    expect(m.ladder.find((r) => r.specId === 'ram1')).toMatchObject({ state: 'ready', price: 100 });
  });

  it('the crate is gone: its old id describes the inventory, not a card of its own', () => {
    const m = picker('crate', snap());
    expect(m.kind).toBe('info');
    expect(m.title).toBe('Inventory');
  });

  it('key in the tray: job details and a plug action', () => {
    const k = key({
      id: 7,
      label: '#80 calc',
      type: 'calc',
      age: 40,
      deadlineTick: 100,
      arrivalTick: 60,
      payoutEstimate: 75,
    });
    const m = picker('key:7', snap({ tray: [k], baseTick: 90 }));
    expect(m.kind).toBe('key');
    expect(m.title).toBe('Client key #80 calc');
    expect(m.lines.map((l) => l.text).join(' ')).toMatch(/Due in 10s/u);
    expect(m.lines.map((l) => l.text).join(' ')).toMatch(/Pays about \$75/u);
    expect(m.actions.map((a) => a.id)).toStrictEqual(['plug']);
    expect(must(m.actions[0]).keyId).toBe(7);
  });

  it('late key explains the late penalty', () => {
    const late = snap({ tray: [key({ late: true })], baseTick: 200 });
    const m = picker('key:1', late);
    expect(badLines(m).some((text) => text.includes('Late by'))).toBe(true);
  });

  it('finished key in the port: remove action, result shown', () => {
    const k = key({ id: 3, done: true, result: '#72 mul=31 OK' });
    const m = picker('key:3', snap({ plugged: k }));
    expect(m.actions).toStrictEqual([
      expect.objectContaining({ id: 'eject', label: 'Remove key (get paid)', primary: true }),
    ]);
    expect(m.lines.some((l) => l.text.includes('#72 mul=31 OK'))).toBe(true);
  });

  it('a second key while one is plugged: plug is refused with a reason', () => {
    const second = snap({ tray: [key({ id: 2 })], plugged: key({ id: 1 }) });
    const m = picker('key:2', second);
    expect(m.actions[0]).toMatchObject({ id: 'plug', why: 'A key is already plugged in' });
  });

  it('tray: how many keys are waiting out of the cap', () => {
    const two = snap({ tray: [key({ id: 1 }), key({ id: 2 })] });
    const m = picker('tray', two);
    expect(must(m.lines[0]).text).toBe('2 of 8 keys waiting. A full tray turns clients away.');
  });

  it('power button on a machine that cannot start: refused with the sim reason', () => {
    const m = picker('power', snap());
    expect(m.actions[0]).toMatchObject({ id: 'power', label: 'Power on' });
    expect(must(m.actions[0]).why).toMatch(/power supply/u);
    expect(m.lines.some((l) => l.text.includes('power supply'))).toBe(true);
  });

  it('power button after a PSU trip: power cycle comes first', () => {
    const s = snap({
      power: { vrmLossW: 0, totalW: 90, budgetW: 40, psuFactor: 0, off: false, tripped: true },
      powered: true,
      phase: 'error',
      phaseReason: 'power supply tripped',
    });
    const m = picker('power', s);
    expect(m.actions.map((a) => a.id)).toStrictEqual(['powerCycle', 'power']);
    expect(must(m.lines[0]).level).toBe('bad');
  });

  it('PSU: power readout, a ladder with the next supply, and a power cycle after a trip', () => {
    const s = snap({
      devices: [dev({ id: 'dev2', spec: 'psu0', kind: 'psu', name: 'PSU 40 W', slot: 'atx0' })],
      slots: [{ id: 'atx0', type: 'atx', deviceId: 'dev2' }],
      power: { vrmLossW: 0, totalW: 95, budgetW: 40, psuFactor: 0.4, off: false, tripped: true },
      money: 100,
    });
    const m = picker('psu', s);
    expect(m.kind).toBe('psu');
    expect(badLines(m).some((text) => text.includes('95 W of 40 W'))).toBe(true);
    expect(m.ladder.map((r) => [r.specId, r.state])).toStrictEqual([
      ['psu0', 'installed'],
      ['psu1', 'ready'],
      ['psu2', 'level'],
      ['psu3', 'level'],
      ['psu4', 'level'],
    ]);
    expect(must(m.actions[0]).id).toBe('powerCycle');
  });

  it('USB port: free port with nothing waiting, or the plugged key', () => {
    const [free] = picker('usb', snap()).lines;
    expect(must(free).text).toMatch(/No keys waiting/u);
    const done = snap({ plugged: key({ id: 5, done: true, label: '#90 log' }) });
    const m = picker('usb', done);
    expect(must(m.lines[0]).text).toMatch(/finished, ready to hand back/u);
    expect(m.actions[0]).toMatchObject({ id: 'eject', keyId: 5 });
  });

  it('cable: unplugged shows the blocked reason', () => {
    const m = picker('cable.atx', snap());
    expect(m.kind).toBe('info');
    expect(m.lines[0]).toMatchObject({ level: 'warn', text: 'the power supply is not installed' });
  });

  it('region ids give an info card', () => {
    for (const id of ['vrm', 'vrm2', 'atx', 'cpw']) {
      const m = pickerFor(id, snap());
      expect(m, `for ${id}`).not.toBeNull();
      expect(must(m).kind).toBe('info');
      expect(must(m).plain.length, `for ${id}`).toBeGreaterThan(10);
    }
  });

  it('monitor: explanation, and no upgrades to buy yet when only the starter monitor is installed (the graphics display waits for its level)', () => {
    const starter = snap({ devices: [dev({ id: 'dev3', spec: 'display0', kind: 'display', name: 'CLI monitor' })] });
    const m = picker('monitor', starter);
    expect(m.kind).toBe('display');
    expect(m.ladder.map((r) => r.state)).toStrictEqual(['installed', 'level']);
    expect(m.emptyText).toBeUndefined(); // the locked graphics display is the next upgrade
  });

  it('board: the ladder offers the next motherboard tier, with its price', () => {
    const s = snap({
      purchases: [...PURCHASES, { id: 'board1', name: 'ATX+ board', kind: 'board', price: 300, affordable: false }],
    });
    const m = picker('board', s);
    expect(m.kind).toBe('board');
    expect(m.ladder.map((r) => [r.specId, r.state])).toStrictEqual([
      ['board0', 'installed'],
      ['board1', 'poor'],
      ['board2', 'level'],
      ['board3', 'level'],
    ]);
  });
});

describe('upgrade ladder', () => {
  it('lists every tier, the lower ones too: nothing is outgrown', () => {
    const s = snap({ devices: [dev({ id: 'dev1', spec: 'cpu1', kind: 'cpu' })], inventory: [] });
    const lad = ladderFor(s, 'cpu');
    expect(lad.map((r) => r.specId)).toStrictEqual([
      'cpu0',
      'cpu1',
      'cpu2',
      'cpu3',
      'cpu2d',
      'cpu2f',
      'cpu2m',
      'cpu3t',
      'cpu4',
      'cpu3f',
      'cpu3m',
      'cpu5s',
      'cpu5h',
      'cpu4f',
      'cpu4m',
      'cpu4w',
    ]);
    expect(must(lad.find((r) => r.specId === 'cpu1')).state).toBe('installed');
  });

  it('a part you own offers another copy: the tile keeps its buy-another price, and counts the spares', () => {
    const s = snap({
      devices: [dev({ id: 'dev1', spec: 'cpu1', kind: 'cpu' })],
      inventory: [
        { ...must(STARTER_CRATE[0]), id: 'inv8', spec: 'cpu1', kind: 'cpu', name: must(getSpec('cpu1')).name },
        { ...must(STARTER_CRATE[0]), id: 'inv9', spec: 'cpu2', kind: 'cpu', name: must(getSpec('cpu2')).name },
      ],
      purchases: [
        { id: 'cpu1', name: 'x', kind: 'cpu', price: 60, affordable: true },
        { id: 'cpu2', name: 'y', kind: 'cpu', price: 120, affordable: false },
      ],
      money: 10,
    });
    const lad = ladderFor(s, 'cpu');
    expect(lad.find((r) => r.specId === 'cpu1')).toMatchObject({
      state: 'installed',
      spares: 1,
      more: { state: 'ready', price: 60 },
    });
    expect(lad.find((r) => r.specId === 'cpu2')).toMatchObject({
      state: 'crate',
      spares: 1,
      more: { state: 'poor', price: 120 },
    });
  });

  it('a spare part of a newer tier is a crate rung', () => {
    const s = snap({
      inventory: [{ ...must(STARTER_CRATE[0]), id: 'inv9', spec: 'cpu1', name: must(getSpec('cpu1')).name }],
    });
    expect(ladderFor(s, 'cpu').find((r) => r.specId === 'cpu1')).toMatchObject({ state: 'crate', invId: 'inv9' });
  });
});

describe('part stats and before/after', () => {
  it('summarises each part with numbers the bars can use', () => {
    expect(statsOf('ram0').map((x) => [x.key, x.value])).toStrictEqual([
      ['size', 16],
      ['latency', 200],
      ['banks', 2],
      ['lanes', 1],
      ['power', 2],
    ]);
    expect(statsOf('psu1')).toStrictEqual([
      expect.objectContaining({ key: 'watts', value: 100, higherIsBetter: true }),
    ]);
    expect(must(statsOf('cpu2')[0]).value).toBeGreaterThan(must(statsOf('cpu1')[0]).value);
    expect(statsOf('nope')).toStrictEqual([]);
  });

  it('bar length is 1 for the best part of its kind, lower-is-better inverts', () => {
    const [speed] = statsOf('cpu4w');
    expect(goodness('cpu', { key: 'speed', value: must(speed).value, higherIsBetter: true })).toBe(1);
    expect(goodness('ram', { key: 'latency', value: 4, higherIsBetter: false })).toBe(1);
    expect(goodness('ram', { key: 'latency', value: 200, higherIsBetter: false })).toBeCloseTo(0.02, 5);
  });

  it('compares the option with the current part: better, worse, same, with the delta', () => {
    const rows = compareRows('ram', 'ram0', 'ram1');
    expect(rows.find((r) => r.key === 'size')).toMatchObject({
      trend: 'better',
      deltaText: '+16 K',
      curText: '16 K',
      optText: '32 K',
    });
    expect(rows.find((r) => r.key === 'latency')).toMatchObject({ trend: 'better', deltaText: '-188 ticks' });
    const back = compareRows('ram', 'ram1', 'ram0');
    expect(must(back.find((r) => r.key === 'size')).trend).toBe('worse');
    expect(compareRows('cpu', 'cpu0', 'cpu0').every((r) => r.trend === 'same')).toBe(true);
  });

  it('with no current part there is no delta', () => {
    const rows = compareRows('cpu', null, 'cpu1');
    expect(rows.map((r) => [r.cur, r.trend, r.deltaText])).toStrictEqual(rows.map(() => [null, null, null]));
  });

  it('describes each kind of part in a line', () => {
    expect(specBrief(spec('cpu2'))).toBe('5-stage, forwarding, 3x base clock (max 5x)');
    expect(specBrief(spec('ram1'))).toBe('DDR2 32K, 4 banks, latency 12');
    expect(specBrief(spec('psu2'))).toBe('250 W, needs ATX+ board');
    expect(specBrief(spec('cooler1'))).toBe('0.8 W/C cooling');
  });
});

describe('overclock zones (the same steady-state heat model as thermal.ts)', () => {
  it('the stock CPU with the stock heatsink: steady temperature and where the zones start', () => {
    // 10 W at base clock, 0.15 + 0.35 W/C to the case: 25 + 10 / 0.5 = 45 C at stock.
    expect(estTempC(cpuSpec, stockCooler, 1)).toBeCloseTo(45, 6);
    const z = clockZones(cpuSpec, stockCooler);
    expect(z.throttleAt).toBeCloseTo(Math.cbrt((45 * 0.5) / 10), 6); // about 1.31x: 70 C
    expect(z.unstableAt).toBeCloseTo(Math.cbrt((60 * 0.5) / 10), 6); // about 1.44x: 85 C
    expect(zoneOf(z, 1)).toBe('safe');
    expect(zoneOf(z, 1.4)).toBe('throttle');
    expect(zoneOf(z, 1.5)).toBe('unstable');
  });

  it('a bigger cooler moves the zones up', () => {
    const big = coolerSpecOf('cooler2');
    expect(clockZones(cpuSpec, big).unstableAt).toBeGreaterThan(clockZones(cpuSpec, stockCooler).unstableAt);
  });
});

const job = (o: Partial<OsJobSnap>): OsJobSnap => ({
  slot: 0,
  keyId: 1,
  label: '#1 log',
  state: 'queued',
  persisted: true,
  ahead: 0,
  ...o,
});

const osOn = (queue: OsJobSnap[] = [], o: Partial<OsSnap> = {}): OsSnap => ({
  spec: 'os1',
  tier: 1,
  name: 'Resident OS 1.0',
  deviceId: 'dev-hdd',
  slot: 'sata0',
  programSlots: 1,
  queueSlots: 4,
  up: true,
  queue,
  runningKeyId: null,
  spool: { slotBytes: 4096, slots: 4, used: 0, freeBytes: 0, full: false },
  ...o,
});

describe('the OS section (the OS badge and the drive that hosts it)', () => {
  const hdd: StorageSnap = {
    deviceId: 'dev-hdd',
    slot: 'sata0',
    spec: 'hdd0',
    name: 'HDD 96K',
    burnt: false,
    capacityBytes: 96 * 1024,
    usedBytes: 12 * 1024,
    bytesRead: 0,
    bytesWritten: 0,
    busy: false,
    latencyTicks: 720,
    blockTicks: 72,
    bytesPerSecond: 3600,
    hasOs: true,
    fs: { runs: [], fragmentation: 0, byKind: { os: 0, spool: 0, program: 0, dataset: 0, meta: 0 }, files: [] },
    wear: [],
    headLba: 0,
    cmds: [],
    wearPct: 0,
    badGroups: 0,
    lostBlocks: 0,
    queueDepth: 2,
    queued: 0,
    mirror: false,
    mount: { state: 'clean', phase: 'mounted', progress: 1 },
    format: { why: 'this drive holds the OS', datasets: 0 },
  };
  const withOs = (queue: OsJobSnap[] = [], extra: Parameters<typeof snap>[0] = {}) =>
    snap({
      storage: [hdd],
      devices: [dev({ id: 'dev-hdd', spec: 'hdd0', kind: 'storage', slot: 'sata0', name: 'HDD 96K' })],
      os: osOn(queue),
      powered: true,
      phase: 'running-os',
      purchases: [
        ...PURCHASES,
        {
          id: 'os2',
          name: 'Cooperative OS',
          kind: 'os',
          price: 600,
          affordable: false,
          later: true,
          blocked: 'planned: not available yet',
          description: 'Cooperative multitasking: several programs resident at once. Planned.',
        },
      ],
      ...extra,
    });

  it('is null without an OS', () => {
    expect(osSection(snap())).toBeNull();
  });

  it('gives the OS name, tier, status, slot counts and host drive space', () => {
    const sec = must(osSection(withOs()));
    expect(sec.name).toBe('Resident OS 1.0');
    expect(sec.tier).toBe(1);
    expect(sec.status).toBe('Running job');
    expect(sec.programSlots).toBe(1);
    expect(sec.queueSlots).toBe(4);
    expect(sec.host).toStrictEqual({ slot: 'sata0', usedK: 12, capK: 96 });
  });

  it('lists queue rows with the job type and how many are ahead; the running job is named', () => {
    const keys: KeySnap[] = [key({ id: 7, label: '#7 scan', type: 'scan', stage: 'queued' })];
    const s = withOs(
      [
        job({ keyId: 5, label: '#5 log', state: 'running', ahead: 0 }),
        job({ keyId: 7, label: '#7 scan', state: 'queued', ahead: 1, slot: 1 }),
        job({ keyId: 9, label: '#9 calc', state: 'queued', ahead: 2, slot: 2 }),
      ],
      { tray: keys },
    );
    const sec = must(osSection(s));
    expect(sec.running).toBe('#5 log');
    expect(sec.queue.map((q) => [q.label, q.text])).toStrictEqual([
      ['#5 log', 'running now'],
      ['#7 scan', '1 ahead'],
      ['#9 calc', '2 ahead'],
    ]);
    expect(must(sec.queue[1]).type).toBe('scan');
    expect(sec.queue).toHaveLength(3);
  });

  it('a finished result waits in the queue as done', () => {
    const s = withOs([job({ keyId: 3, label: '#3 log', state: 'result', ahead: -1 })], {
      tray: [key({ id: 3, label: '#3 log', stage: 'result' })],
    });
    const section = must(osSection(s));
    expect(must(section.queue[0]).text).toBe('done');
  });

  it('the ladder offers the later tiers locked, with their description', () => {
    const sec = must(osSection(withOs()));
    const later = sec.ladder.filter((r) => r.state === 'level');
    expect(later.map((r) => r.specId)).toStrictEqual(['os2', 'os3', 'os4']);
    expect(must(later[0]).reason).toMatch(/Level 8/u);
  });

  it('the drive that hosts the OS shows the section; another drive does not', () => {
    const host = picker('dev-hdd', withOs());
    expect(host.osSection?.name).toBe('Resident OS 1.0');
    expect(host.actions.map((a) => a.id)).toContain('uninstallOs');

    const other: StorageSnap = { ...hdd, deviceId: 'dev-ssd', slot: 'sata1', spec: 'ssd1', hasOs: false };
    const s2 = snap({
      storage: [hdd, other],
      devices: [
        dev({ id: 'dev-hdd', spec: 'hdd0', kind: 'storage', slot: 'sata0' }),
        dev({ id: 'dev-ssd', spec: 'ssd1', kind: 'storage', slot: 'sata1' }),
      ],
      os: osOn(),
      powered: false,
      phase: 'off',
    });
    expect([null, undefined]).toContain(picker('dev-ssd', s2).osSection);
    expect(picker('dev-ssd', s2).actions.map((a) => a.id)).not.toContain('uninstallOs');
  });

  it('the os badge opens the OS section with uninstall, and the ladder sits inside the section', () => {
    const on = picker('os', withOs());
    expect(on.kind).toBe('os');
    expect(on.osSection?.name).toBe('Resident OS 1.0');
    expect(on.actions.map((a) => a.id)).toStrictEqual(['uninstallOs']);
    expect(on.ladder).toStrictEqual([]);
    expect(on.title).toBe('Resident OS 1.0');
  });

  it('uninstall is refused while the machine is on (the reason is the disabled tooltip)', () => {
    const [first] = picker('os', withOs()).actions;
    const a = must(first);
    expect(a.why).toMatch(/Power the machine off/u);
  });

  it('the drive that hosts the OS cannot be removed until the OS is', () => {
    const a = must(
      picker('dev-hdd', withOs([], { powered: false, phase: 'off' })).actions.find((x) => x.id === 'uninstall'),
    );
    expect(a.why).toMatch(/uninstall the OS first/u);
  });

  it('the bay offers the operating systems while none is installed, and not once one is', () => {
    const none = picker('bay', snap({ storage: [], devices: [] }));
    expect(none.shelf?.map((r) => r.specId)).toStrictEqual(['os1', 'os2', 'os3', 'os4']);
    const bay = picker('bay', withOs());
    expect(bay.shelf).toBeUndefined();
  });

  it('the badge describes the OS on this drive, not the monitor screen', () => {
    const desc = picker('os', withOs());
    expect(desc.nerd).toMatch(/tier 1/u);
    expect(desc.plain).toMatch(/installed on the drive/u);
    expect(desc.plain).toMatch(/monitor only shows its text/u);
  });
});

const buy = (id: string, kind: 'nic' | 'router' | 'isp', price: number) => ({
  id,
  name: id,
  kind,
  price,
  affordable: true,
});

const withLevel = (level: number) => ({ ...snap().level, level });

describe('network parts on the shelf (nic, router, isp rows)', () => {
  it('a part above the player level is a level row with its lock, before money and hardware', () => {
    const s = snap({ money: 99_999 });
    for (const [kind, id] of [
      ['nic', 'nic1'],
      ['router', 'router1'],
      ['isp', 'isp1'],
    ] as const) {
      const row = must(ladderFor(s, kind).find((r) => r.specId === id));
      expect(row, `for ${id}`).toMatchObject({ state: 'level' });
      expect(must(row.lock).level, `for ${id}`).toBeGreaterThan(1);
      expect(row.reason, `for ${id}`).toBeTypeOf('string');
      expect(row.reason, `for ${id}`).not.toBe('');
    }
  });

  it('an unlocked part is a ready row; plans apply at once, and a missing OS, RAM or jack shows as the row warning', () => {
    const s = snap({
      money: 1000,
      level: withLevel(20),
      purchases: [buy('nic1', 'nic', 120), buy('router1', 'router', 60), buy('isp1', 'isp', 150)],
    });
    const nic = must(ladderFor(s, 'nic').find((r) => r.specId === 'nic1'));
    const isp = must(ladderFor(s, 'isp').find((r) => r.specId === 'isp1'));
    const router = must(ladderFor(s, 'router').find((r) => r.specId === 'router1'));
    expect(nic).toMatchObject({ state: 'ready', price: 120 });
    expect(isp).toMatchObject({ state: 'ready', price: 150, applied: true });
    expect(router).toMatchObject({ state: 'ready', price: 60 });
    for (const r of [isp, router, nic]) {
      expect(r.warn, `for ${r.specId}`).toMatch(/^To use it you still need .*an OS/u);
    }
    // The card brings its own jack, the others do not.
    expect(nic.warn).not.toMatch(/jack/u);
    expect(router.warn).toMatch(/a network jack/u);
  });

  it('an owned router reads Placed, an active plan reads Active, and a short purse is a poor row', () => {
    const purchases = [{ ...buy('router2', 'router', 400), affordable: false }, buy('isp2', 'isp', 300)];
    const net = {
      ...snap().net,
      router: { id: 'router1', name: 'Router 1', mbps: 100, clients: 2, visual: 'router-home' },
      isp: { id: 'isp1', name: 'Dial', downMbps: 50, upMbps: 10, clients: 2 },
    };
    const s = snap({ level: withLevel(20), purchases, net });
    expect(ladderFor(s, 'router')[0]).toMatchObject({ specId: 'router1', state: 'installed', fittedLabel: 'Placed' });
    expect(ladderFor(s, 'isp')[0]).toMatchObject({ specId: 'isp1', state: 'installed', fittedLabel: 'Active' });
    expect(ladderFor(s, 'router').find((r) => r.specId === 'router2')).toMatchObject({ state: 'poor' });
  });
});
