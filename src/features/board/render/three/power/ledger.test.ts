import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/protocol';
import { dev, snap } from '@/core/ui/testdata';
import { powerLedger, wattsText } from './ledger';

/** A running machine: PSU, CPU, RAM, a SATA drive and a monitor, 54 W on the supply. */
function running(over: Partial<Snapshot> = {}, cords = { pc: true, mon: true }): Snapshot {
  return snap({
    powered: true, phase: 'idle-os' as never, power: { vrmLossW: 2, totalW: 54, budgetW: 250, psuFactor: 1, off: false, tripped: false }, energy: { wallW: 60, wh: 1 },
    devices: [dev({ id: 'psu', kind: 'psu', slot: 'atx0', powerW: 0 }), dev({ id: 'cpu', kind: 'cpu', slot: 'cpu0', powerW: 13 }), dev({ id: 'ram', kind: 'ram', slot: 'dimm0', powerW: 4 }),
      dev({ id: 'hdd', kind: 'storage', slot: 'sata0', powerW: 5 }), dev({ id: 'mon', kind: 'display', slot: 'display0', powerW: 1.2 })],
    storage: [{ deviceId: 'hdd', slot: 'sata0' } as never],
    cables: [
      { id: 'atx', name: 'ATX', connected: true }, { id: 'cpu', name: 'CPU', connected: true }, { id: 'video', name: 'Video', connected: true },
      { id: 'pcmains', name: 'PC cord', connected: cords.pc }, { id: 'monmains', name: 'Monitor cord', connected: cords.mon },
    ] as Snapshot['cables'],
    ...over,
  });
}

