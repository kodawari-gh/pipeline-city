import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { deviceSpec } from '@/features/board/sim/board';
import { BUILD_PRESETS, specSheet } from '@/features/board/sim/buildspecs';
import { countNames, freeName, groupByKind, hintLine, linkLine, pillOf, pips, plural, powerMeter, presetBits, priceOf, rate, readiness, type Alert, type HintState } from './buildhud';

const full = () => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });

describe('readiness', () => {
  it('says a full rig is ready to start', () => {
    const g = full();
    expect(readiness(g.board, g.cables)).toEqual({ ok: true, line: 'Ready to start' });
  });

  it('names what is missing, power first', () => {
    const g = full();
    const psu = g.board.devices.find((d) => deviceSpec(d).kind === 'psu')!;
    g.uninstall(psu.id);
    const r = readiness(g.board, g.cables);
    expect(r.ok).toBe(false);
    expect(r.line).toMatch(/PSU/);
  });

  it('names the part the boot test would stop at', () => {
    const g = full();
    const cpu = g.board.devices.find((d) => deviceSpec(d).kind === 'cpu')!;
    g.uninstall(cpu.id);
    expect(readiness(g.board, g.cables)).toEqual({ ok: false, line: 'No CPU installed' });
  });

  it('puts the motherboard before everything for a bare case, and the case before that on an empty stage (the boot test does not know either)', () => {
    const g = full();
    expect(readiness(g.board, g.cables, 'case')).toEqual({ ok: false, line: 'No motherboard' });
    expect(readiness(g.board, g.cables, 'nothing')).toEqual({ ok: false, line: 'No case' });
    expect(readiness(g.board, g.cables, 'machine')).toEqual({ ok: true, line: 'Ready to start' });
  });
});

describe('the pill', () => {
  const alert = (id: string, level: 'bad' | 'warn', title: string): Alert => ({ id, level, title, text: `${title}: the whole sentence.`, part: null });

  it('is green when there is nothing to say', () => {
    expect(pillOf([])).toMatchObject({ tone: 'ok', label: 'Ready to start', alerts: [] });
  });

  it('gives one problem its own words, in the colour of its level: amber when the machine runs badly or lacks a part, red when it breaks', () => {
    expect(pillOf([alert('boot', 'warn', 'No CPU installed')])).toMatchObject({ tone: 'warn', label: 'No CPU installed', title: 'No CPU installed: the whole sentence.' });
    expect(pillOf([alert('psu-trip', 'bad', 'Supply trips')])).toMatchObject({ tone: 'bad', label: 'Supply trips' });
  });

  it('counts several, and is red when any of them breaks', () => {
    expect(pillOf([alert('a', 'warn', 'A'), alert('b', 'warn', 'B')])).toMatchObject({ tone: 'warn', label: '2 warnings' });
    const two = pillOf([alert('a', 'bad', 'A'), alert('b', 'warn', 'B')]);
    expect(two).toMatchObject({ tone: 'bad', label: '2 problems' });
    expect(two.title).toBe('A: A: the whole sentence.\nB: B: the whole sentence.');
  });

  it('says what is missing for a bare case or an empty stage, whatever the list holds (there is no machine to judge)', () => {
    expect(pillOf([], 'case')).toMatchObject({ tone: 'warn', label: 'No motherboard', alerts: [] });
    expect(pillOf([alert('a', 'bad', 'A')], 'nothing')).toMatchObject({ tone: 'warn', label: 'No case', alerts: [] });
  });
});

describe('powerMeter', () => {
  it('is empty with no supply', () => expect(powerMeter({ headroom: null })).toEqual({ pct: 0, tone: 'none' }));
  it('goes from ok through warn to bad as the load nears and passes the supply', () => {
    expect(powerMeter({ headroom: 0.4 })).toEqual({ pct: 40, tone: 'ok' });
    expect(powerMeter({ headroom: 0.9 })).toEqual({ pct: 90, tone: 'warn' });
    expect(powerMeter({ headroom: 1.3 })).toEqual({ pct: 100, tone: 'bad' });
  });
  it('is red from the first watt over the supply, and a sheet that is given the machine\'s own draw (what the regulators waste too) says so', () => {
    expect(powerMeter({ headroom: 1.01 })).toEqual({ pct: 100, tone: 'bad' });
    const parts = { boardTier: 0, caseTier: 0, specs: ['psu0', 'cpu0'] };
    const listed = specSheet(parts), drawn = specSheet({ ...parts, drawW: listed.psuW + 1 });
    expect(drawn.loadW).toBe(listed.psuW + 1);
    expect(powerMeter(drawn).tone).toBe('bad');
    expect(powerMeter(listed).tone).not.toBe('bad');
  });
});

