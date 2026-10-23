import { describe, expect, it } from 'vitest';
import { pickerFor, specBrief } from './picker';
import { getSpec } from '../sim/board/specs';
import { dev, key, snap, STARTER_CRATE } from './testdata';

describe('picker contents per id', () => {
  it('returns nothing without a selection or an unknown id', () => {
    expect(pickerFor(null, snap())).toBeNull();
    expect(pickerFor('cpu0', null)).toBeNull();
    expect(pickerFor('no-such-thing', snap())).toBeNull();
  });

  it('empty CPU socket: crate part, upgrades with their blocked and poor reasons', () => {
    const m = pickerFor('cpu0', snap())!;
    expect(m.kind).toBe('cpu');
    expect(m.title).toBe('Processor socket');
    expect(m.lines.map((l) => l.text).join(' ')).toMatch(/Empty socket/);
    expect(m.device).toBeUndefined();
    expect(m.clock).toBe(false);
    const crate = m.rows.filter((r) => r.tag === 'crate');
    expect(crate.map((r) => r.id)).toEqual(['inv1']);
    const up = m.rows.filter((r) => r.tag === 'upgrade');
    expect(up.map((r) => r.id)).toEqual(['cpu1', 'cpu2']);
    expect(up[0]).toMatchObject({ state: 'poor', price: 200, reason: 'Need $200 more' });
    expect(up[1]).toMatchObject({ state: 'blocked', reason: 'needs a 100 W power supply' });
  });

  it('installed CPU: live device, clock control, overclock warning when hot', () => {
    const s = snap({
      devices: [dev({ id: 'dev1', spec: 'cpu0', kind: 'cpu', slot: 'cpu0' })],
      slots: [{ id: 'cpu0', type: 'cpu', deviceId: 'dev1' }],
      cpuClock: { value: 1, min: 0.25, max: 1.5 },
    });
    const m = pickerFor('cpu0', s)!;
    expect(m.device?.id).toBe('dev1');
    expect(m.clock).toBe(true);
    expect(m.rows.find((r) => r.tag === 'installed')?.id).toBe('cpu0');
    expect(m.rows.find((r) => r.id === 'ram1')).toBeUndefined();
    expect(m.rows.find((r) => r.id === 'cpu1')).toMatchObject({ state: 'poor' });
    expect(m.lines).toEqual([]);

    const hot = pickerFor('dev1', snap({
      devices: [dev({ id: 'dev1', tempC: 88, unstable: true })],
      cpuClock: { value: 1.5, min: 0.25, max: 1.5 },
    }))!;
    expect(hot.lines.some((l) => l.level === 'bad' && /Unstable/.test(l.text))).toBe(true);
  });

  it('a spec id that is not installed shows the spec, not another part', () => {
    const s = snap({ devices: [dev({ id: 'dev1', spec: 'cpu0', kind: 'cpu' })] });
    const m = pickerFor('cpu1', s)!;
    expect(m.kind).toBe('cpu');
    expect(m.device).toBeUndefined();
    expect(m.title).toBe(getSpec('cpu1')!.name);
  });

  it('crate: lists the contents with a drag hint', () => {
    const m = pickerFor('crate', snap())!;
    expect(m.kind).toBe('crate');
    expect(m.title).toBe(`Crate (${STARTER_CRATE.length})`);
    expect(m.rows.map((r) => r.id)).toEqual(['inv1', 'inv2', 'inv3', 'inv4']);
    expect(m.rows.every((r) => r.tag === 'crate')).toBe(true);
    expect(m.lines[0]!.text).toMatch(/Drag a part onto its socket/);
  });

  it('crate item (inv:): the item is a part of its kind, with its upgrades', () => {
    const m = pickerFor('inv:inv3', snap())!;
    expect(m.kind).toBe('ram');
    expect(m.rows.find((r) => r.id === 'ram1')).toMatchObject({ state: 'ready', price: 100 });
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

  it('PSU: power readout, upgrades, and a power cycle after a trip', () => {
    const s = snap({
      devices: [dev({ id: 'dev2', spec: 'psu0', kind: 'psu', name: 'PSU 40 W', slot: 'atx0' })],
      slots: [{ id: 'atx0', type: 'atx', deviceId: 'dev2' }],
      power: { totalW: 95, budgetW: 40, psuFactor: 0.4, off: false, tripped: true },
      money: 100,
    });
    const m = pickerFor('psu', s)!;
    expect(m.kind).toBe('psu');
    expect(m.lines.some((l) => l.level === 'bad' && /95 W of 40 W/.test(l.text))).toBe(true);
    expect(m.rows.filter((r) => r.tag === 'upgrade').map((r) => r.id)).toEqual(['psu1']);
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
    expect(m.rows.filter((r) => r.tag === 'upgrade')).toEqual([]);
    expect(m.emptyText).toBe('Nothing better to buy right now.');
  });
});

describe('spec briefs', () => {
  it('summarises each kind of part in a line', () => {
    expect(specBrief(getSpec('cpu2')!)).toBe('5-stage, forwarding, 3x base clock (max 5x)');
    expect(specBrief(getSpec('ram1')!)).toBe('32K, latency 12');
    expect(specBrief(getSpec('psu2')!)).toBe('250 W, needs ATX+ board');
    expect(specBrief(getSpec('cooler1')!)).toBe('0.8 W/C cooling');
  });
});
