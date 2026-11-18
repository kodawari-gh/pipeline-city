import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { deviceSpec } from '@/features/board/sim/board';
import { groupByKind, hintLine, pips, powerMeter, priceOf, readiness, type HintState } from './buildhud';

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
});

describe('powerMeter', () => {
  it('is empty with no supply', () => expect(powerMeter({ headroom: null })).toEqual({ pct: 0, tone: 'none' }));
  it('goes from ok through warn to bad as the load nears and passes the supply', () => {
    expect(powerMeter({ headroom: 0.4 })).toEqual({ pct: 40, tone: 'ok' });
    expect(powerMeter({ headroom: 0.9 })).toEqual({ pct: 90, tone: 'warn' });
    expect(powerMeter({ headroom: 1.3 })).toEqual({ pct: 100, tone: 'bad' });
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
  it('lights at least one pip and all of them at the top tier', () => {
    expect(pips(0, 7)).toBe(1);
    expect(pips(7, 7)).toBe(5);
    expect(pips(3, 7)).toBe(2);
    expect(pips(0, 0)).toBe(5);
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
});
