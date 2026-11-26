// Ticket #62: the data, stress and debt layers of the music (shimmer, stress, the 3 kHz bill low-pass), seen through the director with a fake backend.
// `stressAmount` is the pure function of the snapshot (music.ts). Layer ids: `music_shimmer_<KEY>`, `music_stress_<KEY>`, `music_bed_<KEY>`.
// Gains are linear: dB = the token dB (MIX.music.layerGainDb) + 20 log10(target) (music-spec.md §4 and §8). The spec names no call for a low-pass, so the fake
// records every call by name and a filter is found by its frequency argument (4000 or 3000 Hz).
import { assert, describe, expect, it } from 'vitest';
import * as audioDirector from './director';
import { keyName, keyPcForLevel } from './keys';
import { MIX } from './mixTokens';
import { BAR_S, stressAmount } from './music';

interface Rec {
  name: string;
  args: unknown[];
}

/** A fake sink: every method call is recorded by name and arguments, whatever the name. */
function recordingBackend() {
  const calls: Rec[] = [];
  const sink = new Proxy(
    {},
    {
      get: (_t, name) =>
        typeof name === 'string' ? (...args: unknown[]) => void calls.push({ name, args }) : undefined,
      has: () => true,
    },
  );
  return {
    sink: sink as unknown as Parameters<typeof audioDirector.createDirector>[0],
    calls,
    named: (name: string) => calls.filter((c) => c.name === name),
    /** The last gain (dB) sent for an id, or undefined. */
    lastGain: (id: string): number | undefined => {
      const g = calls.filter((c) => c.name === 'setMusicGain' && c.args[0] === id);
      return g.at(-1)?.args[1] as number | undefined;
    },
    /** The last start or stop for an id: 'start', 'stop', or undefined. */
    lastOn: (id: string): 'start' | 'stop' | undefined => {
      const on = calls.filter((c) => (c.name === 'startMusic' || c.name === 'stopMusic') && c.args[0] === id);
      const latest = on.at(-1);
      if (latest === undefined) {
        return undefined;
      }
      return latest.name === 'startMusic' ? 'start' : 'stop';
    },
    /** A call that names this id and carries this frequency (a low-pass). */
    filtered: (id: string, hz: number) => calls.some((c) => c.args[0] === id && c.args.includes(hz)),
  };
}

const keyOf = (level: number) => keyName(keyPcForLevel(level));
const keyed = (layer: string, level: number) => `music_${layer}_${keyOf(level)}`;
const tokenDb = (layer: keyof typeof MIX.music.layerGainDb) => MIX.music.layerGainDb[layer];
const linear = (db: number) => 10 ** (db / 20);

interface Extra {
  net?: { state: string; transfers?: unknown[] };
  keyActivity?: string;
  devices?: { id: string; throttle: number; tempC?: number }[];
  vrm?: { loadRatio: number; tempC?: number; throttleC?: number; damageC?: number };
  power?: { totalW: number; budgetW: number; tripped?: boolean };
  bill?: { unpaid: number };
}

/** A game snapshot with the fields the layers read. Healthy unless `extra` says otherwise. */
function snapOf(level: number, phase = 'running', extra: Extra = {}): audioDirector.DirectorSnap {
  return {
    log: [],
    level: { level },
    phase,
    net: { state: 'down', transfers: [] },
    devices: [],
    vrm: { loadRatio: 0.5 },
    power: { totalW: 10, budgetW: 100, tripped: false },
    bill: { unpaid: 0 },
    ...extra,
  } as unknown as audioDirector.DirectorSnap;
}

/** A director in the running game at `level`, unlocked, with one snapshot played. */
function game(level: number, extra: Extra = {}) {
  const b = recordingBackend();
  const d = audioDirector.createDirector(b.sink);
  d.onUnlock();
  d.onScene('game');
  d.onSnapshot(snapOf(level, 'running', extra));
  return { b, d };
}

const SH = (level: number) => keyed('shimmer', level);
const ST = (level: number) => keyed('stress', level);

