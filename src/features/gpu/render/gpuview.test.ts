import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Text needs a canvas, which the tests do not have: labels are empty containers here (as in accelart.test.ts).
vi.mock('@/core/render/ink', async (orig) => ({ ...(await orig<typeof import('@/core/render/ink')>()), label: () => Object.assign(new Container(), { text: '' }) }));

import type { GpuSnap } from '@/worker/game/types';
import type { Theme } from '@/core/render/theme';
import { cardSpins, fanTurns, GpuView, kindColor, PHASE_TEXT } from './gpuview';
import { fanBank } from '@/core/render/fanmotor';
import { setLayoutTier } from '../../board/render/layout/layout';

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
  it('turns the fans with the sim fan speed, faster under load, and not at all at zero', () => {
    expect(fanTurns(0, true)).toBe(0);
    expect(fanTurns(0.2, false)).toBeLessThan(fanTurns(0.6, false));
    expect(fanTurns(0.6, false)).toBeLessThan(fanTurns(1, false));
    expect(fanTurns(0.6, false)).toBeLessThan(fanTurns(0.6, true));
  });

  it('a card spins its fans only while the machine runs and the card is fitted, unburnt and drawing power', () => {
    const d = { burnt: false, powerW: 12 };
    expect(cardSpins(true, d)).toBe(true);
    expect(cardSpins(false, d)).toBe(false); // the PC is off
    expect(cardSpins(true, undefined)).toBe(false); // no card
    expect(cardSpins(true, { ...d, burnt: true })).toBe(false);
    expect(cardSpins(true, { ...d, powerW: 0 })).toBe(false); // not powered
  });

  it('the fans ease up from still and coast down when the machine goes off, and publish their speed', () => {
    setLayoutTier(3, 3);
    fanBank.clear();
    const v = new GpuView();
    v.setScene(T, [{ slot: 'pcie0', visual: 'gpu-2', origin: { x: 0, y: 0 } }]);
    const dev = [{ slot: 'pcie0', tempC: 70, fan: 0.7, throttle: 1, burnt: false, powerW: 40 } as never];
    v.update([snap()], dev, false);
    for (let i = 0; i < 30; i++) v.frame(1 / 30, true);
    expect(fanBank.get('gpu:pcie0')).toBe(0); // the PC is off: still
    v.update([snap()], dev, true);
    v.frame(1 / 30, true);
    const first = fanBank.get('gpu:pcie0');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.5); // no jump to speed
    for (let i = 0; i < 240; i++) v.frame(1 / 30, true);
    const full = fanBank.get('gpu:pcie0');
    expect(full).toBeGreaterThan(3);
    v.update([snap()], dev, false); // the machine goes off
    v.frame(1 / 30, true);
    expect(fanBank.get('gpu:pcie0')).toBeGreaterThan(full * 0.9); // it coasts, no jump to still
    for (let i = 0; i < 600; i++) v.frame(1 / 30, true);
    expect(fanBank.get('gpu:pcie0')).toBe(0);
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
    const fans = card.children.slice(2, -1); // inner, cover, then one spinner per fan
    expect(fans).toHaveLength(2);
    v.setZoom(1);
    v.update([snap()], [{ slot: 'pcie0', tempC: 70, fan: 0.7, throttle: 1, burnt: false, powerW: 40 } as never]);
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

  it('draws a card only while it is in view, and offers it for the detail budget only then', () => {
    setLayoutTier(3, 3);
    const v = new GpuView();
    v.setScene(T, [{ slot: 'pcie0', visual: 'gpu-2', origin: { x: 0, y: 0 } }]);
    v.setZoom(6); // deep enough that even a card off the centre of the view is past the counters stage
    v.update([snap()], [{ slot: 'pcie0', tempC: 70, fan: 0.7, throttle: 1, burnt: false, powerW: 40 } as never]);
    const card = v.root.children[0] as Container;
    const near = { x: -200, y: -200, w: 1000, h: 600 }, far = { x: 1e6, y: 1e6, w: 1000, h: 600 };
    v.frame(1 / 30, true, false, { view: near, top: new Set(['gpu:pcie0']) });
    expect(card.visible).toBe(true);
    expect(v.candidates(near).map((c) => c.id)).toEqual(['gpu:pcie0']);
    expect(v.candidates(far)).toEqual([]);
    v.frame(1 / 30, true, false, { view: far, top: new Set() });
    expect(card.visible).toBe(false);
    v.frame(1 / 30, true, false, { view: near, top: new Set(['gpu:pcie0']) });
    expect(card.visible).toBe(true); // back in view
    v.setZoom(0.1);
    expect(v.candidates(near)).toEqual([]); // too far out for counters
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
