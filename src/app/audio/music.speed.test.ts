// Ticket #62: game speed changes the music's density and brightness only, never its tempo (music-spec.json `speed`).
// Seen through the director with a fake backend: the speed comes in on `onUi`. The map is read from the spec's numbers:
// shimmer dB and bass dB per speed (1, 2, 4, 8, 12, 16, 64), ramps of 0.5 s. The map's offsets are compared as differences
// from speed 4 (the map's base), so the test does not depend on how the token dB is folded in.
import { assert, describe, expect, it } from 'vitest';
import * as audioDirector from './director';
import { keyName, keyPcForLevel } from './keys';

interface Rec {
  name: string;
  args: unknown[];
}

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
    lastGain: (id: string): number | undefined => {
      const g = calls.filter((c) => c.name === 'setMusicGain' && c.args[0] === id);
      return g.at(-1)?.args[1] as number | undefined;
    },
    lastOn: (id: string): 'start' | 'stop' | undefined => {
      const on = calls.filter((c) => (c.name === 'startMusic' || c.name === 'stopMusic') && c.args[0] === id);
      const latest = on.at(-1);
      if (latest === undefined) {
        return undefined;
      }
      return latest.name === 'startMusic' ? 'start' : 'stop';
    },
  };
}

const KEY = keyName(keyPcForLevel(1));
const SHIMMER = `music_shimmer_${KEY}`;
const BASS = `music_bass_${KEY}`;
const RAMP_MS = 500;

/** A running game at level 1 with the link up (shimmer on) and the bass in play. */
function running() {
  const b = recordingBackend();
  const d = audioDirector.createDirector(b.sink);
  const snap = {
    log: [],
    level: { level: 1 },
    phase: 'running',
    net: { state: 'link-up', transfers: [] },
    devices: [],
    power: { totalW: 10, budgetW: 100, tripped: false },
  } as unknown as audioDirector.DirectorSnap;
  d.onUnlock();
  d.onScene('game');
  d.onSnapshot(snap);
  const ui = (speed: number): audioDirector.UiInput => ({ speed, hold: null, crashed: false });
  d.onUi(ui(4));
  return { b, d, ui };
}

/** The shimmer and bass gains (dB) after the clock runs at `speed`. */
function atSpeed(speed: number) {
  const r = running();
  r.d.onUi(r.ui(speed));
  const lastGainResult = r.b.lastGain(SHIMMER);
  assert.exists(lastGainResult);
  const lastGainResult2 = r.b.lastGain(BASS);
  assert.exists(lastGainResult2);
  return { shimmer: lastGainResult, bass: lastGainResult2, bassOn: r.b.lastOn(BASS) };
}

describe('speed map: shimmer and bass offsets', () => {
  it('speed 1 is sparse: shimmer 6 dB under speed 4, and no bass', () => {
    const base = atSpeed(4);
    const one = atSpeed(1);
    expect(one.shimmer - base.shimmer).toBeCloseTo(-6, 9);
    expect(one.bassOn).toBe('stop');
  });

  it('speed 2: shimmer 3 dB under speed 4, bass 3 dB under speed 4', () => {
    const base = atSpeed(4);
    const two = atSpeed(2);
    expect(two.shimmer - base.shimmer).toBeCloseTo(-3, 9);
    expect(two.bass - base.bass).toBeCloseTo(-3, 9);
  });

  it('speed 8 leaves the bass at the base (no bass offset in the map)', () => {
    const base = atSpeed(4);
    expect(atSpeed(8).bass - base.bass).toBeCloseTo(0, 9);
  });

  it('speed 8: shimmer 2 dB over speed 4', () => {
    const base = atSpeed(4);
    expect(atSpeed(8).shimmer - base.shimmer).toBeCloseTo(2, 9);
  });

  it('speed 12: shimmer 3 dB and bass 1 dB over speed 4', () => {
    const base = atSpeed(4);
    const twelve = atSpeed(12);
    expect(twelve.shimmer - base.shimmer).toBeCloseTo(3, 9);
    expect(twelve.bass - base.bass).toBeCloseTo(1, 9);
  });

  it('speeds 16 and 64 are the same as speed 12', () => {
    const twelve = atSpeed(12);
    for (const s of [16, 64]) {
      const at = atSpeed(s);
      expect(at.shimmer).toBeCloseTo(twelve.shimmer, 9);
      expect(at.bass).toBeCloseTo(twelve.bass, 9);
    }
  });
});

