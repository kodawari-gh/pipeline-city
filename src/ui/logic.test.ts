import { describe, expect, it } from 'vitest';
import {
  cacheHitRate, clockWarning, cpiIpc, describeId, fillToasts, fmtMoney, friendlyError, fmtTicks, newHints,
  queueReadout, statusChip, stallsByCause, tempLevel, triggeredHints,
} from './logic';
import { REGIONS } from './regions';
import { getSpec } from '../sim/board/specs';
import type { Phase } from '../sim/game/game';
import { dev, key, snap } from './testdata';

describe('format', () => {
  it('money and ticks', () => {
    expect(fmtMoney(1234.9)).toBe('$1,234');
    expect(fmtTicks(45)).toBe('45s');
    expect(fmtTicks(125)).toBe('2m 05s');
  });
});

describe('stats', () => {
  it('cpi, cache, stalls', () => {
    expect(cpiIpc({ cycles: 0, retired: 0 })).toBeNull();
    expect(cpiIpc({ cycles: 150, retired: 100 })).toEqual({ cpi: 1.5, ipc: 100 / 150 });
    expect(cacheHitRate({})).toBeNull();
    expect(cacheHitRate({ cacheHits: 3, cacheMisses: 1 })).toBe(0.75);
    expect(stallsByCause({ stallFlush: 4 }).find((c) => c.key === 'stallFlush')!.value).toBe(4);
  });
  it('temp level uses the spec', () => {
    const cpu = getSpec('cpu0');
    expect(tempLevel(40, cpu)).toBe('ok');
    expect(tempLevel(66, cpu)).toBe('warn');
    expect(tempLevel(90, cpu)).toBe('bad');
  });
  it('clock warning escalates', () => {
    expect(clockWarning(dev())).toBeNull();
    expect(clockWarning(dev({ tempC: 67 }))?.level).toBe('warn');
    expect(clockWarning(dev({ throttle: 0.9, tempC: 75 }))?.level).toBe('warn');
    expect(clockWarning(dev({ unstable: true, tempC: 88 }))?.level).toBe('bad');
    expect(clockWarning(dev({ burnt: true }))?.level).toBe('bad');
  });
});

describe('HUD status text', () => {
  const phaseText: Array<[Phase, string]> = [
    ['off', 'Off'], ['posting', 'POST'], ['waiting-for-key', 'Waiting for key'], ['loading', 'Loading'],
    ['running', 'Running'], ['writing', 'Writing'], ['done-remove-key', 'Remove key'],
  ];
  it.each(phaseText)('phase %s reads "%s"', (phase, text) => {
    expect(statusChip(snap({ phase, powered: phase !== 'off' })).text).toBe(text);
  });
  it('error shows the reason', () => {
    const c = statusChip(snap({ phase: 'error', phaseReason: 'CPU burnt out' }));
    expect(c.text).toBe('Error: CPU burnt out');
    expect(c.level).toBe('bad');
  });
  it('a tripped supply overrides the phase', () => {
    expect(statusChip(snap({ phase: 'running', power: { totalW: 90, budgetW: 40, psuFactor: 0, off: false, tripped: true } })).text).toBe('Tripped');
  });
  it('off says why the power button would do nothing', () => {
    expect(statusChip(snap()).title).toMatch(/power supply/);
  });
  it('queue: count, cap and the oldest key age', () => {
    expect(queueReadout(snap())).toMatchObject({ count: 0, oldest: null, text: 'no keys waiting' });
    const q = queueReadout(snap({ tray: [key({ id: 1, age: 20 }), key({ id: 2, age: 95 }), key({ id: 3, age: 5 })] }));
    expect(q).toMatchObject({ count: 3, cap: 8, oldest: 95 });
    expect(q.text).toBe('3 keys waiting, oldest 1m 35s');
  });
  it('queue: a late key is flagged', () => {
    expect(queueReadout(snap({ tray: [key({ late: true })] })).late).toBe(true);
  });
});

describe('refusal text', () => {
  it('strips the call name and sentence-cases the reason', () => {
    expect(friendlyError('install: power the machine off first')).toBe('Not now: Power the machine off first.');
    expect(friendlyError('powerButton: nothing to power')).toBe('Not now: Nothing to power.');
  });
  it('keeps a reason that already ends with punctuation', () => {
    expect(friendlyError('plugKey: a key is already plugged in!')).toBe('Not now: A key is already plugged in!');
  });
});

