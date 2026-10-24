import { describe, expect, it } from 'vitest';
import {
  cacheHitRate, clockWarning, cpiIpc, describeId, fillToasts, fmtMoney, friendlyError, fmtTicks, HINTS, newHints,
  fitFilterFor, fitsFilter, queueReadout, statusChip, stallsByCause, stackItems, tempLevel, triggeredHints,
} from './logic';
import { inventoryGroups } from './logic';
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
  it('halted: job done asks for the key to be removed, no boot media asks for a key and a restart', () => {
    const done = statusChip(snap({ phase: 'halted', powered: true, haltReason: 'job-done' }));
    expect(done.text).toBe('Job done: remove key');
    expect(done.title).toMatch(/power off and on/);
    expect(statusChip(snap({ phase: 'halted', powered: true, haltReason: 'no-boot-media' })).text).toBe('No boot media');
  });
  it('a POST error is presented as one, not as a refusal', () => {
    const c = statusChip(snap({ phase: 'error', powered: true, phaseReason: 'no CPU installed', postFailed: true }));
    expect(c.text).toBe('POST error: no CPU installed');
    expect(c.level).toBe('bad');
  });
  it('a key plugged into a running no-OS machine raises the hint', () => {
    expect(triggeredHints(snap({ phase: 'halted', powered: true, keyIgnored: true }))).toContain('keyIgnored');
    expect(triggeredHints(snap({ phase: 'halted', powered: true }))).not.toContain('keyIgnored');
    expect(HINTS.keyIgnored!.text).toMatch(/only looks for a program at boot/);
  });
  it.each(phaseText)('phase %s reads "%s"', (phase, text) => {
    expect(statusChip(snap({ phase, powered: phase !== 'off' })).text).toBe(text);
  });
  it('error shows the reason', () => {
    const c = statusChip(snap({ phase: 'error', phaseReason: 'CPU burnt out' }));
    expect(c.text).toBe('Error: CPU burnt out');
    expect(c.level).toBe('bad');
  });
  it('a tripped supply overrides the phase', () => {
    expect(statusChip(snap({ phase: 'running', power: { vrmLossW: 0, totalW: 90, budgetW: 40, psuFactor: 0, off: false, tripped: true } })).text).toBe('Tripped');
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
    expect(triggeredHints(snap({ power: { vrmLossW: 0, totalW: 90, budgetW: 40, psuFactor: 0.4, off: false, tripped: true } }))).toEqual(['trip']);
    expect(triggeredHints(snap({ power: { vrmLossW: 0, totalW: 50, budgetW: 40, psuFactor: 0.8, off: false, tripped: false } }))).toEqual(['brownout']);
  });
  describe('network hints', () => {
    const base = snap().net;
    const withNet = (o: Partial<typeof base>) => snap({ net: { ...base, ...o } });
    const osWith = (spoolFull: boolean) => ({ queue: [], queueSlots: 4, spool: { full: spoolFull }, spoolFull } as unknown as NonNullable<ReturnType<typeof snap>['os']>);

    it('nothing on a quiet network', () => {
      expect(triggeredHints(snap())).toEqual([]);
    });
    it('retiredKeys: link-up retires the USB path and keys are left', () => {
      expect(triggeredHints(withNet({ state: 'link-up', usbRetired: true, retiredKeys: 2 }))).toContain('retiredKeys');
      expect(triggeredHints(withNet({ state: 'link-up', usbRetired: true, retiredKeys: 0 }))).not.toContain('retiredKeys');
      expect(triggeredHints(withNet({ usbRetired: false, retiredKeys: 2 }))).not.toContain('retiredKeys');
    });
    it('portBusyKey: a key is parked in the port', () => {
      expect(triggeredHints(withNet({ portBusyKey: 7 }))).toContain('portBusyKey');
      expect(triggeredHints(withNet({ portBusyKey: null }))).not.toContain('portBusyKey');
    });
    it('spoolFull: only while the link is up or saturated', () => {
      expect(triggeredHints(snap({ os: osWith(true), net: { ...base, state: 'link-up' } }))).toContain('spoolFull');
      expect(triggeredHints(snap({ os: osWith(true), net: { ...base, state: 'saturated' } }))).toContain('spoolFull');
      expect(triggeredHints(snap({ os: osWith(true), net: { ...base, state: 'down' } }))).not.toContain('spoolFull');
      expect(triggeredHints(snap({ os: osWith(false), net: { ...base, state: 'link-up' } }))).not.toContain('spoolFull');
    });
    it('linkDown: the link was up once (fallback armed) and is down now', () => {
      const fb = (state: 'off' | 'retired' | 'waiting' | 'fallback') => ({ ...base.usbFallback, state });
      expect(triggeredHints(withNet({ state: 'down', usbFallback: fb('waiting') }))).toContain('linkDown');
      expect(triggeredHints(withNet({ state: 'down', usbFallback: fb('off') }))).not.toContain('linkDown');
      expect(triggeredHints(withNet({ state: 'down', usbFallback: fb('waiting'), reason: 'the OS is starting' }))).not.toContain('linkDown');
    });
    it('saturated: the link is saturated', () => {
      expect(triggeredHints(withNet({ state: 'saturated' }))).toContain('saturated');
      expect(triggeredHints(withNet({ state: 'link-up' }))).not.toContain('saturated');
    });
    it('every network hint has a definition', () => {
      for (const id of ['retiredKeys', 'portBusyKey', 'spoolFull', 'linkDown', 'saturated']) expect(HINTS[id]?.text.length, id).toBeGreaterThan(20);
    });
  });
  it('shows each only once', () => {
    const s = snap({ queueLength: 5 });
    expect(newHints(s, new Set()).map((h) => h.id)).toEqual(['queue']);
    expect(newHints(s, new Set(['queue']))).toEqual([]);
  });
});

