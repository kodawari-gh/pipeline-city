// Ticket #58: the ambience controller (ambience.ts). A fake sink records the calls; the numbers come from MIX.
import { describe, expect, it } from 'vitest';
import { MIX } from './mixTokens';
import { createAmbience, fanSpeed, humGainDb, humRate, type AmbienceSink, type LoopId } from './ambience';

type Call =
  | { kind: 'start'; id: LoopId; fadeInMs: number }
  | { kind: 'stop'; id: LoopId; fadeOutMs: number }
  | { kind: 'hum'; gainDb: number; rate: number; smoothMs: number }
  | { kind: 'dip'; gainDb: number; fadeMs: number };

function fakeSink() {
  const calls: Call[] = [];
  const sink: AmbienceSink = {
    startLoop: (id, fadeInMs) => calls.push({ kind: 'start', id, fadeInMs }),
    stopLoop: (id, fadeOutMs) => calls.push({ kind: 'stop', id, fadeOutMs }),
    setHum: (gainDb, rate, smoothMs) => calls.push({ kind: 'hum', gainDb, rate, smoothMs }),
    duckHum: (gainDb, fadeMs) => calls.push({ kind: 'dip', gainDb, fadeMs }),
  };
  return { sink, calls };
}
const HUM = 'amb_machine_hum_loop';
const ROOM = 'amb_room_city_loop';
const lastHum = (calls: Call[]) => calls.filter((c): c is Extract<Call, { kind: 'hum' }> => c.kind === 'hum').pop()!;
const loopCalls = (calls: Call[], id: LoopId) =>
  calls.filter((c) => (c.kind === 'start' || c.kind === 'stop') && c.id === id);

describe('fanSpeed', () => {
  it('is the mean of the fan-bearing devices', () => {
    expect(
      fanSpeed([
        { kind: 'gpu', fan: 0.2 },
        { kind: 'npu', fan: 0.6 },
        { kind: 'cpu', fan: 0 },
      ]),
    ).toBeCloseTo(0.4);
  });
  it('is 0.5 when no device has a fan', () => {
    expect(fanSpeed([{ kind: 'cpu', fan: 0 }])).toBe(0.5);
    expect(fanSpeed([])).toBe(0.5);
  });
  it('clamps a value outside 0..1', () => {
    expect(fanSpeed([{ kind: 'gpu', fan: 3 }])).toBe(1);
  });
});

describe('hum gain and rate', () => {
  it('runs from the token ends at speed 0 and 1', () => {
    const f = MIX.ambience[HUM].fanFollow;
    expect(humGainDb(0)).toBe(f.gainDbAt0);
    expect(humGainDb(1)).toBe(f.gainDbAt1);
    expect(humRate(0)).toBe(f.rateAt0);
    expect(humRate(1)).toBe(f.rateAt1);
  });
});

describe('createAmbience', () => {
  it('starts the hum when powered, with its fade in, and stops it with its fade out', () => {
    const { sink, calls } = fakeSink();
    const a = createAmbience(sink);
    a.onSnapshot({ powered: true, devices: [] });
    a.onSnapshot({ powered: true, devices: [] });
    a.onSnapshot({ powered: false, devices: [] });
    expect(loopCalls(calls, HUM)).toEqual([
      { kind: 'start', id: HUM, fadeInMs: MIX.ambience[HUM].fadeInMs },
      { kind: 'stop', id: HUM, fadeOutMs: MIX.ambience[HUM].fadeOutMs },
    ]);
  });

  it('plays the room loop only after the unlock, and only on a change of the room', () => {
    const { sink, calls } = fakeSink();
    const a = createAmbience(sink);
    a.onRoom(true);
    expect(loopCalls(calls, ROOM)).toEqual([]);
    a.onUnlock();
    a.onRoom(true);
    a.onRoom(false);
    a.onRoom(false);
    expect(loopCalls(calls, ROOM)).toEqual([
      { kind: 'start', id: ROOM, fadeInMs: MIX.ambience[ROOM].fadeInMs },
      { kind: 'stop', id: ROOM, fadeOutMs: MIX.ambience[ROOM].fadeOutMs },
    ]);
  });

  it('follows the mean fan speed of the hum, smoothed', () => {
    const { sink, calls } = fakeSink();
    const a = createAmbience(sink);
    a.onSnapshot({ powered: true, devices: [{ kind: 'gpu', fan: 1 }] });
    expect(lastHum(calls)).toEqual({
      kind: 'hum',
      gainDb: humGainDb(1),
      rate: humRate(1),
      smoothMs: MIX.ambience[HUM].fanFollow.smoothMs,
    });
    a.onSnapshot({ powered: true, devices: [] });
    expect(lastHum(calls)).toEqual({
      kind: 'hum',
      gainDb: humGainDb(0.5),
      rate: humRate(0.5),
      smoothMs: MIX.ambience[HUM].fanFollow.smoothMs,
    });
  });

  it('dips the hum by the pause token once when the clock stops, and lifts it on resume', () => {
    const { sink, calls } = fakeSink();
    const a = createAmbience(sink);
    const pauseDb = MIX.pause.ambienceGainDb[HUM];
    a.onSpeed(4);
    a.onSpeed(0);
    a.onSpeed(0);
    a.onSpeed(4);
    expect(calls.filter((c) => c.kind === 'dip')).toEqual([
      { kind: 'dip', gainDb: pauseDb, fadeMs: MIX.pause.fadeMs },
      { kind: 'dip', gainDb: 0, fadeMs: MIX.pause.fadeMs },
    ]);
  });

  it('does not dip the room loop: the room has no pause level of its own', () => {
    const { sink, calls } = fakeSink();
    const a = createAmbience(sink);
    a.onUnlock();
    a.onRoom(true);
    a.onSpeed(0);
    expect(loopCalls(calls, ROOM)).toEqual([{ kind: 'start', id: ROOM, fadeInMs: MIX.ambience[ROOM].fadeInMs }]);
  });

  it('stops the hum when there is no game', () => {
    const { sink, calls } = fakeSink();
    const a = createAmbience(sink);
    a.onSnapshot({ powered: true, devices: [] });
    a.onSnapshot(null);
    expect(loopCalls(calls, HUM).pop()).toEqual({ kind: 'stop', id: HUM, fadeOutMs: MIX.ambience[HUM].fadeOutMs });
  });
});