describe('hints', () => {
  it('nothing on a calm snapshot', () => {
    expect(triggeredHints(snap({ devices: [dev()] }))).toEqual([]);
  });
  it('triggers each condition', () => {
    expect(triggeredHints(snap({ counters: { stallCache: 2 } }))).toContain('stall');
    expect(triggeredHints(snap({ devices: [dev({ throttle: 0.9 })] }))).toContain('throttle');
    expect(triggeredHints(snap({ devices: [dev({ unstable: true })] }))).toContain('overheat');
    expect(triggeredHints(snap({ queueLength: 3 }))).toContain('queue');
    expect(triggeredHints(snap({ devices: [dev({ burnt: true })] }))).toContain('burnt');
    expect(triggeredHints(snap({ power: { totalW: 90, budgetW: 40, psuFactor: 0.4, off: false, tripped: true } }))).toEqual(['trip']);
    expect(triggeredHints(snap({ power: { totalW: 50, budgetW: 40, psuFactor: 0.8, off: false, tripped: false } }))).toEqual(['brownout']);
  });
  it('shows each only once', () => {
    const s = snap({ queueLength: 5 });
    expect(newHints(s, new Set()).map((h) => h.id)).toEqual(['queue']);
    expect(newHints(s, new Set(['queue']))).toEqual([]);
  });
});

describe('toast queue', () => {
  const h = (id: string) => ({ id, text: id });
  it('shows at most two and queues the rest in order', () => {
    const r = fillToasts([], [h('a'), h('b'), h('c'), h('d')]);
    expect(r.visible.map((t) => t.id)).toEqual(['a', 'b']);
    expect(r.queue.map((t) => t.id)).toEqual(['c', 'd']);
  });
  it('shows the next one when a slot frees up', () => {
    const r = fillToasts([h('b')], [h('c'), h('d')]);
    expect(r.visible.map((t) => t.id)).toEqual(['b', 'c']);
    expect(r.queue.map((t) => t.id)).toEqual(['d']);
  });
  it('does nothing when full', () => {
    const r = fillToasts([h('a'), h('b')], [h('c')]);
    expect(r.visible).toHaveLength(2);
    expect(r.queue).toHaveLength(1);
  });
});

describe('descriptions', () => {
  it('spec and board ids', () => {
    expect(describeId('cpu2')?.nerd).toContain('forwarding');
    expect(describeId('ram1')?.nerd).toContain('32K');
    expect(describeId('board')?.title).toBe('Motherboard');
    expect(describeId('board1')?.nerd).toMatch(/atx-plus/);
    expect(describeId('nope')).toBeNull();
  });

  it('an empty slot names the socket, an occupied slot describes the part in it', () => {
    const s = snap({
      slots: [{ id: 'cpu0', type: 'cpu', deviceId: null }, { id: 'dimm0', type: 'dimm', deviceId: 'dev7' }],
      devices: [dev({ id: 'dev7', spec: 'ram0', kind: 'ram', slot: 'dimm0' })],
    });
    expect(describeId('cpu0', s)).toMatchObject({ title: 'Empty socket' });
    expect(describeId('dimm0', s)?.title).toBe(getSpec('ram0')!.name);
    expect(describeId('dev7', s)?.title).toBe(getSpec('ram0')!.name);
  });

  it('crate items and keys', () => {
    const s = snap({ tray: [key({ id: 4, label: '#90 log' })] });
    expect(describeId('inv:inv1', s)?.plain).toMatch(/In your inventory/);
    expect(describeId('key:4', s)?.title).toBe('Client key #90 log');
  });

  it('every id the renderer writes has a description', () => {
    const s = snap({ tray: [key({ id: 4 })] });
    const ids = [
      'crate', 'tray', 'usb', 'power', 'monitor', 'psu', 'cable.atx', 'cable.cpu', 'cable.video', 'key:4', 'inv:inv1',
      'vrm', 'vrm2', 'pcie', 'chipset', 'io', 'atx', 'cpw', 'm2', 'sata', 'bat', 'audio', 'psu.readout',
      'cpu.IF', 'cpu.ID', 'cpu.EX', 'cpu.MEM', 'cpu.WB', 'cpu.IC', 'cpu.BP', 'cpu.CLK', 'cpu.DC', 'cpu.RF',
      'cpu.UNCORE', 'cpu.MC', 'cpu.IO', 'cpu.L2', 'board',
    ];
    for (const id of ids) expect(describeId(id, s), id).not.toBeNull();
    for (const [id, d] of Object.entries(REGIONS)) {
      expect(d.plain.length, `${id} plain`).toBeGreaterThan(10);
      expect(d.nerd.length, `${id} nerd`).toBeGreaterThan(10);
    }
  });
});