describe('toast queue', () => {
  const h = (id: string) => ({ id, text: id });
  it('shows one at a time and queues the rest in order', () => {
    const r = fillToasts([], [h('a'), h('b'), h('c'), h('d')]);
    expect(r.visible.map((t) => t.id)).toEqual(['a']);
    expect(r.queue.map((t) => t.id)).toEqual(['b', 'c', 'd']);
  });
  it('shows the next one when a slot frees up', () => {
    const r = fillToasts([], [h('c'), h('d')]);
    expect(r.visible.map((t) => t.id)).toEqual(['c']);
    expect(r.queue.map((t) => t.id)).toEqual(['d']);
  });
  it('does nothing when full', () => {
    const r = fillToasts([h('a')], [h('c')]);
    expect(r.visible).toHaveLength(1);
    expect(r.queue).toHaveLength(1);
  });
});

describe('descriptions', () => {
  it('spec and board ids', () => {
    expect(describeId('cpu2')?.nerd).toContain('forwarding');
    expect(describeId('ram1')?.nerd).toContain('32K');
    expect(describeId('board')?.title).toBe('Motherboard');
    expect(describeId('board1')?.nerd).toMatch(/slots: .*1 atx/);
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

  it('every network render id has a description (docs/RENDER.md "Network")', () => {
    const s = snap();
    for (const id of ['router', 'wall', 'cable.lan', 'eth0', 'eth1', 'eth2', 'eth3']) {
      for (const d of [describeId(id, s), describeId(id)]) {
        expect(d, id).not.toBeNull();
        expect(d!.plain.length, `${id} plain`).toBeGreaterThan(10);
        expect(d!.nerd.length, `${id} nerd`).toBeGreaterThan(10);
      }
    }
  });
});

describe('inventoryGroups', () => {
  it('lists a router and a network card on the shelf, in shelf order', () => {
    const items = [{ kind: 'os' }, { kind: 'router' }, { kind: 'cpu' }, { kind: 'nic' }];
    expect(inventoryGroups(items).map((g) => g.k)).toEqual(['cpu', 'nic', 'router', 'os']);
  });
  it('never drops an item of an unknown kind', () => {
    const items = [{ kind: 'cpu' }, { kind: 'mystery' }];
    expect(inventoryGroups(items).flatMap((g) => g.items)).toHaveLength(2);
  });
});

describe('inventory stacks and the fit filter', () => {
  const item = (id: string, spec: string, kind: string, free: string[] = [], swap: string[] = []) =>
    ({ id, spec, kind, name: spec, freeSlots: free, swapSlots: swap, installable: free.length + swap.length > 0 });

  it('identical spares become one stack; the fittable one stands for it, the order is kept', () => {
    const items = [item('a', 'ram0', 'ram'), item('b', 'cpu1', 'cpu', ['cpu0']), item('c', 'ram0', 'ram', ['dimm0']), item('d', 'ram0', 'ram')];
    const st = stackItems(items);
    expect(st.map((x) => [x.spec, x.items.length])).toEqual([['ram0', 3], ['cpu1', 1]]);
    expect(st[0]!.rep.id).toBe('c');
    expect(st[1]!.rep.id).toBe('b');
  });

  it('selecting a socket, a device, the PSU, the monitor or the drive bay asks for what fits there', () => {
    const s = snap({ devices: [dev({ id: 'dev1', kind: 'cpu', spec: 'cpu0', slot: 'cpu0' })] });
    expect(fitFilterFor('cpu0', s)).toMatchObject({ slots: ['cpu0'] });
    expect(fitFilterFor('dev1', s)).toMatchObject({ slots: ['cpu0'] });
    expect(fitFilterFor('psu', s)).toMatchObject({ kinds: ['psu'] });
    expect(fitFilterFor('monitor', s)).toMatchObject({ kinds: ['display'] });
    expect(fitFilterFor('bay', s)).toMatchObject({ kinds: ['storage', 'os'] });
    expect(fitFilterFor('inv:inv1', s)).toBeNull();
    expect(fitFilterFor('key:3', s)).toBeNull();
    expect(fitFilterFor('nonsense', s)).toBeNull();
    expect(fitFilterFor(null, s)).toBeNull();
  });

  it('a part fits when its free or swap sockets include the filter socket, or its kind is asked for', () => {
    const f = { label: 'x', slots: ['cpu0'], kinds: [] as string[] };
    expect(fitsFilter(f, item('a', 'cpu1', 'cpu', ['cpu0']))).toBe(true);
    expect(fitsFilter(f, item('b', 'cpu1', 'cpu', [], ['cpu0']))).toBe(true);
    expect(fitsFilter(f, item('c', 'ram1', 'ram', ['dimm0']))).toBe(false);
    expect(fitsFilter({ label: 'bay', slots: [], kinds: ['storage', 'os'] }, item('d', 'hdd0', 'storage'))).toBe(true);
    expect(fitsFilter({ label: 'bay', slots: [], kinds: ['storage', 'os'] }, item('e', 'cpu1', 'cpu'))).toBe(false);
  });
});
