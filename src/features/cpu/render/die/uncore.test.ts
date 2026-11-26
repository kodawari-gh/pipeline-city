import { describe, expect, it } from 'vitest';
import { Graphics } from 'pixi.js';
import { snap } from '@/core/ui/testdata';
import { builtinTheme } from '@/core/render/theme';
import type * as themeTypes from '@/core/render/theme';
import type { DeviceSnap } from '@/worker/game/types';
import type { CoreStats } from '../../sim/pipesnap';
import { UncoreFx, fresh, uncoreInput } from './uncore';
import type { PlanBlock } from './dieart';

const T: themeTypes.Theme = {
  ...builtinTheme(),
  bg: '#000',
  line: '#222',
  ink: '#fff',
  mute: '#888',
  alu: '#0ff',
  mul: '#a0f',
  ld: '#fa0',
  st: '#0f8',
  br: '#f0a',
  bad: '#f33',
};

/** A CPU at `tempC` degrees, throttled by `throttle`. */
const cpuDevice = (tempC: number, throttle: number): DeviceSnap => ({
  id: 'cpu',
  spec: 'cpu1',
  kind: 'cpu',
  name: 'CPU',
  slot: 'cpu',
  burnt: false,
  requestedClock: null,
  effectiveClock: 2,
  tempC,
  powerW: 0,
  throttle,
  unstable: false,
  fan: 0,
});

/** A hardware core's counters with `coherence` coherence misses and `l2Wait` cycles waiting for the L2. */
const coreStats = (coherence: number, l2Wait: number): CoreStats => ({
  cycles: 0,
  retired: 0,
  stalls: 0,
  l2Wait,
  coherence,
});

/** What instruction `i` paints: its action, its colour, its alpha and its shapes. */
function paintOf(i: Graphics['context']['instructions'][number]): unknown[] {
  if (i.action === 'texture') {
    throw new Error('the uncore paints no textures');
  }
  return [i.action, i.data.style.color, i.data.style.alpha, i.data.path.instructions];
}
const block = (kind: string, grid?: PlanBlock['grid']): PlanBlock => ({
  id: kind,
  kind,
  label: kind,
  rect: { x: 0, y: 0, w: 300, h: 100 },
  ...(grid ? { grid } : {}),
});

describe('uncore state', () => {
  it('lets a hit fade out over its life', () => {
    const fx = new UncoreFx();
    fx.touch('mc', false, 1000, 64);
    expect(fx.activity('mc', 1000)).toBeGreaterThan(0);
    expect(fx.activity('mc', 1000 + 5000)).toBe(0);
    expect(fresh({ t: 0, write: false, seed: 0 }, 'mc', 350)).toBeCloseTo(0.5);
  });
  it('reads the machine from a snapshot', () => {
    const s = snap({
      power: { totalW: 40, budgetW: 100, psuFactor: 1, off: false, tripped: false },
      devices: [cpuDevice(70, 1)],
      cpuClock: { value: 2, min: 1, max: 4 },
      cores: { selected: 0, live: [], tiles: [], stats: [coreStats(2, 5), coreStats(3, 1)] },
    });
    expect(uncoreInput(s)).toMatchObject({
      loadW: 40,
      budgetW: 100,
      tempC: 70,
      throttle: true,
      clock: 2,
      clockMax: 4,
      coherence: 5,
      l2Wait: 6,
    });
    expect(uncoreInput(null)).toBeNull();
  });
  it('paints every outer block without throwing, idle or busy', () => {
    const fx = new UncoreFx();
    const blocks = [
      block('power', { cols: 6, rows: 1, count: 6 }),
      block('thermal'),
      block('clock'),
      block('mc', { cols: 1, rows: 6, count: 6 }),
      block('l2', { cols: 2, rows: 8, count: 16 }),
      block('pcie', { cols: 21, rows: 1, count: 21 }),
      block('usb', { cols: 1, rows: 4, count: 4 }),
      block('display', { cols: 1, rows: 2, count: 2 }),
      block('fabric'),
      block('timer'),
    ];
    const g = new Graphics();
    fx.draw(g, blocks, T, 0);
    fx.set(
      {
        loadW: 80,
        budgetW: 100,
        off: false,
        tripped: false,
        tempC: 80,
        throttle: true,
        clock: 3,
        clockMax: 4,
        coherence: 0,
        l2Wait: 0,
      },
      100,
    );
    for (const u of ['l2', 'mc', 'pcie', 'nvme', 'dmi', 'usb', 'display'] as const) {
      fx.touch(u, u === 'mc', 200, 12_345);
    }
    fx.set(
      {
        loadW: 80,
        budgetW: 100,
        off: false,
        tripped: true,
        tempC: 80,
        throttle: true,
        clock: 3,
        clockMax: 4,
        coherence: 1,
        l2Wait: 2,
      },
      250,
    );
    expect(() => {
      fx.draw(g, blocks, T, 300);
    }).not.toThrow();
  });
  it('lights the VRM phases by the load, all alike and steady: the picture does not change with the time (no shimmer, no blink)', () => {
    const fx = new UncoreFx();
    const power = [block('power', { cols: 6, rows: 1, count: 6 })];
    // (what was painted: every fill with its colour, its alpha and its shapes)
    const draw = (now: number): string => {
      const g = new Graphics();
      fx.draw(g, power, T, now);
      return JSON.stringify(g.context.instructions.map((i) => paintOf(i)));
    };
    const on = {
      loadW: 60,
      budgetW: 100,
      off: false,
      tripped: false,
      tempC: 50,
      throttle: false,
      clock: 3,
      clockMax: 4,
      coherence: 0,
      l2Wait: 0,
    };
    fx.set(on, 0);
    const load = draw(0);
    expect(load.length).toBeGreaterThan(20);
    for (const t of [90, 250, 777, 4000]) {
      expect(draw(t), `load at ${t} ms`).toBe(load);
    }
    fx.set({ ...on, tripped: true }, 0);
    const trip = draw(0);
    expect(trip).not.toBe(load);
    for (const t of [125, 250, 375, 3000]) {
      expect(draw(t), `trip at ${t} ms`).toBe(trip);
    }
    fx.set({ ...on, loadW: 120 }, 0);
    expect(draw(0)).not.toBe(load);
    fx.set({ ...on, off: true }, 0);
    expect(draw(500)).toBe('[]');
  });
});