describe('groupByKind', () => {
  const dev = (spec: string, slot: string) => ({ id: slot, spec, slot });
  it('groups by kind in the given order, the rest last, each group in its own order', () => {
    const list = [dev('ram0', 'dimm0'), dev('cpu0', 'cpu0'), dev('ram1', 'dimm1')];
    const groups = groupByKind(list, ['cpu', 'ram']);
    expect(groups.map((g) => g.kind)).toEqual(['cpu', 'ram']);
    expect(groups[1]!.items.map((d) => d.slot)).toEqual(['dimm0', 'dimm1']);
    expect(groupByKind(list, ['ram']).map((g) => g.kind)).toEqual(['ram', 'cpu']);
  });
});

describe('priceOf and pips', () => {
  it('prices a part, a board tier and a case tier', () => {
    expect(priceOf('cpu1')).toBeGreaterThan(0);
    expect(priceOf('board1')).toBeGreaterThanOrEqual(0);
    expect(priceOf('case1')).toBeGreaterThanOrEqual(0);
    expect(priceOf('nothing')).toBeNull();
  });
  it('prices an OS, a router and an internet plan (the shelf shows them with their prices)', () => {
    for (const id of ['os1', 'router2', 'isp3']) expect(priceOf(id), id).toBeGreaterThan(0);
    expect(priceOf('router2')).toBeLessThan(priceOf('router4')!);
  });
  it('lights at least one pip and all of them at the top tier', () => {
    expect(pips(0, 7)).toBe(1);
    expect(pips(7, 7)).toBe(5);
    expect(pips(3, 7)).toBe(2);
    expect(pips(0, 0)).toBe(5);
  });
});

describe('rate and linkLine', () => {
  const net = (o: Partial<Parameters<typeof linkLine>[0]>): Parameters<typeof linkLine>[0] => ({
    state: 'link-up', reason: null, bandwidth: { downMbps: 100, upMbps: 10, clients: 2, binding: 'router' },
    router: { id: 'router1', name: 'Home router', mbps: 100, clients: 2, visual: 'router-home' }, isp: { id: 'isp2', name: 'Cable', downMbps: 200, upMbps: 50, clients: 4 }, ...o,
  });

  it('writes a speed in Mbit/s, and in Gbit/s from a thousand', () => {
    expect(rate(100)).toBe('100 Mbit/s');
    expect(rate(1000)).toBe('1 Gbit/s');
    expect(rate(2500)).toBe('2.5 Gbit/s');
    expect(rate(49.6)).toBe('50 Mbit/s');
  });

  it('says what is missing, in amber, in the words of the shelf: the router, the plan, the cable, the OS', () => {
    expect(linkLine(net({ state: 'no-device', router: null, reason: 'no router: install one next to the monitor' }))).toEqual({ tone: 'warn', text: 'No router: pick one from the shelf' });
    expect(linkLine(net({ state: 'no-device', isp: null }))).toEqual({ tone: 'warn', text: 'No internet plan: pick one from the shelf' });
    expect(linkLine(net({ state: 'no-device', router: null, isp: null }))).toEqual({ tone: 'warn', text: 'No router and no internet plan: pick them from the shelf' });
    expect(linkLine(net({ state: 'no-cable' }))).toEqual({ tone: 'warn', text: 'The ethernet cable is not plugged in' });
    expect(linkLine(net({ state: 'no-os', reason: 'needs an OS: the network runs inside it' }))).toEqual({ tone: 'warn', text: 'needs an OS: the network runs inside it' });
  });

  it('says the speed and what holds it back once the link is up, in green', () => {
    expect(linkLine(net({}))).toEqual({ tone: 'ok', text: '100 Mbit/s down · 10 Mbit/s up · held back by the router' });
  });

  it('says the speed it would have, in amber, while the machine is off', () => {
    const l = linkLine(net({ state: 'down', reason: 'the machine is off' }));
    expect(l.tone).toBe('warn');
    expect(l.text).toMatch(/^100 Mbit\/s down.*\(the machine is off\)$/);
  });
});

