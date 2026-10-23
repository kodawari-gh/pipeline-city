import { describe, expect, it } from 'vitest';
import { clockZones, compareRows, estTempC, goodness, ladderFor, pickerFor, specBrief, statsOf, zoneOf } from './picker';
import { getSpec } from '../sim/board/specs';
import { dev, key, PURCHASES, snap, STARTER_CRATE } from './testdata';

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
    expect(m.lines.map((l) => l.text).join(' ')).toMatch(/Empty socket/);
    expect(m.device).toBeUndefined();
    expect(m.clock).toBe(false);
    expect(m.current).toBeNull();
    expect(m.ladder.map((r) => [r.specId, r.state])).toEqual([['cpu0', 'crate'], ['cpu1', 'poor'], ['cpu2', 'blocked']]);
    expect(m.ladder[1]).toMatchObject({ price: 200, reason: 'Need $200 more' });
    expect(m.ladder[2]!.reason).toBe('needs a 100 W power supply');
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
    const s = snap({ power: { totalW: 90, budgetW: 40, psuFactor: 0, off: false, tripped: true }, powered: true, phase: 'error', phaseReason: 'power supply tripped' });
    const m = pickerFor('power', s)!;
    expect(m.actions.map((a) => a.id)).toEqual(['powerCycle', 'power']);
    expect(m.lines[0]!.level).toBe('bad');
  });

  it('PSU: power readout, a ladder with the next supply, and a power cycle after a trip', () => {
    const s = snap({
      devices: [dev({ id: 'dev2', spec: 'psu0', kind: 'psu', name: 'PSU 40 W', slot: 'atx0' })],
      slots: [{ id: 'atx0', type: 'atx', deviceId: 'dev2' }],
      power: { totalW: 95, budgetW: 40, psuFactor: 0.4, off: false, tripped: true },
      money: 100,
    });
    const m = pickerFor('psu', s)!;
    expect(m.kind).toBe('psu');
    expect(m.lines.some((l) => l.level === 'bad' && /95 W of 40 W/.test(l.text))).toBe(true);
    expect(m.ladder.map((r) => [r.specId, r.state])).toEqual([['psu0', 'installed'], ['psu1', 'ready'], ['psu2', 'locked']]);
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

  it('monitor: explanation, and no upgrades when there is only the starter monitor', () => {
    const m = pickerFor('monitor', snap({ devices: [dev({ id: 'dev3', spec: 'display0', kind: 'display', name: 'CLI monitor' })] }))!;
    expect(m.kind).toBe('display');
    expect(m.ladder.map((r) => r.state)).toEqual(['installed']);
    expect(m.emptyText).toBe('Nothing better to buy right now.');
  });

  it('board: the ladder offers the next motherboard tier, with its price', () => {
    const s = snap({ purchases: [...PURCHASES, { id: 'board1', name: 'ATX+ board', kind: 'board', price: 300, affordable: false }] });
    const m = pickerFor('board', s)!;
    expect(m.kind).toBe('board');
    expect(m.ladder.map((r) => [r.specId, r.state])).toEqual([['board0', 'installed'], ['board1', 'poor']]);
  });
});

describe('upgrade ladder', () => {
  it('leaves out tiers older than the best part you own', () => {
    const s = snap({ devices: [dev({ id: 'dev1', spec: 'cpu1', kind: 'cpu' })], inventory: [] });
    const ids = ladderFor(s, 'cpu').map((r) => r.specId);
    expect(ids).toEqual(['cpu1', 'cpu2']);
    expect(ladderFor(s, 'cpu')[0]!.state).toBe('installed');
  });

  it('a spare part of a newer tier is a crate rung', () => {
    const s = snap({ inventory: [{ ...STARTER_CRATE[0]!, id: 'inv9', spec: 'cpu1', name: getSpec('cpu1')!.name }] });
    expect(ladderFor(s, 'cpu').find((r) => r.specId === 'cpu1')).toMatchObject({ state: 'crate', invId: 'inv9' });
  });
});

describe('part stats and before/after', () => {
  it('summarises each part with numbers the bars can use', () => {
    expect(statsOf('ram0').map((x) => [x.key, x.value])).toEqual([['size', 16], ['latency', 200], ['power', 2]]);
    expect(statsOf('psu1')).toEqual([expect.objectContaining({ key: 'watts', value: 100, higherIsBetter: true })]);
    expect(statsOf('cpu2')[0]!.value).toBeGreaterThan(statsOf('cpu1')[0]!.value);
    expect(statsOf('nope')).toEqual([]);
  });

  it('bar length is 1 for the best part of its kind, lower-is-better inverts', () => {
    expect(goodness('cpu', 'speed', statsOf('cpu2')[0]!.value, true)).toBe(1);
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
    expect(specBrief(getSpec('ram1')!)).toBe('32K, latency 12');
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

describe('purchases in the fixture', () => {
  it('the fixture offers what the ladder tests rely on', () => {
    expect(PURCHASES.map((p) => p.id)).toEqual(['cpu1', 'cpu2', 'ram1', 'psu1']);
  });
});