describe('the power ledger', () => {
  it('a running machine: the PC cord carries what the machine takes less the monitor, the monitor cord the monitor, the cables split the rest', () => {
    const l = powerLedger(running());
    expect(l.cable.get('pcmains')).toBeCloseTo(54 - 1.2, 9);
    expect(l.cable.get('monmains')).toBe(1.2);
    expect(l.cable.get('cpu')).toBe(13);
    expect(l.cable.get('hdd:power')).toBe(5);
    expect(l.state('pcmains')).toBe('on');
    // what the wall gives the PC is what the cables hand on
    expect(l.cable.get('atx')! + l.cable.get('cpu')! + l.cable.get('hdd:power')!).toBeCloseTo(l.cable.get('pcmains')!, 9);
    expect(l.wallW).toBe(60);
    expect(l.loadW).toBe(54);
  });

  it('a card takes its watts from the slot and its PCIe lead in equal shares, and the lead leaves the 24-pin its share', () => {
    const base = running();
    const s = { ...base, devices: [...base.devices, dev({ id: 'gpu', kind: 'gpu', spec: 'gpu2', slot: 'pcie0', powerW: 60 })], cables: [...base.cables, { id: 'pcie', name: 'PCIe 1', connected: true }] as Snapshot['cables'] };
    const l = powerLedger(s);
    expect(l.cable.get('pcie')).toBe(30);
    expect(l.board.get('gpu')).toBe(30); // the slot's share
    expect(l.board.get('hdd')).toBe(0); // its own lead feeds the drive
    expect(l.board.get('ram')).toBe(4);
    expect(l.cable.get('atx')! + l.cable.get('cpu')! + l.cable.get('hdd:power')! + l.cable.get('pcie')!).toBeCloseTo(l.cable.get('pcmains')!, 9);
    const open = powerLedger({ ...s, cables: s.cables.map((c) => (c.id === 'pcie' ? { ...c, connected: false } : c)) });
    expect(open.state('pcie')).toBe('missing');
    expect(open.cable.get('pcie')).toBe(0);
    expect(open.missing('pcie')).toBe(true);
    expect(open.missing('atx')).toBe(false);
  });

  it('a cord that is out is missing and carries nothing; the other cord runs on', () => {
    const l = powerLedger(running({}, { pc: false, mon: true }));
    expect(l.state('pcmains')).toBe('missing');
    expect(l.cable.get('pcmains')).toBe(0);
    expect(l.state('monmains')).toBe('on');
  });

  it('a supply cable that is out is missing', () => {
    const base = running();
    const l = powerLedger({ ...base, cables: base.cables.map((c) => (c.id === 'atx' ? { ...c, connected: false } : c)) as Snapshot['cables'] });
    expect(l.state('atx')).toBe('missing');
    expect(l.state('cpu')).toBe('on');
  });

  it('a machine that is off carries nothing: every run idles, bar a cable that is out', () => {
    const base = running();
    const l = powerLedger({ ...base, powered: false, power: { ...base.power, off: true } });
    expect(l.on).toBe(false);
    expect([...l.cable.values()].every((w) => w === 0)).toBe(true);
    expect(l.state('pcmains')).toBe('idle');
    expect(l.state('hdd:power')).toBe('idle');
    expect(l.loadW).toBe(0);
    expect([...l.part.values()].every((w) => w === 0)).toBe(true);
  });

  it('fans: a heatsink fan and the pump ride the CPU fan header, a case fan its own cord and the hub, a sink fan its header', () => {
    const base = running();
    const s = {
      ...base,
      devices: [
        ...base.devices,
        dev({ id: 'cool', kind: 'cooler', spec: 'cooler0', slot: 'cooler0', powerW: 1 }), dev({ id: 'cf', kind: 'fan', spec: 'fan120', slot: 'cooler0.fan0', powerW: 2 }),
        dev({ id: 'vrm', kind: 'vrm-sink', spec: 'vrm0', slot: 'vrm-sink0', powerW: 0 }), dev({ id: 'vf', kind: 'fan', spec: 'fan92', slot: 'vrm-sink0.fan0', powerW: 1.5 }),
        dev({ id: 'f0', kind: 'fan', spec: 'fan120', slot: 'front0', powerW: 2.5 }), dev({ id: 'f1', kind: 'fan', spec: 'fan120', slot: 'rear', powerW: 3 }),
      ],
    };
    const l = powerLedger(s);
    expect(l.cable.get('cpufan')).toBe(3);
    expect(l.cable.get('vrmfan')).toBe(1.5);
    expect(l.cable.get('fan:front0')).toBe(2.5);
    expect(l.cable.get('fan:rear')).toBe(3);
    expect(l.cable.get('sysfan')).toBe(5.5);
    expect(l.kinds.get('fan')).toEqual({ w: 9, ids: ['cf', 'vf', 'f0', 'f1'] });
  });

  it('the supply glows by what it hands the machine; the monitor is no part of a kind', () => {
    const l = powerLedger(running());
    expect(l.part.get('psu')).toBeCloseTo(52.8, 9);
    expect(l.part.get('mon')).toBe(1.2);
    expect(l.kinds.has('display')).toBe(false);
    expect(l.kinds.has('psu')).toBe(false);
    expect(l.kinds.get('cpu')).toEqual({ w: 13, ids: ['cpu'] });
    expect(l.kinds.get('ram')).toEqual({ w: 4, ids: ['ram'] });
  });

  it('the scale reads the machine itself: its draw, never under a floor', () => {
    expect(powerLedger(running()).refW).toBe(60);
    expect(powerLedger(running({ power: { vrmLossW: 0, totalW: 300, budgetW: 450, psuFactor: 1, off: false, tripped: false } })).refW).toBe(300);
  });

  it('a supply that tripped says so', () => {
    expect(powerLedger(running({ power: { vrmLossW: 0, totalW: 600, budgetW: 250, psuFactor: 0.4, off: false, tripped: true } })).tripped).toBe(true);
  });

  it('words: a decimal under 10 W, whole above', () => {
    expect(wattsText(4)).toBe('4.0 W');
    expect(wattsText(13)).toBe('13 W');
    expect(wattsText(1.24)).toBe('1.2 W');
    expect(wattsText(54.4)).toBe('54 W');
  });
});