describe('stressAmount: the worst term, clamped to 0..1', () => {
  const snap = (opts: {
    throttles?: number[];
    loadRatio?: number;
    totalW?: number;
    budgetW?: number;
    tempC?: number;
  }) =>
    ({
      devices: (opts.throttles ?? [1]).map((throttle, i) => ({ id: `d${i}`, throttle, tempC: 40 })),
      vrm: { loadRatio: opts.loadRatio ?? 0.5, tempC: opts.tempC ?? 40, throttleC: 90, damageC: 105 },
      power: { totalW: opts.totalW ?? 10, budgetW: opts.budgetW ?? 100, tripped: false },
    }) as unknown as Parameters<typeof stressAmount>[0];

  it('a healthy machine has no stress', () => {
    expect(stressAmount(snap({}))).toBe(0);
  });

  it('the worst device throttle sets it: the slowest device counts, not the first', () => {
    const two = stressAmount(snap({ throttles: [0.9, 0.6] }));
    const worstOnly = stressAmount(snap({ throttles: [0.6] }));
    expect(two).toBe(worstOnly);
    expect(two).toBeGreaterThan(stressAmount(snap({ throttles: [0.9] })));
    expect(two).toBeGreaterThan(0);
  });

  it('a device at full clock adds nothing', () => {
    expect(stressAmount(snap({ throttles: [1, 1] }))).toBe(0);
  });

  it('the VRM load ratio counts only above 1', () => {
    expect(stressAmount(snap({ loadRatio: 1 }))).toBe(0);
    expect(stressAmount(snap({ loadRatio: 0.8 }))).toBe(0);
    const over = stressAmount(snap({ loadRatio: 1.2 }));
    expect(over).toBeGreaterThan(0);
    expect(stressAmount(snap({ loadRatio: 1.4 }))).toBeGreaterThan(over);
  });

  it('the power ratio counts only above 0.9 of the budget', () => {
    expect(stressAmount(snap({ totalW: 90, budgetW: 100 }))).toBe(0);
    expect(stressAmount(snap({ totalW: 80, budgetW: 100 }))).toBe(0);
    const over = stressAmount(snap({ totalW: 100, budgetW: 100 }));
    expect(over).toBeGreaterThan(0);
    expect(stressAmount(snap({ totalW: 120, budgetW: 100 }))).toBeGreaterThan(over);
  });

  it('the terms do not add: the result is the worst single term', () => {
    const both = stressAmount(snap({ throttles: [0.7], loadRatio: 1.3 }));
    const throttleOnly = stressAmount(snap({ throttles: [0.7] }));
    const loadOnly = stressAmount(snap({ loadRatio: 1.3 }));
    expect(both).toBe(Math.max(throttleOnly, loadOnly));
  });

  it('a power ratio over the budget is its own term', () => {
    const power = stressAmount(snap({ totalW: 115, budgetW: 100 }));
    const both = stressAmount(snap({ totalW: 115, budgetW: 100, loadRatio: 1.05 }));
    expect(both).toBe(Math.max(power, stressAmount(snap({ loadRatio: 1.05 }))));
  });

  it('stays within 0..1 for extreme input', () => {
    const extreme = stressAmount(snap({ throttles: [0], loadRatio: 10, totalW: 1000, budgetW: 1 }));
    expect(extreme).toBeGreaterThanOrEqual(0);
    expect(extreme).toBeLessThanOrEqual(1);
  });

  it('a hot VRM never lowers stress (the temperature term is optional)', () => {
    const cool = stressAmount(snap({ loadRatio: 1.2, tempC: 40 }));
    const hot = stressAmount(snap({ loadRatio: 1.2, tempC: 100 }));
    expect(hot).toBeGreaterThanOrEqual(cool);
    expect(hot).toBeLessThanOrEqual(1);
  });

  it('is pure: the same snapshot gives the same amount and the snapshot is not changed', () => {
    const s = snap({ throttles: [0.8], loadRatio: 1.1 });
    const before = JSON.stringify(s);
    expect(stressAmount(s)).toBe(stressAmount(s));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('shimmer: plays while data flows', () => {
  it('link-up starts the shimmer on the game key', () => {
    const { b } = game(1, { net: { state: 'link-up', transfers: [] } });
    expect(b.lastOn(SH(1))).toBe('start');
  });

  it('link-up plays at the token dB with no low-pass', () => {
    const { b } = game(1, { net: { state: 'link-up', transfers: [] } });
    expect(b.lastGain(SH(1))).toBeCloseTo(tokenDb('shimmer'), 9);
    expect(b.filtered(SH(1), 4000)).toBe(false);
  });

  it('saturated: +2 dB over the link-up level, with a 4 kHz low-pass', () => {
    const { b, d } = game(1, { net: { state: 'link-up', transfers: [] } });
    const linkUp = b.lastGain(SH(1));
    assert.exists(linkUp);
    d.onSnapshot(snapOf(1, 'running', { net: { state: 'saturated', transfers: [] } }));
    const lastGainResult = b.lastGain(SH(1));
    assert.exists(lastGainResult);
    expect(lastGainResult - linkUp).toBeCloseTo(2, 9);
    expect(b.lastGain(SH(1))).toBeCloseTo(tokenDb('shimmer') + 2, 9);
    expect(b.filtered(SH(1), 4000)).toBe(true);
  });

  it('a running transfer on a key ingest starts the shimmer with the link down', () => {
    const { b } = game(1, { net: { state: 'down', transfers: [] }, keyActivity: 'ingesting' });
    expect(b.lastOn(SH(1))).toBe('start');
  });

  it('no data, no shimmer', () => {
    const { b } = game(1, { net: { state: 'down', transfers: [] }, keyActivity: 'none' });
    expect(b.lastOn(SH(1))).not.toBe('start');
  });

  it('link down with no data fades the shimmer out over one bar', () => {
    const { b, d } = game(1, { net: { state: 'link-up', transfers: [] } });
    d.onSnapshot(snapOf(1, 'running', { net: { state: 'down', transfers: [] } }));
    const stop = b.calls.filter((c) => c.name === 'stopMusic' && c.args[0] === SH(1)).at(-1);
    expect(stop).toBeDefined();
    assert.exists(stop);
    expect(stop.args[1] as number).toBeCloseTo(BAR_S * 1000, 0);
  });
});

describe('stress: the layer follows stressAmount', () => {
  const stressed: Extra = { devices: [{ id: 'cpu', throttle: 0.5 }] };

  it('a stressed machine plays the stress layer', () => {
    const { b } = game(1, stressed);
    expect(b.lastOn(ST(1))).toBe('start');
  });

  it('a healthy machine plays no stress layer', () => {
    const { b } = game(1);
    expect(b.lastOn(ST(1))).not.toBe('start');
  });

  it('more stress is louder: the layer gain rises with stressAmount', () => {
    const mild = game(1, { vrm: { loadRatio: 1.1 } });
    const hard = game(1, { vrm: { loadRatio: 1.6 } });
    const hardGain = hard.b.lastGain(ST(1));
    assert.exists(hardGain);
    const mildGain = mild.b.lastGain(ST(1));
    assert.exists(mildGain);
    expect(linear(hardGain)).toBeGreaterThan(linear(mildGain));
  });

  it('the gain is linear: stress^1.5 on the token dB (loadRatio 1.1 is stress 0.5: -15 dB)', () => {
    const { b } = game(1, { vrm: { loadRatio: 1.1 } });
    expect(b.lastGain(ST(1))).toBe(-15);
  });

  it('the stress layer enters over one bar', () => {
    const { b } = game(1, stressed);
    const start = b.calls.filter((c) => c.name === 'startMusic' && c.args[0] === ST(1)).at(-1);
    assert.exists(start);
    expect(start.args[1] as number).toBeCloseTo(BAR_S * 1000, 0);
  });

  it('the stress layer leaves over one bar when the machine recovers', () => {
    const { b, d } = game(1, stressed);
    d.onSnapshot(snapOf(1, 'running', { devices: [{ id: 'cpu', throttle: 1 }] }));
    const stop = b.calls.filter((c) => c.name === 'stopMusic' && c.args[0] === ST(1)).at(-1);
    expect(stop).toBeDefined();
    assert.exists(stop);
    expect(stop.args[1] as number).toBeCloseTo(BAR_S * 1000, 0);
  });
});

describe('debt: an unpaid bill muffles the bed', () => {
  it('an unpaid bill puts a 3 kHz low-pass on the bed', () => {
    const { b } = game(1, { bill: { unpaid: 12 } });
    expect(b.filtered(keyed('bed', 1), 3000)).toBe(true);
  });

  it('the bill low-pass on the bed fades in over 1 s', () => {
    const { b } = game(1, { bill: { unpaid: 12 } });
    const lp = b.calls
      .filter((c) => c.name === 'setMusicLowpass' && c.args[0] === keyed('bed', 1) && c.args[1] === 3000)
      .at(-1);
    expect(lp).toBeDefined();
    assert.exists(lp);
    expect(lp.args[2]).toBe(1000);
  });

  it('a paid bill (nothing unpaid) has no 3 kHz low-pass on the bed', () => {
    const { b } = game(1, { bill: { unpaid: 0 } });
    expect(b.filtered(keyed('bed', 1), 3000)).toBe(false);
  });

  it('paying the bill lifts the low-pass: no 3 kHz call on the bed after it', () => {
    const { b, d } = game(1, { bill: { unpaid: 12 } });
    const from = b.calls.length;
    d.onSnapshot(snapOf(1, 'running', { bill: { unpaid: 0 } }));
    const after = b.calls.slice(from);
    expect(after.some((c) => c.args[0] === keyed('bed', 1) && c.args.includes(3000))).toBe(false);
  });
});
