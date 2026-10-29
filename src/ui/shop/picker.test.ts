import { describe, expect, it } from 'vitest';
import { clockZones, compareRows, estTempC, goodness, ladderFor, osSection, pickerFor, specBrief, statsOf, zoneOf } from './picker';
import { getSpec } from '../../sim/board/specs';
import { dev, key, PURCHASES, snap, STARTER_CRATE } from '../testdata';
import type { KeySnap, OsJobSnap, OsSnap, Snapshot, StorageSnap } from '../../sim/game/game';

const cpuSpec = getSpec('cpu0') as Extract<ReturnType<typeof getSpec>, { kind: 'cpu' }>;
const stockCooler = getSpec('cooler0') as Extract<ReturnType<typeof getSpec>, { kind: 'cooler' }>;

describe('picker contents per id', () => {
  it('returns nothing without a selection or an unknown id', () => {
    expect(pickerFor(null, snap())).toBeNull();
    expect(pickerFor('cpu0', null)).toBeNull();
    expect(pickerFor('no-such-thing', snap())).toBeNull();
  });

  it('empty CPU socket: the crate part as a spare, then the upgrades with poor and blocked reasons', () => {
    const m = pickerFor('cpu0', snap())!;
    expect(m.kind).toBe('cpu');
    expect(m.title).toBe('Processor socket');
    expect(m.plain).toMatch(/empty processor socket/);
    expect(m.lines).toEqual([]);
    expect(m.device).toBeUndefined();
    expect(m.clock).toBe(false);
    expect(m.current).toBeNull();
    expect(m.ladder.map((r) => [r.specId, r.state]).slice(0, 3)).toEqual([['cpu0', 'crate'], ['cpu1', 'poor'], ['cpu2', 'blocked']]);
    expect(m.ladder[1]).toMatchObject({ price: 200, reason: 'Need $200 more' });
    expect(m.ladder[2]!.reason).toBe('needs a 100 W power supply');
  });

  it('sandbox: nothing is unaffordable and prices read free', () => {
    const m = pickerFor('cpu0', snap({ sandbox: true, money: 0 }))!;
    expect(m.ladder.find((r) => r.specId === 'cpu1')).toMatchObject({ state: 'ready', free: true, reason: undefined });
    const c = pickerFor('cpu0', snap({ money: 0 }))!;
    expect(c.ladder.find((r) => r.specId === 'cpu1')).toMatchObject({ state: 'poor' });
    expect(c.ladder.find((r) => r.specId === 'cpu1')!.free).toBeUndefined();
  });

  it('installed CPU: live device, clock control, the ladder starts at the fitted part', () => {
    const s = snap({
      devices: [dev({ id: 'dev1', spec: 'cpu0', kind: 'cpu', slot: 'cpu0' })],
      slots: [{ id: 'cpu0', type: 'cpu', deviceId: 'dev1' }],
      cpuClock: { value: 1, min: 0.25, max: 1.5 },
      inventory: [],
    });
    const m = pickerFor('cpu0', s)!;
    expect(m.device?.id).toBe('dev1');
    expect(m.clock).toBe(true);
    expect(m.current).toBe('cpu0');
    expect(m.ladder[0]).toMatchObject({ specId: 'cpu0', state: 'installed', devId: 'dev1' });
    expect(m.ladder.find((r) => r.specId === 'cpu1')).toMatchObject({ state: 'poor' });
    expect(m.ladder.find((r) => r.specId === 'ram1')).toBeUndefined();
    expect(m.lines).toEqual([]);

    const hot = pickerFor('dev1', snap({
      devices: [dev({ id: 'dev1', tempC: 88, unstable: true })],
      cpuClock: { value: 1.5, min: 0.25, max: 1.5 },
    }))!;
    expect(hot.lines.some((l) => l.level === 'bad' && /Unstable/.test(l.text))).toBe(true);
  });

  it('a spec id that is not installed shows the spec, and is the default comparison', () => {
    const s = snap({ devices: [dev({ id: 'dev1', spec: 'cpu0', kind: 'cpu' })] });
    const m = pickerFor('cpu1', s)!;
    expect(m.kind).toBe('cpu');
    expect(m.device).toBeUndefined();
    expect(m.title).toBe(getSpec('cpu1')!.name);
    expect(m.focus).toBe('cpu1');
  });

  it('inventory item (inv:): the part of its kind, its ladder, and the item as the comparison', () => {
    const m = pickerFor('inv:inv3', snap())!;
    expect(m.kind).toBe('ram');
    expect(m.focus).toBe('ram0');
    expect(m.ladder.find((r) => r.specId === 'ram0')).toMatchObject({ state: 'crate', invId: 'inv3' });
    expect(m.ladder.find((r) => r.specId === 'ram1')).toMatchObject({ state: 'ready', price: 100 });
  });

  it('the crate is gone: its old id describes the inventory, not a card of its own', () => {
    const m = pickerFor('crate', snap())!;
    expect(m.kind).toBe('info');
    expect(m.title).toBe('Inventory');
  });

  it('key in the tray: job details and a plug action', () => {
    const k = key({ id: 7, label: '#80 calc', type: 'calc', age: 40, deadlineTick: 100, arrivalTick: 60, payoutEstimate: 75 });
    const m = pickerFor('key:7', snap({ tray: [k], baseTick: 90 }))!;
    expect(m.kind).toBe('key');
    expect(m.title).toBe('Client key #80 calc');
    expect(m.lines.map((l) => l.text).join(' ')).toMatch(/Due in 10s/);
    expect(m.lines.map((l) => l.text).join(' ')).toMatch(/Pays about \$75/);
    expect(m.actions.map((a) => a.id)).toEqual(['plug']);
    expect(m.actions[0]!.keyId).toBe(7);
  });

  it('late key explains the late penalty', () => {
    const m = pickerFor('key:1', snap({ tray: [key({ late: true })], baseTick: 200 }))!;
    expect(m.lines.some((l) => l.level === 'bad' && /Late by/.test(l.text))).toBe(true);
  });

  it('finished key in the port: remove action, result shown', () => {
    const k = key({ id: 3, done: true, result: '#72 mul=31 OK' });
    const m = pickerFor('key:3', snap({ plugged: k }))!;
    expect(m.actions).toEqual([expect.objectContaining({ id: 'eject', label: 'Remove key (get paid)', primary: true })]);
    expect(m.lines.some((l) => /#72 mul=31 OK/.test(l.text))).toBe(true);
  });

  it('a second key while one is plugged: plug is refused with a reason', () => {
    const m = pickerFor('key:2', snap({ tray: [key({ id: 2 })], plugged: key({ id: 1 }) }))!;
    expect(m.actions[0]).toMatchObject({ id: 'plug', why: 'A key is already plugged in' });
  });

  it('tray: how many keys are waiting out of the cap', () => {
    const m = pickerFor('tray', snap({ tray: [key({ id: 1 }), key({ id: 2 })] }))!;
    expect(m.lines[0]!.text).toBe('2 of 8 keys waiting. A full tray turns clients away.');
  });

  it('power button on a machine that cannot start: refused with the sim reason', () => {
    const m = pickerFor('power', snap())!;
    expect(m.actions[0]).toMatchObject({ id: 'power', label: 'Power on' });
    expect(m.actions[0]!.why).toMatch(/power supply/);
    expect(m.lines.some((l) => /power supply/.test(l.text))).toBe(true);
  });

  it('power button after a PSU trip: power cycle comes first', () => {
    const s = snap({ power: { vrmLossW: 0, totalW: 90, budgetW: 40, psuFactor: 0, off: false, tripped: true }, powered: true, phase: 'error', phaseReason: 'power supply tripped' });
    const m = pickerFor('power', s)!;
    expect(m.actions.map((a) => a.id)).toEqual(['powerCycle', 'power']);
    expect(m.lines[0]!.level).toBe('bad');
  });

  it('PSU: power readout, a ladder with the next supply, and a power cycle after a trip', () => {
    const s = snap({
      devices: [dev({ id: 'dev2', spec: 'psu0', kind: 'psu', name: 'PSU 40 W', slot: 'atx0' })],
      slots: [{ id: 'atx0', type: 'atx', deviceId: 'dev2' }],
      power: { vrmLossW: 0, totalW: 95, budgetW: 40, psuFactor: 0.4, off: false, tripped: true },
      money: 100,
    });
    const m = pickerFor('psu', s)!;
    expect(m.kind).toBe('psu');
    expect(m.lines.some((l) => l.level === 'bad' && /95 W of 40 W/.test(l.text))).toBe(true);
    expect(m.ladder.map((r) => [r.specId, r.state])).toEqual([['psu0', 'installed'], ['psu1', 'ready'], ['psu2', 'level'], ['psu3', 'level'], ['psu4', 'level']]);
    expect(m.actions[0]!.id).toBe('powerCycle');
  });

  it('USB port: free port with nothing waiting, or the plugged key', () => {
    expect(pickerFor('usb', snap())!.lines[0]!.text).toMatch(/No keys waiting/);
    const m = pickerFor('usb', snap({ plugged: key({ id: 5, done: true, label: '#90 log' }) }))!;
    expect(m.lines[0]!.text).toMatch(/finished, ready to hand back/);
    expect(m.actions[0]).toMatchObject({ id: 'eject', keyId: 5 });
  });

  it('cable: unplugged shows the blocked reason', () => {
    const m = pickerFor('cable.atx', snap())!;
    expect(m.kind).toBe('info');
    expect(m.lines[0]).toMatchObject({ level: 'warn', text: 'the power supply is not installed' });
  });

  it('region ids give an info card', () => {
    for (const id of ['vrm', 'vrm2', 'pcie', 'chipset', 'io', 'atx', 'cpw', 'm2', 'sata', 'bat', 'audio']) {
      const m = pickerFor(id, snap());
      expect(m, id).not.toBeNull();
      expect(m!.kind).toBe('info');
      expect(m!.plain.length, id).toBeGreaterThan(10);
    }
  });

  it('monitor: explanation, and no upgrades to buy yet when only the starter monitor is installed (the graphics display waits for its level)', () => {
    const m = pickerFor('monitor', snap({ devices: [dev({ id: 'dev3', spec: 'display0', kind: 'display', name: 'CLI monitor' })] }))!;
    expect(m.kind).toBe('display');
    expect(m.ladder.map((r) => r.state)).toEqual(['installed', 'level']);
    expect(m.emptyText).toBeUndefined(); // the locked graphics display is the next upgrade
  });

  it('board: the ladder offers the next motherboard tier, with its price', () => {
    const s = snap({ purchases: [...PURCHASES, { id: 'board1', name: 'ATX+ board', kind: 'board', price: 300, affordable: false }] });
    const m = pickerFor('board', s)!;
    expect(m.kind).toBe('board');
    expect(m.ladder.map((r) => [r.specId, r.state])).toEqual([['board0', 'installed'], ['board1', 'poor'], ['board2', 'level'], ['board3', 'level']]);
  });
});

describe('upgrade ladder', () => {
  it('lists every tier, the lower ones too: nothing is outgrown', () => {
    const s = snap({ devices: [dev({ id: 'dev1', spec: 'cpu1', kind: 'cpu' })], inventory: [] });
    const lad = ladderFor(s, 'cpu');
    expect(lad.map((r) => r.specId)).toEqual(['cpu0', 'cpu1', 'cpu2', 'cpu3', 'cpu2d', 'cpu2f', 'cpu2m', 'cpu3t', 'cpu4', 'cpu3f', 'cpu3m', 'cpu5s', 'cpu5h', 'cpu4f', 'cpu4m', 'cpu4w']);
    expect(lad.find((r) => r.specId === 'cpu1')!.state).toBe('installed');
  });

  it('a part you own offers another copy: the tile keeps its buy-another price, and counts the spares', () => {
    const s = snap({
      devices: [dev({ id: 'dev1', spec: 'cpu1', kind: 'cpu' })],
      inventory: [{ ...STARTER_CRATE[0]!, id: 'inv8', spec: 'cpu1', kind: 'cpu', name: getSpec('cpu1')!.name }, { ...STARTER_CRATE[0]!, id: 'inv9', spec: 'cpu2', kind: 'cpu', name: getSpec('cpu2')!.name }],
      purchases: [{ id: 'cpu1', name: 'x', kind: 'cpu', price: 60, affordable: true }, { id: 'cpu2', name: 'y', kind: 'cpu', price: 120, affordable: false }],
      money: 10,
    });
    const lad = ladderFor(s, 'cpu');
    expect(lad.find((r) => r.specId === 'cpu1')).toMatchObject({ state: 'installed', spares: 1, more: { state: 'ready', price: 60 } });
    expect(lad.find((r) => r.specId === 'cpu2')).toMatchObject({ state: 'crate', spares: 1, more: { state: 'poor', price: 120 } });
  });

  it('a spare part of a newer tier is a crate rung', () => {
    const s = snap({ inventory: [{ ...STARTER_CRATE[0]!, id: 'inv9', spec: 'cpu1', name: getSpec('cpu1')!.name }] });
    expect(ladderFor(s, 'cpu').find((r) => r.specId === 'cpu1')).toMatchObject({ state: 'crate', invId: 'inv9' });
  });
});

describe('part stats and before/after', () => {
  it('summarises each part with numbers the bars can use', () => {
    expect(statsOf('ram0').map((x) => [x.key, x.value])).toEqual([['size', 16], ['latency', 200], ['banks', 2], ['lanes', 1], ['power', 2]]);
    expect(statsOf('psu1')).toEqual([expect.objectContaining({ key: 'watts', value: 100, higherIsBetter: true })]);
    expect(statsOf('cpu2')[0]!.value).toBeGreaterThan(statsOf('cpu1')[0]!.value);
    expect(statsOf('nope')).toEqual([]);
  });

  it('bar length is 1 for the best part of its kind, lower-is-better inverts', () => {
    expect(goodness('cpu', 'speed', statsOf('cpu4w')[0]!.value, true)).toBe(1);
    expect(goodness('ram', 'latency', 4, false)).toBe(1);
    expect(goodness('ram', 'latency', 200, false)).toBeCloseTo(0.02, 5);
  });

  it('compares the option with the current part: better, worse, same, with the delta', () => {
    const rows = compareRows('ram', 'ram0', 'ram1');
    expect(rows.find((r) => r.key === 'size')).toMatchObject({ trend: 'better', deltaText: '+16 K', curText: '16 K', optText: '32 K' });
    expect(rows.find((r) => r.key === 'latency')).toMatchObject({ trend: 'better', deltaText: '-188 ticks' });
    const back = compareRows('ram', 'ram1', 'ram0');
    expect(back.find((r) => r.key === 'size')!.trend).toBe('worse');
    expect(compareRows('cpu', 'cpu0', 'cpu0').every((r) => r.trend === 'same')).toBe(true);
  });

  it('with no current part there is no delta', () => {
    const rows = compareRows('cpu', null, 'cpu1');
    expect(rows.every((r) => r.cur === null && r.trend === null && r.deltaText === null)).toBe(true);
  });

  it('describes each kind of part in a line', () => {
    expect(specBrief(getSpec('cpu2')!)).toBe('5-stage, forwarding, 3x base clock (max 5x)');
    expect(specBrief(getSpec('ram1')!)).toBe('DDR2 32K, 4 banks, latency 12');
    expect(specBrief(getSpec('psu2')!)).toBe('250 W, needs ATX+ board');
    expect(specBrief(getSpec('cooler1')!)).toBe('0.8 W/C cooling');
  });
});

describe('overclock zones (the same steady-state heat model as thermal.ts)', () => {
  it('the stock CPU with the stock heatsink: steady temperature and where the zones start', () => {
    // 10 W at base clock, 0.15 + 0.35 W/C to the case: 25 + 10 / 0.5 = 45 C at stock.
    expect(estTempC(cpuSpec, stockCooler, 1)).toBeCloseTo(45, 6);
    const z = clockZones(cpuSpec, stockCooler);
    expect(z.throttleAt).toBeCloseTo(Math.cbrt(45 * 0.5 / 10), 6); // about 1.31x: 70 C
    expect(z.unstableAt).toBeCloseTo(Math.cbrt(60 * 0.5 / 10), 6); // about 1.44x: 85 C
    expect(zoneOf(z, 1)).toBe('safe');
    expect(zoneOf(z, 1.4)).toBe('throttle');
    expect(zoneOf(z, 1.5)).toBe('unstable');
  });

  it('a bigger cooler moves the zones up', () => {
    const big = getSpec('cooler2') as Extract<ReturnType<typeof getSpec>, { kind: 'cooler' }>;
    expect(clockZones(cpuSpec, big).unstableAt).toBeGreaterThan(clockZones(cpuSpec, stockCooler).unstableAt);
  });
});

describe('the OS section (the OS badge and the drive that hosts it)', () => {
  const hdd: StorageSnap = {
    deviceId: 'dev-hdd', slot: 'sata0', spec: 'hdd0', name: 'HDD 96K', burnt: false, capacityBytes: 96 * 1024,
    usedBytes: 12 * 1024, bytesRead: 0, bytesWritten: 0, busy: false, latencyTicks: 720, blockTicks: 72, bytesPerSecond: 3600, hasOs: true,
  };
  const job = (o: Partial<OsJobSnap>): OsJobSnap => ({ slot: 0, keyId: 1, label: '#1 log', state: 'queued', persisted: true, ahead: 0, ...o });
  const osOn = (queue: OsJobSnap[] = [], o: Partial<OsSnap> = {}): OsSnap => ({
    spec: 'os1', tier: 1, name: 'Resident OS 1.0', deviceId: 'dev-hdd', slot: 'sata0', programSlots: 1, queueSlots: 4,
    up: true, queue, runningKeyId: null, spool: { slotBytes: 4096, slots: 4, used: 0, freeBytes: 0, full: false }, ...o,
  });
  const withOs = (queue: OsJobSnap[] = [], extra: Parameters<typeof snap>[0] = {}) =>
    snap({
      storage: [hdd], devices: [dev({ id: 'dev-hdd', spec: 'hdd0', kind: 'storage', slot: 'sata0', name: 'HDD 96K' })],
      os: osOn(queue), powered: true, phase: 'running-os',
      purchases: [...PURCHASES, {
        id: 'os2', name: 'Cooperative OS', kind: 'os', price: 600, affordable: false, later: true,
        blocked: 'planned: not available yet', description: 'Cooperative multitasking: several programs resident at once. Planned.',
      }],
      ...extra,
    });

  it('is null without an OS', () => {
    expect(osSection(snap())).toBeNull();
  });

  it('gives the OS name, tier, status, slot counts and host drive space', () => {
    const sec = osSection(withOs())!;
    expect(sec.name).toBe('Resident OS 1.0');
    expect(sec.tier).toBe(1);
    expect(sec.status).toBe('Running job');
    expect(sec.programSlots).toBe(1);
    expect(sec.queueSlots).toBe(4);
    expect(sec.host).toEqual({ slot: 'sata0', usedK: 12, capK: 96 });
  });

  it('lists queue rows with the job type and how many are ahead; the running job is named', () => {
    const keys: KeySnap[] = [key({ id: 7, label: '#7 scan', type: 'scan', stage: 'queued' })];
    const s = withOs([
      job({ keyId: 5, label: '#5 log', state: 'running', ahead: 0 }),
      job({ keyId: 7, label: '#7 scan', state: 'queued', ahead: 1, slot: 1 }),
      job({ keyId: 9, label: '#9 calc', state: 'queued', ahead: 2, slot: 2 }),
    ], { tray: keys });
    const sec = osSection(s)!;
    expect(sec.running).toBe('#5 log');
    expect(sec.queue.map((q) => [q.label, q.text])).toEqual([['#5 log', 'running now'], ['#7 scan', '1 ahead'], ['#9 calc', '2 ahead']]);
    expect(sec.queue[1]!.type).toBe('scan');
    expect(sec.queue.length).toBe(3);
  });

  it('a finished result waits in the queue as done', () => {
    const s = withOs([job({ keyId: 3, label: '#3 log', state: 'result', ahead: -1 })], { tray: [key({ id: 3, label: '#3 log', stage: 'result' })] });
    expect(osSection(s)!.queue[0]!.text).toBe('done');
  });

  it('the ladder offers the later tiers locked, with their description', () => {
    const sec = osSection(withOs())!;
    const later = sec.ladder.filter((r) => r.state === 'level');
    expect(later.map((r) => r.specId)).toEqual(['os2', 'os3', 'os4']);
    expect(later[0]!.reason).toMatch(/Level 8/);
  });

  it('the drive that hosts the OS shows the section; another drive does not', () => {
    const host = pickerFor('dev-hdd', withOs())!;
    expect(host.osSection?.name).toBe('Resident OS 1.0');
    expect(host.actions.map((a) => a.id)).toContain('uninstallOs');

    const other: StorageSnap = { ...hdd, deviceId: 'dev-ssd', slot: 'sata1', spec: 'ssd1', hasOs: false };
    const s2 = snap({
      storage: [hdd, other],
      devices: [dev({ id: 'dev-hdd', spec: 'hdd0', kind: 'storage', slot: 'sata0' }), dev({ id: 'dev-ssd', spec: 'ssd1', kind: 'storage', slot: 'sata1' })],
      os: osOn(), powered: false, phase: 'off',
    });
    expect(pickerFor('dev-ssd', s2)!.osSection).toBeFalsy();
    expect(pickerFor('dev-ssd', s2)!.actions.map((a) => a.id)).not.toContain('uninstallOs');
  });

  it('the os badge opens the OS section with uninstall, and the ladder sits inside the section', () => {
    const on = pickerFor('os', withOs())!;
    expect(on.kind).toBe('os');
    expect(on.osSection?.name).toBe('Resident OS 1.0');
    expect(on.actions.map((a) => a.id)).toEqual(['uninstallOs']);
    expect(on.ladder).toEqual([]);
    expect(on.title).toBe('Resident OS 1.0');
  });

  it('uninstall is refused while the machine is on (the reason is the disabled tooltip)', () => {
    const a = pickerFor('os', withOs())!.actions[0]!;
    expect(a.why).toMatch(/Power the machine off/);
  });

  it('the bay offers the operating systems while none is installed, and not once one is', () => {
    const none = pickerFor('bay', snap({ storage: [], devices: [] }))!;
    expect(none.shelf?.map((r) => r.specId)).toEqual(['os1', 'os2', 'os3', 'os4']);
    expect(pickerFor('bay', withOs())!.shelf).toBeUndefined();
  });

  it('the badge describes the OS on this drive, not the monitor screen', () => {
    const desc = pickerFor('os', withOs())!;
    expect(desc.nerd).toMatch(/tier 1/);
    expect(desc.plain).toMatch(/installed on the drive/);
    expect(desc.plain).toMatch(/monitor only shows its text/);
  });
});

describe('network parts on the shelf (nic, router, isp rows)', () => {
  const buy = (id: string, kind: 'nic' | 'router' | 'isp', price: number) => ({ id, name: id, kind, price, affordable: true });
  const withLevel = (level: number) => ({ ...snap().level, level });

  it('a part above the player level is a level row with its lock, before money and hardware', () => {
    const s = snap({ money: 99999 });
    for (const [kind, id] of [['nic', 'nic1'], ['router', 'router1'], ['isp', 'isp1']] as const) {
      const row = ladderFor(s, kind).find((r) => r.specId === id)!;
      expect(row, id).toMatchObject({ state: 'level' });
      expect(row.lock!.level, id).toBeGreaterThan(1);
      expect(row.reason, id).toBeTruthy();
    }
  });

  it('an unlocked part is a ready row; plans apply at once, and a missing OS, RAM or jack shows as the row warning', () => {
    const s = snap({ money: 1000, level: withLevel(20), purchases: [buy('nic1', 'nic', 120), buy('router1', 'router', 60), buy('isp1', 'isp', 150)] });
    const nic = ladderFor(s, 'nic').find((r) => r.specId === 'nic1')!;
    const isp = ladderFor(s, 'isp').find((r) => r.specId === 'isp1')!;
    const router = ladderFor(s, 'router').find((r) => r.specId === 'router1')!;
    expect(nic).toMatchObject({ state: 'ready', price: 120 });
    expect(isp).toMatchObject({ state: 'ready', price: 150, applied: true });
    expect(router).toMatchObject({ state: 'ready', price: 60 });
    for (const r of [isp, router, nic]) expect(r.warn, r.specId).toMatch(/^To use it you still need .*an OS/);
    // The card brings its own jack, the others do not.
    expect(nic.warn).not.toMatch(/jack/);
    expect(router.warn).toMatch(/a network jack/);
  });

  it('an owned router reads Placed, an active plan reads Active, and a short purse is a poor row', () => {
    const purchases = [{ ...buy('router2', 'router', 400), affordable: false }, buy('isp2', 'isp', 300)];
    const net = { ...snap().net, router: { id: 'router1', name: 'Router 1' }, isp: { id: 'isp1', name: 'Dial' } } as unknown as Snapshot['net'];
    const s = snap({ level: withLevel(20), purchases, net });
    expect(ladderFor(s, 'router')[0]).toMatchObject({ specId: 'router1', state: 'installed', fittedLabel: 'Placed' });
    expect(ladderFor(s, 'isp')[0]).toMatchObject({ specId: 'isp1', state: 'installed', fittedLabel: 'Active' });
    expect(ladderFor(s, 'router').find((r) => r.specId === 'router2')).toMatchObject({ state: 'poor' });
  });
});