describe('hintLine', () => {
  const base: HintState = { busy: false, step: '', dragging: null, over: null, picked: false, open: true, fitted: 5 };
  it('follows what the player is doing', () => {
    expect(hintLine({ ...base, busy: true, step: 'Unscrew the cooler' })).toBe('Unscrew the cooler');
    expect(hintLine({ ...base, dragging: 'shelf', over: 'stage' })).toMatch(/lit socket/);
    expect(hintLine({ ...base, dragging: 'shelf', over: null })).toMatch(/onto the PC/);
    expect(hintLine({ ...base, dragging: 'machine', over: 'bin' })).toMatch(/take it out/);
    expect(hintLine({ ...base, fitted: 0 })).toMatch(/empty/);
    expect(hintLine({ ...base, picked: true })).toMatch(/Delete/);
    expect(hintLine({ ...base, open: false })).toMatch(/side panel/);
    expect(hintLine(base)).toMatch(/Drag a part/);
  });

  it('takes an OS, a router or a plan whatever stands on the stage: it fits the room, not a socket', () => {
    for (const shown of ['machine', 'case', 'nothing'] as const) {
      const h: HintState = { ...base, shown, shell: 'net', dragging: 'shelf' };
      expect(hintLine({ ...h, over: 'stage' })).toBe('Let go to fit it');
      expect(hintLine({ ...h, over: null })).toBe('Drag it onto the stage');
    }
  });

  it('asks for a motherboard first while the case is bare, and takes a board or a case for what it is', () => {
    const bare: HintState = { ...base, fitted: 0, shown: 'case' };
    expect(hintLine(bare)).toMatch(/motherboard/);
    expect(hintLine({ ...bare, dragging: 'shelf', over: 'stage' })).toMatch(/Fit a motherboard first/);
    expect(hintLine({ ...bare, dragging: 'shelf', over: 'stage', shell: 'board' })).toMatch(/Let go on the case/);
    expect(hintLine({ ...bare, dragging: 'shelf', over: null, shell: 'case' })).toMatch(/onto the case/);
    // (a step in progress is still said first)
    expect(hintLine({ ...bare, busy: true, step: 'Lower the board' })).toBe('Lower the board');
  });

  it('asks for a case first while the stage is empty, and takes a case and nothing else', () => {
    const none: HintState = { ...base, fitted: 0, shown: 'nothing' };
    expect(hintLine(none)).toMatch(/stage is empty.*case/);
    expect(hintLine({ ...none, dragging: 'shelf', over: 'stage', shell: 'case' })).toMatch(/bring the case in/);
    expect(hintLine({ ...none, dragging: 'shelf', over: null, shell: 'case' })).toMatch(/onto the stage/);
    expect(hintLine({ ...none, dragging: 'shelf', over: 'stage', shell: 'board' })).toMatch(/Fit a case first/);
    expect(hintLine({ ...none, dragging: 'shelf', over: 'stage' })).toMatch(/Fit a case first/);
    expect(hintLine({ ...none, busy: true, step: 'Set the case down' })).toBe('Set the case down');
  });
});

describe('the words of the right panel', () => {
  it('counts what a preset fits besides the tiered parts', () => {
    expect(presetBits({ name: 'a', level: 0.3, ram: 1, storage: 1, gpus: 0, npus: 0 })).toEqual(['1 RAM', '1 drive']);
    expect(presetBits({ name: 'b', level: 1, ram: 8, storage: 4, gpus: 2, npus: 1 })).toEqual(['8 RAM', '4 drives', '2 GPU', 'AI card']);
  });

  it('says the ready-made machines rise from a little to a lot', () => {
    const lit = BUILD_PRESETS.map((p) => pips(p.level * 10, 10));
    expect(lit).toEqual([...lit].sort((a, b) => a - b));
    expect(lit[lit.length - 1]).toBe(5);
  });

  it('writes the names with how many of each, in the order they first appear', () => {
    expect(countNames(['fan', 'ram', 'fan', 'fan'])).toBe('fan ×3 · ram');
    expect(countNames([])).toBe('');
  });

  it('finds a name for a new saved build that no saved build has', () => {
    expect(freeName([])).toBe('My build 1');
    expect(freeName(['a', 'b'])).toBe('My build 3');
    // (a delete leaves a gap: the next name is not the one that is there)
    expect(freeName(['My build 2'])).toBe('My build 3');
  });

  it('pluralises', () => {
    expect([plural(1, 'part'), plural(2, 'part'), plural(0, 'drive')]).toEqual(['1 part', '2 parts', '0 drives']);
  });
});
