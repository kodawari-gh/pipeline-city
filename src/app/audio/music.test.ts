import { describe, expect, it } from 'vitest';
import { createMusic, MENU_ID, NEUTRAL_SPEED, speedMix, type MusicSink } from './music';
import { keyName } from './keys';

describe('speedMix', () => {
  it('keeps the neutral mix at speed 4 and for an unknown speed', () => {
    expect(speedMix(4)).toEqual(NEUTRAL_SPEED);
    expect(speedMix(undefined)).toEqual(NEUTRAL_SPEED);
    expect(speedMix(3)).toEqual(NEUTRAL_SPEED);
  });

  it('cuts the bass and dims the shimmer at speed 1', () => {
    expect(speedMix(1)).toEqual({ bass: false, bassDb: 0, shimmerDb: -6, density: 1 });
  });

  it('lowers the bass and shimmer 3 dB at speed 2', () => {
    expect(speedMix(2)).toEqual({ bass: true, bassDb: -3, shimmerDb: -3, density: 1 });
  });

  it('brightens and thickens the mix from speed 8 up', () => {
    expect(speedMix(8)).toEqual({ bass: true, bassDb: 0, shimmerDb: 2, density: 2 });
    for (const s of [12, 16, 64]) expect(speedMix(s)).toEqual({ bass: true, bassDb: 1, shimmerDb: 3, density: 3 });
  });

  it('never changes the tempo: the mix has no tempo field', () => {
    for (const s of [1, 2, 4, 8, 16, 64])
      expect(Object.keys(speedMix(s)).sort()).toEqual(['bass', 'bassDb', 'density', 'shimmerDb']);
  });
});

// Ticket #62: a keyed layer's gain is linear: dB = its token dB + 20 log10(target) (music-spec.md §4 and §8). The off-state bed is the 0.5 target: -6 dB.
describe('ticket #62: linear layer gains', () => {
  const BED = `music_bed_${keyName(0)}`;
  const PLUCK = `music_pluck_${keyName(0)}`;

  /** A fake music sink: every call is recorded by name and arguments. */
  function fakeSink() {
    const calls: { name: string; args: unknown[] }[] = [];
    const sink = new Proxy({} as Record<string, (...a: unknown[]) => void>, {
      get: (_t, name) =>
        typeof name === 'string' ? (...args: unknown[]) => void calls.push({ name, args }) : undefined,
      has: () => true,
    });
    return {
      sink: sink as unknown as MusicSink,
      /** The last gain (dB) sent for an id, or undefined. */
      lastGain: (id: string): number | undefined => {
        const g = calls.filter((c) => c.name === 'setMusicGain' && c.args[0] === id);
        return g.length ? (g.at(-1)!.args[1] as number) : undefined;
      },
      /** The arguments of the last low-pass sent for an id, or undefined. */
      lastLowpass: (id: string): unknown[] | undefined =>
        calls.filter((c) => c.name === 'setMusicLowpass' && c.args[0] === id).at(-1)?.args,
    };
  }

  /** The music in the game on key 0, at `phase` (or before any phase). */
  function inGame(phase?: string) {
    const f = fakeSink();
    const m = createMusic(f.sink);
    m.onUnlock();
    m.onScene('game');
    m.onKey(0);
    if (phase !== undefined) m.onPhase(phase);
    return { ...f, m };
  }

  it('the bed at its full target plays at its token dB: 0 dB', () => {
    expect(inGame('running').lastGain(BED)).toBe(0);
  });

  it('the off-state bed is the 0.5 target: -6 dB', () => {
    const { m, lastGain } = inGame('running');
    m.onPhase('off');
    expect(lastGain(BED)).toBe(-6);
  });

  it('boot: the pluck at 0.5 on its -2 dB token is -8 dB', () => {
    expect(inGame('posting').lastGain(PLUCK)).toBe(-8);
  });

  it('idle: the pluck at 0.6 on its -2 dB token is -6.4 dB', () => {
    expect(inGame('idle-os').lastGain(PLUCK)).toBe(-6.4);
  });

  it('an unpaid bill muffles the bed with a 3 kHz low-pass over 1 s', () => {
    const { m, lastLowpass } = inGame('running');
    m.onFeed({ flowing: false, saturated: false, stress: 0, debt: true });
    expect(lastLowpass(BED)).toEqual([BED, 3000, 1000, 'bar']);
  });

  it('MENU_ID is not a keyed layer: the menu never gets a bed gain', () => {
    const { lastGain } = inGame('running');
    expect(lastGain(`music_bed_${MENU_ID}`)).toBeUndefined();
  });
});
