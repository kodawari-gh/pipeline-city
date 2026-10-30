import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in accelart.test.ts).
vi.mock('../ink', async (orig) => ({ ...(await orig<typeof import('../ink')>()), label: () => Object.assign(new Container(), { text: '' }) }));

import type { GpuSnap } from '../../sim/game/types';
import type { Theme } from '../theme';
import { fanTurns, GpuView, kindColor, PHASE_TEXT } from './gpuview';
import { setLayoutTier } from './layout';

const T: Theme = {
  dark: true, bg: '#04060f', board: '#081628', trace: '#1e4270', sub: '#0d1636', die: '#111b46', pin: '#d4af5f', tile: '#18245c',
  ink: '#e2eaff', mute: '#8a97c2', line: '#2a366a', dot: '#18214a', on: '#08102a',
  alu: '#3be3ff', mul: '#a68bff', ld: '#ffc247', st: '#6dffa6', br: '#ff55dc', bad: '#ff5a78',
};

const snap = (o: Partial<GpuSnap> = {}): GpuSnap => ({
  slot: 'pcie0', lanes: 8, banks: 1, memBytes: 8192, phase: 'run', mask: 0xff, stack: [0xff], pc: 8, regs: Array.from({ length: 8 }, () => Array(8).fill(1)),
  trace: [{ pc: 0, name: 'vld', kind: 'ld', mask: 0x0f, cost: 2, banks: [2], dest: 3 }, { pc: 4, name: 'halt', kind: 'sys', mask: 0x0f, cost: 1, banks: null, dest: null }],
  launches: 1, error: false, frame: [], stats: { instructions: 2, idleLaneSlots: 4, conflictCycles: 1, cycles: 3 }, ...o,
});

describe('GPU view', () => {
  it('turns the fans faster as the card heats up, with load and when throttled', () => {
    expect(fanTurns(25, false, false)).toBeLessThan(fanTurns(60, false, false));
    expect(fanTurns(60, false, false)).toBeLessThan(fanTurns(90, false, false));
    expect(fanTurns(90, false, false)).toBeLessThan(fanTurns(90, true, false));
    expect(fanTurns(90, true, false)).toBeLessThan(fanTurns(90, true, true));
    expect(fanTurns(25, false, false)).toBeGreaterThan(0);
  });

  it('colours each kind of instruction apart and names every phase', () => {
    const kinds = ['alu', 'ld', 'st', 'mask', 'br', 'sys'] as const;
    expect(new Set(kinds.map((k) => kindColor(T, k))).size).toBe(kinds.length);
    expect(Object.keys(PHASE_TEXT).sort()).toEqual(['idle', 'in', 'out', 'run']);
  });

  it('builds a card per scene entry, spins the fans while a card runs, and stops them without a snapshot', () => {
    setLayoutTier(3, 3);
    const v = new GpuView();
    expect(v.root.visible).toBe(false);
    v.setScene(T, [{ slot: 'pcie0', visual: 'gpu-2', origin: { x: 0, y: 0 } }]);
    expect(v.root.visible).toBe(true);
    const card = v.root.children[0] as Container;
    const fans = card.children.slice(2); // inner, cover, then one spinner per fan
    expect(fans).toHaveLength(2);
    v.setZoom(1);
    v.update([snap()], [{ slot: 'pcie0', tempC: 70, throttle: false } as never]);
    const offset = (f: unknown) => (f as { offset: number }).offset;
    const before = fans.map(offset);
    for (let i = 0; i < 30; i++) v.frame(1 / 30, true);
    expect(fans.map(offset)).not.toEqual(before);
    // zoomed in the cover is gone and the insides show; zoomed out the reverse
    expect(card.children[0]!.visible).toBe(true);
    expect(card.children[1]!.alpha).toBeCloseTo(0, 1);
    v.setZoom(0.1);
    v.frame(0.016, true);
    expect(card.children[0]!.visible).toBe(false);
    expect(card.children[1]!.alpha).toBeCloseTo(1, 1);
    // no snapshot: the fans wind down toward a stop
    v.update(undefined, undefined);
    for (let i = 0; i < 600; i++) v.frame(1 / 30, true);
    const a = offset(fans[0]);
    v.frame(1 / 30, true);
    expect(Math.abs(offset(fans[0]) - a)).toBeLessThan(0.5);
    v.frame(1 / 30, false);
    expect(v.root.visible).toBe(false);
  });
});

describe('along', () => {
  it('finds the point a fraction of the way along a polyline, clamped to its ends', async () => {
    const { along } = await import('./gpuview');
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10]];
    expect(along(pts, 0)).toEqual([0, 0]);
    expect(along(pts, 0.25)).toEqual([5, 0]);
    expect(along(pts, 0.75)).toEqual([10, 5]);
    expect(along(pts, 2)).toEqual([10, 10]);
  });
});

describe('GPU view on a multi-SM card', () => {
  it('draws each SM under its own instruction without error', () => {
    setLayoutTier(3, 3);
    const v = new GpuView();
    v.setScene(T, [{ slot: 'pcie0', visual: 'gpu-3', origin: { x: 0, y: 0 } }]);
    v.setZoom(1);
    const trace = [
      { pc: 0, name: 'vld', kind: 'ld' as const, mask: 0xff, cost: 4, banks: [2, 1, 1, 0], dest: 2, startCycle: 0, sm: 0, warp: 0 },
      { pc: 0, name: 'vadd', kind: 'alu' as const, mask: 0x0f, cost: 1, banks: null, dest: 3, startCycle: 1, sm: 1, warp: 1 },
    ];
    v.update([snap({ lanes: 32, banks: 4, trace })], [{ slot: 'pcie0', tempC: 50, throttle: false } as never]);
    for (let i = 0; i < 30; i++) expect(() => v.frame(1 / 30, true)).not.toThrow();
  });
});
