import { describe, expect, it } from 'vitest';
import {
  billChip, cacheHitRate, clockWarning, cpiIpc, describeId, fillToasts, fmtMoney, friendlyError, fmtTicks, HINTS, newHints,
  fitFilterFor, fitsFilter, statusChip, stallsByCause, stackItems, tempLevel, triggeredHints,
} from './logic';
import { inventoryGroups } from './logic';
import { REGIONS } from './regions';
import { getSpec } from '../sim/board/specs';
import type { Phase } from '../sim/game/game';
import { dev, key, snap } from './testdata';
import { gpuIds } from '../render/board/gpulayout';
import { isGpuId } from './panels/gpudesc';
import { cpuPlan } from '../render/die/cpuplans';
import type { PlanInput } from '../render/die/cpuplan';

/** One floorplan per architecture and optional part: the ids the die writes. */
const DIE_INPUTS: PlanInput[] = [
  { arch: 'unpipelined', cacheLines: 8 }, { arch: 'inorder', forwarding: false, cacheLines: 8 }, { arch: 'inorder', forwarding: true, cacheLines: 16, icacheLines: 8, l2Lines: 32 },
  { arch: 'inorder2', forwarding: true, cacheLines: 16 }, { arch: 'ooo', width: 2, robSize: 8, schedSize: 6, fetchQueue: 4, cacheLines: 16 }, { arch: 'inorder', forwarding: true, cacheLines: 8, cores: 4 },
];

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
  it('looseFan: a fitted fan with its cable out while the machine is on', () => {
    const cable = (id: string, connected: boolean, blocked: string | null = null) => ({ id, name: id, connected, blocked, plain: '' }) as unknown as ReturnType<typeof snap>['cables'][number];
    const loose = [cable('fan:front0', false)], none = [cable('fan:front0', false, 'no fan fitted'), cable('vrmfan', true)];
    expect(triggeredHints(snap({ powered: true, cables: loose }))).toContain('looseFan');
    expect(triggeredHints(snap({ powered: false, cables: loose }))).not.toContain('looseFan');
    expect(triggeredHints(snap({ powered: true, cables: none }))).not.toContain('looseFan');
  });
  it('a radiator fan cable is described as the radiator\'s, a bare mount\'s as a case fan', () => {
    const s = snap({ devices: [dev({ kind: 'radiator', slot: 'rad-top' })] });
    expect(describeId('cable.fan:top0', s)!.title).toMatch(/Radiator fan cable \(top 1\)/);
    expect(describeId('cable.fan:top1', s)!.title).toMatch(/Radiator fan cable \(top 2\)/); // it spans the whole top
    expect(describeId('cable.fan:front0', s)!.title).toMatch(/Case fan cable \(front 1\)/);
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
      'board',
      // the die: one id per kind of block, from every architecture's floorplan (the renderer's hit ids)
      ...DIE_INPUTS.flatMap((i) => cpuPlan(i).blocks.filter((b) => b.kind !== 'stage').map((b) => 'cpu.' + b.kind)),
    ];
    for (const id of ids) expect(describeId(id, s), id).not.toBeNull();
    for (const [id, d] of Object.entries(REGIONS)) {
      expect(d.plain.length, `${id} plain`).toBeGreaterThan(10);
      expect(d.nerd.length, `${id} nerd`).toBeGreaterThan(10);
    }
  });

  it('every network render id has a description (docs/render/net.md "Network")', () => {
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

describe('graphics card ids', () => {
  const gpuSnap = (slot: string, lanes: number, banks: number): NonNullable<ReturnType<typeof snap>['gpus']>[number] => ({
    slot, lanes, banks, memBytes: 8192, phase: 'run', mask: 0b101, stack: [1], pc: 8, regs: [], launches: 2, error: false, frame: [],
    trace: [], stats: { instructions: 10, idleLaneSlots: 3, conflictCycles: 4, cycles: 14 },
  });

  it('every part the board draws on a graphics card has a description, with and without a snapshot', () => {
    for (const [spec, visual] of [['gpu1', 'gpu-1'], ['gpu2', 'gpu-2'], ['gpu3', 'gpu-3']] as const) {
      const gs = getSpec(spec) as { gpu: { lanes: number; banks: number } };
      const s = snap({ devices: [dev({ id: 'g1', spec, kind: 'gpu', slot: 'pcie1', tempC: 61 })], gpus: [gpuSnap('pcie1', gs.gpu.lanes, gs.gpu.banks)] });
      const ids = gpuIds(visual, 'pcie1');
      expect(ids.length, visual).toBeGreaterThan(gs.gpu.lanes + gs.gpu.banks);
      for (const id of ids) {
        for (const d of [describeId(id, s), describeId(id)]) {
          expect(d, `${visual} ${id}`).not.toBeNull();
          expect(d!.title.length, `${id} title`).toBeGreaterThan(2);
          expect(d!.plain.length, `${id} plain`).toBeGreaterThan(10);
          expect(d!.nerd.length, `${id} nerd`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('says what a lane, bank and fan are doing now, and ignores ids that are not card parts', () => {
    const s = snap({ devices: [dev({ id: 'g1', spec: 'gpu2', kind: 'gpu', slot: 'pcie0', tempC: 72 })], gpus: [gpuSnap('pcie0', 16, 2)] });
    expect(describeId('pcie0.lane0', s)!.nerd).toMatch(/lane 0 of 16 \| on/);
    expect(describeId('pcie0.lane1', s)!.nerd).toMatch(/off under the mask/);
    expect(describeId('pcie0.bank1', s)!.nerd).toMatch(/bank 1 of 2.*4 cycles lost/);
    expect(describeId('pcie0.fan1', s)!.nerd).toMatch(/72 C now.*fan 2/);
    expect(describeId('pcie0.maskstack', s)!.nerd).toBe('depth 1 of 8');
    expect(describeId('pcie0.lane99')).not.toBeNull(); // any lane number reads as a lane; the board only writes the ones that exist
    expect(describeId('pcie0.unknown', s)).toBeNull();
    expect(describeId('pcie0.sm1.lanes')!.nerd).toMatch(/SM 1/);
    expect(describeId('pcie0.warp3')!.title).toBe('Warp 3');
    expect(describeId('pcie0.l2')!.title).toBe('L2 cache');
    expect(isGpuId('pcie0.sm1.nonsense')).toBe(false);
    expect(isGpuId('pcie2.mem')).toBe(true);
    expect(isGpuId('pcie2')).toBe(false);
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

describe('billChip', () => {
  const bill = { ratePerWh: 0.15, periodTicks: 600, nextTick: 700, accruedWh: 4, accruedCost: 1, unpaid: 0, cutTick: null, cut: false, last: null, paidTotal: 0 };
  it('is absent without a bill', () => {
    expect(billChip(snap())).toBeNull();
  });
  it('shows the running cost and the time to the next bill', () => {
    expect(billChip(snap({ baseTick: 640, bill }))).toEqual({ text: '$1 1m 00s', level: 'idle' });
  });
  it('warns while a bill is unpaid and goes red when the wall is cut', () => {
    expect(billChip(snap({ baseTick: 700, bill: { ...bill, unpaid: 3, cutTick: 760 } }))).toEqual({ text: '$3 due, cut in 1m 00s', level: 'warn' });
    expect(billChip(snap({ bill: { ...bill, unpaid: 3, cutTick: 760, cut: true } }))).toEqual({ text: 'CUT $3', level: 'bad' });
  });
});