describe('speed: density and brightness only, never tempo', () => {
  const SPEEDS = [1, 2, 4, 8, 12, 16, 64, 4, 1];

  it('a speed change never starts, stops, decodes or re-times a stem', () => {
    const r = running();
    const from = r.b.calls.length;
    for (const s of SPEEDS) {
      r.d.onUi(r.ui(s));
    }
    const names = new Set(r.b.calls.slice(from).map((c) => c.name));
    for (const bad of ['startMusic', 'stopMusic', 'preloadMusic', 'decodeKey', 'releaseKey']) {
      if (names.has(bad)) {
        // A stop or start of the bass at speed 1 is the layer exit, not a tempo change: only the bass may move.
        const moved = r.b.calls.slice(from).filter((c) => c.name === bad);
        expect(
          moved.every((c) => c.args[0] === BASS),
          `${bad} on a layer other than the bass`,
        ).toBe(true);
      }
    }
  });

  it('no sink call carries a tempo or playback rate', () => {
    const r = running();
    const from = r.b.calls.length;
    for (const s of SPEEDS) {
      r.d.onUi(r.ui(s));
    }
    const names = r.b.calls.slice(from).map((c) => c.name);
    expect(names.filter((n) => /rate|tempo|bpm|pitch/iu.test(n))).toStrictEqual([]);
  });

  it('speed ramps over 0.5 s', () => {
    const r = running();
    const from = r.b.calls.length;
    r.d.onUi(r.ui(12));
    const gains = r.b.calls.slice(from).filter((c) => c.name === 'setMusicGain' && c.args[0] === SHIMMER);
    expect(gains.length).toBeGreaterThan(0);
    for (const g of gains) {
      expect(g.args[2]).toBe(RAMP_MS);
    }
  });
});

// The event notes per beat follow the density: each note cue carries `perBeat` = EVENT_NOTES_PER_BEAT x density (4 x 1, 2, 3).
describe('speed: event notes per beat follow the density', () => {
  /** Six fresh payout notes in one snapshot (a payout plays a note cue). */
  const payouts = Array.from({ length: 6 }, (_, i) => ({
    tick: i + 1,
    kind: 'payout',
    text: 'key 3 paid: (late) $120',
  }));

  /** The `perBeat` of each note cue, after the clock runs at `speed`. */
  const capsAt = (speed: number): (number | undefined)[] => {
    const r = running();
    r.d.onUi(r.ui(speed));
    const from = r.b.calls.length;
    r.d.onSnapshot({
      log: payouts,
      level: { level: 1 },
      phase: 'running',
      net: { state: 'link-up', transfers: [] },
      devices: [],
      power: { totalW: 10, budgetW: 100, tripped: false },
    } as unknown as audioDirector.DirectorSnap);
    return r.b.calls
      .slice(from)
      .filter((c) => c.name === 'playCue' && c.args[0] === 'payout')
      .map((c) => (c.args[1] as { perBeat?: number }).perBeat);
  };

  it('speed 1, 2 and 4 have the base density: 4 notes per beat', () => {
    for (const s of [1, 2, 4]) {
      expect(capsAt(s)).toStrictEqual(Array(6).fill(4));
    }
  });

  it('speed 8 doubles it (8 notes per beat), speed 12 and up triple it (12)', () => {
    expect(capsAt(8)).toStrictEqual(Array(6).fill(8));
    for (const s of [12, 16, 64]) {
      expect(capsAt(s)).toStrictEqual(Array(6).fill(12));
    }
  });
});

describe('pause: shimmer and stress are silent while stopped', () => {
  it('both go off at speed 0 and start again when the speed returns', () => {
    const b = recordingBackend();
    const d = audioDirector.createDirector(b.sink);
    d.onUnlock();
    d.onScene('game');
    d.onSnapshot({
      log: [],
      level: { level: 1 },
      phase: 'running',
      net: { state: 'link-up', transfers: [] },
      devices: [],
      vrm: { loadRatio: 1.15 },
      power: { totalW: 10, budgetW: 100, tripped: false },
    } as unknown as audioDirector.DirectorSnap);
    const STRESS = `music_stress_${KEY}`;
    const ui = (speed: number): audioDirector.UiInput => ({ speed, hold: null, crashed: false });
    d.onUi(ui(4));
    expect(b.lastOn(SHIMMER)).toBe('start');
    expect(b.lastOn(STRESS)).toBe('start');
    d.onUi(ui(0));
    expect(b.lastOn(SHIMMER)).toBe('stop');
    expect(b.lastOn(STRESS)).toBe('stop');
    // The stop is the 1.0 s pause fade, on the next beat.
    for (const id of [SHIMMER, STRESS]) {
      const stop = b.calls.filter((c) => c.name === 'stopMusic' && c.args[0] === id).at(-1);
      assert.exists(stop);
      expect(stop.args[1] as number).toBeCloseTo(1000, 0);
      expect(stop.args[2]).toBe('beat');
    }
    d.onUi(ui(4));
    expect(b.lastOn(SHIMMER)).toBe('start');
    expect(b.lastOn(STRESS)).toBe('start');
  });
});
