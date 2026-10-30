import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import type { Snapshot } from '../../sim/protocol';
import type { Theme } from '../theme';
import { UncoreFx, fresh, uncoreInput } from './uncore';
import type { PlanBlock } from './dieart';

const T = { dark: true, bg: '#000', line: '#222', ink: '#fff', mute: '#888', alu: '#0ff', mul: '#a0f', ld: '#fa0', st: '#0f8', br: '#f0a', bad: '#f33' } as unknown as Theme;
const block = (kind: string, grid?: PlanBlock['grid']): PlanBlock => ({ id: kind, kind, label: kind, rect: { x: 0, y: 0, w: 300, h: 100 }, ...(grid ? { grid } : {}) });

describe('uncore state', () => {
  it('lets a hit fade out over its life', () => {
    const fx = new UncoreFx();
    fx.touch('mc', false, 1000, 64);
    expect(fx.activity('mc', 1000)).toBeGreaterThan(0);
    expect(fx.activity('mc', 1000 + 5000)).toBe(0);
    expect(fresh({ t: 0, write: false, seed: 0 }, 'mc', 350)).toBeCloseTo(0.5);
  });
  it('reads the machine from a snapshot', () => {
    const s = { power: { totalW: 40, budgetW: 100, off: false, tripped: false }, devices: [{ kind: 'cpu', tempC: 70, throttle: 1 }], cpuClock: { value: 2, min: 1, max: 4 }, cores: { stats: [{ coherence: 2, l2Wait: 5 }, { coherence: 3, l2Wait: 1 }] } } as unknown as Snapshot;
    expect(uncoreInput(s)).toMatchObject({ loadW: 40, budgetW: 100, tempC: 70, throttle: true, clock: 2, clockMax: 4, coherence: 5, l2Wait: 6 });
    expect(uncoreInput(null)).toBeNull();
  });
  it('paints every outer block without throwing, idle or busy', () => {
    const fx = new UncoreFx();
    const blocks = [block('power', { cols: 6, rows: 1, count: 6 }), block('thermal'), block('clock'), block('mc', { cols: 1, rows: 6, count: 6 }), block('l2', { cols: 2, rows: 8, count: 16 }),
      block('pcie', { cols: 21, rows: 1, count: 21 }), block('usb', { cols: 1, rows: 4, count: 4 }), block('display', { cols: 1, rows: 2, count: 2 }), block('fabric'), block('timer')];
    const g = new Graphics();
    fx.draw(g, blocks, T, 0);
    fx.set({ loadW: 80, budgetW: 100, off: false, tripped: false, tempC: 80, throttle: true, clock: 3, clockMax: 4, coherence: 0, l2Wait: 0 }, 100);
    for (const u of ['l2', 'mc', 'pcie', 'nvme', 'dmi', 'usb', 'display'] as const) fx.touch(u, u === 'mc', 200, 12345);
    fx.set({ loadW: 80, budgetW: 100, off: false, tripped: true, tempC: 80, throttle: true, clock: 3, clockMax: 4, coherence: 1, l2Wait: 2 }, 250);
    expect(() => fx.draw(g, blocks, T, 300)).not.toThrow();
  });
});
